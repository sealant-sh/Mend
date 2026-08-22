---
"@sealant/mend": minor
---

Each Mend user is their own Sealant user. Mend now authenticates to the control plane as a service
principal (`SEALANT_SERVICE_KEY`; `SEALANT_OWNER_USER_ID` is gone) and provisions one Sealant user
per account on first use, so sessions, records and model calls are attributed to the person who made
them and run on that person's own connected accounts.

- `mend connect claude|codex|github [--from-stdin] [--remove]` sends this machine's credential (the
  file the provider's CLI wrote at login, or a pasted one) to the platform under your own user;
  `mend accounts` lists what is connected. The Sealant web app is no longer needed.
- Settings → Connected accounts does the same on web and desktop.
- A hot-pool skeleton is claimed only by sessions of the user it was warmed for.

Requires a control plane with service principals (`SEALANT_SERVICE_KEYS`, `POST /v1/users`).
