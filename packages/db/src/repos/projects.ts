import { PgClient } from "@effect/sql-pg";
import { ProjectId, type Sha } from "@mend/domain";
import { Project } from "@mend/domain/workbench";
import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";

import { notifyEvent } from "../events.ts";

export class ProjectNotFoundError extends Schema.TaggedErrorClass<ProjectNotFoundError>()(
  "ProjectNotFoundError",
  {
    projectId: Schema.String,
  },
) {}

const decodeProject = Schema.decodeUnknownEffect(Schema.Struct(Project.fields));

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
    /** Hard delete — sessions and everything under them cascade. */
    readonly remove: (id: ProjectId) => Effect.Effect<void>;
  }
>()("@mend/db/ProjectsRepo") {
  static readonly layer = Layer.effect(
    ProjectsRepo,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;

      const decodeRow = (row: unknown) =>
        decodeProject(row).pipe(
          Effect.map((decoded) => new Project(decoded)),
          Effect.orDie,
        );

      const create = Effect.fn("ProjectsRepo.create")(function* (project: NewProject) {
        const id = crypto.randomUUID();
        const rows = yield* sql`
          INSERT INTO projects (id, name, origin_url, store_path, default_branch, adopted_sha)
          VALUES (${id}, ${project.name}, ${project.originUrl}, ${project.storePath},
                  ${project.defaultBranch}, ${project.adoptedSha})
          RETURNING *`.pipe(Effect.orDie);
        const created = yield* decodeRow(rows[0]);
        yield* notifyEvent(sql, { type: "project", projectId: created.id });
        return created;
      });

      const byId = Effect.fn("ProjectsRepo.byId")(function* (id: ProjectId) {
        const rows = yield* sql`SELECT * FROM projects WHERE id = ${id}`.pipe(Effect.orDie);
        const row = rows[0];
        if (row === undefined) return yield* new ProjectNotFoundError({ projectId: id });
        return yield* decodeRow(row);
      });

      const byName = Effect.fn("ProjectsRepo.byName")(function* (name: string) {
        const rows = yield* sql`SELECT * FROM projects WHERE name = ${name}`.pipe(Effect.orDie);
        const row = rows[0];
        return row === undefined ? null : yield* decodeRow(row);
      });

      const list = Effect.fn("ProjectsRepo.list")(function* () {
        const rows = yield* sql`SELECT * FROM projects ORDER BY name ASC`.pipe(Effect.orDie);
        return yield* Effect.forEach(rows, decodeRow);
      });

      const remove = Effect.fn("ProjectsRepo.remove")(function* (id: ProjectId) {
        yield* sql`DELETE FROM projects WHERE id = ${id}`.pipe(Effect.orDie);
        yield* notifyEvent(sql, { type: "project", projectId: id });
      });

      return { create, byId, byName, list, remove };
    }),
  );
}
