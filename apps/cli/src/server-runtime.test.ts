import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runServerProcess, serverComposeArgs } from "./server-runtime.ts";
import { nodeServerSetupRuntime, serverCommand, type ServerSetupRuntime } from "./server-setup.ts";

const roots: Array<string> = [];
const temporary = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mend runtime "));
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const fixtureAsset = (file: string): string =>
  fs.readFileSync(new URL(`../test-fixtures/docker/${file}`, import.meta.url), "utf8");
const setupRuntime = (configDir: string): ServerSetupRuntime => ({
  ...nodeServerSetupRuntime(),
  configDir,
  cliVersion: "0.23.0",
  randomBytes,
  writeLine: () => undefined,
  sleep: async () => undefined,
  run: async (_command, args) => ({
    status: 0,
    stderr: "",
    stdout:
      args[0] === "context"
        ? "unix:///var/run/docker.sock"
        : args.includes("info")
          ? "Docker Engine - Community"
          : args.includes("compose")
            ? "2.35.0"
            : "1.45 1.47",
  }),
  fetchText: async (url) =>
    url.endsWith("/api/health")
      ? { status: 200, body: '{"status":"ok","version":"0.23.0"}' }
      : {
          status: 200,
          body: fixtureAsset(
            url.endsWith("/compose.v1.yaml") ? "compose.v1.yaml" : "postgres-init.sh",
          ),
        },
});

it("passes only the server allowlist to a real child process", async () => {
  const result = await runServerProcess(
    process.execPath,
    ["-e", "process.stdout.write(JSON.stringify(process.env))"],
    {
      PATH: process.env["PATH"],
      HOME: "/preserved-home",
      DOCKER_CONFIG: "/preserved-config",
      SSH_AUTH_SOCK: "/preserved-agent",
      MEND_VERSION: "poison",
      MEND_DB_PASSWORD: "poison",
      COMPOSE_FILE: "/poison",
      DOCKER_HOST: "tcp://poison:2375",
      DOCKER_CONTEXT: "poison",
      UNRELATED_SECRET: "poison",
    },
  );
  expect(result.status).toBe(0);
  const env: unknown = JSON.parse(result.stdout);
  expect(env).toEqual({
    PATH: process.env["PATH"],
    HOME: "/preserved-home",
    DOCKER_CONFIG: "/preserved-config",
    SSH_AUTH_SOCK: "/preserved-agent",
  });
});

const runProductionDocker = async (
  args: ReadonlyArray<string>,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<string> => {
  // The production factory captures the actual inherited environment of this separate process.
  const script = `import {nodeServerSetupRuntime} from ${JSON.stringify(new URL("./server-setup.ts", import.meta.url).href)};
const result = await nodeServerSetupRuntime().run("docker", ${JSON.stringify(args)});
process.stdout.write(JSON.stringify(result));`;
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script],
    {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("close", (status) => resolve(status));
    child.once("error", (error) => reject(error));
  });
  expect(code, stderr).toBe(0);
  const result: unknown = JSON.parse(output);
  expect(result).toMatchObject({ status: 0 });
  if (
    typeof result !== "object" ||
    result === null ||
    !("stdout" in result) ||
    typeof result.stdout !== "string"
  )
    throw new Error("invalid child output");
  return result.stdout;
};

const composeAvailable =
  spawnSync("docker", ["compose", "version"], { stdio: "ignore" }).status === 0;
describe.skipIf(!composeAvailable)(
  "real Docker Compose interpolation, no daemon or containers required",
  () => {
    it("uses saved env, context, project, bindings, image and credentials despite a poisoned shell", async () => {
      const root = temporary();
      const configDir = path.join(root, "server");
      const dockerConfig = path.join(root, "docker-config");
      fs.mkdirSync(dockerConfig);
      const env = { ...process.env, DOCKER_CONFIG: dockerConfig };
      const context = await runServerProcess(
        "docker",
        ["context", "create", "saved-context", "--docker", "host=unix:///var/run/docker.sock"],
        env,
      );
      expect(context.status).toBe(0);
      const runtime = setupRuntime(configDir);
      expect(await serverCommand(["setup", "--context", "saved-context"], runtime)).toEqual({
        _tag: "ok",
      });
      const directory = fs.realpathSync(path.join(configDir, "active"));
      const savedEnv = Object.fromEntries(
        fs
          .readFileSync(path.join(directory, "server.env"), "utf8")
          .trim()
          .split("\n")
          .map((line) => {
            const separator = line.indexOf("=");
            return [line.slice(0, separator), line.slice(separator + 1)];
          }),
      );
      const poison = Object.fromEntries(Object.keys(savedEnv).map((key) => [key, "poison"]));
      const composeArgs = serverComposeArgs({ directory, dockerContext: "saved-context" }, [
        "config",
        "--format",
        "json",
      ]);
      const rendered = await runProductionDocker(composeArgs, root, {
        ...env,
        ...poison,
        COMPOSE_FILE: "/not-a-compose-file",
        COMPOSE_PROJECT_NAME: "wrong-project",
        COMPOSE_ENV_FILES: "/not-an-env-file",
        COMPOSE_PROFILES: "poison",
        DOCKER_HOST: "tcp://127.0.0.1:1",
        DOCKER_CONTEXT: "missing-context",
        DOCKER_API_VERSION: "1.01",
      });
      const compose: unknown = JSON.parse(rendered);
      expect(compose).toMatchObject({
        name: "mend",
        services: {
          mend: {
            image: "ghcr.io/sealant-sh/mend:0.23.0",
            environment: {
              APP_URL: "http://localhost:3105",
              DATABASE_URL: `postgresql://mend:${savedEnv["MEND_DB_PASSWORD"]}@postgres:5432/mend`,
              SEALANT_SERVICE_KEY: savedEnv["SEALANT_SERVICE_KEY"],
              BETTER_AUTH_SECRET: savedEnv["BETTER_AUTH_SECRET"],
            },
            ports: expect.arrayContaining([
              {
                mode: "ingress",
                host_ip: "127.0.0.1",
                target: 3105,
                published: "3105",
                protocol: "tcp",
              },
            ]),
            volumes: expect.arrayContaining([
              expect.objectContaining({
                type: "bind",
                source: "/var/run/docker.sock",
                target: "/var/run/docker.sock",
              }),
            ]),
          },
          postgres: {
            environment: {
              POSTGRES_PASSWORD: savedEnv["MEND_POSTGRES_ADMIN_PASSWORD"],
              MEND_DB_PASSWORD: savedEnv["MEND_DB_PASSWORD"],
              SEALANT_DB_PASSWORD: savedEnv["SEALANT_DB_PASSWORD"],
            },
          },
        },
        configs: { "postgres-init": { file: path.join(directory, "postgres-init.sh") } },
        volumes: {
          "mend-store": { name: "mend-store" },
          "mend-control": { name: "mend-control" },
          "mend-postgres": { name: "mend_mend-postgres" },
        },
      });
      expect(rendered).not.toContain("poison");
      expect(fs.readFileSync(path.join(directory, "server.env"), "utf8")).toBe(
        fs.readFileSync(path.join(configDir, "active", "server.env"), "utf8"),
      );
    });
  },
);

it.each([
  "<html>OK</html>",
  "{}",
  "{",
  '{"status":"ok","version":"0.99.0"}',
  '{"status":"ok","version":"0.23.0","deploymentMode":"local"}',
])("checks the actual HTTP health body: %s", async (body) => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200);
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing HTTP port");
    const runtime = setupRuntime(temporary());
    const network = nodeServerSetupRuntime();
    const result = await serverCommand(
      [
        "setup",
        "--context",
        "default",
        "--port",
        String(address.port),
        "--url",
        `http://127.0.0.1:${address.port}`,
      ],
      {
        ...runtime,
        fetchText: (url, timeout) =>
          url.endsWith("/api/health")
            ? network.fetchText(url, timeout)
            : runtime.fetchText(url, timeout),
      },
    );
    expect(result._tag).toBe(body.includes('"deploymentMode"') ? "ok" : "error");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => {
        if (error) return reject(error);
        resolve();
      }),
    );
  }
});
