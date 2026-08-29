/**
 * `mend ssh`: workspace SSH for this machine (docs/WORKSPACE-SSH.md phase 1).
 *
 * `mend ssh` shows the observed state — the deployment's gateway, this user's registered keys,
 * and whether `~/.ssh/config` carries the managed block. `mend ssh setup` makes this machine
 * ready once: pick a public key (an explicit `--key` path; else the running ssh-agent's first
 * key, so no new key material exists; else an existing dedicated key; else a freshly generated
 * one), offer it to the platform under the signed-in user, and write one static Host block.
 * The workspace id travels in the SSH username, so the block never changes per session:
 * `ssh <prefix>-<workspaceId>@mend-ws` — and the VS Code extension connects the same way.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { ApiCall } from "./pair.ts";

/** GET /workspace-ssh — the gateway plus the signed-in user's registered keys. */
export interface WorkspaceSshViewDto {
  readonly gateway: {
    readonly host: string;
    readonly port: number;
    readonly usernamePrefix: string;
  } | null;
  readonly keys: ReadonlyArray<{
    readonly sshKeyId: string;
    readonly name: string;
    readonly algorithm: string;
    readonly fingerprint: string;
    readonly createdAt: string;
  }>;
}

export const SSH_HOST_ALIAS = "mend-ws";
const BLOCK_BEGIN = "# >>> mend workspace ssh (managed by `mend ssh setup`) >>>";
const BLOCK_END = "# <<< mend workspace ssh <<<";

/** The first key a running ssh-agent offers (`ssh-add -L` output), or null. */
export const firstAgentKey = (output: string): string | null => {
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2 && parts[0]?.startsWith("ssh-") === true) return trimmed;
    if (parts.length >= 2 && parts[0]?.startsWith("ecdsa-") === true) return trimmed;
  }
  return null;
};

/** The managed Host block. `identityFile` null = the ssh-agent supplies the key. */
export const managedSshConfigBlock = (input: {
  readonly host: string;
  readonly port: number;
  readonly identityFile: string | null;
}): string =>
  [
    BLOCK_BEGIN,
    `Host ${SSH_HOST_ALIAS}`,
    `  HostName ${input.host}`,
    `  Port ${input.port}`,
    ...(input.identityFile === null
      ? []
      : [`  IdentityFile ${input.identityFile}`, "  IdentitiesOnly yes"]),
    "  StrictHostKeyChecking accept-new",
    BLOCK_END,
    "",
  ].join("\n");

/** Replace the managed block in an ssh config, or append it; everything else stays verbatim. */
export const upsertManagedBlock = (existing: string, block: string): string => {
  const begin = existing.indexOf(BLOCK_BEGIN);
  const end = existing.indexOf(BLOCK_END);
  if (begin !== -1 && end !== -1 && end > begin) {
    const after = existing.slice(end + BLOCK_END.length).replace(/^\n/, "");
    return `${existing.slice(0, begin)}${block}${after}`;
  }
  if (existing === "") return block;
  return `${existing.replace(/\n*$/, "\n\n")}${block}`;
};

/** Whether an ssh config already carries the managed block. */
export const hasManagedBlock = (config: string): boolean => config.includes(BLOCK_BEGIN);

const ansi = (code: string) => (text: string) =>
  process.stdout.isTTY === true ? `[${code}m${text}[0m` : text;
const dim = ansi("2");
const green = ansi("32");
const warn = ansi("33");

const say = (line: string) => console.log(line);

const readIfPresent = (file: string): string => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
};

interface PickedKey {
  readonly publicKey: string;
  /** Null when the key lives in the ssh-agent — nothing on disk to point SSH at. */
  readonly identityFile: string | null;
  readonly source: "flag" | "agent" | "existing" | "generated";
}

/** Resolve the public key to offer, favoring what already exists over creating anything. */
const pickKey = (
  cliHome: string,
  keyFlag: string | null,
): PickedKey | { readonly error: string } => {
  if (keyFlag !== null) {
    const pubPath = keyFlag.endsWith(".pub") ? keyFlag : `${keyFlag}.pub`;
    const publicKey = readIfPresent(pubPath).trim();
    if (publicKey === "") return { error: `no public key at ${pubPath}` };
    return {
      publicKey,
      identityFile: pubPath.endsWith(".pub") ? pubPath.slice(0, -".pub".length) : pubPath,
      source: "flag",
    };
  }
  if (process.env["SSH_AUTH_SOCK"] !== undefined && process.env["SSH_AUTH_SOCK"] !== "") {
    const listed = spawnSync("ssh-add", ["-L"], { encoding: "utf8" });
    if (listed.status === 0) {
      const key = firstAgentKey(listed.stdout);
      if (key !== null) return { publicKey: key, identityFile: null, source: "agent" };
    }
  }
  const dedicated = path.join(cliHome, "ssh", "id_ed25519");
  const existing = readIfPresent(`${dedicated}.pub`).trim();
  if (existing !== "") return { publicKey: existing, identityFile: dedicated, source: "existing" };
  fs.mkdirSync(path.dirname(dedicated), { recursive: true, mode: 0o700 });
  const generated = spawnSync(
    "ssh-keygen",
    ["-t", "ed25519", "-f", dedicated, "-N", "", "-C", `mend-${os.hostname()}`],
    { encoding: "utf8" },
  );
  if (generated.status !== 0) {
    return { error: `ssh-keygen failed: ${generated.stderr.trim() || "unknown error"}` };
  }
  const fresh = readIfPresent(`${dedicated}.pub`).trim();
  if (fresh === "") return { error: `ssh-keygen reported success but ${dedicated}.pub is missing` };
  return { publicKey: fresh, identityFile: dedicated, source: "generated" };
};

const sshConfigPath = () => path.join(os.homedir(), ".ssh", "config");

const showStatus = async (api: ApiCall): Promise<void> => {
  const view = await api<WorkspaceSshViewDto>("GET", "/workspace-ssh");
  if (view.gateway === null) {
    say(`workspace ssh   ${warn("no gateway")} ${dim("· this deployment exposes none")}`);
    return;
  }
  say(
    `gateway         ${view.gateway.host}:${view.gateway.port} ${dim(`· username ${view.gateway.usernamePrefix}-<workspace-id>`)}`,
  );
  if (view.keys.length === 0) {
    say(`keys            ${warn("none registered")} ${dim("· run: mend ssh setup")}`);
  } else {
    for (const key of view.keys) {
      say(`key             ${key.name} ${dim(`· ${key.fingerprint}`)}`);
    }
  }
  const configured = hasManagedBlock(readIfPresent(sshConfigPath()));
  say(
    configured
      ? `ssh config      ${green("●")} Host ${SSH_HOST_ALIAS} ${dim(`· ${sshConfigPath()}`)}`
      : `ssh config      ${warn("no managed block")} ${dim("· run: mend ssh setup")}`,
  );
};

const setup = async (api: ApiCall, cliHome: string, args: ReadonlyArray<string>): Promise<void> => {
  const keyFlagIndex = args.indexOf("--key");
  const keyFlag =
    keyFlagIndex !== -1 && args[keyFlagIndex + 1] !== undefined
      ? String(args[keyFlagIndex + 1])
      : null;

  const view = await api<WorkspaceSshViewDto>("GET", "/workspace-ssh");
  if (view.gateway === null) {
    say(`mend: this deployment exposes no workspace SSH gateway`);
    process.exitCode = 1;
    return;
  }

  const picked = pickKey(cliHome, keyFlag);
  if ("error" in picked) {
    say(`mend: ${picked.error}`);
    process.exitCode = 1;
    return;
  }
  const sourceLabel = {
    flag: "from --key",
    agent: "from your ssh-agent (nothing new created)",
    existing: "existing dedicated key",
    generated: "generated dedicated key",
  }[picked.source];

  const registered = await api<WorkspaceSshViewDto["keys"][number]>("POST", "/workspace-ssh/keys", {
    publicKey: picked.publicKey,
    name: os.hostname(),
  });
  say(`key             ${green("●")} ${registered.fingerprint} ${dim(`· ${sourceLabel}`)}`);

  const configFile = sshConfigPath();
  fs.mkdirSync(path.dirname(configFile), { recursive: true, mode: 0o700 });
  const block = managedSshConfigBlock({
    host: view.gateway.host,
    port: view.gateway.port,
    identityFile: picked.identityFile,
  });
  const before = readIfPresent(configFile);
  fs.writeFileSync(configFile, upsertManagedBlock(before, block), { mode: 0o600 });
  say(`ssh config      ${green("●")} Host ${SSH_HOST_ALIAS} ${dim(`· ${configFile}`)}`);
  say("");
  say(
    `connect with    ssh ${view.gateway.usernamePrefix}-<workspace-id>@${SSH_HOST_ALIAS} ${dim("· the VS Code extension uses this automatically")}`,
  );
};

export const sshCommand = async (
  args: ReadonlyArray<string>,
  api: ApiCall,
  cliHome: string,
): Promise<void> => {
  const [subcommand, ...rest] = args;
  switch (subcommand) {
    case undefined:
    case "status":
      return showStatus(api);
    case "setup":
      return setup(api, cliHome, rest);
    default:
      say(
        `mend: unknown ssh subcommand "${subcommand}" — try: mend ssh · mend ssh setup [--key <path>]`,
      );
      process.exitCode = 1;
      return;
  }
};
