import { describe, expect, it } from "vitest";

import { parseDotenv } from "../src/workbench/dotenv.ts";

describe("parseDotenv", () => {
  it("parses the common dialect: comments, blanks, export, quotes, trailing comments", () => {
    const parsed = parseDotenv(
      [
        "# a comment",
        "",
        "PORT=3000",
        "export APP_MODE=review",
        "DATABASE_URL='postgres://u:p@h/db' ",
        'GREETING="hello \\"world\\"\\nnext"',
        "TRAILING=value # not part of it",
        "URL_WITH_HASH=http://x/#frag",
        "EMPTY=",
        "  SPACED  =  padded  ",
      ].join("\n"),
    );
    expect(parsed.malformed).toEqual([]);
    expect(Object.fromEntries(parsed.entries.map((e) => [e.name, e.value]))).toEqual({
      PORT: "3000",
      APP_MODE: "review",
      DATABASE_URL: "postgres://u:p@h/db",
      GREETING: 'hello "world"\nnext',
      TRAILING: "value",
      URL_WITH_HASH: "http://x/#frag",
      EMPTY: "",
      SPACED: "padded",
    });
  });

  it("lets a later duplicate win and keeps the last line number", () => {
    const parsed = parseDotenv("A=1\nA=2\n");
    expect(parsed.entries).toEqual([{ name: "A", value: "2", line: 2 }]);
  });

  it("supports multi-line double-quoted values", () => {
    const parsed = parseDotenv('KEY_PEM="line one\nline two"\nAFTER=1');
    expect(parsed.entries.map((e) => e.name)).toEqual(["KEY_PEM", "AFTER"]);
    expect(parsed.entries[0]?.value).toBe("line one\nline two");
  });

  it("reports malformed lines by number without dropping the rest", () => {
    const parsed = parseDotenv(
      'GOOD=1\nnot an assignment\n1BAD=2\nOPEN="never closed\nALSO_GOOD=3',
    );
    expect(parsed.malformed).toEqual([2, 3, 5]);
    expect(parsed.entries.map((e) => e.name)).toEqual(["GOOD"]);
  });

  it("does not expand variables — a workspace env is literal", () => {
    const parsed = parseDotenv("A=x\nB=$A/${A}");
    expect(parsed.entries[1]?.value).toBe("$A/${A}");
  });
});
