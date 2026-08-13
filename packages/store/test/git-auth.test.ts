import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import {
  MendKeys,
  MendKeysConfig,
  MendKeysLive,
  describeGitRemoteFailure,
  remoteGitEnv,
  sshCommandFor,
} from "../src/git-auth.ts";

const withKeys = <A, E>(work: (root: string) => Effect.Effect<A, E, MendKeys>): Promise<A> => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mend-keys-test-"));
  const root = path.join(tmp, "keys");
  const layer = MendKeysLive.pipe(Layer.provide(MendKeysConfig.layerFor(root)));
  return Effect.runPromise(
    work(root).pipe(
      Effect.provide(layer),
      Effect.ensuring(Effect.sync(() => fs.rmSync(tmp, { recursive: true, force: true }))),
      Effect.orDie,
    ),
  );
};

describe("MendKeys", () => {
  it("generates once, reads back, private key stays 0600", async () => {
    await withKeys((root) =>
      Effect.gen(function* () {
        const keys = yield* MendKeys;

        // Nothing yet — read reports absence rather than creating.
        expect(yield* keys.read()).toBeNull();

        const created = yield* keys.ensure();
        expect(created.publicKey.startsWith("ssh-ed25519 ")).toBe(true);
        expect(created.fingerprint).toContain("ED25519");
        expect(created.privateKeyPath).toBe(path.join(root, "id_ed25519"));
        const mode = fs.statSync(created.privateKeyPath).mode & 0o777;
        expect(mode).toBe(0o600);

        // Idempotent: a second ensure returns the same key, not a new one.
        const again = yield* keys.ensure();
        expect(again.publicKey).toBe(created.publicKey);

        const read = yield* keys.read();
        expect(read?.publicKey).toBe(created.publicKey);
      }),
    );
  });
});

describe("sshCommandFor", () => {
  it("ambient adds BatchMode to the user's ssh", () => {
    expect(sshCommandFor("ambient", null)).toContain("-o BatchMode=yes");
  });

  it("mend-key pins the identity and accepts first-contact hosts", () => {
    const command = sshCommandFor("mend-key", "/home/user/.mend/keys/id_ed25519");
    expect(command).toContain("-i '/home/user/.mend/keys/id_ed25519'");
    expect(command).toContain("IdentitiesOnly=yes");
    expect(command).toContain("StrictHostKeyChecking=accept-new");
    expect(command).toContain("BatchMode=yes");
  });

  it("remoteGitEnv never prompts", () => {
    expect(remoteGitEnv("ssh")["GIT_TERMINAL_PROMPT"]).toBe("0");
  });
});

describe("describeGitRemoteFailure", () => {
  it("names permission denied per mode", () => {
    const stderr =
      "git@gitlab.com: Permission denied (publickey).\nfatal: Could not read from remote repository.";
    expect(describeGitRemoteFailure(stderr, "ambient")).toContain("login user's git/ssh setup");
    expect(describeGitRemoteFailure(stderr, "mend-key")).toContain("deploy key");
    expect(describeGitRemoteFailure(stderr, "mend-key")).toContain("Permission denied (publickey)");
  });

  it("names untrusted host keys", () => {
    const described = describeGitRemoteFailure("Host key verification failed.", "ambient");
    expect(described).toContain("host key is not trusted");
  });

  it("names unresolvable hosts", () => {
    const described = describeGitRemoteFailure(
      "ssh: Could not resolve hostname gitlab.example.internal: Name or service not known",
      "ambient",
    );
    expect(described).toContain('"gitlab.example.internal"');
  });

  it("stays silent on unknown failures — verbatim stderr must win", () => {
    expect(
      describeGitRemoteFailure("fatal: the remote end hung up unexpectedly", "ambient"),
    ).toBeNull();
  });
});
