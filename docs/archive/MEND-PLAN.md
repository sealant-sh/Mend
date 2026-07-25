> **SUPERSEDED · 2026-07-25** — This document describes the retired issue-to-PR / queue direction.
> The canonical direction is [`MEND-AGENT-WORKBENCH-PLAN.md`](../../MEND-AGENT-WORKBENCH-PLAN.md) at
> the repo root; where they conflict, the plan wins. Kept as design history — do not implement
> against this. Reusable pieces are mapped in the plan §10.

# MEND-PLAN

The product definition. Decisions here were made deliberately; change them deliberately.

## 1. The problem

AI made code cheap to write and expensive to trust. Agents produce more changes than anyone reviews;
the changes arrive with a summary written by the same model that made them, from a workspace that no
longer exists. So teams do one of two bad things: merge agent PRs unread, or let them pile up
unreviewed. The bottleneck of AI-assisted development is no longer writing the fix — it is deciding
whether to merge it.

Mend is approached **from this problem**, never from the technology. "We record evidence" is not a
product. What matters is what the evidence is used for.

## 2. What Mend is

**Mend takes an issue from your tracker, has a coding agent fix it in a recorded workspace, and then
reviews the resulting change against that recording — delivering a pull request whose review is
already done, grounded in what actually happened.**

The shape is issue → PR. The product is **the review**.

## 3. The differentiator

Every other reviewer of AI code — human or bot (Copilot review, CodeRabbit, Greptile, …) — reads the
diff and guesses. Mend watched the change get made. Its review is compiled from a runtime-level
recording of the run: proofs it executed, tests it observed, sources the agent read, paths it knows
were never exercised. The review is a report of what happened plus checks Mend actually ran — not
another model's opinion about a diff.

The hero states this in full:

> **Code is now cheap. Trust is not.** Mend reviews every change against a full recording of how it
> was made. Everything else reads the diff and guesses.

## 4. Who it's for

The reviewer-maintainer: the person whose name is on the merge button. A senior engineer, tech lead,
or OSS maintainer who could delegate issues to agents today but won't, because every agent PR is
either blind trust or an afternoon of re-derivation. Secondary: teams that need to answer "what did
the agent actually do" after the fact.

## 5. The loop and its gates

```
triage → queued → mending → review → merged
```

- **Issue intake:** GitHub, Linear, or Jira. The tracker is an input, not the identity. PRs live on
  GitHub; issues come from anywhere.
- **Gate 1 — what gets worked:** a human drags an issue from triage into the queue and orders it.
  Mend never picks its own work.
- **Mending:** one harness per issue in a Sealant workspace; the run streams live onto the issue's
  card and is recorded durably.
- **PR timing (configurable):**
  - **Default:** every successful run opens a **draft PR immediately**; the brief is posted into the
    PR description with deep links back to Mend. CI runs against the draft from minute one and its
    results join the brief as corroborating evidence.
  - **Gate 2 — approving in Mend merges the PR on GitHub**, respecting branch protection (arms
    auto-merge if checks are pending).
  - **Alternate mode:** no PR until approval; approval opens a ready-for-review PR and the merge
    stays on GitHub. Two modes only.
- **Failed runs:** no PR. Mend posts a failure comment on the issue — a mini-brief: what was tried,
  what was observed, reproduction status, link to the run audit. Failures are evidence too.
- **Iteration:** stays in Mend, with inference running throughout (via Sealant, on the user's
  connected subscriptions). A reviewer comment on the brief is read by Mend (inference), which
  decides the next action: follow-up run on the same branch, a question back to the reviewer, a
  verification pass. Interface inference writes language and routes actions through a closed set of
  first-party tools; code changes are always a new harness run. New commits land on the same draft
  PR; the brief recompiles.
- **Evidence freshness:** if base moves while a brief sits in review, it flips to
  `evidence stale · <old sha> → <new sha>` with one-click re-verification in a fresh workspace.

## 6. Scope

**In (v1):** tracker intake (GitHub/Linear/Jira; manual entry before integrations land) · the queue
with first-class drag-and-drop (@dnd-kit) · one harness per issue via `@sealant/sdk` · the brief per
run · the run audit (milestones / full trace / sources) · draft-PR default + approve-to-merge ·
failure comments · web app · mobile app with the **full loop including merge**.

**Out — explicitly:**

- **Not a reviewer of arbitrary PRs.** No recording, no review. Human-written PRs are out unless
  that changes deliberately.
- **Not a merge bot, not a judge.** No auto-merge, no scores, no "safe to merge", ever.
- **Not an orchestrator.** No multi-agent swarms; no agent picks its own backlog.
- **Not CI.** Workspace checks are evidence; CI stays authoritative.
- **Not hosted.** Self-hosted only; code, runs, and credentials stay on your machines.
- v1 practical limits: single repo per issue; no cross-repo changes.

## 7. The brief (the product noun)

The review Mend already did, compiled from the recording. Anatomy (canonical mock: `apps/marketing`
brief exhibit):

- **Header:** repo · PR ref · issue ref · `Checks N` · head sha · `Evidence current/stale` · Full
  diff · Run audit.
- **The causal proof:** `base fails · head passes · revert fails` — the fix demonstrably fixes the
  issue, not "CI is green".
- **The issue:** restated in one line with the failing reproduction in mono.
- **What was done / Status now:** plain sentences + mono facts
  (`3 files · +41 / −22 · no API, schema, dependency, or provider-contract changes`).
- **Review questions:** the review decomposed into numbered questions, each with a disposition —
  `direct evidence` (green) · `not executed` (amber) · `unrelated change` (red).
- **What needs attention:** the amber/red edge callouts, first-class, never fine print.
- **Evidence used:** each source with what it established; totals + link to the source trail.
- **Footer:** `N review questions · N have direct evidence · N need judgment` + the one action.

## 8. The run audit and the source trail

The deep view behind the brief: milestones, full trace, and **sources** — every source the agent
opened, grouped `relied on / consulted / contradicted / discarded`, each with why it was opened,
what the agent took from it, where it was used, and provenance chips
(`reference only · no code copied · <license> · archived snapshot available`).

## 9. Vocabulary

| Thing               | Word                                              | Notes                                                                      |
| ------------------- | ------------------------------------------------- | -------------------------------------------------------------------------- |
| The act             | mend / mending                                    | the brand verb                                                             |
| The environment     | workspace                                         | never "sandbox" (over-claims)                                              |
| The prepared review | **the brief**                                     | the most-used noun                                                         |
| The deep view       | **the run audit**                                 | milestones · full trace · sources                                          |
| The causal proof    | `base fails · head passes · revert fails`         | keep raw and mono                                                          |
| Dispositions        | direct evidence · not executed · unrelated change | green/amber/red, earned only                                               |
| Event provenance    | observed · inferred                               | runtime saw it vs. harness claimed                                         |
| Interface inference | no noun — "Mend uses inference"                   | never edits code; user's subscriptions via Sealant; first-party tools only |
| Freshness           | evidence current · evidence stale                 | real product state                                                         |
| Attribution         | Mend, by Sealant                                  | Sealant = "the runtime underneath"                                         |

## 10. Principles

1. Mend performs the review; it never makes the merge decision. Two human gates, always.
2. Every claim links to observed evidence or is flagged not-run/inferred. Gaps are content.
3. Failures are kept and reported, not hidden.
4. Platform access through the public `@sealant/sdk` only; gaps go to `PLATFORM-FEEDBACK.md`.
5. Self-hosted; nothing leaves your infrastructure.

## 11. Voice

Written for a developer who meets Mend before Sealant, and who distrusts marketing.

- Approach from the problem, never the tech. Answer "why does this exist" and "what makes it
  special" before "how it works".
- Plain declarative sentences; concrete, verifiable claims; mono for machine facts.
- No sales register: no "safe to merge", no confidence language, no benefit-clause selling ("you
  make the call"), no slogan pileups, no adoption nudges beyond a single ask.
- Honest status everywhere: "In development", "In design", failures shown.
- Sealant appears as one clause — "an open-source runtime" — and a link. Never pitched.
- Same Evidence Review design language as Sealant, **never the same layout** (hero especially).

## 12. Build order & status

1. **Marketing page** — rebuilt against this plan (in progress).
2. **apps/web** — the queue against manually-entered tasks; Effect services; @dnd-kit.
3. **Integrations** — GitHub PRs first; issue intake GitHub → Linear → Jira; the Effect service seam
   designed early.
4. **Mobile app** — after the web queue proves the surfaces.
