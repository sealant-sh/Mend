// Single-host entrypoint: run the Mend API server and the web server as two
// child processes in one service — the shape the installer and the Docker
// image use. Kubernetes runs the same two entries as separate Deployments
// instead (deploy/helm/mend). Either child dying takes the pair down so the
// supervisor (systemd, Docker) restarts both together.
import { spawn } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;
const flags = ["--experimental-strip-types"];

const webPort = process.env.PORT ?? "3105";
const apiPort = process.env.MEND_API_SERVER_PORT ?? "3101";

const children = [
  spawn(node, [...flags, path.join(repoRoot, "apps/api/src/main.ts")], {
    stdio: "inherit",
    env: { ...process.env, PORT: apiPort },
  }),
  spawn(node, [...flags, path.join(repoRoot, "apps/web/src/entry/main.ts")], {
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: webPort,
      MEND_API_URL: process.env.MEND_API_URL ?? `http://localhost:${apiPort}`,
    },
  }),
];

const stop = (code) => {
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code ?? 0), 5000).unref();
};
for (const child of children) child.on("exit", (code) => stop(code ?? 0));
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
