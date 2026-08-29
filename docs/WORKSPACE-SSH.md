# Workspace SSH

How an editor (VS Code over Remote-SSH, or plain `ssh`) reaches a session's workspace, and the plan
that takes setup from "configure a gateway and register a key" to "log in once".

Decided 2026-08-29. Phase 0 shipped in mend#151; phases 1–3 span mend, sealant, and the SDK. The
observed-agents work (mend#147/#148) is what makes an editor terminal first-class: an agent run by
hand inside the workspace writes through the mounted harness home, so Mend observes it, records it,
and can resume it natively.

## The target user story

Install the extension (or `mend login`) once. Open the Mend view, pick a session — or a project →
New Session → Open in VS Code. The window opens with the worktree at `/workspace/repo` and the
integrated terminal inside the workspace. Nothing else: no Sealant UI, no key ceremony, no settings.

The enabling fact: the user already holds an identity Mend trusts — the login token in
`~/.config/mend/cli.json` — and Mend maps it to the Sealant principal that owns their workspaces.
Everything else is derivable machine-to-machine.

## Mechanics (all phases)

- The Sealant workspace SSH gateway authenticates a connection by key (later: certificate), resolves
  the key's principal, authorizes the principal against the workspace named in the username
  (`ws-<workspaceId>`), and bridges SSH channels onto the workspace's `sealantd` control connection.
  It already implements `shell`, `exec`, `env`, the `sftp` subsystem, and `direct-tcpip` — the full
  set VS Code Remote-SSH needs (the forward path is explicitly the Remote-SSH server path in the
  gateway source).
- The extension opens `ssh-remote+ws-<workspaceId>@mend-ws` with folder `/workspace/repo`, where
  `mend-ws` is one static managed block in `~/.ssh/config` (host, port, identity, `accept-new`). The
  workspace id travels in the username, so no per-session SSH config ever exists.
- A settled session is offered a shell resume first: the shell holds the fresh workspace's lease
  while the editor is attached; no agent is launched.

## Phase 0 — manual (shipped, mend#151)

`mend.workspaceSshGateway` and `mend.workspaceSshUsernamePrefix` settings; the user registers their
key with Sealant themselves. Proves the path; too much ceremony to keep.

## Phase 1 — self-service, one-dialog setup

Sealant API + SDK:

- `GET /v1/system/workspace-ssh` → `{ host, port, usernamePrefix }` — deployment config the API
  already holds in env, readable by any authenticated principal.
- User-scoped `sshKeys.ensure`: the owner is the CALLER's principal (today `createSshKey` trusts a
  caller-supplied owner — service-key territory). Idempotent by fingerprint. Every Sealant user may
  offer their own keys.
- SDK: `client.workspaceSsh.info()`, `client.sshKeys.ensure/list/remove`.

Mend:

- `/api/workspace-ssh`: gateway info plus whether the current user has a registered key, proxied
  through the SDK under the user's principal. The extension talks only to Mend.
- Extension first-open dialog ("Set up workspace SSH?"): generate a dedicated keypair at
  `~/.config/mend/ssh/id_ed25519` — or take a public key from the running ssh-agent, so no new
  private key material exists — register it via `/api/workspace-ssh`, write the managed
  `~/.ssh/config` block. Same flow as `mend ssh setup` in the CLI, offered at `mend login`.
- After New Session, offer Open in VS Code directly.

Result: one dialog, once per machine. The phase-0 settings become overrides for unusual networks.

## Phase 2 — certificates: setup disappears

Replace registration with short-lived OpenSSH user certificates:

- The Sealant API holds an SSH CA. New SDK call `workspaces.sshCredential(workspaceId)` returns a
  minutes-long certificate binding this principal to this workspace.
- The gateway trusts the CA and authorizes from the certificate; the registered-keys path stays for
  plain `ssh` users.
- The extension fetches a certificate through Mend per open, invisibly. Registration ceases to exist
  as a concept — login is the setup. The local keypair is generated silently and never registered
  anywhere; the certificate vouches for it.
- Optional, where the gateway port is unreachable: `ProxyCommand mend ws-connect %n` tunnels the SSH
  stream over Mend's authenticated WebSocket — the `mend keys share` transport pattern in reverse,
  keeping the no-public-ingress principle.

## Phase 3 — attachments are leases

The gateway knows who is connected to which workspace; today Mend does not. Gateway reports active
attachments per workspace; the SDK exposes them; the engine treats a live attachment like a live
process row — TTL renewal and reap deferral — and the session view can say "editor attached". This
closes the honesty gap where an attached editor loses its workspace to the TTL, and gives the
external-agent observer a presence signal cleaner than transcript mtimes.

## Order

Phase 1 is thin and ships first (three API additions, an SDK bump, one Mend route, one dialog).
Phase 2 is independent of Phase 1's UX — the config block and open flow are identical, only the auth
material changes — so nothing from phase 1 is thrown away. Phase 3 is orthogonal.
