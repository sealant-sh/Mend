import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  probeServerRegistry,
  type ServerRegistryProbeInput,
  type ServerRegistryProbeRuntime,
} from "./server-registry-probe.ts";
import type { ServerProcessOutput } from "./server-runtime.ts";

const nonce = "0123456789abcdef".repeat(3);
const imageId = `sha256:${"a".repeat(64)}`;
const otherId = `sha256:${"b".repeat(64)}`;
const reference = `127.0.0.1:5123/mend-registry-probe/${nonce}:probe`;
const ok = (stdout = ""): ServerProcessOutput => ({ status: 0, stdout, stderr: "" });
const denied = (stderr = "connection refused"): ServerProcessOutput => ({
  status: 1,
  stdout: "",
  stderr,
});
const directories: string[] = [];

const makeInput = async (): Promise<ServerRegistryProbeInput> => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "mend probe tests "));
  directories.push(temporaryDirectory);
  return { dockerContext: "isolated-context", registryPort: 5123, nonce, temporaryDirectory };
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

interface Image {
  readonly Id: string;
  readonly Config: { readonly Labels: Record<string, string> };
}
const image = (id = imageId, owner = nonce): Image => ({
  Id: id,
  Config: { Labels: { "dev.sealant.mend.registry-probe": owner } },
});

// The local tag is distinct from the registry copy; pull cannot succeed until push has stored it.
class DockerRegistry implements ServerRegistryProbeRuntime {
  readonly local = new Map<string, Image>();
  readonly remote = new Map<string, Image>();
  readonly calls: Array<{ readonly args: ReadonlyArray<string>; readonly timeoutMs: number }> = [];
  readonly archives: Buffer[] = [];
  readonly temporaryFiles: string[] = [];
  response: (args: ReadonlyArray<string>, timeoutMs: number) => ServerProcessOutput | undefined =
    () => undefined;

  async run(
    command: string,
    args: ReadonlyArray<string>,
    options: { readonly timeoutMs: number },
  ): Promise<ServerProcessOutput> {
    expect(command).toBe("docker");
    expect(args.slice(0, 3)).toEqual(["--context", "isolated-context", "image"]);
    expect(options.timeoutMs).toBeGreaterThan(0);
    expect(options.timeoutMs).toBeLessThanOrEqual(60_000);
    this.calls.push({ args, timeoutMs: options.timeoutMs });
    const replacement = this.response(args, options.timeoutMs);
    if (replacement !== undefined) return replacement;
    const operation = args[3];
    const ref = args.at(-1) ?? "";
    if (operation === "ls") {
      const exactRef = args[args.indexOf("--filter") + 1]?.slice("reference=".length) ?? "";
      const found = this.local.get(exactRef);
      return ok(found === undefined ? "" : JSON.stringify(found.Id));
    }
    if (operation === "import") {
      const file = args.at(-2) ?? "";
      const archive = await fs.readFile(file);
      expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
      this.temporaryFiles.push(file);
      this.archives.push(archive);
      const label = args[args.indexOf("--change") + 1] ?? "";
      const probeNonce = label.split("=")[1] ?? "";
      this.local.set(ref, image(imageId, probeNonce));
      return ok(imageId);
    }
    if (operation === "inspect") {
      const found = this.local.get(args[4] ?? "");
      return found === undefined ? denied("No such image") : ok(JSON.stringify(found));
    }
    if (operation === "push") {
      const found = this.local.get(ref);
      if (found === undefined) return denied("No local tag");
      this.remote.set(ref, found);
      return ok();
    }
    if (operation === "rm") {
      if (!this.local.delete(ref)) return denied("No local tag");
      return ok();
    }
    if (operation === "pull") {
      expect(this.local.has(ref)).toBe(false);
      const found = this.remote.get(ref);
      if (found === undefined) return denied("Registry manifest missing");
      this.local.set(ref, found);
      return ok();
    }
    throw new Error(`Unexpected operation ${operation}`);
  }
}

describe("Engine loopback registry probe", () => {
  it("imports a valid tiny ustar, pushes, removes, pulls and compares the observed ID", async () => {
    const input = await makeInput();
    const daemon = new DockerRegistry();
    daemon.local.set("unrelated:keep", image(otherId, "other-owner"));
    expect(await probeServerRegistry(daemon, input)).toEqual({
      _tag: "ok",
      value: { reference, imageId },
      cleanupWarnings: [],
    });
    expect([...daemon.local.keys()]).toEqual(["unrelated:keep"]);
    expect([...daemon.remote.keys()]).toEqual([reference]);
    expect(await fs.readdir(input.temporaryDirectory)).toEqual([]);
    expect(
      daemon.calls
        .filter(({ args }) => ["import", "push", "rm", "pull"].includes(args[3] ?? ""))
        .map(({ args }) => args[3]),
    ).toEqual(["import", "push", "rm", "pull", "rm"]);
    const archive = daemon.archives[0];
    expect(archive).toBeDefined();
    if (archive === undefined) return;
    expect(archive.length).toBe(2048);
    expect(archive.toString("ascii", 257, 263)).toBe("ustar\0");
    const expectedChecksum = Number.parseInt(archive.toString("ascii", 148, 154), 8);
    const header = Buffer.from(archive.subarray(0, 512));
    header.fill(32, 148, 156);
    expect(header.reduce((sum, byte) => sum + byte, 0)).toBe(expectedChecksum);
    const size = Number.parseInt(archive.toString("ascii", 124, 135), 8);
    expect(archive.toString("utf8", 512, 512 + size)).toBe(
      `Mend registry connectivity probe ${nonce}\n`,
    );
    expect(archive.subarray(1024).equals(Buffer.alloc(1024))).toBe(true);
  });

  it.each(["import", "push", "rm", "pull", "inspect"])(
    "returns primary %s failure and removes only the owned tag/files",
    async (operation) => {
      const input = await makeInput();
      const daemon = new DockerRegistry();
      daemon.local.set("unrelated:keep", image(otherId));
      daemon.response = (args, timeout) =>
        args[3] === operation && timeout === 60_000 ? denied(`${operation} failed`) : undefined;
      const result = await probeServerRegistry(daemon, input);
      expect(result).toMatchObject({
        _tag: "error",
        error: {
          stage: operation === "rm" ? "remove-local" : operation,
          diagnostic: `${operation} failed`,
        },
        cleanupWarnings: [],
      });
      expect([...daemon.local.keys()]).toEqual(["unrelated:keep"]);
      expect(await fs.readdir(input.temporaryDirectory)).toEqual([]);
    },
  );

  it("cleans up an import that created a tag but reported failure", async () => {
    const daemon = new DockerRegistry();
    daemon.response = (args) => {
      if (args[3] !== "import") return undefined;
      daemon.local.set(reference, image());
      return denied("import stream interrupted");
    };
    const result = await probeServerRegistry(daemon, await makeInput());
    expect(result).toMatchObject({
      _tag: "error",
      error: { stage: "import" },
      cleanupWarnings: [],
    });
    expect(daemon.local.size).toBe(0);
  });

  it("preserves primary diagnostics when image cleanup also fails", async () => {
    const input = await makeInput();
    const daemon = new DockerRegistry();
    daemon.response = (args) =>
      args[3] === "push" ? denied("Engine loopback unreachable") : undefined;
    const originalResponse = daemon.response;
    daemon.response = (args, timeout) =>
      timeout === 15_000 ? denied("cleanup permission denied") : originalResponse(args, timeout);
    expect(await probeServerRegistry(daemon, input)).toMatchObject({
      _tag: "error",
      error: { stage: "push", diagnostic: "Engine loopback unreachable" },
      cleanupWarnings: [{ stage: "cleanup", diagnostic: "cleanup permission denied" }],
    });
    expect(await fs.readdir(input.temporaryDirectory)).toEqual([]);
    expect(daemon.local.has(reference)).toBe(true);
  });

  it("reports cleanup warnings alongside an observed successful roundtrip", async () => {
    const daemon = new DockerRegistry();
    daemon.response = (args, timeout) =>
      timeout === 15_000 && args[3] === "rm" ? denied("image busy") : undefined;
    expect(await probeServerRegistry(daemon, await makeInput())).toMatchObject({
      _tag: "ok",
      value: { imageId },
      cleanupWarnings: [{ stage: "cleanup" }],
    });
  });

  it("refuses an existing probe reference without import, deletion, or filesystem allocation", async () => {
    const input = await makeInput();
    const daemon = new DockerRegistry();
    daemon.local.set(reference, image(otherId));
    expect(await probeServerRegistry(daemon, input)).toMatchObject({
      _tag: "error",
      error: { stage: "collision-check" },
    });
    expect(daemon.calls).toHaveLength(1);
    expect(daemon.local.get(reference)?.Id).toBe(otherId);
    expect(await fs.readdir(input.temporaryDirectory)).toEqual([]);
  });

  it.each(["denied", "malformed", "rejected"])(
    "an inconclusive %s image listing is not absence",
    async (kind) => {
      const daemon = new DockerRegistry();
      daemon.response = () => {
        if (kind === "rejected") throw new Error("secret should not leak");
        return kind === "denied" ? denied("permission denied") : ok("not JSON");
      };
      const result = await probeServerRegistry(daemon, await makeInput());
      expect(result).toMatchObject({ _tag: "error", error: { stage: "collision-check" } });
      expect(JSON.stringify(result)).not.toContain("secret should not leak");
      expect(daemon.calls).toHaveLength(1);
    },
  );

  it.each(["id", "owner", "malformed"])(
    "fails on %s mismatch after pull and retains images whose ownership is unknown",
    async (kind) => {
      const daemon = new DockerRegistry();
      let pulled = false;
      daemon.response = (args) => {
        if (args[3] === "pull") {
          daemon.local.set(reference, image(otherId, kind === "owner" ? "another-owner" : nonce));
          pulled = true;
          return ok();
        }
        if (kind === "malformed" && pulled && args[3] === "inspect") return ok("{}");
        return undefined;
      };
      expect(await probeServerRegistry(daemon, await makeInput())).toMatchObject({
        _tag: "error",
        error: { stage: "inspect" },
      });
      expect(daemon.local.has(reference)).toBe(kind !== "id");
    },
  );

  it("does not claim pull success if removal leaves the tag locally", async () => {
    const daemon = new DockerRegistry();
    daemon.response = (args) => (args[3] === "rm" ? ok() : undefined);
    expect(await probeServerRegistry(daemon, await makeInput())).toMatchObject({
      _tag: "error",
      error: { stage: "remove-local" },
    });
    expect(daemon.calls.some(({ args }) => args[3] === "pull")).toBe(false);
  });

  it("handles filesystem failures without known-failure rejection or image mutation", async () => {
    const input = await makeInput();
    const daemon = new DockerRegistry();
    expect(
      await probeServerRegistry(daemon, {
        ...input,
        temporaryDirectory: path.join(input.temporaryDirectory, "missing"),
      }),
    ).toMatchObject({ _tag: "error", error: { stage: "temporary-files" } });
    expect(daemon.calls).toHaveLength(1);
  });

  it("rejects unsafe nonce, port and context inputs before Docker", async () => {
    const input = await makeInput();
    const daemon = new DockerRegistry();
    for (const invalid of [
      { nonce: "../secret" },
      { registryPort: 0 },
      { registryPort: 65536 },
      { registryPort: 1.5 },
      { dockerContext: "" },
    ]) {
      expect(await probeServerRegistry(daemon, { ...input, ...invalid })).toMatchObject({
        _tag: "error",
        error: { stage: "input" },
      });
    }
    expect(daemon.calls).toEqual([]);
  });

  it("keeps useful Docker diagnostics but scrubs credentials and control bytes", async () => {
    const daemon = new DockerRegistry();
    daemon.response = (args) =>
      args[3] === "push"
        ? denied(
            "proxy http://user:pass@proxy.invalid refused\n token=secret Authorization=opaque Bearer abc\u001b[31m",
          )
        : undefined;
    const result = await probeServerRegistry(daemon, await makeInput());
    expect(result._tag).toBe("error");
    if (result._tag === "ok") return;
    expect(result.error.diagnostic).toContain("proxy http://[redacted]@proxy.invalid refused");
    expect(result.error.diagnostic).not.toMatch(/user:pass|secret|opaque|abc/);
    expect(result.error.diagnostic).not.toContain(String.fromCharCode(27));
    expect(result.error.message).toContain("Do not widen the registry binding");
  });

  it("different generated nonces produce different archives and registry namespaces", async () => {
    const input = await makeInput();
    const daemon = new DockerRegistry();
    for (let index = 0; index < 12; index += 1) {
      const fresh = createHash("sha256").update(`probe-${index}`).digest("hex");
      expect((await probeServerRegistry(daemon, { ...input, nonce: fresh }))._tag).toBe("ok");
    }
    expect(
      new Set(daemon.archives.map((archive) => createHash("sha256").update(archive).digest("hex")))
        .size,
    ).toBe(12);
    expect(daemon.remote.size).toBe(12);
    expect(daemon.local.size).toBe(0);
  });
});
