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
 * and where it is reachable, plus the worktree's declared recipes as one-tap
 * launchers. Status words are observations — reachable means the forwarded
 * port accepted a connection, never a judgment about the application.
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
  readonly onAction: (verb: "restart" | "stop", service: SessionProcessDto) => void;
  readonly first: boolean;
}) {
  const url = serviceUrl(service);
  const live = LIVE.has(service.status);
  const meta = [
    service.workspacePort === null ? null : `:${service.workspacePort}`,
    url === null ? null : url.replace(/^http:\/\//, "→ "),
    service.exitCode === null ? null : `code ${service.exitCode}`,
  ]
    .filter((part) => part !== null)
    .join(" ");
  return (
    <div className={`px-4 py-3 ${first ? "" : "border-t border-rule-faint"}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate font-sans text-[13px] font-medium text-ink">
          {service.label ?? service.id.slice(0, 8)}
        </p>
        <ServiceStatusDot status={service.status} />
      </div>
      <div className="mt-1 flex items-center justify-between gap-3">
        <p className="min-w-0 truncate font-mono text-[11px] text-faint">{meta}</p>
        {live && (
          <span className="flex shrink-0 items-center gap-2">
            {url !== null && service.status === "reachable" && (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="font-sans text-xs font-medium text-info hover:underline"
              >
                Open
              </a>
            )}
            {actionable && service.argv.length > 0 && (
              <button
                type="button"
                onClick={() => onAction("restart", service)}
                disabled={pending !== null}
                className="font-sans text-xs text-muted-foreground hover:text-ink"
              >
                {pending === `restart:${service.id}` ? "Restarting…" : "Restart"}
              </button>
            )}
            {actionable && (
              <button
                type="button"
                onClick={() => onAction("stop", service)}
                disabled={pending !== null}
                className="font-sans text-xs text-muted-foreground hover:text-ink"
              >
                {pending === `stop:${service.id}` ? "Stopping…" : "Stop"}
              </button>
            )}
          </span>
        )}
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
  const endedServices = services.filter((service) => !LIVE.has(service.status)).slice(-3);
  const liveNames = new Set(liveServices.map((service) => service.label));
  const startable = (recipes.data ?? []).filter((recipe) => !liveNames.has(recipe.name));

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["session", sessionId, "processes"] });

  const act = (verb: "restart" | "stop", service: SessionProcessDto) => {
    setPending(`${verb}:${service.id}`);
    const action = verb === "restart" ? restartService(service.id) : stopService(service.id);
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
                    {recipe.command ?? "adopt"} · :{recipe.port}
                  </p>
                </div>
              ))}
          </>
        )}
      </div>
    </section>
  );
}
