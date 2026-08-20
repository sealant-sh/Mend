---
"@sealant/mend": minor
---

Hot sessions: a project can keep workspaces ready so new sessions attach instantly. Set the count on
the project setup page (default 0) and Mend pre-provisions that many complete session skeletons —
worktree, session socket, and a live workspace; starting a session claims one and goes straight to
the terminal instead of paying the container build, dotfiles, and credential setup at launch. The
pool drains and rewarms itself whenever the image, variables, secrets, references, mounts, or
dotfiles change, and the setup page reports what is observed ("2 ready · 1 warming"). Each ready
workspace is a live container on this machine — the count is explicit resource intent. Resumes still
launch cold: a resume is bound to its existing worktree, which a pooled workspace cannot adopt.
