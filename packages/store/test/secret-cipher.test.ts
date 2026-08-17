import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { Effect, Layer } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { MendKeysConfig } from "../src/git-auth.ts";
import { SecretCipher, SecretCipherError, SecretCipherLive } from "../src/secret-cipher.ts";

const roots: Array<string> = [];
const freshRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mend-secret-cipher-"));
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const withCipher = <A, E>(
  root: string,
  use: (cipher: typeof SecretCipher.Service) => Effect.Effect<A, E>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cipher = yield* SecretCipher;
      return yield* use(cipher);
    }).pipe(Effect.provide(SecretCipherLive.pipe(Layer.provide(MendKeysConfig.layerFor(root))))),
  );

const decryptFailure = (input: string, keyRoot: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cipher = yield* SecretCipher;
      return yield* cipher.decrypt(input).pipe(Effect.flip);
    }).pipe(Effect.provide(SecretCipherLive.pipe(Layer.provide(MendKeysConfig.layerFor(keyRoot))))),
  );

describe("SecretCipher", () => {
  it("round-trips, generates a 0600 key on first use, and never stores plaintext", async () => {
    const root = freshRoot();
    const sealed = await withCipher(root, (c) => c.encrypt("postgres://u:hunter2@h/db"));
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain("hunter2");
    const keyFile = path.join(root, "secrets.key");
    expect(fs.statSync(keyFile).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(keyFile).length).toBe(32);
    const plain = await withCipher(root, (c) => c.decrypt(sealed));
    expect(plain).toBe("postgres://u:hunter2@h/db");
  });

  it("produces distinct ciphertexts for the same plaintext (fresh IV)", async () => {
    const root = freshRoot();
    const a = await withCipher(root, (c) => c.encrypt("same"));
    const b = await withCipher(root, (c) => c.encrypt("same"));
    expect(a).not.toBe(b);
  });

  it("refuses tampered or foreign-key ciphertext with a typed decrypt error", async () => {
    const root = freshRoot();
    const sealed = await withCipher(root, (c) => c.encrypt("value"));
    const tampered = await decryptFailure(`${sealed.slice(0, -2)}AA`, root);
    expect(tampered).toBeInstanceOf(SecretCipherError);
    expect(tampered.operation).toBe("decrypt");
    const foreign = await decryptFailure(sealed, freshRoot());
    expect(foreign.operation).toBe("decrypt");
    const garbage = await decryptFailure("garbage", root);
    expect(garbage.operation).toBe("decrypt");
  });
});
