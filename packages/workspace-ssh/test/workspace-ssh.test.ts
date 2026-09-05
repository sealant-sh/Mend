import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  configuredWorkspaceSshIdentityFile,
  inspectWorkspaceSshReadiness,
  managedWorkspaceSshBlock,
  parseWorkspaceSshTarget,
  pickWorkspaceSshKey,
  readWorkspaceSshConfig,
  reconcileWorkspaceSshConfig,
  workspaceSshPublicKeyFingerprint,
  writeWorkspaceSshConfig,
} from "../src/index.ts";

const temporaryDirectories: Array<string> = [];

const temporaryDirectory = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mend-workspace-ssh-test-"));
  temporaryDirectories.push(directory);
  return directory;
};

const target = (serverUrl: string, port: number, hostnameOverride?: string) => {
  const parsed = parseWorkspaceSshTarget({
    serverUrl,
    publishedPort: port,
    ...(hostnameOverride === undefined ? {} : { hostnameOverride }),
  });
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("parseWorkspaceSshTarget", () => {
  it("uses the configured Mend URL hostname and the server's published SSH port", () => {
    const parsed = target("https://mend-mini.example.test:3105", 22444);
    expect(parsed.hostname).toBe("mend-mini.example.test");
    expect(parsed.port).toBe(22444);
    expect(parsed.alias).toMatch(/^mend-ws-mend-mini-example-test-/);
  });

  it("handles bracketed IPv6 URLs and a hostname-only override", () => {
    const ipv6 = target("http://[fd7a:115c:a1e0::42]:3105", 2222);
    expect(ipv6.hostname).toBe("fd7a:115c:a1e0::42");

    const overridden = target("http://mend-mini:3105", 2299, "mini.tailnet.ts.net");
    expect(overridden.hostname).toBe("mini.tailnet.ts.net");
    expect(overridden.port).toBe(2299);
    expect(overridden.alias).toBe(target("http://mend-mini:3105", 2299).alias);
  });

  it("rejects a scheme or port in the hostname override", () => {
    const scheme = parseWorkspaceSshTarget({
      serverUrl: "http://mend-mini:3105",
      publishedPort: 2222,
      hostnameOverride: "ssh://mend-mini",
    });
    const port = parseWorkspaceSshTarget({
      serverUrl: "http://mend-mini:3105",
      publishedPort: 2222,
      hostnameOverride: "mend-mini:2200",
    });
    expect(scheme.ok).toBe(false);
    expect(port.ok).toBe(false);
  });
});

describe("managed workspace SSH config", () => {
  it("is idempotent on disk and preserves hand-written config", () => {
    const root = temporaryDirectory();
    const configFile = path.join(root, ".ssh", "config");
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, "Host github.com\n  User git\n");
    const server = target("http://mend-mini:3105", 2222);

    expect(writeWorkspaceSshConfig(configFile, server, null).ok).toBe(true);
    const first = fs.readFileSync(configFile, "utf8");
    expect(writeWorkspaceSshConfig(configFile, server, null).ok).toBe(true);
    expect(fs.readFileSync(configFile, "utf8")).toBe(first);
    expect(first).toContain("Host github.com\n  User git");
    expect(fs.statSync(configFile).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(configFile)).mode & 0o777).toBe(0o700);
  });

  it("keeps separate managed aliases for separate Mend servers", () => {
    const root = temporaryDirectory();
    const configFile = path.join(root, ".ssh", "config");
    const first = target("http://mini-one:3105", 2222);
    const second = target("https://mini-two.example.test", 2244);

    expect(writeWorkspaceSshConfig(configFile, first, null).ok).toBe(true);
    expect(writeWorkspaceSshConfig(configFile, second, null).ok).toBe(true);
    const config = fs.readFileSync(configFile, "utf8");
    expect(config).toContain(`Host ${first.alias}`);
    expect(config).toContain(`Host ${second.alias}`);
    expect(first.alias).not.toBe(second.alias);
  });

  it("replaces stale host and port values for the same server identity", () => {
    const server = target("http://mend-mini:3105", 2222);
    const stale = managedWorkspaceSshBlock({ ...server, hostname: "old-host", port: 22 }, null);
    const reconciled = reconcileWorkspaceSshConfig(stale, server, null);
    if (!reconciled.ok) throw reconciled.error;
    expect(reconciled.value).toContain("HostName mend-mini");
    expect(reconciled.value).toContain("Port 2222");
    expect(reconciled.value).not.toContain("old-host");
  });

  it("migrates the old global managed block but leaves a hand-written mend-ws host", () => {
    const legacy = [
      "Host mend-ws",
      "  ProxyJump bastion",
      "# >>> mend workspace ssh (managed by `mend ssh setup`) >>>",
      "Host mend-ws",
      "  HostName old-managed-host",
      "# <<< mend workspace ssh <<<",
      "",
    ].join("\n");
    const server = target("http://mend-mini:3105", 2222);
    const reconciled = reconcileWorkspaceSshConfig(legacy, server, null);
    if (!reconciled.ok) throw reconciled.error;
    expect(reconciled.value).toContain("Host mend-ws\n  ProxyJump bastion");
    expect(reconciled.value).not.toContain("old-managed-host");
    expect(reconciled.value).toContain(`Host ${server.alias}`);
  });

  it("refuses to overwrite a hand-written block that uses the generated alias", () => {
    const server = target("http://mend-mini:3105", 2222);
    const reconciled = reconcileWorkspaceSshConfig(
      `Host ${server.alias}\n  HostName custom\n`,
      server,
      null,
    );
    expect(reconciled.ok).toBe(false);
    if (reconciled.ok) return;
    expect(reconciled.error.message).toContain("left it unchanged");
  });
});

describe("workspace SSH key identity", () => {
  it("requires this client's exact key and config, not any registered key and block", () => {
    const publicKey = "ssh-ed25519 AQIDBA== laptop";
    const fingerprint = workspaceSshPublicKeyFingerprint(publicKey);
    if (!fingerprint.ok) throw fingerprint.error;
    const key = {
      publicKey,
      identityFile: null,
      source: "agent" as const,
      fingerprint: fingerprint.value,
    };
    const server = target("http://mend-mini:3105", 2222);
    const config = managedWorkspaceSshBlock(server, null);

    expect(
      inspectWorkspaceSshReadiness({
        config,
        target: server,
        key,
        registeredFingerprints: ["SHA256:some-other-machine"],
      }),
    ).toEqual({ ready: false, configReady: true, keyRegistered: false });
    expect(
      inspectWorkspaceSshReadiness({
        config,
        target: server,
        key,
        registeredFingerprints: [fingerprint.value],
      }).ready,
    ).toBe(true);
  });

  it("uses real ssh-keygen output and reads the resulting key from disk", () => {
    vi.stubEnv("SSH_AUTH_SOCK", "");
    const root = temporaryDirectory();
    const picked = pickWorkspaceSshKey({ configHome: root, create: true });
    if (!picked.ok) throw picked.error;
    expect(picked.value?.source).toBe("generated");
    expect(picked.value?.fingerprint).toMatch(/^SHA256:/);
    expect(fs.existsSync(path.join(root, "ssh", "id_ed25519"))).toBe(true);
    if (picked.value === null) throw new Error("Expected a generated key.");
    const server = target("http://mend-mini:3105", 2222);
    const configured = managedWorkspaceSshBlock(server, picked.value.identityFile);
    const reused = pickWorkspaceSshKey({
      configHome: temporaryDirectory(),
      configuredIdentityFile: configuredWorkspaceSshIdentityFile(configured, server),
      create: false,
    });
    if (!reused.ok) throw reused.error;
    expect(reused.value?.fingerprint).toBe(picked.value.fingerprint);
    const recovered = pickWorkspaceSshKey({
      configHome: root,
      configuredIdentityFile: path.join(root, "removed-key"),
      create: false,
    });
    if (!recovered.ok) throw recovered.error;
    expect(recovered.value?.fingerprint).toBe(picked.value.fingerprint);
    expect(readWorkspaceSshConfig(path.join(root, ".ssh", "missing")).ok).toBe(true);
  });
});
