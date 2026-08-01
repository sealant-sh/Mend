import { PgClient } from "@effect/sql-pg";
import { ProjectMountId, type ProjectId } from "@mend/domain";
import { ProjectMount } from "@mend/domain/workbench";
import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";

export class ProjectMountNotFoundError extends Schema.TaggedErrorClass<ProjectMountNotFoundError>()(
  "ProjectMountNotFoundError",
  {
    mountId: Schema.String,
  },
) {}

const decodeMount = Schema.decodeUnknownEffect(Schema.Struct(ProjectMount.fields));

export interface NewProjectMount {
  readonly projectId: ProjectId;
  readonly name: string;
  readonly hostPath: string;
  readonly readOnly: boolean;
}

/**
 * The per-project extra-mount declarations (plan §17, decided 2026-08-01).
 * Rows are declarations only — the host folders belong to the user and are
 * never provisioned or cleaned; the engine binds them at launch.
 */
export class ProjectMountsRepo extends Context.Service<
  ProjectMountsRepo,
  {
    readonly create: (mount: NewProjectMount) => Effect.Effect<ProjectMount>;
    readonly byId: (id: ProjectMountId) => Effect.Effect<ProjectMount, ProjectMountNotFoundError>;
    readonly listForProject: (projectId: ProjectId) => Effect.Effect<ReadonlyArray<ProjectMount>>;
    readonly remove: (id: ProjectMountId) => Effect.Effect<void>;
  }
>()("@mend/db/ProjectMountsRepo") {
  static readonly layer = Layer.effect(
    ProjectMountsRepo,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;

      const decodeRow = (row: unknown) =>
        decodeMount(row).pipe(
          Effect.map((decoded) => new ProjectMount(decoded)),
          Effect.orDie,
        );

      const create = Effect.fn("ProjectMountsRepo.create")(function* (mount: NewProjectMount) {
        const id = crypto.randomUUID();
        const rows = yield* sql`
          INSERT INTO project_mounts (id, project_id, name, host_path, read_only)
          VALUES (${id}, ${mount.projectId}, ${mount.name}, ${mount.hostPath}, ${mount.readOnly})
          RETURNING *`.pipe(Effect.orDie);
        return yield* decodeRow(rows[0]);
      });

      const byId = Effect.fn("ProjectMountsRepo.byId")(function* (id: ProjectMountId) {
        const rows = yield* sql`SELECT * FROM project_mounts WHERE id = ${id}`.pipe(Effect.orDie);
        const row = rows[0];
        if (row === undefined) return yield* new ProjectMountNotFoundError({ mountId: id });
        return yield* decodeRow(row);
      });

      const listForProject = Effect.fn("ProjectMountsRepo.listForProject")(function* (
        projectId: ProjectId,
      ) {
        const rows = yield* sql`
          SELECT * FROM project_mounts WHERE project_id = ${projectId}
          ORDER BY name ASC`.pipe(Effect.orDie);
        return yield* Effect.forEach(rows, decodeRow);
      });

      const remove = Effect.fn("ProjectMountsRepo.remove")(function* (id: ProjectMountId) {
        yield* sql`DELETE FROM project_mounts WHERE id = ${id}`.pipe(Effect.orDie);
      });

      return { create, byId, listForProject, remove };
    }),
  );
}
