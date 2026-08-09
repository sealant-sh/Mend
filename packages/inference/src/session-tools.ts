import type { Change } from "@mend/domain/workbench";
import { SealantClient } from "@mend/sealant";
import { Store } from "@mend/store";
import { Effect, Schema, Stream } from "effect";

import { InferenceToolError, type InferenceTool } from "./provider.ts";
import { RecordingEvent } from "./tools.ts";
import { makeTool } from "./toolset.ts";

/** One read_recording call returns at most this many events — narrow with the selector. */
const MAX_RECORDING_EVENTS = 500;
/** A diff bigger than this is truncated in the tool result — the model is told. */
const MAX_DIFF_CHARS = 180_000;

const ReadChangeInput = Schema.Struct({});
const ReadRecordingInput = Schema.Struct({
  fromSequence: Schema.optional(Schema.NullOr(Schema.BigIntFromString)),
  toSequence: Schema.optional(Schema.NullOr(Schema.BigIntFromString)),
  kinds: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
});

const ChangeReadResult = Schema.Struct({
  branch: Schema.String,
  baseSha: Schema.String,
  files: Schema.Array(
    Schema.Struct({ path: Schema.String, additions: Schema.Int, deletions: Schema.Int }),
  ),
  diff: Schema.String,
  truncated: Schema.Boolean,
});

export interface SessionChangePass {
  readonly readChangeTool: InferenceTool;
  readonly readRecordingTool: InferenceTool;
  /** Sequences the model actually read in this pass — the noise filter's memory. */
  readonly seenSequences: ReadonlySet<string>;
  /** Paths read_change reported as changed — the only valid file anchors. */
  readonly changedPaths: ReadonlySet<string>;
}

/**
 * The session-scoped read tools every "Mend reads the change" pass shares
 * (finding drafts, the tour): no ids cross the tool boundary — the pass is
 * closed over ONE session's worktree and record, so the model cannot wander.
 * The pass object also carries what was actually read, which is what lets
 * writers enforce evidence discipline instead of requesting it politely.
 *
 * Built fresh per job (the seen/changed sets are the pass's memory); callers
 * capture their context at layer construction and provide it per call, the
 * comment-router pattern.
 */
export const makeSessionChangePass = (deps: {
  readonly worktree: string;
  readonly change: Change;
  readonly sealantRunId: string;
}): Effect.Effect<SessionChangePass, never, Store | SealantClient> =>
  Effect.gen(function* () {
    const store = yield* Store;
    const sealant = yield* SealantClient;
    const seenSequences = new Set<string>();
    const changedPaths = new Set<string>();

    const readChangeTool = makeTool({
      name: "read_change",
      description:
        "The session's change: unified diff of its worktree against the base, with per-file +/- counts. Takes no input.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      input: ReadChangeInput,
      run: () =>
        Effect.gen(function* () {
          const diff = yield* store.diffWorktree(deps.worktree, deps.change.baseSha);
          const files = yield* store.changedFiles(deps.worktree, deps.change.baseSha, null);
          for (const file of files) changedPaths.add(file.path);
          const truncated = diff.length > MAX_DIFF_CHARS;
          return {
            branch: deps.change.branch,
            baseSha: deps.change.baseSha,
            files,
            diff: truncated
              ? `${diff.slice(0, MAX_DIFF_CHARS)}\n… (diff truncated — ${diff.length} chars total; rely on the per-file counts for scope)`
              : diff,
            truncated,
          };
        }).pipe(
          Effect.mapError(
            (error) =>
              new InferenceToolError({
                tool: "read_change",
                message: `reading the change failed: ${String(error)}`,
              }),
          ),
        ),
      encode: (value) => Schema.encodeEffect(ChangeReadResult)(value).pipe(Effect.orDie),
    });

    const readRecordingTool = makeTool({
      name: "read_recording",
      description:
        "The session's durable record, oldest first. Returns at most 500 events; page with fromSequence, narrow with toSequence/kinds. processStarted/processExited carry commands and exit codes.",
      inputSchema: {
        type: "object",
        properties: {
          fromSequence: { type: ["string", "null"], description: "decimal string" },
          toSequence: { type: ["string", "null"], description: "decimal string" },
          kinds: { type: ["array", "null"], items: { type: "string" } },
        },
        additionalProperties: false,
      },
      input: ReadRecordingInput,
      run: (input) =>
        Effect.gen(function* () {
          const sdkRun = yield* sealant.getRun(deps.sealantRunId);
          const from = input.fromSequence ?? 0n;
          const to = input.toSequence ?? null;
          const kinds = input.kinds ?? null;
          const events = yield* sealant.recordTimeline(sdkRun, { from }).pipe(
            Stream.takeWhile((entry) => to === null || entry.sequence <= to),
            Stream.filter((entry) => (kinds === null ? true : kinds.includes(entry.kind))),
            Stream.take(MAX_RECORDING_EVENTS),
            Stream.map(
              (entry) =>
                new RecordingEvent({
                  sequence: entry.sequence,
                  kind: entry.kind,
                  occurredAt: new Date(entry.occurredAt),
                  summary: entry.summary,
                  // The runtime recorded every timeline entry — that is what observed means.
                  provenance: "observed",
                  data: entry.data,
                }),
            ),
            Stream.runCollect,
          );
          for (const event of events) seenSequences.add(event.sequence.toString());
          return events;
        }).pipe(
          Effect.mapError(
            (error) =>
              new InferenceToolError({
                tool: "read_recording",
                message: `reading the record failed: ${String(error)}`,
              }),
          ),
        ),
      encode: (value) =>
        Schema.encodeEffect(Schema.Array(RecordingEvent))([...value]).pipe(Effect.orDie),
    });

    return { readChangeTool, readRecordingTool, seenSequences, changedPaths };
  });
