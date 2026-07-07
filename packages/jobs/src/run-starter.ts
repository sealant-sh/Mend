import { PgClient } from "@effect/sql-pg";
import { ChangesRepo, IssuesRepo, notifyEvent, RunsRepo } from "@mend/db";
import {
  Sha,
  SealantRunId,
  SealantWorkspaceId,
  type Issue,
  type IssueId,
  type Run,
} from "@mend/domain";
import { SealantClient } from "@mend/sealant";
import type { Run as SdkRun } from "@sealant/sdk";
import { opencode } from "@sealant/sdk";
import { Effect, Layer, Option, Stream } from "effect";

import { RunStarter } from "./dispatcher.ts";
import { JobRunner } from "./job-runner.ts";

/**
 * The prompt is the issue, verbatim — Mend adds no instructions of its own.
 * What the harness did with it is the recording's story to tell.
 */
const buildPrompt = (issue: Issue) =>
  issue.body === "" ? issue.title : `${issue.title}\n\n${issue.body}`;

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
      const sha = head.exitCode === 0 ? head.stdout.trim() : "";
      return {
        branch: branch.exitCode === 0 ? branch.stdout.trim() : "",
        baseSha: null,
        headSha: /^[0-9a-f]{40}$/.test(sha) ? Sha.make(sha) : null,
      };
    });

    /**
     * A completed run grows the change and recompiles the brief: ensure the
     * change row, tie the run's recording to it, enqueue the `brief` job. The
     * idempotency key follows the head so a re-settled run never double-compiles
     * (ARCHITECTURE.md §5).
     */
    const afterCompleted = Effect.fn("RunStarter.afterCompleted")(function* (
      run: Run,
      issue: Issue,
    ) {
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
      yield* jobs
        .enqueue({
          name: "brief",
          payload: { issueId: issue.id, changeId: change.id, runId: run.id },
          idempotencyKey: `brief:${change.id}:${facts.headSha ?? run.id}`,
        })
        .pipe(
          Effect.catchTag("JobEnqueueError", (error) =>
            Effect.logError("run supervisor: brief enqueue failed").pipe(
              Effect.annotateLogs({ runId: run.id, cause: String(error.cause) }),
            ),
          ),
        );
    });

    const failRun = Effect.fn("RunStarter.failRun")(function* (
      run: Run,
      issueId: IssueId,
      summary: string,
    ) {
      yield* runs.settle(run.id, "failed", summary);
      yield* issues.returnToTriage(issueId, run.id).pipe(Effect.ignore);
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

    return { start };
  }),
);
