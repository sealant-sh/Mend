import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { CommentStateActions, EvidenceLines } from "#/components/comment-state";
import { WorkbenchDiff } from "#/components/diff";
import { FollowUpBanner } from "#/components/follow-up";
import { AppShell } from "#/components/shell";
import {
  composeTour,
  createFollowUp,
  postChangeComment,
  readChange,
  type ChangeTourDto,
  type ReviewCommentDto,
  type SessionChangeDto,
} from "#/lib/api";
import {
  changeCommentsQuery,
  changeDiffQuery,
  changeTourQuery,
  pendingFollowUpQuery,
  queryClient,
} from "#/lib/queries";
import { useWorkbenchEvents } from "#/lib/workbench-events";

export const Route = createFileRoute("/changes/$changeId")({
  ssr: false,
  loader: async ({ params }) => {
    await Promise.all([
      queryClient.ensureQueryData(changeDiffQuery(params.changeId)),
      queryClient.ensureQueryData(changeCommentsQuery(params.changeId)),
    ]);
  },
  component: ChangePage,
});

/**
 * The review (plan §6.4, §7.3): the diff is primary; comments anchor to a
 * file and line (click a line) or to the change as a whole; the open comments
 * assemble into a follow-up instruction the user edits before sending — the
 * review-to-agent loop's first half. Provenance and the machine pass layer on
 * from here.
 */
function ChangePage() {
  const { changeId } = Route.useParams();
  const { change, diff, files } = useSuspenseQuery(changeDiffQuery(changeId)).data;
  const comments = useSuspenseQuery(changeCommentsQuery(changeId)).data;
  const followUp = useSuspenseQuery(pendingFollowUpQuery(change.sessionId)).data;
  const [sendOpen, setSendOpen] = useState(false);
  const [focusFile, setFocusFile] = useState<{
    readonly path: string;
    readonly nonce: number;
  } | null>(null);
  // The composed tour: -1 = the overview card, 0..n-1 = stops.
  const tour = useQuery(changeTourQuery(changeId)).data ?? null;
  const [tourIndex, setTourIndex] = useState<number | null>(null);
  const [composing, setComposing] = useState(false);
  useWorkbenchEvents();

  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  const openUnsent = comments.filter(
    (comment) => comment.state === "open" && comment.sentToSessionId === null,
  );

  // Composition finished while we waited (SSE invalidated the query): open
  // the tour at its overview without another click.
  useEffect(() => {
    if (composing && tour !== null) {
      setComposing(false);
      setTourIndex(-1);
    }
  }, [composing, tour]);

  const goToStop = (index: number) => {
    if (tour === null) return;
    const stop = tour.stops[index];
    if (stop === undefined) return;
    setTourIndex(index);
    if (stop.file !== null) setFocusFile({ path: stop.file, nonce: Date.now() });
  };

  const startTour = () => {
    if (tour !== null) {
      setTourIndex(-1);
      return;
    }
    setComposing(true);
    void composeTour(changeId).catch(() => setComposing(false));
  };

  const activeStop =
    tour !== null && tourIndex !== null && tourIndex >= 0 ? (tour.stops[tourIndex] ?? null) : null;
  const tourMarker =
    activeStop !== null && activeStop.file !== null && activeStop.line !== null
      ? {
          file: activeStop.file,
          line: activeStop.line,
          endLine: activeStop.endLine,
          title: activeStop.title,
          narration: activeStop.narration,
          nonce: tourIndex ?? 0,
        }
      : null;

  return (
    <AppShell>
      <div className="mx-auto max-w-[1200px]">
        <p className="ev-eyebrow">review</p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
          <h1 className="font-display text-3xl font-medium tracking-tight text-foreground">
            {change.branch.replace(/^mend\/session\//, "session ")}
          </h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={files.length === 0 || composing}
              onClick={startTour}
              title="Mend reads the diff and the session record and composes the guided walkthrough"
              className="rounded-xl border border-border bg-card px-4 py-2 font-sans text-sm font-medium text-foreground shadow-xs transition-transform hover:-translate-y-0.5 disabled:opacity-60"
            >
              {composing ? "Mend is composing the tour…" : "Tour this change"}
            </button>
            <ReadChangeButton changeId={changeId} />
            <button
              type="button"
              disabled={openUnsent.length === 0}
              onClick={() => setSendOpen(true)}
              className="rounded-xl bg-primary px-4 py-2 font-sans text-sm font-medium text-primary-foreground shadow-[var(--shadow-cobalt)] transition-opacity disabled:opacity-50"
            >
              Send review to session
            </button>
          </div>
        </div>
        <p className="mt-2 font-mono text-xs text-faint">
          worktree vs {change.baseSha.slice(0, 12)} · {files.length} file
          {files.length === 1 ? "" : "s"} · +{additions} −{deletions} · {openUnsent.length} open
          comment{openUnsent.length === 1 ? "" : "s"} ·{" "}
          <Link
            to="/sessions/$sessionId"
            params={{ sessionId: change.sessionId }}
            className="text-info no-underline"
          >
            session
          </Link>
        </p>
        <FollowUpBanner sessionId={change.sessionId} followUp={followUp} />

        {tour !== null && tourIndex !== null && (
          <TourPanel
            tour={tour}
            index={tourIndex}
            onGo={goToStop}
            onOverview={() => setTourIndex(-1)}
            onEnd={() => setTourIndex(null)}
          />
        )}

        <div className="mt-8 grid items-start gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          {/* The sidebar owns navigation AND the change-level comment surface —
              both stay in the viewport; only the file list scrolls internally. */}
          <section className="sticky top-6 flex max-h-[calc(100vh-10rem)] min-h-0 flex-col self-start">
            <p className="text-xs font-medium text-label">Files</p>
            <div className="mt-3 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
              {files.length === 0 ? (
                <p className="font-mono text-xs text-faint">no changes yet</p>
              ) : (
                files.map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => setFocusFile({ path: file.path, nonce: Date.now() })}
                    className="rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-secondary"
                  >
                    <p className="truncate font-mono text-[11.5px] text-ink-2">{file.path}</p>
                    <p className="font-mono text-[10.5px] text-faint">
                      +{file.additions} −{file.deletions}
                    </p>
                  </button>
                ))
              )}
            </div>
            <ChangeComments changeId={changeId} comments={comments} />
          </section>

          <div className="min-w-0">
            <WorkbenchDiff
              diff={diff}
              changeId={changeId}
              comments={comments}
              stats={files}
              focus={focusFile}
              tourMarker={tourMarker}
            />
          </div>
        </div>
      </div>

      {sendOpen && (
        <SendReviewDialog
          change={change}
          comments={openUnsent}
          onClose={() => setSendOpen(false)}
        />
      )}
    </AppShell>
  );
}

/**
 * The composed tour's walking surface: the overview first (what the change
 * is, how the session went about it), then the stops in Mend's chosen order —
 * each narrated, evidence-linked or honestly marked as inferred reading, and
 * circled in the diff below when it points at a region.
 */
function TourPanel({
  tour,
  index,
  onGo,
  onOverview,
  onEnd,
}: {
  readonly tour: ChangeTourDto;
  readonly index: number;
  readonly onGo: (index: number) => void;
  readonly onOverview: () => void;
  readonly onEnd: () => void;
}) {
  const stop = index >= 0 ? (tour.stops[index] ?? null) : null;
  return (
    <div className="sticky top-3 z-30 mt-5 rounded-2xl border border-[color-mix(in_oklab,var(--sw-accent)_35%,transparent)] bg-card px-5 py-4 shadow-md">
      {stop === null ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-[11px] text-label">
              Mend&apos;s tour · {tour.stops.length} stop{tour.stops.length === 1 ? "" : "s"} ·
              composed {new Date(tour.createdAt).toLocaleTimeString()}
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => onGo(0)}
                className="rounded-xl bg-primary px-3.5 py-1.5 font-sans text-xs font-medium text-primary-foreground shadow-[var(--shadow-cobalt)]"
              >
                Start walking →
              </button>
              <button
                type="button"
                onClick={onEnd}
                className="font-sans text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Close
              </button>
            </div>
          </div>
          <p className="mt-3 text-[14px] leading-relaxed text-foreground">{tour.summary}</p>
          {tour.approach !== null && (
            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
              <span className="font-mono text-[10.5px] text-label">from the record · </span>
              {tour.approach}
            </p>
          )}
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-label">
              stop {index + 1}/{tour.stops.length}
              {stop.file === null ? "" : ` · ${stop.file}`}
              {stop.line === null
                ? ""
                : `:${stop.line}${stop.endLine === null ? "" : `–${stop.endLine}`}`}
              {stop.grounded ? "" : " · inferred reading"}
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={index === 0 ? onOverview : () => onGo(index - 1)}
                className="font-sans text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                ← {index === 0 ? "Overview" : "Prev"}
              </button>
              <button
                type="button"
                disabled={index >= tour.stops.length - 1}
                onClick={() => onGo(index + 1)}
                className="rounded-xl border border-border bg-card px-3 py-1 font-sans text-xs font-medium text-foreground shadow-xs disabled:opacity-40"
              >
                Next →
              </button>
              <button
                type="button"
                onClick={onEnd}
                className="font-sans text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                End
              </button>
            </div>
          </div>
          <p className="mt-2 font-sans text-sm font-medium text-foreground">{stop.title}</p>
          <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">{stop.narration}</p>
          {stop.evidence.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              {stop.evidence.map((link, evidenceIndex) => (
                <p key={evidenceIndex} className="truncate font-mono text-[10.5px] text-faint">
                  seq {link.sequence} · <span className="text-ink-2">{link.excerpt}</span>
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * "Read this change" (plan §7.3): Mend reads the diff against the record and
 * drafts evidence-linked findings. The pass runs asynchronously; drafts land
 * as comments over SSE, each awaiting accept/edit/dismiss. On-demand only —
 * the human loop is never gated on the machine pass.
 */
function ReadChangeButton({ changeId }: { readonly changeId: string }) {
  const [state, setState] = useState<"idle" | "queueing" | "reading">("idle");
  const request = () => {
    setState("queueing");
    void readChange(changeId)
      .then(() => setState("reading"))
      .catch(() => setState("idle"));
  };
  return (
    <button
      type="button"
      disabled={state !== "idle"}
      onClick={request}
      title="Mend reads the diff against the session record and drafts evidence-linked findings"
      className="rounded-xl border border-border bg-card px-4 py-2 font-sans text-sm font-medium text-foreground shadow-xs transition-transform hover:-translate-y-0.5 disabled:opacity-60"
    >
      {state === "reading"
        ? "Mend is reading — drafts land below"
        : state === "queueing"
          ? "…"
          : "Read this change"}
    </button>
  );
}

// ─── Change-level comments ──────────────────────────────────────────────────

function ChangeComments({
  changeId,
  comments,
}: {
  readonly changeId: string;
  readonly comments: ReadonlyArray<ReviewCommentDto>;
}) {
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const changeLevel = comments.filter((comment) => comment.file === null);

  const submit = () => {
    if (body.trim() === "") return;
    setPending(true);
    void postChangeComment(changeId, { file: null, line: null, body: body.trim() })
      .then(() => {
        setBody("");
        return queryClient.invalidateQueries({ queryKey: ["change", changeId] });
      })
      .finally(() => setPending(false));
  };

  return (
    <section className="mt-6">
      <p className="text-xs font-medium text-label">Change-level comments</p>
      <div className="mt-3 flex max-h-56 flex-col gap-3 overflow-y-auto">
        {changeLevel.map((comment) => (
          <div
            key={comment.id}
            className={`rounded-xl bg-card p-3 shadow-xs ${comment.state === "dismissed" ? "opacity-60" : ""}`}
          >
            <p className="font-mono text-[10.5px] text-label">
              {comment.authorKind === "mend" ? "Mend" : comment.authorName} ·{" "}
              {comment.sentToSessionId === null ? comment.state : "sent to session"}
            </p>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{comment.body}</p>
            <EvidenceLines comment={comment} />
            <CommentStateActions comment={comment} />
          </div>
        ))}
        <div className="rounded-xl bg-card p-3 shadow-xs">
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Comment on the change as a whole…"
            rows={2}
            className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 font-sans text-sm text-foreground placeholder:text-faint"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              disabled={pending || body.trim() === ""}
              onClick={submit}
              className="rounded-xl bg-primary px-3.5 py-1.5 font-sans text-sm font-medium text-primary-foreground shadow-[var(--shadow-cobalt)] transition-opacity disabled:opacity-50"
            >
              Comment
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Send review to session ─────────────────────────────────────────────────

const assembleInstruction = (
  change: SessionChangeDto,
  comments: ReadonlyArray<ReviewCommentDto>,
) => {
  const points = comments
    .map((comment, index) => {
      const anchor =
        comment.file === null
          ? "the change as a whole"
          : `${comment.file}${comment.line === null ? "" : `:${comment.line}${comment.endLine === null || comment.endLine === comment.line ? "" : `-${comment.endLine}`}`}`;
      return `${index + 1}. ${anchor} — ${comment.body}`;
    })
    .join("\n");
  return `This is a follow-up on your earlier work in this worktree, responding to review feedback. The branch ${change.branch} is already checked out with your work on it: keep working there, and do not start a new branch or reset it.

Review comments:
${points}

Address each point using your own judgment about how. Check your work with the repository's own build, tests, or typecheck; a check that still fails is something to report, not to force green. Report honestly what you changed and what you did not — if a point cannot or should not be done, say so plainly.`;
};

/** The plan's rule (§7.3): the user inspects and edits the instruction before sending. */
function SendReviewDialog({
  change,
  comments,
  onClose,
}: {
  readonly change: SessionChangeDto;
  readonly comments: ReadonlyArray<ReviewCommentDto>;
  readonly onClose: () => void;
}) {
  const [instruction, setInstruction] = useState(() => assembleInstruction(change, comments));
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  const send = () => {
    setPending(true);
    void createFollowUp(change.sessionId, instruction)
      .then(() => {
        setSent(true);
        return Promise.all([
          queryClient.invalidateQueries({ queryKey: ["change", change.id] }),
          queryClient.invalidateQueries({ queryKey: ["session", change.sessionId] }),
        ]);
      })
      .finally(() => setPending(false));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-6"
      style={{ background: "color-mix(in oklab, var(--sw-ink) 32%, transparent)" }}
      onClick={onClose}
    >
      <div
        className="mt-16 w-full max-w-[640px] rounded-2xl bg-background p-6 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        {sent ? (
          <>
            <p className="font-sans text-base font-medium text-foreground">
              Follow-up saved for the session
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Deliver it with the <span className="font-medium">Deliver &amp; relaunch</span> button
              on this page or the session page (or{" "}
              <span className="font-mono text-xs text-ink-2">mend continue</span> from a terminal).
              The comments in the bundle are marked sent; they stay open until the work addresses
              them.
            </p>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl bg-primary px-4 py-2 font-sans text-sm font-medium text-primary-foreground"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="font-sans text-base font-medium text-foreground">
              Send review to the session
            </p>
            <p className="mt-1 font-mono text-[11px] text-faint">
              assembled from {comments.length} comment{comments.length === 1 ? "" : "s"} · resumes{" "}
              {change.branch}
            </p>
            <p className="mt-4 text-xs font-medium text-label">Instruction — edit before sending</p>
            <textarea
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              rows={14}
              className="mt-2 w-full resize-y rounded-xl border border-input bg-card px-4 py-3 font-sans text-[13.5px] leading-relaxed text-ink-2"
            />
            <p className="mt-2 font-mono text-[10.5px] text-faint">
              assembled mechanically from your comments; edit freely — what you send is verbatim
              what the session receives
            </p>
            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="font-sans text-sm font-medium text-muted-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={pending || instruction.trim() === ""}
                onClick={send}
                className="rounded-xl bg-primary px-4 py-2 font-sans text-sm font-medium text-primary-foreground shadow-[var(--shadow-cobalt)] transition-opacity disabled:opacity-50"
              >
                {pending ? "Sending…" : "Send to session"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
