---
"@sealant/mend": minor
---

`mend login [--url <server>]` signs the CLI in: it prompts for the email and password of your Mend
account, exchanges them for a bearer token, and stores it (0600) in the CLI config next to the
server url, so every other command is authenticated without setting `MEND_TOKEN`. `mend logout`
clears it. Unauthenticated calls now say which server refused them and point at `mend login` instead
of the bare "set MEND_TOKEN" hint.
