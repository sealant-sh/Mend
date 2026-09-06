import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

// The descendant keeps inherited pipes open even when the group leader exits.
const child = spawn(
  process.execPath,
  ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
  {
    stdio: ["ignore", "inherit", "inherit"],
  },
);
writeFileSync(process.argv[2], JSON.stringify({ parent: process.pid, child: child.pid }));
if (process.argv[3] === "exit") process.exit(0);
process.on("SIGTERM", () => {});
setInterval(() => {}, 1000);
