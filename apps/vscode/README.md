# Mend for VS Code

Use VS Code as a quiet front door to Mend projects and coding-agent sessions.

The core loop: click **+** in the Mend view → pick **Workbench** (a fresh worktree that opens in VS
Code — run `claude` or `codex` yourself in the terminal, Mend observes and records it) or a
**Claude/Codex agent** on a prompt. Either way a window opens inside the session's workspace. Click
any existing session to open it the same way.

- Browse projects and sessions from the Mend Activity Bar view.
- Open a session's workspace over SSH — or its worktree locally / on the Mend machine.
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

Setup is one dialog, once per machine: the first open offers "Set up workspace SSH?" — Mend uses
your ssh-agent key (or creates a dedicated one under `~/.config/mend/ssh`), registers it under your
account, and adds one managed Host block to `~/.ssh/config`. Re-run it any time with
`Mend: Set up workspace SSH` (or `mend ssh setup` in a terminal). The gateway address comes from the
server; `mend.workspaceSshGateway` and `mend.workspaceSshUsernamePrefix` remain as overrides for
unusual networks.

When the deployment exposes no gateway, opening falls back to the worktree path: local when it
exists, else via `mend.remoteSshHost` on the Mend machine. The fallback terminal runs on the host,
not in the workspace — agents run there are outside Mend's observation.

Deep links: `vscode://sealant-sh.mend/open?session=<session-id>`
