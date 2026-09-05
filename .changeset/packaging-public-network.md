---
"@sealant/mend": minor
---

Use `APP_URL` and explicit `MEND_ALLOWED_ORIGINS` for authentication, credentialed CORS, pairing,
and advertised addresses. Enforce the policy on unsafe cookie-authenticated requests and WebSocket
upgrades, including the web proxy. Pairing clients honor the server's configured addresses. Stop
trusting discovered container interfaces and forwarded host headers. Pin the Sealant SDK and API
contracts to 0.28.0 for the upcoming container bundle.
