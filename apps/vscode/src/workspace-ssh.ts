/**
 * Workspace SSH setup inside the extension (docs/WORKSPACE-SSH.md phase 1) — the same flow as
 * `mend ssh setup`, self-contained so the extension needs no CLI on PATH: pick a public key
 * (the running ssh-agent's first key when one is offered — nothing new is created — else a
 * dedicated generated key under ~/.config/mend/ssh), offer it to Mend under the signed-in
 * user, and write one static managed Host block to ~/.ssh/config. The workspace id travels in
 * the SSH username, so the block never changes per session.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { WorkspaceSshView } from "./types.js";

export const SSH_HOST_ALIAS = "mend-ws";
const BLOCK_BEGIN = "# >>> mend workspace ssh (managed by `mend ssh setup`) >>>";
const BLOCK_END = "# <<< mend workspace ssh <<<";

const firstAgentKey = (output: string): string | null => {
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2 && parts[0] !== undefined) {
      if (parts[0].startsWith("ssh-") || parts[0].startsWith("ecdsa-")) return trimmed;
    }
  }
  return null;
};

const managedBlock = (input: {
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

const upsertManagedBlock = (existing: string, block: string): string => {
  const begin = existing.indexOf(BLOCK_BEGIN);
  const end = existing.indexOf(BLOCK_END);
  if (begin !== -1 && end !== -1 && end > begin) {
    const after = existing.slice(end + BLOCK_END.length).replace(/^\n/, "");
    return `${existing.slice(0, begin)}${block}${after}`;
  }
  if (existing === "") return block;
  return `${existing.replace(/\n*$/, "\n\n")}${block}`;
};

const readIfPresent = (file: string): string => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
};

const sshConfigPath = () => path.join(os.homedir(), ".ssh", "config");

/** Whether this machine already carries the managed Host block. */
export const sshConfigReady = (): boolean => readIfPresent(sshConfigPath()).includes(BLOCK_BEGIN);

const mendConfigHome = (): string => {
  const xdg = process.env["XDG_CONFIG_HOME"];
  return path.join(
    xdg === undefined || xdg === "" ? path.join(os.homedir(), ".config") : xdg,
    "mend",
  );
};

interface PickedKey {
  readonly publicKey: string;
  readonly identityFile: string | null;
}

const pickKey = (): PickedKey => {
  if (process.env["SSH_AUTH_SOCK"] !== undefined && process.env["SSH_AUTH_SOCK"] !== "") {
    const listed = spawnSync("ssh-add", ["-L"], { encoding: "utf8" });
    if (listed.status === 0) {
      const key = firstAgentKey(listed.stdout);
      if (key !== null) return { publicKey: key, identityFile: null };
    }
  }
  const dedicated = path.join(mendConfigHome(), "ssh", "id_ed25519");
  const existing = readIfPresent(`${dedicated}.pub`).trim();
  if (existing !== "") return { publicKey: existing, identityFile: dedicated };
  fs.mkdirSync(path.dirname(dedicated), { recursive: true, mode: 0o700 });
  const generated = spawnSync(
    "ssh-keygen",
    ["-t", "ed25519", "-f", dedicated, "-N", "", "-C", `mend-${os.hostname()}`],
    { encoding: "utf8" },
  );
  if (generated.status !== 0) {
    throw new Error(`ssh-keygen failed: ${generated.stderr.trim() || "unknown error"}`);
  }
  const fresh = readIfPresent(`${dedicated}.pub`).trim();
  if (fresh === "") throw new Error(`ssh-keygen reported success but ${dedicated}.pub is missing`);
  return { publicKey: fresh, identityFile: dedicated };
};

/**
 * Make this machine ready: pick a key, register it through the given call, write the managed
 * Host block. Idempotent — a rerun re-offers the same key (registration is idempotent per
 * owner) and rewrites the same block.
 */
export const runWorkspaceSshSetup = async (
  view: WorkspaceSshView & { readonly gateway: NonNullable<WorkspaceSshView["gateway"]> },
  ensureKey: (publicKey: string, name: string) => Promise<unknown>,
): Promise<void> => {
  const picked = pickKey();
  await ensureKey(picked.publicKey, os.hostname());
  const configFile = sshConfigPath();
  fs.mkdirSync(path.dirname(configFile), { recursive: true, mode: 0o700 });
  const block = managedBlock({
    host: view.gateway.host,
    port: view.gateway.port,
    identityFile: picked.identityFile,
  });
  fs.writeFileSync(configFile, upsertManagedBlock(readIfPresent(configFile), block), {
    mode: 0o600,
  });
};
