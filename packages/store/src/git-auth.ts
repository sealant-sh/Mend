import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { GitAuthMode } from "@mend/domain/workbench";
import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";

/**
 * Host-side git authentication (docs/GIT-ACCESS.md): the one seam every
 * remote git operation resolves its credential through. Two modes today —
 * `ambient` (the login user's ssh setup, unchanged) and `mend-key` (the
 * machine's Mend-generated deploy key). The same seam later resolves per-user
 * keys or a connected agent bridge; nothing outside this file decides how a
 * remote is reached.
 */

/** `ssh-keygen` could not run or exited nonzero. */
export class KeygenError extends Schema.TaggedErrorClass<KeygenError>()("KeygenError", {
  stderr: Schema.String,
}) {}

export interface MendKeyInfo {
  /** OpenSSH public key line — what the user pastes as a deploy key. */
  readonly publicKey: string;
  /** `ssh-keygen -lf` output: size, hash, comment, type. */
  readonly fingerprint: string;
  /** Absolute private key path on this host; never leaves it. */
  readonly privateKeyPath: string;
}

/** Where the machine's Mend key lives. Overridable for tests only. */
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
    root: process.env["MEND_KEYS_ROOT"] ?? path.join(os.homedir(), ".mend", "keys"),
  })),
);

/**
 * The machine's Mend deploy key: ed25519, generated on this host, private
 * half 0600 and never copied anywhere — not into workspaces, not into the DB.
 * The public half is what the UI/CLI hand out with "add this as a deploy key".
 */
export class MendKeys extends Context.Service<
  MendKeys,
  {
    /** Generate the keypair if missing (first mend-key project), then describe it. */
    readonly ensure: () => Effect.Effect<MendKeyInfo, KeygenError>;
    /** Describe the key without creating it; null when none was generated yet. */
    readonly read: () => Effect.Effect<MendKeyInfo | null, KeygenError>;
  }
>()("@mend/store/MendKeys") {}

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
    const privateKeyPath = path.join(config.root, "id_ed25519");
    const publicKeyPath = `${privateKeyPath}.pub`;

    const describe = Effect.fn("MendKeys.describe")(function* () {
      const publicKey = yield* Effect.sync(() =>
        fs.readFileSync(publicKeyPath, "utf8").trimEnd(),
      ).pipe(Effect.orDie);
      const fingerprint = yield* sshKeygen(["-lf", publicKeyPath]);
      return { publicKey, fingerprint, privateKeyPath };
    });

    const ensure = Effect.fn("MendKeys.ensure")(function* () {
      if (!fs.existsSync(privateKeyPath)) {
        yield* Effect.sync(() => fs.mkdirSync(config.root, { recursive: true, mode: 0o700 }));
        const comment = `mend@${os.hostname()}`;
        yield* sshKeygen(["-q", "-t", "ed25519", "-N", "", "-C", comment, "-f", privateKeyPath]);
        // ssh-keygen already writes 0600/0644; pin it anyway — the whole mode rests on this.
        yield* Effect.sync(() => fs.chmodSync(privateKeyPath, 0o600));
      }
      return yield* describe();
    });

    const read = Effect.fn("MendKeys.read")(function* () {
      if (!fs.existsSync(publicKeyPath)) return null;
      return yield* describe();
    });

    return { ensure, read };
  }),
);

/**
 * The ssh command for a remote git operation under `mode`, as a
 * `GIT_SSH_COMMAND` value (sh-parsed by git). Both modes force BatchMode: a
 * daemon has no terminal, so "hang on a prompt" becomes "fail with the reason
 * on stderr" — which the API layer turns readable via `describeGitRemoteFailure`.
 */
export const sshCommandFor = (mode: GitAuthMode, privateKeyPath: string | null): string => {
  if (mode === "mend-key" && privateKeyPath !== null) {
    // IdentitiesOnly pins the deploy key even when an agent is running;
    // accept-new trusts a first-contact host, but still refuses a CHANGED key.
    return `ssh -i '${privateKeyPath}' -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o BatchMode=yes`;
  }
  // Ambient: the login user's ssh setup unchanged — compose with an existing
  // GIT_SSH_COMMAND rather than clobbering it (options-before-host is valid).
  const base = process.env["GIT_SSH_COMMAND"] ?? "ssh";
  return `${base} -o BatchMode=yes`;
};

/** Env for every host-side remote git op: never prompt, ssh per `sshCommand`. */
export const remoteGitEnv = (sshCommand: string): Record<string, string> => ({
  GIT_TERMINAL_PROMPT: "0",
  GIT_SSH_COMMAND: sshCommand,
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
        ? "The remote refused the Mend key (permission denied). Add the project's Mend public key as a deploy key on the git host, then retry."
        : "The remote refused this machine's credentials (permission denied). Mend uses your login user's git/ssh setup for this project — check that a plain `git ls-remote` works in a shell here.",
  },
  {
    test: /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i,
    describe: (mode) =>
      mode === "mend-key"
        ? "The remote's SSH host key changed since it was first trusted. Verify the server, remove the old entry from known_hosts, then retry."
        : "The remote's SSH host key is not trusted (host key verification failed). Connect once from a shell to accept it, then retry.",
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
