import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { SkillWithFiles } from "@mend/domain/workbench";
import { validateSkillFilePath, validateSkillName } from "@mend/domain/workbench";
import { Effect, Schema } from "effect";

/**
 * Launch-side skills materialization. The mounted harness home is the seam
 * (plan §17: "skills management writes into `harness-home/.claude/skills`
 * with no workspace exec"): bundles are written server-side before the
 * workspace boots, and the boot relocation's `cp -an` keeps mount-side files
 * on collision, so what is written here is exactly what the harness reads.
 *
 * Every harness gets the same library in its own discovery location — claude
 * reads `$HOME/.claude/skills`, codex reads `$CODEX_HOME/skills` (both
 * symlinked onto the mount at boot). On a name collision the project's skill
 * wins over the user's: the more specific library overrides.
 */

/** Harness-home-relative skills directories, one per harness that reads skills. */
export const SKILL_TARGET_DIRS = [".claude/skills", ".codex/skills"] as const;

/**
 * The bookkeeping file that makes materialization reconciling rather than
 * additive: it records which bundle directories Mend wrote, so a skill
 * removed from the library disappears from the next launch too — while
 * directories the agent created itself are never touched.
 */
const MANAGED_MANIFEST = ".mend-managed-skills.json";

const ManagedManifest = Schema.Record(Schema.String, Schema.Array(Schema.String));

export class SkillMaterializeError extends Schema.TaggedErrorClass<SkillMaterializeError>()(
  "SkillMaterializeError",
  { message: Schema.String },
) {}

/**
 * Merge the two libraries into the delivered set: user skills as the base,
 * project skills over them by name.
 */
export const mergeSkillLibraries = (libraries: {
  readonly user: ReadonlyArray<SkillWithFiles>;
  readonly project: ReadonlyArray<SkillWithFiles>;
}): ReadonlyArray<SkillWithFiles> => {
  const byName = new Map<string, SkillWithFiles>();
  for (const bundle of libraries.user) byName.set(bundle.skill.name, bundle);
  for (const bundle of libraries.project) byName.set(bundle.skill.name, bundle);
  return [...byName.values()];
};

const readManifest = async (
  harnessHomePath: string,
): Promise<Record<string, ReadonlyArray<string>>> => {
  try {
    const raw = await fs.readFile(path.join(harnessHomePath, MANAGED_MANIFEST), "utf8");
    return Schema.decodeUnknownSync(Schema.fromJsonString(ManagedManifest))(raw);
  } catch {
    // Absent or unreadable — nothing was managed before.
    return {};
  }
};

/**
 * Write the merged library into every harness's skills directory under the
 * session's harness home, removing bundles Mend managed on a previous launch
 * that the library no longer carries. Defense in depth: rows are validated at
 * the API seam, but names and paths are re-checked before they touch the
 * filesystem — an invalid bundle is skipped, never a traversal.
 */
export const materializeSkills = (
  harnessHomePath: string,
  bundles: ReadonlyArray<SkillWithFiles>,
): Effect.Effect<void, SkillMaterializeError> =>
  Effect.tryPromise({
    try: async () => {
      const deliverable = bundles.filter(
        (bundle) =>
          validateSkillName(bundle.skill.name) === null &&
          bundle.files.every((file) => validateSkillFilePath(file.path) === null),
      );
      const names = deliverable.map((bundle) => bundle.skill.name);
      const previous = await readManifest(harnessHomePath);
      // Nothing to write and nothing written before: leave the harness home
      // untouched. An empty library must not manufacture directories — the
      // engine reads an empty home as "no live harness state yet", and that
      // signal steers archive restores on relaunch.
      if (names.length === 0 && Object.keys(previous).length === 0) return;
      for (const target of SKILL_TARGET_DIRS) {
        const targetRoot = path.join(harnessHomePath, target);
        await fs.mkdir(targetRoot, { recursive: true });
        const current = new Set(names);
        for (const stale of previous[target] ?? []) {
          if (current.has(stale) || validateSkillName(stale) !== null) continue;
          await fs.rm(path.join(targetRoot, stale), { recursive: true, force: true });
        }
        for (const bundle of deliverable) {
          const bundleRoot = path.join(targetRoot, bundle.skill.name);
          await fs.rm(bundleRoot, { recursive: true, force: true });
          for (const file of bundle.files) {
            const filePath = path.join(bundleRoot, file.path);
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, file.contents, "utf8");
          }
        }
      }
      const manifest = Object.fromEntries(SKILL_TARGET_DIRS.map((target) => [target, names]));
      await fs.writeFile(
        path.join(harnessHomePath, MANAGED_MANIFEST),
        JSON.stringify(manifest, null, 2),
        "utf8",
      );
    },
    catch: (error) =>
      new SkillMaterializeError({
        message: `skills could not be written into the harness home: ${String(error)}`,
      }),
  });
