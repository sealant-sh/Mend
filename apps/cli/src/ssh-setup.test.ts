import { describe, expect, it } from "vitest";

import {
  firstAgentKey,
  hasManagedBlock,
  managedSshConfigBlock,
  SSH_HOST_ALIAS,
  upsertManagedBlock,
} from "./ssh-setup.ts";

describe("firstAgentKey", () => {
  it("returns the first offered key line", () => {
    const output = "ssh-ed25519 AAAAC3Nza… yiannis@mac\nssh-rsa AAAAB3Nza… old\n";
    expect(firstAgentKey(output)).toBe("ssh-ed25519 AAAAC3Nza… yiannis@mac");
  });

  it("accepts ecdsa keys and skips noise lines", () => {
    expect(firstAgentKey("The agent has no identities.\n")).toBeNull();
    expect(firstAgentKey("\necdsa-sha2-nistp256 AAAA… work\n")).toBe(
      "ecdsa-sha2-nistp256 AAAA… work",
    );
  });
});

describe("managed ssh config block", () => {
  it("carries the gateway, the alias, and the identity when one is on disk", () => {
    const block = managedSshConfigBlock({
      host: "10.0.0.214",
      port: 2222,
      identityFile: "/home/u/.config/mend/ssh/id_ed25519",
    });
    expect(block).toContain(`Host ${SSH_HOST_ALIAS}`);
    expect(block).toContain("HostName 10.0.0.214");
    expect(block).toContain("Port 2222");
    expect(block).toContain("IdentityFile /home/u/.config/mend/ssh/id_ed25519");
    expect(block).toContain("IdentitiesOnly yes");
    expect(block).toContain("StrictHostKeyChecking accept-new");
  });

  it("omits identity lines for an agent-held key", () => {
    const block = managedSshConfigBlock({ host: "gw", port: 22, identityFile: null });
    expect(block).not.toContain("IdentityFile");
    expect(block).not.toContain("IdentitiesOnly");
  });
});

describe("upsertManagedBlock", () => {
  const block = managedSshConfigBlock({ host: "gw", port: 2222, identityFile: null });

  it("appends to an existing config without touching it", () => {
    const existing = "Host github.com\n  User git\n";
    const merged = upsertManagedBlock(existing, block);
    expect(merged.startsWith("Host github.com\n  User git\n")).toBe(true);
    expect(hasManagedBlock(merged)).toBe(true);
  });

  it("replaces a previous managed block in place, idempotently", () => {
    const older = managedSshConfigBlock({ host: "old-gw", port: 22, identityFile: null });
    const config = upsertManagedBlock("Host github.com\n  User git\n", older);
    const updated = upsertManagedBlock(config, block);
    expect(updated).toContain("HostName gw");
    expect(updated).not.toContain("old-gw");
    expect(upsertManagedBlock(updated, block)).toBe(updated);
    expect(updated.match(/Host mend-ws/g)).toHaveLength(1);
  });

  it("stands alone in an empty config", () => {
    expect(upsertManagedBlock("", block)).toBe(block);
  });
});
