# Mend for VS Code

Use VS Code as a quiet front door to Mend projects and coding-agent sessions.

- Browse projects and sessions from the Mend Activity Bar view.
- Open a session worktree locally or through VS Code Remote SSH.
- Start Claude or Codex sessions without building harness arguments in the extension.
- Open the canonical session and review surfaces in Mend.

The extension reads the same `~/.config/mend/cli.json` connection used by the Mend CLI. Run
`Mend: Connect to server` to override it. Remote worktree opening requires the Microsoft Remote SSH
extension and an existing SSH host alias.

Deep links: `vscode://sealant-sh.mend/open?session=<session-id>`
