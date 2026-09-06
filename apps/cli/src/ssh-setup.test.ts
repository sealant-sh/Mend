import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import * as fs from "node:fs";
import { createServer } from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { parseWorkspaceSshTarget, workspaceSshPublicKeyFingerprint } from "@mend/workspace-ssh";
import { expect, it } from "vitest";

const runSshCommand = async (home: string, url: string, args: ReadonlyArray<string>) => {
  const child = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      fileURLToPath(new URL("./main.ts", import.meta.url)),
      "ssh",
      ...args,
    ],
    {
      cwd: home,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: path.join(home, "config"),
        MEND_URL: url,
        MEND_TOKEN: "test-token",
        SSH_AUTH_SOCK: "",
        SSH_ASKPASS_REQUIRE: "never",
      },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const [code] = await once(child, "exit");
  return { code, stdout, stderr };
};

it("mend ssh setup/status reconcile real OpenSSH config without claiming host trust or rotating keys", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mend-ssh-cli-test-"));
  const keys: Array<{ fingerprint: string }> = [];
  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.method === "GET" && request.url === "/api/workspace-ssh") {
      response.end(
        JSON.stringify({
          gateway: { host: "0.0.0.0", port: 22444, usernamePrefix: "workspace" },
          keys,
        }),
      );
      return;
    }
    if (request.method === "POST" && request.url === "/api/workspace-ssh/keys") {
      let body = "";
      for await (const chunk of request) body += String(chunk);
      const parsed: unknown = JSON.parse(body);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("publicKey" in parsed) ||
        typeof parsed.publicKey !== "string"
      ) {
        response.writeHead(400).end();
        return;
      }
      const fingerprint = workspaceSshPublicKeyFingerprint(parsed.publicKey);
      if (!fingerprint.ok) {
        response.writeHead(400).end();
        return;
      }
      const key = { fingerprint: fingerprint.value };
      if (!keys.some((existing) => existing.fingerprint === key.fingerprint)) keys.push(key);
      response.end(JSON.stringify(key));
      return;
    }
    response.writeHead(404).end();
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Missing test port");
    const url = `http://127.0.0.1:${address.port}`;
    const configFile = path.join(home, ".ssh", "config");
    const knownHosts = path.join(home, ".ssh", "known_hosts");
    fs.mkdirSync(path.dirname(configFile));
    const original = "Port 22\nHost *\n HostName wrong-host\nHost unrelated\n User git\n";
    fs.writeFileSync(configFile, original);
    fs.writeFileSync(knownHosts, "fixture known_hosts contents must not change\n");
    const privatePath = path.join(home, 'key space %Z "quote"');
    const generated = spawnSync(
      "ssh-keygen",
      ["-q", "-t", "ed25519", "-N", "", "-f", privatePath],
      { encoding: "utf8", timeout: 5_000 },
    );
    expect(generated.status, generated.stderr).toBe(0);
    const bytes = fs.readFileSync(privatePath);
    const setup = await runSshCommand(home, url, ["setup", "--key", path.basename(privatePath)]);
    expect(setup.code, setup.stderr + setup.stdout).toBe(0);
    expect(setup.stdout).toContain("host trust      not checked");
    expect(setup.stdout).not.toContain("SSH is ready");
    const config = fs.readFileSync(configFile, "utf8");
    expect(config.endsWith(original)).toBe(true);
    const target = parseWorkspaceSshTarget({ serverUrl: url, publishedPort: 22444 });
    if (!target.ok) throw target.error;
    const effective = spawnSync("ssh", ["-G", "-F", configFile, target.value.alias], {
      encoding: "utf8",
      timeout: 5_000,
    });
    expect(effective.status, effective.stderr).toBe(0);
    expect(effective.stdout).toContain("hostname 127.0.0.1\n");
    expect(effective.stdout).toContain("port 22444\n");
    const status = await runSshCommand(home, url, ["status"]);
    expect(status.code, status.stderr + status.stdout).toBe(0);
    expect(status.stdout).toContain("registered");
    expect(status.stdout).toContain("host trust      not checked");
    expect(status.stdout).not.toContain("missing or stale");
    const rerun = await runSshCommand(home, url, ["setup"]);
    expect(rerun.code, rerun.stderr + rerun.stdout).toBe(0);
    expect(fs.readFileSync(configFile, "utf8")).toBe(config);
    expect(fs.readFileSync(privatePath)).toEqual(bytes);
    expect(keys).toHaveLength(1);
    fs.unlinkSync(privatePath);
    const missing = await runSshCommand(home, url, ["status"]);
    expect(missing.code).toBe(1);
    expect(missing.stdout).toContain(
      "no usable matching private material or unlocked agent identity",
    );
    const failedSetup = await runSshCommand(home, url, ["setup"]);
    expect(failedSetup.code).toBe(1);
    expect(keys).toHaveLength(1);
    expect(fs.readFileSync(configFile, "utf8")).toBe(config);
    expect(fs.readFileSync(knownHosts, "utf8")).toBe(
      "fixture known_hosts contents must not change\n",
    );
  } finally {
    const closed = once(server, "close");
    server.close();
    await closed;
    fs.rmSync(home, { recursive: true, force: true });
  }
}, 20_000);
