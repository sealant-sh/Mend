import { ProjectsRepo, ReviewCommentsRepo, SessionChangesRepo, SessionsRepo } from "@mend/db";
import { ChangeId } from "@mend/domain";
import { RecordLink } from "@mend/domain/workbench";
import { SealantClient } from "@mend/sealant";
import { Store, worktreePathOf } from "@mend/store";
import { Effect, Layer, Schema, Stream } from "effect";
import * as Context from "effect/Context";

import {
  InferenceError,
  InferenceProvider,
  InferenceToolError,
  type InferenceTool,
} from "./provider.ts";
import { RecordingEvent } from "./tools.ts";
import { makeTool } from "./toolset.ts";

/** The `read-change` job's payload — on-demand from the review page (§7.3). */
export class ReadChangeJob extends Schema.Class<ReadChangeJob>("ReadChangeJob")({
  changeId: ChangeId,
}) {}

/** One read_recording call returns at most this many events — narrow with the selector. */
const MAX_RECORDING_EVENTS = 500;
/** A diff bigger than this is truncated in the tool result — the model is told. */
const MAX_DIFF_CHARS = 180_000;

/**
 * "Mend reads the change" (plan §7.3): the machine review pass over a settled
 * session change. Output is draft review comments — dispositions and evidence
 * links, never verdicts. The evidential noise filter is enforced at the tool
 * boundary, not requested in the prompt: draft_finding rejects any finding
 * whose evidence does not cite a sequence the model actually read in this
 * pass, so an invented pointer cannot land.
 */
const SYSTEM = `You read a settled code change for its author's reviewer, grounded in the session record that produced it. You are Mend's interface inference — you phrase and organize evidence; you cannot mint claims.

Rules a finding never breaks:
- Evidence, not verdicts. You describe what was observed and what was not; you never grade, approve, or recommend. No "LGTM", no severity scores.
- Every finding cites the record. draft_finding requires evidence pointers — sequences you actually read via read_recording in this pass, each with a one-line excerpt. A finding you cannot ground is not emitted; if the gap itself is the observation ("this function was rewritten and nothing exercising it ran"), the evidence is the events that show what DID run.
- Dispositions are earned. "direct-evidence" only when the record contains the event you point to. A path never exercised is "not-executed". An edit in the diff with no cause in the record is "unrelated-change". Nothing defaults to green.
- Findings a diff-only reviewer could write are worth less than findings only the record supports: rewritten-but-never-exercised code, edits with no visible cause, checks that were started and never finished, instructions in the record the diff contradicts.
- Do not restate existing comments — they are given to you; skip anything already covered.
- Zero findings is a legitimate outcome. When the record grounds nothing worth a reviewer's attention, write none and say so in one sentence.

The register — terse, enforced at the tool boundary:
  body ≤ 500 chars (the observation and why it matters; the detail stays behind the evidence pointers).
  Each excerpt ≤ 200 chars (one line — the event's summary or the relevant fragment).

Method:
1. read_change — the diff and per-file counts for this session's worktree against its base.
2. read_recording — work through the record (page and narrow with the selector; processStarted/processExited carry commands and exit codes). Match edits in the diff to their cause in the record; note what ran and what never did.
3. draft_finding — one call per finding, anchored to a file (and line range when the diff pinpoints one) or change-level when it spans files. Typically 0-5 findings; each lands as a draft comment the reviewer accepts, edits, or dismisses.
4. Finish with one short sentence: how many findings and the single most important one, or why there are none.

Sequences are decimal strings.`;

const Disposition = Schema.Literals(["direct-evidence", "not-executed", "unrelated-change"]);

const ReadChangeInput = Schema.Struct({});
const ReadRecordingInput = Schema.Struct({
  fromSequence: Schema.optional(Schema.NullOr(Schema.BigIntFromString)),
  toSequence: Schema.optional(Schema.NullOr(Schema.BigIntFromString)),
  kinds: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
});
const DraftFindingInput = Schema.Struct({
  /** Null file = change-level finding. */
  file: Schema.NullOr(Schema.String),
  line: Schema.optional(Schema.NullOr(Schema.Int)),
  endLine: Schema.optional(Schema.NullOr(Schema.Int)),
  body: Schema.String,
  disposition: Disposition,
  evidence: Schema.Array(
    Schema.Struct({ sequence: Schema.BigIntFromString, excerpt: Schema.String }),
  ),
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

const FindingResult = Schema.Struct({ recorded: Schema.Boolean, commentId: Schema.String });

const failed = (message: string) => new InferenceError({ message, cause: null });
const reject = (message: string) =>
  Effect.fail(new InferenceToolError({ tool: "draft_finding", message }));

export class ChangeReader extends Context.Service<
  ChangeReader,
  {
    readonly read: (job: ReadChangeJob) => Effect.Effect<void, InferenceError>;
  }
>()("@mend/inference/ChangeReader") {
  static readonly layer = Layer.effect(
    ChangeReader,
    Effect.gen(function* () {
      const provider = yield* InferenceProvider;
      const changes = yield* SessionChangesRepo;
      const sessions = yield* SessionsRepo;
      const projects = yield* ProjectsRepo;
      const comments = yield* ReviewCommentsRepo;
      const sealant = yield* SealantClient;
      const store = yield* Store;

      const read = Effect.fn("ChangeReader.read")(function* (job: ReadChangeJob) {
        const change = yield* changes
          .byId(job.changeId)
          .pipe(Effect.mapError(() => failed(`no change ${job.changeId}`)));
        const session = yield* sessions
          .byId(change.sessionId)
          .pipe(Effect.mapError(() => failed(`no session ${change.sessionId}`)));
        const project = yield* projects
          .byId(change.projectId)
          .pipe(Effect.mapError(() => failed(`no project ${change.projectId}`)));
        if (session.sealantRunId === null) {
          return yield* failed(
            "the session has no record (it never launched supervised) — nothing to ground findings in",
          );
        }
        const sealantRunId = session.sealantRunId;
        const worktree = worktreePathOf(project.storePath, session.worktree);

        const existing = yield* comments.listForChange(job.changeId);
        const changedPaths = new Set<string>();

        // The noise filter's memory: sequences the model has actually read
        // in THIS pass. draft_finding refuses to cite anything else.
        const seenSequences = new Set<string>();

        const readChangeTool: InferenceTool = makeTool({
          name: "read_change",
          description:
            "The session's change: unified diff of its worktree against the base, with per-file +/- counts. Takes no input.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          input: ReadChangeInput,
          run: () =>
            Effect.gen(function* () {
              const diff = yield* store.diffWorktree(worktree, change.baseSha);
              const files = yield* store.changedFiles(worktree, change.baseSha, null);
              for (const file of files) changedPaths.add(file.path);
              const truncated = diff.length > MAX_DIFF_CHARS;
              return {
                branch: change.branch,
                baseSha: change.baseSha,
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

        const readRecordingTool: InferenceTool = makeTool({
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
              const sdkRun = yield* sealant.getRun(sealantRunId);
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

        let findingsWritten = 0;
        const draftFindingTool: InferenceTool = makeTool({
          name: "draft_finding",
          description:
            "Record one finding as a draft review comment the reviewer will accept, edit, or dismiss. Evidence is required and every cited sequence must be one you actually read via read_recording in this pass.",
          inputSchema: {
            type: "object",
            properties: {
              file: {
                type: ["string", "null"],
                description: "a changed file's path, or null for a change-level finding",
              },
              line: { type: ["integer", "null"] },
              endLine: { type: ["integer", "null"] },
              body: { type: "string", description: "≤500 chars" },
              disposition: {
                type: "string",
                enum: ["direct-evidence", "not-executed", "unrelated-change"],
              },
              evidence: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    sequence: { type: "string", description: "decimal string" },
                    excerpt: { type: "string", description: "≤200 chars" },
                  },
                  required: ["sequence", "excerpt"],
                  additionalProperties: false,
                },
              },
            },
            required: ["file", "body", "disposition", "evidence"],
            additionalProperties: false,
          },
          input: DraftFindingInput,
          run: (input) =>
            Effect.gen(function* () {
              // The evidential noise filter (plan §7.3, hard rule): no record
              // link, no finding. Cited sequences must have been read here.
              if (input.evidence.length === 0) {
                return yield* reject(
                  "a finding without a record link is not emitted — cite sequences you read via read_recording",
                );
              }
              const unseen = input.evidence.filter(
                (pointer) => !seenSequences.has(pointer.sequence.toString()),
              );
              if (unseen.length > 0) {
                return yield* reject(
                  `evidence cites sequences this pass never read: ${unseen.map((p) => p.sequence.toString()).join(", ")} — read them via read_recording first, or drop them`,
                );
              }
              if (input.body.length > 500) {
                return yield* reject(
                  `body is ${input.body.length} chars — the register caps it at 500; state the observation once and let the evidence carry the detail`,
                );
              }
              const overlong = input.evidence.filter((pointer) => pointer.excerpt.length > 200);
              if (overlong.length > 0) {
                return yield* reject("excerpts cap at 200 chars — quote the relevant fragment");
              }
              if (input.file !== null && !changedPaths.has(input.file)) {
                return yield* reject(
                  `"${input.file}" is not in this change — anchor to a changed file from read_change, or use null for change-level`,
                );
              }
              const created = yield* comments.create({
                changeId: job.changeId,
                file: input.file,
                line: input.file === null ? null : (input.line ?? null),
                endLine: input.file === null ? null : (input.endLine ?? null),
                authorKind: "mend",
                authorName: "Mend",
                body: input.body,
                state: "draft",
                evidence: input.evidence.map(
                  (pointer) =>
                    new RecordLink({
                      sealantRunId,
                      sequence: pointer.sequence,
                      excerpt: pointer.excerpt,
                    }),
                ),
              });
              findingsWritten += 1;
              return { recorded: true, commentId: created.id };
            }),
          encode: (value) => Schema.encodeEffect(FindingResult)(value).pipe(Effect.orDie),
        });

        const existingSummary =
          existing.length === 0
            ? "none"
            : existing
                .map(
                  (comment) =>
                    `- ${comment.authorKind} · ${comment.state} · ${comment.file ?? "change-level"}${comment.line === null ? "" : `:${comment.line}`} · ${comment.body.slice(0, 120)}`,
                )
                .join("\n");

        yield* provider.respond({
          context: "change-reading",
          system: SYSTEM,
          prompt:
            `Read the change for session ${session.id} (${session.harness}, branch ${change.branch}). ` +
            `The session settled "${session.status}"${session.summary === null ? "" : ` — its own summary: ${session.summary.slice(0, 300)}`}.\n\n` +
            `Existing comments on this change (do not restate):\n${existingSummary}\n\n` +
            `Start with read_change.`,
          tools: [readChangeTool, readRecordingTool, draftFindingTool],
        });

        // Zero findings is legitimate; the pass itself completing is success.
        yield* Effect.annotateLogs(Effect.logInfo("change read complete"), {
          changeId: job.changeId,
          findingsWritten,
        });
      });

      return { read };
    }),
  );
}
