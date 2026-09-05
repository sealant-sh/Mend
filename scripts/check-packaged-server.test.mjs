import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { gitFixtureServer } from "./packaged-git-fixture.mjs";
import {
  assertFreshDocker,
  assertHealth,
  assertWorkspaceMounts,
  cleanupOwnedVolumes,
  createVolumeLedger,
  dockerFingerprint,
  installationOwnerLabel,
  isolatedClientEnvironment,
  isInside,
  ownsComposeContainer,
  ownsWorkspaceContainer,
  readPrivateIdentity,
} from "./packaged-server-assertions.mjs";

const exec = promisify(execFile);
const empty = () => ({ containers: [], networks: [], volumes: [], images: [] });
const projectLabel = "com.docker.compose.project";

test("entrypoint refuses occupied Docker inventories before any mutation or CLI invocation", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "mend-acceptance-gate-test-"));
  const script = fileURLToPath(new URL("./check-packaged-server.mjs", import.meta.url));
  try {
    // This executable models Docker's read-only inventory interface, never the Mend CLI.
    // Any attempted mutation, npm invocation, or temporary installation makes the test fail.
    const dockerScript = `#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
const root = ${JSON.stringify(scratch)};
const args = process.argv.slice(2);
appendFileSync(root + '/calls', JSON.stringify(args) + '\\n');
const command = args[0] === '--context' ? args.slice(2) : args;
const state = JSON.parse(readFileSync(root + '/inventory', 'utf8'));
if (command.join(' ') === 'context show') console.log('default');
else if (command.join(' ') === 'context inspect default') console.log(JSON.stringify([{Endpoints:{docker:{Host:'unix:///var/run/docker.sock'}}}]));
else if (command[0] === 'ps') console.log(state.containers.length ? 'container-id' : '');
else if (command[1] === 'ls') console.log(command[0] === 'network' ? (state.networks.length ? 'network-id' : '') : command[0] === 'volume' ? (state.volumes.length ? 'volume-name' : '') : '');
else if (command[1] === 'inspect') console.log(JSON.stringify(state[command[0] + 's']));
else process.exit(90);
`;
    await writeFile(join(scratch, "docker"), dockerScript, { mode: 0o700 });
    for (const occupied of [
      { containers: [{ Id: "container-id", Config: { Labels: { [projectLabel]: "mend" } } }] },
      { networks: [{ Id: "network-id", Name: "mend_default" }] },
      { volumes: [{ Name: "mend-store" }] },
    ]) {
      await writeFile(join(scratch, "inventory"), JSON.stringify({ ...empty(), ...occupied }));
      await writeFile(join(scratch, "calls"), "");
      await assert.rejects(
        exec(process.execPath, [script], {
          env: {
            ...process.env,
            PATH: `${scratch}:${process.env.PATH}`,
            HOME: scratch,
            TMPDIR: scratch,
            DOCKER_HOST: "",
            DOCKER_CONTEXT: "",
            MEND_TEST_VERSION: "1.2.3",
            MEND_TEST_IMAGE: "ghcr.io/sealant-sh/mend:1.2.3",
          },
        }),
        (error) => {
          assert.equal(error.code, 1);
          assert.match(error.stderr, /Refusing acceptance/);
          return true;
        },
      );
      const calls = (await readFile(join(scratch, "calls"), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.ok(calls.length > 0);
      assert.ok(
        calls.every(
          (args) =>
            !args.some((arg) =>
              [
                "create",
                "rm",
                "up",
                "down",
                "prune",
                "start",
                "stop",
                "restart",
                "run",
                "pull",
              ].includes(arg),
            ),
        ),
      );
      assert.deepEqual((await readdir(scratch)).toSorted(), ["calls", "docker", "inventory"]);
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("fresh-install gate rejects all existing Mend resources, even stopped/orphaned ones", () => {
  for (const running of [false, true]) {
    assert.throws(
      () =>
        assertFreshDocker({
          ...empty(),
          containers: [
            { State: { Running: running }, Config: { Labels: { [projectLabel]: "mend" } } },
          ],
        }),
      /existing compose/,
    );
  }
  for (const name of ["mend", "mend_default", "mend_custom"]) {
    assert.throws(
      () => assertFreshDocker({ ...empty(), networks: [{ Name: name }] }),
      /existing Mend network/,
    );
  }
  for (const part of [
    "store",
    "control",
    "config",
    "ssh",
    "rabbitmq",
    "registry",
    "postgres",
    "pg",
    "etc",
  ]) {
    for (const name of [`mend-${part}`, `mend_mend-${part}`, `mend_${part}`]) {
      assert.throws(
        () => assertFreshDocker({ ...empty(), volumes: [{ Name: name }] }),
        /canonical Mend volume/,
      );
    }
  }
  for (const kind of ["volumes", "networks"]) {
    assert.throws(() =>
      assertFreshDocker({
        ...empty(),
        [kind]: [{ Name: "unexpected-name", Labels: { [projectLabel]: "mend" } }],
      }),
    );
  }
});

test("mend-dev and unrelated Sealant resources are not classified as acceptance-owned", () => {
  const snapshot = {
    ...empty(),
    containers: [{ Id: "existing", Config: { Labels: { [projectLabel]: "mend-dev" } } }],
    networks: [
      { Name: "mend-dev_default", Labels: { [projectLabel]: "mend-dev" } },
      { Name: "sealant_default" },
    ],
    volumes: [{ Name: "mend-dev_mend-postgres" }, { Name: "sealant-registry" }],
  };
  assert.doesNotThrow(() => assertFreshDocker(snapshot));
  assert.equal(ownsComposeContainer(snapshot.containers[0], new Set(), "/tmp/run/mend"), false);
});

test("Compose cleanup requires new immutable ID, exact project, and generation path ownership", () => {
  const owned = {
    Id: "new",
    Config: {
      Labels: {
        [projectLabel]: "mend",
        "com.docker.compose.project.working_dir":
          "/tmp/run/mend/generations/gen-11111111-1111-4111-8111-111111111111",
      },
    },
  };
  assert.equal(ownsComposeContainer(owned, new Set(), "/tmp/run/mend"), true);
  assert.equal(ownsComposeContainer(owned, new Set(["new"]), "/tmp/run/mend"), false);
  for (const directory of [
    "/tmp/run/mend-other/generations/gen-123",
    "/tmp/run/mend/arbitrary-child",
    "/tmp/run/mend/generations/gen-123",
    "/tmp/run/mend/generations/../generations/gen-11111111-1111-4111-8111-111111111111",
    "/tmp/run/mend",
    "/tmp/run/mend/../other",
    "/home/user/.config/mend/generations/gen-123",
    undefined,
  ]) {
    const candidate = {
      ...owned,
      Config: {
        Labels: { ...owned.Config.Labels, "com.docker.compose.project.working_dir": directory },
      },
    };
    assert.equal(ownsComposeContainer(candidate, new Set(), "/tmp/run/mend"), false);
  }
});

test("containment does not confuse sibling prefixes or parent directories", () => {
  assert.equal(isInside("/tmp/test", "/tmp/test/child"), true);
  for (const value of ["/tmp/test", "/tmp/test-other", "/tmp/test/../elsewhere", "/tmp", undefined])
    assert.equal(isInside("/tmp/test", value), false);
});

test("health checks require the exact configured version", () => {
  assert.doesNotThrow(() => assertHealth({ status: "ok", version: "1.2.3", extra: true }, "1.2.3"));
  for (const value of [
    undefined,
    null,
    {},
    "<html>ok</html>",
    { status: "ok" },
    { status: "ok", version: "1.2.4" },
    { status: "starting", version: "1.2.3" },
  ])
    assert.throws(() => assertHealth(value, "1.2.3"));
});

function workspace() {
  const mounts = ["repo.git", "worktrees", "sessions/id/harness-home"].map((suffix) => ({
    Type: "volume",
    Source: "mend-store",
    Target: `/mounted/${suffix}`,
    VolumeOptions: { Subpath: `project/${suffix}` },
  }));
  return {
    HostConfig: { Mounts: mounts },
    Mounts: mounts.map((mount) => ({
      Type: "volume",
      Name: mount.Source,
      Destination: mount.Target,
    })),
  };
}

test("mount evidence requires actual volumes AND nonempty project subpaths", () => {
  assert.doesNotThrow(() => assertWorkspaceMounts(workspace(), "project"));
  for (const subpath of [
    undefined,
    "",
    "other/repo.git",
    "project/../repo.git",
    "/project/repo.git",
  ]) {
    const candidate = workspace();
    candidate.HostConfig.Mounts[0].VolumeOptions.Subpath = subpath;
    assert.throws(() => assertWorkspaceMounts(candidate, "project"));
  }
  const bind = workspace();
  bind.Mounts[0] = {
    Type: "bind",
    Source: "/var/lib/mend/store/project/repo.git",
    Destination: "/mounted/repo.git",
  };
  assert.throws(() => assertWorkspaceMounts(bind, "project"));
  const wholeStore = workspace();
  wholeStore.HostConfig.Mounts[0].VolumeOptions = {};
  assert.throws(() => assertWorkspaceMounts(wholeStore, "project"));
});

test("workspace cleanup uses the exact project subpath, not a shared store or raw prefix", () => {
  const candidate = { ...workspace(), Id: "new-workspace" };
  assert.equal(ownsWorkspaceContainer(candidate, new Set(), "project"), true);
  assert.equal(ownsWorkspaceContainer(candidate, new Set([candidate.Id]), "project"), false);
  assert.equal(ownsWorkspaceContainer(candidate, new Set(), "project-other"), false);
  for (const subpath of [
    "project/../foreign",
    "project/./worktrees",
    "project//worktrees",
    "project/",
    "project/dir\\file",
    "project-other/worktrees",
    "other/worktrees",
    undefined,
  ]) {
    const foreign = { ...workspace(), Id: "foreign" };
    foreign.HostConfig.Mounts[1].VolumeOptions.Subpath = subpath;
    assert.equal(ownsWorkspaceContainer(foreign, new Set(), "project"), false);
    assert.throws(() => assertWorkspaceMounts(foreign, "project"));
  }
  assert.equal(
    ownsWorkspaceContainer(
      { Id: "bind", Mounts: [{ Type: "bind", Source: "/var/lib/mend/store/project/../foreign" }] },
      new Set(),
      "project",
    ),
    false,
  );
  assert.equal(
    ownsWorkspaceContainer(
      { Id: "whole-store", HostConfig: { Mounts: [{ Type: "volume", Source: "mend-store" }] } },
      new Set(),
      "project",
    ),
    false,
  );
});

const identityBytes = Buffer.from("SECRET=fixture-only\r\nSECOND=value\n");
const identityHash = createHash("sha256").update(identityBytes).digest("hex");
const ownedVolume = (Name = "mend-store") => ({
  Name,
  Driver: "local",
  CreatedAt: "2026-09-06T00:00:00Z",
  Labels: { [installationOwnerLabel]: identityHash },
});

function volumeOperations(volumes, identity = identityBytes) {
  const calls = [];
  return {
    calls,
    list: async () => volumes.map((volume) => volume.Name),
    identity: async () => identity,
    inspect: async (name) => {
      calls.push(["inspect", name]);
      return volumes.filter((volume) => volume.Name === name);
    },
    remove: async (name) => {
      calls.push(["rm", name]);
      return true;
    },
  };
}

test("startup failure before containers: only matching-owner external volumes are learned and removed", async () => {
  for (const names of [["mend-store"], ["mend-store", "mend-control"]]) {
    const ledger = createVolumeLedger([], "test-run");
    const external = names.map(ownedVolume);
    const unrelated = [
      ownedVolume("other-data"),
      { ...ownedVolume("concurrent-data"), Labels: { [projectLabel]: "mend" } },
    ];
    ledger.collect([...external, ...unrelated], new Set(), identityBytes);
    assert.deepEqual(ledger.names(), names);
    const operations = volumeOperations([...external, ...unrelated]);
    assert.equal(await cleanupOwnedVolumes(ledger, operations), true);
    assert.deepEqual(
      operations.calls,
      names.flatMap((name) => [
        ["inspect", name],
        ["rm", name],
      ]),
    );
  }
});

test("external ownership refuses missing/empty/mismatched identity and never falls back to Compose labels", async () => {
  for (const bytes of [
    undefined,
    Buffer.alloc(0),
    Buffer.from(identityBytes.toString().trim()),
    Buffer.from("other installation"),
  ]) {
    const ledger = createVolumeLedger([], "test-run");
    const volume = {
      ...ownedVolume(),
      Labels: {
        ...ownedVolume().Labels,
        [projectLabel]: "mend",
        "sh.sealant.mend.acceptance": "test-run",
      },
    };
    ledger.collect([volume], new Set([volume.Name]), bytes);
    assert.equal(ledger.canRemove(volume, bytes), false);
    // A later good identity cannot repair an unproven first observation.
    ledger.collect([volume], new Set([volume.Name]), identityBytes);
    const operations = volumeOperations([volume]);
    await cleanupOwnedVolumes(ledger, operations);
    assert.ok(!operations.calls.some(([command]) => command === "rm"));
  }
  for (const labels of [
    null,
    {},
    { [projectLabel]: "mend" },
    { [installationOwnerLabel]: "other" },
  ]) {
    const ledger = createVolumeLedger([], "test-run");
    const volume = { ...ownedVolume(), Labels: labels };
    ledger.collect([volume], new Set([volume.Name]), identityBytes);
    assert.equal(ledger.canRemove(volume, identityBytes), false);
  }
});

test("pre-existing volumes remain unowned even with matching identity or fixture labels", async () => {
  const existing = [
    ownedVolume(),
    { ...ownedVolume("fixture"), Labels: { "sh.sealant.mend.acceptance": "test-run" } },
  ];
  const ledger = createVolumeLedger(existing, "test-run");
  ledger.collect(existing, new Set(existing.map((volume) => volume.Name)), identityBytes);
  const operations = volumeOperations(existing);
  assert.equal(await cleanupOwnedVolumes(ledger, operations), true);
  assert.deepEqual(operations.calls, []);
});

test("changed, lost, or restored identity cannot authorize external-volume cleanup", async () => {
  for (const changed of [undefined, Buffer.alloc(0), Buffer.from("changed identity")]) {
    const ledger = createVolumeLedger([], "test-run");
    const volume = ownedVolume();
    ledger.collect([volume], new Set(), identityBytes);
    const operations = volumeOperations([volume], changed);
    // Explicit undefined should stay unknown rather than using the fixture default.
    operations.identity = async () => changed;
    assert.equal(await cleanupOwnedVolumes(ledger, operations), false);
    assert.equal(ledger.canRemove(volume, identityBytes), false);
    assert.ok(!operations.calls.some(([command]) => command === "rm"));
  }
});

test("cleanup rereads persisted identity before each volume removal", async () => {
  const volumes = [ownedVolume(), ownedVolume("mend-control")];
  const ledger = createVolumeLedger([], "test-run");
  ledger.collect(volumes, new Set(), identityBytes);
  const operations = volumeOperations(volumes);
  let reads = 0;
  operations.identity = async () => (++reads === 1 ? identityBytes : Buffer.from("replacement"));
  assert.equal(await cleanupOwnedVolumes(ledger, operations), false);
  assert.equal(reads, 2);
  assert.deepEqual(operations.calls, [
    ["inspect", "mend-store"],
    ["rm", "mend-store"],
    ["inspect", "mend-control"],
  ]);
});

test("changed snapshots are never relearned, including disappearance and same-name replacement", async () => {
  for (const change of [
    { CreatedAt: "2026-09-07T00:00:00Z" },
    { Labels: { [installationOwnerLabel]: "someone-else" } },
    { Driver: "remote-plugin" },
    { Options: { device: "/other-data" } },
  ]) {
    for (const recollect of [false, true]) {
      const ledger = createVolumeLedger([], "test-run");
      const original = ownedVolume();
      const replacement = { ...original, ...change };
      ledger.collect([original], new Set(), identityBytes);
      if (recollect) ledger.collect([replacement], new Set(), identityBytes);
      const operations = volumeOperations([replacement]);
      assert.equal(await cleanupOwnedVolumes(ledger, operations), false);
      assert.equal(ledger.canRemove(original, identityBytes), false);
      assert.ok(!operations.calls.some(([command]) => command === "rm"));
    }
  }
  const ledger = createVolumeLedger([], "test-run");
  ledger.collect([ownedVolume()], new Set(), identityBytes);
  ledger.collect([], new Set(), identityBytes);
  ledger.collect([ownedVolume()], new Set(), identityBytes);
  assert.equal(ledger.canRemove(ownedVolume(), identityBytes), false);
});

test("Compose and fixture volumes require their own evidence and unchanged snapshots", () => {
  const compose = { ...ownedVolume("mend_mend-config"), Labels: { [projectLabel]: "mend" } };
  const fixture = {
    ...ownedVolume("fixture"),
    Labels: { "sh.sealant.mend.acceptance": "test-run" },
  };
  const foreign = {
    ...fixture,
    Name: "other-fixture",
    Labels: { "sh.sealant.mend.acceptance": "another-run" },
  };
  const ledger = createVolumeLedger([], "test-run");
  ledger.collect([compose, fixture, foreign], new Set(), identityBytes);
  assert.deepEqual(ledger.names(), ["fixture"]);
  ledger.collect([compose, fixture, foreign], new Set([compose.Name]), identityBytes);
  assert.equal(ledger.canRemove(compose, identityBytes), false);
  assert.equal(ledger.canRemove(fixture, identityBytes), true);
  assert.equal(ledger.canRemove(foreign, identityBytes), false);
  const proven = createVolumeLedger([], "test-run");
  proven.collect([compose], new Set([compose.Name]), identityBytes);
  proven.collect([compose], new Set(), identityBytes); // Containers already removed during cleanup.
  assert.equal(proven.canRemove(compose, identityBytes), true);
  assert.equal(proven.canRemove({ ...compose, CreatedAt: "replacement" }, identityBytes), false);
});

test("cleanup retains in-use volumes and fails closed on inspection/list errors", async () => {
  for (const inspected of [
    undefined,
    [],
    [ownedVolume(), ownedVolume()],
    [ownedVolume("wrong-name")],
  ]) {
    const ledger = createVolumeLedger([], "test-run");
    ledger.collect([ownedVolume()], new Set(), identityBytes);
    const operations = volumeOperations([ownedVolume()]);
    operations.inspect = async () => inspected;
    assert.equal(await cleanupOwnedVolumes(ledger, operations), false);
    assert.deepEqual(operations.calls, []);
  }
  const ledger = createVolumeLedger([], "test-run");
  ledger.collect([ownedVolume()], new Set(), identityBytes);
  const operations = volumeOperations([ownedVolume()]);
  operations.remove = async (name) => {
    operations.calls.push(["rm", name]);
    return false;
  };
  assert.equal(await cleanupOwnedVolumes(ledger, operations), false);
  assert.deepEqual(operations.calls, [
    ["inspect", "mend-store"],
    ["rm", "mend-store"],
  ]);
  operations.calls.length = 0;
  operations.list = async () => {
    throw new Error("daemon unavailable");
  };
  await assert.rejects(cleanupOwnedVolumes(ledger, operations), /daemon unavailable/);
  assert.deepEqual(operations.calls, []);
});

test("identity reader uses exact private persisted bytes without requiring active or containers", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "mend-identity-test-"));
  const configRoot = join(scratch, "config");
  await mkdir(configRoot, { mode: 0o700 });
  const file = join(configRoot, "identity.env");
  try {
    assert.equal(await readPrivateIdentity(configRoot), undefined);
    await writeFile(file, "", { mode: 0o600 });
    assert.equal(await readPrivateIdentity(configRoot), undefined);
    await writeFile(file, identityBytes, { mode: 0o600 });
    assert.deepEqual(await readPrivateIdentity(configRoot), identityBytes);
    await chmod(file, 0o644);
    assert.equal(await readPrivateIdentity(configRoot), undefined);
    await chmod(file, 0o600);
    await chmod(configRoot, 0o755);
    assert.equal(await readPrivateIdentity(configRoot), undefined);
    await chmod(configRoot, 0o700);
    await symlink(configRoot, join(scratch, "alias"));
    assert.equal(await readPrivateIdentity(join(scratch, "alias")), undefined);
    await rm(file);
    const foreign = join(scratch, "foreign-identity");
    await writeFile(foreign, identityBytes, { mode: 0o600 });
    await symlink(foreign, file);
    assert.equal(await readPrivateIdentity(configRoot), undefined);
    assert.deepEqual(await readFile(foreign), identityBytes);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("isolated clients clear inherited agents, identities, Git config injection and user XDG paths", () => {
  const inherited = {
    PATH: process.env.PATH,
    HOME: "/user",
    XDG_CONFIG_HOME: "/user/config",
    XDG_DATA_HOME: "/user/data",
    SSH_AUTH_SOCK: "/user/agent",
    MEND_TOKEN: "private",
    MEND_URL: "http://user",
    GIT_CONFIG: "/user/gitconfig",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: "/user/hooks",
    GIT_CONFIG_PARAMETERS: "injected",
    GIT_CONFIG_GLOBAL: "/user/gitconfig",
    GIT_SSH_COMMAND: "user-ssh",
    GIT_DIR: "/user/repo",
    GH_TOKEN: "private",
    OPENAI_API_KEY: "private",
    NODE_OPTIONS: "--require=user-code",
    DOCKER_CONTEXT: "other-daemon",
    DOCKER_HOST: "tcp://other-daemon",
  };
  const environment = isolatedClientEnvironment(inherited, "/tmp/test-home", "/user/docker");
  assert.equal(environment.HOME, "/tmp/test-home");
  assert.equal(environment.XDG_CONFIG_HOME, "/tmp/test-home/.config");
  assert.equal(environment.XDG_DATA_HOME, "/tmp/test-home/.local/share");
  assert.equal(environment.SSH_AUTH_SOCK, "");
  assert.equal(environment.GIT_CONFIG_GLOBAL, "/dev/null");
  assert.equal(environment.GIT_CONFIG_NOSYSTEM, "1");
  assert.equal(environment.DOCKER_CONFIG, "/user/docker");
  for (const key of [
    "MEND_TOKEN",
    "MEND_URL",
    "GH_TOKEN",
    "OPENAI_API_KEY",
    "NODE_OPTIONS",
    "GIT_CONFIG",
    "GIT_CONFIG_COUNT",
    "GIT_CONFIG_KEY_0",
    "GIT_CONFIG_VALUE_0",
    "GIT_CONFIG_PARAMETERS",
    "GIT_SSH_COMMAND",
    "GIT_DIR",
    "DOCKER_CONTEXT",
    "DOCKER_HOST",
  ])
    assert.equal(environment[key], undefined);
  assert.equal(inherited.SSH_AUTH_SOCK, "/user/agent");
});

test("Docker fingerprint is ordering-independent, secret-free, and detects restart/replacement", () => {
  const first = {
    ...empty(),
    containers: [
      {
        Id: "one",
        Config: { Env: ["TOKEN=secret"] },
        State: { Status: "running", StartedAt: "today" },
        RestartCount: 0,
      },
    ],
    networks: [{ Id: "a" }, { Id: "b" }],
    volumes: [{ Name: "store", CreatedAt: "today" }],
    images: ["z", "a"],
  };
  const original = dockerFingerprint(first);
  assert.doesNotMatch(original, /TOKEN|secret/);
  assert.equal(
    original,
    dockerFingerprint({
      ...first,
      networks: first.networks.toReversed(),
      images: first.images.toReversed(),
    }),
  );
  assert.notEqual(
    original,
    dockerFingerprint({ ...first, containers: [{ ...first.containers[0], RestartCount: 1 }] }),
  );
  assert.notEqual(
    original,
    dockerFingerprint({ ...first, volumes: [{ Name: "store", CreatedAt: "tomorrow" }] }),
  );
});

test("fixture serves a real network Git clone without host sharing or traversal", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "mend-git-fixture-test-"));
  const root = join(scratch, "http");
  await mkdir(root);
  const source = join(scratch, "source");
  await mkdir(source);
  const home = join(scratch, "home");
  await mkdir(home);
  // A user's signing/hook settings or injected Git environment must not reach fixture Git.
  const hostileConfig = "[commit]\n gpgsign = true\n[core]\n hooksPath = /not-a-test-hook\n";
  await writeFile(join(home, ".gitconfig"), hostileConfig);
  const env = isolatedClientEnvironment(
    {
      ...process.env,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "commit.gpgsign",
      GIT_CONFIG_VALUE_0: "true",
      GIT_DIR: "/not-the-fixture",
      GIT_CONFIG_GLOBAL: join(home, ".gitconfig"),
      SSH_AUTH_SOCK: "/user/agent.sock",
    },
    home,
  );
  const git = (args, cwd = source) => exec("git", args, { cwd, env });
  const server = gitFixtureServer(root);
  try {
    await git(["init", "-b", "main"]);
    await writeFile(join(source, "README.md"), "fixture content\n");
    await git(["add", "."]);
    await git([
      "-c",
      "user.name=Acceptance",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-m",
      "fixture",
    ]);
    const sha = (await git(["rev-parse", "HEAD"])).stdout.trim();
    await git(["clone", "--bare", source, join(root, "repo.git")]);
    await git(["update-server-info"], join(root, "repo.git"));
    await writeFile(join(scratch, "private"), "not served");
    await symlink(join(scratch, "private"), join(root, "escape"));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const clone = join(scratch, "clone");
    await git(["clone", `${origin}/repo.git`, clone]);
    assert.equal((await git(["rev-parse", "HEAD"], clone)).stdout.trim(), sha);
    assert.equal(await readFile(join(clone, "README.md"), "utf8"), "fixture content\n");
    assert.equal(await readFile(join(home, ".gitconfig"), "utf8"), hostileConfig);
    for (const path of ["/escape", "/%2e%2e%2fprivate", "/repo.git", "/missing", "/%invalid"]) {
      const response = await fetch(`${origin}${path}`);
      assert.equal(response.status, 404);
      await response.body?.cancel();
    }
    const denied = await fetch(`${origin}/repo.git/HEAD`, {
      method: "POST",
      body: "do not change Git",
    });
    assert.equal(denied.status, 405);
    await denied.body?.cancel();
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(scratch, { recursive: true, force: true });
  }
});
