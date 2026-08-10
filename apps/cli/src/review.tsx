import { spawn } from "node:child_process";

import {
  RGBA,
  SyntaxStyle,
  type DiffRenderable,
  type ScrollBoxRenderable,
  type TextareaRenderable,
} from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { assembleReviewInstruction, buildReviewFiles, type ReviewFile } from "./review-model.ts";
import {
  ADD_WASH,
  AMBER,
  BG,
  COBALT,
  DELETE_WASH,
  FAINT,
  GREEN,
  INK,
  MUTED,
  PANEL,
  RED,
  RULE,
  WASH,
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
  readonly instruction: string;
  readonly status: "pending" | "delivered" | "superseded";
}

interface ReviewData {
  readonly wire: ChangeDiffDto;
  readonly files: ReadonlyArray<ReviewFile>;
  readonly comments: ReadonlyArray<ReviewCommentDto>;
  readonly tour: ChangeTourDto | null;
  readonly passes: ReadonlyArray<ChangePassDto>;
  readonly followUp: FollowUpDto | null;
}

type Focus = "files" | "diff" | "comments";
type DiffView = "unified" | "split";
type Editor =
  | {
      readonly kind: "comment";
      readonly file: string | null;
      readonly line: number | null;
      readonly endLine: number | null;
    }
  | { readonly kind: "send"; readonly instruction: string };

const REVIEW_KEY = (changeId: string) => ["review", changeId] as const;
const EDITOR_KEY_BINDINGS = [{ name: "return", ctrl: true, action: "submit" }] as const;

const syntaxStyle = SyntaxStyle.fromStyles({
  keyword: { fg: RGBA.fromHex("#c8a0e8") },
  string: { fg: RGBA.fromHex("#8fc49f") },
  comment: { fg: RGBA.fromHex(FAINT), italic: true },
  number: { fg: RGBA.fromHex("#dfbd78") },
  function: { fg: RGBA.fromHex("#8eb7ef") },
  variable: { fg: RGBA.fromHex(INK) },
  default: { fg: RGBA.fromHex(INK) },
});

const truncate = (text: string, width: number): string => {
  const oneLine = text.replaceAll(/\s+/g, " ").trim();
  if (width <= 1) return "";
  return oneLine.length <= width ? oneLine : `${oneLine.slice(0, width - 1)}…`;
};

const openUrl = (target: string): void => {
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  const child = spawn(opener, [target], { detached: true, stdio: "ignore" });
  child.on("error", () => undefined);
  child.unref();
};

const fetchReview = async (ctx: ReviewContext, changeId: string): Promise<ReviewData> => {
  const wire = await ctx.api<ChangeDiffDto>("GET", `/changes/${changeId}/diff`);
  const [comments, tour, passes, followUp] = await Promise.all([
    ctx.api<ReadonlyArray<ReviewCommentDto>>("GET", `/changes/${changeId}/comments`),
    ctx.api<ChangeTourDto | null>("GET", `/changes/${changeId}/tour`),
    ctx.api<ReadonlyArray<ChangePassDto>>("GET", `/changes/${changeId}/passes`),
    ctx.api<FollowUpDto | null>("GET", `/sessions/${wire.change.sessionId}/follow-up`),
  ]);
  return { wire, files: buildReviewFiles(wire.diff, wire.files), comments, tour, passes, followUp };
};

const commentPriority = (comment: ReviewCommentDto): number =>
  comment.state === "draft" ? 0 : comment.state === "open" ? 1 : 2;

const orderedComments = (comments: ReadonlyArray<ReviewCommentDto>) =>
  comments.toSorted((a, b) => {
    const byState = commentPriority(a) - commentPriority(b);
    return byState === 0 ? b.createdAt.localeCompare(a.createdAt) : byState;
  });

const stateColor = (state: ReviewCommentDto["state"]): string =>
  state === "draft" || state === "open" ? AMBER : state === "addressed" ? GREEN : FAINT;

const stateGlyph = (state: ReviewCommentDto["state"]): string =>
  state === "draft" ? "◌" : state === "open" ? "●" : state === "addressed" ? "✓" : "×";

const anchorOf = (comment: ReviewCommentDto): string =>
  comment.file === null
    ? "change"
    : `${comment.file}${comment.line === null ? "" : `:${comment.line}${comment.endLine === null || comment.endLine === comment.line ? "" : `-${comment.endLine}`}`}`;

const passFact = (pass: ChangePassDto): { readonly text: string; readonly color: string } => {
  const label = pass.kind === "suggest" ? "suggestions" : pass.kind;
  if (pass.status === "running") return { text: `${label} running`, color: COBALT };
  if (pass.status === "failed") return { text: `${label} failed`, color: RED };
  return {
    text: `${label} observed · ${pass.findings ?? 0} ${pass.kind === "tour" ? "stops" : "drafts"}`,
    color: GREEN,
  };
};

const FileRow = ({ file, selected }: { readonly file: ReviewFile; readonly selected: boolean }) => (
  <box height={2} flexShrink={0} backgroundColor={selected ? WASH : "transparent"}>
    <text height={1} bg="transparent">
      <span fg={selected ? COBALT : FAINT}>{selected ? "▌ " : "  "}</span>
      <span fg={INK}>{file.path}</span>
    </text>
    <text height={1} bg="transparent">
      <span>{"    "}</span>
      <span fg={GREEN}>+{file.additions}</span>
      <span fg={FAINT}> </span>
      <span fg={RED}>−{file.deletions}</span>
      <span fg={FAINT}> · {file.hunks.length} hunks</span>
    </text>
  </box>
);

const CommentRow = ({
  comment,
  selected,
}: {
  readonly comment: ReviewCommentDto;
  readonly selected: boolean;
}) => (
  <box height={2} flexShrink={0} backgroundColor={selected ? WASH : "transparent"}>
    <text height={1} bg="transparent">
      <span fg={selected ? COBALT : FAINT}>{selected ? "▌ " : "  "}</span>
      <span fg={stateColor(comment.state)}>
        {stateGlyph(comment.state)} {comment.state}
      </span>
      <span fg={FAINT}> · {anchorOf(comment)}</span>
    </text>
    <text height={1} bg="transparent">
      <span>{"    "}</span>
      <span fg={comment.authorKind === "mend" ? COBALT : MUTED}>
        {comment.authorKind === "mend" ? "Mend · " : "You · "}
      </span>
      <span fg={INK}>{truncate(comment.body, 27)}</span>
    </text>
  </box>
);

const Description = ({
  data,
  width,
  height,
}: {
  readonly data: ReviewData;
  readonly width: number;
  readonly height: number;
}) => {
  const passFacts = data.passes.map(passFact);
  return (
    <box
      height={height}
      border
      borderStyle="rounded"
      borderColor={data.tour === null ? RULE : COBALT}
      title=" change description "
      titleAlignment="left"
      backgroundColor={PANEL}
      flexShrink={0}
      flexDirection="column"
      paddingX={1}
    >
      <text height={1} bg="transparent">
        <span fg={INK}>
          {data.tour === null
            ? "No description yet — t composes one from the diff and session record."
            : truncate(data.tour.summary, Math.max(20, width - 8))}
        </span>
      </text>
      {height >= 5 ? (
        <text height={1} bg="transparent">
          <span fg={FAINT}>
            {data.tour?.approach === null || data.tour?.approach === undefined
              ? "The diff remains available while inference is absent."
              : `from the record · ${truncate(data.tour.approach, Math.max(20, width - 26))}`}
          </span>
        </text>
      ) : null}
      <text height={1} bg="transparent">
        {passFacts.length === 0 ? (
          <span fg={FAINT}>Mend has not read this change.</span>
        ) : (
          passFacts.map((fact, index) => (
            <span key={`${fact.text}-${index}`}>
              {index > 0 ? <span fg={FAINT}> · </span> : null}
              <span fg={fact.color}>{fact.text}</span>
            </span>
          ))
        )}
        {data.followUp?.status === "pending" ? <span fg={AMBER}> · follow-up pending</span> : null}
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
    height={Math.min(6, 4 + Math.min(2, comment.evidence.length))}
    border
    borderStyle="rounded"
    borderColor={comment.state === "draft" ? AMBER : RULE}
    title={` ${anchorOf(comment)} · ${comment.authorKind === "mend" ? "Mend" : "You"} `}
    titleAlignment="left"
    backgroundColor={PANEL}
    flexShrink={0}
    flexDirection="column"
    paddingX={1}
  >
    <text height={1} fg={INK} bg="transparent">
      {truncate(comment.body, Math.max(12, width - 6))}
    </text>
    {comment.suggestion === null ? null : (
      <text height={1} bg="transparent">
        <span fg={COBALT}>proposed · </span>
        <span fg={MUTED}>{truncate(comment.suggestion, Math.max(12, width - 17))}</span>
      </text>
    )}
    {comment.evidence.slice(0, 2).map((evidence) => (
      <text key={`${evidence.sequence}-${evidence.excerpt}`} height={1} bg="transparent">
        <span fg={FAINT}>seq {evidence.sequence} · </span>
        <span fg={MUTED}>{truncate(evidence.excerpt, Math.max(12, width - 18))}</span>
      </text>
    ))}
  </box>
);

const EditorPanel = ({
  editor,
  refValue,
  busy,
  onSubmit,
}: {
  readonly editor: Editor;
  readonly refValue: React.RefObject<TextareaRenderable | null>;
  readonly busy: boolean;
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
      backgroundColor={BG}
      height={editor.kind === "send" ? 16 : 8}
      flexShrink={0}
      flexDirection="column"
    >
      <textarea
        ref={refValue}
        focused
        initialValue={editor.kind === "send" ? editor.instruction : ""}
        placeholder={
          editor.kind === "send" ? "Review instruction…" : "What should change, and why?"
        }
        backgroundColor={BG}
        focusedBackgroundColor={BG}
        textColor={INK}
        focusedTextColor={INK}
        placeholderColor={FAINT}
        cursorColor={INK}
        keyBindings={[...EDITOR_KEY_BINDINGS]}
        flexGrow={1}
        onSubmit={onSubmit}
      />
      <text height={1} bg="transparent">
        <span fg={FAINT}> ctrl+enter {busy ? "working…" : "save"} · esc cancel</span>
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
  const { width, height } = useTerminalDimensions();
  const wide = width >= 100;
  const descriptionHeight = height >= 30 ? 6 : 4;
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
  const [view, setView] = useState<DiffView>("unified");
  const [wrap, setWrap] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const lockRef = useRef(false);
  const editorRef = useRef<TextareaRenderable | null>(null);
  const diffRef = useRef<DiffRenderable | null>(null);
  const diffScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const fileScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const commentScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const checkpointedRef = useRef(false);

  const files = data?.files ?? [];
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

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: REVIEW_KEY(changeId) });
  };

  useEffect(() => {
    if (checkpointedRef.current) return;
    checkpointedRef.current = true;
    void ctx
      .api("POST", `/sessions/${session.id}/checkpoints`, { trigger: "review-open" })
      .catch(() => undefined);
  }, [ctx, session.id]);

  useEffect(() => {
    setFileIndex((current) => Math.min(current, Math.max(0, files.length - 1)));
  }, [files.length]);
  useEffect(() => {
    setAnchorIndex(0);
  }, [selectedFile?.path]);
  useEffect(() => {
    setCommentIndex((current) => Math.min(current, Math.max(0, comments.length - 1)));
  }, [comments.length]);

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
    diffRef.current.setLineColor(selectedAnchor.unifiedRow, { gutter: COBALT, content: WASH });
    return () => {
      if (diffRef.current === null) return;
      const content =
        selectedAnchor.kind === "addition"
          ? ADD_WASH
          : selectedAnchor.kind === "deletion"
            ? DELETE_WASH
            : "transparent";
      diffRef.current.setLineColor(selectedAnchor.unifiedRow, {
        gutter: "transparent",
        content,
      });
    };
  }, [selectedAnchor, view]);

  const moveFile = (delta: number): void => {
    if (files.length === 0) return;
    setFileIndex((current) => Math.max(0, Math.min(files.length - 1, current + delta)));
  };
  const moveAnchor = (delta: number): void => {
    if (anchors.length === 0) return;
    setAnchorIndex((current) => Math.max(0, Math.min(anchors.length - 1, current + delta)));
  };
  const moveComment = (delta: number): void => {
    if (comments.length === 0) return;
    setCommentIndex((current) => Math.max(0, Math.min(comments.length - 1, current + delta)));
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
  const runAction = async (label: string, action: () => Promise<unknown>): Promise<void> => {
    setWorking(true);
    setStatus(`${label}…`);
    try {
      await action();
      setStatus(`${label} · requested`);
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
    if (selectedFile === null || selectedAnchor?.newLine === null || selectedAnchor === null) {
      setStatus("No new-side line selected");
      return;
    }
    setEditor({
      kind: "comment",
      file: selectedFile.path,
      line: selectedAnchor.newLine,
      endLine: null,
    });
  };

  const openSendEditor = (): void => {
    if (data === undefined) return;
    const sendable = data.comments.filter(
      (comment) => comment.state === "open" && comment.sentToSessionId === null,
    );
    if (sendable.length === 0) {
      setStatus("No unsent open comments — accept a draft or write a comment first");
      return;
    }
    setEditor({
      kind: "send",
      instruction: assembleReviewInstruction(data.wire.change, sendable),
    });
  };

  const submitEditor = async (): Promise<void> => {
    if (editor === null || lockRef.current) return;
    const value = editorRef.current?.plainText.trim() ?? "";
    if (value === "") {
      setStatus("Write something before saving");
      return;
    }
    setWorking(true);
    try {
      if (editor.kind === "comment") {
        await ctx.api("POST", `/changes/${changeId}/comments`, {
          file: editor.file,
          line: editor.line,
          endLine: editor.endLine,
          body: value,
        });
        setStatus(editor.file === null ? "Change comment saved" : "Inline comment saved");
      } else {
        await ctx.api("POST", `/sessions/${session.id}/follow-up`, { instruction: value });
        setStatus("Follow-up saved · mend continue delivers it to the session");
      }
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
    void runAction(`${state} ${anchorOf(selectedComment)}`, () =>
      ctx.api("POST", `/changes/${changeId}/comments/${selectedComment.id}/state`, { state }),
    );
  };

  const focusOrder: ReadonlyArray<Focus> = wide
    ? ["files", "diff", "comments"]
    : ["diff", "comments"];
  const cycleFocus = (backwards: boolean): void => {
    const index = focusOrder.indexOf(focus);
    const direction = backwards ? -1 : 1;
    const next = (index + direction + focusOrder.length) % focusOrder.length;
    setFocus(focusOrder[next] ?? "diff");
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
      return;
    }
    if (key.name === "j" || key.name === "down") return moveAnchor(1);
    if (key.name === "k" || key.name === "up") return moveAnchor(-1);
    if (key.name === "n") return moveFile(1);
    if (key.name === "p") return moveFile(-1);
    if (key.name === "]") return moveHunk(1);
    if (key.name === "[") return moveHunk(-1);
    if (key.name === "c") return openCommentEditor(false);
    if (key.name === "d" && wide)
      return setView((current) => (current === "unified" ? "split" : "unified"));
    if (key.name === "w") return setWrap((current) => !current);
  });

  if (data === undefined) {
    return (
      <box flexGrow={1} backgroundColor={BG} alignItems="center" justifyContent="center">
        <text bg="transparent">
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
  const footer =
    editor !== null
      ? " ctrl+enter save · esc cancel"
      : focus === "files"
        ? " files · ↑↓/jk move · enter review · tab pane · esc back · q quit"
        : focus === "comments"
          ? " comments · ↑↓/jk move · a accept/address · x dismiss · u reopen · tab pane"
          : " diff · ↑↓/jk lines · n/p files · [/ ] hunks · c inline · C change · d layout · w wrap";

  const sidebar: ReactNode = wide ? (
    <box width={36} flexShrink={0} flexDirection="column" backgroundColor={BG}>
      <box
        border
        borderStyle="rounded"
        borderColor={focus === "files" ? COBALT : RULE}
        title={` files · ${files.length} `}
        titleAlignment="left"
        backgroundColor={PANEL}
        flexGrow={1}
        minHeight={6}
      >
        <scrollbox
          ref={fileScrollRef}
          focused={focus === "files"}
          flexGrow={1}
          minHeight={0}
          style={{
            rootOptions: { backgroundColor: PANEL, border: false },
            wrapperOptions: { backgroundColor: PANEL },
            viewportOptions: { backgroundColor: PANEL },
            contentOptions: { backgroundColor: PANEL },
          }}
        >
          {files.map((file, index) => (
            <FileRow key={file.path} file={file} selected={index === fileIndex} />
          ))}
        </scrollbox>
      </box>
      <box
        border
        borderStyle="rounded"
        borderColor={focus === "comments" ? COBALT : RULE}
        title={` comments · ${openCount} open${draftCount > 0 ? ` · ${draftCount} draft` : ""} `}
        titleAlignment="left"
        backgroundColor={PANEL}
        flexGrow={1}
        minHeight={6}
      >
        <scrollbox
          ref={commentScrollRef}
          focused={focus === "comments"}
          flexGrow={1}
          minHeight={0}
          style={{
            rootOptions: { backgroundColor: PANEL, border: false },
            wrapperOptions: { backgroundColor: PANEL },
            viewportOptions: { backgroundColor: PANEL },
            contentOptions: { backgroundColor: PANEL },
          }}
        >
          {comments.length === 0 ? (
            <text height={1} fg={FAINT} bg="transparent">
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
    <box flexGrow={1} flexDirection="column" backgroundColor={BG}>
      <box height={2} flexShrink={0} flexDirection="column" backgroundColor={BG}>
        <text height={1} bg="transparent">
          <span fg={INK}> mend</span>
          <span fg={FAINT}> / </span>
          <span fg={MUTED}>{projectName}</span>
          <span fg={FAINT}> / </span>
          <span fg={COBALT}>review</span>
          <span fg={FAINT}>
            {" "}
            · {session.harness} {session.id.slice(0, 8)}
          </span>
          {isFetching ? <span fg={COBALT}> · syncing</span> : null}
        </text>
        <text height={1} bg="transparent">
          <span fg={FAINT}> {data.wire.change.branch.replace(/^mend\/session\//, "session ")}</span>
          <span fg={FAINT}> · worktree vs {data.wire.change.baseSha.slice(0, 12)} · </span>
          <span fg={MUTED}>{files.length} files</span>
          <span fg={GREEN}> +{additions}</span>
          <span fg={RED}> −{deletions}</span>
          <span fg={AMBER}> · {openCount} open</span>
        </text>
      </box>

      <Description data={data} width={width} height={descriptionHeight} />

      <box flexGrow={1} minHeight={0} flexDirection="row" backgroundColor={BG}>
        {sidebar}
        <box flexGrow={1} minWidth={0} minHeight={0} flexDirection="column" backgroundColor={BG}>
          <box
            border
            borderStyle="rounded"
            borderColor={focus === "diff" ? COBALT : RULE}
            title={
              selectedFile === null
                ? " diff "
                : ` ${selectedFile.path} · ${view}${wrap ? " · wrapped" : ""} `
            }
            titleAlignment="left"
            backgroundColor={PANEL}
            flexGrow={1}
            minHeight={0}
          >
            {selectedFile === null || selectedFile.patch === "" ? (
              <box flexGrow={1} alignItems="center" justifyContent="center">
                <text fg={FAINT} bg="transparent">
                  {files.length === 0
                    ? "The worktree matches its base — nothing to review yet."
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
                style={{
                  rootOptions: { backgroundColor: PANEL, border: false },
                  wrapperOptions: { backgroundColor: PANEL },
                  viewportOptions: { backgroundColor: PANEL },
                  contentOptions: { backgroundColor: PANEL },
                }}
              >
                <diff
                  key={`${selectedFile.path}-${view}-${wrap}`}
                  ref={diffRef}
                  diff={selectedFile.patch}
                  view={view}
                  syncScroll
                  {...(selectedFile.filetype === undefined
                    ? {}
                    : { filetype: selectedFile.filetype })}
                  syntaxStyle={syntaxStyle}
                  wrapMode={wrap ? "word" : "none"}
                  showLineNumbers
                  fg={INK}
                  lineNumberFg={FAINT}
                  lineNumberBg="transparent"
                  contextBg="transparent"
                  contextContentBg="transparent"
                  addedBg={ADD_WASH}
                  addedContentBg={ADD_WASH}
                  removedBg={DELETE_WASH}
                  removedContentBg={DELETE_WASH}
                  addedSignColor={GREEN}
                  removedSignColor={RED}
                  addedLineNumberBg="transparent"
                  removedLineNumberBg="transparent"
                  selectionBg={WASH}
                  selectionFg={INK}
                  width="100%"
                  height={displayRows}
                  flexShrink={0}
                />
              </scrollbox>
            )}
          </box>
          {detailComment === null ? null : (
            <EvidenceCard comment={detailComment} width={wide ? width - 38 : width} />
          )}
        </box>
      </box>

      {editor === null ? null : (
        <EditorPanel
          editor={editor}
          refValue={editorRef}
          busy={busy}
          onSubmit={() => void submitEditor()}
        />
      )}
      <text height={1} fg={status === "" ? FAINT : AMBER} bg="transparent">
        {status === ""
          ? " m read · g suggest · t tour · s send review · o web · r refresh"
          : ` ${status}`}
      </text>
      <text height={1} fg={FAINT} bg="transparent">
        {footer}
      </text>
    </box>
  );
}
