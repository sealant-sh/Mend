import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { GitAuthMode } from "@mend/domain/workbench";
import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";

import { mendHome } from "./paths.ts";

/**
 * Host-side git authentication (docs/GIT-ACCESS.md): the one seam every
 * remote git operation resolves its credential through. Three modes —
 * `ambient` (the login user's ssh setup, unchanged), `mend-key` (the calling
 * user's Mend-generated key, one per user, held on this host), and `bridge`
 * (a connected agent). Nothing outside this file decides how a remote is
 * reached.
 */

/** `ssh-keygen` could not run or exited nonzero. */
export class KeygenError extends Schema.TaggedErrorClass<KeygenError>()("KeygenError", {
  stderr: Schema.String,
}) {}

export interface MendKeyInfo {
  /** OpenSSH public key line — what the user adds to their git account (or a repo's deploy keys). */
  readonly publicKey: string;
  /** `ssh-keygen -lf` output: size, hash, comment, type. */
  readonly fingerprint: string;
  /** Absolute private key path on this host; never leaves it. */
  readonly privateKeyPath: string;
}

/** Where the Mend keys live (`users/<id>/id_ed25519` under it). Overridable for tests only. */
export class MendKeysConfig extends Context.Service<
  MendKeysConfig,
  {
    readonly root: string;
  }
>()("@mend/store/MendKeysConfig") {
  static readonly layerFor = (root: string) => Layer.succeed(MendKeysConfig, { root });
}

export const MendKeysConfigLive: Layer.Layer<MendKeysConfig> = Layer.effect(
  MendKeysConfig,
  Effect.sync(() => ({
    root: process.env["MEND_KEYS_ROOT"] ?? path.join(mendHome(), "keys"),
  })),
);

/**
 * A user's Mend key: ed25519, generated on this host, private half 0600 and
 * never copied anywhere — not into workspaces, not into the DB. One key per
 * Mend user, so the public half added to that user's git account acts as
 * them and nobody else on the same server. The public half is what the
 * UI/CLI hand out: "add this to your git account's SSH keys" (or, scoped to
 * one repository, as its deploy key).
 *
 * `userId` null means "whoever is the only user here": rows from before
 * sessions recorded an owner still resolve on a single-user install, and
 * refuse on a shared one rather than guess.
 */
export class MendKeys extends Context.Service<
  MendKeys,
  {
    /** Generate the user's keypair if missing (first mend-key use), then describe it. */
    readonly ensure: (userId: string | null) => Effect.Effect<MendKeyInfo, KeygenError>;
    /** Describe the user's key without creating it; null when none was generated yet. */
    readonly read: (userId: string | null) => Effect.Effect<MendKeyInfo | null, KeygenError>;
  }
>()("@mend/store/MendKeys") {}

/** Subdirectory per user under the keys root. */
export const USERS_DIR = "users";
/** The pre-per-user key: one for the whole server, now claimed by its first user. */
const LEGACY_PRIVATE_KEY = "id_ed25519";

const sshKeygen = (args: ReadonlyArray<string>): Effect.Effect<string, KeygenError> =>
  Effect.callback((resume) => {
    const child = execFile("ssh-keygen", [...args], (error, stdout, stderr) => {
      if (error === null) {
        resume(Effect.succeed(stdout.replace(/\n$/, "")));
        return;
      }
      resume(new KeygenError({ stderr: (stderr === "" ? error.message : stderr).trim() }));
    });
    return Effect.sync(() => child.kill());
  });

export const MendKeysLive: Layer.Layer<MendKeys, never, MendKeysConfig> = Layer.effect(
  MendKeys,
  Effect.gen(function* () {
    const config = yield* MendKeysConfig;
    const usersRoot = path.join(config.root, USERS_DIR);
    const legacyPrivateKeyPath = path.join(config.root, LEGACY_PRIVATE_KEY);

    const userDirs = (): ReadonlyArray<string> =>
      fs.existsSync(usersRoot)
        ? fs
            .readdirSync(usersRoot, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
        : [];

    /** The user whose key an unowned op may use: the only one, else nobody. */
    const resolveOwner = (userId: string | null): Effect.Effect<string, KeygenError> => {
      if (userId !== null) return Effect.succeed(userId);
      const owners = userDirs();
      if (owners.length === 1 && owners[0] !== undefined) return Effect.succeed(owners[0]);
      // A legacy server-wide key with no user dir yet: the first owner will claim it.
      if (owners.length === 0 && fs.existsSync(legacyPrivateKeyPath)) {
        return Effect.succeed(LEGACY_OWNER);
      }
      return new KeygenError({
        stderr:
          owners.length === 0
            ? "no Mend key exists yet — sign in and create one (mend keys init)"
            : "the Mend key is per user and this operation has no owner",
      });
    };

    const paths = (owner: string) => {
      const privateKeyPath =
        owner === LEGACY_OWNER
          ? legacyPrivateKeyPath
          : path.join(usersRoot, owner, LEGACY_PRIVATE_KEY);
      return { privateKeyPath, publicKeyPath: `${privateKeyPath}.pub` };
    };

    /**
     * The first user to ask claims the server-wide key of a pre-per-user
     * install, so the public key already on their git host keeps working.
     */
    const claimLegacy = (owner: string) =>
      Effect.sync(() => {
        if (owner === LEGACY_OWNER || !fs.existsSync(legacyPrivateKeyPath)) return;
        if (userDirs().length > 0) return;
        const { privateKeyPath, publicKeyPath } = paths(owner);
        fs.mkdirSync(path.dirname(privateKeyPath), { recursive: true, mode: 0o700 });
        fs.renameSync(legacyPrivateKeyPath, privateKeyPath);
        if (fs.existsSync(`${legacyPrivateKeyPath}.pub`)) {
          fs.renameSync(`${legacyPrivateKeyPath}.pub`, publicKeyPath);
        }
      });

    const describe = Effect.fn("MendKeys.describe")(function* (owner: string) {
      const { privateKeyPath, publicKeyPath } = paths(owner);
      const publicKey = yield* Effect.sync(() =>
        fs.readFileSync(publicKeyPath, "utf8").trimEnd(),
      ).pipe(Effect.orDie);
      const fingerprint = yield* sshKeygen(["-lf", publicKeyPath]);
      return { publicKey, fingerprint, privateKeyPath };
    });

    const ensure = Effect.fn("MendKeys.ensure")(function* (userId: string | null) {
      const owner = yield* resolveOwner(userId);
      yield* claimLegacy(owner);
      const { privateKeyPath } = paths(owner);
      if (!fs.existsSync(privateKeyPath)) {
        yield* Effect.sync(() =>
          fs.mkdirSync(path.dirname(privateKeyPath), { recursive: true, mode: 0o700 }),
        );
        const comment = `mend@${os.hostname()}`;
        yield* sshKeygen(["-q", "-t", "ed25519", "-N", "", "-C", comment, "-f", privateKeyPath]);
        // ssh-keygen already writes 0600/0644; pin it anyway — the whole mode rests on this.
        yield* Effect.sync(() => fs.chmodSync(privateKeyPath, 0o600));
      }
      return yield* describe(owner);
    });

    const read = Effect.fn("MendKeys.read")(function* (userId: string | null) {
      const owner = yield* resolveOwner(userId).pipe(
        Effect.catchTag("KeygenError", () => Effect.succeed(null)),
      );
      if (owner === null) return null;
      yield* claimLegacy(owner);
      if (!fs.existsSync(paths(owner).publicKeyPath)) return null;
      return yield* describe(owner);
    });

    return { ensure, read };
  }),
);

/** Sentinel owner for the not-yet-claimed server-wide key. Never a real user id. */
const LEGACY_OWNER = "";

/**
 * The ssh command for a remote git operation under `mode`, as a
 * `GIT_SSH_COMMAND` value (sh-parsed by git). Every mode forces BatchMode: a
 * daemon has no terminal, so "hang on a prompt" becomes "fail with the reason
 * on stderr" — which the API layer turns readable via `describeGitRemoteFailure`.
 * (The touch a hardware key demands in bridge mode happens on the CLIENT
 * machine — no prompt is ever needed here.)
 */
export const sshCommandFor = (mode: GitAuthMode, privateKeyPath: string | null): string => {
  if (mode === "mend-key" && privateKeyPath !== null) {
    // IdentitiesOnly pins the deploy key even when an agent is running;
    // accept-new trusts a first-contact host, but still refuses a CHANGED key.
    return `ssh -i '${privateKeyPath}' -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o BatchMode=yes`;
  }
  if (mode === "bridge") {
    // Plain ssh: no -i, no IdentitiesOnly — the bridged agent's identities
    // are the point. accept-new mirrors mend-key: the signer's owner never
    // gets a chance to answer a host-key prompt on this machine.
    return "ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes";
  }
  // Ambient: the login user's ssh setup, composed with an existing
  // GIT_SSH_COMMAND rather than clobbering it (options-before-host is valid).
  // accept-new matches the other modes for the same reason BatchMode does:
  // a daemon has no terminal, so the owner can never answer a first-contact
  // host-key prompt through Mend — a server with an empty known_hosts (a
  // fresh pod) could otherwise never reach any remote. A CHANGED key still
  // refuses.
  const base = process.env["GIT_SSH_COMMAND"] ?? "ssh";
  return `${base} -o StrictHostKeyChecking=accept-new -o BatchMode=yes`;
};

/**
 * Env for every host-side remote git op: never prompt, ssh per `sshCommand`,
 * and for bridge mode the shared agent socket — the ONE place a signer is
 * chosen (`agentSocket` null means "whatever the ambient env already has").
 */
export const remoteGitEnv = (
  sshCommand: string,
  agentSocket: string | null = null,
): Record<string, string> => ({
  GIT_TERMINAL_PROMPT: "0",
  GIT_SSH_COMMAND: sshCommand,
  ...(agentSocket === null ? {} : { SSH_AUTH_SOCK: agentSocket }),
});

/**
 * ssh argv (options only — caller appends `-- host command`) for a workspace
 * git transport op resolved on the host: the same auth semantics as
 * `sshCommandFor`, as a vector because the host spawns ssh directly.
 * `SendEnv=GIT_PROTOCOL` lets protocol v2 negotiate through the tunnel.
 */
export const sshTransportArgs = (
  mode: GitAuthMode,
  privateKeyPath: string | null,
  port: number | null,
): ReadonlyArray<string> => [
  ...(mode === "mend-key" && privateKeyPath !== null
    ? ["-i", privateKeyPath, "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=accept-new"]
    : []),
  ...(mode === "bridge" ? ["-o", "StrictHostKeyChecking=accept-new"] : []),
  "-o",
  "BatchMode=yes",
  "-o",
  "SendEnv=GIT_PROTOCOL",
  ...(port === null ? [] : ["-p", String(port)]),
];

interface FailurePattern {
  readonly test: RegExp;
  readonly describe: (mode: GitAuthMode, match: RegExpMatchArray) => string;
}

const FAILURE_PATTERNS: ReadonlyArray<FailurePattern> = [
  {
    test: /Permission denied \(publickey|Permission denied, please try again|access denied|could not read Username|Authentication failed/i,
    describe: (mode) =>
      mode === "mend-key"
        ? "The remote refused the Mend key (permission denied). Add your Mend public key to your git account's SSH keys (or as a deploy key on this repository), then retry."
        : mode === "bridge"
          ? "The remote refused the connected signer's keys (permission denied). Check that the shared key is authorized on the git host — and that the agent you shared actually holds it (`ssh-add -l` on the sharing machine)."
          : "The remote refused this machine's credentials (permission denied). Mend uses your login user's git/ssh setup for this project — check that a plain `git ls-remote` works in a shell here.",
  },
  {
    test: /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i,
    // Every mode runs with accept-new, so only a CHANGED key can land here.
    describe: () =>
      "The remote's SSH host key changed since it was first trusted. Verify the server, remove the old entry from known_hosts, then retry.",
  },
  {
    test: /Could not resolve hostname ([^\s:]+)/i,
    describe: (_mode, match) => `Could not resolve the git host "${match[1] ?? ""}".`,
  },
  {
    test: /Connection refused/i,
    describe: () => "The git host refused the connection — is the server up and the port right?",
  },
  {
    test: /(Connection|Operation) timed out|Connection timed out during banner exchange/i,
    describe: () => "The connection to the git host timed out.",
  },
  {
    test: /(repository|project) ['"]?[^'"\n]*['"]? not found|does not appear to be a git repository|no such repository/i,
    describe: (mode) =>
      mode === "mend-key"
        ? "The remote reports no such repository — the path may be wrong, or the Mend key is not authorized for it."
        : "The remote reports no such repository — the path may be wrong, or this identity cannot see it.",
  },
];

/**
 * Turn a remote git failure's stderr into a readable sentence, or null when
 * nothing matched (callers then surface the stderr verbatim — an unknown
 * failure must never be flattened into a wrong explanation). The matched
 * stderr line rides along as the observed evidence.
 */
export const describeGitRemoteFailure = (stderr: string, mode: GitAuthMode): string | null => {
  for (const pattern of FAILURE_PATTERNS) {
    const match = stderr.match(pattern.test);
    if (match === null) continue;
    const line = stderr
      .split("\n")
      .map((candidate) => candidate.trim())
      .find((candidate) => candidate.match(pattern.test) !== null);
    const summary = pattern.describe(mode, match);
    return line === undefined ? summary : `${summary} (observed: ${line})`;
  }
  return null;
};
