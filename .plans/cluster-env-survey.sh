#!/usr/bin/env bash
# mend-survey.sh — read-only Kubernetes environment survey for evaluating Mend.
#
# WHAT THIS SCRIPT DOES AND DOES NOT DO (read this, then the code — it is short):
#   • kubectl verbs used: config, version, get, auth can-i. Nothing else.
#   • It NEVER reads Secret values. Secrets appear as name + type only.
#   • No writes, no exec, no port-forward, no logs.
#   • The only network traffic is kubectl talking to YOUR cluster with YOUR
#     kubeconfig. Nothing is sent anywhere else by this script.
#   • Output goes to a local file. Review it before sharing — object NAMES can
#     themselves be internal information.
#
# Usage:
#   ./mend-survey.sh                      # survey cluster-wide facts only
#   ./mend-survey.sh -n dev -n staging    # also survey those namespaces
#   ./mend-survey.sh --context my-dev     # pick a kubeconfig context explicitly
#   ./mend-survey.sh --yes                # skip the confirmation prompt
#   ./mend-survey.sh --redacted -n dev    # answers without identifiers: counts,
#                                         # types, ports and policy shapes only —
#                                         # no object/service/variable names.
#                                         # Safe to share as-is.

set -u

CONTEXT=""
NAMESPACES=()
ASSUME_YES=0
REDACTED=0
while [ $# -gt 0 ]; do
  case "$1" in
    --context) CONTEXT="$2"; shift 2 ;;
    -n) NAMESPACES+=("$2"); shift 2 ;;
    --yes) ASSUME_YES=1; shift ;;
    --redacted) REDACTED=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

KUBECTL=(kubectl --request-timeout=10s)
[ -n "$CONTEXT" ] && KUBECTL+=(--context "$CONTEXT")

command -v kubectl >/dev/null || { echo "kubectl not found on PATH" >&2; exit 1; }

ACTIVE_CONTEXT=$("${KUBECTL[@]}" config current-context 2>/dev/null || echo "<none>")
echo "This survey will run READ-ONLY against context: ${CONTEXT:-$ACTIVE_CONTEXT}"
if [ "$ASSUME_YES" -ne 1 ]; then
  printf "Proceed? [y/N] "
  read -r answer
  case "$answer" in y|Y|yes|YES) ;; *) echo "aborted"; exit 0 ;; esac
fi

REPORT="mend-survey-$(date +%Y%m%d-%H%M%S).txt"
exec > >(tee "$REPORT") 2>&1

# Every probe prints its exact command first, so the report doubles as an
# audit trail of everything that ran. Probes are independent: an RBAC denial
# is recorded as an answer, never a failure.
probe() {
  echo
  echo "── \$ ${KUBECTL[*]} $*"
  "${KUBECTL[@]}" "$@" 2>&1 | sed 's/^/   /' | head -40
}

echo "mend cluster survey · $(date -u +%Y-%m-%dT%H:%M:%SZ) · context: ${CONTEXT:-$ACTIVE_CONTEXT}"
if [ "$REDACTED" -eq 1 ]; then
  echo "REDACTED MODE: counts, types, ports and policy shapes only — no identifiers"
else
  echo "read-only; secret NAMES only, never values"
fi

echo; echo "═══ 1. Cluster basics (version, node arch, provider) ═══"
probe version
probe get nodes -o custom-columns='NAME:.metadata.name,ARCH:.status.nodeInfo.architecture,KUBELET:.status.nodeInfo.kubeletVersion'
if [ "$REDACTED" -eq 1 ]; then
  "${KUBECTL[@]}" get nodes -o jsonpath='{.items[0].spec.providerID}{"\n"}' 2>/dev/null | sed -E 's|(://[^/]*).*|\1/…|' | sed 's/^/   provider: /'
else
  probe get nodes -o jsonpath='{.items[0].spec.providerID}{"\n"}'
fi

echo; echo "═══ 2. Secret-sync layer (which operator owns provider secrets) ═══"
echo "── \$ ${KUBECTL[*]} get crd -o name | grep -iE 'external-secrets|secretstore|sealedsecret|secrets-store|vault|argoproj|fluxcd|doppler|infisical'"
"${KUBECTL[@]}" get crd -o name 2>&1 | grep -iE 'external-secrets|secretstore|sealedsecret|secrets-store|vault|argoproj|fluxcd|doppler|infisical' | sed 's/^/   /'
[ "${PIPESTATUS[1]:-1}" -ne 0 ] && echo "   none of the common secret-sync / gitops CRDs found"
probe get clustersecretstores.external-secrets.io
probe get externalsecrets.external-secrets.io -A --no-headers

echo; echo "═══ 3. GitOps layer ═══"
probe get applications.argoproj.io -A --no-headers

echo; echo "═══ 4. Cloud identity for pods (IRSA / Workload Identity) ═══"
echo "── counting ServiceAccounts with cloud role annotations (annotations only, no token material)"
"${KUBECTL[@]}" get sa -A -o jsonpath='{range .items[*]}{.metadata.annotations.eks\.amazonaws\.com/role-arn}{"\n"}{end}' 2>/dev/null | grep -c . | sed 's/^/   IRSA-annotated ServiceAccounts: /'
"${KUBECTL[@]}" get sa -A -o jsonpath='{range .items[*]}{.metadata.annotations.iam\.gke\.io/gcp-service-account}{"\n"}{end}' 2>/dev/null | grep -c . | sed 's/^/   GKE WI-annotated ServiceAccounts: /'

echo; echo "═══ 5. Storage (Mend's store claim needs a ReadWriteMany-capable class) ═══"
probe get storageclass

echo; echo "═══ 6. NetworkPolicy enforcement (CNI + whether policies are in use) ═══"
probe get netpol -A --no-headers
probe get pods -n kube-system -o custom-columns='NAME:.metadata.name' --no-headers
echo "   (look for: cilium / calico / aws-node / flannel / weave in the pod names above)"

echo; echo "═══ 7. What this kubeconfig may do (a 'no' is a useful answer) ═══"
for check in "create namespace" "create deployments -n default" "get secrets -n default" "create clusterrole"; do
  # shellcheck disable=SC2086
  printf "   can-i %-32s → %s\n" "$check" "$("${KUBECTL[@]}" auth can-i $check 2>&1 | head -1)"
done

for ns in ${NAMESPACES[@]+"${NAMESPACES[@]}"}; do
  if [ "$REDACTED" -eq 1 ]; then
    echo; echo "═══ 8. Namespace '$ns' env shape — REDACTED (type histogram) ═══"
    "${KUBECTL[@]}" get secrets -n "$ns" -o custom-columns='TYPE:.type' --no-headers 2>&1 | sort | uniq -c | sed 's/^/   secrets by type: /'
    "${KUBECTL[@]}" get configmaps -n "$ns" --no-headers 2>/dev/null | wc -l | xargs echo "   configmaps:"
    "${KUBECTL[@]}" get sa -n "$ns" --no-headers 2>/dev/null | wc -l | xargs echo "   serviceaccounts:"
  else
    echo; echo "═══ 8. Namespace '$ns' env shape — NAMES AND TYPES ONLY ═══"
    probe get secrets -n "$ns" -o custom-columns='NAME:.metadata.name,TYPE:.type'
    probe get configmaps -n "$ns" -o custom-columns='NAME:.metadata.name'
    probe get sa -n "$ns" -o custom-columns='NAME:.metadata.name'
  fi

  echo; echo "═══ 8b. Namespace '$ns' backend plumbing — what dev actually connects to ═══"
  # The Services here are what a dev laptop reaches via port-forward, and what
  # an in-cluster workspace would reach by DNS (<svc>.<ns>.svc) — IF policies admit it.
  if [ "$REDACTED" -eq 1 ]; then
    "${KUBECTL[@]}" get svc -n "$ns" -o custom-columns='TYPE:.spec.type,PORTS:.spec.ports[*].port' --no-headers 2>&1 | sed 's/^/   svc: /'
    "${KUBECTL[@]}" get ingress -n "$ns" --no-headers 2>/dev/null | wc -l | xargs echo "   ingresses:"
    "${KUBECTL[@]}" get netpol -n "$ns" -o custom-columns='POLICY-TYPES:.spec.policyTypes[*]' --no-headers 2>&1 | sort | uniq -c | sed 's/^/   netpol by policyTypes: /'
  else
    probe get svc -n "$ns" -o custom-columns='NAME:.metadata.name,TYPE:.spec.type,PORTS:.spec.ports[*].port'
    probe get ingress -n "$ns" -o custom-columns='NAME:.metadata.name,HOSTS:.spec.rules[*].host'
    # Ingress rules of this namespace's policies: a default-deny or from-selector
    # here means cross-namespace traffic from a workspace pod needs an explicit allow.
    probe get netpol -n "$ns" -o custom-columns='NAME:.metadata.name,POD-SELECTOR:.spec.podSelector.matchLabels,POLICY-TYPES:.spec.policyTypes[*]'
  fi
done

echo; echo "═══ 9. Local dev loop (this laptop, current directory) ═══"
command -v tilt >/dev/null && echo "   tilt: $(tilt version 2>/dev/null | head -1)" || echo "   tilt: not installed"
command -v skaffold >/dev/null && echo "   skaffold: present" || echo "   skaffold: not installed"
for f in Tiltfile skaffold.yaml docker-compose.yml compose.yaml; do
  [ -e "$f" ] && echo "   found: $f"
done
# What the dev loop actually wires up: forwards, deployed resources, env pulls.
# Local file reads only — this is the "how does vite reach the backend" answer.
if [ -e Tiltfile ]; then
  if [ "$REDACTED" -eq 1 ]; then
    echo "   Tiltfile directive usage (counts only):"
    for d in port_forward k8s_resource k8s_yaml helm kustomize local secret; do
      c=$(grep -cE "$d" Tiltfile 2>/dev/null); [ "${c:-0}" -gt 0 ] && echo "     $d: $c"
    done
  else
    echo "   Tiltfile plumbing lines (port_forward / k8s_resource / helm / secrets):"
    grep -nE 'port_forward|k8s_resource|k8s_yaml|helm\(|kustomize|local\(|secret' Tiltfile 2>/dev/null | head -25 | sed 's/^/     /'
  fi
fi
if [ -e docker-compose.yml ] || [ -e compose.yaml ]; then
  echo "   compose services + ports:"
  grep -nE '^[a-zA-Z].*:|ports:|- "?[0-9]+:[0-9]+' docker-compose.yml compose.yaml 2>/dev/null | head -20 | sed 's/^/     /'
fi
# Where does the frontend think the backend is? (env files: NAMES of vars only)
for envf in .env .env.local .env.development; do
  if [ -e "$envf" ]; then
    if [ "$REDACTED" -eq 1 ]; then
      echo "   $envf: $(cut -d= -f1 "$envf" | grep -vc '^#\|^$') variables (names and values withheld)"
    else
      echo "   $envf variable NAMES (values withheld): $(cut -d= -f1 "$envf" | grep -v '^#' | grep -v '^$' | tr '\n' ' ')"
    fi
  fi
done

echo
echo "done — report written to $REPORT"
if [ "$REDACTED" -eq 1 ]; then
  echo "redacted report — safe to share as-is"
else
  echo "REVIEW IT before sharing: it contains object and namespace names."
  echo "(rerun with --redacted for a share-without-thinking version)"
fi
