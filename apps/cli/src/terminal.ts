import { spawn } from "node:child_process";

/** Open a Mend web surface without keeping the terminal process alive. */
export const openUrl = (target: string): void => {
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  const child = spawn(opener, [target], { detached: true, stdio: "ignore" });
  child.on("error", () => undefined);
  child.unref();
};
