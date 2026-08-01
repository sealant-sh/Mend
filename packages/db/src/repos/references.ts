import { PgClient } from "@effect/sql-pg";
import { ReferenceId, type ProjectId, type Sha } from "@mend/domain";
import { Reference } from "@mend/domain/workbench";
import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";

export class ReferenceNotFoundError extends Schema.TaggedErrorClass<ReferenceNotFoundError>()(
  "ReferenceNotFoundError",
  {
    referenceId: Schema.String,
  },
) {}

const decodeReference = Schema.decodeUnknownEffect(Schema.Struct(Reference.fields));

export interface NewReference {
  readonly name: string;
  readonly originUrl: string;
  readonly path: string;
  readonly pinnedRef: string | null;
  readonly headSha: Sha | null;
}

/**
 * The index of reference clones (plan §17, decided 2026-08-01) — table
 * `reference_repos` (`references` is reserved SQL). The clones themselves are
 * git on disk under the store's `_references/`; selection is per project.
 */
export class ReferencesRepo extends Context.Service<
  ReferencesRepo,
  {
    readonly create: (reference: NewReference) => Effect.Effect<Reference>;
    readonly byId: (id: ReferenceId) => Effect.Effect<Reference, ReferenceNotFoundError>;
    readonly byName: (name: string) => Effect.Effect<Reference | null>;
    readonly list: () => Effect.Effect<ReadonlyArray<Reference>>;
    readonly remove: (id: ReferenceId) => Effect.Effect<void>;
    /** After a refresh: the clone's HEAD as just observed. */
    readonly setHead: (id: ReferenceId, headSha: Sha) => Effect.Effect<void>;
    /** The references this project's sessions mount, in name order. */
    readonly listForProject: (projectId: ProjectId) => Effect.Effect<ReadonlyArray<Reference>>;
    /** Replace the project's selection wholesale — the UI edits it as a set. */
    readonly setForProject: (
      projectId: ProjectId,
      referenceIds: ReadonlyArray<ReferenceId>,
    ) => Effect.Effect<void>;
  }
>()("@mend/db/ReferencesRepo") {
  static readonly layer = Layer.effect(
    ReferencesRepo,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;

      const decodeRow = (row: unknown) =>
        decodeReference(row).pipe(
          Effect.map((decoded) => new Reference(decoded)),
          Effect.orDie,
        );

      const create = Effect.fn("ReferencesRepo.create")(function* (reference: NewReference) {
        const id = crypto.randomUUID();
        const rows = yield* sql`
          INSERT INTO reference_repos (id, name, origin_url, path, pinned_ref, head_sha,
                                       refreshed_at)
          VALUES (${id}, ${reference.name}, ${reference.originUrl}, ${reference.path},
                  ${reference.pinnedRef}, ${reference.headSha}, now())
          RETURNING *`.pipe(Effect.orDie);
        return yield* decodeRow(rows[0]);
      });

      const byId = Effect.fn("ReferencesRepo.byId")(function* (id: ReferenceId) {
        const rows = yield* sql`SELECT * FROM reference_repos WHERE id = ${id}`.pipe(Effect.orDie);
        const row = rows[0];
        if (row === undefined) return yield* new ReferenceNotFoundError({ referenceId: id });
        return yield* decodeRow(row);
      });

      const byName = Effect.fn("ReferencesRepo.byName")(function* (name: string) {
        const rows = yield* sql`SELECT * FROM reference_repos WHERE name = ${name}`.pipe(
          Effect.orDie,
        );
        const row = rows[0];
        return row === undefined ? null : yield* decodeRow(row);
      });

      const list = Effect.fn("ReferencesRepo.list")(function* () {
        const rows = yield* sql`SELECT * FROM reference_repos ORDER BY name ASC`.pipe(Effect.orDie);
        return yield* Effect.forEach(rows, decodeRow);
      });

      const remove = Effect.fn("ReferencesRepo.remove")(function* (id: ReferenceId) {
        yield* sql`DELETE FROM reference_repos WHERE id = ${id}`.pipe(Effect.orDie);
      });

      const setHead = Effect.fn("ReferencesRepo.setHead")(function* (id: ReferenceId, head: Sha) {
        yield* sql`
          UPDATE reference_repos
          SET head_sha = ${head}, refreshed_at = now(), updated_at = now()
          WHERE id = ${id}`.pipe(Effect.orDie);
      });

      const listForProject = Effect.fn("ReferencesRepo.listForProject")(function* (
        projectId: ProjectId,
      ) {
        const rows = yield* sql`
          SELECT r.* FROM reference_repos r
          JOIN project_references pr ON pr.reference_id = r.id
          WHERE pr.project_id = ${projectId}
          ORDER BY r.name ASC`.pipe(Effect.orDie);
        return yield* Effect.forEach(rows, decodeRow);
      });

      const setForProject = Effect.fn("ReferencesRepo.setForProject")(function* (
        projectId: ProjectId,
        referenceIds: ReadonlyArray<ReferenceId>,
      ) {
        yield* sql`DELETE FROM project_references WHERE project_id = ${projectId}`.pipe(
          Effect.orDie,
        );
        yield* Effect.forEach(
          referenceIds,
          (referenceId) =>
            sql`
              INSERT INTO project_references (project_id, reference_id)
              VALUES (${projectId}, ${referenceId})
              ON CONFLICT DO NOTHING`.pipe(Effect.orDie),
          { discard: true },
        );
      });

      return { create, byId, byName, list, remove, setHead, listForProject, setForProject };
    }),
  );
}
