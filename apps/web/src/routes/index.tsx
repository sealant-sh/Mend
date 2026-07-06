import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import { AppShell } from "#/components/shell";
import { StatusDot } from "#/components/status";
import {
  createIssue,
  listIssues,
  moveIssue,
  type IssueDto,
  type IssueStage,
  type MendEventDto,
} from "#/lib/api";

export const Route = createFileRoute("/")({
  // Session lives in a cookie; the loader runs in the browser and the API
  // redirects to /login via 401. No SSR for authed surfaces in M1.
  ssr: false,
  loader: () => listIssues(),
  component: QueuePage,
});

const STAGES: ReadonlyArray<{
  readonly stage: IssueStage;
  readonly title: string;
  readonly hint: string;
}> = [
  { stage: "triage", title: "Triage", hint: "Issues arrive here. Mend does nothing on its own." },
  { stage: "queued", title: "Queued", hint: "Gate 1 — drag an issue here to start work." },
  { stage: "mending", title: "Mending", hint: "One harness per issue, recorded." },
  { stage: "review", title: "Review", hint: "The brief is ready to read." },
  { stage: "merged", title: "Merged", hint: "Approved by a human, merged on GitHub." },
];

function QueuePage() {
  const issues = Route.useLoaderData();
  const router = useRouter();
  const [progress, setProgress] = useState<Record<string, string>>({});
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // A live subscription has a real lifecycle — this is the one clean home for it.
  useEffect(() => {
    const source = new EventSource("/api/events");
    source.addEventListener("message", (message) => {
      const event: MendEventDto = JSON.parse(message.data);
      if (event.type === "run-progress") {
        setProgress((current) => ({ ...current, [event.issueId]: event.line }));
        return;
      }
      void router.invalidate();
    });
    return () => source.close();
  }, [router]);

  const queued = issues
    .filter((issue) => issue.stage === "queued")
    .toSorted((a, b) => (a.position ?? 0) - (b.position ?? 0));

  const onDragEnd = (event: DragEndEvent) => {
    const over = event.over;
    if (over === null) return;
    const issueId = String(event.active.id);
    const overId = String(over.id);

    const apply = async () => {
      if (overId === "column:triage") await moveIssue(issueId, "triage", null);
      else if (overId === "column:queued") await moveIssue(issueId, "queued", null);
      else {
        const target = queued.findIndex((issue) => issue.id === overId);
        if (target === -1) return;
        await moveIssue(issueId, "queued", target);
      }
      await router.invalidate();
    };
    void apply();
  };

  return (
    <AppShell>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="ev-eyebrow">triage · queued · mending · review · merged</p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.02em]">The queue</h1>
          <p className="mt-2 max-w-[64ch] text-sm leading-relaxed text-muted-foreground">
            Work starts when you drag an issue into the queue — never before.
          </p>
        </div>
        <NewIssueForm />
      </div>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-5">
          {STAGES.map(({ stage, title, hint }) => {
            const stageIssues =
              stage === "queued" ? queued : issues.filter((issue) => issue.stage === stage);
            return (
              <StageColumn
                key={stage}
                stage={stage}
                title={title}
                hint={hint}
                count={stageIssues.length}
              >
                {stage === "queued" ? (
                  <SortableContext
                    items={stageIssues.map((issue) => issue.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {stageIssues.map((issue) => (
                      <SortableCard key={issue.id} issue={issue} progress={progress} />
                    ))}
                  </SortableContext>
                ) : (
                  stageIssues.map((issue) => (
                    <DraggableCard key={issue.id} issue={issue} progress={progress} />
                  ))
                )}
              </StageColumn>
            );
          })}
        </div>
      </DndContext>
    </AppShell>
  );
}

function NewIssueForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [repository, setRepository] = useState("");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        className="inline-flex min-h-10 items-center justify-center rounded-xl bg-primary px-4 font-sans text-sm font-medium text-primary-foreground shadow-[var(--shadow-cobalt)] transition-[transform,background-color] duration-200 hover:-translate-y-0.5 hover:bg-[var(--primary-hover)]"
        onClick={() => setOpen(true)}
      >
        New issue
      </button>
    );
  }

  const submit = async () => {
    setPending(true);
    await createIssue({ title, repository, body });
    setPending(false);
    setOpen(false);
    setTitle("");
    setRepository("");
    setBody("");
    await router.invalidate();
  };

  return (
    <form
      className="w-full max-w-xl rounded-2xl bg-panel p-5 shadow-[var(--shadow-md)]"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <p className="ev-eyebrow">manual entry</p>
      <div className="mt-3 space-y-3">
        <input
          className="w-full rounded-lg border border-input bg-background px-3 py-2 font-sans text-sm outline-none transition-colors duration-150 focus:border-[var(--sw-accent)]"
          placeholder="Title — one line, the way you'd file it"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
        />
        <input
          className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-[12.5px] outline-none transition-colors duration-150 focus:border-[var(--sw-accent)]"
          placeholder="github.com/you/repository"
          value={repository}
          onChange={(event) => setRepository(event.target.value)}
          required
        />
        <textarea
          className="min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 font-sans text-sm outline-none transition-colors duration-150 focus:border-[var(--sw-accent)]"
          placeholder="Body — reproduction steps, context, the failing case"
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-9 items-center justify-center rounded-xl bg-primary px-4 font-sans text-[13px] font-medium text-primary-foreground shadow-[var(--shadow-cobalt)] disabled:opacity-60"
        >
          {pending ? "Adding…" : "Add to triage"}
        </button>
        <button
          type="button"
          className="font-sans text-[13px] text-muted-foreground hover:text-foreground"
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function StageColumn({
  stage,
  title,
  hint,
  count,
  children,
}: {
  readonly stage: IssueStage;
  readonly title: string;
  readonly hint: string;
  readonly count: number;
  readonly children: ReactNode;
}) {
  const droppable = stage === "triage" || stage === "queued";
  const { setNodeRef, isOver } = useDroppable({ id: `column:${stage}`, disabled: !droppable });

  return (
    <section className="min-w-0">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="font-sans text-[13px] font-semibold">{title}</h2>
        <span className="font-mono text-xs text-faint">{count}</span>
      </div>
      <div
        ref={setNodeRef}
        className={`mt-3 min-h-32 space-y-3 rounded-2xl transition-colors duration-150 ${
          isOver ? "bg-[var(--sw-wash)]" : ""
        }`}
      >
        {count === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/80 px-4 py-6">
            <p className="text-[13px] leading-relaxed text-muted-foreground">{hint}</p>
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

function CardBody({
  issue,
  progress,
}: {
  readonly issue: IssueDto;
  readonly progress: Record<string, string>;
}) {
  return (
    <>
      <h3 className="font-sans text-sm font-medium leading-snug">{issue.title}</h3>
      <p className="mt-2 truncate font-mono text-xs text-faint">
        {issue.externalRef ?? issue.repository}
      </p>
      {issue.stage === "mending" ? (
        <div className="mt-3 border-t border-[var(--sw-faint-rule)] pt-2.5">
          <StatusDot tone="accent" word="Mending · recording" pulse />
          {progress[issue.id] === undefined ? null : (
            <p className="mt-1.5 truncate font-mono text-[11.5px] text-faint">
              {progress[issue.id]}
            </p>
          )}
        </div>
      ) : null}
      {issue.stage === "triage" && issue.lastFailureRunId !== null ? (
        <div className="mt-3 border-t border-[var(--sw-faint-rule)] pt-2.5">
          <StatusDot tone="red" word="Last run failed" />
        </div>
      ) : null}
    </>
  );
}

const cardClass =
  "block rounded-2xl bg-panel p-4 shadow-[var(--shadow-sm)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] no-underline text-foreground";

function DraggableCard({
  issue,
  progress,
}: {
  readonly issue: IssueDto;
  readonly progress: Record<string, string>;
}) {
  const draggable = issue.stage === "triage";
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: issue.id,
    disabled: !draggable,
  });

  return (
    <Link
      to="/issues/$issueId"
      params={{ issueId: issue.id }}
      ref={setNodeRef}
      className={`${cardClass} ${draggable ? "cursor-grab touch-none" : ""}`}
      style={{ transform: CSS.Translate.toString(transform) }}
      {...attributes}
      {...listeners}
    >
      <CardBody issue={issue} progress={progress} />
    </Link>
  );
}

function SortableCard({
  issue,
  progress,
}: {
  readonly issue: IssueDto;
  readonly progress: Record<string, string>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: issue.id,
  });

  return (
    <Link
      to="/issues/$issueId"
      params={{ issueId: issue.id }}
      ref={setNodeRef}
      className={`${cardClass} cursor-grab touch-none ${isDragging ? "opacity-60" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
    >
      <CardBody issue={issue} progress={progress} />
    </Link>
  );
}
