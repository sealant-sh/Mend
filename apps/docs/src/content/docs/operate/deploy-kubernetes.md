---
title: Deploy on Kubernetes
description: Run the Mend server and Sealant control plane on a Kubernetes cluster with Helm.
sidebar:
  order: 1
---

Kubernetes is the second supported deployment shape beside the
[single-host Docker install](/getting-started/install/). The product behaves the same; what changes
is where things run: Mend is a Deployment, session workspaces are Pods that Sealant creates on any
node, and the central store is a shared volume they all mount. Nothing is cloned into a workspace
and nothing syncs back — a workspace Pod mounts the session worktree from the same claim Mend
writes, at the same absolute path.

The maintainer record behind this page is
[`docs/KUBERNETES.md`](https://github.com/sealant-sh/mend/blob/main/docs/KUBERNETES.md); the charts
live at `deploy/helm/mend` in this repository and `deploy/helm/sealant` in the Sealant repository.

## What you need

- A cluster with a **ReadWriteMany, POSIX-semantics StorageClass** (Longhorn, CephFS, NFS, EFS, …).
  No vendor is named anywhere; the contract is concurrent multi-node mounts with the rename, unlink,
  fsync, and locking semantics Git needs.
- **cert-manager**, for the internal CA that secures workspace control channels.
- The **Sealant chart installed first** — Mend consumes the platform through its API. Sealant's
  chart brings Postgres, RabbitMQ, a registry, the worker, and the workspace namespace; its operator
  guide covers Pod Security levels and the BuildKit prerequisites.
- A shared **service key**: Sealant's `SEALANT_SERVICE_KEYS` and Mend's `SEALANT_SERVICE_KEY` must
  hold the same value so Mend can authenticate as a service principal while asserting which user it
  acts for.

## Install

Create the namespace, secrets, and the store claim, then install the chart:

```sh
kubectl create namespace mend
kubectl -n mend create secret generic mend-secrets \
  --from-literal=MEND_DB_PASSWORD="$(openssl rand -hex 32)" \
  --from-literal=BETTER_AUTH_SECRET="$(openssl rand -hex 32)" \
  --from-literal=SEALANT_SERVICE_KEY="<same value as Sealant's SEALANT_SERVICE_KEYS>"

helm install mend deploy/helm/mend -n mend -f your-values.yaml
```

Your values file carries the cluster facts the chart deliberately does not know: the store claim (or
`store.create` to make one), your StorageClass names, the Sealant API address, how you expose the
UI, and the client networks your NetworkPolicies should admit. The chart creates one `mend-app`
Deployment (`MEND_MODE=all`), Postgres, the session-channel Service workspaces call back to,
NetworkPolicies, and a PodDisruptionBudget. No Ingress and no public Service is created — exposure
is your decision.

Sealant must map the same store claim so workspace Pods can mount worktrees:

```yaml
# sealant values
workspaces:
  volumeMappings:
    - { logicalRoot: /var/lib/mend/store, claimName: mend-store }
```

## What changes in `kubernetes` mode

The chart sets `MEND_DEPLOYMENT_MODE=kubernetes`. Compared to the single-host install:

| Concern           | Single host                       | Kubernetes                                                     |
| ----------------- | --------------------------------- | -------------------------------------------------------------- |
| Session channel   | Unix socket in the run directory  | Authenticated network listener; per-session revocable tokens   |
| Machine git key   | `~/.config/mend/keys`             | A `subPath` of the store claim, so it survives Pod replacement |
| Git adoption auth | `ambient` works (your login user) | `ambient` cannot work in a Pod — use `mend-key` or `bridge`    |
| Service listeners | Bind your machine's interfaces    | Bind the Pod; reach them with `mend service connect`           |
| One replica       | One process                       | Still one replica — the session engine is in-memory            |

Adoption in a Pod has no ambient identity, so pick an explicit mode:

```sh
mend keys init                 # server generates its deploy key on the store claim
mend adopt git@github.com:acme/api.git --auth mend-key
# or keep the key on your laptop:
mend keys share                # in a spare terminal
mend adopt git@github.com:acme/api.git --auth bridge
```

## Reaching development Services

`mend service connect` is the deployment-independent path: it binds the Service's port on **your**
machine's loopback and carries every connection over an authenticated WebSocket to the Mend API — no
cluster networking, no unauthenticated ports.

```sh
mend service connect web --port 43100
curl http://127.0.0.1:43100
```

Operators who trust a private network can additionally expose a port range on the cluster with the
chart's `serviceHost` values (bind policy, port range, an enumerated-port Service). Those ports
carry no Mend authentication — reachability is the gate — and the chart applies your
`networkPolicies.clientCidrs` to the range. Default is off.

## Upgrade and roll back

`helm upgrade` rolls the single replica (`Recreate`); database migrations run before the new server
serves. Running workspace Pods are Sealant's and keep running across a Mend upgrade. Migrations are
forward-only: a Helm rollback re-renders old manifests, but old application code must still be
compatible with the current schema — check release notes before rolling back.

## Current limits

- One `mend-app` replica; the web and worker tiers cannot be split yet.
- The Service tunnel is TCP-only; UDP Services need the operator exposure path.
- Workspace-scoped Docker (`services.docker`) is refused on Kubernetes until the DinD capability
  ships — turn Docker off in the image definition for projects that run there.
- The shared store is written by Mend (UID 1000) and workspaces (root); cleanup of root-owned files
  can require operator action.

The [Sealant Kubernetes guide](https://github.com/sealant-sh/sealant) covers the platform half:
workspace Pods, image builds, PKI, RBAC, and its own troubleshooting table.
