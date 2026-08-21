import { PgClient } from "@effect/sql-pg";
import { Effect, Redacted } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrations } from "../src/migrations.ts";

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

const reachable = await withAdmin(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`SELECT 1`;
    return true;
  }).pipe(
    Effect.timeout("2 seconds"),
    Effect.catch(() => Effect.succeed(false)),
    Effect.catchDefect(() => Effect.succeed(false)),
  ),
);

const ORDERED = Object.entries(migrations).toSorted(([a], [b]) => a.localeCompare(b));
const upTo = (last: string) =>
  Effect.forEach(
    ORDERED.filter(([name]) => name <= last),
    ([, migration]) => migration,
    { discard: true },
  );

describe.skipIf(!reachable)("0035_session_process_kinds", () => {
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
});
