import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { SkillId } from "@mend/domain";
import { Skill, SkillWithFiles } from "@mend/domain/workbench";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { materializeSkills, mergeSkillLibraries, SKILL_TARGET_DIRS } from "./skills.ts";

const bundle = (
  name: string,
  files: ReadonlyArray<{ readonly path: string; readonly contents: string }>,
  scope: "user" | "project" = "user",
): SkillWithFiles =>
  new SkillWithFiles({
    skill: new Skill({
      id: SkillId.make(`id-${name}-${scope}`),
      scope,
      ownerUserId: scope === "user" ? "user-1" : null,
      projectId: null,
      name,
      description: "",
      fileCount: files.length,
      bytes: 0,
      revision: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    files,
  });

const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), "mend-skills-home-"));

describe("mergeSkillLibraries", () => {
  it("project wins over user by name", () => {
    const merged = mergeSkillLibraries(
      {
        user: [bundle("a", [{ path: "SKILL.md", contents: "user a" }])],
        project: [bundle("a", [{ path: "SKILL.md", contents: "project a" }], "project")],
      },
      { inheritUserSkills: true },
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.files[0]?.contents).toBe("project a");
  });

  it("inherits user skills by default when enabled", () => {
    const merged = mergeSkillLibraries(
      {
        user: [bundle("global", [{ path: "SKILL.md", contents: "user" }])],
        project: [bundle("local", [{ path: "SKILL.md", contents: "project" }], "project")],
      },
      { inheritUserSkills: true },
    );
    expect(merged.map((entry) => entry.skill.name)).toEqual(["global", "local"]);
  });

  it("keeps project skills and excludes user skills when inheritance is off", () => {
    const merged = mergeSkillLibraries(
      {
        user: [bundle("global", [{ path: "SKILL.md", contents: "user" }])],
        project: [bundle("local", [{ path: "SKILL.md", contents: "project" }], "project")],
      },
      { inheritUserSkills: false },
    );
    expect(merged.map((entry) => entry.skill.name)).toEqual(["local"]);
  });
});

describe("materializeSkills", () => {
  it("writes every bundle into every harness's skills directory", async () => {
    const home = tmpHome();
    await Effect.runPromise(
      materializeSkills(home, [
        bundle("review", [
          { path: "SKILL.md", contents: "# review" },
          { path: "references/notes.md", contents: "notes" },
        ]),
      ]),
    );
    for (const target of SKILL_TARGET_DIRS) {
      expect(fs.readFileSync(path.join(home, target, "review", "SKILL.md"), "utf8")).toBe(
        "# review",
      );
      expect(
        fs.readFileSync(path.join(home, target, "review", "references", "notes.md"), "utf8"),
      ).toBe("notes");
    }
  });

  it("reconciles: a skill gone from the library disappears; foreign dirs survive", async () => {
    const home = tmpHome();
    await Effect.runPromise(
      materializeSkills(home, [
        bundle("kept", [{ path: "SKILL.md", contents: "k" }]),
        bundle("dropped", [{ path: "SKILL.md", contents: "d" }]),
      ]),
    );
    // A directory the agent made itself, outside Mend's bookkeeping.
    const foreign = path.join(home, ".claude", "skills", "hand-made");
    fs.mkdirSync(foreign, { recursive: true });
    fs.writeFileSync(path.join(foreign, "SKILL.md"), "mine");

    await Effect.runPromise(
      materializeSkills(home, [bundle("kept", [{ path: "SKILL.md", contents: "k2" }])]),
    );
    expect(fs.existsSync(path.join(home, ".claude", "skills", "dropped"))).toBe(false);
    expect(fs.existsSync(path.join(home, ".codex", "skills", "dropped"))).toBe(false);
    expect(fs.readFileSync(path.join(home, ".claude", "skills", "kept", "SKILL.md"), "utf8")).toBe(
      "k2",
    );
    expect(fs.readFileSync(path.join(foreign, "SKILL.md"), "utf8")).toBe("mine");
  });

  it("an empty library leaves the harness home untouched", async () => {
    const home = tmpHome();
    await Effect.runPromise(materializeSkills(home, []));
    expect(fs.readdirSync(home)).toEqual([]);
  });

  it("skips a bundle whose name or paths could escape", async () => {
    const home = tmpHome();
    await Effect.runPromise(
      materializeSkills(home, [
        bundle("ok", [{ path: "SKILL.md", contents: "fine" }]),
        bundle("evil", [{ path: "../escape.md", contents: "nope" }]),
      ]),
    );
    expect(fs.existsSync(path.join(home, ".claude", "skills", "ok", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(home, ".claude", "skills", "evil"))).toBe(false);
    expect(fs.existsSync(path.join(home, ".claude", "escape.md"))).toBe(false);
  });
});
