import * as os from "node:os";
import * as path from "node:path";

import {
  configuredWorkspaceSshIdentityFile,
  inspectWorkspaceSshReadiness,
  pickWorkspaceSshKey,
  readWorkspaceSshConfig,
  writeWorkspaceSshConfig,
  type WorkspaceSshReadiness,
  type WorkspaceSshTarget,
} from "@mend/workspace-ssh";

import type { WorkspaceSshView } from "./types.js";

const sshConfigPath = (): string => path.join(os.homedir(), ".ssh", "config");

const mendConfigHome = (): string => {
  const xdg = process.env["XDG_CONFIG_HOME"];
  return path.join(
    xdg === undefined || xdg === "" ? path.join(os.homedir(), ".config") : xdg,
    "mend",
  );
};

/** Inspect this client's exact key registration and managed block for one Mend server. */
export const workspaceSshReadiness = (
  view: WorkspaceSshView,
  target: WorkspaceSshTarget,
): WorkspaceSshReadiness => {
  const config = readWorkspaceSshConfig(sshConfigPath());
  if (!config.ok) throw config.error;
  const picked = pickWorkspaceSshKey({
    configHome: mendConfigHome(),
    configuredIdentityFile: configuredWorkspaceSshIdentityFile(config.value, target),
    create: false,
  });
  if (!picked.ok) throw picked.error;
  return inspectWorkspaceSshReadiness({
    config: config.value,
    target,
    key: picked.value,
    registeredFingerprints: view.keys.map((key) => key.fingerprint),
  });
};

/** Register this client's key and reconcile only this Mend server's managed OpenSSH block. */
export const runWorkspaceSshSetup = async (
  target: WorkspaceSshTarget,
  ensureKey: (publicKey: string, name: string) => Promise<unknown>,
): Promise<void> => {
  const config = readWorkspaceSshConfig(sshConfigPath());
  if (!config.ok) throw config.error;
  const picked = pickWorkspaceSshKey({
    configHome: mendConfigHome(),
    configuredIdentityFile: configuredWorkspaceSshIdentityFile(config.value, target),
    create: true,
  });
  if (!picked.ok) throw picked.error;
  if (picked.value === null) throw new Error("No workspace SSH key is available.");
  await ensureKey(picked.value.publicKey, os.hostname());
  const written = writeWorkspaceSshConfig(sshConfigPath(), target, picked.value.identityFile);
  if (!written.ok) throw written.error;
};
