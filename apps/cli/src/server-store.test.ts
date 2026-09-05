import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { withServerStore, type ServerFiles, type ServerStore } from "./server-store.ts";

const roots: Array<string> = [];
const children: Array<ChildProcess> = [];
const temporary = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mend store "));
  roots.push(root);
  return root;
};
const fixture = fileURLToPath(new URL("../test-fixtures/server-child.mjs", import.meta.url));
const launch = (args: ReadonlyArray<string>, limited = false) => {
  const nodeArgs = ["--experimental-strip-types", fixture, ...args];
  const child = limited
    ? spawn("bash", [
        "-c",
        'ulimit -c 0; ulimit -f 1; exec "$@"',
        "bash",
        process.execPath,
        ...nodeArgs,
      ])
    : spawn(process.execPath, nodeArgs);
  children.push(child);
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const done = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return { child, done };
};
const waitFor = async (file: string): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (!fs.existsSync(file)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${file}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
const activeDirectory = (root: string): string => fs.realpathSync(path.join(root, "active"));
const identityAt = (root: string): string =>
  fs.readFileSync(path.join(root, "identity.env"), "utf8");
const files: ServerFiles = {
  identity: "original identity\n",
  config: "original config\n",
  env: "original env\n",
  compose: "original compose\n",
  postgresInit: "original init\n",
};

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = new Promise((resolve) => child.once("close", resolve));
      child.kill("SIGKILL");
      await closed;
    }
  }
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("server filesystem transactions", () => {
  it("retains generations, reuses identical files, and refuses to overwrite identity", async () => {
    const root = temporary();
    const result = await withServerStore(root, async (store) => {
      const first = store.commit(files);
      expect(first._tag).toBe("ok");
      expect(store.commit(files)).toEqual(first);
      const second = store.commit({ ...files, config: "changed config" });
      expect(second._tag).toBe("ok");
      expect(second).not.toEqual(first);
      expect(store.commit({ ...files, identity: "replacement" })).toMatchObject({ _tag: "error" });
      expect(identityAt(root)).toBe(files.identity);
      if (first._tag === "ok") {
        expect(fs.readFileSync(path.join(first.value.directory, "server.json"), "utf8")).toBe(
          files.config,
        );
      }
      expect(fs.readdirSync(path.join(root, "generations"))).toHaveLength(2);
    });
    expect(result._tag).toBe("ok");
    expect(fs.existsSync(path.join(root, "server.lock"))).toBe(false);
  });

  it.each([false, true])(
    "survives process loss after a kernel-limited partial write, prior active=%s",
    async (hasActive) => {
      const root = temporary();
      if (hasActive) {
        const result = await withServerStore(root, async (store) => store.commit(files));
        expect(result).toMatchObject({ _tag: "ok", value: { _tag: "ok" } });
      }
      const previous = hasActive ? activeDirectory(root) : null;
      const failed = await launch([root, "oversized-generation"], true).done;
      expect(failed.signal).toBe("SIGKILL");
      expect(identityAt(root)).toBe(files.identity);
      expect(fs.existsSync(path.join(root, "active"))).toBe(hasActive);
      if (previous !== null) {
        expect(activeDirectory(root)).toBe(previous);
        expect(fs.readFileSync(path.join(previous, "server.env"), "utf8")).toBe(files.env);
      }
      const generations = fs.readdirSync(path.join(root, "generations"));
      expect(generations).toHaveLength(hasActive ? 2 : 1);
      const partial = generations
        .map((name) => path.join(root, "generations", name))
        .find((directory) => directory !== previous);
      expect(partial).toBeDefined();
      if (partial !== undefined) {
        expect(fs.readFileSync(path.join(partial, "server.json"), "utf8")).toBe("new config\n");
        expect(fs.statSync(path.join(partial, "server.env")).size).toBeGreaterThan(0);
        expect(fs.statSync(path.join(partial, "server.env")).size).toBeLessThan(1024 * 1024);
        expect(fs.existsSync(path.join(partial, "compose.yaml"))).toBe(false);
      }
      const locked = await withServerStore(root, async () => {
        throw new Error("must not enter");
      });
      expect(locked).toMatchObject({ _tag: "error" });
      if (locked._tag === "error") expect(locked.error.message).toContain("may be stale");
      // Explicit operator recovery after the child has exited. Nothing in production steals it.
      fs.renameSync(path.join(root, "server.lock"), path.join(root, "recovered.lock"));
      const recovered = await withServerStore(root, async (store) => {
        expect(store.readIdentity()).toEqual({ _tag: "ok", value: files.identity });
        expect(store.commit(files)._tag).toBe("ok");
      });
      expect(recovered._tag).toBe("ok");
      expect(identityAt(root)).toBe(files.identity);
      expect(fs.readdirSync(path.join(root, "generations"))).toHaveLength(2);
    },
  );

  it("releases only its own lock and invalidates escaped store handles", async () => {
    const root = temporary();
    let escaped: ServerStore | undefined;
    const result = await withServerStore(root, async (store) => {
      escaped = store;
      const lock = path.join(root, "server.lock");
      fs.renameSync(lock, path.join(root, "original.lock"));
      fs.mkdirSync(lock);
      fs.writeFileSync(path.join(lock, "owner.json"), "replacement-owner");
      expect(store.commit(files)._tag).toBe("error");
    });
    expect(result._tag).toBe("error");
    if (result._tag === "error") expect(result.error.message).toContain("ownership was lost");
    expect(fs.readFileSync(path.join(root, "server.lock", "owner.json"), "utf8")).toBe(
      "replacement-owner",
    );
    expect(escaped?.readActive()._tag).toBe("error");
  });

  it("releases its lock when the callback fails and refuses missing identity or corrupt pointers", async () => {
    const root = temporary();
    expect(
      await withServerStore(root, async () => {
        throw new Error("failed command");
      }),
    ).toMatchObject({ _tag: "error" });
    expect(fs.existsSync(path.join(root, "server.lock"))).toBe(false);
    expect(await withServerStore(root, async (store) => store.commit(files))).toMatchObject({
      _tag: "ok",
      value: { _tag: "ok" },
    });
    fs.unlinkSync(path.join(root, "identity.env"));
    expect(
      await withServerStore(root, async (store) => ({
        commit: store.commit(files),
        read: store.readActive(),
      })),
    ).toMatchObject({
      _tag: "ok",
      value: { commit: { _tag: "error" }, read: { _tag: "error" } },
    });
    fs.unlinkSync(path.join(root, "active"));
    fs.symlinkSync("../../elsewhere", path.join(root, "active"));
    expect(await withServerStore(root, async (store) => store.readActive())).toMatchObject({
      _tag: "ok",
      value: { _tag: "error" },
    });
  });
});

describe("setup across processes", () => {
  it("excludes contenders before state creation, during Compose, and through health, then reuses credentials", async () => {
    const root = temporary();
    const rendezvous = temporary();
    const first = launch([root, "setup", rendezvous]);
    for (const phase of ["context", "compose", "health"]) {
      await waitFor(path.join(rendezvous, phase));
      const contender = await launch([root]).done;
      expect(contender.code).toBe(1);
      expect(contender.stdout).toContain("is still live");
      expect(contender.stdout).toContain("Never remove a live lock");
      if (phase === "context") expect(fs.existsSync(path.join(root, "identity.env"))).toBe(false);
      fs.writeFileSync(path.join(rendezvous, `release-${phase}`), "go");
    }
    expect((await first.done).code).toBe(0);
    const identity = identityAt(root);
    const generation = activeDirectory(root);
    const rerun = await launch([root]).done;
    expect(rerun.code).toBe(0);
    expect(identityAt(root)).toBe(identity);
    expect(activeDirectory(root)).toBe(generation);
    expect(fs.existsSync(path.join(root, "server.lock"))).toBe(false);
  });

  it("retains saved credentials when Compose fails and on retry", async () => {
    const root = temporary();
    const failed = await launch([root, "compose-failure"]).done;
    expect(failed.code).toBe(1);
    const identity = identityAt(root);
    const generation = activeDirectory(root);
    expect((await launch([root]).done).code).toBe(0);
    expect(identityAt(root)).toBe(identity);
    expect(activeDirectory(root)).toBe(generation);
  });

  it("does not steal a killed setup's lock, and manual recovery keeps its active identity", async () => {
    const root = temporary();
    const rendezvous = temporary();
    fs.writeFileSync(path.join(rendezvous, "release-context"), "go");
    const first = launch([root, "setup", rendezvous]);
    await waitFor(path.join(rendezvous, "compose"));
    const identity = identityAt(root);
    const generation = activeDirectory(root);
    first.child.kill("SIGKILL");
    expect((await first.done).signal).toBe("SIGKILL");
    expect((await launch([root]).done).stdout).toContain("may be stale");
    expect(identityAt(root)).toBe(identity);
    fs.renameSync(path.join(root, "server.lock"), path.join(root, "recovered.lock"));
    expect((await launch([root]).done).code).toBe(0);
    expect(identityAt(root)).toBe(identity);
    expect(activeDirectory(root)).toBe(generation);
  });
});
