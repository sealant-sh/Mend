#!/bin/sh
# Disposable prerequisite probe, NOT a Mend or VS Code end-to-end test.
# Run on the Mac with Docker Desktop or OrbStack running:
#   sh scripts/check-docker-boundary.sh
# Linux control run: sh scripts/check-docker-boundary.sh --allow-linux
# Creates one scratch volume and temporary containers, removed on exit. The
# node:24-alpine image is downloaded if absent and stays cached. No host mounts,
# Docker socket mounts, credentials, or privileged containers are used.
set -eu

fail() {
  printf 'FAIL %s\n' "$1" >&2
  exit 1
}
pass() { printf 'PASS %s\n' "$1"; }

case "${1:-}" in
--help | -h)
  printf '%s\n' 'Usage: sh scripts/check-docker-boundary.sh [--allow-linux]' \
    'Tests disposable Docker volumes, Unix sockets and published loopback ports.' \
    'Does not install Mend or establish macOS/VS Code product support.'
  exit 0
  ;;
'' | --allow-linux) ;;
*) fail 'Unknown argument. Use --help.' ;;
esac
[ "$#" -le 1 ] || fail 'Too many arguments. Use --help.'
os=$(uname -s)
case "$os" in
Darwin) ;;
Linux) [ "${1:-}" = --allow-linux ] || fail 'Use --allow-linux for a Linux control run.' ;;
*) fail 'Run on macOS, or Linux with --allow-linux.' ;;
esac
for tool in docker curl mktemp; do
  command -v "$tool" >/dev/null 2>&1 || fail "Missing $tool."
done

# Published localhost ports must belong to THIS computer, not a remote daemon.
# Respect Docker's context precedence; never switch the user's global context.
if [ -n "${DOCKER_CONTEXT:-}" ]; then
  endpoint=$(docker context inspect "$DOCKER_CONTEXT" --format '{{.Endpoints.docker.Host}}')
elif [ -n "${DOCKER_HOST:-}" ]; then
  endpoint=$DOCKER_HOST
else
  endpoint=$(docker context inspect --format '{{.Endpoints.docker.Host}}')
fi
case "$endpoint" in unix://*) ;; *) fail 'Select a local Docker Desktop/OrbStack/Engine context first.' ;; esac
server=$(docker version --format '{{.Server.Os}} {{.Server.Arch}} {{.Server.Version}}') || fail 'Docker is not running.'
case "$server" in linux\ *) ;; *) fail 'Docker must run Linux containers.' ;; esac
docker compose version --short >/dev/null || fail 'Docker Compose v2 is required.'
printf 'Host: %s %s\nDocker server: %s\n' "$os" "$(uname -m)" "$server"

scratch=$(mktemp -d "${TMPDIR:-/tmp}/mend-boundary.XXXXXXXX")
suffix=${scratch##*.}
volume="mend-boundary-$suffix"
producer="mend-boundary-server-$suffix"
consumer="mend-boundary-client-$suffix"
volume_created=0
producer_created=0
cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  docker rm -f "$consumer" >/dev/null 2>&1 || true
  if [ "$producer_created" = 1 ]; then
    docker rm -f "$producer" >/dev/null 2>&1 || status=1
  fi
  if [ "$volume_created" = 1 ]; then
    docker volume rm "$volume" >/dev/null 2>&1 || {
      printf 'WARN scratch volume %s needs manual removal\n' "$volume" >&2
      status=1
    }
  fi
  rm -rf "$scratch"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

image=node:24-alpine
if ! docker image inspect "$image" >/dev/null 2>&1; then
  printf 'Downloading probe image %s...\n' "$image"
  docker pull "$image" >/dev/null || fail 'Could not download the probe image.'
fi
image_id=$(docker image inspect "$image" --format '{{.Id}}')
printf 'Probe image: %s\n' "$image_id"
docker volume create "$volume" >/dev/null
volume_created=1
# Set before run so cleanup also handles a partially created container.
producer_created=1
docker run -d --name "$producer" \
  --label dev.sealant.mend.boundary-probe=true \
  --mount "type=volume,source=$volume,target=/data" \
  -p 127.0.0.1::8080 "$image_id" node -e '
const fs = require("node:fs");
const http = require("node:http");
fs.mkdirSync("/data/session", { recursive: true, mode: 0o700 });
fs.writeFileSync("/data/session/marker", "mend-boundary\n", { mode: 0o600 });
fs.mkdirSync("/data/other-session", { mode: 0o700 });
fs.writeFileSync("/data/other-session/private", "must not be mounted");
for (const name of ["control", "mend"]) {
  const socket = "/data/session/" + name + ".sock";
  http.createServer((_req, res) => res.end(name)).listen(socket, () => {
    fs.chmodSync(socket, 0o600);
  });
}
http.createServer((_req, res) => res.end("mend-boundary")).listen(8080, "0.0.0.0");
' >/dev/null || fail 'Could not start the probe server.'

binding=$(docker port "$producer" 8080/tcp)
case "$binding" in 127.0.0.1:*) port=${binding##*:} ;; *) fail 'Probe port is not published on loopback.' ;; esac
attempt=0
until [ "$(curl --noproxy '*' -fsS --max-time 2 "http://127.0.0.1:$port" 2>/dev/null || true)" = mend-boundary ]; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 20 ] || fail 'The host cannot reach the published container port.'
  sleep 1
done
pass 'Host reaches the published loopback port without a VM/container IP.'

# Both consumers are Linux processes: the Mac never opens a Unix socket.
# A subpath mount must not expose the whole store or another session.
docker run --rm --name "$consumer" --network none \
  --label dev.sealant.mend.boundary-probe=true \
  --mount "type=volume,source=$volume,target=/session,volume-subpath=session,readonly" \
  "$image_id" node -e '
const fs = require("node:fs");
const http = require("node:http");
const assert = require("node:assert/strict");
assert.equal(fs.readFileSync("/session/marker", "utf8"), "mend-boundary\n");
assert.deepEqual(fs.readdirSync("/session").sort(), ["control.sock", "marker", "mend.sock"]);
assert.throws(() => fs.writeFileSync("/session/write-test", "no"), { code: "EROFS" });
const deadline = setTimeout(() => { console.error("socket probe timed out"); process.exit(1); }, 5000);
Promise.all(["control", "mend"].map(name => new Promise((resolve, reject) => {
  http.get({ socketPath: "/session/" + name + ".sock", path: "/" }, response => {
    let body = "";
    response.setEncoding("utf8");
    response.on("data", chunk => body += chunk);
    response.on("error", reject);
    response.on("end", () => {
      if (body === name) resolve(); else reject(new Error("socket response mismatch"));
    });
  }).on("error", reject);
}))).then(() => clearTimeout(deadline), error => {
  console.error(error.message);
  process.exit(1);
});
' || fail 'Read-only volume subpath / Unix socket exchange failed.'
pass 'Separate container reaches both 0600 sockets through a read-only volume subpath.'
pass 'Consumer sees only its mounted session directory; filesystem writes are refused.'

# Replacing the application container must preserve volume-backed data.
docker rm -f "$producer" >/dev/null
producer_created=0
docker run --rm --name "$consumer" --network none \
  --label dev.sealant.mend.boundary-probe=true \
  --mount "type=volume,source=$volume,target=/session,volume-subpath=session,readonly" \
  "$image_id" node -e '
require("node:assert/strict").equal(
  require("node:fs").readFileSync("/session/marker", "utf8"), "mend-boundary\n"
);
' || fail 'Volume data did not survive removal of the producer.'
pass 'Data survives application-container removal.'
printf '\nPrerequisites observed only. Mend launch, git, credentials, restart recovery,\nand VS Code Remote-SSH still need the end-to-end checks in docs/MACOS-VALIDATION.md.\n'
