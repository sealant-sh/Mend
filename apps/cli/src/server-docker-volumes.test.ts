import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  claimServerDockerVolumes,
  MEND_DOCKER_NAMESPACE,
  SERVER_VOLUME_OWNER_LABEL,
  verifyServerDockerVolumes,
} from "./server-docker-volumes.ts";
import type { ServerSetupRuntime } from "./server-setup.ts";

const identity = Buffer.from("MEND_DB_PASSWORD=first-secret\n");
const otherIdentity = Buffer.from("MEND_DB_PASSWORD=other-secret\n");
const owner = createHash("sha256").update(identity).digest("hex");
const input = { dockerContext: "explicit-test-context", identityBytes: identity };
const ok = (stdout = "") => ({ status: 0, stdout, stderr: "" });
const denied = { status: 1, stdout: "", stderr: "permission denied" };

type Labels = Record<string, string> | null;

// Faithful Engine named create: first writer keeps its labels; repeated creates return the name.
class DockerDaemon implements Pick<ServerSetupRuntime, "run"> {
  readonly volumes = new Map<string, Labels>();
  readonly containers = new Map<string, Labels>();
  readonly networks = new Map<string, Labels>();
  readonly commands: ReadonlyArray<string>[] = [];
  beforeCommand: (args: ReadonlyArray<string>) => Promise<void> = async () => {};
  response: (args: ReadonlyArray<string>) => ReturnType<typeof ok> | undefined = () => undefined;

  async run(command: string, args: ReadonlyArray<string>) {
    expect(command).toBe("docker");
    expect(args.slice(0, 2)).toEqual(["--context", input.dockerContext]);
    this.commands.push(args);
    await this.beforeCommand(args);
    const replacement = this.response(args);
    if (replacement !== undefined) return replacement;
    const [kind, operation] = args.slice(2);
    const collections = new Map([
      ["volume", this.volumes],
      ["container", this.containers],
      ["network", this.networks],
    ]);
    const collection = collections.get(kind ?? "");
    if (collection === undefined) throw new Error("Unexpected Docker resource");
    if (operation === "ls") {
      const filterIndex = args.indexOf("--filter");
      const project =
        filterIndex < 0
          ? undefined
          : args[filterIndex + 1]?.replace("label=com.docker.compose.project=", "");
      return ok(
        [...collection]
          .filter(
            ([, labels]) =>
              project === undefined || labels?.["com.docker.compose.project"] === project,
          )
          .map(([name]) => JSON.stringify(name))
          .join("\n"),
      );
    }
    if (kind === "volume" && operation === "create") {
      const name = args.at(-1);
      const label = args[args.indexOf("--label") + 1];
      if (name === undefined || label === undefined) throw new Error("Invalid create arguments");
      if (!this.volumes.has(name))
        this.volumes.set(name, {
          [SERVER_VOLUME_OWNER_LABEL]: label.slice(label.indexOf("=") + 1),
        });
      return ok(name);
    }
    if (kind === "volume" && operation === "inspect") {
      const name = args[4] ?? "";
      if (!this.volumes.has(name)) return { status: 1, stdout: "", stderr: "No such volume" };
      return ok(JSON.stringify({ Name: name, Labels: this.volumes.get(name) }));
    }
    throw new Error(`Unexpected Docker command: ${args.join(" ")}`);
  }

  mutations() {
    return this.commands.filter((args) => args[3] === "create");
  }
}

describe("daemon data ownership", () => {
  it("claims exact production volumes with SHA256 of persisted bytes, then verifies without allocation", async () => {
    const daemon = new DockerDaemon();
    expect(await claimServerDockerVolumes(daemon, input)).toEqual({
      _tag: "ok",
      value: { owner, namespace: MEND_DOCKER_NAMESPACE },
    });
    expect([...daemon.volumes]).toEqual([
      ["mend-store", { [SERVER_VOLUME_OWNER_LABEL]: owner }],
      ["mend-control", { [SERVER_VOLUME_OWNER_LABEL]: owner }],
    ]);
    const mutations = daemon.mutations().length;
    expect((await claimServerDockerVolumes(daemon, input))._tag).toBe("ok");
    expect((await verifyServerDockerVolumes(daemon, input))._tag).toBe("ok");
    expect(daemon.mutations()).toHaveLength(mutations);
    expect(JSON.stringify(daemon.commands)).not.toContain("first-secret");
  });

  it("another config directory or lost config cannot replace credentials", async () => {
    const daemon = new DockerDaemon();
    await claimServerDockerVolumes(daemon, input);
    const before = [...daemon.volumes];
    const result = await claimServerDockerVolumes(daemon, {
      ...input,
      identityBytes: otherIdentity,
    });
    expect(result).toMatchObject({ _tag: "error", error: { reason: "conflict" } });
    expect([...daemon.volumes]).toEqual(before);
    expect(daemon.mutations()).toHaveLength(2);
    // Even a trailing newline is identity, not normalized configuration text.
    expect(
      await verifyServerDockerVolumes(daemon, {
        ...input,
        identityBytes: Buffer.concat([identity, Buffer.from("\n")]),
      }),
    ).toMatchObject({ _tag: "error", error: { reason: "conflict" } });
  });

  it("only one of two fresh identities that both saw an empty daemon can create control", async () => {
    const daemon = new DockerDaemon();
    let arrived = 0;
    let release: (() => void) | undefined;
    const bothAtClaim = new Promise<void>((resolve) => {
      release = resolve;
    });
    daemon.beforeCommand = async (args) => {
      if (args[3] !== "create" || args.at(-1) !== "mend-store") return;
      arrived += 1;
      if (arrived === 2) release?.();
      await bothAtClaim;
    };
    const results = await Promise.all([
      claimServerDockerVolumes(daemon, input),
      claimServerDockerVolumes(daemon, { ...input, identityBytes: otherIdentity }),
    ]);
    expect(results.filter((result) => result._tag === "ok")).toHaveLength(1);
    expect(results.filter((result) => result._tag === "error")).toMatchObject([
      { error: { reason: "conflict" } },
    ]);
    expect(daemon.mutations().filter((args) => args.at(-1) === "mend-control")).toHaveLength(1);
    expect(daemon.volumes.get("mend-control")).toEqual(daemon.volumes.get("mend-store"));
  });

  it.each([
    "store-unlabelled",
    "control",
    "compose-volume",
    "labelled-volume",
    "container",
    "network",
    "named-container",
    "named-network",
  ])("refuses old %s data before the first claim", async (kind) => {
    const daemon = new DockerDaemon();
    const projectLabel = { "com.docker.compose.project": "mend" };
    if (kind === "store-unlabelled") daemon.volumes.set("mend-store", null);
    if (kind === "control")
      daemon.volumes.set("mend-control", { [SERVER_VOLUME_OWNER_LABEL]: owner });
    if (kind === "compose-volume") daemon.volumes.set("mend_unknown-old-data", null);
    if (kind === "labelled-volume") daemon.volumes.set("custom-volume", projectLabel);
    if (kind === "container") daemon.containers.set("custom-container", projectLabel);
    if (kind === "network") daemon.networks.set("custom-network", projectLabel);
    if (kind === "named-container") daemon.containers.set("mend-old-1", null);
    if (kind === "named-network") daemon.networks.set("mend_default", null);
    expect((await claimServerDockerVolumes(daemon, input))._tag).toBe("error");
    expect(daemon.mutations()).toEqual([]);
  });

  it("matching anchor allows control creation and existing Compose-managed data", async () => {
    const daemon = new DockerDaemon();
    daemon.volumes.set("mend-store", { [SERVER_VOLUME_OWNER_LABEL]: owner });
    daemon.volumes.set("mend_mend-postgres", null);
    expect((await claimServerDockerVolumes(daemon, input))._tag).toBe("ok");
    expect(daemon.mutations()).toHaveLength(1);
    expect(daemon.volumes.get("mend_mend-postgres")).toBeNull();
  });

  it.each([null, {}, { [SERVER_VOLUME_OWNER_LABEL]: "different-owner" }])(
    "refuses conflicting control without relabelling",
    async (labels) => {
      const daemon = new DockerDaemon();
      daemon.volumes.set("mend-store", { [SERVER_VOLUME_OWNER_LABEL]: owner });
      daemon.volumes.set("mend-control", labels);
      expect(await claimServerDockerVolumes(daemon, input)).toMatchObject({
        _tag: "error",
        error: { reason: "conflict" },
      });
      expect(daemon.volumes.get("mend-control")).toEqual(labels);
      expect(daemon.mutations()).toEqual([]);
    },
  );

  it("a control volume appearing during create is never adopted", async () => {
    const daemon = new DockerDaemon();
    daemon.beforeCommand = async (args) => {
      if (args[3] === "create" && args.at(-1) === "mend-control")
        daemon.volumes.set("mend-control", null);
    };
    expect(await claimServerDockerVolumes(daemon, input)).toMatchObject({
      _tag: "error",
      error: { reason: "conflict" },
    });
    expect(daemon.volumes.get("mend-control")).toBeNull();
  });

  it.each(["anchor", "control"])(
    "verify-only reports missing %s without allocation",
    async (missing) => {
      const daemon = new DockerDaemon();
      if (missing === "control")
        daemon.volumes.set("mend-store", { [SERVER_VOLUME_OWNER_LABEL]: owner });
      expect(await verifyServerDockerVolumes(daemon, input)).toMatchObject({
        _tag: "error",
        error: { reason: "missing", operation: missing },
      });
      expect(daemon.mutations()).toEqual([]);
    },
  );

  it.each(["volume", "container", "network"])(
    "failed %s listing is not an empty daemon",
    async (kind) => {
      const daemon = new DockerDaemon();
      daemon.response = (args) => (args[2] === kind && args[3] === "ls" ? denied : undefined);
      expect(await claimServerDockerVolumes(daemon, input)).toMatchObject({
        _tag: "error",
        error: { reason: "docker" },
      });
      expect(daemon.mutations()).toEqual([]);
    },
  );

  it.each([
    "permission",
    "vanished",
    "invalid-json",
    "wrong-name",
    "invalid-labels",
    "missing-labels",
    "rejected",
  ])("inconclusive anchor inspection (%s) fails closed", async (kind) => {
    const daemon = new DockerDaemon();
    daemon.volumes.set("mend-store", { [SERVER_VOLUME_OWNER_LABEL]: owner });
    daemon.response = (args) => {
      if (args[3] !== "inspect") return undefined;
      if (kind === "rejected") throw new Error("transport failure");
      if (kind === "permission" || kind === "vanished") return denied;
      if (kind === "invalid-json") return ok("{");
      if (kind === "wrong-name")
        return ok(
          JSON.stringify({ Name: "other", Labels: { [SERVER_VOLUME_OWNER_LABEL]: owner } }),
        );
      if (kind === "missing-labels") return ok(JSON.stringify({ Name: "mend-store" }));
      return ok(JSON.stringify({ Name: "mend-store", Labels: [] }));
    };
    expect((await claimServerDockerVolumes(daemon, input))._tag).toBe("error");
    expect(daemon.mutations()).toEqual([]);
  });

  it("failed post-create inspection stops before control and is retryable with the persisted identity", async () => {
    const daemon = new DockerDaemon();
    daemon.response = (args) => (args[3] === "inspect" ? denied : undefined);
    expect((await claimServerDockerVolumes(daemon, input))._tag).toBe("error");
    expect([...daemon.volumes.keys()]).toEqual(["mend-store"]);
    daemon.response = () => undefined;
    expect((await claimServerDockerVolumes(daemon, input))._tag).toBe("ok");
  });

  it.each(["garbage", "null", "{}", '"bad name"'])(
    "rejects malformed listing %s",
    async (stdout) => {
      const daemon = new DockerDaemon();
      daemon.response = () => ok(stdout);
      expect(await claimServerDockerVolumes(daemon, input)).toMatchObject({
        _tag: "error",
        error: { reason: "inspection" },
      });
      expect(daemon.mutations()).toEqual([]);
    },
  );

  it("supports concrete isolated names without creating production volumes", async () => {
    const daemon = new DockerDaemon();
    const namespace = { project: "isolated", store: "isolated-store", control: "isolated-control" };
    daemon.volumes.set("mend-store", null);
    expect((await claimServerDockerVolumes(daemon, { ...input, namespace }))._tag).toBe("ok");
    expect(daemon.volumes.get("mend-store")).toBeNull();
    expect(daemon.mutations().map((args) => args.at(-1))).toEqual([
      namespace.store,
      namespace.control,
    ]);
  });
});
