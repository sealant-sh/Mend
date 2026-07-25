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
this change" drafts evidence-linked findings a diff-only reviewer cannot make. Steer all of it from
a phone over your tailnet. No issue tracker and no pull request required; publication is optional
output, not the point.

Mend is open-source, self-hosted, and built on the public
[`@sealant/sdk`](https://www.npmjs.com/package/@sealant/sdk) — no private hooks into the
[Sealant](https://github.com/sealant-sh/sealant) runtime underneath.

See [`MEND-AGENT-WORKBENCH-PLAN.md`](MEND-AGENT-WORKBENCH-PLAN.md) for the canonical product
direction, including the milestone plan and the decision log.

## Status

**In development — direction reset 2026-07-25.** Mend pivoted from an issue-to-PR queue product to
the agent workbench described in the plan. The queue-era surfaces (board, brief, run audit) are
being reframed into the session and review workbench; the retired product documents live in
`docs/archive/`. The marketing site still pitches the old flow and will be refreshed.

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

## License

Apache-2.0
