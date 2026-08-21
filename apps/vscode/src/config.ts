import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import * as vscode from "vscode";

export interface MendConnection {
  readonly url: string;
  readonly token: string | null;
}

const TOKEN_KEY = "mend.serverToken";

const storedToken = (value: string | undefined): MendConnection | null => {
  if (value === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) return null;
    const url = Reflect.get(parsed, "url");
    const token = Reflect.get(parsed, "token");
    return typeof url === "string" && typeof token === "string" ? { url, token } : null;
  } catch {
    return null;
  }
};

const mendHome = (): string => {
  const xdg = process.env["XDG_CONFIG_HOME"];
  const preferred = path.join(
    xdg === undefined || xdg === "" ? path.join(os.homedir(), ".config") : xdg,
    "mend",
  );
  const legacy = path.join(os.homedir(), ".mend");
  return fs.existsSync(legacy) && !fs.existsSync(preferred) ? legacy : preferred;
};

const cliConfig = (): MendConnection | null => {
  const file = path.join(mendHome(), "cli.json");
  if (!fs.existsSync(file)) return null;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const url = Reflect.get(parsed, "url");
    const token = Reflect.get(parsed, "token");
    if (typeof url !== "string" || url.trim() === "") return null;
    return {
      url: url.replace(/\/$/, ""),
      token: typeof token === "string" && token !== "" ? token : null,
    };
  } catch {
    return null;
  }
};

/** One connection shared by the tree, status item, URI handler, and commands. */
export class ConnectionStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async get(): Promise<MendConnection> {
    const configured = vscode.workspace.getConfiguration("mend").get<string>("serverUrl")?.trim();
    const discovered = cliConfig();
    const url = (
      (configured === undefined || configured === "" ? discovered?.url : configured) ??
      "http://localhost:3105"
    ).replace(/\/$/, "");
    const secret = storedToken(await this.context.secrets.get(TOKEN_KEY));
    const token =
      secret?.url === url ? secret.token : url === discovered?.url ? discovered.token : null;
    return { url, token };
  }

  async configure(): Promise<boolean> {
    const current = await this.get();
    const url = await vscode.window.showInputBox({
      title: "Connect Mend",
      prompt: "Mend server URL",
      value: current.url,
      ignoreFocusOut: true,
      validateInput: (value) => {
        try {
          const parsed = new URL(value);
          return parsed.protocol === "http:" || parsed.protocol === "https:"
            ? null
            : "Use an http or https URL.";
        } catch {
          return "Enter a valid URL.";
        }
      },
    });
    if (url === undefined) return false;
    const token = await vscode.window.showInputBox({
      title: "Connect Mend",
      prompt: "Access token. Leave empty when the local server does not require one.",
      password: true,
      ignoreFocusOut: true,
    });
    if (token === undefined) return false;
    const normalizedUrl = url.replace(/\/$/, "");
    await vscode.workspace
      .getConfiguration("mend")
      .update("serverUrl", normalizedUrl, vscode.ConfigurationTarget.Global);
    if (token === "") await this.context.secrets.delete(TOKEN_KEY);
    else await this.context.secrets.store(TOKEN_KEY, JSON.stringify({ url: normalizedUrl, token }));
    return true;
  }
}

export const isLoopbackServer = (connection: MendConnection): boolean => {
  try {
    const host = new URL(connection.url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
};
