import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { StatusDot } from "#/components/status";
import {
  addService,
  restartService,
  runService,
  serviceUrl,
  stopService,
  type ServiceRecipeDto,
  type SessionProcessDto,
} from "#/lib/api";
import { queryClient, sessionProcessesQuery, sessionRecipesQuery } from "#/lib/queries";

/**
 * The session's Services (docs/SESSION-SERVICES.md §presentation): what runs
 * and where it is reachable, plus the declared recipes as one-tap launchers.
 * Status words are observations — reachable means the forwarded port accepted
 * a connection, never a judgment about the application.
 */

const LIVE = new Set(["starting", "running", "reachable", "unreachable"]);

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
  readonly service: SessionProcessDto;
  readonly actionable: boolean;
  readonly pending: string | null;
  readonly onAction: (verb: ServiceVerb, service: SessionProcessDto) => void;
  readonly first: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const url = serviceUrl(service);
  const live = LIVE.has(service.status);
  // What a client would connect to — the copyable fact. Dead forwards are
  // not offered: an ended Service has no host port worth pasting anywhere.
  const endpoint = live && url !== null ? url.replace(/^http:\/\//, "") : null;
  const meta = [
    service.workspacePort === null ? null : `:${service.workspacePort}`,
    endpoint === null ? null : `→ ${endpoint}`,
    !live && service.exitCode !== null ? `code ${service.exitCode}` : null,
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
        <p className="min-w-0 truncate font-sans text-[13px] font-medium text-ink">
          {service.label ?? service.id.slice(0, 8)}
        </p>
        <ServiceStatusDot status={service.status} />
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
          {live && url !== null && service.status === "reachable" && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="font-sans text-xs font-medium text-info hover:underline"
            >
              Open
            </a>
          )}
          {live && actionable && service.argv.length > 0 && (
            <button
              type="button"
              onClick={() => onAction("restart", service)}
              disabled={pending !== null}
              className="font-sans text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink"
            >
              {pending === `restart:${service.id}` ? "Restarting…" : "Restart"}
            </button>
          )}
          {live && actionable && (
            <button
              type="button"
              onClick={() => onAction("stop", service)}
              disabled={pending !== null}
              className="font-sans text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink"
            >
              {pending === `stop:${service.id}` ? "Stopping…" : "Stop"}
            </button>
          )}
          {!live && actionable && service.workspacePort !== null && (
            <button
              type="button"
              onClick={() => onAction("rerun", service)}
              disabled={pending !== null}
              className="font-sans text-xs font-medium text-info hover:underline disabled:opacity-50"
            >
              {pending === `rerun:${service.id}` ? "Starting…" : "Run"}
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
  const processes = useQuery(sessionProcessesQuery(sessionId));
  const recipes = useQuery(sessionRecipesQuery(sessionId));
  const [pending, setPending] = useState<string | null>(null);

  const services = (processes.data ?? []).filter((process) => process.kind === "service");
  const liveServices = services.filter((service) => LIVE.has(service.status));
  const liveLabels = new Set(liveServices.map((service) => service.label ?? service.id));
  const endedByName = new Map<string, SessionProcessDto>();
  for (const service of services.filter((item) => !LIVE.has(item.status))) {
    // Latest attempt per name (list is oldest-first), and a live successor
    // retires its history from the card — the record still holds it all.
    if (liveLabels.has(service.label ?? service.id)) continue;
    endedByName.set(service.label ?? service.id, service);
  }
  const endedServices = [...endedByName.values()].slice(-3);
  // One row per name: an ended Service already carries its command, so its
  // Run re-runs it — the same-named recipe would only echo the row.
  const shownNames = new Set(
    [...liveServices, ...endedServices].map((service) => service.label ?? ""),
  );
  const startable = (recipes.data ?? []).filter((recipe) => !shownNames.has(recipe.name));

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["session", sessionId, "processes"] });

  const act = (verb: ServiceVerb, service: SessionProcessDto) => {
    setPending(`${verb}:${service.id}`);
    const action =
      verb === "restart"
        ? restartService(service.id)
        : verb === "stop"
          ? stopService(service.id)
          : // rerun: an ended row keeps its command and port — start it fresh.
            service.argv.length > 0
            ? runService(sessionId, {
                argv: service.argv,
                port: service.workspacePort ?? 0,
                name: service.label,
              })
            : addService(sessionId, { port: service.workspacePort ?? 0, name: service.label });
    void action.then(invalidate).finally(() => setPending(null));
  };

  const start = (recipe: ServiceRecipeDto) => {
    setPending(`run:${recipe.name}`);
    const action =
      recipe.command === null
        ? addService(sessionId, { port: recipe.port, name: recipe.name })
        : runService(sessionId, {
            argv: ["sh", "-c", recipe.command],
            port: recipe.port,
            name: recipe.name,
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
                key={service.id}
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
                    {recipe.command ?? "adopt"} · :{recipe.port} ·{" "}
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
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError("A port between 1 and 65535 is the one required field.");
      return;
    }
    setPending("run:form");
    setError(null);
    const label = name === "" ? null : name;
    const action =
      command === ""
        ? addService(sessionId, { port, name: label })
        : runService(sessionId, { argv: ["sh", "-c", command], port, name: label });
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
