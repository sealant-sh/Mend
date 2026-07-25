import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { AppShell } from "#/components/shell";
import { postChangeComment, type ReviewCommentDto } from "#/lib/api";
import { changeCommentsQuery, changeDiffQuery, queryClient } from "#/lib/queries";
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
 * The review, v1 (plan §6.4): the diff is primary — file list, unified view
 * with edge-marked lines, change-level comments. Hunk-anchored comments,
 * provenance, and the machine pass layer on from here.
 */
function ChangePage() {
  const { changeId } = Route.useParams();
  const { change, diff, files } = useSuspenseQuery(changeDiffQuery(changeId)).data;
  const comments = useSuspenseQuery(changeCommentsQuery(changeId)).data;
  useWorkbenchEvents();

  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);

  return (
    <AppShell>
      <div className="mx-auto max-w-[1200px]">
        <p className="ev-eyebrow">review</p>
        <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-foreground">
          {change.branch.replace(/^mend\/session\//, "session ")}
        </h1>
        <p className="mt-2 font-mono text-xs text-faint">
          worktree vs {change.baseSha.slice(0, 12)} · {files.length} file
          {files.length === 1 ? "" : "s"} · +{additions} −{deletions} ·{" "}
          <Link
            to="/sessions/$sessionId"
            params={{ sessionId: change.sessionId }}
            className="text-info no-underline"
          >
            session
          </Link>
        </p>

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
            <DiffView diff={diff} />
            <Comments changeId={changeId} comments={comments} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}

type LineKind = "file" | "hunk" | "add" | "del" | "meta" | "ctx";

const kindOf = (line: string): LineKind => {
  if (line.startsWith("diff ") || line.startsWith("index ")) return "file";
  if (line.startsWith("+++") || line.startsWith("---")) return "meta";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "ctx";
};

/** Edge marks, never floods (DESIGN.md §1): 2px edge + faint wash per line. */
function DiffView({ diff }: { readonly diff: string }) {
  if (diff === "") {
    return (
      <div className="rounded-2xl bg-card p-6 shadow-sm">
        <p className="text-sm text-muted-foreground">
          The worktree matches its base — nothing to review yet.
        </p>
      </div>
    );
  }
  const lines = diff.split("\n");
  return (
    <div className="overflow-hidden rounded-2xl bg-card shadow-sm">
      <div className="overflow-x-auto py-2">
        {lines.map((line, index) => {
          const kind = kindOf(line);
          if (kind === "file") {
            return line.startsWith("diff ") ? (
              <p
                key={index}
                className="mt-2 border-y border-rule-faint bg-secondary px-4 py-1.5 font-mono text-[11.5px] font-medium text-ink-2 first:mt-0 first:border-t-0"
              >
                {line.replace(/^diff --git a\/(.*) b\/.*$/, "$1")}
              </p>
            ) : null;
          }
          if (kind === "meta") return null;
          if (kind === "hunk") {
            return (
              <p
                key={index}
                className="bg-[var(--sw-wash)] px-4 py-1 font-mono text-[11px] text-faint"
              >
                {line}
              </p>
            );
          }
          const style =
            kind === "add"
              ? "bg-[var(--sw-add-bg)] border-l-2 border-[var(--sw-add-edge)]"
              : kind === "del"
                ? "bg-[var(--sw-del-bg)] border-l-2 border-[var(--sw-del-edge)]"
                : "border-l-2 border-transparent";
          return (
            <p
              key={index}
              className={`whitespace-pre px-4 font-mono text-xs leading-[1.6] ${style} ${kind === "ctx" ? "text-muted-foreground" : "text-ink-2"}`}
            >
              {line === "" ? " " : line}
            </p>
          );
        })}
      </div>
    </div>
  );
}

function Comments({
  changeId,
  comments,
}: {
  readonly changeId: string;
  readonly comments: ReadonlyArray<ReviewCommentDto>;
}) {
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);

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
      <p className="text-xs font-medium text-label">Review comments</p>
      <div className="mt-3 flex flex-col gap-3">
        {comments.map((comment) => (
          <div key={comment.id} className="rounded-xl bg-card p-4 shadow-xs">
            <p className="font-mono text-[10.5px] text-label">
              {comment.authorKind === "mend" ? "Mend" : comment.authorName}
              {comment.file === null
                ? ""
                : ` · ${comment.file}${comment.line === null ? "" : `:${comment.line}`}`}{" "}
              · {comment.state}
            </p>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{comment.body}</p>
          </div>
        ))}
        <div className="rounded-xl bg-card p-4 shadow-xs">
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Leave a comment on this change…"
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
              {pending ? "Posting…" : "Comment"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
