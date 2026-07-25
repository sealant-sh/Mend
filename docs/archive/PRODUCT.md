> **SUPERSEDED · 2026-07-25** — This document describes the retired issue-to-PR / queue direction.
> The canonical direction is [`MEND-AGENT-WORKBENCH-PLAN.md`](../../MEND-AGENT-WORKBENCH-PLAN.md) at
> the repo root; where they conflict, the plan wins. Kept as design history — do not implement
> against this. Reusable pieces are mapped in the plan §10.

# Mend — Product Spec

What Mend does, exactly, and where it stops. `MEND-PLAN.md` records the decisions and their reasons;
this document turns them into a behavioral contract precise enough to build and to say no with. If
the two disagree, the plan wins — fix the drift deliberately.

## Definition

Mend takes an issue from your tracker, has a coding agent fix it in a recorded workspace, and
reviews the resulting change against that recording. What it delivers is a pull request whose review
is already done: **the brief**.

The shape is issue → PR. The product is the review.

Three facts constrain every behavior below:

1. **The review is compiled from a runtime recording of the run** — never from reading the diff
   after the fact, and never from the harness's own summary of what it did.
2. **Mend performs the review; humans make both decisions.** What gets worked (Gate 1) and what gets
   merged (Gate 2) are human actions, always.
3. **Mend hosts no inference.** Every model call — the harness that mends, the inference behind the
   interface — runs on the AI subscriptions the user connected in Sealant. Mend ships no model keys.

## Objects — issues, runs, PRs, briefs

These nouns are not interchangeable; their cardinality is the spine of the product.

```
issue  1 ── 0..n  runs       initial run · follow-up runs · re-verification runs
run    1 ── 1     recording  every run is recorded; the run audit is the view over one run
issue  1 ── 0..1  change     one branch per issue (v1: single repo) → 0..1 PR carrying it
change 1 ── 1     brief      living — recompiled after every run and on freshness flips
```

- A **run** is one harness execution in one workspace. Success or failure, its recording is kept,
  and the run audit shows exactly that run.
- The **change** is one per issue: one branch, and at most one PR carrying it — opened by the first
  successful run (default mode) or at approval (alternate mode). Follow-up runs commit to the same
  branch and the same PR.
- The **brief** belongs to the change — not to a run, and not to the PR. It exists from the first
  successful run, recompiles from the full set of recordings behind the current head after every
  subsequent run, and is posted into the PR description whenever a PR exists. It is one living
  document, never a stack of per-run reports.
- A failed run on an issue with no change yet produces a **failure comment** on the issue (a
  mini-brief). No PR, no brief.

In one line: **runs are many; the change and its PR are one; the brief is one, and current.**

## The loop, exactly

```
triage → queued → mending → review → merged
```

### 1. Intake

- Issues come from GitHub, Linear, or Jira. Until those integrations land, manual entry.
- The tracker is an input, not the identity: issues can come from anywhere; PRs live on GitHub.
- A new issue lands in **triage**. Mend does nothing with an issue sitting in triage.

### 2. Gate 1 — the queue

- A human drags an issue from triage into the queue and orders it. That drag is the only way work
  starts.
- Mend never picks its own work: no auto-triage, no priority inference, no self-assigned backlog.

### 3. Mending

- One harness per issue, in a Sealant workspace, created and driven through the public
  `@sealant/sdk` only.
- The harness receives the issue **plus Mend's operational contract for a reviewable change**: work
  on a dedicated branch, run the repository's own build/test/typecheck, commit with a clean tree,
  and report honestly (including partial or blocked work). Mend gives **no solution guidance** — how
  to fix the issue is the harness's own judgment, so the brief reviews that judgment, not Mend's
  instructions. If a completed run leaves real work uncommitted, Mend snapshots it into a commit
  itself, so no work the agent actually did is invisible to the review. This does not weaken Fact 1:
  the brief is still compiled from the recording, never from the harness's own summary — the
  contract only makes the agent's real work land where the recording and git state can see it.
- The run streams live onto the issue's card and is recorded durably. The recording is the raw
  material for everything downstream: a run that was not recorded cannot be reviewed.

### 4. The review — the brief

One brief per change, compiled from the recording (inference via Sealant), recompiled after every
run. Its anatomy (canonical mock: the `apps/marketing` brief exhibit):

- **Header:** repo · PR ref · issue ref · `Checks N` · head sha · `Evidence current/stale` · full
  diff · run audit.
- **The causal proof:** `base fails · head passes · revert fails` — the change demonstrably fixes
  the issue, which is a stronger claim than "CI is green".
- **The issue,** restated in one line, with the failing reproduction in mono.
- **What was done / Status now:** plain sentences plus mono facts
  (`3 files · +41 / −22 · no API, schema, dependency, or provider-contract changes`).
- **Review questions:** the review decomposed into numbered questions, each carrying a disposition —
  `direct evidence` (green) · `not executed` (amber) · `unrelated change` (red).
- **What needs attention:** the amber and red callouts, first-class, never fine print.
- **Evidence used:** each source with what it established; totals and a link to the source trail.
- **Footer:** `N review questions · N have direct evidence · N need judgment` — and the one action.

Rules the brief never breaks:

- Evidence, not verdicts. Status words describe what was observed (`Completed · observed`), never a
  judgment (`safe to merge`). No scores, no grades, no confidence numbers.
- Every claim links to observed evidence or is flagged `not executed` / `inferred`. Gaps are
  content, not omissions: paths the agent never exercised are listed, not hidden.
- Dispositions are earned. Green means the recording contains direct evidence; nothing defaults to
  green.

### 5. The PR — Gate 2

PR timing has exactly two modes; there is no third.

- **Default:** every successful run opens a **draft PR immediately**. The brief is posted into the
  PR description with deep links back to Mend. CI runs against the draft from minute one, and its
  results join the brief as corroborating evidence.
- **Alternate:** no PR until approval. The brief lives in Mend only; approval opens a
  ready-for-review PR and the merge decision stays on GitHub.

In the default mode, **approving in Mend merges the PR on GitHub**, respecting branch protection —
if required checks are still pending, approval arms GitHub auto-merge. That is not Mend deciding to
merge: the human decision already happened; GitHub is just waiting for checks.

### 6. Failed runs

- No PR. A failed run never produces a pull request.
- Mend sums the recording into a failure comment on the issue — a mini-brief: what was tried, what
  was observed, reproduction status, and a link to the run audit. Failures are evidence too; they
  are kept and reported, never hidden.
- The card returns to triage carrying the failure. Working the issue again is a human action
  (re-queue — a fresh run, with the failed recording kept alongside). Nothing retries on its own.

### 7. Iteration

- Iteration stays in Mend, with inference running throughout (via Sealant, on the user's
  subscriptions).
- A reviewer comment on the brief is read by Mend (inference), which decides the next action: a
  follow-up run on the same branch, a question back to the reviewer, or a verification pass.
- Interface inference routes; a harness executes. Follow-up code changes are always a new harness
  run — nothing interface-side edits code.
- New commits land on the same draft PR; the brief recompiles.

### 8. Evidence freshness

- If base moves while a brief sits in review, the brief flips to
  `evidence stale · <old sha> → <new sha>` with one-click re-verification in a fresh workspace.
- A stale brief never silently presents itself as current.

### 9. The run audit

The deep view behind the brief, one per run: **milestones · full trace · sources**.

- The source trail lists every source the agent opened, grouped
  `relied on / consulted / contradicted / discarded` — each with why it was opened, what the agent
  took from it, where that was used, and provenance chips
  (`reference only · no code copied · <license> · archived snapshot available`).
- Every event carries provenance: `observed` (the runtime saw it) or `inferred` (the harness claimed
  it).

### 10. Surfaces

- **Web app:** the queue with first-class drag-and-drop, the brief, the run audit.
- **Mobile app:** the **full loop including merge** — not a read-only companion.
- **GitHub:** the brief in the PR description, deep links back to Mend, merge via approval.

## Inference in the interface

There is no second product agent here and deliberately no product noun for one — Mend just uses
inference. Every model call behind the interface runs via Sealant, on the AI subscriptions the user
connected there; Mend ships no model keys, hosts no models, and proxies no inference.

Where the interface uses inference:

- Compiling the brief — the language, the review-question decomposition, the callouts — from the
  recording.
- Summing up a run: the live progress line on a mending card, the failure comment on the issue.
- Interpreting reviewer comments and routing the next action (follow-up run · question back ·
  verification pass).
- Explaining on demand inside the run audit — "why was this source consulted", "what happened in
  this milestone".

Rules interface inference never breaks:

- **It never edits code.** It reads recordings, writes language, and routes actions. Any code change
  it decides on becomes a harness run — recorded like every other.
- **Grounded, always.** It phrases and organizes evidence from the recording; it cannot mint claims.
  Anything it writes that the recording does not support is flagged `inferred`, per the brief's
  rules.
- **No vote.** It never approves, merges, scores, or recommends a merge decision.

### Tool-running: first-party, closed set

The interface inference loop calls a small, closed set of Mend-defined tools — the same Effect
services the product needs anyway. Tool calls land in Mend's own audit trail like every other
action.

No third-party tool gateway in v1. Evaluated and set aside: [Executor](https://executor.sh) (MIT,
self-hostable; an MCP tool catalog with per-tool allow/approve/block policies, sandboxed calls,
host-side secret injection). Not a v1 dependency because the tool set here is tiny and closed,
tracker auth would live in two places, and a gateway between the model and the tools is an execution
surface outside Mend's audit trail. Revisit if user-supplied tools ever enter the review loop — a
policy-gated catalog is the right shape for that, and its allow/approve/block model matches Mend's
human-gate philosophy.

### The tool set

Every tool is a Mend Effect service with a typed schema. Every call is logged — tool, input, output,
timestamp, and which inference context made it — and that log is part of the audit trail. A context
is given only the tools it needs, never the full set by default.

**Read — grounding. No side effects.**

- `read_recording(run, selector?) → events[]` The recording of one run: milestones, trace slices,
  the source trail. Every event carries its provenance tag (`observed` / `inferred`). `selector`
  narrows to a milestone range, an event kind, or the sources — the full trace is large and most
  contexts need a slice. **Why:** the recording is the only permitted source of claims. If a
  statement cannot be traced to an event returned by this tool, it must be written as `inferred`.
- `read_issue(issue) → {title, body, comments[], links[]}` The tracker issue, normalized across
  GitHub/Linear/Jira (or manual entry). **Why:** restating the issue in the brief, and reading what
  a reviewer actually asked for.
- `read_change(change) → {diff, base_sha, head_sha, files[], checks[], freshness}` Machine facts
  about the branch and PR: the diff and its stats, shas, CI check results, evidence freshness.
  **Why:** the brief's mono facts (`3 files · +41 / −22 · …`), the `unrelated change` disposition
  (edits in the diff with no cause in the recording), and staleness handling.
- `read_brief(change) → brief` The current living brief, including each review question and its
  disposition. **Why:** recompiles must amend the existing document, not start over; comment routing
  needs to know what the brief already claims.

**Act — recorded side effects. Each call is itself evidence.**

- `post_issue_comment(issue, body) → comment_ref` Writes on the tracker issue. Used for the failure
  comment (mini-brief) and nothing else unprompted. **Why:** failures must be reported where the
  issue lives, not hidden in Mend. Bounded to the issue being worked — there is no tool to touch any
  other issue.
- `reply_on_brief(change, thread, body) → comment_ref` Answers a reviewer inside the brief's review
  thread (the "question back" action). **Why:** when a comment is ambiguous, asking is cheaper and
  safer than guessing at a follow-up run.
- `start_run(change, instruction, kind: follow-up | verification) → run` Starts a harness run on the
  change's existing branch: `follow-up` to alter code in response to review, `verification` to
  execute a scenario without changing code (e.g. an amber `not executed` question a reviewer wants
  exercised). **Why:** the only path by which inference can cause code to change — and it leads into
  a workspace, recorded like every other run. It cannot target a new branch or another issue.
- `publish_brief(change, brief) → brief_version` Replaces the living brief and updates the PR
  description; prior versions stay in history. **Why:** the brief recompiles after every run and on
  freshness flips; versions make "what did the brief claim when I approved" answerable.

**Deliberately absent.** The rules above are enforced by omission, not by prompt:

- No `merge`, no `approve`, no review-state tool — no vote.
- No file write, no shell, no arbitrary network — it never edits code and cannot fetch claims from
  outside the recording.
- No queue tools — humans pick and order work.
- No tracker access beyond the issue at hand.

Context → tools: brief compilation gets the read set plus `publish_brief`; run and failure summaries
get `read_recording` (plus `post_issue_comment` for the failure comment); comment routing gets the
read set plus the act set; run-audit Q&A gets `read_recording` only.

## Flows

The end-to-end paths the product must support. Anything not reachable through one of these is out of
scope until added here deliberately.

### Flow 1 — the happy path

`tracker → triage → queued → mending → review → merged`

1. An issue arrives from the tracker (or manual entry) and lands in **triage**.
2. **Gate 1:** a human drags it into the queue and orders it.
3. Mend creates a Sealant workspace and starts one harness. The run streams live onto the card and
   is recorded.
4. The run succeeds. A **draft PR opens immediately**; Mend compiles **the brief** from the
   recording into the PR description; CI starts, and its results join the brief.
5. The reviewer reads the brief — causal proof, review questions, what needs attention — with the
   run audit one click deeper.
6. **Gate 2:** the reviewer approves in Mend. Mend merges the PR (arms auto-merge if checks are
   pending). The issue moves to **merged**.

### Flow 2 — the failed run

1. Steps 1–3 as above.
2. The run fails. **No PR.** Mend sums the recording into a failure comment on the issue: what was
   tried, what was observed, reproduction status, run audit link.
3. The card returns to **triage** carrying the failure. A human re-queues (a fresh run; the failed
   recording stays) or closes the issue.

### Flow 3 — iteration on review

1. A reviewer comments on the brief.
2. Mend reads the comment (inference) and decides: follow-up run on the same branch · a question
   back to the reviewer · a verification pass.
3. A follow-up run commits to the same branch; the same draft PR updates.
4. The brief recompiles from all recordings behind the new head. Review continues; nothing merges
   without Gate 2.

### Flow 4 — stale evidence

1. Base moves while the brief sits in review.
2. The brief flips to `evidence stale · <old sha> → <new sha>`. It never silently presents as
   current.
3. One click re-verifies in a fresh workspace against the new base.
4. The brief returns to `evidence current` — or what broke against the new base is now content in
   the brief.

### Flow 5 — the alternate PR mode

1. Steps 1–3 of the happy path; on success **no PR opens**. The brief lives in Mend only.
2. **Gate 2:** approval opens a ready-for-review PR with the brief in its description.
3. The merge decision stays on GitHub.

### Flow 6 — the full loop from the phone

1. Triage and queue from the phone — drag included.
2. Watch a mending card stream.
3. Read the brief in full, open the run audit.
4. Approve and merge. Nothing on mobile is read-only.

## Scope — in (v1)

- Tracker intake: GitHub, Linear, Jira — manual entry before the integrations land.
- The queue with first-class drag-and-drop (`@dnd-kit`).
- One harness per issue via `@sealant/sdk`.
- The brief, one per change, recompiled per run.
- The run audit: milestones · full trace · sources.
- Interface inference: brief compilation, run/failure summaries, comment interpretation — on the
  user's subscriptions, through first-party tools only.
- Draft-PR default and approve-to-merge; the no-PR-until-approval alternate mode.
- Failure comments on the issue.
- Web app; mobile app with the full loop including merge.

## Scope — out, deliberately

These are decisions, not roadmap gaps. Changing any of them is a change to what Mend is.

- **Not a reviewer of arbitrary PRs.** The review is compiled from a recording; a human-written PR
  has no recording, so there is nothing to review it against. Reading the diff and guessing is
  exactly the thing Mend exists to replace.
- **Not a merge bot, not a judge.** No auto-merge, no scores, no "safe to merge", ever — even when
  every review question has direct evidence. Approval is always a human action.
- **Not an orchestrator.** One harness per issue. No multi-agent swarms, no agent picking its own
  backlog, no planner deciding what to work next.
- **Not CI.** Workspace checks are evidence in the brief; CI stays authoritative for what is allowed
  to merge.
- **Not hosted, not an inference provider.** Self-hosted only. Code, runs, and credentials stay on
  your machines; every model call runs on the subscriptions you connected in Sealant.
- **Not coupled to Sealant internals.** Platform access goes through the public `@sealant/sdk` only;
  anything the SDK lacks is recorded in `PLATFORM-FEEDBACK.md`, not worked around.

## Out of v1 — practical limits, revisit deliberately

- Single repo per issue; no cross-repo changes.
- Manual issue entry until the integrations land (GitHub → Linear → Jira, in that order).
- The mobile app follows the web queue (build order in `MEND-PLAN.md` §12).

## Quick scope answers

| Can Mend…                                      | Answer                                                    |
| ---------------------------------------------- | --------------------------------------------------------- |
| review a PR a human wrote?                     | No — no recording, no review.                             |
| merge when every question has direct evidence? | No — approval is always a human action.                   |
| score or grade a change?                       | No — dispositions describe evidence, never quality.       |
| pick the next issue itself?                    | No — a human drags it into the queue.                     |
| retry a failed run on its own?                 | No — it posts a comment; a human re-queues.               |
| open two PRs for one issue?                    | No — one change, one PR, one living brief; runs are many. |
| call models on Mend's own keys?                | No — inference runs on your subscriptions, via Sealant.   |
| let interface inference edit code or merge?    | No — it writes language and routes; harnesses run code.   |
| replace CI?                                    | No — workspace checks are evidence; CI decides.           |
| run as a hosted service?                       | No — self-hosted only.                                    |
| fix an issue spanning two repos?               | Not in v1.                                                |

Vocabulary for everything above is fixed in `MEND-PLAN.md` §9; voice rules in §11. Interface
inference deliberately has no product noun — write "Mend uses inference".
