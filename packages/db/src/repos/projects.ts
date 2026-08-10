import { PgClient } from "@effect/sql-pg";
import { ProjectId, type Sha } from "@mend/domain";
import { Project, type AutomationChoice } from "@mend/domain/workbench";
import { asc, eq } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";

import { MendDB } from "../client.ts";
import { notifyEvent } from "../events.ts";
import { projects } from "../schema/workbench.ts";

export class ProjectNotFoundError extends Schema.TaggedErrorClass<ProjectNotFoundError>()(
  "ProjectNotFoundError",
  {
    projectId: Schema.String,
  },
) {}

export interface NewProject {
  readonly name: string;
  readonly originUrl: string | null;
  readonly storePath: string;
  readonly defaultBranch: string;
  readonly adoptedSha: Sha | null;
}

/** The index of adopted repositories (plan §5.2); the store itself is git on disk. */
export class ProjectsRepo extends Context.Service<
  ProjectsRepo,
  {
    readonly create: (project: NewProject) => Effect.Effect<Project>;
    readonly byId: (id: ProjectId) => Effect.Effect<Project, ProjectNotFoundError>;
    readonly byName: (name: string) => Effect.Effect<Project | null>;
    readonly list: () => Effect.Effect<ReadonlyArray<Project>>;
    /** The project's stance on the review-automation switches (cascade: settings → project). */
    readonly setAutomation: (
      id: ProjectId,
      choices: { readonly autoTour: AutomationChoice; readonly autoSuggest: AutomationChoice },
    ) => Effect.Effect<Project, ProjectNotFoundError>;
    /** Hard delete — sessions and everything under them cascade. */
    readonly remove: (id: ProjectId) => Effect.Effect<void>;
  }
>()("@mend/db/ProjectsRepo") {}

const toProject = (row: typeof projects.$inferSelect): Project => new Project(row);

export const ProjectsRepoLive: Layer.Layer<ProjectsRepo, never, MendDB | PgClient.PgClient> =
  Layer.effect(
    ProjectsRepo,
    Effect.gen(function* () {
      const db = yield* MendDB;
      const sql = yield* PgClient.PgClient;

      const create = Effect.fn("ProjectsRepo.create")(function* (project: NewProject) {
        const [row] = yield* db
          .insert(projects)
          .values({ id: ProjectId.make(crypto.randomUUID()), ...project })
          .returning()
          .pipe(Effect.orDie);
        if (row === undefined) return yield* Effect.die("project insert returned no row");
        const created = toProject(row);
        yield* notifyEvent(sql, { type: "project", projectId: created.id });
        return created;
      });

      const byId = Effect.fn("ProjectsRepo.byId")(function* (id: ProjectId) {
        const [row] = yield* db
          .select()
          .from(projects)
          .where(eq(projects.id, id))
          .limit(1)
          .pipe(Effect.orDie);
        if (row === undefined) return yield* new ProjectNotFoundError({ projectId: id });
        return toProject(row);
      });

      const byName = Effect.fn("ProjectsRepo.byName")(function* (name: string) {
        const [row] = yield* db
          .select()
          .from(projects)
          .where(eq(projects.name, name))
          .limit(1)
          .pipe(Effect.orDie);
        return row === undefined ? null : toProject(row);
      });

      const list = Effect.fn("ProjectsRepo.list")(function* () {
        const rows = yield* db
          .select()
          .from(projects)
          .orderBy(asc(projects.name))
          .pipe(Effect.orDie);
        return rows.map(toProject);
      });

      const setAutomation = Effect.fn("ProjectsRepo.setAutomation")(function* (
        id: ProjectId,
        choices: { readonly autoTour: AutomationChoice; readonly autoSuggest: AutomationChoice },
      ) {
        const [row] = yield* db
          .update(projects)
          .set({ ...choices, updatedAt: new Date() })
          .where(eq(projects.id, id))
          .returning()
          .pipe(Effect.orDie);
        if (row === undefined) return yield* new ProjectNotFoundError({ projectId: id });
        const updated = toProject(row);
        yield* notifyEvent(sql, { type: "project", projectId: id });
        return updated;
      });

      const remove = Effect.fn("ProjectsRepo.remove")(function* (id: ProjectId) {
        yield* db.delete(projects).where(eq(projects.id, id)).pipe(Effect.orDie);
        yield* notifyEvent(sql, { type: "project", projectId: id });
      });

      return { create, byId, byName, list, setAutomation, remove };
    }),
  );
