---
title: Deploy on Kubernetes
description: Run the Mend server and Sealant control plane on a Kubernetes cluster with Helm.
sidebar:
  order: 2
---

Kubernetes is the third deployment tier, after [your own machine](/getting-started/install/) and
[a VPS](/operate/deploy-vps/). The product behaves the same; what changes is where things run: Mend
is a Deployment, session workspaces are Pods that Sealant creates on any node, and the central store
is a shared volume they all mount. Nothing is cloned into a workspace and nothing syncs back — a
workspace Pod mounts the session worktree from the same claim Mend writes, at the same absolute
path.

The maintainer record behind this page is
[`docs/KUBERNETES.md`](https://github.com/sealant-sh/mend/blob/main/docs/KUBERNETES.md); the charts
live at `deploy/helm/mend` in this repository and `deploy/helm/sealant` in the
[Sealant repository](https://github.com/sealant-sh/sealant).

## First, meet Sealant

Mend is built on **Sealant**, a separate workspace platform. Sealant is what actually creates the
isolated environments agents run in, builds their images, supervises their processes, and records
everything that happens inside them. Mend never touches a container or Pod itself — it asks Sealant
through the platform's SDK.

On the single-host tiers the installer sets Sealant up for you and you can ignore it. On Kubernetes
you install it yourself, **before Mend**, because Mend refuses to run without a platform to talk to.
Sealant's chart brings its own control plane — an API, a worker (the component that creates
workspace Pods), Postgres, RabbitMQ, an image registry, an SSH gateway — plus the namespace
workspace Pods run in, the certificate authority that secures their control channels, and the narrow
RBAC the worker needs.

## What you need

- A cluster with a **ReadWriteMany, POSIX-semantics StorageClass** (Longhorn, CephFS, NFS, EFS, …).
  No vendor is named anywhere; the contract is concurrent multi-node mounts with the rename, unlink,
  fsync, and locking semantics Git needs. RWX matters because Mend and every workspace Pod mount the
  same store volume, possibly from different nodes.
- **cert-manager** installed in the cluster — Sealant uses it to run an internal certificate
  authority for the mutual-TLS channels between its control plane and workspace Pods.
- `kubectl` and `helm` pointed at the cluster, and both repositories cloned (the charts ship in the
  repos; there is no chart registry yet).

## Step 1 — install Sealant

Create its namespace and secrets. The last key, `SEALANT_SERVICE_KEYS`, is how Mend will
authenticate to Sealant — generate it here and reuse the same value in Mend's secret in step 2:

```sh
kubectl create namespace sealant
kubectl -n sealant create secret generic sealant-secrets \
  --from-literal=SEALANT_DB_PASSWORD="$(openssl rand -hex 32)" \
  --from-literal=SEALANT_RABBITMQ_PASSWORD="$(openssl rand -hex 32)" \
  --from-literal=WORKSPACE_SSH_GATEWAY_TOKEN="$(openssl rand -hex 32)" \
  --from-literal=BETTER_AUTH_SECRET="$(openssl rand -hex 32)" \
  --from-literal=SEALANT_CREDENTIALS_KEY="$(openssl rand -base64 32)" \
  --from-literal=SEALANT_SERVICE_KEYS="$(openssl rand -hex 32)"
```

Install the chart, telling Sealant which volume holds Mend's store so workspace Pods may mount
worktrees from it (the claim itself is created in step 2, or by you):

```sh
helm install sealant deploy/helm/sealant -n sealant \
  --set workspaces.volumeMappings[0].logicalRoot=/var/lib/mend/store \
  --set workspaces.volumeMappings[0].claimName=mend-store
```

Wait for the Pods, then note the API address Mend will use — in-cluster it is the API Service's DNS
name:

```sh
kubectl -n sealant get pods
# sealant-api, sealant-worker, sealant-web, sealant-postgres, sealant-rabbitmq, sealant-registry …
echo http://sealant-api.sealant.svc:4000
```

The [Sealant Kubernetes guide](https://github.com/sealant-sh/sealant) is the authority for this
half: Pod Security levels for the workspace namespace, the BuildKit prerequisites for image builds
(including the user-namespace sysctl hardened distributions need), registry trust, and its
troubleshooting table. Read it before installing on a hardened cluster.

## Step 2 — install Mend

Create the namespace, secrets, and the store claim, then install the chart. `SEALANT_SERVICE_KEY`
must be the exact value you generated for Sealant's `SEALANT_SERVICE_KEYS` above — that shared key
is how Mend authenticates as a service while asserting which user each request acts for:

```sh
kubectl create namespace mend
kubectl -n mend create secret generic mend-secrets \
  --from-literal=MEND_DB_PASSWORD="$(openssl rand -hex 32)" \
  --from-literal=BETTER_AUTH_SECRET="$(openssl rand -hex 32)" \
  --from-literal=SEALANT_SERVICE_KEY="<the SEALANT_SERVICE_KEYS value from step 1>"

helm install mend deploy/helm/mend -n mend -f your-values.yaml
```

Your values file carries the cluster facts the chart deliberately does not know: the store claim (or
`store.create` to make one), your StorageClass names, the Sealant API address from step 1
(`sealant.baseUrl`), how you expose the UI, and the client networks your NetworkPolicies should
admit. The chart creates one `mend-app` Deployment (`MEND_MODE=all`), Postgres, the session-channel
Service workspaces call back to, NetworkPolicies, and a PodDisruptionBudget. No Ingress and no
public Service is created — exposure is your decision.

When both charts are up, open the Mend UI through whatever exposure you chose, create the first
account, and `mend login --url` from your machine — from here the [VPS page's](/operate/deploy-vps/)
remote workflow applies unchanged.

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

When something fails, split the diagnosis at the product boundary: workspace Pods, image builds,
certificates, and RBAC are Sealant's half (its guide has the troubleshooting table); sessions,
adoption, review, and Services are Mend's.
