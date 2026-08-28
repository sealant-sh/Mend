import { createHash, randomUUID } from "node:crypto";

import {
  RGBA,
  SyntaxStyle,
  type DiffRenderable,
  type ScrollBoxRenderable,
  type TextareaRenderable,
} from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  assembleReviewInstruction,
  buildReviewFiles,
  visibleWhitespace,
  type ReviewFile,
} from "./review-model.ts";
import { commentRange, deliverReview } from "./review-workflow.ts";
import { isPendingId, pendingId } from "./shared.ts";
import { openUrl } from "./terminal.ts";
import {
  AMBER,
  BOLD,
  COBALT,
  DIM,
  diffWashes,
  editorInk,
  GRAY,
  GREEN,
  RED,
  SYNTAX_FUNCTION,
  SYNTAX_KEYWORD,
  SYNTAX_NUMBER,
  SYNTAX_STRING,
} from "./tui-theme.ts";

export interface ReviewContext {
  readonly config: { readonly url: string; readonly token: string | null };
  readonly api: <T>(method: "GET" | "POST", route: string, body?: unknown) => Promise<T>;
}

export interface ReviewSession {
  readonly id: string;
  readonly harness: string;
  readonly label: string | null;
  readonly branch: string;
  readonly baseSha: string;
  readonly status: string;
}

interface ChangedFileDto {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

interface ChangeDto {
  readonly id: string;
  readonly sessionId: string;
  readonly branch: string;
  readonly baseSha: string;
}

interface ChangeDiffDto {
  readonly change: ChangeDto;
  readonly diff: string;
  readonly files: ReadonlyArray<ChangedFileDto>;
}

interface OpenReviewDto {
  readonly slice: { readonly id: string };
}

interface ReviewDiffHunkDto {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly contextHash: string;
}

interface ReviewDiffFileDto {
  readonly oldPath: string | null;
  readonly newPath: string | null;
  readonly additions: number;
  readonly deletions: number;
  readonly hunks: ReadonlyArray<ReviewDiffHunkDto>;
}

interface PinnedReviewDiffDto {
  readonly change: ChangeDto;
  readonly slice: { readonly id: string; readonly diffDigest: string };
  readonly checkpointA: { readonly id: string };
  readonly checkpointB: { readonly id: string };
  readonly patch: string;
  readonly files: ReadonlyArray<ReviewDiffFileDto>;
  readonly anchorFiles: ReadonlyArray<ReviewDiffFileDto>;
}

interface RecordLinkDto {
  readonly sequence: string;
  readonly excerpt: string;
}

interface ReviewCommentDto {
  readonly id: string;
  readonly file: string | null;
  readonly line: number | null;
  readonly endLine: number | null;
  readonly authorKind: "reviewer" | "mend";
  readonly authorName: string;
  readonly body: string;
  readonly suggestion: string | null;
  readonly state: "draft" | "open" | "addressed" | "dismissed";
  readonly evidence: ReadonlyArray<RecordLinkDto>;
  readonly sentToSessionId: string | null;
  readonly createdAt: string;
}

interface TourStopDto {
  readonly title: string;
  readonly file: string | null;
  readonly line: number | null;
  readonly endLine: number | null;
  readonly narration: string;
  readonly evidence: ReadonlyArray<RecordLinkDto>;
  readonly grounded: boolean;
}

interface ChangeTourDto {
  readonly summary: string;
  readonly approach: string | null;
  readonly stops: ReadonlyArray<TourStopDto>;
  readonly diffDigest: string;
  readonly createdAt: string;
}

interface ChangePassDto {
  readonly kind: "tour" | "read" | "suggest";
  readonly status: "running" | "completed" | "failed";
  readonly detail: string | null;
  readonly findings: number | null;
}

interface FollowUpDto {
  readonly id: string;
  readonly reviewSliceId: string | null;
  readonly checkpointAId: string | null;
  readonly checkpointBId: string | null;
  readonly diffDigest: string | null;
  readonly commentIds: ReadonlyArray<string>;
  readonly idempotencyKey: string | null;
  readonly instruction: string;
  readonly status: "pending" | "delivering" | "delivered" | "delivery_failed" | "superseded";
  readonly deliveryError: string | null;
}

interface ReviewData {
  readonly wire: ChangeDiffDto;
  readonly sliceId: string;
  readonly checkpointAId: string;
  readonly checkpointBId: string;
  readonly diffDigest: string;
  readonly anchorFiles: ReadonlyArray<ReviewDiffFileDto>;
  readonly files: ReadonlyArray<ReviewFile>;
  readonly comments: ReadonlyArray<ReviewCommentDto>;
  readonly tour: ChangeTourDto | null;
  readonly passes: ReadonlyArray<ChangePassDto>;
  readonly followUp: FollowUpDto | null;
  readonly sessionStatus: string;
}

type Focus = "files" | "diff" | "comments";
type DiffView = "unified" | "split";
type Editor =
  | {
      readonly kind: "comment";
      readonly file: string | null;
      readonly line: number | null;
      readonly endLine: number | null;
      /** A failed optimistic save reopens the editor with the text intact. */
      readonly initialBody?: string;
    }
  | {
      readonly kind: "send";
      readonly instruction: string;
      readonly commentIds: ReadonlyArray<string>;
      readonly idempotencyKey: string;
    };

const REVIEW_KEY = (changeId: string) => ["review", changeId] as const;
const EDITOR_KEY_BINDINGS = [{ name: "return", ctrl: true, action: "submit" }] as const;

const syntaxStyleFor = (ink: string) =>
  SyntaxStyle.fromStyles({
    keyword: { fg: RGBA.fromHex(SYNTAX_KEYWORD) },
    string: { fg: RGBA.fromHex(SYNTAX_STRING) },
    comment: { fg: RGBA.fromHex(GRAY), italic: true },
    number: { fg: RGBA.fromHex(SYNTAX_NUMBER) },
    function: { fg: RGBA.fromHex(SYNTAX_FUNCTION) },
    variable: { fg: RGBA.fromHex(ink) },
    default: { fg: RGBA.fromHex(ink) },
  });

const truncate = (text: string, width: number): string => {
  const oneLine = text.replaceAll(/\s+/g, " ").trim();
  if (width <= 1) return "";
  return oneLine.length <= width ? oneLine : `${oneLine.slice(0, width - 1)}…`;
};

const fetchReview = async (ctx: ReviewContext, changeId: string): Promise<ReviewData> => {
  const opened = await ctx.api<OpenReviewDto>("POST", `/changes/${changeId}/reviews/open`, {
    idempotencyKey: `cli-review:${changeId}`,
  });
  const pinned = await ctx.api<PinnedReviewDiffDto>(
    "GET",
    `/changes/${changeId}/reviews/${opened.slice.id}/diff`,
  );
  const wire: ChangeDiffDto = {
    change: pinned.change,
    diff: pinned.patch,
    files: pinned.files.map((file) => ({
      path: file.newPath ?? file.oldPath ?? "unknown path",
      additions: file.additions,
      deletions: file.deletions,
    })),
  };
  const [comments, tour, passes, followUp, sessionDetail] = await Promise.all([
    ctx.api<ReadonlyArray<ReviewCommentDto>>("GET", `/changes/${changeId}/comments`),
    ctx.api<ChangeTourDto | null>("GET", `/changes/${changeId}/tour`),
    ctx.api<ReadonlyArray<ChangePassDto>>("GET", `/changes/${changeId}/passes`),
    ctx.api<FollowUpDto | null>("GET", `/sessions/${wire.change.sessionId}/follow-up`),
    ctx.api<{ readonly session: ReviewSession }>("GET", `/sessions/${wire.change.sessionId}`),
  ]);
  return {
    wire,
    sliceId: pinned.slice.id,
    checkpointAId: pinned.checkpointA.id,
    checkpointBId: pinned.checkpointB.id,
    diffDigest: pinned.slice.diffDigest,
    anchorFiles: pinned.anchorFiles,
    files: buildReviewFiles(wire.diff, wire.files),
    comments,
    tour,
    passes,
    followUp,
    sessionStatus: sessionDetail.session.status,
  };
};

const commentPriority = (comment: ReviewCommentDto): number =>
  comment.state === "draft" ? 0 : comment.state === "open" ? 1 : 2;

const orderedComments = (comments: ReadonlyArray<ReviewCommentDto>) =>
  comments.toSorted((a, b) => {
    const byState = commentPriority(a) - commentPriority(b);
    return byState === 0 ? b.createdAt.localeCompare(a.createdAt) : byState;
  });

/** Undecided states carry amber; settled ones take the terminal's own dim. */
const stateColor = (state: ReviewCommentDto["state"]): string | undefined =>
  state === "draft" || state === "open" ? AMBER : undefined;

const anchorOf = (comment: ReviewCommentDto): string =>
  comment.file === null
    ? "change"
    : `${comment.file}${comment.line === null ? "" : `:${comment.line}${comment.endLine === null || comment.endLine === comment.line ? "" : `-${comment.endLine}`}`}`;

const passFact = (pass: ChangePassDto): { readonly text: string; readonly color: string } => {
  const label = pass.kind === "suggest" ? "suggestions" : pass.kind;
  if (pass.status === "running") return { text: `${label} running`, color: COBALT };
  if (pass.status === "failed") return { text: `${label} failed`, color: RED };
  return {
    text: `${label} observed ${pass.findings ?? 0} ${pass.kind === "tour" ? "stops" : "drafts"}`,
    color: GREEN,
  };
};

const FileRow = ({ file, selected }: { readonly file: ReviewFile; readonly selected: boolean }) => (
  <box height={2} flexShrink={0}>
    <text height={1}>
      <span fg={COBALT}>{selected ? "> " : "  "}</span>
      <span {...(selected ? { fg: COBALT } : {})}>{file.path}</span>
      {file.binary ? <span fg={AMBER}> binary</span> : null}
      {file.likelyGenerated ? <span attributes={DIM}> likely generated</span> : null}
    </text>
    <text height={1}>
      <span>{"    "}</span>
      <span fg={GREEN}>+{file.additions}</span>
      <span> </span>
      <span fg={RED}>−{file.deletions}</span>
      <span attributes={DIM}>
        {"  "}
        {file.status}
        {"  "}
        {file.hunks.length} hunks
      </span>
    </text>
  </box>
);

const CommentRow = ({
  comment,
  selected,
}: {
  readonly comment: ReviewCommentDto;
  readonly selected: boolean;
}) => {
  const color = stateColor(comment.state);
  return (
    <box height={2} flexShrink={0}>
      <text height={1}>
        <span fg={COBALT}>{selected ? "> " : "  "}</span>
        {color === undefined ? (
          <span attributes={DIM}>{comment.state}</span>
        ) : (
          <span fg={color}>{comment.state}</span>
        )}
        <span attributes={DIM}>
          {"  "}
          {anchorOf(comment)}
        </span>
      </text>
      <text height={1}>
        <span>{"    "}</span>
        <span {...(comment.authorKind === "mend" ? { fg: COBALT } : {})} attributes={DIM}>
          {comment.authorKind === "mend" ? "Mend  " : "You  "}
        </span>
        <span>{truncate(comment.body, 27)}</span>
      </text>
    </box>
  );
};

const Description = ({
  data,
  tourIndex,
  stale,
  width,
  height,
}: {
  readonly data: ReviewData;
  readonly tourIndex: number;
  readonly stale: boolean;
  readonly width: number;
  readonly height: number;
}) => {
  const passFacts = data.passes.map(passFact);
  const tourStop = data.tour?.stops[tourIndex] ?? null;
  const stopEvidence = tourStop?.evidence[0] ?? null;
  return (
    <box height={height} flexShrink={0} flexDirection="column" marginTop={1}>
      <text height={1}>
        {data.tour === null ? (
          <span attributes={DIM}>
            {" No description yet — t composes one from the diff and session record."}
          </span>
        ) : (
          <>
            <span fg={COBALT}> Mend uses inference </span>
            {stale ? <span fg={AMBER}> diff changed since </span> : null}
            <span>{truncate(data.tour.summary, Math.max(20, width - 50))}</span>
          </>
        )}
      </text>
      {height >= 3 && data.tour !== null ? (
        <text height={1}>
          {tourStop === null ? (
            <span attributes={DIM}>
              {" inferred approach  "}
              {truncate(data.tour.approach ?? "No tour stops yet.", width - 24)}
            </span>
          ) : (
            <>
              <span fg={COBALT}>
                {" "}
                stop {tourIndex + 1}/{data.tour.stops.length} {tourStop.title}
              </span>
              <span attributes={DIM}>
                {tourStop.file === null
                  ? "  change"
                  : `  ${tourStop.file}${tourStop.line === null ? "" : `:${tourStop.line}`}`}
                {tourStop.grounded ? "  direct record" : "  inferred reading"}
              </span>
            </>
          )}
        </text>
      ) : null}
      {height >= 4 && tourStop !== null ? (
        <text height={1}>
          <span attributes={DIM}>
            {tourStop.grounded ? " record-grounded  " : " inferred narration  "}
          </span>
          <span>{truncate(tourStop.narration, Math.max(20, width - 24))}</span>
        </text>
      ) : null}
      {height >= 5 && tourStop !== null ? (
        <text height={1}>
          <span fg={stopEvidence === null ? AMBER : COBALT}>
            {stopEvidence === null
              ? " no direct evidence  "
              : ` evidence seq ${stopEvidence.sequence}  `}
          </span>
          <span attributes={DIM}>
            {truncate(
              stopEvidence?.excerpt ?? "this stop is labeled inferred",
              Math.max(20, width - 26),
            )}
          </span>
        </text>
      ) : null}
      <text height={1}>
        {passFacts.length === 0 ? (
          <span attributes={DIM}> Mend has not read this change.</span>
        ) : (
          passFacts.map((fact, index) => (
            <span key={`${fact.text}-${index}`}>
              <span> </span>
              <span fg={fact.color}>{fact.text}</span>
            </span>
          ))
        )}
        {data.followUp?.status === "pending" ? <span fg={AMBER}> follow-up pending</span> : null}
      </text>
    </box>
  );
};

const CompactTourEvidence = ({
  stop,
  index,
  total,
  width,
}: {
  readonly stop: TourStopDto;
  readonly index: number;
  readonly total: number;
  readonly width: number;
}) => {
  const evidence = stop.evidence[0] ?? null;
  return (
    <box height={3} flexShrink={0} flexDirection="column" marginTop={1}>
      <text height={1}>
        <span fg={stop.grounded ? COBALT : GRAY}>
          {` tour stop ${index + 1}/${total}  ${stop.grounded ? "direct record" : "inferred reading"}`}
        </span>
      </text>
      <text height={1}>
        <span> {truncate(stop.narration, Math.max(12, width - 4))}</span>
      </text>
      <text height={1}>
        <span fg={evidence === null ? AMBER : COBALT}>
          {evidence === null ? " no direct record link  " : ` seq ${evidence.sequence}  `}
        </span>
        <span attributes={DIM}>
          {truncate(
            evidence?.excerpt ?? "the narration is an inferred reading",
            Math.max(12, width - 26),
          )}
        </span>
      </text>
    </box>
  );
};

const EvidenceCard = ({
  comment,
  width,
}: {
  readonly comment: ReviewCommentDto;
  readonly width: number;
}) => (
  <box
    height={2 + (comment.suggestion === null ? 0 : 1) + Math.min(2, comment.evidence.length)}
    flexShrink={0}
    flexDirection="column"
    marginTop={1}
  >
    <text height={1}>
      <span fg={comment.state === "draft" ? AMBER : COBALT}>
        {` ${anchorOf(comment)}  ${comment.authorKind === "mend" ? "Mend" : "You"}`}
      </span>
    </text>
    <text height={1}>
      <span> {truncate(comment.body, Math.max(12, width - 4))}</span>
    </text>
    {comment.suggestion === null ? null : (
      <text height={1}>
        <span fg={COBALT}> proposed </span>
        <span attributes={DIM}>{truncate(comment.suggestion, Math.max(12, width - 15))}</span>
      </text>
    )}
    {comment.evidence.slice(0, 2).map((evidence) => (
      <text key={`${evidence.sequence}-${evidence.excerpt}`} height={1}>
        <span attributes={DIM}>
          {` seq ${evidence.sequence}  ${truncate(evidence.excerpt, Math.max(12, width - 16))}`}
        </span>
      </text>
    ))}
  </box>
);

const EditorPanel = ({
  editor,
  refValue,
  busy,
  ink,
  onSubmit,
}: {
  readonly editor: Editor;
  readonly refValue: React.RefObject<TextareaRenderable | null>;
  readonly busy: boolean;
  /** The terminal-side body ink — the textarea's own default is white-on-anything. */
  readonly ink: string;
  readonly onSubmit: () => void;
}) => {
  const title =
    editor.kind === "send"
      ? " send review to session · edit before sending "
      : ` comment · ${editor.file === null ? "change" : `${editor.file}:${editor.line ?? ""}`} `;
  return (
    <box
      border
      borderStyle="rounded"
      borderColor={COBALT}
      title={title}
      titleAlignment="left"
      height={editor.kind === "send" ? 16 : 8}
      flexShrink={0}
      flexDirection="column"
    >
      <textarea
        ref={refValue}
        focused
        initialValue={editor.kind === "send" ? editor.instruction : (editor.initialBody ?? "")}
        placeholder={
          editor.kind === "send" ? "Review instruction…" : "What should change, and why?"
        }
        backgroundColor="transparent"
        focusedBackgroundColor="transparent"
        textColor={ink}
        focusedTextColor={ink}
        placeholderColor={GRAY}
        cursorColor={ink}
        keyBindings={[...EDITOR_KEY_BINDINGS]}
        flexGrow={1}
        onSubmit={onSubmit}
      />
      <text height={1} attributes={DIM}>
        {` ctrl+enter ${busy ? "working…" : "save"} · esc cancel`}
      </text>
    </box>
  );
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : error === null ? "" : String(error);

export function ReviewScreen({
  ctx,
  projectName,
  session,
  changeId,
  onBack,
  onQuit,
}: {
  readonly ctx: ReviewContext;
  readonly projectName: string;
  readonly session: ReviewSession;
  readonly changeId: string;
  readonly onBack: () => void;
  readonly onQuit: () => void;
}) {
  const queryClient = useQueryClient();
  const renderer = useRenderer();
  const ink = editorInk(renderer.themeMode);
  const washes = useMemo(() => diffWashes(renderer.themeMode), [renderer.themeMode]);
  const syntaxStyle = useMemo(() => syntaxStyleFor(ink), [ink]);
  const { width, height } = useTerminalDimensions();
  const wide = width >= 100;
  const descriptionHeight = height >= 30 ? 5 : 3;
  const { data, failureReason, isFetching } = useQuery({
    queryKey: REVIEW_KEY(changeId),
    queryFn: () => fetchReview(ctx, changeId),
    retry: true,
    retryDelay: 1000,
  });
  const [focus, setFocus] = useState<Focus>("diff");
  const [fileIndex, setFileIndex] = useState(0);
  const [anchorIndex, setAnchorIndex] = useState(0);
  const [commentIndex, setCommentIndex] = useState(0);
  const [tourIndex, setTourIndex] = useState(0);
  const [view, setView] = useState<DiffView>("unified");
  const [wrap, setWrap] = useState(false);
  const [showWhitespace, setShowWhitespace] = useState(false);
  const [rangeStart, setRangeStart] = useState<number | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const checkpointState = data === undefined ? (isFetching ? "recording" : "failed") : "recorded";
  const lockRef = useRef(false);
  const editorRef = useRef<TextareaRenderable | null>(null);
  const diffRef = useRef<DiffRenderable | null>(null);
  const diffScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const fileScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const commentScrollRef = useRef<ScrollBoxRenderable | null>(null);

  const files = useMemo(() => {
    const order: Readonly<Record<ReviewFile["status"], number>> = {
      added: 0,
      modified: 1,
      renamed: 2,
      deleted: 3,
    };
    return (data?.files ?? []).toSorted(
      (left, right) =>
        order[left.status] - order[right.status] || left.path.localeCompare(right.path),
    );
  }, [data?.files]);
  const selectedFile = files[Math.min(fileIndex, Math.max(0, files.length - 1))] ?? null;
  const anchors = useMemo(
    () => selectedFile?.lines.filter((line) => line.commentable) ?? [],
    [selectedFile],
  );
  const selectedAnchor = anchors[Math.min(anchorIndex, Math.max(0, anchors.length - 1))] ?? null;
  const comments = useMemo(() => orderedComments(data?.comments ?? []), [data?.comments]);
  const selectedComment =
    comments[Math.min(commentIndex, Math.max(0, comments.length - 1))] ?? null;
  const lineComment =
    selectedFile === null || selectedAnchor === null
      ? null
      : (comments.find(
          (comment) =>
            comment.file === selectedFile.path &&
            comment.line !== null &&
            selectedAnchor.newLine !== null &&
            comment.line <= selectedAnchor.newLine &&
            (comment.endLine ?? comment.line) >= selectedAnchor.newLine,
        ) ?? null);
  const detailComment = focus === "comments" ? selectedComment : lineComment;
  const tourStops = data?.tour?.stops ?? [];
  const activeTourIndex = Math.min(tourIndex, Math.max(0, tourStops.length - 1));
  const activeTourStop = tourStops[activeTourIndex] ?? null;
  const tourStale = useMemo(
    () =>
      data?.tour === null || data?.tour === undefined
        ? false
        : createHash("sha256").update(data.wire.diff).digest("hex") !== data.tour.diffDigest,
    [data?.tour, data?.wire.diff],
  );

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: REVIEW_KEY(changeId) });
  };
  /** Converge on the server's truth once, after the LAST in-flight mutation. */
  const settleRefresh = (): void => {
    if (queryClient.isMutating() === 1) refresh();
  };
  const patchReview = (f: (current: ReviewData) => ReviewData): void => {
    const current = queryClient.getQueryData<ReviewData>(REVIEW_KEY(changeId));
    if (current !== undefined) queryClient.setQueryData(REVIEW_KEY(changeId), f(current));
  };

  // A state flip (accept, address, dismiss, reopen) lands in the list at the
  // keystroke — triage never waits on a round trip. An error refetches the
  // truth back; the settled refetch reconciles everything else.
  const commentStateMutation = useMutation({
    mutationFn: (vars: {
      readonly commentId: string;
      readonly state: "open" | "addressed" | "dismissed";
    }) =>
      ctx.api("POST", `/changes/${changeId}/comments/${vars.commentId}/state`, {
        state: vars.state,
      }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: REVIEW_KEY(changeId) });
      patchReview((current) => ({
        ...current,
        comments: current.comments.map((comment) =>
          comment.id === vars.commentId ? { ...comment, state: vars.state } : comment,
        ),
      }));
    },
    onError: (error) => {
      setStatus(errorMessage(error));
      refresh();
    },
    onSettled: settleRefresh,
  });

  // A new comment appears in the list the moment ctrl+enter lands and the
  // editor closes; a failed save reopens the editor with the text intact.
  const commentCreateMutation = useMutation({
    mutationFn: (vars: {
      readonly sliceId: string;
      readonly body: string;
      readonly target: unknown;
      readonly optimistic: ReviewCommentDto;
    }) =>
      ctx.api("POST", `/changes/${changeId}/reviews/${vars.sliceId}/comments`, {
        target: vars.target,
        body: vars.body,
      }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: REVIEW_KEY(changeId) });
      patchReview((current) => ({
        ...current,
        comments: [vars.optimistic, ...current.comments],
      }));
      setEditor(null);
      setStatus(vars.optimistic.file === null ? "Change comment added" : "Inline comment added");
    },
    onError: (error, vars) => {
      patchReview((current) => ({
        ...current,
        comments: current.comments.filter((comment) => comment.id !== vars.optimistic.id),
      }));
      setEditor({
        kind: "comment",
        file: vars.optimistic.file,
        line: vars.optimistic.line,
        endLine: vars.optimistic.endLine,
        initialBody: vars.body,
      });
      setStatus(errorMessage(error));
    },
    onSettled: settleRefresh,
  });

  useEffect(() => {
    fileScrollRef.current?.scrollTo(Math.max(0, fileIndex * 2 - 2));
  }, [fileIndex]);
  useEffect(() => {
    commentScrollRef.current?.scrollTo(Math.max(0, commentIndex * 2 - 2));
  }, [commentIndex]);
  useEffect(() => {
    if (selectedAnchor === null) return;
    const row = view === "unified" ? selectedAnchor.unifiedRow : selectedAnchor.splitRow;
    diffScrollRef.current?.scrollTo(Math.max(0, row - 3));
  }, [selectedAnchor, view]);
  useEffect(() => {
    // Split can align a deletion and addition on one row; preserve their
    // semantic colors there. Unified has one fact per row, so cobalt can mark
    // the active comment anchor without lying about either side.
    if (view !== "unified" || selectedAnchor === null || diffRef.current === null) return;
    const start = rangeStart === null ? selectedAnchor.newLine : rangeStart;
    const selectedLine = selectedAnchor.newLine;
    const highlighted =
      start === null || selectedLine === null
        ? [selectedAnchor]
        : anchors.filter(
            (anchor) =>
              anchor.newLine !== null &&
              anchor.newLine >= Math.min(start, selectedLine) &&
              anchor.newLine <= Math.max(start, selectedLine),
          );
    for (const anchor of highlighted) {
      diffRef.current.setLineColor(anchor.unifiedRow, { gutter: COBALT, content: "transparent" });
    }
    return () => {
      if (diffRef.current === null) return;
      for (const anchor of highlighted) {
        const content =
          anchor.kind === "addition"
            ? washes.add
            : anchor.kind === "deletion"
              ? washes.del
              : "transparent";
        diffRef.current.setLineColor(anchor.unifiedRow, {
          gutter: "transparent",
          content,
        });
      }
    };
  }, [anchors, rangeStart, selectedAnchor, view, washes]);

  const moveFile = (delta: number): void => {
    if (files.length === 0) return;
    setFileIndex((current) => {
      const next = Math.max(0, Math.min(files.length - 1, current + delta));
      if (next !== current) {
        setAnchorIndex(0);
        setRangeStart(null);
      }
      return next;
    });
  };
  const moveAnchor = (delta: number): void => {
    if (anchors.length === 0) return;
    setAnchorIndex((current) => Math.max(0, Math.min(anchors.length - 1, current + delta)));
  };
  const navigateToAnchor = (file: string | null, line: number | null): void => {
    if (file === null) return;
    const nextFileIndex = files.findIndex((candidate) => candidate.path === file);
    if (nextFileIndex < 0) return;
    const nextFile = files[nextFileIndex];
    const nextAnchorIndex =
      line === null
        ? 0
        : (nextFile?.lines.findIndex(
            (candidate) => candidate.newLine !== null && candidate.newLine >= line,
          ) ?? -1);
    setFileIndex(nextFileIndex);
    setAnchorIndex(Math.max(0, nextAnchorIndex));
    setRangeStart(null);
  };
  const selectComment = (index: number): void => {
    const next = comments[index];
    if (next === undefined) return;
    setCommentIndex(index);
    navigateToAnchor(next.file, next.line);
  };
  const moveComment = (delta: number): void => {
    if (comments.length === 0) return;
    const current = Math.min(commentIndex, comments.length - 1);
    selectComment(Math.max(0, Math.min(comments.length - 1, current + delta)));
  };
  const moveTour = (delta: number): void => {
    if (tourStops.length === 0) return;
    const current = Math.min(tourIndex, tourStops.length - 1);
    const nextIndex = Math.max(0, Math.min(tourStops.length - 1, current + delta));
    const stop = tourStops[nextIndex];
    setTourIndex(nextIndex);
    if (stop !== undefined) navigateToAnchor(stop.file, stop.line);
  };
  const moveHunk = (delta: number): void => {
    if (selectedFile === null || selectedAnchor === null) return;
    const target = Math.max(
      0,
      Math.min(selectedFile.hunks.length - 1, selectedAnchor.hunk + delta),
    );
    const next = anchors.findIndex((anchor) => anchor.hunk === target);
    if (next >= 0) setAnchorIndex(next);
  };
  const setWorking = (value: boolean): void => {
    lockRef.current = value;
    setBusy(value);
  };
  const runAction = async (
    label: string,
    action: () => Promise<unknown>,
    completed = `${label} · requested`,
  ): Promise<void> => {
    setWorking(true);
    setStatus(`${label}…`);
    try {
      await action();
      setStatus(completed);
      refresh();
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setWorking(false);
    }
  };

  const openCommentEditor = (wholeChange: boolean): void => {
    if (wholeChange) {
      setEditor({ kind: "comment", file: null, line: null, endLine: null });
      return;
    }
    if (selectedFile?.status === "deleted" && selectedAnchor === null) {
      setStatus("Deleted-side anchors are not persisted · use C for a change comment");
      return;
    }
    if (selectedFile === null || selectedAnchor?.newLine === null || selectedAnchor === null) {
      setStatus("No new-side line selected");
      return;
    }
    const range = commentRange(rangeStart, selectedAnchor.newLine);
    setEditor({
      kind: "comment",
      file: selectedFile.path,
      line: range.line,
      endLine: range.endLine === range.line ? null : range.endLine,
    });
    setRangeStart(null);
  };

  const openSendEditor = (): void => {
    if (data === undefined) return;
    // A pending id is an optimistic row the server has not named yet — it
    // cannot ride a follow-up until the settle refetch replaces it.
    const sendable = data.comments.filter(
      (comment) =>
        comment.state === "open" && comment.sentToSessionId === null && !isPendingId(comment.id),
    );
    if (sendable.length === 0) {
      setStatus("No unsent open comments — accept a draft or write a comment first");
      return;
    }
    setEditor({
      kind: "send",
      instruction: assembleReviewInstruction(data.wire.change, sendable),
      commentIds: sendable.map((comment) => comment.id),
      idempotencyKey: `cli-follow-up:${data.sliceId}:${randomUUID()}`,
    });
  };

  const submitEditor = async (): Promise<void> => {
    if (editor === null || lockRef.current) return;
    const value = editorRef.current?.plainText.trim() ?? "";
    if (value === "") {
      setStatus("Write something before saving");
      return;
    }
    if (data === undefined) {
      setStatus("The pinned Review is not available.");
      return;
    }
    if (editor.kind === "comment") {
      const anchorFile = data.anchorFiles.find(
        (file) => (file.newPath ?? file.oldPath) === editor.file,
      );
      const endLine = editor.endLine ?? editor.line;
      const hunk =
        editor.line === null || endLine === null
          ? null
          : (anchorFile?.hunks.find(
              (candidate) =>
                candidate.newLines > 0 &&
                editor.line !== null &&
                editor.line >= candidate.newStart &&
                endLine <= candidate.newStart + candidate.newLines - 1,
            ) ?? null);
      if (editor.file !== null && (anchorFile === undefined || hunk === null)) {
        setStatus("The selected line is outside the pinned Review anchor.");
        return;
      }
      commentCreateMutation.mutate({
        sliceId: data.sliceId,
        body: value,
        target:
          editor.file === null
            ? {
                oldPath: null,
                newPath: null,
                side: null,
                startLine: null,
                endLine: null,
                hunkContextHash: null,
              }
            : {
                oldPath: anchorFile?.oldPath ?? null,
                newPath: anchorFile?.newPath ?? null,
                side: "new",
                startLine: editor.line,
                endLine,
                hunkContextHash: hunk?.contextHash ?? null,
              },
        optimistic: {
          id: pendingId(),
          file: editor.file,
          line: editor.line,
          endLine: editor.endLine,
          authorKind: "reviewer",
          authorName: "You",
          body: value,
          suggestion: null,
          state: "open",
          evidence: [],
          sentToSessionId: null,
          createdAt: new Date().toISOString(),
        },
      });
      return;
    }
    // Delivery stays pessimistic: it starts a run against the session, and
    // pretending it happened before the server agreed would fake a fact.
    setWorking(true);
    try {
      await deliverReview(ctx.api, session.id, {
        reviewSliceId: data.sliceId,
        checkpointAId: data.checkpointAId,
        checkpointBId: data.checkpointBId,
        diffDigest: data.diffDigest,
        commentIds: editor.commentIds,
        instruction: value,
        idempotencyKey: editor.idempotencyKey,
      });
      setStatus("Follow-up delivery requested · retry keeps the same run");
      setEditor(null);
      refresh();
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setWorking(false);
    }
  };

  const updateComment = (state: "open" | "addressed" | "dismissed"): void => {
    if (selectedComment === null) return;
    if (isPendingId(selectedComment.id)) {
      setStatus("That comment is still saving — one moment");
      return;
    }
    setStatus(`${state} · ${anchorOf(selectedComment)}`);
    commentStateMutation.mutate({ commentId: selectedComment.id, state });
  };

  const deliverAndRelaunch = (): void => {
    const followUp = data?.followUp ?? null;
    if (followUp === null || followUp.status === "delivered" || followUp.status === "superseded") {
      setStatus("No retryable follow-up — s assembles the open Review comments first");
      return;
    }
    if (
      followUp.reviewSliceId === null ||
      followUp.checkpointAId === null ||
      followUp.checkpointBId === null ||
      followUp.diffDigest === null ||
      followUp.idempotencyKey === null
    ) {
      setStatus("Legacy follow-up · recreate it from a pinned Review before delivery");
      return;
    }
    const input = {
      reviewSliceId: followUp.reviewSliceId,
      checkpointAId: followUp.checkpointAId,
      checkpointBId: followUp.checkpointBId,
      diffDigest: followUp.diffDigest,
      commentIds: followUp.commentIds,
      instruction: followUp.instruction,
      idempotencyKey: followUp.idempotencyKey,
    };
    void runAction(
      "Delivering the persisted Review bundle",
      () => deliverReview(ctx.api, session.id, input),
      "Delivery reconciled · the same idempotency key names one run",
    );
  };

  const focusOrder: ReadonlyArray<Focus> = wide
    ? ["files", "diff", "comments"]
    : ["diff", "comments"];
  const cycleFocus = (backwards: boolean): void => {
    const index = focusOrder.indexOf(focus);
    const direction = backwards ? -1 : 1;
    const next = (index + direction + focusOrder.length) % focusOrder.length;
    const nextFocus = focusOrder[next] ?? "diff";
    if (nextFocus === "comments" && selectedComment !== null) {
      navigateToAnchor(selectedComment.file, selectedComment.line);
    }
    setFocus(nextFocus);
  };

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") return onQuit();
    if (editor !== null) {
      if (key.name === "escape" && !lockRef.current) setEditor(null);
      return;
    }
    if (lockRef.current) return;
    if (key.name === "q") return onQuit();
    if (key.name === "escape" || key.name === "backspace" || key.name === "h") return onBack();
    if (key.name === "tab") return cycleFocus(key.shift);
    if (key.name === "r") {
      setStatus("Refreshing live change…");
      return refresh();
    }
    if (key.name === "o") {
      openUrl(`${ctx.config.url}/changes/${changeId}`);
      setStatus("Opened web review");
      return;
    }
    if (key.name === "c" && key.shift) return openCommentEditor(true);
    if (key.name === "s") return openSendEditor();
    if (key.name === "y") return deliverAndRelaunch();
    if (key.name === ",") return moveTour(-1);
    if (key.name === ".") return moveTour(1);
    if (key.name === "t") {
      return void runAction(
        data?.tour === null ? "Compose description and tour" : "Recompose tour",
        () => ctx.api("POST", `/changes/${changeId}/tour`, {}),
      );
    }
    if (key.name === "m") {
      return void runAction("Mend reads the change", () =>
        ctx.api("POST", `/changes/${changeId}/read`, {}),
      );
    }
    if (key.name === "g") {
      return void runAction("Draft concrete suggestions", () =>
        ctx.api("POST", `/changes/${changeId}/suggest`, {}),
      );
    }
    if (focus === "files") {
      if (key.name === "j" || key.name === "down") return moveFile(1);
      if (key.name === "k" || key.name === "up") return moveFile(-1);
      if (key.name === "return" || key.name === "linefeed" || key.name === "l") {
        return setFocus("diff");
      }
      return;
    }
    if (focus === "comments") {
      if (key.name === "j" || key.name === "down") return moveComment(1);
      if (key.name === "k" || key.name === "up") return moveComment(-1);
      if (key.name === "a" && selectedComment?.state === "draft") return updateComment("open");
      if (key.name === "a" && selectedComment?.state === "open") {
        return updateComment("addressed");
      }
      if (key.name === "x") return updateComment("dismissed");
      if (key.name === "u" && selectedComment !== null) return updateComment("open");
      if (key.name === "return" || key.name === "linefeed" || key.name === "l") {
        if (selectedComment !== null) navigateToAnchor(selectedComment.file, selectedComment.line);
        return setFocus("diff");
      }
      return;
    }
    if (key.name === "j" || key.name === "down") return moveAnchor(1);
    if (key.name === "k" || key.name === "up") return moveAnchor(-1);
    if (key.name === "n") return moveFile(1);
    if (key.name === "p") return moveFile(-1);
    if (key.name === "]") return moveHunk(1);
    if (key.name === "[") return moveHunk(-1);
    if (key.name === "c") return openCommentEditor(false);
    if (key.name === "v") {
      if (selectedAnchor?.newLine === null || selectedAnchor === null) {
        setStatus("Select a new-side line before starting a range");
        return;
      }
      setRangeStart((current) => (current === null ? selectedAnchor.newLine : null));
      setStatus(
        rangeStart === null ? `Range starts at line ${selectedAnchor.newLine}` : "Range cleared",
      );
      return;
    }
    if (key.name === "d" && wide)
      return setView((current) => (current === "unified" ? "split" : "unified"));
    if (key.name === "w") return setWrap((current) => !current);
    if (key.name === "z") return setShowWhitespace((current) => !current);
  });

  if (data === undefined) {
    return (
      <box flexGrow={1} alignItems="center" justifyContent="center">
        <text>
          <span fg={failureReason === null ? COBALT : AMBER}>
            {failureReason === null
              ? "Loading the live change…"
              : `${errorMessage(failureReason)} · retrying`}
          </span>
        </text>
      </box>
    );
  }

  const additions = data.wire.files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = data.wire.files.reduce((sum, file) => sum + file.deletions, 0);
  const openCount = data.comments.filter((comment) => comment.state === "open").length;
  const draftCount = data.comments.filter((comment) => comment.state === "draft").length;
  const displayRows =
    selectedFile === null
      ? 1
      : view === "unified"
        ? Math.max(1, selectedFile.unifiedRows)
        : Math.max(1, selectedFile.splitRows);
  const displayPatch =
    selectedFile === null || !showWhitespace
      ? (selectedFile?.patch ?? "")
      : visibleWhitespace(selectedFile.patch);
  const footer =
    editor === null
      ? focus === "files"
        ? " files · ↑↓/jk move · enter review · tab pane · esc back · q quit"
        : focus === "comments"
          ? " comments · ↑↓/jk move · enter anchor · a accept/address · x dismiss · u reopen · tab pane"
          : ` diff · ↑↓/jk lines · n/p files · [/ ] hunks · v range${rangeStart === null ? "" : `:${rangeStart}`} · c inline · C change · d layout · w wrap · z whitespace`
      : " ctrl+enter save · esc cancel";

  const sidebar: ReactNode = wide ? (
    <box width={36} flexShrink={0} flexDirection="column">
      <box flexGrow={1} minHeight={6} flexDirection="column">
        <text height={1}>
          <span {...(focus === "files" ? { fg: COBALT } : { attributes: DIM })}>
            {` files ${files.length}`}
          </span>
        </text>
        <scrollbox ref={fileScrollRef} focused={focus === "files"} flexGrow={1} minHeight={0}>
          {files.map((file, index) => (
            <box key={file.path} flexShrink={0} flexDirection="column">
              {index === 0 || files[index - 1]?.status !== file.status ? (
                <text height={1} attributes={DIM}>
                  {`  ${file.status}`}
                </text>
              ) : null}
              <FileRow file={file} selected={index === fileIndex} />
            </box>
          ))}
        </scrollbox>
      </box>
      <box flexGrow={1} minHeight={6} flexDirection="column" marginTop={1}>
        <text height={1}>
          <span {...(focus === "comments" ? { fg: COBALT } : { attributes: DIM })}>
            {` comments ${openCount} open${draftCount > 0 ? `  ${draftCount} draft` : ""}`}
          </span>
        </text>
        <scrollbox ref={commentScrollRef} focused={focus === "comments"} flexGrow={1} minHeight={0}>
          {comments.length === 0 ? (
            <text height={1} attributes={DIM}>
              {"  no review comments yet"}
            </text>
          ) : (
            comments.map((comment, index) => (
              <CommentRow key={comment.id} comment={comment} selected={index === commentIndex} />
            ))
          )}
        </scrollbox>
      </box>
    </box>
  ) : null;

  return (
    <box flexGrow={1} flexDirection="column">
      <box height={2} marginTop={1} flexShrink={0} flexDirection="column">
        <text height={1}>
          <span attributes={DIM}> mend / {projectName} / </span>
          <span fg={COBALT} attributes={BOLD}>
            review
          </span>
          <span attributes={DIM}>
            {"  "}
            {session.harness} {session.id.slice(0, 8)}
          </span>
          {isFetching ? <span fg={COBALT}>{"  syncing"}</span> : null}
          {checkpointState === "recorded" ? null : (
            <span fg={AMBER}>
              {checkpointState === "recording" ? "  checkpointing" : "  checkpoint incomplete"}
            </span>
          )}
        </text>
        <text height={1}>
          <span attributes={DIM}>
            {" "}
            {data.wire.change.branch.replace(/^mend\/session\//, "session ")} vs{" "}
            {data.wire.change.baseSha.slice(0, 12)}
            {"  "}
            {files.length} files
          </span>
          <span fg={GREEN}> +{additions}</span>
          <span fg={RED}> −{deletions}</span>
          {openCount > 0 ? <span fg={AMBER}>{`  ${openCount} open`}</span> : null}
        </text>
      </box>

      <Description
        data={data}
        tourIndex={activeTourIndex}
        stale={tourStale}
        width={width}
        height={descriptionHeight}
      />

      <box flexGrow={1} minHeight={0} flexDirection="row" marginTop={1}>
        {sidebar}
        <box flexGrow={1} minWidth={0} minHeight={0} flexDirection="column">
          <text height={1}>
            <span {...(focus === "diff" ? { fg: COBALT } : { attributes: DIM })}>
              {selectedFile === null
                ? " diff"
                : ` ${selectedFile.path}  ${view}${selectedFile.likelyGenerated ? "  likely generated" : ""}${showWhitespace ? "  whitespace" : ""}${wrap ? "  wrapped" : ""}`}
            </span>
          </text>
          {selectedFile === null || selectedFile.patch === "" || selectedFile.binary ? (
            <box flexGrow={1} alignItems="center" justifyContent="center">
              <text attributes={DIM}>
                {files.length === 0
                  ? "The worktree matches its base — nothing to review yet."
                  : selectedFile?.binary === true
                    ? "Binary change — text diff unavailable; statistics remain reviewable."
                    : "This file has no renderable text patch."}
              </text>
            </box>
          ) : (
            <scrollbox
              ref={diffScrollRef}
              focused={focus === "diff"}
              flexGrow={1}
              minHeight={0}
              scrollX
            >
              <diff
                key={`${selectedFile.path}-${view}-${wrap}-${showWhitespace}`}
                ref={diffRef}
                diff={displayPatch}
                view={view}
                syncScroll
                {...(selectedFile.filetype === undefined
                  ? {}
                  : { filetype: selectedFile.filetype })}
                syntaxStyle={syntaxStyle}
                wrapMode={wrap ? "word" : "none"}
                showLineNumbers
                fg={ink}
                lineNumberFg={GRAY}
                lineNumberBg="transparent"
                contextBg="transparent"
                contextContentBg="transparent"
                addedBg={washes.add}
                addedContentBg={washes.add}
                removedBg={washes.del}
                removedContentBg={washes.del}
                addedSignColor={GREEN}
                removedSignColor={RED}
                addedLineNumberBg="transparent"
                removedLineNumberBg="transparent"
                selectionBg={COBALT}
                selectionFg="#ffffff"
                width="100%"
                height={displayRows}
                flexShrink={0}
              />
            </scrollbox>
          )}
          {focus === "comments" && detailComment !== null ? (
            <EvidenceCard comment={detailComment} width={wide ? width - 38 : width} />
          ) : height < 30 && activeTourStop !== null ? (
            <CompactTourEvidence
              stop={activeTourStop}
              index={activeTourIndex}
              total={tourStops.length}
              width={width}
            />
          ) : detailComment === null ? null : (
            <EvidenceCard comment={detailComment} width={wide ? width - 38 : width} />
          )}
        </box>
      </box>

      {editor === null ? null : (
        <EditorPanel
          editor={editor}
          refValue={editorRef}
          busy={busy}
          ink={ink}
          onSubmit={() => void submitEditor()}
        />
      )}
      {status === "" ? (
        <text height={1} attributes={DIM}>
          {` m read · g suggest · t tour · ,/. tour stops · s draft review${data.followUp?.status === "pending" ? " · y deliver & relaunch" : ""} · o web · r refresh`}
        </text>
      ) : (
        <text height={1} fg={AMBER}>
          {` ${status}`}
        </text>
      )}
      <text height={1} attributes={DIM}>
        {footer}
      </text>
    </box>
  );
}
