---
title: Environment variables and secrets
description: Load project configuration and write-only secrets into future Mend workspaces.
sidebar:
  order: 4
---

Mend stores project environment input in two lanes. Both become environment variables in future
workspace processes, but they have different storage and read behavior.

| Lane          | Storage                            | Read behavior                            | Use for                                                  |
| ------------- | ---------------------------------- | ---------------------------------------- | -------------------------------------------------------- |
| Configuration | Plaintext                          | Names and values can be read back        | Ports, modes, feature switches, public URLs              |
| Secrets       | Encrypted with a machine-local key | Names are visible; values are write-only | Passwords, tokens, private keys, credential-bearing URLs |

Changes apply from the next workspace launch. Running agents, shells, and Services keep the values
their workspace started with.

## Load a `.env` file

From an adopted project:

```sh
mend env load
```

The default file is `.env`. Pass another path when needed:

```sh
mend env load .env.development
```

Use `--project` when the current directory does not identify the target project:

```sh
mend env load .env.development --project api
```

Mend parses the file, upserts accepted names, and reports malformed or rejected lines. Existing
entries with the same name are replaced.

## Secret routing

During import, names containing common secret markers such as `TOKEN`, `SECRET`, `PASSWORD`,
`PASSWD`, `CREDENTIAL`, or `APIKEY` go to Secrets. Names ending in `_KEY`, and the exact name `KEY`,
also go to Secrets.

Send the whole file to Secrets:

```sh
mend env load .env --secret
```

Send named values to Secrets while leaving the rest to automatic routing:

```sh
mend env load .env --secret DATABASE_URL,SENTRY_DSN
```

This is useful for URLs that embed a password but do not look secret from their name.

## Inspect stored names

```sh
mend env show
```

The command prints configuration names and secret names. It labels configuration as plaintext and
never prints secret values.

## Edit in the web app

Open the project's **Setup** page. The Configuration and Secrets sections support create, rename,
replace, and remove operations. Secret rows only show whether a value is set.

Renaming a secret without entering another value preserves the stored value. Replacing it writes a
new encrypted value.

## Reserved names

Mend rejects names that belong to the platform or can change process startup. Examples include:

- `PATH`, shell startup variables, and runtime injection variables such as `NODE_OPTIONS`;
- `GIT_SSH_COMMAND`, which Mend owns for the workspace Git transport;
- `GITHUB_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN`, which come from connected accounts;
- names beginning with `MEND_` or `SEALANT_`.

Use [provider accounts](/guides/provider-accounts/) for Claude, Codex, and GitHub credentials rather
than copying those credentials into project secrets.

## Security boundary

Secret values are encrypted at rest with a machine-local key. The API never returns them. At a fresh
launch, Mend decrypts the current set once and passes it through Sealant's transient secret channel.

Losing the machine key makes stored values unrecoverable. Re-enter them rather than expecting Mend
to reveal or export them.
