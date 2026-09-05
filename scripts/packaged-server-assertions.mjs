import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const projectLabel = "com.docker.compose.project";
const canonicalVolumes = new Set(
  ["store", "control", "config", "ssh", "rabbitmq", "registry", "postgres", "pg", "etc"].flatMap(
    (part) => [`mend-${part}`, `mend_mend-${part}`, `mend_${part}`],
  ),
);

/** Fail closed before setup, including stopped containers and orphaned persistent volumes. */
export function assertFreshDocker({ containers, networks, volumes }) {
  assert.ok(
    !containers.some((item) => item.Config?.Labels?.[projectLabel] === "mend"),
    "Refusing acceptance: existing compose project=mend container",
  );
  assert.ok(
    !networks.some(
      (item) =>
        item.Labels?.[projectLabel] === "mend" ||
        item.Name === "mend" ||
        item.Name.startsWith("mend_"),
    ),
    "Refusing acceptance: existing Mend network",
  );
  assert.ok(
    !volumes.some(
      (item) => item.Labels?.[projectLabel] === "mend" || canonicalVolumes.has(item.Name),
    ),
    "Refusing acceptance: existing canonical Mend volume",
  );
}

/** Path containment uses components, not a prefix which could match another installation. */
export function isInside(root, candidate) {
  if (typeof candidate !== "string") return false;
  const tail = relative(root, candidate);
  return tail !== "" && tail !== ".." && !tail.startsWith(`..${sep}`) && !tail.startsWith(sep);
}

/** Compose ownership needs a new immutable ID AND this run's immutable generation directory. */
export function ownsComposeContainer(container, initialIds, configRoot) {
  const labels = container.Config?.Labels ?? {};
  const directory = labels["com.docker.compose.project.working_dir"];
  const generations = join(configRoot, "generations");
  if (typeof directory !== "string") return false;
  const generation = relative(generations, directory);
  return (
    !initialIds.has(container.Id) &&
    labels[projectLabel] === "mend" &&
    /^gen-[0-9a-f-]{36}$/.test(generation) &&
    directory === join(generations, generation)
  );
}

function projectSubpath(subpath, projectName) {
  if (typeof subpath !== "string" || !subpath.startsWith(`${projectName}/`)) return false;
  return subpath
    .split("/")
    .every((part) => part && part !== "." && part !== ".." && !part.includes("\\"));
}

/** A store volume alone is shared infrastructure, not workspace ownership evidence. */
export function ownsWorkspaceContainer(container, initialIds, projectName) {
  const store = (container.HostConfig?.Mounts ?? []).filter(
    (mount) => mount.Source === "mend-store",
  );
  return (
    !initialIds.has(container.Id) &&
    store.some((mount) => mount.VolumeOptions?.Subpath === `${projectName}/repo.git`) &&
    store.every(
      (mount) =>
        mount.Type === "volume" && projectSubpath(mount.VolumeOptions?.Subpath, projectName),
    )
  );
}

export const installationOwnerLabel = "dev.sealant.mend.installation";
const externalVolumes = new Set(["mend-store", "mend-control"]);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Missing, nonprivate, or redirected identity is unknown, never a reason to guess an owner. */
export async function readPrivateIdentity(configRoot) {
  try {
    if (
      (await realpath(configRoot)) !== configRoot ||
      ((await lstat(configRoot)).mode & 0o077) !== 0
    )
      return undefined;
    const file = join(configRoot, "identity.env");
    const info = await lstat(file);
    if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size === 0 || info.size > 64 * 1024)
      return undefined;
    return await readFile(file);
  } catch {
    return undefined;
  }
}

/**
 * First observations are immutable. A replaced volume or changed/lost identity poisons its
 * cleanup claim permanently. Externals need the persisted identity, never Compose labels or
 * container existence. This also covers a setup failure immediately after the anchor claim.
 */
export function createVolumeLedger(initialVolumes, runId) {
  const preexisting = new Set(initialVolumes.map((item) => item.Name));
  const seen = new Map();
  const claims = new Map();
  const refused = new Set();
  let owner;
  let identityChanged = false;
  const observeIdentity = (bytes) => {
    const current = bytes instanceof Uint8Array && bytes.byteLength > 0 ? digest(bytes) : undefined;
    if (owner !== undefined && current !== owner) identityChanged = true;
    if (owner === undefined) owner = current;
    return identityChanged ? undefined : current;
  };
  return {
    collect(volumes, composeVolumeNames, identityBytes) {
      const identity = observeIdentity(identityBytes);
      const present = new Set(volumes.map((volume) => volume.Name));
      for (const name of seen.keys()) if (!present.has(name)) refused.add(name);
      for (const volume of volumes) {
        const name = volume.Name;
        if (preexisting.has(name)) continue;
        const fingerprint = digest(JSON.stringify(volume));
        if (!seen.has(name)) seen.set(name, fingerprint);
        if (seen.get(name) !== fingerprint) refused.add(name);
        if (volume.Driver !== "local" || !volume.CreatedAt) refused.add(name);
        if (externalVolumes.has(name)) {
          // No fallback to Compose/fixture labels for the two external data volumes.
          if (!identity || volume.Labels?.[installationOwnerLabel] !== identity) refused.add(name);
          else if (!claims.has(name)) claims.set(name, fingerprint);
        } else if (
          (composeVolumeNames.has(name) && volume.Labels?.[projectLabel] === "mend") ||
          volume.Labels?.["sh.sealant.mend.acceptance"] === runId
        ) {
          if (!claims.has(name)) claims.set(name, fingerprint);
        } else if (!claims.has(name)) {
          // A later mount does not prove who created an initially unowned volume.
          // Previously proven Compose volumes stay owned after their containers stop.
          refused.add(name);
        }
      }
    },
    names: () => [...claims.keys()],
    canRemove(volume, identityBytes) {
      const identity = observeIdentity(identityBytes);
      const fingerprint = digest(JSON.stringify(volume));
      if (claims.has(volume.Name) && claims.get(volume.Name) !== fingerprint)
        refused.add(volume.Name);
      return (
        !preexisting.has(volume.Name) &&
        !refused.has(volume.Name) &&
        claims.has(volume.Name) &&
        claims.get(volume.Name) === fingerprint &&
        (!externalVolumes.has(volume.Name) ||
          (identity !== undefined && volume.Labels?.[installationOwnerLabel] === identity))
      );
    },
  };
}

/** Deletion boundary, injected for tests. Inspection errors are never treated as absence. */
export async function cleanupOwnedVolumes(ledger, operations) {
  const names = ledger.names();
  if (!names.length) return true;
  const present = new Set(await operations.list());
  let complete = true;
  for (const name of names) {
    if (!present.has(name)) continue;
    const identity = await operations.identity();
    const inspected = await operations.inspect(name);
    if (
      !Array.isArray(inspected) ||
      inspected.length !== 1 ||
      inspected[0]?.Name !== name ||
      !ledger.canRemove(inspected[0], identity)
    ) {
      complete = false;
      continue;
    }
    // Docker has no compare-and-delete volume API. Inspect immediately before rm, never
    // force deletion, and let Docker refuse foreign users. Names alone never authorize rm.
    if (!(await operations.remove(name))) complete = false;
  }
  return complete;
}

/** Do not inherit a user's agent, Git overrides, Mend token, harness credentials, or XDG paths. */
export function isolatedClientEnvironment(source, home, dockerConfig) {
  const environment = Object.fromEntries(
    ["PATH", "USER", "LOGNAME", "XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"].flatMap((key) =>
      source[key] === undefined ? [] : [[key, source[key]]],
    ),
  );
  return {
    ...environment,
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local/share"),
    XDG_STATE_HOME: join(home, ".local/state"),
    XDG_CACHE_HOME: join(home, ".cache"),
    ...(dockerConfig ? { DOCKER_CONFIG: dockerConfig } : {}),
    SSH_AUTH_SOCK: "",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    CI: "1",
    NO_COLOR: "1",
  };
}

/** The health version must name the pin, not merely a reachable HTTP server. */
export function assertHealth(body, version) {
  assert.ok(
    body?.status === "ok" && body?.version === version,
    "Health must report ok and the exact Mend pin",
  );
}

/** Assert Docker's actual volume mount and create-time subpath, never a host-store bind. */
export function assertWorkspaceMounts(container, projectName) {
  const specs = container.HostConfig?.Mounts ?? [];
  const mounts = container.Mounts ?? [];
  const store = specs.filter((mount) => mount.Source === "mend-store");
  assert.ok(store.length >= 2, "Workspace needs store-backed worktrees and Git metadata mounts");
  for (const mount of store) {
    assert.equal(mount.Type, "volume", "Store mount must be a volume");
    const subpath = mount.VolumeOptions?.Subpath;
    assert.ok(
      projectSubpath(subpath, projectName),
      "Store mount must use this project's volume subpath",
    );
    assert.ok(
      mounts.some(
        (actual) =>
          actual.Type === "volume" &&
          actual.Name === "mend-store" &&
          actual.Destination === mount.Target,
      ),
      "Docker actual mount must agree with the volume-subpath specification",
    );
  }
  assert.ok(
    store.some((mount) => mount.VolumeOptions.Subpath === `${projectName}/repo.git`),
    "Bare Git repository must be mounted",
  );
  assert.ok(
    store.some((mount) => mount.VolumeOptions.Subpath === `${projectName}/worktrees`),
    "Worktrees root must be mounted",
  );
  assert.ok(
    !mounts.some(
      (mount) =>
        mount.Type === "bind" &&
        (mount.Source.includes("/var/lib/mend") ||
          mount.Destination.startsWith("/workspace") ||
          mount.Destination.startsWith("/var/lib/mend")),
    ),
    "Workspace must not use host-store binds",
  );
}

/** Retain only structural Docker facts suitable for non-secret install/persistence comparisons. */
export function dockerFingerprint(snapshot) {
  return JSON.stringify({
    containers: snapshot.containers
      .map((item) => [item.Id, item.State.Status, item.State.StartedAt, item.RestartCount])
      .toSorted(),
    networks: snapshot.networks.map((item) => item.Id).toSorted(),
    volumes: snapshot.volumes.map((item) => [item.Name, item.CreatedAt]).toSorted(),
    images: snapshot.images.toSorted(),
  });
}
