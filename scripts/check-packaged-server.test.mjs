import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
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
  dockerFingerprint,
  isInside,
  ownsComposeContainer,
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
        "com.docker.compose.project.working_dir": "/tmp/run/mend/generations/gen-123",
      },
    },
  };
  assert.equal(ownsComposeContainer(owned, new Set(), "/tmp/run/mend"), true);
  assert.equal(ownsComposeContainer(owned, new Set(["new"]), "/tmp/run/mend"), false);
  for (const directory of [
    "/tmp/run/mend-other/generations/gen-123",
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
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
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
