---
"@sealant/mend": patch
---

Two protocol-session fixes, both diagnosed live on a Kubernetes deployment:

- Claude sessions no longer show every assistant message twice. The stream-json CLI echoes each
  completed content block as its own `assistant` event whose content array holds just that block;
  the adapter keyed those echoes by array position (always 0), so with a thinking block at stream
  index 0 the completed text landed on the thinking block's item while the streamed deltas had
  already built the same text under its real id. The adapter now recovers the true stream index by
  counting consumed blocks per provider message id.
- Resuming (or following up on) a stopped protocol session onto a fresh workspace now restores the
  harvested harness state before the harness starts. `launchProtocol` passed an explicit null state
  to `launchInternal` — the contract that skips both the read and the restore — while the composed
  argv still resumed by provider id, so `claude --resume` exited with "No conversation found".
  Deployments that reuse a retained workspace never saw this; fresh-workspace relaunches
  (Kubernetes, stopped workspaces) always did.
