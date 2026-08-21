import {
  parsePatchFiles,
  registerCustomCSSVariableTheme,
  type DiffLineAnnotation,
  type SelectedLineRange,
} from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { ReviewCommentDto, ReviewDiffFileDto, SliceCommentTargetDto } from "#/lib/api";
import { reviewFilePath, sliceLineTarget } from "#/lib/review";

registerCustomCSSVariableTheme("mend-review", {
  foreground: "var(--sw-ink-2)",
  background: "transparent",
  "token-comment": "var(--sw-faint)",
  "token-keyword": "var(--sw-muted)",
  "token-string": "var(--sw-ink-2)",
  "token-string-expression": "var(--sw-ink-2)",
  "token-constant": "var(--sw-muted)",
  "token-function": "var(--sw-ink)",
  "token-punctuation": "var(--sw-muted)",
  "token-link": "var(--sw-accent)",
});

const EDGE_MARK_CSS = `
[data-line-type="change-addition"] { box-shadow: inset 2px 0 0 var(--sw-add-edge); }
[data-line-type="change-deletion"] { box-shadow: inset 2px 0 0 var(--sw-del-edge); }
::selection { background: color-mix(in oklab, var(--sw-accent) 30%, transparent); }
[data-gutter-buffer][data-selected-line],
[data-column-number][data-selected-line],
[data-column-number][data-editor-active-line] { color: var(--sw-ink); }
`;

type DiffAnnotation = { readonly comment: ReviewCommentDto };

const annotationSide = (side: "old" | "new"): "deletions" | "additions" =>
  side === "old" ? "deletions" : "additions";

const reviewSide = (side: "deletions" | "additions"): "old" | "new" =>
  side === "deletions" ? "old" : "new";

export const parseDesktopReviewPatch = (patch: string) =>
  parsePatchFiles(patch).flatMap((parsed) => parsed.files);

const currentSliceAnnotations = (
  file: ReviewDiffFileDto,
  comments: ReadonlyArray<ReviewCommentDto>,
): Array<DiffLineAnnotation<DiffAnnotation>> =>
  comments.flatMap((comment) => {
    const anchor = comment.anchor;
    if (
      anchor === null ||
      anchor.side === null ||
      anchor.startLine === null ||
      anchor.hunkContextHash === null
    ) {
      return [];
    }
    const path = anchor.side === "old" ? anchor.oldPath : anchor.newPath;
    const expected = anchor.side === "old" ? file.oldPath : file.newPath;
    if (path === null || path !== expected) return [];
    return [
      {
        side: annotationSide(anchor.side),
        lineNumber: anchor.endLine ?? anchor.startLine,
        metadata: { comment },
      },
    ];
  });

export function ReviewDiff({
  file,
  anchorFile,
  comments,
  style,
  activeHunk,
  onCompose,
}: {
  readonly file: ReviewDiffFileDto;
  readonly anchorFile: ReviewDiffFileDto;
  readonly comments: ReadonlyArray<ReviewCommentDto>;
  readonly style: "unified" | "split";
  readonly activeHunk: number;
  readonly onCompose: (target: SliceCommentTargetDto, label: string) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const lastScrollRef = useRef<string | null>(null);
  const [anchorNotice, setAnchorNotice] = useState<string | null>(null);
  const parsedFiles = useMemo(() => parseDesktopReviewPatch(file.patch), [file.patch]);
  const annotations = useMemo(() => currentSliceAnnotations(file, comments), [comments, file]);
  const hunk = file.hunks[activeHunk];
  const scrollKey =
    hunk === undefined ? null : `${reviewFilePath(file)}:${style}:${hunk.contextHash}`;

  useEffect(() => {
    if (hunk === undefined || scrollKey === null || lastScrollRef.current === scrollKey) return;
    lastScrollRef.current = scrollKey;
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const hosts = wrapperRef.current?.querySelectorAll("diffs-container") ?? [];
        const useNew = hunk.newLines > 0;
        const column = useNew ? "[data-additions]" : "[data-deletions]";
        const line = useNew ? hunk.newStart : hunk.oldStart;
        for (const host of hosts) {
          const target = host.shadowRoot?.querySelector(`${column} [data-line="${line}"]`);
          if (target === null || target === undefined) continue;
          target.scrollIntoView({ block: "center", behavior: "smooth" });
          break;
        }
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [hunk, scrollKey]);

  if (file.binary) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <div className="max-w-sm text-center">
          <p className="font-display text-xl font-semibold">Binary file</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Git observed this file changing, but there are no text lines to render or anchor.
          </p>
        </div>
      </div>
    );
  }

  if (parsedFiles.length === 0) {
    return (
      <pre className="h-full overflow-auto bg-background p-4 font-mono text-xs whitespace-pre text-foreground">
        {file.patch}
      </pre>
    );
  }

  const composeRange = (range: SelectedLineRange | null) => {
    if (range === null) return;
    const startSide = range.side ?? range.endSide;
    const endSide = range.endSide ?? range.side;
    if (startSide === undefined || endSide === undefined || startSide !== endSide) {
      setAnchorNotice("Select lines on one side of the pinned diff.");
      return;
    }
    const start = Math.min(range.start, range.end);
    const end = Math.max(range.start, range.end);
    const side = reviewSide(startSide);
    const target = sliceLineTarget(anchorFile, side, start, end);
    if (target === null) {
      setAnchorNotice(
        "That context line is outside the canonical Review hunk. Choose a changed line or use Context 3.",
      );
      return;
    }
    setAnchorNotice(null);
    onCompose(
      target,
      `${reviewFilePath(file)} · ${side} ${start}${end === start ? "" : `–${end}`}`,
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {anchorNotice !== null && (
        <p className="shrink-0 border-b border-rule bg-sunken px-3 py-1.5 font-sans text-[11.5px] text-muted-foreground">
          {anchorNotice}
        </p>
      )}
      <div ref={wrapperRef} className="ev-diff min-h-0 min-w-0 flex-1 overflow-auto">
        {parsedFiles.map((parsed, index) => (
          <FileDiff<DiffAnnotation>
            key={`${parsed.name}:${index}`}
            fileDiff={parsed}
            lineAnnotations={annotations}
            options={{
              diffStyle: style,
              theme: { light: "mend-review", dark: "mend-review" },
              unsafeCSS: EDGE_MARK_CSS,
              lineHoverHighlight: "line",
              disableFileHeader: true,
              enableLineSelection: true,
              onLineSelectionEnd: composeRange,
              onLineNumberClick: (props) => {
                const side = reviewSide(props.annotationSide);
                const target = sliceLineTarget(
                  anchorFile,
                  side,
                  props.lineNumber,
                  props.lineNumber,
                );
                if (target === null) {
                  setAnchorNotice(
                    "That context line is outside the canonical Review hunk. Choose a changed line or use Context 3.",
                  );
                  return;
                }
                setAnchorNotice(null);
                onCompose(target, `${reviewFilePath(file)} · ${side} ${props.lineNumber}`);
              },
            }}
            renderAnnotation={(annotation) => (
              <article className="m-2 border-l-2 border-info bg-panel px-3 py-2 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-sans text-xs font-medium text-foreground">
                    {annotation.metadata.comment.authorName}
                  </span>
                  <span className="font-mono text-[10.5px] text-label">
                    {annotation.metadata.comment.state}
                  </span>
                </div>
                <p className="mt-1 font-sans text-[12.5px] leading-relaxed text-ink-2">
                  {annotation.metadata.comment.body}
                </p>
              </article>
            )}
          />
        ))}
      </div>
    </div>
  );
}
