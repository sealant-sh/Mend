import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

const proof = "MEND_PACKAGED_NATIVE_SSH_PROOF";
const attempts = 8;
const processTimeout = 2500;

function requireFact(condition, message) {
  // Never include process output, API bodies, key material or assertion diffs in diagnostics.
  assert.ok(condition, message);
}

function inside(root, candidate) {
  const path = relative(root, candidate);
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

async function privateDirectory(path) {
  const info = await lstat(path);
  requireFact(
    info.isDirectory() && (info.mode & 0o777) === 0o700 && (await realpath(path)) === path,
    "SSH acceptance requires canonical, non-symlink 0700 directories",
  );
}

async function privateFile(path) {
  const info = await lstat(path);
  requireFact(
    info.isFile() && info.nlink === 1 && (info.mode & 0o777) === 0o600,
    "SSH acceptance requires non-symlink, single-link 0600 files",
  );
}

function quoteConfigPath(path) {
  return `"${path.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%")}"`;
}

function gatewayView(view) {
  // Public shape: packages/api-contracts/src/system.ts, WorkspaceSshView/Gateway/Key.
  const gateway = view?.gateway;
  requireFact(
    gateway !== null &&
      typeof gateway === "object" &&
      typeof gateway.host === "string" &&
      /^[a-zA-Z0-9.:[\]-]+$/.test(gateway.host) &&
      Number.isInteger(gateway.port) &&
      gateway.port >= 1 &&
      gateway.port <= 65535 &&
      typeof gateway.usernamePrefix === "string" &&
      /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(gateway.usernamePrefix) &&
      Array.isArray(view.keys) &&
      view.keys.every((key) =>
        ["sshKeyId", "name", "algorithm", "fingerprint", "createdAt"].every(
          (field) => typeof key?.[field] === "string",
        ),
      ),
    "Public /workspace-ssh must expose gateway coordinates and registered-key metadata",
  );
  return gateway;
}

function managedAlias(config, key, port) {
  // Parse the installed CLI's output, never compute a substitute alias or import source code.
  // This fresh HOME must contain exactly the current per-server managed block. Reject Includes,
  // Match exec, extra hosts, duplicate directives and anything that could escape the private tree.
  // Block contract: packages/workspace-ssh/src/index.ts, managedWorkspaceSshBlock.
  const match =
    /^# >>> mend workspace ssh (mend-ws-[a-z0-9-]+) \(managed\) >>>\nHost \1\n  HostName ([a-zA-Z0-9.:-]+)\n  Port ([0-9]+)\n  HostKeyAlias \1\n  IdentityFile ([^\n]+)\n  IdentitiesOnly yes\n  StrictHostKeyChecking accept-new\nHost \*\n# <<< mend workspace ssh \1 <<<\n$/.exec(
      config,
    );
  requireFact(
    match !== null && match[3] === String(port) && match[4] === quoteConfigPath(key),
    "Installed CLI must write exactly one managed alias with the dedicated key and published port",
  );
  // The hostname intentionally comes from CLI config, not gateway.host. See docs/WORKSPACE-SSH.md.
  return match[1];
}

function publicHostKey(output) {
  // ssh-keygen -y emits one public key, optionally with a comment. No keyscan, private-key read,
  // arbitrary known_hosts records, certificates or extra lines may enter the trust file.
  const match =
    /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)) ([A-Za-z0-9+/]+={0,2})(?: [^\r\n]*)?\n?$/.exec(
      output,
    );
  requireFact(match !== null, "Owned gateway must return exactly one public host key");
  const bytes = Buffer.from(match[2], "base64");
  requireFact(
    bytes.toString("base64") === match[2] &&
      bytes.length > 4 + match[1].length &&
      bytes.readUInt32BE(0) === match[1].length &&
      bytes.subarray(4, 4 + match[1].length).toString() === match[1],
    "Owned gateway public host key encoding is invalid",
  );
  return `${match[1]} ${match[2]}`;
}

function quoteShell(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Prepare installed-CLI/native-SSH acceptance before launching the short-lived workspace.
 *
 * await preparePackagedSshAcceptance({ cli, docker, run, until, api, scratch, privateHome,
 *   mendContainerId }) -> { check: async (workspaceId, marker) => void }
 *
 * Callbacks match check-packaged-server.mjs: cli(args), docker(args), and
 * run(command, args, { timeout }) resolve stdout strings and reject unsuccessful processes.
 * run and cli MUST share the parent's isolated client environment, including HOME. The child
 * Node probe deliberately uses run's default environment, not an override that could hide a leak.
 * api(path) resolves parsed authenticated JSON; until(description, probe) polls false values and
 * propagates errors. Its parent timeout remains in force; this helper also caps SSH at 8 attempts.
 * mendContainerId must already have been proven owned by the parent; a name/short ID is refused.
 *
 * Call check with the live session's platform workspace ID, NOT its Docker container or session ID,
 * before awaiting command completion. Parent owns scratch cleanup. No installed-editor claim.
 */
export async function preparePackagedSshAcceptance({
  cli,
  docker,
  run,
  until,
  api,
  scratch,
  privateHome,
  mendContainerId,
}) {
  requireFact(
    typeof scratch === "string" &&
      typeof privateHome === "string" &&
      isAbsolute(scratch) &&
      isAbsolute(privateHome) &&
      inside(scratch, privateHome) &&
      !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(scratch + privateHome) &&
      !(scratch + privateHome).includes("${"),
    "Refusing SSH setup outside the private scratch HOME",
  );
  requireFact(
    typeof mendContainerId === "string" && /^[a-f0-9]{64}$/.test(mendContainerId),
    "SSH host trust requires the owned Mend container's immutable ID",
  );
  await privateDirectory(scratch);
  await privateDirectory(privateHome);
  const childHome = await run(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'import { homedir } from "node:os"; process.stdout.write(JSON.stringify(homedir()))',
    ],
    { timeout: processTimeout },
  );
  requireFact(
    childHome === JSON.stringify(privateHome),
    "Refusing SSH setup: child Node os.homedir() is not the private scratch HOME",
  );

  // Exclusive creation refuses a pre-existing directory or symlink before CLI setup can read it.
  const sshDirectory = join(privateHome, ".ssh");
  await mkdir(sshDirectory, { mode: 0o700 });
  const directory = await mkdtemp(join(scratch, "native-ssh-"));
  await privateDirectory(directory);
  const key = join(directory, "id_ed25519");
  await run(
    "ssh-keygen",
    ["-q", "-t", "ed25519", "-N", "", "-C", "mend-packaged-acceptance", "-f", key],
    {
      timeout: processTimeout,
    },
  );
  await privateFile(key);
  await cli(["ssh", "setup", "--key", key]);
  await privateDirectory(sshDirectory);
  const configFile = join(sshDirectory, "config");
  await privateFile(configFile);
  const config = await readFile(configFile, "utf8");
  const gateway = gatewayView(await api("/workspace-ssh"));
  const alias = managedAlias(config, key, gateway.port);

  const hostKey = publicHostKey(
    await docker([
      "exec",
      mendContainerId,
      "ssh-keygen",
      "-y",
      "-f",
      "/var/lib/mend/ssh/ssh_gateway_host_key",
    ]),
  );
  const knownHosts = join(directory, "known_hosts");
  // HostKeyAlias uses a bare alias even when the gateway is on a non-default port.
  await writeFile(knownHosts, `${alias} ${hostKey}\n`, { mode: 0o600, flag: "wx" });
  await privateFile(knownHosts);
  // Let native OpenSSH validate the entire public-key blob, not merely its textual envelope.
  await run("ssh-keygen", ["-l", "-f", knownHosts], { timeout: processTimeout });

  return {
    async check(workspaceId, marker) {
      requireFact(
        typeof workspaceId === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(workspaceId),
        "Native SSH requires a platform workspace ID",
      );
      requireFact(
        typeof marker === "string" &&
          marker.length > 0 &&
          marker.length <= 4096 &&
          !/[\r\n]/.test(marker) &&
          !marker.includes("\0"),
        "Native SSH requires a nonempty single-line expected marker",
      );
      // Refuse replacement since preparation; never follow a new config Include/Match or key link.
      await privateDirectory(sshDirectory);
      await privateDirectory(directory);
      for (const file of [key, configFile, knownHosts]) await privateFile(file);
      requireFact(
        (await readFile(configFile, "utf8")) === config &&
          (await readFile(knownHosts, "utf8")) === `${alias} ${hostKey}\n`,
        "Private SSH config or pinned host trust changed after preparation",
      );
      const command = `set -eu; actual=$(cat /workspace/repo/packaged-proof.txt); [ "$actual" = ${quoteShell(marker)} ]; printf '%s\\n' '${proof}'`;
      const args = [
        "-F",
        configFile,
        "-T",
        "-n",
        "-o",
        "BatchMode=yes",
        "-o",
        `UserKnownHostsFile=${quoteConfigPath(knownHosts)}`,
        "-o",
        "GlobalKnownHostsFile=/dev/null",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        "IdentityAgent=none",
        "-o",
        "IdentitiesOnly=yes",
        "-o",
        "ForwardAgent=no",
        "-o",
        "ClearAllForwardings=yes",
        "-o",
        "UpdateHostKeys=no",
        "-o",
        "VerifyHostKeyDNS=no",
        "-o",
        "ConnectionAttempts=1",
        "-o",
        "ConnectTimeout=2",
        "-l",
        `${gateway.usernamePrefix}-${workspaceId}`,
        alias,
        command,
      ];
      let count = 0;
      await until("native SSH workspace proof", async () => {
        requireFact(count < attempts, "Native SSH exhausted its bounded attempt budget");
        count++;
        let output;
        try {
          output = await run("ssh", args, { timeout: processTimeout });
        } catch {
          // Workspace provisioning may not yet accept SSH. Trust policy and pins never change.
        }
        if (output === `${proof}\n`) return true;
        requireFact(
          count < attempts,
          "Native SSH workspace proof failed after 8 attempts; output withheld",
        );
        return false;
      });
    },
  };
}
