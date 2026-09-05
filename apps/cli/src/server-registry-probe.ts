import { Buffer } from "node:buffer";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { ServerProcessOutput } from "./server-runtime.ts";

/**
 * Controlled process runner. It must enforce timeoutMs and wait for process termination before
 * resolving, including on timeout. Do not implement the deadline with an uncancelled Promise.race.
 */
export interface ServerRegistryProbeRuntime {
  run(
    command: string,
    args: ReadonlyArray<string>,
    options: { readonly timeoutMs: number },
  ): Promise<ServerProcessOutput>;
}

/** Caller supplies fresh cryptographic randomness, e.g. runtime.randomBytes(24).toString("hex"). */
export interface ServerRegistryProbeInput {
  readonly dockerContext: string;
  readonly registryPort: number;
  /** Fresh per attempt. Never reuse a setup secret or installation identity as the nonce. */
  readonly nonce: string;
  /** Existing writable directory for a private mkdtemp child. No ambient temp configuration is read. */
  readonly temporaryDirectory: string;
}

type Stage =
  | "input"
  | "temporary-files"
  | "collision-check"
  | "import"
  | "push"
  | "remove-local"
  | "pull"
  | "inspect"
  | "cleanup";

/** Engine failures retain the failing stage and a bounded, credential-scrubbed diagnostic. */
export class ServerRegistryProbeError extends Error {
  /** Stable error discriminator. */
  readonly _tag = "ServerRegistryProbeError" as const;

  /** Failed roundtrip operation, independent of the host operating system. */
  readonly stage: Stage;
  /** Bounded, credential-scrubbed failure detail. */
  readonly diagnostic: string;

  /** Explain the failed Engine operation without recommending a wider registry binding. */
  constructor(stage: Stage, diagnostic: string) {
    super(
      `Docker registry probe failed (${stage}): ${diagnostic}. ` +
        "The selected Docker Engine must import, push and pull through 127.0.0.1 at the configured registry port. " +
        "Check bundle health, Docker context and Engine loopback registry support, then retry. Do not widen the registry binding.",
    );
    this.stage = stage;
    this.diagnostic = diagnostic;
  }
}

/** Cleanup warnings never hide the primary failure or turn an unobserved roundtrip into success. */
export type ServerRegistryProbeResult =
  | {
      readonly _tag: "ok";
      readonly value: { readonly reference: string; readonly imageId: string };
      readonly cleanupWarnings: ReadonlyArray<ServerRegistryProbeError>;
    }
  | {
      readonly _tag: "error";
      readonly error: ServerRegistryProbeError;
      readonly cleanupWarnings: ReadonlyArray<ServerRegistryProbeError>;
    };

type Result<T> =
  | { readonly _tag: "ok"; readonly value: T }
  | { readonly _tag: "error"; readonly error: ServerRegistryProbeError };

const PROBE_LABEL = "dev.sealant.mend.registry-probe";
const COMMAND_TIMEOUT_MS = 60_000;
const CLEANUP_TIMEOUT_MS = 15_000;
const error = (stage: Stage, diagnostic: string) =>
  ({ _tag: "error", error: new ServerRegistryProbeError(stage, diagnostic) }) as const;

const safeDiagnostic = (text: string): string =>
  text
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1[redacted]@")
    .replace(
      /((?:password|passwd|token|secret|authorization|credential)[\w-]*\s*[=:]\s*)[^\s,;]+/gi,
      "$1[redacted]",
    )
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .split("")
    .map((character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? " " : character,
    )
    .join("")
    .slice(0, 2048);

const docker = async (
  runtime: ServerRegistryProbeRuntime,
  context: string,
  stage: Stage,
  args: ReadonlyArray<string>,
): Promise<Result<string>> => {
  try {
    const output = await runtime.run("docker", ["--context", context, ...args], {
      timeoutMs: stage === "cleanup" ? CLEANUP_TIMEOUT_MS : COMMAND_TIMEOUT_MS,
    });
    if (output.status !== 0 || output.error !== undefined)
      return error(
        stage,
        safeDiagnostic(
          output.error ?? (output.stderr.trim() || `exit ${output.status ?? "unknown"}`),
        ),
      );
    return { _tag: "ok", value: output.stdout };
  } catch {
    // Arbitrary exception objects may contain command environments or authentication state.
    return error(
      stage,
      "Process runner rejected; check Docker access and command timeout handling",
    );
  }
};

// One regular file, padded to a 512-byte block, then two end-of-archive blocks. No host tar/buildx.
const tinyRootfs = (nonce: string): Buffer => {
  const body = Buffer.from(`Mend registry connectivity probe ${nonce}\n`);
  const header = Buffer.alloc(512);
  const field = (value: string, offset: number, length: number) =>
    header.write(value, offset, length, "ascii");
  field("mend-registry-probe", 0, 100);
  field("0000600\0", 100, 8);
  field("0000000\0", 108, 8);
  field("0000000\0", 116, 8);
  field(`${body.length.toString(8).padStart(11, "0")}\0`, 124, 12);
  field("00000000000\0", 136, 12);
  field("        ", 148, 8);
  field("0", 156, 1);
  field("ustar\0", 257, 6);
  field("00", 263, 2);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  field(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8);
  return Buffer.concat([header, body, Buffer.alloc(512 - body.length), Buffer.alloc(1024)]);
};

const imageExists = async (
  runtime: ServerRegistryProbeRuntime,
  input: ServerRegistryProbeInput,
  reference: string,
  stage: Stage,
): Promise<Result<boolean>> => {
  const listed = await docker(runtime, input.dockerContext, stage, [
    "image",
    "ls",
    "--all",
    "--filter",
    `reference=${reference}`,
    "--format",
    "{{json .ID}}",
  ]);
  if (listed._tag === "error") return listed;
  try {
    const lines = listed.value.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      const id: unknown = JSON.parse(line);
      if (typeof id !== "string" || !/^(?:sha256:)?[a-f0-9]{12,64}$/.test(id))
        return error(stage, "Docker returned an inconclusive image listing");
    }
    return { _tag: "ok", value: lines.length > 0 };
  } catch {
    return error(stage, "Docker returned an invalid image listing");
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const ownedImage = async (
  runtime: ServerRegistryProbeRuntime,
  input: ServerRegistryProbeInput,
  reference: string,
  stage: Stage,
): Promise<Result<string>> => {
  const inspected = await docker(runtime, input.dockerContext, stage, [
    "image",
    "inspect",
    reference,
    "--format",
    "{{json .}}",
  ]);
  if (inspected._tag === "error") return inspected;
  try {
    const image: unknown = JSON.parse(inspected.value);
    if (
      !isRecord(image) ||
      typeof image.Id !== "string" ||
      !/^sha256:[a-f0-9]{64}$/.test(image.Id) ||
      !isRecord(image.Config) ||
      !isRecord(image.Config.Labels) ||
      image.Config.Labels[PROBE_LABEL] !== input.nonce
    )
      return error(stage, "Image ownership or ID could not be verified; the image was retained");
    return { _tag: "ok", value: image.Id };
  } catch {
    return error(stage, "Docker returned an invalid image inspection; the image was retained");
  }
};

const removeOwnedTag = async (
  runtime: ServerRegistryProbeRuntime,
  input: ServerRegistryProbeInput,
  reference: string,
  stage: "remove-local" | "cleanup",
): Promise<Result<void>> => {
  const exists = await imageExists(runtime, input, reference, stage);
  if (exists._tag === "error") return exists;
  if (!exists.value) return { _tag: "ok", value: undefined };
  const owned = await ownedImage(runtime, input, reference, stage);
  if (owned._tag === "error") return owned;
  // Never remove by image ID, force removal, prune, or touch another tag.
  const removed = await docker(runtime, input.dockerContext, stage, ["image", "rm", reference]);
  return removed._tag === "error" ? removed : { _tag: "ok", value: undefined };
};

const roundtrip = async (
  runtime: ServerRegistryProbeRuntime,
  input: ServerRegistryProbeInput,
  reference: string,
  tarPath: string,
): Promise<Result<string>> => {
  const imported = await docker(runtime, input.dockerContext, "import", [
    "image",
    "import",
    "--change",
    `LABEL ${PROBE_LABEL}=${input.nonce}`,
    tarPath,
    reference,
  ]);
  if (imported._tag === "error") return imported;
  const original = await ownedImage(runtime, input, reference, "inspect");
  if (original._tag === "error") return original;
  const pushed = await docker(runtime, input.dockerContext, "push", ["image", "push", reference]);
  if (pushed._tag === "error") return pushed;
  const removed = await removeOwnedTag(runtime, input, reference, "remove-local");
  if (removed._tag === "error") return removed;
  const absent = await imageExists(runtime, input, reference, "remove-local");
  if (absent._tag === "error") return absent;
  if (absent.value)
    return error("remove-local", "Probe tag remained local; refusing to claim a pull roundtrip");
  const pulled = await docker(runtime, input.dockerContext, "pull", ["image", "pull", reference]);
  if (pulled._tag === "error") return pulled;
  const observed = await ownedImage(runtime, input, reference, "inspect");
  if (observed._tag === "error") return observed;
  return observed.value === original.value
    ? observed
    : error("inspect", "Pulled image ID differs from the imported image ID");
};

const parseProbeReference = (input: ServerRegistryProbeInput): Result<string> => {
  if (
    !input.dockerContext.trim() ||
    !Number.isInteger(input.registryPort) ||
    input.registryPort < 1 ||
    input.registryPort > 65535 ||
    !/^[a-f0-9]{32,64}$/.test(input.nonce) ||
    !path.isAbsolute(input.temporaryDirectory)
  )
    return error(
      "input",
      "Expected an explicit context, TCP port, fresh 16 to 32 byte hex nonce and absolute temporary directory",
    );
  return {
    _tag: "ok",
    value: `127.0.0.1:${input.registryPort}/mend-registry-probe/${input.nonce}:probe`,
  };
};

/**
 * After bundle health, observe an actual Engine push/remove/pull through 127.0.0.1:registryPort.
 * Creates only a tiny nonce-tagged image and a private temporary directory. Local cleanup checks
 * ownership even after partial failure. The tiny remote probe remains in the registry: manifest
 * deletion is not enabled by the bundle and this helper never changes registry configuration.
 */
export const probeServerRegistry = async (
  runtime: ServerRegistryProbeRuntime,
  input: ServerRegistryProbeInput,
): Promise<ServerRegistryProbeResult> => {
  const cleanupWarnings: ServerRegistryProbeError[] = [];
  const parsed = parseProbeReference(input);
  if (parsed._tag === "error") return { ...parsed, cleanupWarnings };
  const reference = parsed.value;
  const exists = await imageExists(runtime, input, reference, "collision-check");
  if (exists._tag === "error") return { ...exists, cleanupWarnings };
  if (exists.value)
    return {
      ...error(
        "collision-check",
        "Probe reference already exists; supply a fresh nonce. Existing image retained",
      ),
      cleanupWarnings,
    };
  let directory: string;
  try {
    directory = await fs.mkdtemp(path.join(input.temporaryDirectory, "mend-registry-probe-"));
  } catch {
    return {
      ...error("temporary-files", "Could not create private probe directory"),
      cleanupWarnings,
    };
  }
  let result: Result<string>;
  let importAttempted = false;
  try {
    const tarPath = path.join(directory, "rootfs.tar");
    await fs.writeFile(tarPath, tinyRootfs(input.nonce), { mode: 0o600, flag: "wx" });
    importAttempted = true;
    result = await roundtrip(runtime, input, reference, tarPath);
  } catch {
    result = error("temporary-files", "Could not write the private probe archive");
  } finally {
    if (importAttempted) {
      const cleanup = await removeOwnedTag(runtime, input, reference, "cleanup");
      if (cleanup._tag === "error") cleanupWarnings.push(cleanup.error);
    }
    try {
      await fs.rm(directory, { recursive: true, force: true });
    } catch {
      cleanupWarnings.push(
        new ServerRegistryProbeError(
          "cleanup",
          `Could not remove private probe directory ${directory}`,
        ),
      );
    }
  }
  return result._tag === "error"
    ? { ...result, cleanupWarnings }
    : {
        _tag: "ok",
        value: { reference, imageId: result.value },
        cleanupWarnings,
      };
};
