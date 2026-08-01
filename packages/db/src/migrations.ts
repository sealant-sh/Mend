import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

/**
 * The core tables from ARCHITECTURE.md §3. pg-boss owns its own `pgboss`
 * schema (created on start); the tables here are Mend's product state plus
 * better-auth's required tables (camelCase columns, quoted, as better-auth
 * expects them).
 */
const init = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE issues (
      id text PRIMARY KEY,
      source text NOT NULL,
      external_ref text,
      repository text NOT NULL,
      title text NOT NULL,
      body text NOT NULL DEFAULT '',
      stage text NOT NULL DEFAULT 'triage',
      position integer,
      last_failure_run_id text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
  yield* sql`CREATE INDEX issues_stage_position_idx ON issues (stage, position)`;

  // One change per issue: the UNIQUE constraint is the cardinality rule.
  yield* sql`
    CREATE TABLE changes (
      id text PRIMARY KEY,
      issue_id text NOT NULL UNIQUE REFERENCES issues(id) ON DELETE CASCADE,
      branch text NOT NULL,
      base_sha text,
      head_sha text,
      pr_number integer,
      pr_url text,
      freshness text NOT NULL DEFAULT 'current',
      moved_base_sha text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;

  // The recording itself stays in Sealant; this is the index over executions.
  yield* sql`
    CREATE TABLE runs (
      id text PRIMARY KEY,
      issue_id text NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      change_id text REFERENCES changes(id) ON DELETE SET NULL,
      kind text NOT NULL,
      sealant_run_id text,
      sealant_workspace_id text,
      status text NOT NULL DEFAULT 'queued',
      outcome text,
      summary text,
      last_seen_sequence bigint NOT NULL DEFAULT 0,
      started_at timestamptz,
      settled_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
  yield* sql`CREATE INDEX runs_issue_idx ON runs (issue_id)`;

  // One living brief per change; prior versions stay in history.
  yield* sql`
    CREATE TABLE briefs (
      id text PRIMARY KEY,
      change_id text NOT NULL UNIQUE REFERENCES changes(id) ON DELETE CASCADE,
      current_version integer NOT NULL DEFAULT 1,
      document jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
  yield* sql`
    CREATE TABLE brief_versions (
      brief_id text NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
      version integer NOT NULL,
      document jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (brief_id, version)
    )`;
  yield* sql`
    CREATE TABLE review_questions (
      id text PRIMARY KEY,
      brief_id text NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
      index integer NOT NULL,
      question text NOT NULL,
      disposition text NOT NULL,
      evidence jsonb NOT NULL DEFAULT '[]',
      UNIQUE (brief_id, index)
    )`;

  // The interface-inference audit trail: every tool call and model exchange.
  yield* sql`
    CREATE TABLE inference_calls (
      id text PRIMARY KEY,
      context text NOT NULL,
      tool text,
      input jsonb NOT NULL,
      output jsonb NOT NULL,
      occurred_at timestamptz NOT NULL DEFAULT now()
    )`;

  yield* sql`
    CREATE TABLE settings (
      key text PRIMARY KEY,
      value jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;

  // better-auth tables — camelCase columns as its pg adapter expects.
  yield* sql`
    CREATE TABLE "user" (
      "id" text PRIMARY KEY,
      "name" text NOT NULL,
      "email" text NOT NULL UNIQUE,
      "emailVerified" boolean NOT NULL DEFAULT false,
      "image" text,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )`;
  yield* sql`
    CREATE TABLE "session" (
      "id" text PRIMARY KEY,
      "expiresAt" timestamptz NOT NULL,
      "token" text NOT NULL UNIQUE,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "ipAddress" text,
      "userAgent" text,
      "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
    )`;
  yield* sql`CREATE INDEX session_user_idx ON "session" ("userId")`;
  yield* sql`
    CREATE TABLE "account" (
      "id" text PRIMARY KEY,
      "accountId" text NOT NULL,
      "providerId" text NOT NULL,
      "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      "accessToken" text,
      "refreshToken" text,
      "idToken" text,
      "accessTokenExpiresAt" timestamptz,
      "refreshTokenExpiresAt" timestamptz,
      "scope" text,
      "password" text,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )`;
  yield* sql`CREATE INDEX account_user_idx ON "account" ("userId")`;
  yield* sql`
    CREATE TABLE "verification" (
      "id" text PRIMARY KEY,
      "identifier" text NOT NULL,
      "value" text NOT NULL,
      "expiresAt" timestamptz NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )`;
  yield* sql`CREATE INDEX verification_identifier_idx ON "verification" ("identifier")`;
});

/**
 * The failure mini-brief (PRODUCT.md §6), denormalized onto the run it sums
 * up: what was tried, what was observed, reproduction status — kept and
 * reported, never hidden. A failed run has no change row to hang a brief off.
 */
const failureBrief = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE runs ADD COLUMN failure_brief jsonb`;
});

/**
 * The brief's review conversation (PRODUCT.md, Iteration): reviewer comments
 * threaded onto the living document, Mend's replies beside them, and the
 * routed decision recorded on the comment that caused it.
 */
const briefComments = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE brief_comments (
      id text PRIMARY KEY,
      brief_id text NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
      thread text NOT NULL,
      author_kind text NOT NULL,
      author_name text NOT NULL,
      body text NOT NULL,
      routed_action text,
      routed_run_id text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
  yield* sql`CREATE INDEX brief_comments_brief_idx ON brief_comments (brief_id, created_at)`;
});

/**
 * The workbench object model (MEND-AGENT-WORKBENCH-PLAN.md §5): projects
 * adopted into the central store, sessions in per-session worktrees,
 * checkpoints, the session change, and review comments. Additive — the
 * queue-era tables stay until their surfaces retire (docs/M0-INVENTORY.md).
 * The product Session lives in `agent_sessions`: better-auth owns `"session"`.
 */
const workbench = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE projects (
      id text PRIMARY KEY,
      name text NOT NULL UNIQUE,
      origin_url text,
      store_path text NOT NULL UNIQUE,
      default_branch text NOT NULL,
      adopted_sha text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;

  // Immutable manifest of exactly what a session received (plan §5.4).
  yield* sql`
    CREATE TABLE context_snapshots (
      id text PRIMARY KEY,
      pack_name text,
      items jsonb NOT NULL DEFAULT '[]',
      created_at timestamptz NOT NULL DEFAULT now()
    )`;

  yield* sql`
    CREATE TABLE agent_sessions (
      id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      harness text NOT NULL,
      provider_session_id text,
      label text,
      worktree text NOT NULL,
      branch text NOT NULL,
      base_sha text NOT NULL,
      context_snapshot_id text REFERENCES context_snapshots(id) ON DELETE SET NULL,
      sealant_run_id text,
      sealant_workspace_id text,
      status text NOT NULL DEFAULT 'starting',
      summary text,
      last_seen_sequence bigint NOT NULL DEFAULT 0,
      started_at timestamptz,
      settled_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
  yield* sql`CREATE INDEX agent_sessions_project_idx ON agent_sessions (project_id, created_at)`;
  yield* sql`CREATE INDEX agent_sessions_status_idx ON agent_sessions (status)`;

  // One change per session (plan §5.6); git owns the diff, this row the identity.
  yield* sql`
    CREATE TABLE session_changes (
      id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      session_id text NOT NULL UNIQUE REFERENCES agent_sessions(id) ON DELETE CASCADE,
      branch text NOT NULL,
      base_sha text NOT NULL,
      head_sha text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;

  // (hidden git ref, record seq) pairs — two checkpoints define a slice (§5.6).
  yield* sql`
    CREATE TABLE checkpoints (
      id text PRIMARY KEY,
      session_id text NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      ref text NOT NULL,
      sha text NOT NULL,
      seq bigint NOT NULL DEFAULT 0,
      trigger text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
  yield* sql`CREATE INDEX checkpoints_session_idx ON checkpoints (session_id, seq)`;

  yield* sql`
    CREATE TABLE review_comments (
      id text PRIMARY KEY,
      change_id text NOT NULL REFERENCES session_changes(id) ON DELETE CASCADE,
      file text,
      line integer,
      author_kind text NOT NULL,
      author_name text NOT NULL,
      body text NOT NULL,
      state text NOT NULL DEFAULT 'open',
      sent_to_session_id text REFERENCES agent_sessions(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
  yield* sql`CREATE INDEX review_comments_change_idx ON review_comments (change_id, created_at)`;
});

/** The review-to-agent loop (plan §7.3): assembled follow-up instructions. */
const followUps = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE follow_ups (
      id text PRIMARY KEY,
      session_id text NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      change_id text NOT NULL REFERENCES session_changes(id) ON DELETE CASCADE,
      instruction text NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      created_at timestamptz NOT NULL DEFAULT now(),
      delivered_at timestamptz
    )`;
  yield* sql`CREATE INDEX follow_ups_session_idx ON follow_ups (session_id, created_at)`;
});

/** The platform's PTY session id (SDK 0.7.0) — the durable reattach handle. */
const sealantSession = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE agent_sessions ADD COLUMN sealant_session_id text`;
});

/** A comment can anchor to a RANGE of lines; `end_line` null = single line. */
const reviewCommentSpans = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE review_comments ADD COLUMN end_line integer`;
});

/** Phones registered for push — the token IS the identity (one row per install). */
const pushDevices = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE push_devices (
      token text PRIMARY KEY,
      platform text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz NOT NULL DEFAULT now()
    )`;
});

/**
 * References (plan §17, decided 2026-08-01): read-only clones of dependency
 * sources in the store, selected per project, mounted at `/workspace/ref/<name>`.
 * Table is `reference_repos` — `references` is a reserved word; the product
 * noun stays `reference`. The session records what it actually mounted
 * (`reference_mounts`), SHAs as observed at launch.
 */
const references = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE reference_repos (
      id text PRIMARY KEY,
      name text NOT NULL UNIQUE,
      origin_url text NOT NULL,
      path text NOT NULL UNIQUE,
      pinned_ref text,
      head_sha text,
      refreshed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
  yield* sql`
    CREATE TABLE project_references (
      project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      reference_id text NOT NULL REFERENCES reference_repos(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (project_id, reference_id)
    )`;
  yield* sql`
    ALTER TABLE agent_sessions ADD COLUMN reference_mounts jsonb NOT NULL DEFAULT '[]'`;
});

/**
 * Per-project extra mounts (plan §17, decided 2026-08-01): host folders a
 * project's sessions see at `/workspace/home/<name>`, read-only by default.
 * The session records what it actually mounted (`extra_mounts`) so the review
 * surface can state what the agent could see; the reviewable change itself
 * stays worktree-versus-base.
 */
const projectMounts = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE project_mounts (
      id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name text NOT NULL,
      host_path text NOT NULL,
      read_only boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (project_id, name),
      UNIQUE (project_id, host_path)
    )`;
  yield* sql`
    ALTER TABLE agent_sessions ADD COLUMN extra_mounts jsonb NOT NULL DEFAULT '[]'`;
});

export const migrations = {
  "0001_init": init,
  "0002_failure_brief": failureBrief,
  "0003_brief_comments": briefComments,
  "0004_workbench": workbench,
  "0005_follow_ups": followUps,
  "0006_sealant_session": sealantSession,
  "0007_review_comment_spans": reviewCommentSpans,
  // 0008 went to push devices on main while these were in flight — renumbered.
  "0008_push_devices": pushDevices,
  "0009_references": references,
  "0010_project_mounts": projectMounts,
};
