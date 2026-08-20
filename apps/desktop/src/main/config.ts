import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The machine's Mend credential: `$XDG_CONFIG_HOME/mend/cli.json` (default
 * `~/.config/mend`), the file `mend login` writes. The desktop reads and
 * writes the same file, so signing in once — from either side — serves both.
 * A pre-XDG `~/.mend` stays authoritative when it is the only one present
 * (mirrors the CLI's resolver; neither side depends on @mend/store).
 *
 * `MEND_URL` / `MEND_TOKEN` override the file, as they do for the CLI.
 */

export interface StoredConfig {
  readonly url: string;
  readonly token: string | null;
}

const DEFAULT_URL = "http://localhost:3105";

const mendHome = (): string => {
  const xdg = process.env["XDG_CONFIG_HOME"];
  const preferred = path.join(
    xdg === undefined || xdg === "" ? path.join(os.homedir(), ".config") : xdg,
    "mend",
  );
  const legacy = path.join(os.homedir(), ".mend");
  return !fs.existsSync(preferred) && fs.existsSync(legacy) ? legacy : preferred;
};

export const configPath = (): string => path.join(mendHome(), "cli.json");

const readFile = (): Partial<StoredConfig> => {
  const file = configPath();
  if (!fs.existsSync(file)) return {};
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return {};
    const record = parsed as { readonly url?: unknown; readonly token?: unknown };
    return {
      ...(typeof record.url === "string" ? { url: record.url } : {}),
      ...(typeof record.token === "string" ? { token: record.token } : { token: null }),
    };
  } catch {
    return {};
  }
};

export const loadConfig = (): StoredConfig => {
  const file = readFile();
  const envToken = process.env["MEND_TOKEN"];
  return {
    url: process.env["MEND_URL"] ?? file.url ?? DEFAULT_URL,
    token: envToken !== undefined && envToken !== "" ? envToken : (file.token ?? null),
  };
};

/** 0600, like the CLI: the token is the only credential this machine holds. */
export const saveConfig = (next: StoredConfig): void => {
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify({ url: next.url, token: next.token }, null, 2)}\n`, {
    mode: 0o600,
  });
  fs.chmodSync(file, 0o600);
};

/**
 * Watch the credential file so `mend login` / `mend logout` in a terminal
 * reach the running desktop without a restart. The directory is watched
 * (editors and the CLI replace the file rather than rewrite it in place).
 */
export const watchConfig = (onChange: () => void): (() => void) => {
  const file = configPath();
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) return () => {};
  let timer: NodeJS.Timeout | null = null;
  const watcher = fs.watch(dir, (_event, name) => {
    if (name !== null && name !== path.basename(file)) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(onChange, 150);
  });
  return () => {
    if (timer !== null) clearTimeout(timer);
    watcher.close();
  };
};
