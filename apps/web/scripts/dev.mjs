// Runs the vite dev server (the app) and the Effect server (API + auth +
// dispatcher) side by side; either one dying takes both down.
import { spawn } from "node:child_process";

const children = [
  spawn("pnpm", ["exec", "vite", "dev"], { stdio: "inherit" }),
  spawn("node", ["--watch", "src/entry/main.ts"], { stdio: "inherit" }),
];

const stop = (code) => {
  for (const child of children) child.kill("SIGTERM");
  process.exit(code ?? 0);
};

for (const child of children) child.on("exit", (code) => stop(code));
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
