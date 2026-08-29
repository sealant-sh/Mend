# Mend for VS Code

Use VS Code as a quiet front door to Mend projects and coding-agent sessions.

- Browse projects and sessions from the Mend Activity Bar view.
- Open a session's workspace over SSH — or its worktree locally / on the Mend machine.
- Start Claude or Codex sessions without building harness arguments in the extension.
- Open the canonical session and review surfaces in Mend.

The extension reads the same `~/.config/mend/cli.json` connection used by the Mend CLI. Run
`Mend: Connect to server` to override it. Remote opening requires the Microsoft Remote SSH
extension.

## Opening the workspace (recommended)

Set `mend.workspaceSshGateway` to the Sealant workspace SSH gateway (`host:port` or an
`~/.ssh/config` alias). Opening a session then opens its workspace: the same worktree files, but the
integrated terminal runs inside the workspace — its image, its environment, and the mounted harness
home. A `claude` or `codex` you run there is observed by Mend: the session shows running, the
workspace stays leased, and the conversation is recorded and natively resumable from any device.
Your SSH public key must be registered with Sealant; the gateway authenticates you by it (username
`ws-<workspace id>` is set automatically). A settled session offers a shell resume first — the shell
keeps the fresh workspace alive while the editor is attached.

Without the gateway setting, opening falls back to the worktree path: local when it exists, else via
`mend.remoteSshHost` on the Mend machine. Note the fallback terminal runs on the host, not in the
workspace — agents run there are outside Mend's observation.

Deep links: `vscode://sealant-sh.mend/open?session=<session-id>`
