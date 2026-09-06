import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { parseWorkspaceSshTarget, workspaceSshPublicKeyFingerprint } from "@mend/workspace-ssh";
import { expect, it, vi } from "vitest";

import { runWorkspaceSshSetup, workspaceSshReadiness } from "./workspace-ssh.js";

it("the VS Code adapter configures the selected server and rejects an unusable client key", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mend-vscode-ssh-test-"));
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  vi.stubEnv("XDG_CONFIG_HOME", path.join(home, "config"));
  vi.stubEnv("SSH_AUTH_SOCK", "");
  const registered: Array<{ sshKeyId: string; name: string; fingerprint: string }> = [];
  const ensureKey = async (publicKey: string, name: string): Promise<void> => {
    const fingerprint = workspaceSshPublicKeyFingerprint(publicKey);
    if (!fingerprint.ok) throw fingerprint.error;
    registered.push({ sshKeyId: "test-key", name, fingerprint: fingerprint.value });
  };
  try {
    const target = parseWorkspaceSshTarget({
      serverUrl: "https://mend.example.test",
      publishedPort: 22444,
    });
    if (!target.ok) throw target.error;
    const configFile = path.join(home, ".ssh", "config");
    const knownHostsFile = path.join(home, ".ssh", "known_hosts");
    fs.mkdirSync(path.dirname(configFile));
    fs.writeFileSync(configFile, "Host *\n HostName wrong-host\n Port 22\n");
    fs.writeFileSync(knownHostsFile, "fixture host-trust entry\n");
    await runWorkspaceSshSetup(target.value, ensureKey);
    const view = {
      gateway: { host: "0.0.0.0", port: 22444, usernamePrefix: "workspace" },
      keys: registered,
    };
    expect(workspaceSshReadiness(view, target.value)).toEqual({
      ready: true,
      configReady: true,
      keyRegistered: true,
    });
    const effective = spawnSync("ssh", ["-G", "-F", configFile, target.value.alias], {
      encoding: "utf8",
      timeout: 5_000,
    });
    expect(effective.status, effective.stderr).toBe(0);
    expect(effective.stdout).toContain("hostname mend.example.test\n");
    expect(effective.stdout).toContain("port 22444\n");
    const privatePath = path.join(home, "config", "mend", "ssh", "id_ed25519");
    const bytes = fs.readFileSync(privatePath);
    const config = fs.readFileSync(configFile, "utf8");
    await runWorkspaceSshSetup(target.value, ensureKey);
    expect(fs.readFileSync(privatePath)).toEqual(bytes);
    expect(fs.readFileSync(configFile, "utf8")).toBe(config);
    fs.unlinkSync(privatePath);
    expect(() => workspaceSshReadiness(view, target.value)).toThrow(
      "no usable matching private material",
    );
    await expect(runWorkspaceSshSetup(target.value, ensureKey)).rejects.toThrow(
      "no usable matching private material",
    );
    expect(registered).toHaveLength(2);
    expect(fs.readFileSync(configFile, "utf8")).toBe(config);
    expect(fs.readFileSync(knownHostsFile, "utf8")).toBe("fixture host-trust entry\n");
  } finally {
    vi.unstubAllEnvs();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
