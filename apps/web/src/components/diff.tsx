import {
  parsePatchFiles,
  registerCustomCSSVariableTheme,
  type DiffLineAnnotation,
  type SelectedLineRange,
} from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { postChangeComment, type ReviewCommentDto } from "#/lib/api";
import { queryClient } from "#/lib/queries";

/**
 * The workbench diff, rendered by @pierre/diffs (Shiki highlighting, their
 * renderer's performance) and skinned by us. The reading surface is ONE
 * scroll container — the page never grows with the diff — with our own
 * sticky, collapsible file header per file (Pierre's header is disabled).
 * Review comments ride the library's annotation framework; commenting
 * anchors to a single line (click) or a line RANGE (drag across gutter
 * lines), always on the new file — deletions have nothing to anchor to.
 */

type Annotation =
  | { readonly kind: "comment"; readonly comment: ReviewCommentDto }
  | { readonly kind: "composer"; readonly anchor: CommentAnchor };

interface CommentAnchor {
  readonly file: string;
  readonly line: number;
  readonly endLine: number | null;
}

/**
 * The Evidence Review syntax theme: token colors come from `--diffs-*` CSS
 * variables (defined in styles.css against our tokens), so one registration
 * serves light and dark and the palette lives with the rest of the design
 * system. The defaults below only cover a variable failing to resolve.
 */
registerCustomCSSVariableTheme("evidence-review", {
  foreground: "#3b3b40",
  background: "transparent",
  "token-comment": "#9a9aa2",
  "token-keyword": "#7a4f33",
  "token-string": "#55705e",
  "token-string-expression": "#55705e",
  "token-constant": "#6f5a8e",
  "token-function": "#1b1b1d",
  "token-punctuation": "#6e6e76",
  "token-link": "#3b5a92",
});

/**
 * Injected into their shadow root: the EV edge-mark discipline (2px edge,
 * never a flood) — and a visible ::selection. The page's selection style
 * cannot pierce the shadow DOM, so without this, dragging over code selects
 * invisibly: the worst of both worlds. Text selection (anywhere, for copying)
 * and line selection (gutter drag, for range comments) now both paint.
 */
const EDGE_MARK_CSS = `
[data-line-type="change-addition"] { box-shadow: inset 2px 0 0 var(--sw-add-edge, #2e7d46); }
[data-line-type="change-deletion"] { box-shadow: inset 2px 0 0 var(--sw-del-edge, #c0362c); }
::selection { background: color-mix(in oklab, var(--sw-accent, #2052cc) 30%, transparent); }
/* The library's selection vars style BACKGROUNDS only; the selected-number
   FOREGROUND derives from the (purple) modified ramp — unreadable on our
   cobalt band. Ink, explicitly (matches the source's own selector). */
[data-gutter-buffer][data-selected-line],
[data-column-number][data-selected-line],
[data-column-number][data-editor-active-line] {
  color: var(--sw-ink, #1b1b1d);
}
`;

/**
 * Map the user's TEXT selection (anywhere in the code) to the line range it
 * spans, reading the shadow DOM selection the way the library's own editor
 * does: `ShadowRoot.getSelection()` on Blink/WebKit, `getComposedRanges`
 * where spec'd. Rows carry their new-file line number as `data-line`;
 * deletion rows are skipped (nothing to anchor to).
 */
const selectedLineSpan = (wrapper: HTMLElement): { start: number; end: number } | null => {
  const host = wrapper.querySelector("diffs-container");
  const shadowRoot = host?.shadowRoot ?? null;
  if (shadowRoot === null) return null;

  const shadowSelection = (
    shadowRoot as ShadowRoot & { getSelection?: () => Selection | null }
  ).getSelection?.();
  let startNode: Node | null = null;
  let endNode: Node | null = null;
  let collapsed = true;
  if (shadowSelection != null && shadowSelection.rangeCount > 0) {
    const range = shadowSelection.getRangeAt(0);
    startNode = range.startContainer;
    endNode = range.endContainer;
    collapsed = range.collapsed;
  } else {
    const selection = document.getSelection() as
      | (Selection & {
          getComposedRanges?: (options: {
            shadowRoots: ReadonlyArray<ShadowRoot>;
          }) => ReadonlyArray<StaticRange>;
        })
      | null;
    const range = selection?.getComposedRanges?.({ shadowRoots: [shadowRoot] })[0];
    if (range === undefined) return null;
    startNode = range.startContainer;
    endNode = range.endContainer;
    collapsed = range.collapsed;
  }
  if (collapsed || startNode === null || endNode === null) return null;

  const rowOf = (node: Node): HTMLElement | null => {
    const element = node instanceof Element ? node : node.parentElement;
    const row = element?.closest("[data-line]") ?? null;
    if (row === null || row.getAttribute("data-line-type") === "change-deletion") return null;
    return row instanceof HTMLElement ? row : null;
  };
  const startRow = rowOf(startNode);
  const endRow = rowOf(endNode);
  if (startRow === null || endRow === null) return null;
  const a = Number(startRow.getAttribute("data-line"));
  const b = Number(endRow.getAttribute("data-line"));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { start: Math.min(a, b), end: Math.max(a, b) };
};

export interface FileStat {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

export function WorkbenchDiff({
  diff,
  changeId,
  comments,
  stats,
  focus,
}: {
  readonly diff: string;
  readonly changeId: string;
  readonly comments: ReadonlyArray<ReviewCommentDto>;
  readonly stats: ReadonlyArray<FileStat>;
  /** Sidebar navigation: expand + scroll to this file (nonce re-triggers). */
  readonly focus?: { readonly path: string; readonly nonce: number } | null;
}) {
  const [composer, setComposer] = useState<CommentAnchor | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const files = useMemo(() => parsePatchFiles(diff).flatMap((patch) => patch.files), [diff]);
  const statOf = useMemo(() => new Map(stats.map((stat) => [stat.path, stat])), [stats]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sectionsRef = useRef(new Map<string, HTMLElement>());

  // Imperative by nature: the sidebar picked a file; expand it and bring its
  // sticky header to the top of the scroll container.
  useEffect(() => {
    if (focus === undefined || focus === null) return;
    setCollapsed((current) => {
      if (!current.has(focus.path)) return current;
      const next = new Set(current);
      next.delete(focus.path);
      return next;
    });
    const frame = requestAnimationFrame(() => {
      const container = containerRef.current;
      const section = sectionsRef.current.get(focus.path);
      if (container !== null && section !== undefined) {
        container.scrollTo({ top: section.offsetTop, behavior: "smooth" });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [focus]);

  if (diff === "") {
    return (
      <div className="rounded-2xl bg-card p-6 shadow-sm">
        <p className="text-sm text-muted-foreground">
          The worktree matches its base — nothing to review yet.
        </p>
      </div>
    );
  }

  const toggle = (name: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const allCollapsed = files.length > 0 && files.every((file) => collapsed.has(file.name));

  return (
    <div className="overflow-hidden rounded-2xl bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-rule-faint bg-secondary px-4 py-2">
        <p className="font-mono text-[11.5px] text-muted-foreground">
          {files.length} file{files.length === 1 ? "" : "s"} changed
        </p>
        <button
          type="button"
          onClick={() =>
            setCollapsed(allCollapsed ? new Set() : new Set(files.map((file) => file.name)))
          }
          className="font-sans text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {allCollapsed ? "Expand all" : "Collapse all"}
        </button>
      </div>

      {/* THE scroll container: the diff scrolls in here, the page does not. */}
      <div ref={containerRef} className="relative max-h-[calc(100vh-16rem)] overflow-y-auto">
        {files.map((file) => {
          const isCollapsed = collapsed.has(file.name);
          const stat = statOf.get(file.name);
          const fileComments = comments.filter(
            (comment) => comment.file === file.name && comment.line !== null,
          );
          const annotations: Array<DiffLineAnnotation<Annotation>> = fileComments.map(
            (comment) => ({
              side: "additions",
              // The card renders at the END of its range, under the last line.
              lineNumber: comment.endLine ?? comment.line ?? 0,
              metadata: { kind: "comment", comment },
            }),
          );
          if (composer !== null && composer.file === file.name) {
            annotations.push({
              side: "additions",
              lineNumber: composer.endLine ?? composer.line,
              metadata: { kind: "composer", anchor: composer },
            });
          }
          return (
            <section
              key={file.name}
              ref={(element) => {
                if (element === null) sectionsRef.current.delete(file.name);
                else sectionsRef.current.set(file.name, element);
              }}
            >
              {/* Our file header: sticky within the scroll container, collapse toggle. */}
              <button
                type="button"
                onClick={() => toggle(file.name)}
                className="sticky top-0 z-10 flex w-full items-center gap-2 border-y border-rule-faint bg-secondary px-4 py-2 text-left first:border-t-0"
              >
                <span
                  className={`text-[10px] text-muted-foreground transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                >
                  ▶
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-2">
                  {file.name}
                </span>
                {fileComments.length > 0 && (
                  <span className="font-mono text-[11px] text-info">
                    {fileComments.length} comment{fileComments.length === 1 ? "" : "s"}
                  </span>
                )}
                {stat !== undefined && (
                  <span className="font-mono text-[11px]">
                    <span className="text-success">+{stat.additions}</span>{" "}
                    <span className="text-danger">−{stat.deletions}</span>
                  </span>
                )}
              </button>
              {!isCollapsed && (
                // Selecting TEXT is also a comment gesture: on release, the
                // spanned lines become the composer's anchor (copy still
                // works — the selection is left intact).
                <div
                  className="ev-diff"
                  onMouseUp={(event) => {
                    const wrapper = event.currentTarget;
                    window.setTimeout(() => {
                      const span = selectedLineSpan(wrapper);
                      if (span === null) return;
                      setComposer({
                        file: file.name,
                        line: span.start,
                        endLine: span.end > span.start ? span.end : null,
                      });
                    }, 0);
                  }}
                >
                  <FileDiff<Annotation>
                    fileDiff={file}
                    lineAnnotations={annotations}
                    options={{
                      diffStyle: "unified",
                      theme: { light: "evidence-review", dark: "evidence-review" },
                      unsafeCSS: EDGE_MARK_CSS,
                      lineHoverHighlight: "line",
                      disableFileHeader: true,
                      enableLineSelection: true,
                      // Drag across line numbers → range comment composer.
                      onLineSelectionEnd: (range: SelectedLineRange | null) => {
                        if (range === null) return;
                        const [start, end] =
                          range.start <= range.end
                            ? [range.start, range.end]
                            : [range.end, range.start];
                        setComposer({
                          file: file.name,
                          line: start,
                          endLine: end > start ? end : null,
                        });
                      },
                      // The composer opens from the GUTTER (the documented
                      // gesture surface) — clicking or dragging in the code
                      // area is text selection, never a surprise composer.
                      onLineNumberClick: (props) => {
                        setComposer({ file: file.name, line: props.lineNumber, endLine: null });
                      },
                    }}
                    renderAnnotation={(annotation) =>
                      annotation.metadata.kind === "comment" ? (
                        <InlineComment comment={annotation.metadata.comment} />
                      ) : (
                        <InlineComposer
                          changeId={changeId}
                          anchor={annotation.metadata.anchor}
                          onDone={() => setComposer(null)}
                        />
                      )
                    }
                  />
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** "12" or "12–18" — one label for both anchor shapes. */
export const lineLabel = (line: number | null, endLine: number | null) =>
  line === null ? null : endLine === null || endLine === line ? `${line}` : `${line}–${endLine}`;

function InlineComment({ comment }: { readonly comment: ReviewCommentDto }) {
  return (
    <div className="mx-4 my-2 rounded-xl border border-border bg-background p-3 font-sans shadow-xs">
      <p className="font-mono text-[10.5px] text-label">
        {comment.authorKind === "mend" ? "Mend" : comment.authorName} · line{" "}
        {lineLabel(comment.line, comment.endLine)} ·{" "}
        {comment.sentToSessionId === null ? comment.state : "sent to session"}
      </p>
      <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">{comment.body}</p>
    </div>
  );
}

function InlineComposer({
  changeId,
  anchor,
  onDone,
}: {
  readonly changeId: string;
  readonly anchor: CommentAnchor;
  readonly onDone: () => void;
}) {
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);

  const submit = () => {
    if (body.trim() === "") return;
    setPending(true);
    void postChangeComment(changeId, {
      file: anchor.file,
      line: anchor.line,
      endLine: anchor.endLine,
      body: body.trim(),
    })
      .then(() => queryClient.invalidateQueries({ queryKey: ["change", changeId] }))
      .then(onDone)
      .finally(() => setPending(false));
  };

  return (
    <div className="mx-4 my-2 rounded-xl border border-[color-mix(in_oklab,var(--sw-accent)_35%,transparent)] bg-background p-3 font-sans shadow-xs">
      <p className="font-mono text-[10.5px] text-label">
        comment · {anchor.file}:{lineLabel(anchor.line, anchor.endLine)}
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
