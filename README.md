# Mend — by [Sealant](https://github.com/sealant-sh/sealant)

**issue → reviewed change → PR**

Give a coding harness an engineering task — a GitHub issue — and get back the change, the checks,
the artifacts, and the full execution record, ending in a pull request you review like a teammate's
work.

```
file an issue  →  a harness mends it in a sandbox  →  review the run  →  merge the PR
```

Mend is an open-source product built on the [Sealant](https://github.com/sealant-sh/sealant)
platform, consuming the public SDK (`@sealant/sdk`) from the outside — the same SDK you can build
on. Every change Mend proposes arrives with its evidence: the diff, the commands that ran, the
checks that were observed, and a replayable record of the whole run. Mend reports; you decide.

## Status

**Building now.** The marketing page and the queue surface are under active development; the GitHub
integration (issue intake, branch/PR creation) follows. Follow along or star the repo to watch it
land.

## Monorepo

- `apps/marketing` — the public site (TanStack Start on Cloudflare Workers)
- `apps/web` — the product app: the queue (`triage → queued → mending → review → PR opened`)
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
