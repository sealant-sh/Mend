/**
 * The dotenv dialect Mend accepts for `mend env load` and the "Load a .env" panel — parsed
 * SERVER-SIDE so the CLI and the browser share one truth. `KEY=value`, optional `export `, `#`
 * comments, blank lines, single quotes (literal), double quotes (multi-line, `\n \r \t \" \\`
 * escapes), an unquoted ` # comment` after the value, later duplicates win. No variable expansion:
 * a workspace env is a literal contract, not a shell.
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
