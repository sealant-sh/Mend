import * as fs from "node:fs";

/**
 * `mend version`: this CLI's version, then the server's when it answers.
 * The two drift apart in practice — an npm install on one machine, a cluster
 * roll on another — and "which one am I on" is the first question any bug
 * report needs answered. The server line is best-effort: a missing server is
 * a fact to print, never an error.
 */

/** The published version, read from the package this file ships in (dist/ and src/ sit one level under it). */
export const cliVersion = (): string => {
  const raw = fs.readFileSync(new URL("../package.json", import.meta.url), "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed === "object" && parsed !== null && "version" in parsed) {
    const version = parsed.version;
    if (typeof version === "string") return version;
  }
  return "unknown";
};

export interface ServerVersion {
  readonly url: string;
  /** Null when the server did not answer in time or answered with no version. */
  readonly version: string | null;
}

/** Ask the server's health route, briefly; a slow or absent server is `null`. */
export const fetchServerVersion = async (
  url: string,
  timeoutMs = 2_000,
): Promise<ServerVersion> => {
  try {
    const response = await fetch(`${url}/api/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { url, version: null };
    const body: unknown = await response.json();
    const version =
      typeof body === "object" && body !== null && "version" in body ? body.version : null;
    return { url, version: typeof version === "string" ? version : null };
  } catch {
    return { url, version: null };
  }
};

/** The lines `mend version` prints — terse facts, no verdict beyond the mismatch note. */
export const versionLines = (cli: string, server: ServerVersion): ReadonlyArray<string> => {
  const lines = [`mend ${cli}`];
  if (server.version === null) {
    lines.push(`server · unreachable · ${server.url}`);
  } else {
    lines.push(`server ${server.version} · ${server.url}`);
    if (server.version !== cli) lines.push("versions differ — the server's API wins");
  }
  return lines;
};
