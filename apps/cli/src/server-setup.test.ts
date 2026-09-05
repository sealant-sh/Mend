import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { serverCommand, type ServerSetupRuntime } from "./server-setup.ts";

const composeAsset = `name: mend
services:
  mend:
    image: \${MEND_IMAGE_REPOSITORY}:\${MEND_VERSION}
    volumes:
      - \${DOCKER_SOCKET_PATH:-/var/run/docker.sock}:/var/run/docker.sock
      - mend-store:/var/lib/mend/store
      - mend-control:/run/sealant/sockets
  postgres:
    image: postgres:17-alpine
volumes:
  mend-store:
  mend-control:
  mend-config:
  mend-ssh:
  mend-rabbitmq:
  mend-registry:
  mend-postgres:
`;

const postgresAsset = `#!/bin/sh
# Creates mend and sealant_control_plane with separate users.
printf '%s %s' "$MEND_DB_PASSWORD" "$SEALANT_DB_PASSWORD"
CREATE ROLE mend
CREATE ROLE sealant
CREATE DATABASE mend
`;

const temporaryDirectories: Array<string> = [];

const temporaryDirectory = (suffix = "server"): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `mend ${suffix} `));
  temporaryDirectories.push(root);
  return path.join(root, "config with spaces");
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

interface RuntimeControl {
  readonly runtime: ServerSetupRuntime;
  readonly commands: ReadonlyArray<readonly [string, ReadonlyArray<string>]>;
  readonly fetched: ReadonlyArray<string>;
  readonly lines: ReadonlyArray<string>;
  readonly randomCalls: () => number;
}

const makeRuntime = (
  options: {
    readonly configDir?: string;
    readonly platform?: "linux" | "darwin";
    readonly contextList?: string;
    readonly contextListStatus?: number;
    readonly inspectedEndpoint?: string;
    readonly dockerVersion?: string;
    readonly dockerVersionStatus?: number;
    readonly composeVersionStatus?: number;
    readonly composeUpStatus?: number;
    readonly assetFailure?: string;
    readonly healthStatus?: number;
    readonly healthBody?: string;
    readonly operatingSystem?: string;
  } = {},
): RuntimeControl => {
  const commands: Array<readonly [string, ReadonlyArray<string>]> = [];
  const fetched: Array<string> = [];
  const lines: Array<string> = [];
  let randomCallCount = 0;
  const contextList =
    options.contextList ??
    `${JSON.stringify({ Name: "default", DockerEndpoint: "unix:///var/run/docker.sock", Current: true })}\n`;

  const runtime: ServerSetupRuntime = {
    configDir: options.configDir ?? temporaryDirectory(),
    platform: options.platform ?? "linux",
    cliVersion: "0.23.0",
    run: async (command, args) => {
      commands.push([command, args]);
      if (args[0] === "context" && args[1] === "ls") {
        return {
          status: options.contextListStatus ?? 0,
          stdout: options.contextListStatus === 1 ? "" : contextList,
          stderr: options.contextListStatus === 1 ? "docker is not installed" : "",
        };
      }
      if (args[0] === "context" && args[1] === "inspect") {
        return {
          status: 0,
          stdout: `${options.inspectedEndpoint ?? "unix:///var/run/docker.sock"}\n`,
          stderr: "",
        };
      }
      if (
        args.includes("version") &&
        args.includes("{{.Client.APIVersion}} {{.Server.APIVersion}}")
      ) {
        return {
          status: options.dockerVersionStatus ?? 0,
          stdout:
            options.dockerVersionStatus === 1 ? "" : `${options.dockerVersion ?? "1.45 1.47"}\n`,
          stderr: options.dockerVersionStatus === 1 ? "Cannot connect to the Docker daemon" : "",
        };
      }
      if (args.includes("compose") && args.includes("version")) {
        return {
          status: options.composeVersionStatus ?? 0,
          stdout: options.composeVersionStatus === 1 ? "" : "2.35.0\n",
          stderr: options.composeVersionStatus === 1 ? "compose unavailable" : "",
        };
      }
      if (args.includes("info")) {
        return {
          status: 0,
          stdout: options.operatingSystem ?? "Docker Engine - Community",
          stderr: "",
        };
      }
      if (args.includes("compose") && args.includes("up")) {
        return {
          status: options.composeUpStatus ?? 0,
          stdout: "",
          stderr: options.composeUpStatus === 1 ? "container failed" : "",
        };
      }
      return { status: 1, stdout: "", stderr: `unexpected command: ${args.join(" ")}` };
    },
    fetchText: async (url) => {
      fetched.push(url);
      if (url.endsWith("/api/health")) {
        return {
          status: options.healthStatus ?? 200,
          body: options.healthBody ?? JSON.stringify({ status: "ok", version: "0.23.0" }),
        };
      }
      if (url.endsWith("/compose.v1.yaml")) {
        return options.assetFailure === "compose"
          ? { status: 0, body: "", error: "connection interrupted" }
          : { status: 200, body: composeAsset };
      }
      if (url.endsWith("/postgres-init.sh")) {
        return options.assetFailure === "postgres"
          ? { status: 0, body: "", error: "connection interrupted" }
          : { status: 200, body: postgresAsset };
      }
      if (url.endsWith("/releases/latest")) {
        return { status: 200, body: JSON.stringify({ tag_name: "v0.24.0" }) };
      }
      return { status: 404, body: "" };
    },
    randomBytes: (size) => {
      randomCallCount += 1;
      return randomBytes(size);
    },
    sleep: async () => undefined,
    writeLine: (line) => lines.push(line),
  };
  return {
    runtime,
    commands,
    fetched,
    lines,
    randomCalls: () => randomCallCount,
  };
};

const readEnv = (file: string): ReadonlyMap<string, string> => {
  const values = new Map<string, string>();
  for (const line of fs.readFileSync(file, "utf8").trim().split("\n")) {
    const separator = line.indexOf("=");
    values.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return values;
};

const modeOf = (file: string): number => fs.statSync(file).mode & 0o777;
const activeDirectory = (configDir: string): string =>
  path.join(configDir, fs.readlinkSync(path.join(configDir, "active")));
const activeFile = (configDir: string, name: string): string =>
  path.join(activeDirectory(configDir), name);

describe("mend server setup", () => {
  it.each([
    "{}",
    "<html>OK</html>",
    "{",
    "null",
    '{"status":"ok","version":"0.99.0"}',
    '{"status":"failed","version":"0.23.0"}',
  ])("rejects false health success: %s", async (healthBody) => {
    const control = makeRuntime({ healthBody });
    expect(await serverCommand(["setup"], control.runtime)).toMatchObject({ _tag: "error" });
    expect(control.lines.some((line) => line.includes("is reachable at"))).toBe(false);
  });

  it("uses the daemon-side socket on Linux Docker Desktop, including renamed contexts", async () => {
    const control = makeRuntime({
      operatingSystem: "Docker Desktop",
      inspectedEndpoint: "unix:///home/alice/.docker/desktop/docker.sock",
    });
    expect(await serverCommand(["setup", "--context", "my-desktop"], control.runtime)).toEqual({
      _tag: "ok",
    });
    expect(
      readEnv(activeFile(control.runtime.configDir, "server.env")).get("DOCKER_SOCKET_PATH"),
    ).toBe("/var/run/docker.sock");
  });
  it("creates a pinned localhost installation and starts compose through the selected context", async () => {
    const control = makeRuntime();

    const result = await serverCommand(["setup"], control.runtime);

    expect(result).toEqual({ _tag: "ok" });
    expect(control.randomCalls()).toBe(1);
    expect(modeOf(control.runtime.configDir)).toBe(0o700);
    expect(modeOf(activeDirectory(control.runtime.configDir))).toBe(0o700);
    expect(modeOf(activeFile(control.runtime.configDir, "server.json"))).toBe(0o600);
    expect(modeOf(activeFile(control.runtime.configDir, "server.env"))).toBe(0o600);
    expect(modeOf(activeFile(control.runtime.configDir, "postgres-init.sh"))).toBe(0o700);
    expect(
      JSON.parse(fs.readFileSync(activeFile(control.runtime.configDir, "server.json"), "utf8")),
    ).toMatchObject({
      serverVersion: "0.23.0",
      dockerContext: "default",
      dockerSocket: "/var/run/docker.sock",
      bind: "127.0.0.1",
      appUrl: "http://localhost:3105",
      allowedOrigins: [],
      appPort: 3105,
      sshPort: 2222,
    });
    const env = readEnv(activeFile(control.runtime.configDir, "server.env"));
    expect(env.get("MEND_IMAGE_REPOSITORY")).toBe("ghcr.io/sealant-sh/mend");
    expect(env.get("MEND_VERSION")).toBe("0.23.0");
    expect(env.get("MEND_STORE_VOLUME_NAME")).toBe("mend-store");
    expect(env.get("DOCKER_SOCKET_PATH")).toBe("/var/run/docker.sock");
    expect(env.get("MEND_ALLOWED_ORIGINS")).toBe("[]");
    expect([...env.keys()].toSorted()).toEqual(
      [
        "APP_URL",
        "BETTER_AUTH_SECRET",
        "DOCKER_SOCKET_PATH",
        "MEND_ALLOWED_ORIGINS",
        "MEND_BIND_HOST",
        "MEND_CONTROL_VOLUME_NAME",
        "MEND_DB_PASSWORD",
        "MEND_IMAGE_REPOSITORY",
        "MEND_PORT",
        "MEND_POSTGRES_ADMIN_PASSWORD",
        "MEND_RABBITMQ_PASSWORD",
        "MEND_REGISTRY_PORT",
        "MEND_SSH_PORT",
        "MEND_STORE_VOLUME_NAME",
        "MEND_VERSION",
        "SEALANT_CREDENTIALS_KEY",
        "SEALANT_DB_PASSWORD",
        "SEALANT_SERVICE_KEY",
        "SEALANT_SSH_HOST",
        "WORKSPACE_SSH_GATEWAY_TOKEN",
      ].toSorted(),
    );
    expect(
      fs.readFileSync(activeFile(control.runtime.configDir, "compose.yaml"), "utf8"),
    ).toContain("mend-postgres");
    expect(control.lines).toContain("Mend 0.23.0 is reachable at http://localhost:3105");
    expect(control.lines.at(-1)).toContain("mend login --url http://localhost:3105");

    const up = control.commands.find(([, args]) => args.includes("up"));
    expect(up?.[1]).toEqual([
      "--context",
      "default",
      "compose",
      "--project-name",
      "mend",
      "--project-directory",
      activeDirectory(control.runtime.configDir),
      "--env-file",
      activeFile(control.runtime.configDir, "server.env"),
      "-f",
      activeFile(control.runtime.configDir, "compose.yaml"),
      "up",
      "-d",
      "--wait",
    ]);
    expect(up?.[1]).not.toContain("down");
    expect(control.commands.some(([, args]) => args[0] === "context" && args[1] === "use")).toBe(
      false,
    );
  });

  it("preserves the server pin, context, ports, assets, and secrets on a rerun", async () => {
    const configDir = temporaryDirectory("rerun");
    const first = makeRuntime({ configDir });
    expect(
      await serverCommand(["setup", "--port", "4111", "--ssh-port", "2333"], first.runtime),
    ).toEqual({
      _tag: "ok",
    });
    const generationBefore = activeDirectory(configDir);
    const envBefore = fs.readFileSync(activeFile(configDir, "server.env"), "utf8");

    const second = makeRuntime({
      configDir,
      contextList: `${JSON.stringify({ Name: "other", DockerEndpoint: "unix:///tmp/other.sock", Current: true })}\n`,
      inspectedEndpoint: "unix:///var/run/docker.sock",
    });
    expect(await serverCommand(["setup"], second.runtime)).toEqual({ _tag: "ok" });

    expect(second.randomCalls()).toBe(0);
    expect(second.fetched.filter((url) => !url.endsWith("/api/health"))).toEqual([]);
    expect(activeDirectory(configDir)).toBe(generationBefore);
    expect(fs.readdirSync(path.join(configDir, "generations"))).toHaveLength(1);
    expect(fs.readFileSync(activeFile(configDir, "server.env"), "utf8")).toBe(envBefore);
    expect(JSON.parse(fs.readFileSync(activeFile(configDir, "server.json"), "utf8"))).toMatchObject(
      {
        serverVersion: "0.23.0",
        dockerContext: "default",
        appUrl: "http://localhost:4111",
        appPort: 4111,
        sshPort: 2333,
      },
    );
    expect(second.commands[0]?.[1]).toContain("inspect");
    expect(
      second.commands.some(([, args]) => args.includes("context") && args.includes("ls")),
    ).toBe(false);
  });

  it("changes only the Mend server pin on an explicit upgrade", async () => {
    const configDir = temporaryDirectory("upgrade");
    const first = makeRuntime({ configDir });
    expect(await serverCommand(["setup"], first.runtime)).toEqual({ _tag: "ok" });
    const secrets = readEnv(activeFile(configDir, "server.env"));
    const previous = activeDirectory(configDir);

    const upgraded = makeRuntime({ configDir, healthBody: '{"status":"ok","version":"0.24.0"}' });
    expect(await serverCommand(["setup", "--version", "latest"], upgraded.runtime)).toEqual({
      _tag: "ok",
    });
    const next = readEnv(activeFile(configDir, "server.env"));
    expect(activeDirectory(configDir)).not.toBe(previous);
    expect(readEnv(path.join(previous, "server.env"))).toEqual(secrets);

    expect(next.get("MEND_VERSION")).toBe("0.24.0");
    expect(next.get("MEND_IMAGE_REPOSITORY")).toBe("ghcr.io/sealant-sh/mend");
    expect(next.get("SEALANT_SERVICE_KEY")).toBe(secrets.get("SEALANT_SERVICE_KEY"));
    expect(next.get("SEALANT_DB_PASSWORD")).toBe(secrets.get("SEALANT_DB_PASSWORD"));
    expect(upgraded.randomCalls()).toBe(0);
    expect(upgraded.fetched).toContain(
      "https://api.github.com/repos/sealant-sh/Mend/releases/latest",
    );
    expect([...next.keys()].some((key) => key.includes("SEALANT_VERSION"))).toBe(false);
  });

  it("requires explicit, matching non-local bind and URL settings", async () => {
    const missingUrl = makeRuntime();
    const missingResult = await serverCommand(["setup", "--bind", "0.0.0.0"], missingUrl.runtime);
    expect(missingResult).toMatchObject({ _tag: "error" });
    if (missingResult._tag === "error") expect(missingResult.message).toContain("explicit --url");
    expect(fs.existsSync(path.join(missingUrl.runtime.configDir, "active"))).toBe(false);

    const mismatched = makeRuntime();
    const mismatchResult = await serverCommand(
      ["setup", "--bind", "0.0.0.0", "--url", "http://localhost:3105"],
      mismatched.runtime,
    );
    expect(mismatchResult).toMatchObject({ _tag: "error" });
    if (mismatchResult._tag === "error")
      expect(mismatchResult.message).toContain("must both describe");

    const exposed = makeRuntime();
    expect(
      await serverCommand(
        [
          "setup",
          "--bind",
          "0.0.0.0",
          "--url",
          "http://100.70.80.90:3105",
          "--origin",
          "https://mend.example.test",
        ],
        exposed.runtime,
      ),
    ).toEqual({ _tag: "ok" });
    const env = readEnv(activeFile(exposed.runtime.configDir, "server.env"));
    expect(env.get("MEND_ALLOWED_ORIGINS")).toBe('["https://mend.example.test"]');
  });

  it("rejects invalid origins and corrupt or truncated persisted state", async () => {
    const invalid = makeRuntime();
    const invalidResult = await serverCommand(
      ["setup", "--origin", "https://example.test/path"],
      invalid.runtime,
    );
    expect(invalidResult).toMatchObject({ _tag: "error" });
    if (invalidResult._tag === "error")
      expect(invalidResult.message).toContain("no credentials, path");
    expect(fs.existsSync(path.join(invalid.runtime.configDir, "active"))).toBe(false);

    const configDir = temporaryDirectory("corrupt");
    expect(await serverCommand(["setup"], makeRuntime({ configDir }).runtime)).toEqual({
      _tag: "ok",
    });
    fs.writeFileSync(activeFile(configDir, "server.json"), '{"schemaVersion":');
    const corrupt = makeRuntime({ configDir });
    const corruptResult = await serverCommand(["setup"], corrupt.runtime);
    expect(corruptResult).toMatchObject({ _tag: "error" });
    if (corruptResult._tag === "error") expect(corruptResult.message).toContain("not valid JSON");
    expect(corrupt.commands).toEqual([]);
  });

  it("rejects truncated secrets instead of replacing them", async () => {
    const configDir = temporaryDirectory("truncated-secrets");
    const first = makeRuntime({ configDir });
    expect(await serverCommand(["setup"], first.runtime)).toEqual({ _tag: "ok" });
    const envFile = activeFile(configDir, "server.env");
    fs.writeFileSync(
      envFile,
      fs
        .readFileSync(envFile, "utf8")
        .replace(/SEALANT_SERVICE_KEY=.*/, "SEALANT_SERVICE_KEY=short"),
    );

    const rerun = makeRuntime({ configDir });
    const result = await serverCommand(["setup"], rerun.runtime);

    expect(result).toMatchObject({ _tag: "error" });
    if (result._tag === "error")
      expect(result.message).toContain("SEALANT_SERVICE_KEY has an invalid value");
    expect(rerun.randomCalls()).toBe(0);
    expect(rerun.commands).toEqual([]);
  });

  it("selects OrbStack when no context is current and uses the daemon-side macOS socket", async () => {
    const contexts = [
      { Name: "remote", DockerEndpoint: "ssh://builder", Current: true },
      {
        Name: "desktop-linux",
        DockerEndpoint: "unix:///Users/alice/.docker/run/docker.sock",
        Current: false,
      },
      {
        Name: "orbstack",
        DockerEndpoint: "unix:///Users/alice/.orbstack/run/docker.sock",
        Current: false,
      },
    ]
      .map((row) => JSON.stringify(row))
      .join("\n");
    const control = makeRuntime({ platform: "darwin", contextList: `${contexts}\n` });

    expect(await serverCommand(["setup"], control.runtime)).toEqual({ _tag: "ok" });

    expect(
      JSON.parse(fs.readFileSync(activeFile(control.runtime.configDir, "server.json"), "utf8")),
    ).toMatchObject({
      dockerContext: "orbstack",
      dockerEndpoint: "unix:///Users/alice/.orbstack/run/docker.sock",
      dockerSocket: "/var/run/docker.sock",
    });
    expect(
      control.commands
        .filter(([, args]) => args[0] === "--context")
        .every(([, args]) => args[1] === "orbstack"),
    ).toBe(true);
  });

  it("uses the daemon-side socket for an explicit Docker Desktop context on macOS", async () => {
    const control = makeRuntime({
      platform: "darwin",
      inspectedEndpoint:
        "unix:///Users/alice/Library/Containers/com.docker.docker/Data/docker-cli.sock",
    });

    expect(await serverCommand(["setup", "--context", "desktop-linux"], control.runtime)).toEqual({
      _tag: "ok",
    });

    const env = readEnv(activeFile(control.runtime.configDir, "server.env"));
    expect(env.get("DOCKER_SOCKET_PATH")).toBe("/var/run/docker.sock");
    expect(
      control.commands
        .filter(([, args]) => args[0] === "--context")
        .every(([, args]) => args[1] === "desktop-linux"),
    ).toBe(true);
  });

  it("persists an explicit local socket override", async () => {
    const control = makeRuntime();
    const socket = "/custom docker/socket with spaces.sock";

    expect(
      await serverCommand(
        ["setup", "--context", "default", "--docker-socket", socket],
        control.runtime,
      ),
    ).toEqual({ _tag: "ok" });

    const env = readEnv(activeFile(control.runtime.configDir, "server.env"));
    expect(env.get("DOCKER_SOCKET_PATH")).toBe(socket);
  });

  it("rejects a requested remote daemon before writing state", async () => {
    const control = makeRuntime({ inspectedEndpoint: "ssh://docker@example.test" });

    const result = await serverCommand(["setup", "--context", "remote"], control.runtime);

    expect(result).toMatchObject({ _tag: "error" });
    if (result._tag === "error") expect(result.message).toContain("remote SSH/TCP daemons");
    expect(fs.existsSync(path.join(control.runtime.configDir, "active"))).toBe(false);
    expect(control.commands).toHaveLength(1);
  });

  it("fails Docker availability and capability checks before generating secrets or files", async () => {
    const missing = makeRuntime({ contextListStatus: 1 });
    const missingResult = await serverCommand(["setup"], missing.runtime);
    expect(missingResult).toMatchObject({ _tag: "error" });
    if (missingResult._tag === "error")
      expect(missingResult.message).toContain("docker is not installed");
    expect(fs.existsSync(path.join(missing.runtime.configDir, "active"))).toBe(false);

    const stopped = makeRuntime({ dockerVersionStatus: 1 });
    const stoppedResult = await serverCommand(["setup"], stopped.runtime);
    expect(stoppedResult).toMatchObject({ _tag: "error" });
    if (stoppedResult._tag === "error")
      expect(stoppedResult.message).toContain("Cannot connect to the Docker daemon");
    expect(fs.existsSync(path.join(stopped.runtime.configDir, "active"))).toBe(false);

    const oldApi = makeRuntime({ dockerVersion: "1.44 1.44" });
    const oldResult = await serverCommand(["setup"], oldApi.runtime);
    expect(oldResult).toMatchObject({ _tag: "error" });
    if (oldResult._tag === "error") expect(oldResult.message).toContain("Docker API >= 1.45");
    expect(oldApi.randomCalls()).toBe(0);
    expect(fs.existsSync(path.join(oldApi.runtime.configDir, "active"))).toBe(false);

    const noCompose = makeRuntime({ composeVersionStatus: 1 });
    const composeResult = await serverCommand(["setup"], noCompose.runtime);
    expect(composeResult).toMatchObject({ _tag: "error" });
    if (composeResult._tag === "error")
      expect(composeResult.message).toContain("Compose v2 plugin");
    expect(noCompose.randomCalls()).toBe(0);
    expect(fs.existsSync(path.join(noCompose.runtime.configDir, "active"))).toBe(false);
  });

  it("leaves no state when release download is interrupted", async () => {
    const control = makeRuntime({ assetFailure: "postgres" });

    const result = await serverCommand(["setup"], control.runtime);

    expect(result).toMatchObject({ _tag: "error" });
    if (result._tag === "error") expect(result.message).toContain("connection interrupted");
    expect(fs.existsSync(path.join(control.runtime.configDir, "active"))).toBe(false);
    expect(control.randomCalls()).toBe(0);
    expect(fs.existsSync(path.join(control.runtime.configDir, "server.lock"))).toBe(false);
    expect(control.commands.some(([, args]) => args.includes("up"))).toBe(false);
  });

  it("reuses the first identity after a filesystem failure before activating a generation", async () => {
    const configDir = temporaryDirectory("first-write-failure");
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(configDir, "generations"), { mode: 0o500 });
    const first = makeRuntime({ configDir });
    const result = await serverCommand(["setup"], first.runtime);
    expect(result._tag).toBe("error");
    expect(first.randomCalls()).toBe(1);
    const identity = fs.readFileSync(path.join(configDir, "identity.env"), "utf8");
    expect(fs.existsSync(path.join(configDir, "active"))).toBe(false);
    expect(fs.existsSync(path.join(configDir, "server.lock"))).toBe(false);
    expect(first.commands.some(([, args]) => args.includes("up"))).toBe(false);
    fs.chmodSync(path.join(configDir, "generations"), 0o700);
    const second = makeRuntime({ configDir });
    expect(await serverCommand(["setup"], second.runtime)).toEqual({ _tag: "ok" });
    expect(second.randomCalls()).toBe(0);
    expect(fs.readFileSync(activeFile(configDir, "identity.env"), "utf8")).toBe(identity);
    expect(fs.readFileSync(path.join(configDir, "identity.env"), "utf8")).toBe(identity);
  });

  it("refuses an unrecognised flat installation instead of generating another identity", async () => {
    const control = makeRuntime();
    fs.mkdirSync(control.runtime.configDir, { recursive: true });
    const original = "existing unreleased credentials\n";
    fs.writeFileSync(path.join(control.runtime.configDir, "server.env"), original);
    const result = await serverCommand(["setup"], control.runtime);
    expect(result._tag).toBe("error");
    expect(control.randomCalls()).toBe(0);
    expect(control.commands).toEqual([]);
    expect(fs.readFileSync(path.join(control.runtime.configDir, "server.env"), "utf8")).toBe(
      original,
    );
  });

  it("redetects daemon sockets but retains explicit overrides on reruns", async () => {
    const configDir = temporaryDirectory("socket-rerun");
    const first = makeRuntime({
      configDir,
      inspectedEndpoint: "unix:///run/user/1000/docker.sock",
    });
    expect(await serverCommand(["setup", "--context", "local"], first.runtime)).toEqual({
      _tag: "ok",
    });
    expect(readEnv(activeFile(configDir, "server.env")).get("DOCKER_SOCKET_PATH")).toBe(
      "/run/user/1000/docker.sock",
    );
    const identity = fs.readFileSync(path.join(configDir, "identity.env"), "utf8");
    const desktop = makeRuntime({
      configDir,
      operatingSystem: "Docker Desktop",
      inspectedEndpoint: "unix:///home/alice/.docker/desktop/docker.sock",
    });
    expect(await serverCommand(["setup"], desktop.runtime)).toEqual({ _tag: "ok" });
    expect(readEnv(activeFile(configDir, "server.env")).get("DOCKER_SOCKET_PATH")).toBe(
      "/var/run/docker.sock",
    );
    expect(
      await serverCommand(["setup", "--docker-socket", "/custom/socket"], desktop.runtime),
    ).toEqual({ _tag: "ok" });
    expect(await serverCommand(["setup"], desktop.runtime)).toEqual({ _tag: "ok" });
    expect(readEnv(activeFile(configDir, "server.env")).get("DOCKER_SOCKET_PATH")).toBe(
      "/custom/socket",
    );
    expect(fs.readFileSync(path.join(configDir, "identity.env"), "utf8")).toBe(identity);
  });

  it("does not report the advertised URL reachable when every health request fails", async () => {
    const control = makeRuntime({ healthStatus: 503 });

    const result = await serverCommand(["setup"], control.runtime);

    expect(result).toMatchObject({ _tag: "error" });
    if (result._tag === "error")
      expect(result.message).toContain("did not answer successfully (HTTP 503)");
    expect(control.lines.some((line) => line.includes("is reachable at"))).toBe(false);
    expect(control.fetched.filter((url) => url.endsWith("/api/health"))).toHaveLength(30);
  });
});
