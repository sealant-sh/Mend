# Git Access — SSH, custom servers, and the workspace shim

Design notes from the 2026-08-13/14 discussion. Decisions here govern the git story for alpha; the
delivery prompt lives with the session that builds it.

## Where git actually runs today (verified against live containers)

- Mend's clone/fetch happen **on the Mend server host** (`git clone --bare` into the store,
  `GIT_TERMINAL_PROMPT=0`). If the login user's `git clone git@gitlab.com:…` works in a shell, it
  works in Mend today — GitLab and custom servers included. What breaks: passphrase keys without an
  agent, first-contact host-key prompts, and there is no readable failure surface.
- Inside a workspace, **full local git already works with zero credentials**: the worktree mounts at
  `/workspace/repo` and the bare `repo.git` is bind-mounted **path-identically, read-write**, so the
  worktree's `gitdir:` pointer resolves and the object store is shared. Host-side fetches are
  instantly visible inside every session through the filesystem.
- Remote access from inside a workspace is today GitHub-only via the platform's injected
  connected-account credential (`gh` / `GITHUB_TOKEN`).

## Decisions

1. **Two auth modes per project, host-side only.**
   - _Ambient_ (default): the login user's git/ssh setup, unchanged. Fix the failure story only: run
     ssh with `BatchMode=yes`, surface "permission denied / host key unknown" as readable errors
     instead of dead clones.
   - _Mend key_: Mend generates an ed25519 keypair on the server machine (`~/.mend/keys/`, 0600;
     private key never leaves the host, never enters a workspace). The UI/CLI shows the public key
     with a copy button — "add this as a deploy key" on GitHub/GitLab/Gitea/anything. Git ops run
     with
     `GIT_SSH_COMMAND="ssh -i <key> -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"`.
     This is the recommended mode for a served Mend (homelab): the key is born on the machine that
     fetches, and hardware-key users get a scoped, revocable identity instead of an impossible copy.

2. **YubiKey / hardware keys: the agent bridge (later, optional).** A hardware key cannot be copied
   and demands a touch per signature, so it can never back daemon fetches. The universal interface
   in front of it is the ssh-agent socket; agent forwarding is a solved shape. `mend keys share` on
   the laptop reverse-forwards the local `SSH_AUTH_SOCK` to the Mend server over the private network
   (one outbound WebSocket, agent-protocol frames inside; nothing secret ever transits — challenges
   and signatures only). While connected, user-initiated git ops can sign through it; the key blinks
   on the laptop. Disconnected → those ops fail "no signer present" and the deploy key still covers
   everything routine. The CLI must print what each signature request is for.

3. **Remotes never enter the workspace; plain `git push` still works — the shim.** The container
   gets no key, no agent socket, no token. Instead the workspace image sets `GIT_SSH_COMMAND` to a
   small shim that carries git's transport bytes over the session socket (`/run/mend/mend.sock`) to
   the host; the host opens the real authenticated connection and shuttles the pack protocol
   (jump-host pattern, `ProxyCommand` shape). Stock git, every subcommand, no aliasing — one env var
   reroutes the transport layer git itself designed to be replaceable.
   - The host resolves _which_ credential per request: session → project → owner. Day 0 that is the
     machine's one Mend key; the same seam later resolves per-user keys or a connected agent bridge
     — this is what makes multi-tenant identity possible at all (a baked-in container key decides
     too early and produces a copyable secret).
   - The seam is also the policy point: log every remote op; optionally auto-allow `mend shell`
     pushes and require confirmation for agent-initiated ones. Whether the gate is on is product
     policy; the shim makes it possible.

## Honest scorecard (vs. key-in-container)

The security delta against the real baseline (agents run locally with ambient credentials) is modest
and precisely two things: a shim credential is **mortal** (misuse dies with the workspace; a leaked
key file works from anywhere until rotated) and the socket is a **seam** for audit/gating. Shim
costs: it is code we own; git-in-workspace requires the Mend server to be up; the socket capability
is per-session, not per-process.

## Known independent risk (not caused by either option)

The **read-write `repo.git` mount** means workspace code can already write refs/objects in the
shared project store directly — including refs other sessions hang off. Confused-deputy shape: an
agent rewrites a ref, the user later publishes it host-side. Review-before-landing is the mitigation
today. Candidate fix, own timeline: read-only common dir + per-session writable admin/objects
overlay.
