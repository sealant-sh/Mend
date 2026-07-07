import { PgClient } from "@effect/sql-pg";
import {
  FailureBrief,
  Run,
  RunId,
  type ChangeId,
  type IssueId,
  type RunKind,
  type RunOutcome,
  type RunStatus,
  type SealantRunId,
  type SealantWorkspaceId,
} from "@mend/domain";
import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";

import { notifyEvent } from "../events.ts";

export class RunNotFoundError extends Schema.TaggedErrorClass<RunNotFoundError>()(
  "RunNotFoundError",
  {
    runId: Schema.String,
  },
) {}

// pg returns bigint columns as strings; decode through the wire shape.
const RunRow = Schema.Struct({
  ...Run.fields,
  lastSeenSequence: Schema.BigIntFromString,
});
const decodeRun = Schema.decodeUnknownEffect(RunRow);

/**
 * The index of harness executions (ARCHITECTURE.md §3): status, outcome, and
 * the last-seen record sequence for crash-resume. The recording itself stays
 * in Sealant, addressed by `(sealantRunId, sequence)`.
 */
export class RunsRepo extends Context.Service<
  RunsRepo,
  {
    readonly create: (issueId: IssueId, kind: RunKind) => Effect.Effect<Run>;
    readonly byId: (id: RunId) => Effect.Effect<Run, RunNotFoundError>;
    readonly listForIssue: (issueId: IssueId) => Effect.Effect<ReadonlyArray<Run>>;
    /** Runs to re-attach to after a crash/restart. */
    readonly listUnsettled: () => Effect.Effect<ReadonlyArray<Run>>;
    readonly setSealantIds: (
      id: RunId,
      sealantRunId: SealantRunId,
      workspaceId: SealantWorkspaceId,
    ) => Effect.Effect<void>;
    readonly setStatus: (id: RunId, status: RunStatus) => Effect.Effect<void>;
    /** Ties a settled run to the change its recording is evidence for. */
    readonly linkChange: (id: RunId, changeId: ChangeId) => Effect.Effect<void>;
    readonly saveLastSeenSequence: (id: RunId, sequence: bigint) => Effect.Effect<void>;
    readonly settle: (
      id: RunId,
      outcome: RunOutcome,
      summary: string | null,
    ) => Effect.Effect<void>;
    /** The failure mini-brief, summed from the recording after a failed settle. */
    readonly saveFailureBrief: (id: RunId, brief: FailureBrief) => Effect.Effect<void>;
  }
>()("@mend/db/RunsRepo") {
  static readonly layer = Layer.effect(
    RunsRepo,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;

      const decodeRow = (row: unknown) =>
        decodeRun(row).pipe(
          Effect.map((decoded) => new Run(decoded)),
          Effect.orDie,
        );

      const create = Effect.fn("RunsRepo.create")(function* (issueId: IssueId, kind: RunKind) {
        const id = crypto.randomUUID();
        const rows = yield* sql`
          INSERT INTO runs (id, issue_id, kind)
          VALUES (${id}, ${issueId}, ${kind})
          RETURNING *`.pipe(Effect.orDie);
        const run = yield* decodeRow(rows[0]);
        yield* notifyEvent(sql, { type: "run", runId: run.id, issueId });
        return run;
      });

      const byId = Effect.fn("RunsRepo.byId")(function* (id: RunId) {
        const rows = yield* sql`SELECT * FROM runs WHERE id = ${id}`.pipe(Effect.orDie);
        const row = rows[0];
        if (row === undefined) return yield* new RunNotFoundError({ runId: id });
        return yield* decodeRow(row);
      });

      const listForIssue = Effect.fn("RunsRepo.listForIssue")(function* (issueId: IssueId) {
        const rows = yield* sql`
          SELECT * FROM runs WHERE issue_id = ${issueId}
          ORDER BY created_at DESC`.pipe(Effect.orDie);
        return yield* Effect.forEach(rows, decodeRow);
      });

      const listUnsettled = Effect.fn("RunsRepo.listUnsettled")(function* () {
        const rows = yield* sql`
          SELECT * FROM runs WHERE status IN ('queued', 'running')
          ORDER BY created_at ASC`.pipe(Effect.orDie);
        return yield* Effect.forEach(rows, decodeRow);
      });

      const setSealantIds = Effect.fn("RunsRepo.setSealantIds")(function* (
        id: RunId,
        sealantRunId: SealantRunId,
        workspaceId: SealantWorkspaceId,
      ) {
        yield* sql`
          UPDATE runs
          SET sealant_run_id = ${sealantRunId}, sealant_workspace_id = ${workspaceId}, updated_at = now()
          WHERE id = ${id}`.pipe(Effect.orDie);
      });

      const setStatus = Effect.fn("RunsRepo.setStatus")(function* (id: RunId, status: RunStatus) {
        yield* sql`
          UPDATE runs
          SET status = ${status},
              started_at = CASE WHEN ${status} = 'running' THEN now() ELSE started_at END,
              updated_at = now()
          WHERE id = ${id}`.pipe(Effect.orDie);
        const issueId = yield* issueIdOf(id);
        yield* notifyEvent(sql, { type: "run", runId: id, issueId });
      });

      const linkChange = Effect.fn("RunsRepo.linkChange")(function* (
        id: RunId,
        changeId: ChangeId,
      ) {
        yield* sql`
          UPDATE runs SET change_id = ${changeId}, updated_at = now()
          WHERE id = ${id}`.pipe(Effect.orDie);
      });

      const saveLastSeenSequence = Effect.fn("RunsRepo.saveLastSeenSequence")(function* (
        id: RunId,
        sequence: bigint,
      ) {
        yield* sql`
          UPDATE runs SET last_seen_sequence = ${String(sequence)}, updated_at = now()
          WHERE id = ${id} AND last_seen_sequence < ${String(sequence)}`.pipe(Effect.orDie);
      });

      const settle = Effect.fn("RunsRepo.settle")(function* (
        id: RunId,
        outcome: RunOutcome,
        summary: string | null,
      ) {
        yield* sql`
          UPDATE runs
          SET status = ${outcome}, outcome = ${outcome}, summary = ${summary},
              settled_at = now(), updated_at = now()
          WHERE id = ${id}`.pipe(Effect.orDie);
        const issueId = yield* issueIdOf(id);
        yield* notifyEvent(sql, { type: "run", runId: id, issueId });
      });

      const saveFailureBrief = Effect.fn("RunsRepo.saveFailureBrief")(function* (
        id: RunId,
        brief: FailureBrief,
      ) {
        const encoded = yield* Schema.encodeEffect(FailureBrief)(brief).pipe(Effect.orDie);
        yield* sql`
          UPDATE runs SET failure_brief = ${JSON.stringify(encoded)}::jsonb, updated_at = now()
          WHERE id = ${id}`.pipe(Effect.orDie);
        const issueId = yield* issueIdOf(id);
        yield* notifyEvent(sql, { type: "run", runId: id, issueId });
      });

      const issueIdOf = (id: RunId) =>
        sql`SELECT issue_id FROM runs WHERE id = ${id}`.pipe(
          Effect.orDie,
          Effect.map((rows) => {
            const row = rows[0] as { issueId: string } | undefined;
            return row?.issueId ?? "";
          }),
        );

      return {
        create,
        byId,
        listForIssue,
        listUnsettled,
        setSealantIds,
        setStatus,
        linkChange,
        saveLastSeenSequence,
        settle,
        saveFailureBrief,
      };
    }),
  );
}
