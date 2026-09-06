# Mend for VS Code

Use VS Code as a quiet front door to Mend projects and coding-agent sessions.

The core loop: click **+** in the Mend view → pick **Workbench** (a fresh worktree that opens in VS
Code — run `claude` or `codex` yourself in the terminal, Mend observes and records it) or a
**Claude/Codex agent** on a prompt. Either way a window opens inside the session's workspace. Click
any existing session to open it the same way.

- Browse projects and sessions from the Mend Activity Bar view.
- Open a session's workspace over SSH, through the Mend server's workspace gateway.
- Start Claude or Codex sessions without building harness arguments in the extension.
- Open the canonical session and review surfaces in Mend.

The extension reads the same `~/.config/mend/cli.json` connection used by the Mend CLI. Run
`Mend: Connect to server` to override it. Remote opening requires the Microsoft Remote SSH
extension.

## Opening the workspace (recommended)

Opening a session opens its workspace: the same worktree files, but the integrated terminal runs
inside the workspace — its image, its environment, and the mounted harness home. A `claude` or
`codex` you run there is observed by Mend: the session shows running, the workspace stays leased,
and the conversation is recorded and natively resumable from any device. A settled session offers a
shell resume first — the shell keeps the fresh workspace alive while the editor is attached.

The first open offers "Set up workspace SSH?" Mend registers this client's key and adds a
server-specific Host block at the start of `~/.ssh/config`, before wildcard defaults. Existing
hand-written configuration is preserved. Setup reuses the selected key on later runs. On first setup
it can save an agent public-key selector or create a dedicated key under `~/.config/mend/ssh`. An
encrypted or missing private key requires that exact identity in an unlocked agent, not just any
agent key. Setup never prompts for a passphrase.

Re-run with `Mend: Set up workspace SSH` or `mend ssh setup`. The SSH hostname comes from the
configured Mend URL; the server publishes the port. `mend.workspaceSshHost` overrides the hostname
for unusual networks.

Setup reports configuration and client-key registration only. It does not test a connection or
verify the gateway's host key. OpenSSH accepts a previously unknown host key on first connection and
rejects changed keys. Mend never clears `known_hosts`. For a host-key mismatch, follow the
[fingerprint verification and manual rotation procedure](../cli/README.md#gateway-host-key-rotation)
before removing only this server's HostKeyAlias entry.

There is no host-path fallback. A missing gateway, a failed discovery, or an authentication error
stops the open with a message instead of opening a folder on the host, where a terminal would run
outside Mend's observation. `Mend: Copy worktree path` still copies the server-side path for your
own use.

Deep links: `vscode://sealant-sh.mend/open?session=<session-id>`
