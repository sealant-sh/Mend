# Mend

**Code is now cheap. Trust is not.**

Mend, by [Sealant](https://github.com/sealant-sh/sealant), is for developers who run coding agents
heavily and work from more than one device. It co-locates agent sessions, their git worktrees, and
the project context they run with in one self-hostable environment, and makes working there feel
like real local development from whichever device you pick up. The work stops scattering across
terminals, provider apps, and browser tabs.

```text
mend codex → recorded session in a store worktree → local review with provenance → follow-up → commit or PR
```

Inside an adopted repository, `mend codex`, `mend claude`, or `mend run -- <cmd>` starts the agent
the way it always started: a real terminal, a real git worktree. What changes is where everything
lives. The session runs under Sealant supervision on the Mend machine, next to the worktree it edits
and the context it launched with: repository instructions, environment and secrets, mounted
references, your accounts and dotfiles. Close the terminal and the agent keeps working. Come back
from the CLI, a browser, the desktop app, or a phone on your tailnet, and the same session picks up
where it was.

Review the accumulated change in the same place. Every hunk in the diff can answer "why did this
change?" from the recording, comments go back to the same session as an editable follow-up, and
"Mend read this change" drafts evidence-linked findings a diff-only reviewer cannot make. No issue
tracker, no pull request required; publication is optional output, not the point.

Mend is open-source, self-hosted, and built on the public
[`@sealant/sdk`](https://www.npmjs.com/package/@sealant/sdk), with no private hooks into the Sealant
runtime underneath. [`MEND-AGENT-WORKBENCH-PLAN.md`](MEND-AGENT-WORKBENCH-PLAN.md) is the canonical
product direction and carries the decision log.

## Install

One command sets up the whole thing on a Linux machine with Docker: the Sealant control plane
(without its web app, since Mend is the login), the Mend server as a user service, and the `mend`
CLI. Nothing needs sudo. macOS is untested; the installer stops on Darwin unless
`MEND_ALLOW_MACOS=1` is set.

```sh
curl -fsSL https://mend.sealant.dev/install.sh | sh
```

Then open `http://localhost:3105`, create the first account, `mend login`, `mend connect claude` (or
`codex`, `github`), and run `mend claude` or `mend codex` inside a repository. `mend pair` hands a
phone the same server; the native app in `apps/mobile` is unpublished, so build it yourself or open
the URL in the phone's browser.

Two network facts matter before you install. Postgres and the control plane bind to loopback, but
the Mend server binds every interface so a phone on your tailnet or LAN can reach it. And sign-up
stays open after the first account, so anyone who can reach the port can create one. Keep the
machine on a network you control.

Re-running the script repairs rather than reinstalls and leaves the volumes alone;
`MEND_VERSION=latest SEALANT_VERSION=latest` upgrades. The knobs (ports, directories, dry run) are
listed in the header of [`install.sh`](install.sh).

## Deploying further away

That installer is the first of three deployment tiers, and the product behaves the same on each.

The same script works on a VPS or home server. Put the host behind Tailscale or another private
network, run `mend login --url http://your-vps:3105` from your laptop, and every command works
unchanged; `mend connect` still reads provider credentials from the machine you sit at, never the
server.

The third tier is Kubernetes. Mend ships a Helm chart at [`deploy/helm/mend`](deploy/helm/mend) and
Sealant ships its own: Mend runs as a Deployment, session workspaces are Pods, and both mount the
same ReadWriteMany store volume, so nothing is cloned into a workspace and nothing syncs back.
`mend service connect` brings a workspace Service's port to your own loopback over an authenticated
tunnel, with no cluster networking exposed. [`docs/KUBERNETES.md`](docs/KUBERNETES.md) is the
operator record, and [`docs/DEPLOYMENT-STRATEGIES.md`](docs/DEPLOYMENT-STRATEGIES.md) names the
model behind the tiers.

## Status

In development. The server, CLI, web app, desktop app, VS Code extension, documentation site, and
Kubernetes charts exist in the repository; the native mobile app is unpublished. The documentation
site's feature-status page separates current behavior from planned work. Treat plan milestones as
direction, not release status.

## Monorepo

- `apps/api`: the Mend API server (contract, auth, session engine, workers)
- `apps/cli`: the `mend` CLI
- `apps/web`: the product app, Now · projects · sessions · review
- `apps/desktop`: the Electron workbench
- `apps/mobile`: the Expo native app (unpublished)
- `apps/vscode`: the VS Code extension
- `apps/docs`: the documentation site (Astro Starlight)
- `apps/marketing`: the public site (TanStack Start on Cloudflare Workers)
- `packages/*`: shared libraries (`domain`, `db`, `api-contracts`, `sessions`, `store`, `ui`, …)
- `deploy/helm/mend`: the Helm chart
- `tooling/typescript`: shared tsconfig bases

```sh
pnpm install
pnpm dev                         # product web app
pnpm --filter @mend/docs dev     # documentation site on port 3103
pnpm typecheck                   # tsgo, never tsc
pnpm lint
pnpm format:fix
```

## Acknowledgments

Mend borrows deliberately from projects that solved hard problems well. Vendored code keeps its
upstream license and notices next to it.

- [t3code](https://github.com/pingdotgg/t3code) (T3 Tools Inc., MIT) is the project we've taken the
  most from:
  - `apps/mobile/modules/t3-terminal` vendors their native terminal module (libghostty on iOS via
    `GhosttyKit.xcframework`, `libghostty-vt` over JNI on Android); notices in that directory.
  - `apps/desktop/src/renderer/src/terminal/ghostty` adapts their browser terminal, the official
    `libghostty-vt` C ABI compiled to wasm with their own renderer and input surface; notices in
    that directory.
  - The desktop inbox re-implements their sidebar model: static creation order (activity never
    reorders), attention carried by contrast, client-local unseen state, lifecycle shelves, held-
    modifier jump hints.
  - The terminal reconnect discipline (fixed ladder, reset-once-stable, retry on focus), the mobile
    chat list's pinned-follow scrolling, PTY frame coalescing, and the notification suppression
    guards were studied in their source and re-implemented here.
- [Ghostty](https://github.com/ghostty-org/ghostty) (Mitchell Hashimoto & contributors, MIT):
  `libghostty-vt` is the terminal core behind every Mend terminal surface, on all three platforms.
- [ghostty-web](https://github.com/coder/ghostty-web) (Coder, MIT): the wasm terminal used by
  `apps/web`.
- Symbols Nerd Font (Ryan L McIntyre, MIT): vendored with the desktop terminal so prompt glyphs
  render without a locally installed Nerd Font.

## License

Apache-2.0
