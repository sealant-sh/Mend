import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { isIP } from "node:net";
import * as os from "node:os";
import * as path from "node:path";

const LEGACY_BLOCK_BEGIN = "# >>> mend workspace ssh (managed by `mend ssh setup`) >>>";
const LEGACY_BLOCK_END = "# <<< mend workspace ssh <<<";

/** A successful value or a caller-visible workspace SSH setup failure. */
export type WorkspaceSshResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: WorkspaceSshError };

/** A parsed or I/O failure while preparing this client's workspace SSH access. */
export class WorkspaceSshError extends Error {
  readonly _tag = "WorkspaceSshError" as const;

  /** Which setup operation failed. */
  readonly operation: "target" | "key" | "config";

  /** The underlying process or filesystem failure, when one exists. */
  override readonly cause: unknown;

  constructor(operation: "target" | "key" | "config", message: string, cause: unknown = undefined) {
    super(message, { cause });
    this.operation = operation;
    this.cause = cause;
  }
}

/** Stable client-side SSH coordinates for one configured Mend server. */
export interface WorkspaceSshTarget {
  /** Stable per-server OpenSSH alias. */
  readonly alias: string;
  /** Host reached by OpenSSH, without URL scheme or port. */
  readonly hostname: string;
  /** Published workspace SSH port reported by the server. */
  readonly port: number;
  /** Canonical configured Mend URL used to distinguish managed blocks. */
  readonly serverIdentity: string;
}

/** A public key available to register for workspace SSH. */
export interface WorkspaceSshKey {
  readonly publicKey: string;
  /** Null means OpenSSH should ask the running ssh-agent for the private key. */
  readonly identityFile: string | null;
  readonly source: "explicit" | "agent" | "existing" | "generated";
  readonly fingerprint: string;
}

/** Exact readiness facts for this server, key, host, and published port. */
export interface WorkspaceSshReadiness {
  readonly ready: boolean;
  readonly configReady: boolean;
  readonly keyRegistered: boolean;
}

const success = <T>(value: T): WorkspaceSshResult<T> => ({ ok: true, value });
const failure = <T>(error: WorkspaceSshError): WorkspaceSshResult<T> => ({ ok: false, error });

const stripIpv6Brackets = (hostname: string): string =>
  hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;

const hashIdentity = (identity: string): string => {
  let hash = 0x811c9dc5;
  for (const character of identity) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
};

const aliasLabel = (hostname: string): string => {
  const label = hostname
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  return label === "" ? "server" : label;
};

const parseHostOverride = (raw: string): WorkspaceSshResult<string> => {
  const hostname = raw.trim();
  if (hostname === "") return failure(new WorkspaceSshError("target", "SSH hostname is empty."));
  if (hostname.includes("://") || /[\s/@]/.test(hostname)) {
    return failure(
      new WorkspaceSshError(
        "target",
        "SSH hostname must be a hostname or IP address without a scheme, path, or port.",
      ),
    );
  }
  if (/^[^:]+:\d+$/.test(hostname)) {
    return failure(
      new WorkspaceSshError(
        "target",
        "SSH hostname must not include a port; Mend uses the published gateway port.",
      ),
    );
  }
  if ((hostname.startsWith("[") || hostname.endsWith("]")) && !/^\[[^\]]+\]$/.test(hostname)) {
    return failure(new WorkspaceSshError("target", "SSH hostname contains invalid IPv6 brackets."));
  }
  const unbracketed = stripIpv6Brackets(hostname);
  if ((hostname.startsWith("[") || unbracketed.includes(":")) && isIP(unbracketed) !== 6) {
    return failure(
      new WorkspaceSshError("target", "SSH hostname contains an invalid IPv6 address."),
    );
  }
  return success(unbracketed);
};

/**
 * Parse the configured Mend URL and combine its hostname with the gateway's published SSH port.
 * An explicit hostname changes only routing; server identity and the port still come from Mend.
 */
export const parseWorkspaceSshTarget = (input: {
  readonly serverUrl: string;
  readonly publishedPort: number;
  readonly hostnameOverride?: string | null;
}): WorkspaceSshResult<WorkspaceSshTarget> => {
  let server: URL;
  try {
    server = new URL(input.serverUrl);
  } catch (cause) {
    return failure(
      new WorkspaceSshError("target", `Mend server URL is invalid: ${input.serverUrl}`, cause),
    );
  }
  if (server.protocol !== "http:" && server.protocol !== "https:") {
    return failure(new WorkspaceSshError("target", "Mend server URL must use http or https."));
  }
  if (server.hostname === "") {
    return failure(new WorkspaceSshError("target", "Mend server URL has no hostname."));
  }
  if (
    !Number.isInteger(input.publishedPort) ||
    input.publishedPort < 1 ||
    input.publishedPort > 65_535
  ) {
    return failure(new WorkspaceSshError("target", "Published workspace SSH port is invalid."));
  }

  const serverIdentity = server.toString().replace(/\/$/, "");
  const defaultHostname = stripIpv6Brackets(server.hostname);
  const override = input.hostnameOverride?.trim() ?? "";
  const parsedHostname = override === "" ? success(defaultHostname) : parseHostOverride(override);
  if (parsedHostname.ok === false) return failure(parsedHostname.error);
  return success({
    alias: `mend-ws-${aliasLabel(defaultHostname)}-${hashIdentity(serverIdentity)}`,
    hostname: parsedHostname.value,
    port: input.publishedPort,
    serverIdentity,
  });
};

const blockBegin = (alias: string): string => `# >>> mend workspace ssh ${alias} (managed) >>>`;
const blockEnd = (alias: string): string => `# <<< mend workspace ssh ${alias} <<<`;

/** Render the complete managed OpenSSH block for one Mend server. */
export const managedWorkspaceSshBlock = (
  target: WorkspaceSshTarget,
  identityFile: string | null,
): string =>
  [
    blockBegin(target.alias),
    `Host ${target.alias}`,
    `  HostName ${target.hostname}`,
    `  Port ${target.port}`,
    `  HostKeyAlias ${target.alias}`,
    ...(identityFile === null ? [] : [`  IdentityFile ${identityFile}`, "  IdentitiesOnly yes"]),
    "  StrictHostKeyChecking accept-new",
    blockEnd(target.alias),
    "",
  ].join("\n");

const removeManagedBlock = (
  config: string,
  beginMarker: string,
  endMarker: string,
): WorkspaceSshResult<string> => {
  const begin = config.indexOf(beginMarker);
  if (begin === -1) return success(config);
  const end = config.indexOf(endMarker, begin + beginMarker.length);
  if (end === -1) {
    return failure(
      new WorkspaceSshError(
        "config",
        `Managed SSH config block beginning with "${beginMarker}" has no closing marker.`,
      ),
    );
  }
  const after = config.slice(end + endMarker.length).replace(/^\n/, "");
  return success(`${config.slice(0, begin)}${after}`);
};

const containsExactHost = (config: string, alias: string): boolean =>
  config.split("\n").some((line) => {
    const match = /^\s*Host\s+(.+?)\s*$/.exec(line);
    return match?.[1]?.split(/\s+/).includes(alias) === true;
  });

/**
 * Replace this server's managed block and migrate Mend's old global block. Other servers and every
 * hand-written byte stay in place. A hand-written block using the generated alias is reported.
 */
export const reconcileWorkspaceSshConfig = (
  existing: string,
  target: WorkspaceSshTarget,
  identityFile: string | null,
): WorkspaceSshResult<string> => {
  const withoutCurrent = removeManagedBlock(
    existing,
    blockBegin(target.alias),
    blockEnd(target.alias),
  );
  if (!withoutCurrent.ok) return withoutCurrent;
  const withoutLegacy = removeManagedBlock(
    withoutCurrent.value,
    LEGACY_BLOCK_BEGIN,
    LEGACY_BLOCK_END,
  );
  if (!withoutLegacy.ok) return withoutLegacy;
  if (containsExactHost(withoutLegacy.value, target.alias)) {
    return failure(
      new WorkspaceSshError(
        "config",
        `SSH config already has a hand-written Host ${target.alias} block; Mend left it unchanged.`,
      ),
    );
  }
  const block = managedWorkspaceSshBlock(target, identityFile);
  if (withoutLegacy.value === "") return success(block);
  const separator = withoutLegacy.value.endsWith("\n\n")
    ? ""
    : withoutLegacy.value.endsWith("\n")
      ? "\n"
      : "\n\n";
  return success(`${withoutLegacy.value}${separator}${block}`);
};

/** SHA-256 fingerprint in the same `SHA256:…` form OpenSSH and the server report. */
export const workspaceSshPublicKeyFingerprint = (publicKey: string): WorkspaceSshResult<string> => {
  const encoded = publicKey.trim().split(/\s+/)[1];
  if (encoded === undefined || encoded === "") {
    return failure(new WorkspaceSshError("key", "SSH public key has no encoded key data."));
  }
  try {
    const digest = createHash("sha256").update(Buffer.from(encoded, "base64")).digest("base64");
    return success(`SHA256:${digest.replace(/=+$/, "")}`);
  } catch (cause) {
    return failure(
      new WorkspaceSshError("key", "SSH public key could not be fingerprinted.", cause),
    );
  }
};

/** The first public key line offered by `ssh-add -L`, or null when no key line is present. */
export const firstWorkspaceSshAgentKey = (output: string): string | null => {
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    const algorithm = trimmed.split(/\s+/)[0];
    if (algorithm?.startsWith("ssh-") === true || algorithm?.startsWith("ecdsa-") === true) {
      return trimmed;
    }
  }
  return null;
};

const readText = (file: string): WorkspaceSshResult<string> => {
  try {
    return success(fs.readFileSync(file, "utf8"));
  } catch (cause) {
    const error = cause instanceof Error && "code" in cause ? cause.code : undefined;
    return error === "ENOENT"
      ? success("")
      : failure(new WorkspaceSshError("key", `Could not read ${file}.`, cause));
  }
};

/**
 * Read the identity file from this server's managed block. Null means the block is absent,
 * incomplete, or relies on ssh-agent.
 */
export const configuredWorkspaceSshIdentityFile = (
  config: string,
  target: WorkspaceSshTarget,
): string | null => {
  const begin = config.indexOf(blockBegin(target.alias));
  if (begin === -1) return null;
  const end = config.indexOf(blockEnd(target.alias), begin);
  if (end === -1) return null;
  const block = config.slice(begin, end);
  const match = /^\s*IdentityFile\s+(.+?)\s*$/m.exec(block);
  return match?.[1] ?? null;
};

type WorkspaceSshKeyMaterial = Omit<WorkspaceSshKey, "fingerprint">;

const publicKeyPath = (keyPath: string): string =>
  keyPath.endsWith(".pub") ? keyPath : `${keyPath}.pub`;

const keyMaterial = (
  publicKey: string,
  publicPath: string,
  source: WorkspaceSshKey["source"],
): WorkspaceSshKeyMaterial => ({
  publicKey: publicKey.trim(),
  identityFile: publicPath.slice(0, -".pub".length),
  source,
});

const readRequiredKey = (
  keyPath: string,
  source: WorkspaceSshKey["source"],
): WorkspaceSshResult<WorkspaceSshKeyMaterial> => {
  const publicPath = publicKeyPath(keyPath);
  const read = readText(publicPath);
  if (read.ok === false) return failure(read.error);
  if (read.value.trim() === "") {
    return failure(new WorkspaceSshError("key", `No public key exists at ${publicPath}.`));
  }
  return success(keyMaterial(read.value, publicPath, source));
};

const readOptionalKey = (keyPath: string): WorkspaceSshResult<WorkspaceSshKeyMaterial | null> => {
  const publicPath = publicKeyPath(keyPath);
  const read = readText(publicPath);
  if (read.ok === false) return failure(read.error);
  return success(read.value.trim() === "" ? null : keyMaterial(read.value, publicPath, "existing"));
};

const agentKey = (): WorkspaceSshKeyMaterial | null => {
  const socket = process.env["SSH_AUTH_SOCK"];
  if (socket === undefined || socket === "") return null;
  const listed = spawnSync("ssh-add", ["-L"], { encoding: "utf8" });
  const publicKey = listed.status === 0 ? firstWorkspaceSshAgentKey(listed.stdout) : null;
  return publicKey === null ? null : { publicKey, identityFile: null, source: "agent" };
};

const generateDedicatedKey = (privatePath: string): WorkspaceSshResult<WorkspaceSshKeyMaterial> => {
  try {
    fs.mkdirSync(path.dirname(privatePath), { recursive: true, mode: 0o700 });
  } catch (cause) {
    return failure(
      new WorkspaceSshError("key", `Could not create ${path.dirname(privatePath)}.`, cause),
    );
  }
  const generated = spawnSync(
    "ssh-keygen",
    ["-t", "ed25519", "-f", privatePath, "-N", "", "-C", `mend-${os.hostname()}`],
    { encoding: "utf8" },
  );
  if (generated.status !== 0) {
    return failure(
      new WorkspaceSshError(
        "key",
        `ssh-keygen failed: ${generated.stderr.trim() || "unknown error"}`,
      ),
    );
  }
  const fresh = readRequiredKey(privatePath, "generated");
  if (fresh.ok === false) {
    return failure(
      new WorkspaceSshError(
        "key",
        `ssh-keygen succeeded but ${publicKeyPath(privatePath)} is missing.`,
        fresh.error,
      ),
    );
  }
  return fresh;
};

const dedicatedKey = (
  configHome: string,
  create: boolean,
): WorkspaceSshResult<WorkspaceSshKeyMaterial | null> => {
  const privatePath = path.join(configHome, "ssh", "id_ed25519");
  const existing = readOptionalKey(privatePath);
  if (existing.ok === false) return failure(existing.error);
  if (existing.value !== null || !create) return existing;
  return generateDedicatedKey(privatePath);
};

/**
 * Pick the key this client can use. The explicit key or this server's configured identity wins,
 * then agent and dedicated keys. Generation happens only when `create` is true.
 */
export const pickWorkspaceSshKey = (input: {
  readonly configHome: string;
  readonly explicitKeyPath?: string | null;
  readonly configuredIdentityFile?: string | null;
  readonly create: boolean;
}): WorkspaceSshResult<WorkspaceSshKey | null> => {
  const explicit = input.explicitKeyPath?.trim() ?? "";
  const configured = input.configuredIdentityFile?.trim() ?? "";
  let material: WorkspaceSshKeyMaterial | null;

  if (explicit !== "") {
    const read = readRequiredKey(explicit, "explicit");
    if (read.ok === false) return failure(read.error);
    material = read.value;
  } else {
    const fromConfig = configured === "" ? success(null) : readOptionalKey(configured);
    if (fromConfig.ok === false) return failure(fromConfig.error);
    material = fromConfig.value ?? agentKey();
    if (material === null) {
      const dedicated = dedicatedKey(input.configHome, input.create);
      if (dedicated.ok === false) return failure(dedicated.error);
      material = dedicated.value;
    }
  }

  if (material === null) return success(null);
  const fingerprint = workspaceSshPublicKeyFingerprint(material.publicKey);
  if (fingerprint.ok === false) return failure(fingerprint.error);
  return success({ ...material, fingerprint: fingerprint.value });
};

/** Compare the exact managed block and this client's key with the server's registered keys. */
export const inspectWorkspaceSshReadiness = (input: {
  readonly config: string;
  readonly target: WorkspaceSshTarget;
  readonly key: WorkspaceSshKey | null;
  readonly registeredFingerprints: ReadonlyArray<string>;
}): WorkspaceSshReadiness => {
  const configReady =
    input.key !== null &&
    input.config.includes(managedWorkspaceSshBlock(input.target, input.key.identityFile));
  const keyRegistered =
    input.key !== null && input.registeredFingerprints.includes(input.key.fingerprint);
  return { ready: configReady && keyRegistered, configReady, keyRegistered };
};

/** Read a UTF-8 OpenSSH config, treating an absent file as empty. */
export const readWorkspaceSshConfig = (configFile: string): WorkspaceSshResult<string> => {
  const read = readText(configFile);
  if (read.ok === true) return read;
  return failure(new WorkspaceSshError("config", `Could not read ${configFile}.`, read.error));
};

/** Reconcile one server block on disk and enforce normal OpenSSH directory and file modes. */
export const writeWorkspaceSshConfig = (
  configFile: string,
  target: WorkspaceSshTarget,
  identityFile: string | null,
): WorkspaceSshResult<void> => {
  const before = readWorkspaceSshConfig(configFile);
  if (before.ok === false) return failure(before.error);
  const reconciled = reconcileWorkspaceSshConfig(before.value, target, identityFile);
  if (reconciled.ok === false) return failure(reconciled.error);
  try {
    fs.mkdirSync(path.dirname(configFile), { recursive: true, mode: 0o700 });
    fs.chmodSync(path.dirname(configFile), 0o700);
    fs.writeFileSync(configFile, reconciled.value, { mode: 0o600 });
    fs.chmodSync(configFile, 0o600);
    return success(undefined);
  } catch (cause) {
    return failure(new WorkspaceSshError("config", `Could not write ${configFile}.`, cause));
  }
};
