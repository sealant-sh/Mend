import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { readSyncFiles, scanDotfileCandidates } from "./dotfiles.ts";

const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), "mend-cli-dotfiles-"));

describe("scanDotfileCandidates", () => {
  it("reports only curated candidates that exist as files", () => {
    const home = tmpHome();
    fs.writeFileSync(path.join(home, ".zshrc"), "export A=1\n");
    fs.mkdirSync(path.join(home, ".config", "git"), { recursive: true });
    fs.writeFileSync(path.join(home, ".config", "git", "config"), "[user]\n");
    // A directory with a candidate name must not appear.
    fs.mkdirSync(path.join(home, ".vimrc"));

    const found = scanDotfileCandidates(home);
    const paths = found.map((entry) => entry.path);
    expect(paths).toContain(".zshrc");
    expect(paths).toContain(".config/git/config");
    expect(paths).not.toContain(".vimrc");
    expect(found.find((entry) => entry.path === ".zshrc")?.group).toBe("shell");
  });
});

describe("readSyncFiles", () => {
  it("reads contents with modes; an explicit missing path is an error, not a skip", () => {
    const home = tmpHome();
    fs.writeFileSync(path.join(home, ".zshrc"), "export A=1\n");
    fs.chmodSync(path.join(home, ".zshrc"), 0o755);

    const ok = readSyncFiles(home, [".zshrc"]);
    expect("files" in ok && ok.files).toEqual([
      {
        path: ".zshrc",
        contentsBase64: Buffer.from("export A=1\n").toString("base64"),
        mode: "755",
      },
    ]);

    const missing = readSyncFiles(home, [".zshrc", ".typo"]);
    expect("error" in missing && missing.error).toMatch(/\.typo/);
  });

  it("rejects a file over the server's 1MB cap before uploading", () => {
    const home = tmpHome();
    fs.writeFileSync(path.join(home, ".big"), Buffer.alloc(1024 * 1024 + 1));
    const result = readSyncFiles(home, [".big"]);
    expect("error" in result && result.error).toMatch(/over 1MB/);
  });
});
