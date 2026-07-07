import { PgClient } from "@effect/sql-pg";
import { ChangesRepo, IssuesRepo, notifyEvent, RunsRepo } from "@mend/db";
import {
  Sha,
  SealantRunId,
  SealantWorkspaceId,
  type ChangeId,
  type Issue,
  type IssueId,
  type Run,
} from "@mend/domain";
import { SealantClient } from "@mend/sealant";
import type { Run as SdkRun } from "@sealant/sdk";
import { opencode } from "@sealant/sdk";
import { Effect, Layer, Option, Stream } from "effect";

import { RunStarter, RunStartError } from "./dispatcher.ts";
import { JobRunner } from "./job-runner.ts";

/**
 * The prompt is the issue, verbatim — Mend adds no instructions of its own.
 * What the harness did with it is the recording's story to tell.
 */
const buildPrompt = (issue: Issue) =>
  issue.body === "" ? issue.title : `${issue.title}\n\n${issue.body}`;

/**
 * The causal proof, harness-prompted (ROADMAP §M2 interim): a verification run
 * executes scenarios without changing code, and its recording carries the
 * `base fails · head passes · revert fails` legs as observed exit codes. The
 * brief recompiles after it settles and cites those events.
 */
/** A full sha from a recorded `git rev-parse`, or null — never a guess. */
const shaOf = (result: { readonly exitCode: number; readonly stdout: string }) => {
  const sha = result.exitCode === 0 ? result.stdout.trim() : "";
  return /^[0-9a-f]{40}$/.test(sha) ? Sha.make(sha) : null;
};

const verificationPrompt = (issue: Issue) =>
  `This is a verification run for review evidence. Do not change any code: leave HEAD where it is and the working tree clean when you finish.

The repository sits at the head of a change addressing the issue below. Demonstrate each leg with commands, so their exit codes land in the record:

1. head passes — run the issue's reproduction (or the most direct check of the reported behavior) at the current HEAD.
2. base fails — check out the base commit (the merge base with the default branch, e.g. \`git merge-base HEAD origin/HEAD\`), run the same reproduction there, then check the previous HEAD out again.
3. revert fails — revert the change on top of head without committing (\`git revert --no-commit\`), run the same reproduction, then discard the revert (\`git reset --hard\`).

A leg you cannot execute is stated and skipped, never faked.

The issue:
${buildPrompt(issue)}`;

/** A routed follow-up: review feedback, self-contained, on the existing branch. */
const followUpPrompt = (instruction: string) =>
  `This is a follow-up run on an existing change, responding to review feedback. Work on the current branch as checked out; commit what you change; leave the working tree clean.

${instruction}`;

/** A routed verification pass: execute the scenario, change nothing. */
const routedVerificationPrompt = (instruction: string) =>
  `This is a verification run for review evidence. Do not change any code: leave HEAD where it is and the working tree clean when you finish. Demonstrate the scenario below with commands, so their exit codes land in the record. A step you cannot execute is stated and skipped, never faked.

${instruction}`;

/**
 * One supervised fiber per active run (ARCHITECTURE.md §5): stream the record,
 * persist the last-seen sequence, settle the card when the run does. Fibers
 * are forked into the layer's scope so they live as long as the process —
 * crash/restart re-attaches from the stored sequence instead of re-running.
 */
export const runStarterLayer = Layer.effect(
  RunStarter,
  Effect.gen(function* () {
    const sealant = yield* SealantClient;
    const runs = yield* RunsRepo;
    const issues = yield* IssuesRepo;
    const changes = yield* ChangesRepo;
    const jobs = yield* JobRunner;
    const sql = yield* PgClient.PgClient;
    const scope = yield* Effect.scope;

    /**
     * The head the evidence describes, read from the workspace itself — each
     * exec is recorded, so even these facts have records behind them. Failures
     * degrade to nulls: a gap is content, not a broken pipeline.
     */
    const discoverHeadFacts = Effect.fn("RunStarter.discoverHeadFacts")(function* (run: Run) {
      if (run.sealantWorkspaceId === null) {
        return { branch: "", baseSha: null, headSha: null };
      }
      const workspace = yield* sealant.getWorkspace(run.sealantWorkspaceId);
      const head = yield* sealant.exec(workspace, ["git", "rev-parse", "HEAD"]);
      const branch = yield* sealant.exec(workspace, ["git", "branch", "--show-current"]);
      // origin/HEAD still points at the clone-time default-branch head — the
      // base the evidence was gathered against, surviving local commits.
      const base = yield* sealant.exec(workspace, ["git", "rev-parse", "origin/HEAD"]);
      return {
        branch: branch.exitCode === 0 ? branch.stdout.trim() : "",
        baseSha: shaOf(base),
        headSha: shaOf(head),
      };
    });

    const enqueueLogged = Effect.fn("RunStarter.enqueueLogged")(function* (
      run: Run,
      job: { name: string; payload: Record<string, unknown>; idempotencyKey: string },
    ) {
      yield* jobs
        .enqueue(job)
        .pipe(
          Effect.catchTag("JobEnqueueError", (error) =>
            Effect.logError(`run supervisor: ${job.name} enqueue failed`).pipe(
              Effect.annotateLogs({ runId: run.id, cause: String(error.cause) }),
            ),
          ),
        );
    });

    /**
     * A completed run grows the change and recompiles the brief: ensure the
     * change row, tie the run's recording to it, enqueue the `brief` job (the
     * per-run key means one compile per settle, retries deduped). A completed
     * mending run also starts the verification run whose recording carries the
     * causal proof; the recompile after IT settles cites those legs.
     */
    // Annotated: supervise → afterCompleted → startVerification → supervise is
    // a deliberate cycle (a run's settle can start the next run).
    const afterCompleted: (run: Run, issue: Issue) => Effect.Effect<void> = Effect.fn(
      "RunStarter.afterCompleted",
    )(function* (staleRun: Run, issue: Issue) {
      // The in-memory row predates setSealantIds — without the re-read, head
      // discovery sees no workspace and the verification run never starts.
      const run = yield* runs.byId(staleRun.id).pipe(Effect.orElseSucceed(() => staleRun));
      const facts = yield* discoverHeadFacts(run).pipe(
        Effect.catchTag("SealantPlatformError", (error) =>
          Effect.logWarning("run supervisor: head discovery failed").pipe(
            Effect.annotateLogs({ runId: run.id, error: error.message }),
            Effect.as({ branch: "", baseSha: null, headSha: null }),
          ),
        ),
      );
      const change = yield* changes.ensureForIssue(issue.id, facts);
      yield* runs.linkChange(run.id, change.id);
      yield* enqueueLogged(run, {
        name: "brief",
        payload: { issueId: issue.id, changeId: change.id, runId: run.id },
        idempotencyKey: `brief:${change.id}:${run.id}`,
      });
      if (run.kind !== "verification") {
        yield* startVerification(run, issue);
      }
    });

    const failRun = Effect.fn("RunStarter.failRun")(function* (
      run: Run,
      issueId: IssueId,
      summary: string,
    ) {
      yield* runs.settle(run.id, "failed", summary);

      // A failed verification or follow-up never drags the issue back to
      // triage — the change still stands; the brief recompiles and reports
      // what the failed recording observed.
      if (run.kind !== "initial") {
        const current = yield* runs.byId(run.id).pipe(Effect.orElseSucceed(() => run));
        if (current.changeId === null) return;
        yield* enqueueLogged(run, {
          name: "brief",
          payload: { issueId, changeId: current.changeId, runId: run.id },
          idempotencyKey: `brief:${current.changeId}:${run.id}`,
        });
        return;
      }

      yield* issues.returnToTriage(issueId, run.id).pipe(Effect.ignore);
      // The failure mini-brief needs a recording to sum; without one, the
      // settle summary is all there is — a gap, carried as content. The row is
      // re-read because the in-memory run predates setSealantIds.
      const current = yield* runs.byId(run.id).pipe(Effect.orElseSucceed(() => run));
      if (current.sealantRunId === null) return;
      yield* enqueueLogged(run, {
        name: "failure-brief",
        payload: { issueId, runId: run.id },
        idempotencyKey: `failure-brief:${run.id}`,
      });
    });

    const supervise = Effect.fn("RunStarter.supervise")(function* (
      run: Run,
      issue: Issue,
      sdkRun: SdkRun,
      from: bigint,
    ) {
      yield* sealant.recordStream(sdkRun, { from }).pipe(
        Stream.tap((entry) =>
          Effect.gen(function* () {
            yield* runs.saveLastSeenSequence(run.id, entry.sequence);
            yield* notifyEvent(sql, {
              type: "run-progress",
              runId: run.id,
              issueId: issue.id,
              sequence: String(entry.sequence),
              line: entry.summary,
            });
          }),
        ),
        Stream.runDrain,
        // A broken stream is not a settled run — the wait below decides.
        Effect.catch((error) =>
          Effect.logWarning("run supervisor: record stream failed").pipe(
            Effect.annotateLogs({ runId: run.id, error: error.message }),
          ),
        ),
      );

      const settled = yield* sealant.waitRun(sdkRun);
      if (settled.result.outcome === "completed") {
        yield* runs.settle(run.id, "completed", settled.result.summary ?? null);
        yield* issues.markReview(issue.id).pipe(Effect.ignore);
        yield* afterCompleted(run, issue);
        return;
      }
      yield* failRun(
        run,
        issue.id,
        settled.result.summary ?? `harness exited with code ${settled.result.exitCode}`,
      );
    });

    /**
     * The causal-proof run: same workspace, no code changes, kind
     * `verification`. Supervised like any run; when it settles, the brief
     * recompiles and can cite its recording.
     */
    const startVerification: (completedRun: Run, issue: Issue) => Effect.Effect<void> = Effect.fn(
      "RunStarter.startVerification",
    )(function* (completedRun: Run, issue: Issue) {
      if (completedRun.sealantWorkspaceId === null) return;
      const workspaceId = completedRun.sealantWorkspaceId;

      const run = yield* runs.create(issue.id, "verification");
      yield* changes.byIssue(issue.id).pipe(
        Effect.flatMap((change) => runs.linkChange(run.id, change.id)),
        Effect.ignore,
      );

      const work = Effect.gen(function* () {
        // The creating handle is gone — start by workspace id (the re-fetched
        // facade handle carries no harness; see PLATFORM-FEEDBACK.md).
        const sdkRun = yield* sealant.startHarnessInWorkspace(
          workspaceId,
          opencode(),
          verificationPrompt(issue),
        );
        yield* runs.setSealantIds(
          run.id,
          SealantRunId.make(sdkRun.id),
          SealantWorkspaceId.make(workspaceId),
        );
        yield* runs.setStatus(run.id, "running");
        yield* supervise(run, issue, sdkRun, 0n);
      }).pipe(
        Effect.catchTag("SealantPlatformError", (error) => failRun(run, issue.id, error.message)),
        Effect.catchDefect((defect) =>
          failRun(run, issue.id, `run supervision died: ${String(defect)}`),
        ),
      );
      yield* Effect.forkIn(work, scope);
    });

    const launch = Effect.fn("RunStarter.launch")(function* (run: Run, issue: Issue) {
      const work = Effect.gen(function* () {
        const workspace = yield* sealant.createWorkspace({
          repository: issue.repository,
          harness: opencode(),
          name: `mend-${issue.id.slice(0, 8)}`,
        });
        const sdkRun = yield* sealant.startHarness(workspace, buildPrompt(issue), {
          idempotencyKey: run.id,
        });
        yield* runs.setSealantIds(
          run.id,
          SealantRunId.make(sdkRun.id),
          SealantWorkspaceId.make(workspace.id),
        );
        yield* runs.setStatus(run.id, "running");
        yield* supervise(run, issue, sdkRun, 0n);
      }).pipe(
        Effect.catchTag("SealantPlatformError", (error) => failRun(run, issue.id, error.message)),
        Effect.catchDefect((defect) =>
          failRun(run, issue.id, `run supervision died: ${String(defect)}`),
        ),
      );
      yield* Effect.forkIn(work, scope);
    });

    /** Re-attach to runs that were live when the last process died. */
    const resume = Effect.fn("RunStarter.resume")(function* () {
      const unsettled = yield* runs.listUnsettled();
      for (const run of unsettled) {
        const issue = yield* issues.byId(run.issueId).pipe(Effect.option);
        if (Option.isNone(issue)) continue;
        if (run.sealantRunId === null) {
          // Died between run-row creation and harness start; nothing recorded.
          yield* failRun(run, run.issueId, "process restarted before the harness started");
          continue;
        }
        const sealantRunId = run.sealantRunId;
        const work = Effect.gen(function* () {
          const sdkRun = yield* sealant.getRun(sealantRunId);
          yield* supervise(run, issue.value, sdkRun, run.lastSeenSequence);
        }).pipe(
          Effect.catchTag("SealantPlatformError", (error) =>
            failRun(run, run.issueId, error.message),
          ),
          Effect.catchDefect((defect) =>
            failRun(run, run.issueId, `run supervision died: ${String(defect)}`),
          ),
        );
        yield* Effect.forkIn(work, scope);
        yield* Effect.logInfo("run supervisor: re-attached").pipe(
          Effect.annotateLogs({ runId: run.id, from: String(run.lastSeenSequence) }),
        );
      }
    });

    yield* resume();

    const start = Effect.fn("RunStarter.start")(function* (issue: Issue) {
      const run = yield* runs.create(issue.id, "initial");
      // Mark mending before forking so the next dispatcher tick sees the slot taken.
      yield* issues.markMending(issue.id).pipe(Effect.ignore);
      yield* launch(run, issue);
    });

    /**
     * A routed run on the change's existing branch (PRODUCT.md, Iteration):
     * same workspace as the recordings behind the change, supervised like any
     * run. The card stays in review — the review is the conversation.
     */
    const startOnChange = Effect.fn("RunStarter.startOnChange")(function* (
      changeId: ChangeId,
      instruction: string,
      kind: "follow-up" | "verification",
    ) {
      const change = yield* changes
        .byId(changeId)
        .pipe(Effect.mapError(() => new RunStartError({ message: `no change ${changeId}` })));
      const issue = yield* issues
        .byId(change.issueId)
        .pipe(Effect.mapError(() => new RunStartError({ message: `no issue ${change.issueId}` })));

      const issueRuns = yield* runs.listForIssue(change.issueId);
      const anchor = issueRuns.find((run) => run.sealantWorkspaceId !== null);
      if (anchor === undefined || anchor.sealantWorkspaceId === null) {
        return yield* new RunStartError({
          message: `no workspace stands behind change ${changeId} — nothing to run on`,
        });
      }
      const workspaceId = anchor.sealantWorkspaceId;

      const run = yield* runs.create(issue.id, kind);
      yield* runs.linkChange(run.id, change.id);

      const promptText =
        kind === "follow-up" ? followUpPrompt(instruction) : routedVerificationPrompt(instruction);
      const work = Effect.gen(function* () {
        const sdkRun = yield* sealant.startHarnessInWorkspace(workspaceId, opencode(), promptText);
        yield* runs.setSealantIds(
          run.id,
          SealantRunId.make(sdkRun.id),
          SealantWorkspaceId.make(workspaceId),
        );
        yield* runs.setStatus(run.id, "running");
        yield* supervise(run, issue, sdkRun, 0n);
      }).pipe(
        Effect.catchTag("SealantPlatformError", (error) => failRun(run, issue.id, error.message)),
        Effect.catchDefect((defect) =>
          failRun(run, issue.id, `run supervision died: ${String(defect)}`),
        ),
      );
      yield* Effect.forkIn(work, scope);
      return run.id;
    });

    return { start, startOnChange };
  }),
);
