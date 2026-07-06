# Mend — by [Sealant](https://github.com/sealant-sh/sealant)

**Code is now cheap. Trust is not.**

Mend takes an issue from your tracker (GitHub, Linear, or Jira), has a coding agent fix it in a
recorded sandbox, and then reviews the change **against that recording** — every other reviewer,
human or bot, reads the diff and guesses. What comes out is a pull request whose review is already
done: **the brief**.

```
issue in → a harness mends it in a recorded sandbox → Mend reviews the change → you merge
```

The brief answers the reviewer's questions from the recording: the bug reproduces on base, the fix
passes on head, the revert re-breaks; which scenarios were never run; which edits are unrelated to
the issue; where every idea came from (the source trail). By default each successful run opens a
draft PR immediately, and approving in Mend merges it. Failed runs post what they tried and observed
as a comment on the issue.

Mend is open-source, self-hosted, and built on the public
[`@sealant/sdk`](https://www.npmjs.com/package/@sealant/sdk) — no private hooks into the
[Sealant](https://github.com/sealant-sh/sealant) runtime underneath.

See [`MEND-PLAN.md`](MEND-PLAN.md) for the full product definition.

## Status

**In development.** The marketing page and the queue surface are being built now; tracker and PR
integrations follow. The mobile app (full loop, including merge) is in design.

## Monorepo

- `apps/marketing` — the public site (TanStack Start on Cloudflare Workers)
- `apps/web` — the product app: the queue (`triage → queued → mending → review → merged`)
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
