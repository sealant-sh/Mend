import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Storage failures include busy locks and recovery guidance; messages never contain file contents. */
export class ServerStoreError extends Error {
  readonly _tag = "ServerStoreError" as const;
}

/** Expected filesystem failures stay values at the store boundary. */
export type ServerStoreResult<T> =
  | { readonly _tag: "ok"; readonly value: T }
  | { readonly _tag: "error"; readonly error: ServerStoreError };

/** Complete deployment files, committed together. Only postgresInit is public; identity never changes. */
export interface ServerFiles {
  readonly identity: string;
  readonly config: string;
  readonly env: string;
  readonly compose: string;
  readonly postgresInit: string;
}

/** An immutable deployment snapshot. Use this directory, not the active symlink, for Compose. */
export interface ServerGeneration {
  readonly directory: string;
  readonly files: ServerFiles;
}

/** Valid only inside withServerStore. All lifecycle commands must use the same lock. */
export interface ServerStore {
  readIdentity(): ServerStoreResult<string | null>;
  readActive(): ServerStoreResult<ServerGeneration | null>;
  /** Retains generations, reuses compatible identical active files, and refuses identity replacement. */
  commit(files: ServerFiles): ServerStoreResult<ServerGeneration>;
  /** Prepare without selecting; identical active files require compatible init permissions for reuse. */
  prepare(files: ServerFiles): ServerStoreResult<ServerGeneration>;
  /** Select a retained generation from this store without rewriting it. */
  activate(generation: ServerGeneration): ServerStoreResult<void>;
}

interface StorePaths {
  readonly configDir: string;
  readonly identity: string;
  readonly generations: string;
  readonly active: string;
}

interface OwnedLock {
  assertOwned(): void;
  release(): ServerStoreResult<void>;
}

const storeError = (cause: unknown): ServerStoreError => {
  if (cause instanceof ServerStoreError) return cause;
  const detail = cause instanceof Error ? cause.message : "unknown filesystem error";
  return new ServerStoreError(
    `Server storage operation failed: ${detail}. Retain the identity and generations; fix the filesystem problem and retry.`,
  );
};

const attempt = <T>(operation: () => T): ServerStoreResult<T> => {
  try {
    return { _tag: "ok", value: operation() };
  } catch (cause) {
    return { _tag: "error", error: storeError(cause) };
  }
};

const hasCode = (cause: unknown, code: string): boolean =>
  cause instanceof Error && "code" in cause && cause.code === code;

const readOptional = (file: string): string | null => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (cause) {
    if (hasCode(cause, "ENOENT")) return null;
    throw cause;
  }
};

const syncDirectory = (directory: string): void => {
  const fd = fs.openSync(directory, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
};

const writeDurable = (file: string, content: string, mode = 0o600): void => {
  const fd = fs.openSync(file, "wx", mode);
  try {
    fs.writeFileSync(fd, content, "utf8");
    // Creation modes are masked by umask, but the bind-mounted init must be executable by UID 70.
    fs.fchmodSync(fd, mode);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
};

const fileKeys = ["identity", "config", "env", "compose", "postgresInit"] as const;
const fileNames = {
  identity: "identity.env",
  config: "server.json",
  env: "server.env",
  compose: "compose.yaml",
  postgresInit: "postgres-init.sh",
} as const;

const parseLockOwner = (
  raw: unknown,
): { readonly pid: number; readonly hostname: string } | null => {
  if (typeof raw !== "object" || raw === null || !("pid" in raw) || !("hostname" in raw))
    return null;
  if (
    typeof raw.pid !== "number" ||
    !Number.isSafeInteger(raw.pid) ||
    raw.pid <= 0 ||
    typeof raw.hostname !== "string"
  )
    return null;
  return { pid: raw.pid, hostname: raw.hostname };
};

const describeOwner = (lockDir: string): string => {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(path.join(lockDir, "owner.json"), "utf8"));
    const owner = parseLockOwner(raw);
    if (owner === null) return "owner metadata is invalid";
    const label = `PID ${owner.pid} on ${owner.hostname}`;
    if (owner.hostname !== os.hostname()) return label;
    try {
      process.kill(owner.pid, 0);
      return `${label} is still live`;
    } catch (cause) {
      return hasCode(cause, "ESRCH")
        ? `${label} is no longer running; the lock may be stale`
        : `${label} cannot be checked`;
    }
  } catch {
    // A crash may precede owner.json. An unreadable lock is never assumed free.
    return "owner metadata is missing or unreadable";
  }
};

const lockGuidance = (lockDir: string): ServerStoreError =>
  new ServerStoreError(
    `Server is busy: ${lockDir} is locked (${describeOwner(lockDir)}). Wait for the owning command. Never remove a live lock. For stale-lock recovery, verify on that host that the owner and its Docker Compose children have stopped, then move only this lock directory aside and retry. Keep identity.env, active, and generations intact.`,
  );

const acquireLock = (configDir: string): OwnedLock => {
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(configDir, 0o700);
  const lockDir = path.join(configDir, "server.lock");
  try {
    fs.mkdirSync(lockDir, { mode: 0o700 });
  } catch (cause) {
    if (hasCode(cause, "EEXIST")) throw lockGuidance(lockDir);
    throw cause;
  }
  const owned = fs.statSync(lockDir);
  const ownerFile = path.join(lockDir, "owner.json");
  const owner = `${JSON.stringify({ pid: process.pid, hostname: os.hostname(), token: randomUUID() })}\n`;
  let open = true;
  const assertOwned = (): void => {
    const current = fs.statSync(lockDir);
    if (
      !open ||
      current.dev !== owned.dev ||
      current.ino !== owned.ino ||
      fs.readFileSync(ownerFile, "utf8") !== owner
    ) {
      throw new ServerStoreError(
        "Server lock ownership was lost. Stop and check for another server command before retrying.",
      );
    }
  };
  // If writing metadata fails, retain this uncertain lock with the same recovery guidance.
  try {
    writeDurable(ownerFile, owner);
  } catch {
    throw lockGuidance(lockDir);
  }
  return {
    assertOwned,
    release: () => {
      const result = attempt(() => {
        assertOwned();
        fs.unlinkSync(ownerFile);
        fs.rmdirSync(lockDir); // Never recursively delete unexpected or replaced lock contents.
      });
      open = false;
      return result;
    },
  };
};

const readIdentity = (paths: StorePaths): string | null => {
  const identity = readOptional(paths.identity);
  if (
    identity === null &&
    (fs.existsSync(paths.active) ||
      (fs.existsSync(paths.generations) && fs.readdirSync(paths.generations).length > 0))
  ) {
    throw new ServerStoreError(
      "Server identity.env is missing. Restore it from a retained generation or backup; refusing to generate replacement credentials.",
    );
  }
  return identity;
};

const readActive = (paths: StorePaths): ServerGeneration | null => {
  let target: string;
  try {
    target = fs.readlinkSync(paths.active);
  } catch (cause) {
    if (hasCode(cause, "ENOENT")) return null;
    throw cause;
  }
  if (!/^generations\/gen-[0-9a-f-]{36}$/.test(target)) {
    throw new ServerStoreError(
      "Server active pointer is invalid. Restore the symlink to a retained generation before retrying.",
    );
  }
  const directory = path.join(paths.configDir, target);
  const files: ServerFiles = {
    identity: fs.readFileSync(path.join(directory, fileNames.identity), "utf8"),
    config: fs.readFileSync(path.join(directory, fileNames.config), "utf8"),
    env: fs.readFileSync(path.join(directory, fileNames.env), "utf8"),
    compose: fs.readFileSync(path.join(directory, fileNames.compose), "utf8"),
    postgresInit: fs.readFileSync(path.join(directory, fileNames.postgresInit), "utf8"),
  };
  if (readIdentity(paths) !== files.identity) {
    throw new ServerStoreError(
      "Server generation identity does not match identity.env. Restore from backup; credentials will not be replaced.",
    );
  }
  return { directory, files };
};

const publishIdentity = (paths: StorePaths, identity: string): void => {
  const temporary = path.join(paths.configDir, `.identity-${randomUUID()}`);
  writeDurable(temporary, identity);
  fs.linkSync(temporary, paths.identity); // exclusive publication, never rename over an identity
  syncDirectory(paths.configDir);
  fs.unlinkSync(temporary);
};

const prepareGeneration = (paths: StorePaths, files: ServerFiles): ServerGeneration => {
  fs.mkdirSync(paths.generations, { recursive: true, mode: 0o700 });
  const generationName = `gen-${randomUUID()}`;
  const directory = path.join(paths.generations, generationName);
  fs.mkdirSync(directory, { mode: 0o700 });
  for (const key of fileKeys) {
    writeDurable(
      path.join(directory, fileNames[key]),
      files[key],
      key === "postgresInit" ? 0o755 : 0o600,
    );
  }
  syncDirectory(directory);
  syncDirectory(paths.generations);
  syncDirectory(paths.configDir);
  return { directory, files };
};

const activateGeneration = (paths: StorePaths, generation: ServerGeneration): void => {
  const relative = path.relative(paths.configDir, generation.directory);
  if (
    !/^generations\/gen-[0-9a-f-]{36}$/.test(relative) ||
    readIdentity(paths) !== fs.readFileSync(path.join(generation.directory, "identity.env"), "utf8")
  ) {
    throw new ServerStoreError("Cannot activate a generation outside this installation identity.");
  }
  for (const key of fileKeys) {
    if (
      fs.readFileSync(path.join(generation.directory, fileNames[key]), "utf8") !==
      generation.files[key]
    ) {
      throw new ServerStoreError("Cannot activate an incomplete or changed server generation.");
    }
  }
  const pointer = path.join(paths.configDir, `.active-${randomUUID()}`);
  fs.symlinkSync(relative, pointer);
  fs.renameSync(pointer, paths.active);
  syncDirectory(paths.configDir);
};

const prepareFiles = (paths: StorePaths, files: ServerFiles): ServerGeneration => {
  const identity = readIdentity(paths);
  if (identity !== null && identity !== files.identity) {
    throw new ServerStoreError("Server identity already exists; refusing to replace credentials.");
  }
  const active = readActive(paths);
  if (
    active !== null &&
    fileKeys.every((key) => files[key] === active.files[key]) &&
    (fs.statSync(path.join(active.directory, fileNames.postgresInit)).mode & 0o7777) === 0o755
  )
    return active;
  // Never chmod a retained generation. Old private init scripts need a new snapshot, not new credentials.
  // Publish identity before preparing any generation. A crash here cannot orphan credentials.
  if (identity === null) publishIdentity(paths, files.identity);
  return prepareGeneration(paths, files);
};

const commitGeneration = (paths: StorePaths, files: ServerFiles): ServerGeneration => {
  const generation = prepareFiles(paths, files);
  activateGeneration(paths, generation);
  return generation;
};

const createStore = (configDir: string, lock: OwnedLock): ServerStore => {
  const paths: StorePaths = {
    configDir,
    identity: path.join(configDir, "identity.env"),
    generations: path.join(configDir, "generations"),
    active: path.join(configDir, "active"),
  };
  const whileOwned = <T>(operation: () => T): ServerStoreResult<T> =>
    attempt(() => {
      lock.assertOwned();
      return operation();
    });
  return {
    readIdentity: () => whileOwned(() => readIdentity(paths)),
    readActive: () => whileOwned(() => readActive(paths)),
    commit: (files) => whileOwned(() => commitGeneration(paths, files)),
    prepare: (files) => whileOwned(() => prepareFiles(paths, files)),
    activate: (generation) => whileOwned(() => activateGeneration(paths, generation)),
  };
};

const refuseFlatLayout = (configDir: string): void => {
  if (
    ["server.json", "server.env", "compose.yaml", "postgres-init.sh"].some((name) =>
      fs.existsSync(path.join(configDir, name)),
    )
  ) {
    throw new ServerStoreError(
      "Unreleased flat server configuration found. Preserve its credentials and volumes; migrate it to the generation layout before retrying. Setup will not replace this identity.",
    );
  }
};

/**
 * Own an exclusive cross-process lock through the entire callback, including Compose operations.
 * Locks are never stolen, even after a crash. Expected callback/storage failures become values.
 * A killed process leaves recovery metadata; normal completion removes only its own lock.
 */
export const withServerStore = async <T>(
  directory: string,
  operation: (store: ServerStore) => Promise<T>,
): Promise<ServerStoreResult<T>> => {
  const configDir = path.resolve(directory);
  let lock: OwnedLock | undefined;
  let result: ServerStoreResult<T>;
  try {
    lock = acquireLock(configDir);
    refuseFlatLayout(configDir);
    result = { _tag: "ok", value: await operation(createStore(configDir, lock)) };
  } catch (cause) {
    result = { _tag: "error", error: storeError(cause) };
  } finally {
    const release = lock?.release();
    if (release?._tag === "error") result = release;
  }
  return result;
};
