import type { ReviewCommentDto, ReviewDiffFileDto, SliceCommentTargetDto } from "#/lib/api";

const REVIEW_KEY_PREFIX = "mend.desktop.review-key.";
const REPLAY_CURSOR_PREFIX = "mend.desktop.replay-cursor.";

const newKey = (changeId: string): string => `desktop:${changeId}:${crypto.randomUUID()}`;

/** The current explicit Review-open command key survives a desktop restart. */
export const reviewOpenKey = (changeId: string): string => {
  const storageKey = `${REVIEW_KEY_PREFIX}${changeId}`;
  const existing = localStorage.getItem(storageKey);
  if (existing !== null) return existing;
  const created = newKey(changeId);
  localStorage.setItem(storageKey, created);
  return created;
};

/** Start a new explicit Review snapshot instead of moving the current one implicitly. */
export const refreshReviewOpenKey = (changeId: string): string => {
  const created = newKey(changeId);
  localStorage.setItem(`${REVIEW_KEY_PREFIX}${changeId}`, created);
  return created;
};

/** Queue one durable-record cursor for the terminal that owns the evidence link. */
export const queueReplayCursor = (sessionId: string, sequence: string): void => {
  localStorage.setItem(`${REPLAY_CURSOR_PREFIX}${sessionId}`, sequence);
};

/** Consume a queued evidence cursor when the workbench reattaches the terminal. */
export const takeReplayCursor = (sessionId: string): string => {
  const key = `${REPLAY_CURSOR_PREFIX}${sessionId}`;
  const cursor = localStorage.getItem(key) ?? "0";
  localStorage.removeItem(key);
  return cursor;
};

const stripTerminalControls = (text: string): string => {
  let cleaned = "";
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 13) continue;
    if (code !== 27) {
      cleaned += text[index];
      continue;
    }
    if (text[index + 1] !== "[") continue;
    index += 2;
    while (index < text.length) {
      const final = text.charCodeAt(index);
      if (final >= 64 && final <= 126) break;
      index += 1;
    }
  }
  return cleaned;
};

export const terminalEvidenceExcerpt = (text: string): string => {
  const lines = stripTerminalControls(text)
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "")
    .slice(-10)
    .join("\n");
  return lines.length > 1_200 ? lines.slice(-1_200) : lines;
};

export const reviewFilePath = (file: ReviewDiffFileDto): string =>
  file.newPath ?? file.oldPath ?? "unknown path";

export const reviewFileStatus = (file: ReviewDiffFileDto): string => {
  switch (file.status) {
    case "added":
      return "Added";
    case "modified":
      return "Modified";
    case "deleted":
      return "Deleted";
    case "renamed":
      return "Renamed";
    case "copied":
      return "Copied";
    case "type-changed":
      return "Type changed";
    case "unmerged":
      return "Unmerged";
    case "unknown":
      return "Changed";
    default:
      return "Changed";
  }
};

/** Resolve a rendered line/range to the canonical hunk used by the server anchor contract. */
export const sliceLineTarget = (
  file: ReviewDiffFileDto,
  side: "old" | "new",
  startLine: number,
  endLine: number,
): SliceCommentTargetDto | null => {
  const hunk = file.hunks.find((candidate) => {
    const start = side === "old" ? candidate.oldStart : candidate.newStart;
    const count = side === "old" ? candidate.oldLines : candidate.newLines;
    return count > 0 && startLine >= start && endLine <= start + count - 1;
  });
  if (hunk === undefined) return null;
  return {
    oldPath: file.oldPath,
    newPath: file.newPath,
    side,
    startLine,
    endLine,
    hunkContextHash: hunk.contextHash,
  };
};

export const fileCommentTarget = (file: ReviewDiffFileDto): SliceCommentTargetDto => ({
  oldPath: file.oldPath,
  newPath: file.newPath,
  side: null,
  startLine: null,
  endLine: null,
  hunkContextHash: null,
});

export const changeCommentTarget: SliceCommentTargetDto = {
  oldPath: null,
  newPath: null,
  side: null,
  startLine: null,
  endLine: null,
  hunkContextHash: null,
};

export const commentsForComparison = (
  comments: ReadonlyArray<ReviewCommentDto>,
  diffDigest: string | null,
): ReadonlyArray<ReviewCommentDto> =>
  comments.filter(
    (comment) =>
      comment.authorKind === "reviewer" &&
      (comment.anchor === null || comment.anchor.diffDigest === diffDigest),
  );

export const commentsForFile = (
  comments: ReadonlyArray<ReviewCommentDto>,
  path: string | null,
): ReadonlyArray<ReviewCommentDto> =>
  comments.filter((comment) => {
    const isChangeLevel =
      comment.anchor === null
        ? comment.file === null
        : comment.anchor.oldPath === null && comment.anchor.newPath === null;
    if (isChangeLevel) return true;
    const anchorPath = comment.anchor?.newPath ?? comment.anchor?.oldPath ?? comment.file;
    return path !== null && anchorPath === path;
  });

export const commentLocation = (comment: ReviewCommentDto): string => {
  if (comment.anchor === null) {
    return comment.file === null
      ? "Legacy change anchor"
      : `Legacy live-diff anchor · ${comment.file}`;
  }
  const path = comment.anchor.newPath ?? comment.anchor.oldPath;
  if (path === null) return "Whole change";
  if (comment.anchor.side === null || comment.anchor.startLine === null) return path;
  const range =
    comment.anchor.endLine === null || comment.anchor.endLine === comment.anchor.startLine
      ? String(comment.anchor.startLine)
      : `${comment.anchor.startLine}–${comment.anchor.endLine}`;
  return `${path} · ${comment.anchor.side} ${range}`;
};

/** Editable starting text only; delivery remains a server-owned operation in Step 7. */
export const assembleReviewInstruction = (
  comments: ReadonlyArray<ReviewCommentDto>,
  selected: ReadonlySet<string>,
): string => {
  const chosen = comments.filter((comment) => selected.has(comment.id));
  if (chosen.length === 0) return "";
  return [
    "Address these Review comments against the pinned change:",
    "",
    ...chosen.flatMap((comment, index) => [
      `${index + 1}. ${commentLocation(comment)}`,
      comment.body,
      "",
    ]),
  ]
    .join("\n")
    .trimEnd();
};
