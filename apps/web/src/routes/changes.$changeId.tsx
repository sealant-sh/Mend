import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { AppShell } from "#/components/shell";
import {
  createFollowUp,
  postChangeComment,
  type ReviewCommentDto,
  type SessionChangeDto,
} from "#/lib/api";
import {
  changeCommentsQuery,
  changeDiffQuery,
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
  useWorkbenchEvents();

  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  const openUnsent = comments.filter(
    (comment) => comment.state === "open" && comment.sentToSessionId === null,
  );

  return (
    <AppShell>
      <div className="mx-auto max-w-[1200px]">
        <p className="ev-eyebrow">review</p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
          <h1 className="font-display text-3xl font-medium tracking-tight text-foreground">
            {change.branch.replace(/^mend\/session\//, "session ")}
          </h1>
          <button
            type="button"
            disabled={openUnsent.length === 0}
            onClick={() => setSendOpen(true)}
            className="rounded-xl bg-primary px-4 py-2 font-sans text-sm font-medium text-primary-foreground shadow-[var(--shadow-cobalt)] transition-opacity disabled:opacity-50"
          >
            Send review to session
          </button>
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
        {followUp !== null && (
          <p className="mt-3 font-mono text-xs text-warning">
            follow-up pending — resume the session with{" "}
            <span className="text-ink-2">mend continue</span> in a terminal
          </p>
        )}

        <div className="mt-8 grid items-start gap-6 lg:grid-cols-[220px_1fr]">
          <section>
            <p className="text-xs font-medium text-label">Files</p>
            <div className="mt-3 flex flex-col gap-1">
              {files.length === 0 ? (
                <p className="font-mono text-xs text-faint">no changes yet</p>
              ) : (
                files.map((file) => (
                  <div key={file.path} className="rounded-lg px-2.5 py-1.5">
                    <p className="truncate font-mono text-[11.5px] text-ink-2">{file.path}</p>
                    <p className="font-mono text-[10.5px] text-faint">
                      +{file.additions} −{file.deletions}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>

          <div className="min-w-0">
            <DiffView diff={diff} changeId={changeId} comments={comments} />
            <ChangeComments changeId={changeId} comments={comments} />
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

// ─── The diff, line-addressed ───────────────────────────────────────────────

interface DiffRow {
  readonly kind: "file" | "hunk" | "add" | "del" | "ctx";
  readonly text: string;
  readonly file: string | null;
  /** Line number in the new file — the comment anchor. Null for deletions. */
  readonly line: number | null;
}

const parseDiff = (diff: string): ReadonlyArray<DiffRow> => {
  const rows: Array<DiffRow> = [];
  let file: string | null = null;
  let line = 0;
  for (const text of diff.split("\n")) {
    if (text.startsWith("diff --git ")) {
      file = text.replace(/^diff --git a\/.* b\/(.*)$/, "$1").replace(/^\/dev\/null b\//, "");
      rows.push({ kind: "file", text: file, file, line: null });
      continue;
    }
    if (text.startsWith("+++") || text.startsWith("---") || text.startsWith("index ")) continue;
    if (text.startsWith("new file mode") || text.startsWith("deleted file mode")) continue;
    if (text.startsWith("@@")) {
      const match = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(text);
      line = match?.[1] === undefined ? 0 : Number(match[1]);
      rows.push({ kind: "hunk", text, file, line: null });
      continue;
    }
    if (text.startsWith("+")) {
      rows.push({ kind: "add", text, file, line });
      line += 1;
      continue;
    }
    if (text.startsWith("-")) {
      rows.push({ kind: "del", text, file, line: null });
      continue;
    }
    rows.push({ kind: "ctx", text, file, line });
    line += 1;
  }
  return rows;
};

/** Edge marks, never floods; click an addition or context line to anchor a comment. */
function DiffView({
  diff,
  changeId,
  comments,
}: {
  readonly diff: string;
  readonly changeId: string;
  readonly comments: ReadonlyArray<ReviewCommentDto>;
}) {
  const [composer, setComposer] = useState<{ readonly file: string; readonly line: number } | null>(
    null,
  );
  if (diff === "") {
    return (
      <div className="rounded-2xl bg-card p-6 shadow-sm">
        <p className="text-sm text-muted-foreground">
          The worktree matches its base — nothing to review yet.
        </p>
      </div>
    );
  }
  const rows = parseDiff(diff);
  const anchored = new Map<string, Array<ReviewCommentDto>>();
  for (const comment of comments) {
    if (comment.file !== null && comment.line !== null) {
      const key = `${comment.file}:${comment.line}`;
      anchored.set(key, [...(anchored.get(key) ?? []), comment]);
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-card shadow-sm">
      <div className="overflow-x-auto py-2">
        {rows.map((row, index) => {
          if (row.kind === "file") {
            return (
              <p
                key={index}
                className="mt-2 border-y border-rule-faint bg-secondary px-4 py-1.5 font-mono text-[11.5px] font-medium text-ink-2 first:mt-0 first:border-t-0"
              >
                {row.text}
              </p>
            );
          }
          if (row.kind === "hunk") {
            return (
              <p
                key={index}
                className="bg-[var(--sw-wash)] px-4 py-1 font-mono text-[11px] text-faint"
              >
                {row.text}
              </p>
            );
          }
          const commentable = row.file !== null && row.line !== null;
          const key = commentable ? `${row.file}:${row.line}` : null;
          const style =
            row.kind === "add"
              ? "bg-[var(--sw-add-bg)] border-l-2 border-[var(--sw-add-edge)]"
              : row.kind === "del"
                ? "bg-[var(--sw-del-bg)] border-l-2 border-[var(--sw-del-edge)]"
                : "border-l-2 border-transparent";
          return (
            <div key={index}>
              <div
                className={`group flex ${style} ${commentable ? "cursor-pointer hover:bg-[var(--sw-wash)]" : ""}`}
                onClick={
                  commentable
                    ? () => setComposer({ file: row.file ?? "", line: row.line ?? 0 })
                    : undefined
                }
                title={commentable ? "Comment on this line" : undefined}
              >
                <span className="w-12 shrink-0 select-none pr-3 text-right font-mono text-[10.5px] leading-[1.7] text-faint">
                  {row.line ?? ""}
                </span>
                <span
                  className={`whitespace-pre pr-4 font-mono text-xs leading-[1.7] ${row.kind === "ctx" ? "text-muted-foreground" : "text-ink-2"}`}
                >
                  {row.text === "" ? " " : row.text}
                </span>
              </div>
              {key !== null &&
                (anchored.get(key) ?? []).map((comment) => (
                  <InlineComment key={comment.id} comment={comment} />
                ))}
              {composer !== null &&
                composer.file === row.file &&
                composer.line === row.line &&
                commentable && (
                  <InlineComposer
                    changeId={changeId}
                    file={composer.file}
                    line={composer.line}
                    onDone={() => setComposer(null)}
                  />
                )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InlineComment({ comment }: { readonly comment: ReviewCommentDto }) {
  return (
    <div className="mx-12 my-2 rounded-xl border border-border bg-background p-3 shadow-xs">
      <p className="font-mono text-[10.5px] text-label">
        {comment.authorKind === "mend" ? "Mend" : comment.authorName} · line {comment.line} ·{" "}
        {comment.sentToSessionId === null ? comment.state : "sent to session"}
      </p>
      <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">{comment.body}</p>
    </div>
  );
}

function InlineComposer({
  changeId,
  file,
  line,
  onDone,
}: {
  readonly changeId: string;
  readonly file: string;
  readonly line: number;
  readonly onDone: () => void;
}) {
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);

  const submit = () => {
    if (body.trim() === "") return;
    setPending(true);
    void postChangeComment(changeId, { file, line, body: body.trim() })
      .then(() => queryClient.invalidateQueries({ queryKey: ["change", changeId] }))
      .then(onDone)
      .finally(() => setPending(false));
  };

  return (
    <div className="mx-12 my-2 rounded-xl border border-[color-mix(in_oklab,var(--sw-accent)_35%,transparent)] bg-background p-3 shadow-xs">
      <p className="font-mono text-[10.5px] text-label">
        comment · {file}:{line}
      </p>
      <textarea
        autoFocus
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={2}
        className="mt-2 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 font-sans text-sm text-foreground"
      />
      <div className="mt-2 flex justify-end gap-3">
        <button
          type="button"
          onClick={onDone}
          className="font-sans text-sm font-medium text-muted-foreground"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={pending || body.trim() === ""}
          onClick={submit}
          className="rounded-xl bg-primary px-3.5 py-1.5 font-sans text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          Comment
        </button>
      </div>
    </div>
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
    <section className="mt-8 max-w-[760px]">
      <p className="text-xs font-medium text-label">Change-level comments</p>
      <div className="mt-3 flex flex-col gap-3">
        {changeLevel.map((comment) => (
          <div key={comment.id} className="rounded-xl bg-card p-4 shadow-xs">
            <p className="font-mono text-[10.5px] text-label">
              {comment.authorKind === "mend" ? "Mend" : comment.authorName} ·{" "}
              {comment.sentToSessionId === null ? comment.state : "sent to session"}
            </p>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{comment.body}</p>
          </div>
        ))}
        <div className="rounded-xl bg-card p-4 shadow-xs">
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Comment on the change as a whole…"
            rows={3}
            className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 font-sans text-sm text-foreground placeholder:text-faint"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              disabled={pending || body.trim() === ""}
              onClick={submit}
              className="rounded-xl bg-primary px-4 py-2 font-sans text-sm font-medium text-primary-foreground shadow-[var(--shadow-cobalt)] transition-opacity disabled:opacity-50"
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
          : `${comment.file}${comment.line === null ? "" : `:${comment.line}`}`;
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
              The session picks it up next time it runs — from a terminal:{" "}
              <span className="font-mono text-xs text-ink-2">mend continue</span>. The comments in
              the bundle are marked sent; they stay open until the work addresses them.
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
