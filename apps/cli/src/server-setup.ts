import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

import { cliVersion } from "./version.ts";

const CONFIG_SCHEMA_VERSION = 1;
const ASSET_CONTRACT = "mend-docker-v1";
const MINIMUM_DOCKER_API = "1.45";
const DEFAULT_APP_PORT = 3105;
const DEFAULT_SSH_PORT = 2222;
const DEFAULT_BIND = "127.0.0.1";
const COMPOSE_ASSET = "compose.v1.yaml";
const POSTGRES_INIT_ASSET = "postgres-init.sh";
const RELEASE_BASE = "https://github.com/sealant-sh/Mend/releases/download";

interface CommandOutput {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: string;
}

interface FetchOutput {
  readonly status: number;
  readonly body: string;
  readonly error?: string;
}

/** Runtime operations used by `mend server setup`; tests replace only process and network edges. */
export interface ServerSetupRuntime {
  /** Directory where setup persists compose, configuration, and secrets. */
  readonly configDir: string;
  /** Host operating system reported by Node. */
  readonly platform: NodeJS.Platform;
  /** Version of this CLI, used for a fresh server pin. */
  readonly cliVersion: string;
  /** Run a command without a shell and capture its result. */
  run(command: string, args: ReadonlyArray<string>): Promise<CommandOutput>;
  /** Fetch text with a bounded request timeout. */
  fetchText(url: string, timeoutMs: number): Promise<FetchOutput>;
  /** Generate cryptographic bytes. Setup calls this once for a new installation. */
  randomBytes(size: number): Buffer;
  /** Wait between advertised health probes. */
  sleep(milliseconds: number): Promise<void>;
  /** Print one progress or result line. */
  writeLine(line: string): void;
}

/** Observable result of a server command. Expected setup failures do not reject. */
export type ServerCommandResult =
  | { readonly _tag: "ok" }
  | { readonly _tag: "error"; readonly message: string };

interface SetupOptions {
  readonly context: string | undefined;
  readonly version: string | undefined;
  readonly bind: string | undefined;
  readonly url: string | undefined;
  readonly origins: ReadonlyArray<string> | undefined;
  readonly appPort: number | undefined;
  readonly sshPort: number | undefined;
  readonly dockerSocket: string | undefined;
}

interface ServerConfig {
  readonly schemaVersion: number;
  readonly assetContract: string;
  readonly serverVersion: string;
  readonly dockerContext: string;
  readonly dockerEndpoint: string;
  readonly dockerSocket: string;
  readonly bind: string;
  readonly appUrl: string;
  readonly allowedOrigins: ReadonlyArray<string>;
  readonly appPort: number;
  readonly sshPort: number;
}

interface ServerSecrets {
  readonly postgresAdminPassword: string;
  readonly mendDatabasePassword: string;
  readonly sealantDatabasePassword: string;
  readonly queuePassword: string;
  readonly betterAuthSecret: string;
  readonly sealantCredentialsKey: string;
  readonly sealantServiceKey: string;
  readonly workspaceSshGatewayToken: string;
}

interface DockerContextRow {
  readonly name: string;
  readonly endpoint: string;
  readonly current: boolean;
}

class ServerSetupError extends Error {
  readonly _tag = "ServerSetupError" as const;
}

const setupError = (message: string): ServerSetupError => new ServerSetupError(message);

const ownFields = (value: unknown): ReadonlyMap<string, unknown> | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return new Map(Object.entries(value));
};

const requiredString = (fields: ReadonlyMap<string, unknown>, key: string): string => {
  const value = fields.get(key);
  if (typeof value !== "string" || value.length === 0) {
    throw setupError(`Server config is corrupt: ${key} must be a non-empty string.`);
  }
  return value;
};

const requiredInteger = (fields: ReadonlyMap<string, unknown>, key: string): number => {
  const value = fields.get(key);
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw setupError(`Server config is corrupt: ${key} must be an integer.`);
  }
  return value;
};

const parsePort = (value: string, flag: string): number => {
  if (!/^\d+$/.test(value)) throw setupError(`${flag} must be an integer from 1 to 65535.`);
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw setupError(`${flag} must be an integer from 1 to 65535.`);
  }
  return port;
};

const parseVersion = (value: string): string => {
  const normalized = value.startsWith("v") ? value.slice(1) : value;
  if (normalized === "latest") return normalized;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(normalized)) {
    throw setupError('--version must be "latest" or an exact Mend version such as 0.23.0.');
  }
  return normalized;
};

const nextFlagValue = (
  args: ReadonlyArray<string>,
  index: number,
  flag: string,
): readonly [string, number] => {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw setupError(`${flag} needs a value.`);
  }
  return [value, index + 1];
};

const SETUP_FLAGS = new Set([
  "--context",
  "--version",
  "--bind",
  "--url",
  "--origin",
  "--port",
  "--ssh-port",
  "--docker-socket",
]);

const parseSetupOptions = (args: ReadonlyArray<string>): SetupOptions => {
  const values = new Map<string, Array<string>>();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === undefined) continue;
    if (!flag.startsWith("--")) throw setupError(`Unexpected server setup argument "${flag}".`);
    if (!SETUP_FLAGS.has(flag)) throw setupError(`Unknown server setup option "${flag}".`);
    const [value, valueIndex] = nextFlagValue(args, index, flag);
    index = valueIndex;
    const previous = values.get(flag) ?? [];
    if (flag !== "--origin" && previous.length > 0) {
      throw setupError(`${flag} may be supplied only once.`);
    }
    previous.push(value);
    values.set(flag, previous);
  }
  const valueOf = (flag: string): string | undefined => values.get(flag)?.[0];
  const version = valueOf("--version");
  const appPort = valueOf("--port");
  const sshPort = valueOf("--ssh-port");
  const origins = values.get("--origin");
  return {
    context: valueOf("--context"),
    version: version === undefined ? undefined : parseVersion(version),
    bind: valueOf("--bind"),
    url: valueOf("--url"),
    origins: origins === undefined ? undefined : origins,
    appPort: appPort === undefined ? undefined : parsePort(appPort, "--port"),
    sshPort: sshPort === undefined ? undefined : parsePort(sshPort, "--ssh-port"),
    dockerSocket: valueOf("--docker-socket"),
  };
};

const parseUrl = (input: string, label: string): URL => {
  try {
    return new URL(input);
  } catch {
    throw setupError(`${label} must be an absolute http:// or https:// URL.`);
  }
};

const parseHttpOrigin = (input: string, label: string): string => {
  if (input.trim() !== input || /[\r\n]/.test(input)) {
    throw setupError(`${label} must not contain whitespace or line breaks.`);
  }
  const parsed = parseUrl(input, label);
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw setupError(
      `${label} must be an http:// or https:// origin with no credentials, path, query, or fragment.`,
    );
  }
  return parsed.origin;
};

const isLoopbackBind = (bind: string): boolean =>
  bind === "127.0.0.1" || bind === "::1" || bind.startsWith("127.");

const isLoopbackHost = (hostname: string): boolean =>
  hostname === "localhost" ||
  hostname === "::1" ||
  hostname === "[::1]" ||
  hostname.startsWith("127.");

const resolveAppUrl = (
  existing: ServerConfig | null,
  options: SetupOptions,
  appPort: number,
): string => {
  const oldLocalUrl = existing === null ? null : `http://localhost:${existing.appPort}`;
  const portChangedOnLocalhost = options.appPort !== undefined && existing?.appUrl === oldLocalUrl;
  const fallback = portChangedOnLocalhost
    ? `http://localhost:${appPort}`
    : (existing?.appUrl ?? `http://localhost:${appPort}`);
  return parseHttpOrigin(options.url ?? fallback, "--url");
};

const checkExposurePair = (bind: string, appUrl: string, requireExplicitUrl: boolean): void => {
  const bindIsLoopback = isLoopbackBind(bind);
  if (!bindIsLoopback && requireExplicitUrl) {
    throw setupError("A non-loopback --bind also requires an explicit --url.");
  }
  const appHostIsLoopback = isLoopbackHost(parseUrl(appUrl, "--url").hostname);
  if (bindIsLoopback !== appHostIsLoopback) {
    throw setupError(
      "--bind and --url must both describe localhost exposure or both describe non-local exposure.",
    );
  }
};

const validateExposure = (
  existing: ServerConfig | null,
  options: SetupOptions,
): Pick<ServerConfig, "bind" | "appUrl" | "allowedOrigins" | "appPort" | "sshPort"> => {
  const appPort = options.appPort ?? existing?.appPort ?? DEFAULT_APP_PORT;
  const sshPort = options.sshPort ?? existing?.sshPort ?? DEFAULT_SSH_PORT;
  if (appPort === sshPort) throw setupError("--port and --ssh-port must use different ports.");

  const bind = options.bind ?? existing?.bind ?? DEFAULT_BIND;
  if (net.isIP(bind) === 0) {
    throw setupError(
      "--bind must be a literal IPv4 or IPv6 address, such as 127.0.0.1 or 0.0.0.0.",
    );
  }
  const appUrl = resolveAppUrl(existing, options, appPort);
  checkExposurePair(bind, appUrl, options.url === undefined && existing === null);

  const requestedOrigins = options.origins?.map((origin) => parseHttpOrigin(origin, "--origin"));
  const inheritedOrigins = existing?.allowedOrigins ?? [];
  const allowedOrigins = [
    ...new Set((requestedOrigins ?? inheritedOrigins).filter((origin) => origin !== appUrl)),
  ];
  return { bind, appUrl, allowedOrigins, appPort, sshPort };
};

const parseServerConfig = (raw: string): ServerConfig => {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw setupError(
      "Server config is corrupt: server.json is not valid JSON. Restore it before setup.",
    );
  }
  const fields = ownFields(decoded);
  if (fields === null)
    throw setupError("Server config is corrupt: server.json must contain an object.");
  const origins = fields.get("allowedOrigins");
  if (!Array.isArray(origins) || !origins.every((origin) => typeof origin === "string")) {
    throw setupError("Server config is corrupt: allowedOrigins must be an array of strings.");
  }
  const serverVersion = parseVersion(requiredString(fields, "serverVersion"));
  if (serverVersion === "latest") {
    throw setupError("Server config is corrupt: serverVersion must be an exact pinned version.");
  }
  const config: ServerConfig = {
    schemaVersion: requiredInteger(fields, "schemaVersion"),
    assetContract: requiredString(fields, "assetContract"),
    serverVersion,
    dockerContext: requiredString(fields, "dockerContext"),
    dockerEndpoint: requiredString(fields, "dockerEndpoint"),
    dockerSocket: requiredString(fields, "dockerSocket"),
    bind: requiredString(fields, "bind"),
    appUrl: parseHttpOrigin(requiredString(fields, "appUrl"), "Server config appUrl"),
    allowedOrigins: origins.map((origin) =>
      parseHttpOrigin(origin, "Server config allowedOrigins"),
    ),
    appPort: requiredInteger(fields, "appPort"),
    sshPort: requiredInteger(fields, "sshPort"),
  };
  if (config.schemaVersion !== CONFIG_SCHEMA_VERSION || config.assetContract !== ASSET_CONTRACT) {
    throw setupError(
      `Server config uses unsupported contract ${config.schemaVersion}/${config.assetContract}. Upgrade the CLI before setup.`,
    );
  }
  parsePort(String(config.appPort), "Server config appPort");
  parsePort(String(config.sshPort), "Server config sshPort");
  validateExposure(null, {
    context: undefined,
    version: undefined,
    bind: config.bind,
    url: config.appUrl,
    origins: config.allowedOrigins,
    appPort: config.appPort,
    sshPort: config.sshPort,
    dockerSocket: undefined,
  });
  return config;
};

const envValue = (fields: ReadonlyMap<string, string>, key: string): string => {
  const value = fields.get(key);
  if (value === undefined || value.length === 0) {
    throw setupError(`Server secrets are corrupt: ${key} is missing or empty.`);
  }
  return value;
};

const parseSecrets = (raw: string): ServerSecrets => {
  const fields = new Map<string, string>();
  for (const line of raw.split("\n")) {
    if (line === "") continue;
    const separator = line.indexOf("=");
    if (separator < 1)
      throw setupError("Server secrets are corrupt: server.env has a malformed line.");
    const key = line.slice(0, separator);
    if (fields.has(key))
      throw setupError(`Server secrets are corrupt: ${key} appears more than once.`);
    fields.set(key, line.slice(separator + 1));
  }
  const secrets: ServerSecrets = {
    postgresAdminPassword: envValue(fields, "MEND_POSTGRES_ADMIN_PASSWORD"),
    mendDatabasePassword: envValue(fields, "MEND_DB_PASSWORD"),
    sealantDatabasePassword: envValue(fields, "SEALANT_DB_PASSWORD"),
    queuePassword: envValue(fields, "MEND_RABBITMQ_PASSWORD"),
    betterAuthSecret: envValue(fields, "BETTER_AUTH_SECRET"),
    sealantCredentialsKey: envValue(fields, "SEALANT_CREDENTIALS_KEY"),
    sealantServiceKey: envValue(fields, "SEALANT_SERVICE_KEY"),
    workspaceSshGatewayToken: envValue(fields, "WORKSPACE_SSH_GATEWAY_TOKEN"),
  };
  if (!/^slt_svc_[0-9a-f]{64}$/.test(secrets.sealantServiceKey)) {
    throw setupError("Server secrets are corrupt: SEALANT_SERVICE_KEY has an invalid value.");
  }
  const hexSecrets: ReadonlyArray<readonly [string, string]> = [
    ["MEND_POSTGRES_ADMIN_PASSWORD", secrets.postgresAdminPassword],
    ["MEND_DB_PASSWORD", secrets.mendDatabasePassword],
    ["SEALANT_DB_PASSWORD", secrets.sealantDatabasePassword],
    ["MEND_RABBITMQ_PASSWORD", secrets.queuePassword],
    ["WORKSPACE_SSH_GATEWAY_TOKEN", secrets.workspaceSshGatewayToken],
  ];
  for (const [name, value] of hexSecrets) {
    if (!/^[0-9a-f]{64}$/.test(value)) {
      throw setupError(`Server secrets are corrupt: ${name} has an invalid value.`);
    }
  }
  if (!/^[0-9a-f]{64}$/.test(secrets.betterAuthSecret)) {
    throw setupError("Server secrets are corrupt: BETTER_AUTH_SECRET has an invalid value.");
  }
  if (!/^[0-9A-Za-z+/]{43}=$/.test(secrets.sealantCredentialsKey)) {
    throw setupError("Server secrets are corrupt: SEALANT_CREDENTIALS_KEY has an invalid value.");
  }
  return secrets;
};

const createSecrets = (runtime: ServerSetupRuntime): ServerSecrets => {
  const bytes = runtime.randomBytes(256);
  if (bytes.length !== 256)
    throw setupError("Secure random source returned the wrong number of bytes.");
  const hex = (offset: number): string => bytes.subarray(offset, offset + 32).toString("hex");
  return {
    postgresAdminPassword: hex(0),
    mendDatabasePassword: hex(32),
    sealantDatabasePassword: hex(64),
    queuePassword: hex(96),
    betterAuthSecret: hex(128),
    sealantCredentialsKey: bytes.subarray(160, 192).toString("base64"),
    sealantServiceKey: `slt_svc_${hex(192)}`,
    workspaceSshGatewayToken: hex(224),
  };
};

const parseContextRows = (raw: string): ReadonlyArray<DockerContextRow> => {
  const rows: Array<DockerContextRow> = [];
  for (const line of raw.split("\n").filter((candidate) => candidate.trim() !== "")) {
    let decoded: unknown;
    try {
      decoded = JSON.parse(line);
    } catch {
      throw setupError("Docker returned an unreadable context list.");
    }
    const fields = ownFields(decoded);
    if (fields === null) throw setupError("Docker returned an unreadable context list.");
    const name = fields.get("Name");
    const endpoint = fields.get("DockerEndpoint");
    const current = fields.get("Current");
    if (typeof name !== "string" || typeof endpoint !== "string") {
      throw setupError("Docker returned a context with no name or endpoint.");
    }
    rows.push({ name, endpoint, current: current === true || current === "true" });
  }
  return rows;
};

const localUnixEndpoint = (endpoint: string): boolean => endpoint.startsWith("unix:///");

const commandFailure = (label: string, output: CommandOutput): ServerSetupError => {
  const detail = output.stderr.trim() || output.error || `exit ${output.status ?? "unknown"}`;
  return setupError(`${label}: ${detail}`);
};

const selectDockerContext = async (
  runtime: ServerSetupRuntime,
  requested: string | undefined,
): Promise<{ readonly name: string; readonly endpoint: string }> => {
  if (requested !== undefined) {
    const inspect = await runtime.run("docker", [
      "context",
      "inspect",
      requested,
      "--format",
      "{{.Endpoints.docker.Host}}",
    ]);
    if (inspect.status !== 0)
      throw commandFailure(`Docker context "${requested}" is unavailable`, inspect);
    const endpoint = inspect.stdout.trim();
    if (!localUnixEndpoint(endpoint)) {
      throw setupError(
        `Docker context "${requested}" uses ${endpoint || "an unknown endpoint"}. Mend server setup supports local Unix-socket contexts only; remote SSH/TCP daemons would make the advertised health check report the wrong machine.`,
      );
    }
    return { name: requested, endpoint };
  }

  const listed = await runtime.run("docker", ["context", "ls", "--format", "{{json .}}"]);
  if (listed.status !== 0) throw commandFailure("Docker contexts are unavailable", listed);
  const local = parseContextRows(listed.stdout).filter((row) => localUnixEndpoint(row.endpoint));
  const selected =
    local.find((row) => row.current) ??
    local.find((row) => row.name === "orbstack") ??
    local.find((row) => row.name === "desktop-linux") ??
    local.find((row) => row.name === "default") ??
    (local.length === 1 ? local[0] : undefined);
  if (selected === undefined) {
    throw setupError(
      local.length === 0
        ? "No local Unix-socket Docker context was found. Start Docker Desktop, OrbStack, or a local Docker Engine, then retry."
        : `Several local Docker contexts are available (${local.map((row) => row.name).join(", ")}). Choose one with --context.`,
    );
  }
  return { name: selected.name, endpoint: selected.endpoint };
};

const compareApiVersions = (left: string, right: string): number => {
  const parts = (value: string): readonly [number, number] => {
    const match = /^(\d+)\.(\d+)$/.exec(value);
    if (match === null) throw setupError(`Docker reported an invalid API version "${value}".`);
    return [Number(match[1]), Number(match[2])];
  };
  const [leftMajor, leftMinor] = parts(left);
  const [rightMajor, rightMinor] = parts(right);
  return leftMajor === rightMajor ? leftMinor - rightMinor : leftMajor - rightMajor;
};

const checkDocker = async (runtime: ServerSetupRuntime, context: string): Promise<void> => {
  const version = await runtime.run("docker", [
    "--context",
    context,
    "version",
    "--format",
    "{{.Client.APIVersion}} {{.Server.APIVersion}}",
  ]);
  if (version.status !== 0) {
    throw commandFailure(`Docker context "${context}" cannot reach its daemon`, version);
  }
  const [clientApi, serverApi, extra] = version.stdout.trim().split(/\s+/);
  if (clientApi === undefined || serverApi === undefined || extra !== undefined) {
    throw setupError("Docker returned unreadable client/server API versions.");
  }
  if (
    compareApiVersions(clientApi, MINIMUM_DOCKER_API) < 0 ||
    compareApiVersions(serverApi, MINIMUM_DOCKER_API) < 0
  ) {
    throw setupError(
      `Docker API >= ${MINIMUM_DOCKER_API} is required (client ${clientApi}, server ${serverApi}). Update Docker before setup.`,
    );
  }
  const compose = await runtime.run("docker", [
    "--context",
    context,
    "compose",
    "version",
    "--short",
  ]);
  if (compose.status !== 0 || compose.stdout.trim() === "") {
    throw commandFailure("Docker Compose v2 plugin is required", compose);
  }
};

const resolveLatestVersion = async (runtime: ServerSetupRuntime): Promise<string> => {
  const response = await runtime.fetchText(
    "https://api.github.com/repos/sealant-sh/Mend/releases/latest",
    15_000,
  );
  if (response.error !== undefined || response.status !== 200) {
    throw setupError(
      `Could not resolve the latest Mend server release: ${response.error ?? `HTTP ${response.status}`}.`,
    );
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(response.body);
  } catch {
    throw setupError(
      "Could not resolve the latest Mend server release: GitHub returned invalid JSON.",
    );
  }
  const fields = ownFields(decoded);
  const tag = fields?.get("tag_name");
  if (typeof tag !== "string") {
    throw setupError("Could not resolve the latest Mend server release: tag_name is missing.");
  }
  const version = parseVersion(tag);
  if (version === "latest") throw setupError("GitHub returned an invalid latest release tag.");
  return version;
};

const validateComposeAsset = (body: string): void => {
  const [, afterServices = ""] = body.split(/^services:\s*$/m);
  const [servicesBlock = ""] = afterServices.split(/^\S/m);
  const serviceNames = [...servicesBlock.matchAll(/^ {2}([0-9A-Za-z_-]+):\s*$/gm)]
    .map((match) => match[1])
    .filter((name) => name !== undefined)
    .toSorted((left, right) => left.localeCompare(right));
  const requiredFragments = [
    "name: mend",
    "image: postgres:17-alpine",
    "MEND_IMAGE_REPOSITORY",
    "MEND_VERSION",
    "DOCKER_SOCKET_PATH",
    ":/var/run/docker.sock",
    "services:",
    "  mend:",
    "  postgres:",
    "mend-store:",
    "mend-control:",
    "mend-config:",
    "mend-ssh:",
    "mend-rabbitmq:",
    "mend-registry:",
    "mend-postgres:",
    "/var/lib/mend/store",
    "/run/sealant/sockets",
  ];
  if (
    requiredFragments.some((fragment) => !body.includes(fragment)) ||
    serviceNames.join(",") !== "mend,postgres"
  ) {
    throw setupError(`Downloaded ${COMPOSE_ASSET} does not implement ${ASSET_CONTRACT}.`);
  }
};

const validatePostgresAsset = (body: string): void => {
  if (
    !body.startsWith("#!/bin/sh") ||
    !body.includes("MEND_DB_PASSWORD") ||
    !body.includes("SEALANT_DB_PASSWORD") ||
    !body.includes("CREATE ROLE mend") ||
    !body.includes("CREATE ROLE sealant") ||
    !body.includes("CREATE DATABASE mend") ||
    !body.includes("sealant_control_plane")
  ) {
    throw setupError(`Downloaded ${POSTGRES_INIT_ASSET} does not implement ${ASSET_CONTRACT}.`);
  }
};

const downloadAsset = async (
  runtime: ServerSetupRuntime,
  version: string,
  name: string,
): Promise<string> => {
  const url = `${RELEASE_BASE}/v${version}/${name}`;
  const response = await runtime.fetchText(url, 30_000);
  if (response.error !== undefined || response.status !== 200) {
    throw setupError(
      `Could not download ${name} for Mend ${version}: ${response.error ?? `HTTP ${response.status}`}.`,
    );
  }
  return response.body;
};

const renderSecrets = (secrets: ServerSecrets, config: ServerConfig): string => {
  const sshHost = parseUrl(config.appUrl, "Server config appUrl").hostname.replace(/^\[|\]$/g, "");
  const composeBind = net.isIP(config.bind) === 6 ? `[${config.bind}]` : config.bind;
  return [
    `MEND_VERSION=${config.serverVersion}`,
    "MEND_IMAGE_REPOSITORY=ghcr.io/sealant-sh/mend",
    `MEND_POSTGRES_ADMIN_PASSWORD=${secrets.postgresAdminPassword}`,
    `MEND_DB_PASSWORD=${secrets.mendDatabasePassword}`,
    `SEALANT_DB_PASSWORD=${secrets.sealantDatabasePassword}`,
    `MEND_RABBITMQ_PASSWORD=${secrets.queuePassword}`,
    `BETTER_AUTH_SECRET=${secrets.betterAuthSecret}`,
    `SEALANT_CREDENTIALS_KEY=${secrets.sealantCredentialsKey}`,
    `SEALANT_SERVICE_KEY=${secrets.sealantServiceKey}`,
    `WORKSPACE_SSH_GATEWAY_TOKEN=${secrets.workspaceSshGatewayToken}`,
    `APP_URL=${config.appUrl}`,
    `MEND_ALLOWED_ORIGINS=${JSON.stringify(config.allowedOrigins)}`,
    `MEND_BIND_HOST=${composeBind}`,
    `MEND_PORT=${config.appPort}`,
    `MEND_SSH_PORT=${config.sshPort}`,
    "MEND_REGISTRY_PORT=5000",
    `SEALANT_SSH_HOST=${sshHost}`,
    "MEND_STORE_VOLUME_NAME=mend-store",
    "MEND_CONTROL_VOLUME_NAME=mend-control",
    `DOCKER_SOCKET_PATH=${config.dockerSocket}`,
    "",
  ].join("\n");
};

let temporaryFileSequence = 0;

const writeAtomic = (file: string, content: string, mode: number): void => {
  temporaryFileSequence += 1;
  const temporary = `${file}.tmp-${process.pid}-${temporaryFileSequence}`;
  try {
    fs.writeFileSync(temporary, content, { encoding: "utf8", flag: "wx", mode });
    fs.renameSync(temporary, file);
    fs.chmodSync(file, mode);
  } catch (cause) {
    fs.rmSync(temporary, { force: true });
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw setupError(`Could not write ${file} atomically: ${detail}`);
  }
};

const loadExisting = (
  configDir: string,
): { readonly config: ServerConfig; readonly secrets: ServerSecrets } | null => {
  const configFile = path.join(configDir, "server.json");
  const envFile = path.join(configDir, "server.env");
  const composeFile = path.join(configDir, "compose.yaml");
  const initFile = path.join(configDir, "postgres-init.sh");
  const configExists = fs.existsSync(configFile);
  const relatedExists = [envFile, composeFile, initFile].some((file) => fs.existsSync(file));
  if (!configExists) {
    if (relatedExists) {
      throw setupError(
        `Server config is incomplete in ${configDir}. server.json is missing; restore or remove the interrupted setup files before retrying.`,
      );
    }
    return null;
  }
  if (!fs.existsSync(envFile)) {
    throw setupError(`Server config is corrupt: ${envFile} is missing. Restore it before setup.`);
  }
  try {
    const config = parseServerConfig(fs.readFileSync(configFile, "utf8"));
    const env = fs.readFileSync(envFile, "utf8");
    const secrets = parseSecrets(env);
    if (env !== renderSecrets(secrets, config)) {
      throw setupError(
        "Server secrets are corrupt: server.env does not match the persisted server config.",
      );
    }
    return { config, secrets };
  } catch (cause) {
    if (cause instanceof ServerSetupError) throw cause;
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw setupError(`Could not read server config in ${configDir}: ${detail}`);
  }
};

const persistSetup = (
  runtime: ServerSetupRuntime,
  config: ServerConfig,
  secrets: ServerSecrets,
  assets: { readonly compose: string; readonly postgresInit: string },
): void => {
  try {
    fs.mkdirSync(runtime.configDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(runtime.configDir, 0o700);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw setupError(`Could not prepare ${runtime.configDir}: ${detail}`);
  }
  writeAtomic(path.join(runtime.configDir, "compose.yaml"), assets.compose, 0o600);
  writeAtomic(path.join(runtime.configDir, "postgres-init.sh"), assets.postgresInit, 0o700);
  writeAtomic(path.join(runtime.configDir, "server.env"), renderSecrets(secrets, config), 0o600);
  writeAtomic(
    path.join(runtime.configDir, "server.json"),
    `${JSON.stringify(config, null, 2)}\n`,
    0o600,
  );
};

const readReusableAssets = (
  configDir: string,
): { readonly compose: string; readonly postgresInit: string } | null => {
  const composeFile = path.join(configDir, "compose.yaml");
  const initFile = path.join(configDir, "postgres-init.sh");
  if (!fs.existsSync(composeFile) || !fs.existsSync(initFile)) return null;
  const compose = fs.readFileSync(composeFile, "utf8");
  const postgresInit = fs.readFileSync(initFile, "utf8");
  validateComposeAsset(compose);
  validatePostgresAsset(postgresInit);
  return { compose, postgresInit };
};

const probeHealth = async (
  runtime: ServerSetupRuntime,
  appUrl: string,
  dockerContext: string,
): Promise<void> => {
  const healthUrl = `${appUrl}/api/health`;
  let lastFailure = "request did not complete";
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await runtime.fetchText(healthUrl, 2_000);
    if (response.error === undefined && response.status >= 200 && response.status < 300) return;
    lastFailure = response.error ?? `HTTP ${response.status}`;
    if (attempt < 29) await runtime.sleep(2_000);
  }
  throw setupError(
    `Mend started, but ${healthUrl} did not answer successfully (${lastFailure}). Check: docker --context ${dockerContext} compose -p mend logs.`,
  );
};

const resolveServerVersion = async (
  runtime: ServerSetupRuntime,
  options: SetupOptions,
  existing: ServerConfig | null,
): Promise<string> => {
  const requested = options.version ?? existing?.serverVersion ?? runtime.cliVersion;
  const version =
    requested === "latest" ? await resolveLatestVersion(runtime) : parseVersion(requested);
  if (version === "latest" || version === "unknown") {
    throw setupError("A fresh setup needs a released CLI version or an explicit --version.");
  }
  return version;
};

const resolveDockerSocket = (
  runtime: ServerSetupRuntime,
  options: SetupOptions,
  existing: ServerConfig | null,
  selectedContext: { readonly name: string; readonly endpoint: string },
): string => {
  const contextWasReplaced =
    options.context !== undefined &&
    existing !== null &&
    options.context !== existing.dockerContext;
  let endpointSocket: string;
  try {
    endpointSocket = decodeURIComponent(new URL(selectedContext.endpoint).pathname);
  } catch {
    throw setupError(`Docker context "${selectedContext.name}" returned an invalid Unix endpoint.`);
  }
  const socket =
    options.dockerSocket ??
    (contextWasReplaced ? undefined : existing?.dockerSocket) ??
    (runtime.platform === "darwin" ? "/var/run/docker.sock" : endpointSocket);
  if (!path.isAbsolute(socket) || /[\r\n]/.test(socket)) {
    throw setupError("--docker-socket must be an absolute path with no line breaks.");
  }
  return socket;
};

const resolveAssets = async (
  runtime: ServerSetupRuntime,
  serverVersion: string,
  existing: ServerConfig | null,
): Promise<{ readonly compose: string; readonly postgresInit: string }> => {
  if (existing?.serverVersion === serverVersion && existing.assetContract === ASSET_CONTRACT) {
    try {
      const reusable = readReusableAssets(runtime.configDir);
      if (reusable !== null) return reusable;
    } catch (cause) {
      if (!(cause instanceof ServerSetupError)) throw cause;
      runtime.writeLine("Stored server assets are invalid; downloading the pinned release again.");
    }
  }
  const [compose, postgresInit] = await Promise.all([
    downloadAsset(runtime, serverVersion, COMPOSE_ASSET),
    downloadAsset(runtime, serverVersion, POSTGRES_INIT_ASSET),
  ]);
  validateComposeAsset(compose);
  validatePostgresAsset(postgresInit);
  return { compose, postgresInit };
};

const startCompose = async (runtime: ServerSetupRuntime, config: ServerConfig): Promise<void> => {
  const compose = await runtime.run("docker", [
    "--context",
    config.dockerContext,
    "compose",
    "--project-name",
    "mend",
    "--project-directory",
    runtime.configDir,
    "--env-file",
    path.join(runtime.configDir, "server.env"),
    "-f",
    path.join(runtime.configDir, "compose.yaml"),
    "up",
    "-d",
    "--wait",
  ]);
  if (compose.status !== 0) throw commandFailure("Mend containers did not start", compose);
};

const setupServer = async (
  args: ReadonlyArray<string>,
  runtime: ServerSetupRuntime,
): Promise<void> => {
  if (runtime.platform !== "linux" && runtime.platform !== "darwin") {
    throw setupError(`mend server setup supports Linux and macOS, not ${runtime.platform}.`);
  }
  const options = parseSetupOptions(args);
  const existing = loadExisting(runtime.configDir);
  const selectedContext = await selectDockerContext(
    runtime,
    options.context ?? existing?.config.dockerContext,
  );
  await checkDocker(runtime, selectedContext.name);

  const serverVersion = await resolveServerVersion(runtime, options, existing?.config ?? null);
  const config: ServerConfig = {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    assetContract: ASSET_CONTRACT,
    serverVersion,
    dockerContext: selectedContext.name,
    dockerEndpoint: selectedContext.endpoint,
    dockerSocket: resolveDockerSocket(runtime, options, existing?.config ?? null, selectedContext),
    ...validateExposure(existing?.config ?? null, options),
  };
  const secrets = existing?.secrets ?? createSecrets(runtime);
  const assets = await resolveAssets(runtime, serverVersion, existing?.config ?? null);

  persistSetup(runtime, config, secrets, assets);
  runtime.writeLine(`Using Docker context "${config.dockerContext}" (${config.dockerEndpoint})`);
  await startCompose(runtime, config);
  await probeHealth(runtime, config.appUrl, config.dockerContext);
  runtime.writeLine(`Mend ${config.serverVersion} is reachable at ${config.appUrl}`);
  runtime.writeLine(
    `Open ${config.appUrl}, create the first account, then run: mend login --url ${config.appUrl}`,
  );
};

const nodeServerSetupRuntime = (): ServerSetupRuntime => {
  const home = os.homedir();
  const configHome = process.env["XDG_CONFIG_HOME"] ?? path.join(home, ".config");
  return {
    configDir: path.join(configHome, "mend"),
    platform: process.platform,
    cliVersion: cliVersion(),
    run: (command, args) =>
      new Promise<CommandOutput>((resolve) => {
        const child = spawn(command, [...args], { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => {
          stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.once("error", (error) =>
          resolve({ status: null, stdout, stderr, error: error.message }),
        );
        child.once("close", (status) => resolve({ status, stdout, stderr }));
      }),
    fetchText: async (url, timeoutMs) => {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        return { status: response.status, body: await response.text() };
      } catch (cause) {
        return {
          status: 0,
          body: "",
          error: cause instanceof Error ? cause.message : String(cause),
        };
      }
    },
    randomBytes,
    sleep: (milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
    writeLine: (line) => process.stdout.write(`${line}\n`),
  };
};

/** Run the `mend server` command family through a supplied or real runtime. */
export const serverCommand = async (
  args: ReadonlyArray<string>,
  runtime: ServerSetupRuntime = nodeServerSetupRuntime(),
): Promise<ServerCommandResult> => {
  const [command, ...rest] = args;
  if (command !== "setup") {
    return { _tag: "error", message: "usage: mend server setup [options]" };
  }
  try {
    await setupServer(rest, runtime);
    return { _tag: "ok" };
  } catch (cause) {
    if (cause instanceof ServerSetupError) return { _tag: "error", message: cause.message };
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { _tag: "error", message: `Server setup failed unexpectedly: ${detail}` };
  }
};
