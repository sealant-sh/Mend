import assert from "node:assert/strict";
import { relative, sep } from "node:path";

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
  return (
    !initialIds.has(container.Id) &&
    labels[projectLabel] === "mend" &&
    isInside(configRoot, labels["com.docker.compose.project.working_dir"])
  );
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
      typeof subpath === "string" &&
        subpath.startsWith(`${projectName}/`) &&
        !subpath.split("/").includes(".."),
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
