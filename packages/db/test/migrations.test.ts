import { PgClient } from "@effect/sql-pg";
import { SessionId, SessionProcessId } from "@mend/domain";
import { Effect, Layer, Redacted } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MendDBLive } from "../src/client.ts";
import { migrations } from "../src/migrations.ts";
import {
  AgentConversationRepoLive,
  AgentConversationRepo,
} from "../src/repos/agent-conversation.ts";

/**
 * Migration tests run against the dev Postgres (`compose.dev.yaml`, :5434) in a throwaway
 * database; without one reachable they skip rather than pretend. Set MEND_TEST_DATABASE_URL to
 * point elsewhere.
 */
const ADMIN_URL =
  process.env["MEND_TEST_DATABASE_URL"] ?? "postgres://mend:mend@localhost:5434/mend";
const SCRATCH_DB = `mend_migration_test_${process.pid}_${Date.now()}`;

const scratchUrl = (() => {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${SCRATCH_DB}`;
  return url.toString();
})();
const adminLayer = PgClient.layer({ url: Redacted.make(ADMIN_URL) });
const scratchLayer = PgClient.layer({ url: Redacted.make(scratchUrl) });

const withAdmin = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(adminLayer), Effect.scoped));
const withScratch = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(scratchLayer), Effect.scoped));
const scratchDatabaseLayer = MendDBLive.pipe(Layer.provideMerge(scratchLayer));
const scratchConversationLayer = AgentConversationRepoLive.pipe(
  Layer.provide(scratchDatabaseLayer),
);
const withConversation = <A, E>(effect: Effect.Effect<A, E, AgentConversationRepo>) =>
  Effect.runPromise(effect.pipe(Effect.provide(scratchConversationLayer), Effect.scoped));

// The layer itself fails to build when nothing listens, so the guard sits outside the Effect.
const reachable = await withAdmin(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`SELECT 1`;
    return true;
  }).pipe(Effect.timeout("2 seconds")),
).then(
  () => true,
  () => false,
);

const ORDERED = Object.entries(migrations).toSorted(([a], [b]) => a.localeCompare(b));
const upTo = (last: string) =>
  Effect.forEach(
    ORDERED.filter(([name]) => name <= last),
    ([, migration]) => migration,
    { discard: true },
  );

describe.skipIf(!reachable)("0035 process kinds and 0036 agent conversation", () => {
  beforeAll(async () => {
    await withAdmin(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql.unsafe(`CREATE DATABASE ${SCRATCH_DB}`);
      }),
    );
  });
  afterAll(async () => {
    await withAdmin(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql.unsafe(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
      }),
    );
  });

  it("backfills agent rows to agent-pty with the harness read off argv and the provider id on the newest", async () => {
    const rows = await withScratch(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* upTo("0034_workspace_ttl_renewal");
        yield* sql`
          INSERT INTO projects (id, name, origin_url, store_path, default_branch)
          VALUES ('proj-1', 'fixture', NULL, '/store/fixture/repo.git', 'main')`;
        yield* sql`
          INSERT INTO agent_sessions
            (id, project_id, harness, provider_session_id, worktree, branch, base_sha, status)
          VALUES
            ('sess-claude', 'proj-1', 'claude', 'claude-provider-id', 'wt-1', 'b-1', 'abc', 'completed'),
            ('sess-codex', 'proj-1', 'codex', NULL, 'wt-2', 'b-2', 'abc', 'completed')`;
        yield* sql`
          INSERT INTO session_processes
            (id, session_id, sealant_workspace_id, sealant_session_id, kind, label, argv, status, created_at)
          VALUES
            ('p-claude-1', 'sess-claude', 'ws-1', 'pty-1', 'agent', 'claude',
             '["sh","-c","seed","sh","claude","--dangerously-skip-permissions"]', 'exited',
             '2026-08-01T00:00:00Z'),
            ('p-claude-2', 'sess-claude', 'ws-2', 'pty-2', 'agent', 'claude',
             '["zsh"]', 'exited', '2026-08-02T00:00:00Z'),
            ('p-claude-3', 'sess-claude', 'ws-3', 'pty-3', 'agent', 'claude',
             '["sh","-c","decode","sh","YWJj"]', 'exited', '2026-08-03T00:00:00Z'),
            ('p-codex-1', 'sess-codex', 'ws-4', 'pty-4', 'agent', 'codex',
             '["codex","--dangerously-bypass-approvals-and-sandbox"]', 'running',
             '2026-08-01T00:00:00Z'),
            ('p-shell-1', 'sess-codex', 'ws-4', 'pty-5', 'shell', 'shell 1', '["zsh"]', 'running',
             '2026-08-01T00:00:00Z'),
            ('p-service-1', 'sess-codex', 'ws-4', NULL, 'service', 'web', '["pnpm","dev"]',
             'reachable', '2026-08-01T00:00:00Z')`;
        yield* migrations["0035_session_process_kinds"];
        return yield* sql<{
          readonly id: string;
          readonly kind: string;
          readonly harness: string | null;
          readonly provider_session_id: string | null;
        }>`SELECT id, kind, harness, provider_session_id FROM session_processes ORDER BY id`;
      }),
    );
    expect(rows).toEqual([
      { id: "p-claude-1", kind: "agent-pty", harness: "claude", provider_session_id: null },
      { id: "p-claude-2", kind: "agent-pty", harness: "shell", provider_session_id: null },
      // The follow-up transport hides the command inside `sh -c`; the label is the fallback,
      // and the session's provider id lands on the NEWEST agent process.
      {
        id: "p-claude-3",
        kind: "agent-pty",
        harness: "claude",
        provider_session_id: "claude-provider-id",
      },
      { id: "p-codex-1", kind: "agent-pty", harness: "codex", provider_session_id: null },
      { id: "p-service-1", kind: "service", harness: null, provider_session_id: null },
      { id: "p-shell-1", kind: "shell", harness: null, provider_session_id: null },
    ]);
  });

  it("keeps provider item identity and sequence stable when protocol output replays", async () => {
    const rows = await withScratch(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* migrations["0036_agent_conversation"];
        yield* sql`
          INSERT INTO agent_turns
            (id, session_id, process_id, ordinal, author, input, status, provider_turn_id)
          VALUES
            ('turn-1', 'sess-codex', 'p-codex-1', 0, 'user-1', 'inspect replay', 'running', 'provider-turn-1')`;
        yield* sql`
          INSERT INTO agent_items
            (id, session_id, process_id, turn_id, seq, provider_item_id,
             provider_output_process_id, provider_output_seq, provider_event_index, kind, status, text)
          VALUES
            ('item-1', 'sess-codex', 'p-codex-1', 'turn-1', 1, 'provider-item-1',
             'p-codex-1', 5, 0, 'assistant-message', 'in-progress', 'first')
          ON CONFLICT (session_id, provider_item_id) DO UPDATE
          SET status = EXCLUDED.status, text = EXCLUDED.text, updated_at = now()`;
        yield* sql`
          INSERT INTO agent_items
            (id, session_id, process_id, turn_id, seq, provider_item_id,
             provider_output_process_id, provider_output_seq, provider_event_index, kind, status, text)
          VALUES
            ('item-replay', 'sess-codex', 'p-codex-1', 'turn-1', 99, 'provider-item-1',
             'p-codex-1', 5, 0, 'assistant-message', 'completed', 'final')
          ON CONFLICT (session_id, provider_item_id) DO UPDATE
          SET status = EXCLUDED.status, text = EXCLUDED.text, updated_at = now()`;
        return yield* sql<{
          readonly id: string;
          readonly seq: number;
          readonly provider_item_id: string;
          readonly status: string;
          readonly text: string;
        }>`SELECT id, seq, provider_item_id, status, text FROM agent_items ORDER BY seq`;
      }),
    );
    expect(rows).toEqual([
      {
        id: "item-1",
        seq: 1,
        provider_item_id: "provider-item-1",
        status: "completed",
        text: "final",
      },
    ]);
  });

  it("preserves item id and seq through repository replay and cursor pagination", async () => {
    await withScratch(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE agent_turns SET status = 'completed' WHERE id = 'turn-1'`;
      }),
    );
    const result = await withConversation(
      Effect.gen(function* () {
        const conversation = yield* AgentConversationRepo;
        const sessionId = SessionId.make("sess-codex");
        const processId = SessionProcessId.make("p-codex-1");
        const turn = yield* conversation.submitTurn(sessionId, processId, "replay", "user-1");
        const running = yield* conversation.claimNextTurn(processId);
        if (running === null) return yield* Effect.die("turn was not claimed");
        const bound = yield* conversation.bindRunningProviderTurn(
          sessionId,
          processId,
          "provider-turn-repository",
        );
        if (bound?.id !== turn.id) return yield* Effect.die("provider turn was not bound");
        const secondTurn = yield* conversation.submitTurn(
          sessionId,
          processId,
          "queued second",
          "user-2",
        );
        const whileBusy = yield* conversation.claimNextTurn(processId);
        const first = yield* conversation.upsertItem({
          sessionId,
          processId,
          turnId: turn.id,
          providerItemId: "provider-item-repository",
          providerTurnId: "provider-turn-repository",
          providerOutputSeq: 10n,
          providerEventIndex: 0,
          kind: "assistant-message",
          status: "in-progress",
          title: null,
          text: "partial",
          data: null,
        });
        const updated = yield* conversation.upsertItem({
          sessionId,
          processId,
          turnId: turn.id,
          providerItemId: "provider-item-repository",
          providerTurnId: "provider-turn-repository",
          providerOutputSeq: 11n,
          providerEventIndex: 0,
          kind: "assistant-message",
          status: "completed",
          title: null,
          text: "final",
          data: null,
        });
        const replayed = yield* conversation.upsertItem({
          sessionId,
          processId,
          turnId: turn.id,
          providerItemId: "provider-item-repository",
          providerTurnId: "provider-turn-repository",
          providerOutputSeq: 11n,
          providerEventIndex: 0,
          kind: "assistant-message",
          status: "completed",
          title: null,
          text: "final",
          data: null,
        });
        const request = yield* conversation.openRequest({
          sessionId,
          processId,
          turnId: turn.id,
          providerRequestId: "provider-request-repository",
          providerTurnId: "provider-turn-repository",
          providerItemId: "provider-item-repository",
          kind: "command-approval",
          title: "pnpm test",
          detail: { command: ["pnpm", "test"] },
          questions: null,
        });
        const pendingBefore = yield* conversation.hasPendingRequests(sessionId);
        const resolved = yield* conversation.resolveRequest(
          request.id,
          { decision: "accept" },
          "user-2",
        );
        const pendingAfter = yield* conversation.hasPendingRequests(sessionId);
        const raceRequest = yield* conversation.openRequest({
          sessionId,
          processId,
          turnId: turn.id,
          providerRequestId: "provider-request-race",
          providerTurnId: "provider-turn-repository",
          providerItemId: null,
          kind: "tool-permission",
          title: "tool",
          detail: null,
          questions: null,
        });
        yield* conversation.prepareRequestResponse(
          raceRequest.id,
          { decision: "accept" },
          "user-race",
        );
        yield* conversation.cancelOpenForTurn(turn.id);
        const raceResolved = yield* conversation.completeRequestResponse(raceRequest.id);
        yield* conversation.completeTurn(
          "provider-turn-repository",
          sessionId,
          "completed",
          null,
          null,
        );
        const claimedSecond = yield* conversation.claimNextTurn(processId);
        const deliveryRequest = yield* conversation.openRequest({
          sessionId,
          processId,
          turnId: secondTurn.id,
          providerRequestId: "provider-request-delivery",
          providerTurnId: "provider-turn-delivery",
          providerItemId: null,
          kind: "tool-permission",
          title: "tool",
          detail: null,
          questions: null,
        });
        yield* conversation.prepareRequestResponse(
          deliveryRequest.id,
          { decision: "accept" },
          "user-3",
        );
        yield* conversation.failRequestResponse(deliveryRequest.id);
        yield* conversation.cancelOpenForProcess(processId);
        const cancelledDecision = yield* conversation.byRequestId(deliveryRequest.id);
        const systemTurn = yield* conversation.submitTurn(
          sessionId,
          processId,
          "follow-up",
          null,
          "follow-up:1",
        );
        const replayedSystemTurn = yield* conversation.submitTurn(
          sessionId,
          processId,
          "follow-up",
          null,
          "follow-up:1",
        );
        return {
          first,
          updated,
          replayed,
          secondTurn,
          whileBusy,
          claimedSecond,
          pendingBefore,
          pendingAfter,
          resolved,
          raceResolved,
          cancelledDecision,
          systemTurn,
          replayedSystemTurn,
          page: yield* conversation.listItems(sessionId, first.seq, 100),
          after: yield* conversation.listItems(sessionId, updated.seq, 100),
        };
      }),
    );
    expect(result.whileBusy).toBeNull();
    expect(result.claimedSecond?.id).toBe(result.secondTurn.id);
    expect(result.pendingBefore).toBe(true);
    expect(result.pendingAfter).toBe(false);
    expect(result.resolved.decidedBy).toBe("user-2");
    expect(result.raceResolved.status).toBe("resolved");
    expect(result.raceResolved.decision).toBe("accept");
    expect(result.cancelledDecision?.status).toBe("cancelled");
    expect(result.cancelledDecision?.decision).toBe("accept");
    expect(result.cancelledDecision?.decidedBy).toBe("user-3");
    expect(result.replayedSystemTurn.id).toBe(result.systemTurn.id);
    expect(result.updated.id).toBe(result.first.id);
    expect(result.updated.seq).toBeGreaterThan(result.first.seq);
    expect(result.replayed.id).toBe(result.updated.id);
    expect(result.replayed.seq).toBe(result.updated.seq);
    expect(result.replayed.text).toBe("final");
    expect(
      result.page.filter((item) => item.providerItemId === "provider-item-repository"),
    ).toHaveLength(1);
    expect(result.after).toEqual([]);
  });
});
