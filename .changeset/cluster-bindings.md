---
"@sealant/mend": minor
---

Cluster bindings: a project can declare name-only references to Kubernetes Secrets and ConfigMaps
(`mend env cluster add secret|configmap <name>`, `remove <kind>/<name>`) and a workspace
ServiceAccount (`mend env cluster sa <name>` / `sa --clear`); `mend env show` lists them as a third
section beside Configuration and Secrets. On a Kubernetes deployment the platform resolves the names
inside the workspace at launch — Mend stores and forwards names, never the bound contents. Each
session run records the binding names, revision, and service account it launched with; a binding or
ServiceAccount change drains warm skeletons the same way an env or secret edit does. On a deployment
that cannot resolve them, launch refuses readably, naming each binding, before any workspace is
created (requires the platform SDK 0.24.0 surface). Also in this release: SessionRepository, the
identity-keyed authority for session workspaces.
