# Mend — by [Sealant](https://github.com/sealant-sh/sealant)

**Code is now cheap. Trust is not.**

Mend is a **local-first workbench for developers who use coding agents heavily**. It keeps the three
things that are otherwise scattered across terminals, provider apps, and browser tabs in one place:
project context, agent sessions, and code changes with their review.

You keep the agent you already trust. Mend wraps it:

```
mend codex → recorded session in a store worktree → local review with provenance → follow-up → commit or PR
```

Adopt a repository into Mend's store, run your own harness (`mend codex`, `mend claude`,
`mend run -- <cmd>`) in a per-session git worktree under Sealant supervision, then review the
accumulated change properly — a first-class diff where every hunk can answer _why did this change?_
from the recording, comments send back to the same session as an editable follow-up, and "Mend read
this change" will draft evidence-linked findings a diff-only reviewer cannot make. Steer the working
session loop from a phone over your tailnet. No issue tracker and no pull request required;
publication is optional output, not the point.

Mend is open-source, self-hosted, and built on the public
[`@sealant/sdk`](https://www.npmjs.com/package/@sealant/sdk) — no private hooks into the
[Sealant](https://github.com/sealant-sh/sealant) runtime underneath.

See [`MEND-AGENT-WORKBENCH-PLAN.md`](MEND-AGENT-WORKBENCH-PLAN.md) for the canonical product
direction, including the milestone plan and the decision log.

## Status

**In development — marketing refreshed 2026-08-01.** Mend pivoted from an issue-to-PR queue product
to the agent workbench described in the plan. The queue-era surfaces (board, brief, run audit) are
being reframed into the session and review workbench; the retired product documents live in
`docs/archive/`. The marketing site follows the workbench direction and labels planned capabilities.

## Monorepo

- `apps/marketing` — the public site (TanStack Start on Cloudflare Workers)
- `apps/web` — the product app: Now · projects · sessions · review
- `packages/ui` — the Evidence Review design tokens, vendored from the platform
- `tooling/typescript` — shared tsconfig bases

```sh
pnpm install
pnpm dev        # all apps (turbo)
pnpm typecheck  # tsgo, never tsc
pnpm lint
pnpm format:fix
```

## Acknowledgments

Mend borrows deliberately from projects that solved hard problems well. Vendored code keeps its
upstream license and notices next to it.

- **[t3code](https://github.com/pingdotgg/t3code)** (T3 Tools Inc., MIT) — the project we've taken
  the most from:
  - `apps/mobile/modules/t3-terminal` vendors their native terminal module (libghostty on iOS via
    `GhosttyKit.xcframework`, `libghostty-vt` over JNI on Android); notices in that directory.
  - `apps/desktop/src/renderer/src/terminal/ghostty` adapts their browser terminal — the official
    `libghostty-vt` C ABI compiled to wasm with their own renderer and input surface; notices in
    that directory.
  - The desktop inbox re-implements their sidebar model: static creation order (activity never
    reorders), attention carried by contrast, client-local unseen state, lifecycle shelves, held-
    modifier jump hints.
  - The terminal reconnect discipline (fixed ladder, reset-once-stable, retry on focus), the mobile
    chat list's pinned-follow scrolling, PTY frame coalescing, and the notification suppression
    guards were studied in their source and re-implemented here.
- **[Ghostty](https://github.com/ghostty-org/ghostty)** (Mitchell Hashimoto & contributors, MIT) —
  `libghostty-vt` is the terminal core behind every Mend terminal surface, on all three platforms.
- **[ghostty-web](https://github.com/coder/ghostty-web)** (Coder, MIT) — the wasm terminal used by
  `apps/web`.
- **Symbols Nerd Font** (Ryan L McIntyre, MIT) — vendored with the desktop terminal so prompt glyphs
  render without a locally installed Nerd Font.

## License

Apache-2.0
