import { describe, expect, it } from "@effect/vitest";
import { BriefNotFoundError, BriefsRepo, RunNotFoundError, RunsRepo } from "@mend/db";
import {
  Brief,
  BriefDocument,
  BriefId,
  ChangeId,
  IssueId,
  RunId,
  type BriefVersion,
  type Run,
} from "@mend/domain";
import { Effect, Layer, Schema } from "effect";

import { BriefCompiler, CompileBriefJob } from "./brief-compiler.ts";
import {
  InferenceError,
  InferenceProvider,
  InferenceToolError,
  type InferenceRequest,
} from "./provider.ts";
import {
  IssueView,
  PublishBrief,
  ReadBrief,
  ReadChange,
  ReadIssue,
  ReadRecording,
} from "./tools.ts";

const changeId = ChangeId.make("22222222-2222-2222-2222-222222222222");
const issueId = IssueId.make("33333333-3333-3333-3333-333333333333");
const runId = RunId.make("44444444-4444-4444-4444-444444444444");

const job = new CompileBriefJob({ issueId, changeId, runId });

/** A publish_brief input as the model would send it — sequences as strings. */
const wireDocument = {
  header: {
    repository: "acme/app",
    prRef: null,
    issueRef: "manual",
    checksCount: null,
    headSha: null,
    freshness: "current",
  },
  causalProof: {
    baseFails: null,
    headPasses: { runId, sequence: "42", excerpt: "exit 0" },
    revertFails: null,
  },
  issueRestated: "The total is off by one cent.",
  reproduction: null,
  whatWasDone: "Rounded once, after the discount.",
  statusNow: "The reported order reconciles on head.",
  monoFacts: "1 file · +4 / −1",
  questions: [
    {
      index: 1,
      question: "Does the reported reproduction pass?",
      disposition: "direct-evidence",
      evidence: [{ runId, sequence: "42", excerpt: "exit 0" }],
    },
  ],
  attention: [],
  evidenceUsed: [],
};

/** In-memory BriefsRepo — versions bump exactly like the SQL layer. */
const briefsMemoryLayer = Layer.sync(BriefsRepo, () => {
  const store = new Map<string, Brief>();
  return {
    byChange: (id: ChangeId) => {
      const brief = store.get(id);
      return brief === undefined
        ? Effect.fail(new BriefNotFoundError({ changeId: id }))
        : Effect.succeed(brief);
    },
    versions: () => Effect.succeed([] as ReadonlyArray<BriefVersion>),
    publish: (id: ChangeId, document: BriefDocument) =>
      Effect.sync(() => {
        const existing = store.get(id);
        const version = (existing?.currentVersion ?? 0) + 1;
        store.set(
          id,
          new Brief({
            id: existing?.id ?? BriefId.make(crypto.randomUUID()),
            changeId: id,
            currentVersion: version,
            document,
            createdAt: new Date(0),
            updatedAt: new Date(0),
          }),
        );
        return { version };
      }),
  };
});

/** A RunsRepo with no runs — the compiler only lists recordings for the prompt. */
const runsEmptyLayer = Layer.succeed(RunsRepo, {
  create: () => Effect.die("not in this test"),
  byId: (id: RunId) => Effect.fail(new RunNotFoundError({ runId: id })),
  listForIssue: () => Effect.succeed([] as ReadonlyArray<Run>),
  listUnsettled: () => Effect.succeed([] as ReadonlyArray<Run>),
  setSealantIds: () => Effect.void,
  setStatus: () => Effect.void,
  linkChange: () => Effect.void,
  saveLastSeenSequence: () => Effect.void,
  settle: () => Effect.void,
  saveFailureBrief: () => Effect.void,
});

/** Tool services the compiler binds but these tests never exercise. */
const unusedToolLayers = Layer.mergeAll(
  Layer.succeed(ReadRecording, {
    read: () =>
      Effect.fail(new InferenceToolError({ tool: "read_recording", message: "not in this test" })),
  }),
  Layer.succeed(ReadIssue, {
    read: () => Effect.succeed(new IssueView({ title: "t", body: "b", comments: [], links: [] })),
  }),
  Layer.succeed(ReadChange, {
    read: () =>
      Effect.fail(new InferenceToolError({ tool: "read_change", message: "not in this test" })),
  }),
);

const readBriefLiveOnMemory = Layer.effect(
  ReadBrief,
  Effect.gen(function* () {
    const briefs = yield* BriefsRepo;
    return {
      read: (id: ChangeId) =>
        briefs
          .byChange(id)
          .pipe(
            Effect.mapError(
              () => new InferenceToolError({ tool: "read_brief", message: "no brief yet" }),
            ),
          ),
    };
  }),
);

const publishBriefLiveOnMemory = Layer.effect(
  PublishBrief,
  Effect.gen(function* () {
    const briefs = yield* BriefsRepo;
    return {
      publish: (id: ChangeId, document: BriefDocument) => briefs.publish(id, document),
    };
  }),
);

/** A provider scripted to call the named tools in order, like the model would. */
const scriptedProviderLayer = (script: ReadonlyArray<{ name: string; input: unknown }>) =>
  Layer.succeed(InferenceProvider, {
    respond: (request: InferenceRequest) =>
      Effect.gen(function* () {
        for (const call of script) {
          const tool = request.tools?.find((candidate) => candidate.name === call.name);
          if (tool === undefined) continue;
          // A failed tool call comes back to the model as an error result — not a crash.
          yield* tool.handle(call.input).pipe(Effect.ignore);
        }
        return "done";
      }),
  });

const testLayer = (script: ReadonlyArray<{ name: string; input: unknown }>) =>
  BriefCompiler.layer.pipe(
    Layer.provideMerge(scriptedProviderLayer(script)),
    Layer.provideMerge(runsEmptyLayer),
    Layer.provideMerge(
      Layer.mergeAll(unusedToolLayers, readBriefLiveOnMemory, publishBriefLiveOnMemory).pipe(
        Layer.provideMerge(briefsMemoryLayer),
      ),
    ),
  );

describe("BriefCompiler", () => {
  it.effect("succeeds when the loop publishes a valid document", () =>
    Effect.gen(function* () {
      const compiler = yield* BriefCompiler;
      const briefs = yield* BriefsRepo;

      yield* compiler.compile(job);

      const brief = yield* briefs.byChange(changeId);
      expect(brief.currentVersion).toBe(1);
      expect(brief.document.questions).toHaveLength(1);
      // The wire's decimal string decoded to a domain bigint.
      expect(brief.document.causalProof.headPasses?.sequence).toBe(42n);
    }).pipe(
      Effect.provide(
        testLayer([{ name: "publish_brief", input: { change: changeId, document: wireDocument } }]),
      ),
    ),
  );

  it.effect("fails into retry when the loop never publishes", () =>
    Effect.gen(function* () {
      const compiler = yield* BriefCompiler;
      const outcome = yield* compiler.compile(job).pipe(Effect.flip);
      expect(outcome).toBeInstanceOf(InferenceError);
      expect(outcome.message).toContain("without publishing");
    }).pipe(Effect.provide(testLayer([]))),
  );

  it.effect("rejects a document that does not match the schema, then fails unpublished", () =>
    Effect.gen(function* () {
      const compiler = yield* BriefCompiler;
      const outcome = yield* compiler.compile(job).pipe(Effect.flip);
      // The bad publish was answered with a tool error; no version was written.
      expect(outcome).toBeInstanceOf(InferenceError);
    }).pipe(
      Effect.provide(
        testLayer([
          {
            name: "publish_brief",
            input: { change: changeId, document: { nonsense: true } },
          },
        ]),
      ),
    ),
  );

  it.effect("a recompile bumps the version and replaces the document", () =>
    Effect.gen(function* () {
      const compiler = yield* BriefCompiler;
      const briefs = yield* BriefsRepo;

      yield* compiler.compile(job);
      yield* compiler.compile(job);

      const brief = yield* briefs.byChange(changeId);
      expect(brief.currentVersion).toBe(2);
    }).pipe(
      Effect.provide(
        testLayer([{ name: "publish_brief", input: { change: changeId, document: wireDocument } }]),
      ),
    ),
  );
});

describe("the publish_brief wire codec", () => {
  it("decodes the encoded document the tool schema advertises", () => {
    const decoded = Schema.decodeUnknownSync(BriefDocument)(wireDocument);
    expect(decoded.footer).toEqual({ total: 1, directEvidence: 1, needJudgment: 0 });
    const encoded = Schema.encodeSync(BriefDocument)(decoded);
    expect(encoded.causalProof.headPasses?.sequence).toBe("42");
  });
});
