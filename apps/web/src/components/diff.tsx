import { parsePatchFiles, type DiffLineAnnotation } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useMemo, useState } from "react";

import { postChangeComment, type ReviewCommentDto } from "#/lib/api";
import { queryClient } from "#/lib/queries";

/**
 * The workbench diff, rendered by @pierre/diffs (Shiki highlighting, their
 * renderer's performance) and skinned by us: the surrounding chrome is
 * Evidence Review, and review comments ride the library's annotation
 * framework — one annotation per anchored comment, plus one for the open
 * composer. Line numbers anchor to the new file; deletions are not
 * commentable (their lines no longer exist to anchor to).
 */

type Annotation =
  | { readonly kind: "comment"; readonly comment: ReviewCommentDto }
  | { readonly kind: "composer"; readonly file: string; readonly line: number };

export function WorkbenchDiff({
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
  const files = useMemo(() => parsePatchFiles(diff).flatMap((patch) => patch.files), [diff]);

  if (diff === "") {
    return (
      <div className="rounded-2xl bg-card p-6 shadow-sm">
        <p className="text-sm text-muted-foreground">
          The worktree matches its base — nothing to review yet.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {files.map((file) => {
        const annotations: Array<DiffLineAnnotation<Annotation>> = comments
          .filter((comment) => comment.file === file.name && comment.line !== null)
          .map((comment) => ({
            side: "additions",
            lineNumber: comment.line ?? 0,
            metadata: { kind: "comment", comment },
          }));
        if (composer !== null && composer.file === file.name) {
          annotations.push({
            side: "additions",
            lineNumber: composer.line,
            metadata: { kind: "composer", file: composer.file, line: composer.line },
          });
        }
        return (
          <div key={file.name} className="overflow-hidden rounded-2xl bg-card shadow-sm">
            <FileDiff<Annotation>
              fileDiff={file}
              lineAnnotations={annotations}
              options={{
                diffStyle: "unified",
                theme: { light: "pierre-light", dark: "pierre-dark" },
                lineHoverHighlight: "line",
                onLineClick: (props) => {
                  // Anchor to the new file; a deleted line has nothing to anchor to.
                  if (props.lineType === "change-deletion") return;
                  setComposer({ file: file.name, line: props.lineNumber });
                },
              }}
              renderAnnotation={(annotation) =>
                annotation.metadata.kind === "comment" ? (
                  <InlineComment comment={annotation.metadata.comment} />
                ) : (
                  <InlineComposer
                    changeId={changeId}
                    file={annotation.metadata.file}
                    line={annotation.metadata.line}
                    onDone={() => setComposer(null)}
                  />
                )
              }
            />
          </div>
        );
      })}
    </div>
  );
}

function InlineComment({ comment }: { readonly comment: ReviewCommentDto }) {
  return (
    <div className="mx-4 my-2 rounded-xl border border-border bg-background p-3 font-sans shadow-xs">
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
    <div className="mx-4 my-2 rounded-xl border border-[color-mix(in_oklab,var(--sw-accent)_35%,transparent)] bg-background p-3 font-sans shadow-xs">
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
