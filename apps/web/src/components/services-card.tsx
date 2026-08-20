import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { StatusDot } from "#/components/status";
import {
  addService,
  restartService,
  runService,
  serviceEndpoint,
  serviceUrl,
  stopService,
  type ServiceRecipeDto,
  type ServiceViewDto,
  type SessionProcessDto,
} from "#/lib/api";
import { queryClient, sessionRecipesQuery, sessionServicesQuery } from "#/lib/queries";

/**
 * The session's Services (docs/SESSION-SERVICES.md §presentation): what runs
 * and where it is reachable, plus the declared recipes as one-tap launchers.
 * Status words are observations — reachable means the forwarded port accepted
 * a connection, never a judgment about the application.
 */

const currentAttempt = (view: ServiceViewDto): SessionProcessDto | null =>
  view.service.currentAttemptId === null
    ? null
    : (view.attempts.find((attempt) => attempt.id === view.service.currentAttemptId) ?? null);

const currentObservation = (view: ServiceViewDto) =>
  view.currentForward !== null && view.latestObservation?.forwardId === view.currentForward.id
    ? view.latestObservation
    : null;

const serviceIsLive = (view: ServiceViewDto): boolean => {
  const attempt = currentAttempt(view);
  return (
    (attempt !== null && attempt.exitedAt === null) ||
    view.currentForward?.state === "binding" ||
    view.currentForward?.state === "bound"
  );
};

const serviceStatus = (view: ServiceViewDto): string =>
  currentObservation(view)?.state ??
  view.currentForward?.state ??
  currentAttempt(view)?.status ??
  "stopped";

function ServiceStatusDot({ status }: { readonly status: string }) {
  const tone =
    status === "reachable"
      ? ("green" as const)
      : status === "unreachable"
        ? ("amber" as const)
        : status === "starting" || status === "running"
          ? ("accent" as const)
          : ("hollow" as const);
  return <StatusDot tone={tone} word={status} pulse={status === "starting"} />;
}

type ServiceVerb = "restart" | "stop" | "rerun";

function ServiceRow({
  service,
  actionable,
  pending,
  onAction,
  first,
}: {
  readonly service: ServiceViewDto;
  readonly actionable: boolean;
  readonly pending: string | null;
  readonly onAction: (verb: ServiceVerb, service: ServiceViewDto) => void;
  readonly first: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const stable = service.service;
  const attempt = currentAttempt(service);
  const status = serviceStatus(service);
  const url = serviceUrl(service);
  const live = serviceIsLive(service);
  // What a client would connect to — the copyable fact. Dead forwards are
  // not offered: an ended Service has no host port worth pasting anywhere.
  const endpoint = live ? serviceEndpoint(service) : null;
  const meta = [
    `:${stable.workspacePort}${stable.transport === "udp" ? "/udp" : ""}`,
    endpoint === null ? null : `→ ${endpoint}`,
    !live && attempt?.exitCode !== null && attempt?.exitCode !== undefined
      ? `code ${attempt.exitCode}`
      : null,
  ]
    .filter((part) => part !== null)
    .join(" ");

  const copy = () => {
    if (endpoint === null) return;
    void navigator.clipboard.writeText(endpoint).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      return null;
    });
  };

  return (
    <div className={`group px-4 py-3 ${first ? "" : "border-t border-rule-faint"}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate font-sans text-[13px] font-medium text-ink">{stable.name}</p>
        <ServiceStatusDot status={status} />
      </div>
      <div className="mt-1 flex items-center justify-between gap-3">
        {endpoint === null ? (
          <p className="min-w-0 truncate font-mono text-[11px] text-faint">{meta}</p>
        ) : (
          <button
            type="button"
            onClick={copy}
            title={`Copy ${endpoint}`}
            className="min-w-0 cursor-pointer truncate text-left font-mono text-[11px] text-faint transition-colors hover:text-ink"
          >
            {meta}
          </button>
        )}
        <span className="flex shrink-0 items-center gap-2">
          {endpoint !== null && (
            <button
              type="button"
              onClick={copy}
              className={`font-sans text-xs transition-opacity ${
                copied
                  ? "text-success opacity-100"
                  : "text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-ink"
              }`}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          )}
          {live && url !== null && currentObservation(service)?.state === "reachable" && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="font-sans text-xs font-medium text-info hover:underline"
            >
              Open
            </a>
          )}
          {live && attempt !== null && attempt.argv.length > 0 && (
            <button
              type="button"
              onClick={() => onAction("restart", service)}
              disabled={pending !== null}
              className="font-sans text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink"
            >
              {pending === `restart:${stable.id}` ? "Restarting…" : "Restart"}
            </button>
          )}
          {live && (
            <button
              type="button"
              onClick={() => onAction("stop", service)}
              disabled={pending !== null}
              className="font-sans text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink"
            >
              {pending === `stop:${stable.id}` ? "Stopping…" : "Stop"}
            </button>
          )}
          {!live && actionable && attempt !== null && attempt.argv.length > 0 && (
            <button
              type="button"
              onClick={() => onAction("rerun", service)}
              disabled={pending !== null}
              className="font-sans text-xs font-medium text-info hover:underline disabled:opacity-50"
            >
              {pending === `rerun:${stable.id}` ? "Starting…" : "Run"}
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

export function ServicesCard({
  sessionId,
  sessionLive,
}: {
  readonly sessionId: string;
  readonly sessionLive: boolean;
}) {
  const serviceViews = useQuery(sessionServicesQuery(sessionId));
  const recipes = useQuery(sessionRecipesQuery(sessionId));
  const [pending, setPending] = useState<string | null>(null);

  const services = serviceViews.data ?? [];
  const liveServices = services.filter(serviceIsLive);
  const liveNames = new Set(liveServices.map((view) => view.service.name));
  const endedByName = new Map<string, ServiceViewDto>();
  for (const view of services.filter((item) => !serviceIsLive(item))) {
    if (liveNames.has(view.service.name)) continue;
    endedByName.set(view.service.name, view);
  }
  const endedServices = [...endedByName.values()].slice(-3);
  const shownNames = new Set([...liveServices, ...endedServices].map((view) => view.service.name));
  const startable = (recipes.data ?? []).filter((recipe) => !shownNames.has(recipe.name));

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["session", sessionId, "services"] });

  const act = (verb: ServiceVerb, view: ServiceViewDto) => {
    const stable = view.service;
    const attempt = currentAttempt(view);
    setPending(`${verb}:${stable.id}`);
    const action =
      verb === "restart"
        ? restartService(stable.id)
        : verb === "stop"
          ? stopService(stable.id)
          : attempt !== null && attempt.argv.length > 0
            ? runService(sessionId, {
                argv: attempt.argv,
                port: stable.workspacePort,
                name: stable.name,
                protocol: stable.transport,
              })
            : addService(sessionId, {
                port: stable.workspacePort,
                name: stable.name,
                protocol: stable.transport,
              });
    void action.then(invalidate).finally(() => setPending(null));
  };

  const start = (recipe: ServiceRecipeDto) => {
    setPending(`run:${recipe.name}`);
    const action =
      recipe.command === null
        ? addService(sessionId, { port: recipe.port, name: recipe.name, protocol: recipe.protocol })
        : runService(sessionId, {
            argv: ["sh", "-c", recipe.command],
            port: recipe.port,
            name: recipe.name,
            protocol: recipe.protocol,
          });
    void action.then(invalidate).finally(() => setPending(null));
  };

  const empty = services.length === 0 && startable.length === 0;

  return (
    <section className="mt-6">
      <p className="text-xs font-medium text-label">Services</p>
      <div className="mt-3 overflow-hidden rounded-2xl bg-card shadow-sm">
        {empty ? (
          <p className="p-4 font-mono text-xs text-faint">
            {recipes.isError
              ? "mend.toml did not parse — fix it in the worktree"
              : "none running · mend service run exposes one"}
          </p>
        ) : (
          <>
            {[...liveServices, ...endedServices].map((service, index) => (
              <ServiceRow
                key={service.service.id}
                service={service}
                actionable={sessionLive}
                pending={pending}
                onAction={act}
                first={index === 0}
              />
            ))}
            {sessionLive &&
              startable.map((recipe, index) => (
                <div
                  key={recipe.name}
                  className={`px-4 py-3 ${index === 0 && services.length === 0 ? "" : "border-t border-rule-faint"}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="min-w-0 truncate font-sans text-[13px] font-medium text-ink-2">
                      {recipe.name}
                    </p>
                    <button
                      type="button"
                      onClick={() => start(recipe)}
                      disabled={pending !== null}
                      className="shrink-0 font-sans text-xs font-medium text-info hover:underline"
                    >
                      {pending === `run:${recipe.name}` ? "Starting…" : "Run"}
                    </button>
                  </div>
                  <p className="mt-1 truncate font-mono text-[11px] text-faint">
                    {recipe.command ?? "adopt"} · :{recipe.port}
                    {recipe.protocol === "udp" ? "/udp" : ""} ·{" "}
                    {recipe.source === "file" ? "mend.toml" : "project"}
                  </p>
                </div>
              ))}
          </>
        )}
        {sessionLive && (
          <RunServiceForm
            sessionId={sessionId}
            pending={pending}
            setPending={setPending}
            onDone={invalidate}
          />
        )}
      </div>
    </section>
  );
}

/**
 * Declare and run a Service right here — one-off, session-scoped. Empty
 * command adopts an already-listening port; the project page holds the
 * declarations that persist across sessions.
 */
function RunServiceForm({
  sessionId,
  pending,
  setPending,
  onDone,
}: {
  readonly sessionId: string;
  readonly pending: string | null;
  readonly setPending: (value: string | null) => void;
  readonly onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (form: HTMLFormElement) => {
    const data = new FormData(form);
    const command = String(data.get("command") ?? "").trim();
    const name = String(data.get("name") ?? "").trim();
    const port = Number(String(data.get("port") ?? "").trim());
    const protocol = data.get("udp") === "on" ? ("udp" as const) : ("tcp" as const);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError("A port between 1 and 65535 is the one required field.");
      return;
    }
    setPending("run:form");
    setError(null);
    const label = name === "" ? null : name;
    const action =
      command === ""
        ? addService(sessionId, { port, name: label, protocol })
        : runService(sessionId, { argv: ["sh", "-c", command], port, name: label, protocol });
    void action
      .then(() => {
        onDone();
        form.reset();
        setOpen(false);
        return null;
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => setPending(null));
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full border-t border-rule-faint px-4 py-2.5 text-left font-sans text-xs text-muted-foreground transition-colors hover:text-ink"
      >
        + run service…
      </button>
    );
  }

  return (
    <form
      className="flex flex-col gap-2 border-t border-rule-faint px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit(event.currentTarget);
      }}
    >
      <input
        name="command"
        autoFocus
        placeholder="pnpm dev (empty = adopt a listening port)"
        className="w-full rounded-lg border border-input bg-background px-2.5 py-1.5 font-mono text-xs text-ink placeholder:text-faint"
      />
      <div className="flex items-center gap-2">
        <input
          name="port"
          inputMode="numeric"
          placeholder="port"
          className="w-20 rounded-lg border border-input bg-background px-2.5 py-1.5 font-mono text-xs text-ink placeholder:text-faint"
        />
        <input
          name="name"
          placeholder="name (optional)"
          className="min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 py-1.5 font-mono text-xs text-ink placeholder:text-faint"
        />
        <label className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
          <input type="checkbox" name="udp" className="size-3.5 accent-[var(--sw-accent)]" />
          udp
        </label>
      </div>
      <div className="flex items-center justify-end gap-2.5">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="font-sans text-xs text-muted-foreground hover:text-ink"
        >
          cancel
        </button>
        <button
          type="submit"
          disabled={pending !== null}
          className="font-sans text-xs font-medium text-info hover:underline disabled:opacity-50"
        >
          {pending === "run:form" ? "Starting…" : "Run"}
        </button>
      </div>
      {error === null ? null : (
        <p className="border-l-2 border-[var(--sw-red)] pl-2 font-sans text-xs text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
