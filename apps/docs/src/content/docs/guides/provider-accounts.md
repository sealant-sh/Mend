---
title: Connect provider accounts
description: Connect Claude, Codex, and GitHub credentials to the user who launches Mend sessions.
sidebar:
  order: 1
---

Signing in to Mend and connecting a provider are separate steps. `mend login` authenticates the CLI
to your Mend server. `mend connect` attaches Claude, Codex, or GitHub to your own platform identity.

Each Mend user connects their own provider accounts. A session launches with the accounts of the
user who started it. Mend does not keep a copy of the credential. The CLI reads it on the current
machine and sends it directly to the connected-account API.

## See what is connected

```sh
mend accounts
```

The command lists Claude, Codex, and GitHub for the signed-in Mend user. It shows account metadata,
not credential values.

## Connect Codex

Sign in with the Codex CLI on the machine where you run `mend`:

```sh
codex login
mend connect codex
```

By default, Mend reads `auth.json` from `$CODEX_HOME` or `~/.codex/auth.json`.

To provide the file yourself:

```sh
mend connect codex --from-stdin < ~/.codex/auth.json
```

## Connect Claude

If the Claude credential already exists under `$CLAUDE_CONFIG_DIR` or `~/.claude`, run:

```sh
mend connect claude
```

Mend reads `.credentials.json` from that directory.

Claude can also create a setup token for another machine. Pipe or paste it through standard input:

```sh
claude setup-token
mend connect claude --from-stdin
```

`--from-stdin` reads until end of file. When pasting interactively, finish with your terminal's EOF
key.

## Connect GitHub

The normal path uses the GitHub CLI:

```sh
gh auth login
mend connect github
```

Mend runs `gh auth token` and forwards the returned token. You can also pipe it explicitly:

```sh
gh auth token | mend connect github --from-stdin
```

The GitHub account supplies `GH_TOKEN` and `GITHUB_TOKEN` to the workspace so `gh` and compatible
tools can authenticate without placing the token in the worktree. Repository clone, fetch, and push
authentication are separate. Read [Configure Git access](/guides/git-access/) when that page is
available; until then, see the repository's `docs/GIT-ACCESS.md` decision record.

## Replace or remove an account

Running `mend connect <provider>` again updates that provider's connected account.

Remove one with:

```sh
mend connect codex --remove
```

Use `claude`, `codex`, or `github` as the provider. The command fails rather than pretending to
remove an account that is not connected.

## Where the account is used

Connected accounts belong to your Mend user, not the machine-wide settings document. Mend resolves
them when it creates a workspace for a session you own. Other users must connect their own accounts.

A live workspace keeps the credentials it started with. Reconnect or remove an account before the
next workspace launch when you need the change to apply to new work.

## When an account is missing

A missing connected account does not block every launch. Mend first requests the harness account and
GitHub together, then retries with useful subsets when the platform reports that an account is
missing. The harness may open its own login flow when no connected provider credential is available.

`mend doctor` reports missing provider accounts as setup tasks rather than machine failures. Connect
the account explicitly when sessions must start non-interactively.
