#!/bin/sh
# Mend installer — the workbench plus the Sealant control plane it runs on, with one command:
#
#   curl -fsSL https://mend.sealant.dev/install.sh | sh
#
# Sets up, in order: (1) Sealant (API, worker, SSH gateway, Postgres, RabbitMQ, registry) in Docker
# without the Sealant web app — Mend is the login — in ~/.config/sealant, the layout Sealant's own
# installer uses; (2) the Mend server on the host (not in a container: it owns the store path Sealant
# mounts into workspaces), built from a shallow clone, run as a user service (systemd --user on
# Linux, launchd on macOS) with its own Postgres in Docker, config in ~/.config/mend/server.env;
# (3) the `mend` CLI under a private npm prefix, linked into ~/.local/bin.
#
# Host requirements: curl, git, a running Docker daemon with Compose >= 2.23.1. Node 22+ on PATH is
# used; otherwise a private Node 26 is downloaded (26 is what the CLI's dashboard needs for
# node:ffi; official Node 25+ builds need libatomic1 on Debian/Ubuntu). No sudo, no system-wide prefix, loopback only. Linux is what this is tested on; macOS
# is untested — Sealant's containers bind-mount /run/sealant/sockets, which Docker Desktop does not
# share by default, so Darwin needs MEND_ALLOW_MACOS=1 to proceed.
#
# Knobs (set on the sh side of the pipe: `curl … | MEND_VERSION=0.5.0 sh`):
#   MEND_VERSION        cli-v<X> release, "latest", or "main" (default: pinned version, else latest)
#   SEALANT_VERSION     Sealant release or "latest" (default: pinned version, else latest)
#   MEND_PORT           Mend server port (3105)      MEND_DB_PORT  Mend Postgres, loopback (5436)
#   SEALANT_API_PORT / SEALANT_SSH_PORT / SEALANT_REGISTRY_PORT / SEALANT_BIND_HOST
#                       Sealant ports + bind host (4000 / 2222 / 5000 / 127.0.0.1)
#   MEND_INSTALL_DIR    Mend config dir ($XDG_CONFIG_HOME/mend — the server derives its own home from
#                       XDG, so override this together with XDG_CONFIG_HOME)
#   SEALANT_INSTALL_DIR Sealant install dir ($XDG_CONFIG_HOME/sealant)
#   MEND_SRC_DIR        Mend checkout ($XDG_DATA_HOME/mend/src)
#   MEND_DRY_RUN=1      Print every state-changing command instead of running it; file writes go to
#                       a staging copy so the resolved config is still shown.
#   MEND_ALLOW_MACOS=1  Run on macOS anyway (untested; see the note above)
#
# Re-running repairs rather than reinstalls: secrets are never regenerated, pinned versions kept,
# containers recreated only when their config changed. Upgrade: MEND_VERSION=latest / SEALANT_VERSION=latest.
set -eu

MEND_REPO="sealant-sh/Mend"
SEALANT_REPO="sealant-sh/sealant"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
SEALANT_DIR="${SEALANT_INSTALL_DIR:-$CONFIG_HOME/sealant}"
SEALANT_LEGACY_DIR="$HOME/.sealant"
MEND_DIR="${MEND_INSTALL_DIR:-$CONFIG_HOME/mend}"
MEND_SRC="${MEND_SRC_DIR:-$DATA_HOME/mend/src}"
NODE_DIR="$DATA_HOME/mend/node"
NPM_PREFIX="$DATA_HOME/mend/npm"
SEALANT_ENV="$SEALANT_DIR/.env"
SEALANT_COMPOSE="$SEALANT_DIR/compose.yaml"
MEND_ENV="$MEND_DIR/server.env"
MEND_COMPOSE="$MEND_DIR/compose.yaml"
DRY_RUN="${MEND_DRY_RUN:-0}"

info() { printf '\033[1;36m›\033[0m %s\n' "$1"; }
ok() { printf '\033[1;32m✓\033[0m %s\n' "$1"; }
err() { printf '\033[1;31m✗\033[0m %s\n' "$1" >&2; }
die() { err "$1"; exit 1; }

# Every state-changing command goes through `run`; reads (curl to stdout, docker inspect, grep) run
# as-is so a dry run resolves the same versions and ports a real run would. Stdin is detached: under
# `curl … | sh` stdin IS the script, and anything that reads it (docker compose attaches it by
# default) would swallow the unexecuted tail and end the install mid-way, silently.
run() {
  if [ "$DRY_RUN" = 1 ]; then
    printf '  + %s\n' "$*" >&2
  else
    "$@" </dev/null
  fi
}

# File writes in a dry run land in a staging copy (seeded from the real file) so the idempotency
# helpers below still see "already set" the way a real run would.
stage_file() {
  [ "$DRY_RUN" = 1 ] || { printf '%s' "$1"; return; }
  staged="$DRY_STAGE${1#"$HOME"}"
  if [ ! -e "$staged" ]; then
    mkdir -p "$(dirname "$staged")" && printf '  + write %s\n' "$1" >&2
    [ -f "$1" ] && cp "$1" "$staged"
  fi
  printf '%s' "$staged"
}

sealant_compose() {
  run docker compose --project-directory "$SEALANT_DIR" -f "$SEALANT_COMPOSE" "$@"
}
mend_compose() {
  run docker compose --project-directory "$MEND_DIR" --env-file "$MEND_ENV" -f "$MEND_COMPOSE" "$@"
}

# 64 hex chars from the kernel CSPRNG — no openssl needed on the host.
generate_secret() {
  head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
}

env_get() { sed -n "s/^$2=//p" "$1" 2>/dev/null | head -n 1; }

# Append KEY=value only when KEY is absent: secrets written once survive every re-run.
ensure_env_var() {
  f="$(stage_file "$1")"
  grep -q "^$2=" "$f" 2>/dev/null || printf '%s=%s\n' "$2" "$3" >>"$f"
}

# Set KEY=value replacing an existing line. Drop-then-append so the value is written literally.
set_env_var() {
  f="$(stage_file "$1")"
  if grep -q "^$2=" "$f" 2>/dev/null; then
    tmp="$f.tmp.$$"
    grep -v "^$2=" "$f" >"$tmp" || true
    mv "$tmp" "$f"
  fi
  printf '%s=%s\n' "$2" "$3" >>"$f"
  chmod 600 "$f"
}

# A tunable: explicit env wins and is persisted; else the value pinned by a previous run; else the
# default is persisted. Re-runs and manual `docker compose` calls then agree on ports.
setting() {
  file="$1" key="$2" default="$3" explicit="$4"
  if [ -n "$explicit" ]; then
    set_env_var "$file" "$key" "$explicit"
    printf '%s' "$explicit"
    return
  fi
  existing="$(env_get "$(stage_file "$file")" "$key")"
  if [ -n "$existing" ]; then
    printf '%s' "$existing"
  else
    set_env_var "$file" "$key" "$default"
    printf '%s' "$default"
  fi
}

wait_for() {
  [ "$DRY_RUN" != 1 ] || { printf '  + wait for %s\n' "$1"; return; }
  i=0
  until curl -fsS -o /dev/null "$1" 2>/dev/null; do
    i=$((i + 1))
    [ "$i" -lt 90 ] || die "$2"
    sleep 2
  done
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1
}

node_major() { "$1" --version 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/'; }

# Candidate addresses a phone could reach: the tailnet (100.64/10) one first, then LAN.
host_ipv4s() {
  if command -v ip >/dev/null 2>&1; then
    ip -4 -o addr show scope global 2>/dev/null | awk '$2 !~ /^(docker|br-|veth|virbr)/ {print $4}' | cut -d/ -f1
  else
    ifconfig 2>/dev/null | awk '/inet / && $2 != "127.0.0.1" {print $2}'
  fi
}
reachable_ipv4() {
  addrs="$(host_ipv4s)"
  printf '%s\n' "$addrs" | awk -F. '$1 == 100 && $2 >= 64 && $2 <= 127 {print; exit}' | grep . ||
    printf '%s\n' "$addrs" | head -n 1
}

# The whole install lives in main() so the shell parses the entire script before running any of it:
# piped through `sh`, a partial read can then never execute a partial script.
main() {
printf '\n  \033[1mMend\033[0m installer\n\n'
if [ "$DRY_RUN" = 1 ]; then
  DRY_STAGE="$(mktemp -d "${TMPDIR:-/tmp}/mend-install-dry.XXXXXX")"
  info "Dry run: commands are printed, file writes are staged under $DRY_STAGE"
fi

# --- Preflight ---------------------------------------------------------------------------------------
case "$(uname -s)" in
Linux) OS=linux ;;
Darwin)
  OS=darwin
  # Sealant's compose bind-mounts /run/sealant/sockets from the host. That path does not exist on
  # macOS and Docker Desktop does not share it, so the stack cannot start until an operator shares
  # it by hand. Untested here: opt in knowingly rather than fail half-installed.
  [ "${MEND_ALLOW_MACOS:-0}" = 1 ] ||
    die "macOS is untested: Sealant's containers bind-mount /run/sealant/sockets, which Docker Desktop does not share by default (Settings → Resources → File sharing). Set MEND_ALLOW_MACOS=1 to try it anyway."
  ;;
*) die "Unsupported OS $(uname -s): Linux or macOS required." ;;
esac
case "$(uname -m)" in
x86_64 | amd64) ARCH=x64 ;;
aarch64 | arm64) ARCH=arm64 ;;
*) die "Unsupported architecture $(uname -m): x64 or arm64 required." ;;
esac
for tool in curl git; do command -v "$tool" >/dev/null 2>&1 || die "$tool is required."; done
command -v docker >/dev/null 2>&1 || die "Docker is not installed. Install it first: https://docs.docker.com/get-docker/"
docker info >/dev/null 2>&1 || die "The Docker daemon isn't running (or this user lacks permission). Start Docker and retry."
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required (it ships with Docker Desktop / the docker-compose-plugin)."
# Sealant's compose file inlines `configs:`, which needs >= 2.23.1.
compose_min="2.23.1"
compose_version="$(docker compose version --short 2>/dev/null | sed 's/^v//')"
if sort -V </dev/null >/dev/null 2>&1; then
  HAVE_SORT_V=1
  if [ "$(printf '%s\n%s\n' "$compose_min" "$compose_version" | sort -V | head -n 1)" != "$compose_min" ]; then
    die "Docker Compose >= $compose_min is required (found ${compose_version:-unknown}). Update Docker and retry."
  fi
else
  HAVE_SORT_V=0
fi
ok "Docker Compose $compose_version, $OS/$ARCH"

# Node: a system Node 22+ runs the server (TypeScript goes through Node's type stripping);
# otherwise a private Node goes under ~/.local/share/mend — no sudo, no version manager. The private
# one is Node 26 because the CLI's dashboard (bare `mend`) needs node:ffi, which lands in 26.
NODE_MAJOR=26
NODE_BIN=""
if command -v node >/dev/null 2>&1 && [ "$(node_major node)" -ge 22 ] 2>/dev/null; then
  NODE_BIN="$(command -v node)" && NPM_BIN="$(command -v npm)" || die "node is present but npm is not."
elif [ -x "$NODE_DIR/bin/node" ] && [ "$(node_major "$NODE_DIR/bin/node")" -ge 22 ] 2>/dev/null; then
  NODE_BIN="$NODE_DIR/bin/node" NPM_BIN="$NODE_DIR/bin/npm"
else
  info "No Node 22+ on PATH — resolving the latest Node $NODE_MAJOR…"
  node_version="$(curl -fsSL https://nodejs.org/dist/index.json |
    tr '}' '\n' | grep "\"version\":\"v$NODE_MAJOR\." |
    sed -n 's/.*"version":"\(v[^"]*\)".*/\1/p' | head -n 1)"
  [ -n "$node_version" ] || die "Could not resolve a Node $NODE_MAJOR release from nodejs.org."
  tarball="node-$node_version-$OS-$ARCH.tar.gz"
  tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/mend-node.XXXXXX")"
  info "Downloading $tarball…"
  run curl -fsSL "https://nodejs.org/dist/$node_version/$tarball" -o "$tmpdir/$tarball"
  run curl -fsSL "https://nodejs.org/dist/$node_version/SHASUMS256.txt" -o "$tmpdir/SHASUMS256.txt"
  if [ "$DRY_RUN" != 1 ]; then
    expected="$(grep " $tarball\$" "$tmpdir/SHASUMS256.txt" | cut -d' ' -f1)"
    [ -n "$expected" ] && [ "$expected" = "$(sha256_of "$tmpdir/$tarball")" ] ||
      die "Checksum mismatch for $tarball — refusing to install it."
  fi
  run rm -rf "$NODE_DIR" && run mkdir -p "$NODE_DIR"
  run tar -xzf "$tmpdir/$tarball" -C "$NODE_DIR" --strip-components=1
  rm -rf "$tmpdir"
  NODE_BIN="$NODE_DIR/bin/node" NPM_BIN="$NODE_DIR/bin/npm"
fi
export PATH="$NPM_PREFIX/bin:$(dirname "$NODE_BIN"):$PATH"
NODE_DIR_BIN="$(dirname "$NODE_BIN")"
# The service runs this binary with no login environment: no LD_LIBRARY_PATH, no version manager.
# Prove it starts that way now, or the install would end with a unit in a restart loop. Node 25+
# official builds need libatomic.so.1, which minimal Debian/Ubuntu images lack.
if ! env -i HOME="$HOME" PATH="$NODE_DIR_BIN" node -e 0 2>/dev/null; then
  node_err="$(env -i HOME="$HOME" PATH="$NODE_DIR_BIN" node -e 0 2>&1 | tail -n 1)"
  hint=""
  case "$node_err" in *libatomic*) hint=" Missing libatomic: sudo apt install libatomic1 (Debian/Ubuntu), dnf install libatomic (Fedora)." ;; esac
  die "$NODE_BIN cannot start outside your shell environment: $node_err.$hint"
fi
ok "Node: $NODE_BIN"
if [ "$(node_major "$NODE_BIN")" -lt "$NODE_MAJOR" ] 2>/dev/null; then
  info "This Node runs every command except the dashboard (bare \`mend\`), which needs Node $NODE_MAJOR for node:ffi."
fi

# --- Sealant control plane (no web app) -----------------------------------------------------------------
# Adopt the XDG path the way Sealant's installer does: a legacy ~/.sealant moves when the XDG dir is
# absent; an explicit SEALANT_INSTALL_DIR is never moved.
if [ -z "${SEALANT_INSTALL_DIR:-}" ] && [ -d "$SEALANT_LEGACY_DIR" ]; then
  if [ ! -e "$SEALANT_DIR" ] && [ ! -L "$SEALANT_DIR" ]; then
    run mkdir -p "$CONFIG_HOME" && run mv "$SEALANT_LEGACY_DIR" "$SEALANT_DIR"
    ok "Moved existing Sealant install to $SEALANT_DIR"
  else
    info "Legacy Sealant install left unchanged at $SEALANT_LEGACY_DIR ($SEALANT_DIR already exists)"
  fi
fi

sealant_pinned="$(env_get "$SEALANT_ENV" SEALANT_VERSION)"
requested="${SEALANT_VERSION:-}"
requested="${requested#v}"
if [ -n "$requested" ] && [ "$requested" != "latest" ]; then
  SEALANT_VERSION="$requested"
elif [ "$requested" != "latest" ] && [ -n "$sealant_pinned" ]; then
  SEALANT_VERSION="$sealant_pinned"
  info "Keeping installed Sealant $SEALANT_VERSION (set SEALANT_VERSION=latest to upgrade)"
else
  info "Resolving the latest Sealant release…"
  SEALANT_VERSION="$(curl -fsSL "https://api.github.com/repos/$SEALANT_REPO/releases/latest" 2>/dev/null |
    sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"v\{0,1\}\([^"]*\)".*/\1/p' | head -n 1)"
  [ -n "$SEALANT_VERSION" ] || die "Could not resolve the latest release of $SEALANT_REPO from the GitHub API."
fi
# Mend's server talks to Core as a service principal and creates users through POST /v1/users, both
# of which land in 0.22.0. An older pin would install cleanly and then fail on the first session.
SEALANT_MIN_VERSION=0.22.0
if [ "$HAVE_SORT_V" = 1 ] &&
  [ "$(printf '%s\n%s\n' "$SEALANT_MIN_VERSION" "$SEALANT_VERSION" | sort -V | head -n 1)" != "$SEALANT_MIN_VERSION" ]; then
  die "Mend needs Sealant >= $SEALANT_MIN_VERSION (this run resolved $SEALANT_VERSION). Re-run with SEALANT_VERSION=latest."
fi
# Compose gives OS env precedence over .env: export the normalized form so a "v"-prefixed or
# "latest" value never reaches image-tag interpolation.
export SEALANT_VERSION
ok "Sealant $SEALANT_VERSION"

run mkdir -p "$SEALANT_DIR"
asset_url="https://github.com/$SEALANT_REPO/releases/download/v$SEALANT_VERSION/compose.selfhost.yaml"
raw_url="https://raw.githubusercontent.com/$SEALANT_REPO/v$SEALANT_VERSION/compose.selfhost.yaml"
if [ "$DRY_RUN" = 1 ]; then
  printf '  + curl -fsSL %s -o %s  (fallback: %s)\n' "$asset_url" "$SEALANT_COMPOSE" "$raw_url"
else
  curl -fsSL "$asset_url" -o "$SEALANT_COMPOSE" 2>/dev/null ||
    curl -fsSL "$raw_url" -o "$SEALANT_COMPOSE" ||
    die "Failed to download the Sealant compose file for v$SEALANT_VERSION."
fi

MEND_STORE_ROOT="${MEND_STORE_ROOT:-$MEND_DIR/store}"
[ "$DRY_RUN" = 1 ] || { touch "$SEALANT_ENV" && chmod 600 "$SEALANT_ENV"; }
sealant_env_before="$(cat "$(stage_file "$SEALANT_ENV")" 2>/dev/null | cksum)"
ensure_env_var "$SEALANT_ENV" SEALANT_DB_PASSWORD "$(generate_secret)"
ensure_env_var "$SEALANT_ENV" SEALANT_RABBITMQ_PASSWORD "$(generate_secret)"
ensure_env_var "$SEALANT_ENV" WORKSPACE_SSH_GATEWAY_TOKEN "$(generate_secret)"
ensure_env_var "$SEALANT_ENV" BETTER_AUTH_SECRET "$(generate_secret)"
# Credentials key: 32 raw bytes, base64 — the API/worker decode it and require exactly 32.
ensure_env_var "$SEALANT_ENV" SEALANT_CREDENTIALS_KEY "$(head -c 32 /dev/urandom | base64 | tr -d '\n')"
# Mend authenticates to Sealant as a service principal; the first key of the list is Mend's.
ensure_env_var "$SEALANT_ENV" SEALANT_SERVICE_KEYS "slt_svc_$(generate_secret)"
SERVICE_KEY="$(env_get "$(stage_file "$SEALANT_ENV")" SEALANT_SERVICE_KEYS | cut -d, -f1)"
# Mount roots: merge into an operator's existing colon-delimited list, never replace it.
roots="$(env_get "$(stage_file "$SEALANT_ENV")" SEALANT_MOUNT_ALLOWED_STORE_ROOTS)"
case ":$roots:" in
*":$MEND_STORE_ROOT:"*) ;;
*) set_env_var "$SEALANT_ENV" SEALANT_MOUNT_ALLOWED_STORE_ROOTS "${roots:+$roots:}$MEND_STORE_ROOT" ;;
esac
set_env_var "$SEALANT_ENV" SEALANT_VERSION "$SEALANT_VERSION"
SEALANT_API_PORT="$(setting "$SEALANT_ENV" SEALANT_API_PORT 4000 "${SEALANT_API_PORT:-}")"
SEALANT_SSH_PORT="$(setting "$SEALANT_ENV" SEALANT_SSH_PORT 2222 "${SEALANT_SSH_PORT:-}")"
setting "$SEALANT_ENV" SEALANT_REGISTRY_PORT 5000 "${SEALANT_REGISTRY_PORT:-}" >/dev/null
setting "$SEALANT_ENV" SEALANT_BIND_HOST 127.0.0.1 "${SEALANT_BIND_HOST:-}" >/dev/null
if [ "$sealant_env_before" != "$(cksum <"$(stage_file "$SEALANT_ENV")")" ]; then
  info "Sealant env updated ($SEALANT_ENV) — compose recreates only the services whose env changed"
fi
ok "Sealant secrets ready ($SEALANT_ENV)"

info "Pulling Sealant images (the web app is skipped — Mend is the login)…"
sealant_compose pull --quiet --ignore-pull-failures postgres rabbitmq zot api worker ssh-gateway || true
image_ns_pinned="$(env_get "$(stage_file "$SEALANT_ENV")" SEALANT_IMAGE_NS)"
IMAGE_NS="${SEALANT_IMAGE_NS:-${image_ns_pinned:-ghcr.io/${SEALANT_REPO%/*}}}"
for image_name in sealant-api sealant-worker sealant-ssh-gateway; do
  if ! docker image inspect "$IMAGE_NS/$image_name:$SEALANT_VERSION" >/dev/null 2>&1; then
    run docker pull "$IMAGE_NS/$image_name:$SEALANT_VERSION" ||
      die "Image $IMAGE_NS/$image_name:$SEALANT_VERSION is unavailable. Offline, or is that release not published yet?"
  fi
done
info "Applying Sealant migrations…"
sealant_compose run --rm -T migrate >/dev/null || die "Sealant migrations failed. Inspect with: docker compose --project-directory $SEALANT_DIR logs postgres"
info "Starting Sealant…"
# By name, not `up -d --scale web=0`: naming the services leaves an operator's existing Sealant web
# container exactly as it is (scaling it to 0 would stop it), and pulls nothing extra.
mount_hint=""
[ "$OS" != darwin ] || mount_hint=" On Docker Desktop, share /run/sealant/sockets first: Settings → Resources → File sharing."
sealant_compose up -d postgres rabbitmq zot api worker ssh-gateway ||
  die "Sealant failed to start. Inspect with: docker compose --project-directory $SEALANT_DIR logs.$mount_hint"
if [ -n "$(docker compose --project-directory "$SEALANT_DIR" -f "$SEALANT_COMPOSE" ps -a -q web 2>/dev/null </dev/null)" ]; then
  info "Sealant's own web container is left as it is. This run wrote SEALANT_SERVICE_KEYS to $SEALANT_ENV, which changes how the API authenticates callers — check that web app after the install."
fi
wait_for "http://127.0.0.1:$SEALANT_API_PORT/healthz" "The Sealant API did not become healthy. Check: docker compose --project-directory $SEALANT_DIR logs api"
ok "Sealant API on http://127.0.0.1:$SEALANT_API_PORT"

# --- Mend server (host) -----------------------------------------------------------------------------------
mend_pinned="$(env_get "$MEND_ENV" MEND_VERSION)"
requested="${MEND_VERSION:-}"
requested="${requested#cli-v}"
requested="${requested#v}"
if [ -n "$requested" ] && [ "$requested" != "latest" ]; then
  MEND_VERSION="$requested"
elif [ "$requested" != "latest" ] && [ -n "$mend_pinned" ]; then
  MEND_VERSION="$mend_pinned"
  info "Keeping installed Mend $MEND_VERSION (set MEND_VERSION=latest to upgrade)"
else
  info "Resolving the latest Mend release…"
  MEND_VERSION="$(curl -fsSL "https://api.github.com/repos/$MEND_REPO/tags?per_page=100" 2>/dev/null |
    sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"cli-v\([^"]*\)".*/\1/p' | sort -V | tail -n 1)"
  [ -n "$MEND_VERSION" ] ||
    MEND_VERSION="$(git ls-remote --tags --refs "https://github.com/$MEND_REPO" 'cli-v*' 2>/dev/null |
      sed 's#.*/cli-v##' | sort -V | tail -n 1)"
  [ -n "$MEND_VERSION" ] || die "Could not resolve the latest cli-v* tag of $MEND_REPO."
fi
if [ "$MEND_VERSION" = main ]; then MEND_REF=main; else MEND_REF="cli-v$MEND_VERSION"; fi
ok "Mend $MEND_VERSION ($MEND_REF)"

if [ -d "$MEND_SRC/.git" ]; then
  run git -C "$MEND_SRC" fetch --depth 1 origin "$MEND_REF"
  run git -C "$MEND_SRC" checkout --quiet --detach FETCH_HEAD
else
  run mkdir -p "$(dirname "$MEND_SRC")"
  run git clone --quiet --depth 1 --branch "$MEND_REF" "https://github.com/$MEND_REPO" "$MEND_SRC"
fi
# pnpm: the exact version the checkout declares, into a private prefix (never the system global);
# a dry run has no checkout yet, so it reads the same manifest from GitHub.
if [ -f "$MEND_SRC/package.json" ]; then manifest="$(cat "$MEND_SRC/package.json")"; else
  manifest="$(curl -fsSL "https://raw.githubusercontent.com/$MEND_REPO/$MEND_REF/package.json" 2>/dev/null || true)"; fi
pnpm_version="$(printf '%s' "$manifest" | sed -n 's/.*"packageManager": *"pnpm@\([^"]*\)".*/\1/p' | head -n 1)"
[ -n "$pnpm_version" ] || die "No packageManager field in Mend's package.json at $MEND_REF."
if [ "$("$NPM_PREFIX/bin/pnpm" --version 2>/dev/null || true)" != "$pnpm_version" ]; then
  run "$NPM_BIN" install -g --prefix "$NPM_PREFIX" --no-fund --no-audit --loglevel=error "pnpm@$pnpm_version"
fi
info "Installing dependencies and building the web app (a few minutes on first run)…"
run sh -c "cd \"\$1\" && pnpm install --lockfile=false --silent && pnpm --filter @mend/web build" sh "$MEND_SRC"
ok "Mend built in $MEND_SRC"

run mkdir -p "$MEND_DIR" "$MEND_STORE_ROOT"
[ "$DRY_RUN" = 1 ] || { touch "$MEND_ENV" && chmod 600 "$MEND_ENV"; }
ensure_env_var "$MEND_ENV" MEND_DB_PASSWORD "$(generate_secret)"
ensure_env_var "$MEND_ENV" BETTER_AUTH_SECRET "$(generate_secret)"
MEND_PORT="$(setting "$MEND_ENV" PORT 3105 "${MEND_PORT:-}")"
MEND_DB_PORT="$(setting "$MEND_ENV" MEND_DB_PORT 5436 "${MEND_DB_PORT:-}")"
staged_env="$(stage_file "$MEND_ENV")"
set_env_var "$MEND_ENV" DATABASE_URL "postgres://mend:$(env_get "$staged_env" MEND_DB_PASSWORD)@127.0.0.1:$MEND_DB_PORT/mend"
set_env_var "$MEND_ENV" SEALANT_BASE_URL "http://127.0.0.1:$SEALANT_API_PORT"
set_env_var "$MEND_ENV" SEALANT_SERVICE_KEY "$SERVICE_KEY"
set_env_var "$MEND_ENV" APP_URL "http://localhost:$MEND_PORT"
set_env_var "$MEND_ENV" MEND_STORE_ROOT "$MEND_STORE_ROOT"
set_env_var "$MEND_ENV" MEND_VERSION "$MEND_VERSION"
set_env_var "$MEND_ENV" NODE_ENV production
# The service inherits no shell: the private node/pnpm/mend come first, then the login PATH so git,
# docker, gh and the agent CLIs resolve as they do for you.
set_env_var "$MEND_ENV" PATH "\"$PATH\""
ok "Mend config ready ($MEND_ENV)"

mend_compose_file="$(stage_file "$MEND_COMPOSE")"
cat >"$mend_compose_file" <<'EOF'
# Mend's own Postgres. Written by install.sh (re-runs overwrite it); values come from server.env.
name: mend
services:
  postgres:
    image: postgres:17-alpine
    environment: { POSTGRES_USER: mend, POSTGRES_PASSWORD: "${MEND_DB_PASSWORD}", POSTGRES_DB: mend }
    ports: ["127.0.0.1:${MEND_DB_PORT:-5436}:5432"]
    volumes: [mend-pgdata:/var/lib/postgresql/data]
    restart: unless-stopped
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U mend -d mend"], interval: 5s, timeout: 3s, retries: 10 }
volumes:
  mend-pgdata:
EOF
info "Starting Mend's Postgres on 127.0.0.1:$MEND_DB_PORT…"
mend_compose up -d --wait || die "Mend's Postgres failed to start. Inspect with: docker compose --project-directory $MEND_DIR logs"

# --- CLI (before the server starts: if the service fails, `mend doctor` is still there) ----------------------------------------------------------------------------------------------
if [ "$MEND_VERSION" = main ]; then CLI_VERSION=latest; else CLI_VERSION="$MEND_VERSION"; fi
run "$NPM_BIN" install -g --prefix "$NPM_PREFIX" --no-fund --no-audit --loglevel=error "@sealant/mend@$CLI_VERSION"
# A wrapper, not npm's symlink: the CLI's shebang is `#!/usr/bin/env node`, and on a host that had
# no Node the only Node is the private one under $NODE_DIR. The wrapper names it outright and puts
# it on PATH first, so `mend` runs and can re-exec itself.
MEND_BIN="$HOME/.local/bin/mend"
run mkdir -p "$HOME/.local/bin"
# An earlier install may have left npm's symlink here; writing through it would clobber npm's bin.
run rm -f "$MEND_BIN"
cat >"$(stage_file "$MEND_BIN")" <<EOF
#!/bin/sh
# Written by Mend's installer. Re-run it to move this wrapper to another Node.
PATH="$NPM_PREFIX/bin:$NODE_DIR_BIN:\$PATH"
export PATH
exec "$NODE_BIN" "$NPM_PREFIX/lib/node_modules/@sealant/mend/dist/main.js" "\$@"
EOF
run chmod 755 "$MEND_BIN"
ok "mend CLI at ~/.local/bin/mend (running $NODE_BIN)"
case ":$PATH:" in
*":$HOME/.local/bin:"*) ;;
*) info "~/.local/bin is not on your PATH. Add to your shell rc:  export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
esac

# --- Mend service ------------------------------------------------------------------------------------
ENTRY="$MEND_SRC/scripts/serve.mjs"
case "$OS" in
linux)
  unit_path="$CONFIG_HOME/systemd/user/mend.service"
  run mkdir -p "$(dirname "$unit_path")"
  cat >"$(stage_file "$unit_path")" <<EOF
[Unit]
Description=Mend server
After=docker.service network-online.target
[Service]
EnvironmentFile=$MEND_ENV
WorkingDirectory=$MEND_SRC
ExecStart=$NODE_BIN --experimental-strip-types $ENTRY
Restart=on-failure
RestartSec=3
[Install]
WantedBy=default.target
EOF
  run systemctl --user daemon-reload
  run systemctl --user enable --quiet mend.service
  # restart, not start: a re-run may have rebuilt the checkout under a running server.
  run systemctl --user restart mend.service
  if [ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null)" != yes ]; then
    info "Mend stops at logout until lingering is on:  loginctl enable-linger $(id -un)"
  fi
  MANAGE_STATUS="systemctl --user status mend"
  MANAGE_LOGS="journalctl --user -u mend -f"
  MANAGE_STOP="systemctl --user disable --now mend"
  ;;
darwin)
  plist="$HOME/Library/LaunchAgents/dev.sealant.mend.plist"
  run mkdir -p "$(dirname "$plist")"
  # launchd has no EnvironmentFile: a sh wrapper sources server.env and execs node.
  cat >"$(stage_file "$plist")" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>dev.sealant.mend</string>
  <key>ProgramArguments</key><array><string>/bin/sh</string><string>-c</string>
    <string>set -a; . "$MEND_ENV"; exec "$NODE_BIN" --experimental-strip-types "$ENTRY"</string></array>
  <key>WorkingDirectory</key><string>$MEND_SRC</string>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>$MEND_DIR/server.log</string>
  <key>StandardErrorPath</key><string>$MEND_DIR/server.log</string>
</dict></plist>
EOF
  run launchctl bootout "gui/$(id -u)" "$plist" 2>/dev/null || true
  run launchctl bootstrap "gui/$(id -u)" "$plist"
  MANAGE_STATUS="launchctl print gui/$(id -u)/dev.sealant.mend"
  MANAGE_LOGS="tail -f $MEND_DIR/server.log"
  MANAGE_STOP="launchctl bootout gui/$(id -u) $plist"
  ;;
esac
wait_for "http://127.0.0.1:$MEND_PORT/api/health" "Mend did not become healthy. Check: $MANAGE_LOGS"
ok "Mend server on http://127.0.0.1:$MEND_PORT"

# --- Done ----------------------------------------------------------------------------------------------
printf '\n'
ok "Mend $MEND_VERSION is running on Sealant $SEALANT_VERSION"
printf '\n  Get started:\n'
printf '    1. Open \033[1mhttp://localhost:%s\033[0m and create the first account\n' "$MEND_PORT"
printf '    2. \033[1mmend login\033[0m\n'
printf '    3. \033[1mmend connect claude\033[0m  (or codex, github) — your own subscriptions, nothing shared\n'
printf '    4. cd into a repository, then \033[1mmend claude\033[0m or \033[1mmend codex\033[0m\n'
printf '    5. Phone: open that URL in the phone browser. The native app is unpublished — build it\n'
printf '       from apps/mobile, then pair it: Settings → Devices, or \033[1mmend pair\033[0m\n'
phone_ip="$(reachable_ipv4 || true)"
if [ -n "$phone_ip" ]; then
  phone_url="http://$phone_ip:$MEND_PORT"
  printf '\n  This server from another device on your network or tailnet:  \033[1m%s\033[0m\n' "$phone_url"
  printf '  (the QR encodes that URL; the server binds every interface — keep it behind your tailnet or firewall)\n\n'
  run "$MEND_BIN" qr "$phone_url" || true
fi
printf '\n  Manage it:\n    %s\n    %s\n' "$MANAGE_STATUS" "$MANAGE_LOGS"
printf '    upgrade:    curl -fsSL https://mend.sealant.dev/install.sh | MEND_VERSION=latest SEALANT_VERSION=latest sh\n'
printf '    uninstall:  %s\n' "$MANAGE_STOP"
printf '                docker compose --project-directory %s down -v\n' "$MEND_DIR"
printf '                docker compose --project-directory %s down -v\n' "$SEALANT_DIR"
printf '                rm -rf %s %s %s %s\n\n' "$MEND_DIR" "$SEALANT_DIR" "$MEND_SRC" "$DATA_HOME/mend"
[ "$DRY_RUN" != 1 ] || info "Dry run complete — nothing on this machine changed. Staged files: $DRY_STAGE"
}

main "$@"
