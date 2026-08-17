/**
 * `mend env`: load a dotenv file into the project's env store, and show what is stored. Routing
 * (Configuration vs Secrets) happens SERVER-SIDE by name — the CLI parses the file, ships the
 * entries once, and prints the per-name report. Values are never printed.
 */

export interface DotenvEntry {
  readonly name: string;
  readonly value: string;
  readonly line: number;
}

export interface DotenvParse {
  readonly entries: ReadonlyArray<DotenvEntry>;
  /** Lines that were not `NAME=value` (an `export ` prefix is allowed), by line number. */
  readonly malformed: ReadonlyArray<number>;
}

const unescapeDoubleQuoted = (body: string): string =>
  body.replace(/\\(.)/g, (_all, char: string) => {
    switch (char) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      default:
        return char;
    }
  });

const findUnescapedQuote = (text: string, quote: string): number => {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") {
      i += 1;
      continue;
    }
    if (text[i] === quote) return i;
  }
  return -1;
};

/**
 * Parse the common dotenv dialect: `KEY=value`, optional `export `, `#` comments, blank lines,
 * single quotes (literal), double quotes (multi-line, `\n \r \t \" \\` escapes), an unquoted
 * ` # comment` after the value, and later duplicates winning. No variable expansion — a workspace
 * env is a literal contract, not a shell.
 */
export const parseDotenv = (contents: string): DotenvParse => {
  const entries = new Map<string, DotenvEntry>();
  const malformed: Array<number> = [];
  const lines = contents.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const trimmed = (lines[index] ?? "").trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (match === null) {
      malformed.push(index + 1);
      continue;
    }
    const name = match[1] ?? "";
    let rest = match[2] ?? "";
    let value: string;
    if (rest.startsWith('"')) {
      let body = rest.slice(1);
      let closed = false;
      for (;;) {
        const end = findUnescapedQuote(body, '"');
        if (end !== -1) {
          body = body.slice(0, end);
          closed = true;
          break;
        }
        const next = lines[index + 1];
        if (next === undefined) break;
        index += 1;
        body = `${body}\n${next}`;
      }
      if (!closed) {
        malformed.push(index + 1);
        continue;
      }
      value = unescapeDoubleQuoted(body);
    } else if (rest.startsWith("'")) {
      const end = rest.indexOf("'", 1);
      if (end === -1) {
        malformed.push(index + 1);
        continue;
      }
      value = rest.slice(1, end);
    } else {
      const hash = rest.search(/\s#/);
      if (hash !== -1) rest = rest.slice(0, hash);
      value = rest.trim();
    }
    entries.set(name, { name, value, line: index + 1 });
  }
  return { entries: [...entries.values()], malformed };
};

/** The server's per-name report for a load. */
export interface EnvironmentLoadReportDto {
  readonly loaded: ReadonlyArray<{
    readonly name: string;
    readonly lane: "configuration" | "secret";
    readonly action: "created" | "updated" | "moved";
  }>;
  readonly rejected: ReadonlyArray<{ readonly name: string; readonly reason: string }>;
  readonly environmentRevision: number;
  readonly secretRevision: number;
}

/** Render the report as terse status lines — names, lanes, actions, reasons; never a value. */
export const formatLoadReport = (
  report: EnvironmentLoadReportDto,
  paint: { readonly dim: (s: string) => string; readonly warn: (s: string) => string },
): ReadonlyArray<string> => {
  const width = Math.max(
    0,
    ...report.loaded.map((entry) => entry.name.length),
    ...report.rejected.map((entry) => entry.name.length),
  );
  const lines: Array<string> = [];
  for (const entry of report.loaded) {
    lines.push(
      `  ${entry.name.padEnd(width)}  ${entry.lane === "secret" ? "secret" : "configuration"} ${paint.dim(`· ${entry.action}${entry.lane === "configuration" ? " · plaintext" : ""}`)}`,
    );
  }
  for (const entry of report.rejected) {
    lines.push(
      `  ${entry.name.padEnd(width)}  ${paint.warn("rejected")} ${paint.dim(`· ${entry.reason}`)}`,
    );
  }
  return lines;
};
