import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { MAX_SKILL_FILE_BYTES, readFrontmatterDescription, scanSkillLibrary } from "./skills.ts";

const tmpLibrary = () => fs.mkdtempSync(path.join(os.tmpdir(), "mend-cli-skills-"));

const writeSkill = (root: string, name: string, skillMd: string) => {
  fs.mkdirSync(path.join(root, name), { recursive: true });
  fs.writeFileSync(path.join(root, name, "SKILL.md"), skillMd);
};

describe("readFrontmatterDescription", () => {
  it("reads plain and quoted single-line scalars", () => {
    expect(readFrontmatterDescription("---\nname: x\ndescription: Do the thing.\n---\nBody")).toBe(
      "Do the thing.",
    );
    expect(readFrontmatterDescription('---\ndescription: "Quoted, with: colon"\n---\n')).toBe(
      "Quoted, with: colon",
    );
  });

  it("reads absent, foldy, or frontmatter-less descriptions as empty", () => {
    expect(readFrontmatterDescription("No frontmatter at all")).toBe("");
    expect(readFrontmatterDescription("---\nname: x\n---\nBody")).toBe("");
    expect(readFrontmatterDescription("---\ndescription: >-\n  folded\n---\n")).toBe("");
  });
});

describe("scanSkillLibrary", () => {
  it("collects bundles with their support files; non-skill dirs get a note", () => {
    const root = tmpLibrary();
    writeSkill(root, "code-review", "---\ndescription: Review changes.\n---\nHow to review.");
    fs.mkdirSync(path.join(root, "code-review", "references"));
    fs.writeFileSync(path.join(root, "code-review", "references", "notes.md"), "extra\n");
    fs.mkdirSync(path.join(root, "not-a-skill"));
    fs.writeFileSync(path.join(root, "loose-file.md"), "ignored\n");

    const result = scanSkillLibrary(root);
    if ("error" in result) throw new Error(result.error);
    expect(result.skills).toHaveLength(1);
    const skill = result.skills[0];
    expect(skill?.name).toBe("code-review");
    expect(skill?.description).toBe("Review changes.");
    expect(skill?.files.map((file) => file.path)).toEqual(["SKILL.md", "references/notes.md"]);
    expect(result.notes).toEqual([{ skill: "not-a-skill", message: "no SKILL.md — skipped" }]);
  });

  it("skips binary and oversized files with a note, keeping the bundle", () => {
    const root = tmpLibrary();
    writeSkill(root, "with-junk", "---\ndescription: d\n---\n");
    fs.writeFileSync(path.join(root, "with-junk", "blob.bin"), Buffer.from([0, 1, 2]));
    fs.writeFileSync(path.join(root, "with-junk", "big.md"), "x".repeat(MAX_SKILL_FILE_BYTES + 1));

    const result = scanSkillLibrary(root);
    if ("error" in result) throw new Error(result.error);
    expect(result.skills[0]?.files.map((file) => file.path)).toEqual(["SKILL.md"]);
    expect(result.notes.map((note) => note.message).toSorted()).toEqual([
      "big.md is over 512KB — skipped",
      "blob.bin is binary — skipped",
    ]);
  });

  it("an unreadable root is an error, not an empty success", () => {
    const result = scanSkillLibrary(path.join(tmpLibrary(), "missing"));
    expect("error" in result).toBe(true);
  });
});
