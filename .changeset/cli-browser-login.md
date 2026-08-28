---
"@sealant/mend": minor
---

`mend login` signs in through the browser instead of asking for a password. The CLI opens an
authorize request against the server, points the browser at `<server>/authorize?code=…`, and polls
until you press Authorize there. Approval mints a revocable device token, the same kind a paired
phone holds. It shows up under Settings → Devices and replaces the old expiring session token, so
the CLI no longer signs itself out when a browser session would have lapsed. A server that is
already configured (`--url`, `MEND_URL`, or the config file) is used without asking; only a fresh
machine with nothing set prompts for the URL, and Enter accepts the default. `--email` and the
terminal password prompt are gone. `mend logout` now revokes the device server-side before
forgetting the token locally.
