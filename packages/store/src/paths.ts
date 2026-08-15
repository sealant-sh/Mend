import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Where Mend keeps its machine state — the store, keys, run sockets:
 * `$XDG_CONFIG_HOME/mend`, defaulting to `~/.config/mend`. Installs from before the XDG move
 * keep working: when only the legacy `~/.mend` exists, it stays authoritative — nothing is
 * silently relocated. Injectable inputs so the decision table is testable.
 */
export const resolveMendHome = (input: {
  readonly xdgConfigHome: string | undefined;
  readonly homedir: string;
  readonly exists: (candidate: string) => boolean;
}): string => {
  const configHome =
    input.xdgConfigHome === undefined || input.xdgConfigHome === ""
      ? path.join(input.homedir, ".config")
      : input.xdgConfigHome;
  const preferred = path.join(configHome, "mend");
  const legacy = path.join(input.homedir, ".mend");
  return !input.exists(preferred) && input.exists(legacy) ? legacy : preferred;
};

export const mendHome = (): string =>
  resolveMendHome({
    xdgConfigHome: process.env["XDG_CONFIG_HOME"],
    homedir: os.homedir(),
    exists: fs.existsSync,
  });
