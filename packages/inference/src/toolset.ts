import {
  Brief,
  BriefDocument,
  ChangeId,
  IssueId,
  RunId,
  type InferenceToolName,
} from "@mend/domain";
import { Effect, Schema } from "effect";

import { InferenceToolError, type InferenceTool, type ToolInputSchema } from "./provider.ts";
import {
  ChangeView,
  IssueView,
  PublishBrief,
  ReadBrief,
  ReadChange,
  ReadIssue,
  ReadRecording,
  RecordingEvent,
  RecordingSelector,
} from "./tools.ts";

/**
 * Adapts the tool service contracts into `InferenceTool` values for the
 * provider's loop: wire input in, decoded call, JSON-safe output back. A
 * context gets only the tools it needs — assembled here, never the full set.
 */

const decodeFailed = (tool: InferenceToolName, error: { readonly message: string }) =>
  new InferenceToolError({ tool, message: `input did not match the schema: ${error.message}` });

/** Decode wire input, run the call, encode the result for the transcript. */
const makeTool = <I, A>(options: {
  readonly name: InferenceToolName;
  readonly description: string;
  readonly inputSchema: ToolInputSchema;
  readonly input: Schema.Codec<I, unknown>;
  readonly run: (input: I) => Effect.Effect<A, InferenceToolError>;
  readonly encode: (value: A) => Effect.Effect<unknown, InferenceToolError>;
}): InferenceTool => ({
  name: options.name,
  description: options.description,
  inputSchema: options.inputSchema,
  handle: (raw) =>
    Schema.decodeUnknownEffect(options.input)(raw).pipe(
      Effect.mapError((error) => decodeFailed(options.name, error)),
      Effect.flatMap(options.run),
      Effect.flatMap(options.encode),
    ),
});

/** Encoding our own values must succeed; a failure there is a defect, not a tool error. */
const encodeWith =
  <A, E>(codec: Schema.Codec<A, E>) =>
  (value: A): Effect.Effect<unknown, InferenceToolError> =>
    Schema.encodeEffect(codec)(value).pipe(Effect.orDie);

// ─── Wire inputs ─────────────────────────────────────────────────────────────

const ReadRecordingInput = Schema.Struct({
  run: RunId,
  fromSequence: Schema.optional(Schema.NullOr(Schema.BigIntFromString)),
  toSequence: Schema.optional(Schema.NullOr(Schema.BigIntFromString)),
  kinds: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  sourcesOnly: Schema.optional(Schema.NullOr(Schema.Boolean)),
});

const ReadIssueInput = Schema.Struct({ issue: IssueId });
const ChangeInput = Schema.Struct({ change: ChangeId });
const PublishBriefInput = Schema.Struct({ change: ChangeId, document: BriefDocument });

const RECORDING_KINDS = [
  "runtimeStateChanged",
  "runtimeHeartbeat",
  "processStarted",
  "processExited",
  "ioChunk",
  "telemetryDropped",
  "fileChange",
  "fileWatchOverflow",
  "fileSnapshotCompleted",
  "fileDiffAvailable",
  "networkRequest",
  "networkSourceObserved",
];

const readRecordingSchema: ToolInputSchema = {
  type: "object",
  properties: {
    run: { type: "string", description: "The run id whose recording to read." },
    fromSequence: {
      type: ["string", "null"],
      description: "Start at this sequence (decimal string), inclusive.",
    },
    toSequence: {
      type: ["string", "null"],
      description: "Stop after this sequence (decimal string), inclusive.",
    },
    kinds: {
      type: ["array", "null"],
      items: { type: "string", enum: RECORDING_KINDS },
      description: "Keep only these event kinds; omit for all.",
    },
    sourcesOnly: {
      type: ["boolean", "null"],
      description: "Only the source trail (network events).",
    },
  },
  required: ["run"],
  additionalProperties: false,
};

// ─── The per-context tool sets (PRODUCT.md, "Which contexts get which tools") ─

const readRecordingTool = (readRecording: {
  readonly read: (
    run: RunId,
    selector?: RecordingSelector,
  ) => Effect.Effect<ReadonlyArray<RecordingEvent>, InferenceToolError>;
}) =>
  makeTool({
    name: "read_recording",
    description:
      "Read the recording of one run — the only permitted source of claims. Returns timeline " +
      "events (sequence, kind, one-line summary, typed data), every one `observed` by the " +
      "runtime. The full trace is large: narrow with fromSequence/toSequence/kinds, or " +
      "sourcesOnly for the network-source trail. At most 500 events per call — page with " +
      "fromSequence.",
    inputSchema: readRecordingSchema,
    input: ReadRecordingInput,
    run: (input) =>
      readRecording.read(
        input.run,
        new RecordingSelector({
          fromSequence: input.fromSequence ?? null,
          toSequence: input.toSequence ?? null,
          kinds: input.kinds ?? null,
          sourcesOnly: input.sourcesOnly ?? false,
        }),
      ),
    encode: encodeWith(Schema.Array(RecordingEvent)),
  });

/**
 * Brief compilation: the read set plus `publish_brief`. Returns the tools
 * bound to the live services in context.
 */
export const briefCompilationTools: Effect.Effect<
  ReadonlyArray<InferenceTool>,
  never,
  ReadRecording | ReadIssue | ReadChange | ReadBrief | PublishBrief
> = Effect.gen(function* () {
  const readRecording = yield* ReadRecording;
  const readIssue = yield* ReadIssue;
  const readChange = yield* ReadChange;
  const readBrief = yield* ReadBrief;
  const publishBrief = yield* PublishBrief;

  const documentJsonSchema = Schema.toJsonSchemaDocument(BriefDocument);

  return [
    readRecordingTool(readRecording),
    makeTool({
      name: "read_issue",
      description:
        "The tracker issue, normalized: title, body, comments, links. Use it to restate the " +
        "issue and to read what was actually asked.",
      inputSchema: {
        type: "object",
        properties: { issue: { type: "string", description: "The issue id." } },
        required: ["issue"],
        additionalProperties: false,
      },
      input: ReadIssueInput,
      run: (input) => readIssue.read(input.issue),
      encode: encodeWith(IssueView),
    }),
    makeTool({
      name: "read_change",
      description:
        "Machine facts about the change: the unified diff, per-file additions/deletions, shas, " +
        "check results, freshness. The source for mono facts and for spotting edits with no " +
        "cause in the recording (`unrelated change`).",
      inputSchema: {
        type: "object",
        properties: { change: { type: "string", description: "The change id." } },
        required: ["change"],
        additionalProperties: false,
      },
      input: ChangeInput,
      run: (input) => readChange.read(input.change),
      encode: encodeWith(ChangeView),
    }),
    makeTool({
      name: "read_brief",
      description:
        "The current living brief for the change, when one exists. Recompiles must amend this " +
        "document, not start over. Errors when no brief exists yet (the first compile).",
      inputSchema: {
        type: "object",
        properties: { change: { type: "string", description: "The change id." } },
        required: ["change"],
        additionalProperties: false,
      },
      input: ChangeInput,
      run: (input) => readBrief.read(input.change),
      encode: encodeWith(Brief),
    }),
    makeTool({
      name: "publish_brief",
      description:
        "Replace the living brief for the change with this document. Prior versions stay in " +
        "history. Publish exactly once, after every claim in the document is grounded.",
      inputSchema: {
        type: "object",
        properties: {
          change: { type: "string", description: "The change id." },
          document: documentJsonSchema.schema,
        },
        required: ["change", "document"],
        additionalProperties: false,
        ...(Object.keys(documentJsonSchema.definitions).length === 0
          ? {}
          : { $defs: documentJsonSchema.definitions }),
      },
      input: PublishBriefInput,
      run: (input) => publishBrief.publish(input.change, input.document),
      encode: (value) => Effect.succeed(value),
    }),
  ];
});

/**
 * Failure comment: `read_recording` only today — the mini-brief renders
 * in-app; `post_issue_comment` joins the set when trackers land (M3).
 */
export const failureCommentTools: Effect.Effect<
  ReadonlyArray<InferenceTool>,
  never,
  ReadRecording
> = Effect.gen(function* () {
  const readRecording = yield* ReadRecording;
  return [readRecordingTool(readRecording)];
});
