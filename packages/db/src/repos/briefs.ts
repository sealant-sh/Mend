import { PgClient } from "@effect/sql-pg";
import { Brief, BriefDocument, BriefId, BriefVersion, type ChangeId } from "@mend/domain";
import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";

import { notifyEvent } from "../events.ts";

export class BriefNotFoundError extends Schema.TaggedErrorClass<BriefNotFoundError>()(
  "BriefNotFoundError",
  {
    changeId: Schema.String,
  },
) {}

const decodeBrief = Schema.decodeUnknownEffect(Brief);
const decodeVersion = Schema.decodeUnknownEffect(BriefVersion);
const encodeDocument = Schema.encodeEffect(BriefDocument);

/**
 * The living document (ARCHITECTURE.md §3): one brief per change, replaced
 * whole on every publish, prior versions kept so "what did the brief claim
 * when I approved" stays answerable. Documents are stored encoded (sequences
 * as decimal strings) — readable without a Sealant round-trip, forever.
 */
export class BriefsRepo extends Context.Service<
  BriefsRepo,
  {
    readonly byChange: (changeId: ChangeId) => Effect.Effect<Brief, BriefNotFoundError>;
    readonly versions: (changeId: ChangeId) => Effect.Effect<ReadonlyArray<BriefVersion>>;
    /** Replaces the living brief; the review questions index follows the document. */
    readonly publish: (
      changeId: ChangeId,
      document: BriefDocument,
    ) => Effect.Effect<{ readonly version: number }>;
  }
>()("@mend/db/BriefsRepo") {
  static readonly layer = Layer.effect(
    BriefsRepo,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;

      const decodeBriefRow = (row: unknown) =>
        decodeBrief(row).pipe(
          Effect.map((decoded) => new Brief(decoded)),
          Effect.orDie,
        );

      const byChange = Effect.fn("BriefsRepo.byChange")(function* (changeId: ChangeId) {
        const rows = yield* sql`SELECT * FROM briefs WHERE change_id = ${changeId}`.pipe(
          Effect.orDie,
        );
        const row = rows[0];
        if (row === undefined) return yield* new BriefNotFoundError({ changeId });
        return yield* decodeBriefRow(row);
      });

      const versions = Effect.fn("BriefsRepo.versions")(function* (changeId: ChangeId) {
        const rows = yield* sql`
          SELECT v.* FROM brief_versions v
          JOIN briefs b ON b.id = v.brief_id
          WHERE b.change_id = ${changeId}
          ORDER BY v.version DESC`.pipe(Effect.orDie);
        return yield* Effect.forEach(rows, (row) =>
          decodeVersion(row).pipe(
            Effect.map((decoded) => new BriefVersion(decoded)),
            Effect.orDie,
          ),
        );
      });

      const publish = Effect.fn("BriefsRepo.publish")(function* (
        changeId: ChangeId,
        document: BriefDocument,
      ) {
        const encoded = yield* encodeDocument(document).pipe(Effect.orDie);
        const briefId = BriefId.make(crypto.randomUUID());

        const version = yield* sql
          .withTransaction(
            Effect.gen(function* () {
              const rows = yield* sql`
              INSERT INTO briefs (id, change_id, current_version, document)
              VALUES (${briefId}, ${changeId}, 1, ${sql.json(encoded)})
              ON CONFLICT (change_id) DO UPDATE
              SET current_version = briefs.current_version + 1,
                  document = EXCLUDED.document,
                  updated_at = now()
              RETURNING id, current_version`;
              const row = rows[0] as { readonly id: string; readonly currentVersion: number };

              yield* sql`
              INSERT INTO brief_versions (brief_id, version, document)
              VALUES (${row.id}, ${row.currentVersion}, ${sql.json(encoded)})`;

              // The index over the document's questions — replaced with it.
              yield* sql`DELETE FROM review_questions WHERE brief_id = ${row.id}`;
              for (const question of document.questions) {
                yield* sql`
                INSERT INTO review_questions (id, brief_id, index, question, disposition, evidence)
                VALUES (${crypto.randomUUID()}, ${row.id}, ${question.index}, ${question.question},
                        ${question.disposition}, ${sql.json(serializeEvidence(question))})`;
              }

              return row.currentVersion;
            }),
          )
          .pipe(Effect.orDie);

        const issueId = yield* issueIdOf(changeId);
        yield* notifyEvent(sql, { type: "brief", changeId, issueId });
        return { version };
      });

      const issueIdOf = (changeId: ChangeId) =>
        sql`SELECT issue_id FROM changes WHERE id = ${changeId}`.pipe(
          Effect.orDie,
          Effect.map((rows) => {
            const row = rows[0] as { issueId: string } | undefined;
            return row?.issueId ?? "";
          }),
        );

      return { byChange, versions, publish };
    }),
  );
}

/** Evidence pointers, JSON-safe (sequences as decimal strings). */
const serializeEvidence = (question: {
  readonly evidence: ReadonlyArray<{
    readonly runId: string;
    readonly sequence: bigint;
    readonly excerpt: string;
  }>;
}) =>
  question.evidence.map((pointer) => ({
    runId: pointer.runId,
    sequence: String(pointer.sequence),
    excerpt: pointer.excerpt,
  }));
