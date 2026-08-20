import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { StatusDot } from "#/components/status-dot";
import {
  addService,
  restartService,
  runService,
  runServiceRecipe,
  type ServiceViewDto,
  type SessionDto,
  stopService,
} from "#/lib/api";
import { useEventsState } from "#/lib/events";
import { useNow } from "#/lib/now";
import { processOutputQuery, queryClient, sessionRecipesQuery } from "#/lib/queries";
import { type ServiceAction, type ServiceFacts, servicesForSession } from "#/lib/services";
import { ago, clock } from "#/lib/words";

const actionLabel: Record<ServiceAction, string> = {
  open: "Open",
  copy: "Copy endpoint",
  logs: "Logs",
  restart: "Restart",
  stop: "Stop",
  "remove-forward": "Remove forward",
  "run-again": "Run again",
};

const refreshServices = () => queryClient.invalidateQueries({ queryKey: ["services"] });

function ReadOnlyLogs({
  processId,
  onClose,
}: {
  readonly processId: string;
  readonly onClose: () => void;
}) {
  const output = useQuery({ ...processOutputQuery(processId), refetchInterval: 1_500 });
  let content = output.data?.text || "no output recorded";
  if (output.isPending) content = "reading recorded output…";
  if (output.isError) {
    content = output.error instanceof Error ? output.error.message : "logs unavailable";
  }
  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-panel">
      <div className="flex h-11 shrink-0 items-center border-b border-rule px-4">
        <div>
          <p className="font-sans text-[13px] font-medium text-foreground">Read-only logs</p>
          <p className="font-mono text-[10.5px] text-faint">
            sequence-addressed · input unavailable
          </p>
        </div>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="font-sans text-xs text-label hover:text-foreground"
        >
          Close
        </button>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap bg-term p-4 font-mono text-[11.5px] leading-relaxed text-term-fg">
        {content}
      </pre>
    </div>
  );
}

function ServiceRow({
  facts,
  now,
  eventState,
  pending,
  act,
}: {
  readonly facts: ServiceFacts;
  readonly now: number;
  readonly eventState: ReturnType<typeof useEventsState>;
  readonly pending: string | null;
  readonly act: (action: ServiceAction, facts: ServiceFacts) => void;
}) {
  const service = facts.view.service;
  return (
    <article className="border-b border-rule-faint px-4 py-4 last:border-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-sans text-[13px] font-medium text-foreground">{facts.name}</p>
          <p className="mt-0.5 font-mono text-[10.5px] text-faint">
            {service.declarationSource} · :{service.workspacePort}
            {service.transport === "udp" ? "/udp" : ""}
          </p>
        </div>
        {facts.attention === null ? null : (
          <StatusDot tone={facts.attention.tone} word={facts.attention.word} size={6} />
        )}
      </div>
      <div className="mt-3 space-y-1.5">
        {facts.process === null ? (
          <p className="font-mono text-[11px] text-faint">No Mend-owned process</p>
        ) : (
          <StatusDot tone={facts.process.tone} word={facts.process.word} size={6} />
        )}
        <StatusDot tone={facts.forward.tone} word={facts.forward.word} size={6} />
        {facts.target === null ? (
          <p className="font-mono text-[11px] text-faint">Target unobserved</p>
        ) : (
          <div className="flex flex-wrap items-center gap-x-1.5">
            <StatusDot tone={facts.target.tone} word={facts.target.word} size={6} />
            <span className="font-mono text-[10.5px] text-faint">
              observed {ago(facts.target.observedAt, now) ?? clock(facts.target.observedAt)}
              {eventState === "live" ? " ago" : ` · event stream ${eventState}`}
            </span>
          </div>
        )}
        {facts.movedFrom === null ? null : (
          <p className="border-l-2 border-[var(--sw-amber)] pl-2 font-mono text-[10.5px] text-warning">
            Endpoint moved from {facts.movedFrom}
          </p>
        )}
        {facts.endpoint?.scope === "private" ? (
          <p className="border-l-2 border-[var(--sw-amber)] pl-2 font-sans text-[11px] leading-relaxed text-warning">
            No Mend sign-in protects this port. Anyone who can reach this private address can
            connect.
          </p>
        ) : null}
        {facts.view.workspaceTtlRenewalError === null ? null : (
          <p className="border-l-2 border-[var(--sw-amber)] pl-2 font-mono text-[10.5px] text-warning">
            TTL renewal failed · known expiry {facts.view.workspaceExpiresAt ?? "unknown"}
          </p>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
        {facts.actions.map((action) => (
          <button
            key={action}
            type="button"
            disabled={pending !== null}
            onClick={() => act(action, facts)}
            className={`${action === "stop" || action === "remove-forward" ? "hover:text-danger" : "hover:text-info"} font-sans text-[11.5px] text-label disabled:opacity-40`}
          >
            {pending === `${action}:${service.id}`
              ? `${actionLabel[action]}…`
              : actionLabel[action]}
          </button>
        ))}
      </div>
      {service.attemptHistoryComplete ? null : (
        <p className="mt-2 font-mono text-[10px] text-faint">Earlier attempts were not recorded.</p>
      )}
    </article>
  );
}

export function ServicesDrawer({
  session,
  views,
  onClose,
}: {
  readonly session: SessionDto;
  readonly views: ReadonlyArray<ServiceViewDto>;
  readonly onClose: () => void;
}) {
  const recipes = useQuery(sessionRecipesQuery(session.id));
  const eventState = useEventsState();
  const now = useNow();
  const facts = servicesForSession(views, session.id);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logsFor, setLogsFor] = useState<string | null>(null);
  const performAction = (key: string, promise: Promise<unknown>) => {
    setPending(key);
    setError(null);
    void promise
      .then(refreshServices)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setPending(null));
  };
  const act = (action: ServiceAction, item: ServiceFacts) => {
    const id = item.view.service.id;
    if (action === "open" && item.browserUrl !== null) {
      void window.mend.shell.openExternal(item.browserUrl);
      return;
    }
    if (action === "copy" && item.endpoint !== null) {
      void navigator.clipboard.writeText(item.endpoint.authority);
      return;
    }
    if (action === "logs" && item.logAttempt !== null) {
      setLogsFor(item.logAttempt.id);
      return;
    }
    if (action === "restart") {
      performAction(`${action}:${id}`, restartService(id));
      return;
    }
    if (action === "stop" || action === "remove-forward") {
      performAction(`${action}:${id}`, stopService(id));
      return;
    }
    const attempt = item.logAttempt;
    if (action === "run-again" && attempt !== null) {
      performAction(
        `${action}:${id}`,
        runService(session.id, {
          argv: attempt.argv,
          port: item.view.service.workspacePort,
          name: item.name,
          protocol: item.view.service.transport,
          browserScheme: item.view.service.browserScheme,
        }),
      );
    }
  };
  const submit = (form: HTMLFormElement) => {
    const data = new FormData(form);
    const command = String(data.get("command") ?? "").trim();
    const name = String(data.get("name") ?? "").trim() || null;
    const port = Number(data.get("port"));
    const protocol = data.get("udp") === "on" ? "udp" : "tcp";
    const requested = String(data.get("scheme") ?? "");
    let browserScheme: "http" | "https" | null = null;
    if (protocol === "tcp" && requested === "http") browserScheme = "http";
    if (protocol === "tcp" && requested === "https") browserScheme = "https";
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      setError("Enter a port between 1 and 65535.");
      return;
    }
    performAction(
      "run:form",
      command === ""
        ? addService(session.id, { port, name, protocol, browserScheme })
        : runService(session.id, {
            argv: ["sh", "-c", command],
            port,
            name,
            protocol,
            browserScheme,
          }),
    );
    form.reset();
  };

  return (
    <aside
      aria-label="Session Services"
      className="absolute inset-y-3 right-3 z-20 flex w-[390px] flex-col overflow-hidden rounded-2xl bg-panel shadow-overlay ring-1 ring-[var(--sw-soft-rule)]"
    >
      {logsFor === null ? null : (
        <ReadOnlyLogs processId={logsFor} onClose={() => setLogsFor(null)} />
      )}
      <header className="flex h-12 shrink-0 items-center border-b border-rule px-4">
        <div>
          <p className="font-sans text-[13px] font-medium text-foreground">Services</p>
          <p className="font-mono text-[10.5px] text-faint">{session.label ?? session.branch}</p>
        </div>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="font-sans text-xs text-label hover:text-foreground"
        >
          Close
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        {facts.length === 0 ? (
          <p className="px-4 py-5 font-mono text-[11px] text-faint">
            No Services recorded in this session.
          </p>
        ) : (
          facts.map((item) => (
            <ServiceRow
              key={item.view.service.id}
              facts={item}
              now={now}
              eventState={eventState}
              pending={pending}
              act={act}
            />
          ))
        )}
        <section className="border-t border-rule px-4 py-4">
          <p className="font-sans text-xs font-medium text-label">Recipes</p>
          <div className="mt-2 space-y-2">
            {(recipes.data ?? []).map((recipe) => (
              <div key={`${recipe.source}:${recipe.name}`} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-sans text-[12px] text-foreground">{recipe.name}</p>
                  <p className="truncate font-mono text-[10px] text-faint">
                    {recipe.command ?? "adopt"} · :{recipe.port}
                    {recipe.shadowedBy === null ? "" : ` · overridden by ${recipe.shadowedBy}`}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={pending !== null || recipe.shadowedBy !== null}
                  onClick={() =>
                    performAction(
                      `recipe:${recipe.name}`,
                      runServiceRecipe(session.id, recipe.name),
                    )
                  }
                  className="font-sans text-[11.5px] text-info disabled:text-faint"
                >
                  {pending === `recipe:${recipe.name}` ? "Starting…" : "Run"}
                </button>
              </div>
            ))}
          </div>
        </section>
        <form
          className="border-t border-rule px-4 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit(event.currentTarget);
          }}
        >
          <p className="font-sans text-xs font-medium text-label">One-off Service</p>
          <input
            name="command"
            placeholder="command (empty = adopt port)"
            className="mt-2 w-full rounded-lg border border-input bg-background px-2.5 py-1.5 font-mono text-[11px]"
          />
          <div className="mt-2 flex gap-2">
            <input
              required
              name="port"
              inputMode="numeric"
              placeholder="port"
              className="w-20 rounded-lg border border-input bg-background px-2 py-1.5 font-mono text-[11px]"
            />
            <input
              name="name"
              placeholder="name"
              className="min-w-0 flex-1 rounded-lg border border-input bg-background px-2 py-1.5 font-mono text-[11px]"
            />
            <select
              name="scheme"
              className="rounded-lg border border-input bg-background px-2 font-mono text-[10px]"
            >
              <option value="">raw</option>
              <option value="http">http</option>
              <option value="https">https</option>
            </select>
            <label className="flex items-center gap-1 font-mono text-[10px] text-label">
              <input type="checkbox" name="udp" />
              udp
            </label>
          </div>
          <button
            type="submit"
            disabled={pending !== null}
            className="mt-3 font-sans text-[11.5px] font-medium text-info disabled:opacity-40"
          >
            {pending === "run:form" ? "Starting…" : "Run or adopt"}
          </button>
        </form>
      </div>
      {error === null ? null : (
        <p className="shrink-0 border-t border-rule px-4 py-2 font-sans text-[11px] text-danger">
          {error}
        </p>
      )}
    </aside>
  );
}
