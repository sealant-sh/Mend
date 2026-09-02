import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { GitAccessPanel } from "#/components/git-access-panel";
import { StatusDot } from "#/components/status";
import { useTRPC } from "#/lib/trpc";

/**
 * The empty machine, as a checklist rather than a wizard: five steps, each
 * with what to type and what Mend can actually see about it. Two of the five
 * are observed (accounts, devices); the CLI sign-in happens on your machine
 * and the server never sees it, so that row says so instead of guessing.
 *
 * It is not a modal and it does not gate anything — it disappears the moment
 * a project exists.
 */

function Command({ children }: { readonly children: string }) {
  return (
    <code className="rounded-md bg-[var(--sw-sunken)] px-1.5 py-0.5 font-mono text-[12px] text-ink-2">
      {children}
    </code>
  );
}

function Step({
  index,
  title,
  status,
  children,
  action,
}: {
  readonly index: number;
  readonly title: string;
  readonly status: ReactNode;
  readonly children: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <div className={`px-5 py-4 ${index === 1 ? "" : "border-t border-rule-faint"}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="flex min-w-0 items-baseline gap-3">
          <span className="font-mono text-[11px] text-faint">0{index}</span>
          <span className="font-sans text-sm font-medium text-foreground">{title}</span>
        </p>
        {status}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 pl-[1.65rem]">
        <p className="min-w-0 text-[13px] leading-relaxed text-muted-foreground">{children}</p>
        {action}
      </div>
    </div>
  );
}

export function FirstRun() {
  const trpc = useTRPC();
  const accounts = useQuery(trpc.platform.sealantIdentity.queryOptions()).data?.accounts ?? [];
  const devices =
    useQuery(trpc.devices.list.queryOptions(undefined, { staleTime: 30_000 })).data ?? [];
  const connected = accounts.filter(({ status }) => status === "active");
  const gitAccess = useQuery(trpc.git.access.queryOptions()).data;

  return (
    <section className="mt-8">
      <div className="rounded-2xl bg-card shadow-sm">
        <div className="border-b border-rule-faint px-5 py-4">
          <p className="text-xs font-medium text-label">First run</p>
          <p className="mt-1.5 max-w-[62ch] text-sm leading-relaxed text-muted-foreground">
            Nothing is adopted yet. Six steps get an agent working in a recorded worktree on this
            machine; Mend marks the ones it can observe.
          </p>
        </div>

        <Step
          index={1}
          title="Sign the CLI in"
          status={<StatusDot tone="hollow" word="not observed here" />}
        >
          Run <Command>mend login</Command> on this machine and press Authorize in the browser page
          it opens. The token lands in{" "}
          <span className="font-mono text-[12px]">~/.config/mend/cli.json</span>; the server keeps
          only its hash.
        </Step>

        <Step
          index={2}
          title="Connect your accounts"
          status={
            connected.length === 0 ? (
              <StatusDot tone="hollow" word="none connected" />
            ) : (
              <StatusDot tone="green" word={`${connected.length} connected`} />
            )
          }
          action={
            <Link
              to="/settings"
              className="shrink-0 font-sans text-xs font-medium text-muted-foreground no-underline transition-colors hover:text-foreground"
            >
              Settings
            </Link>
          }
        >
          <Command>mend connect claude</Command> · <Command>mend connect codex</Command> ·{" "}
          <Command>mend connect github</Command>. Mend ships no keys — agents run on your own
          subscription.
        </Step>

        <Step
          index={3}
          title="Give Mend access to your repositories"
          status={
            gitAccess === undefined ? (
              <StatusDot tone="hollow" word="…" />
            ) : gitAccess.mode === "bridge" ? (
              <StatusDot
                tone={gitAccess.bridge.connected ? "green" : "hollow"}
                word={gitAccess.bridge.connected ? "signer connected" : "no signer yet"}
              />
            ) : gitAccess.key.exists ? (
              <StatusDot tone="green" word="key created" />
            ) : (
              <StatusDot tone="hollow" word="no key yet" />
            )
          }
        >
          A key of yours on the server, added to your git account, is the one that keeps working
          when you close the laptop.
        </Step>
        <div className="px-5 pb-4 pl-[2.9rem]">
          <GitAccessPanel compact />
        </div>

        <Step
          index={4}
          title="Adopt a repository"
          status={<StatusDot tone="hollow" word="none adopted" />}
          action={
            <Link
              to="/projects"
              className="shrink-0 rounded-xl bg-primary px-3.5 py-1.5 font-sans text-xs font-medium text-primary-foreground no-underline shadow-[var(--shadow-cobalt)] transition-transform hover:-translate-y-0.5"
            >
              Adopt a repository
            </Link>
          }
        >
          Or run <Command>mend adopt</Command> inside a checkout. Mend clones it into its own store;
          your checkout is never the execution target.
        </Step>

        <Step
          index={5}
          title="Start a session"
          status={<StatusDot tone="hollow" word="none yet" />}
        >
          <Command>mend claude &quot;fix the flaky upload test&quot;</Command> in an adopted
          repository. The session gets its own worktree, and its change is reviewable from the first
          edit.
        </Step>

        <Step
          index={6}
          title="Pair your phone"
          status={
            devices.length === 0 ? (
              <StatusDot tone="hollow" word="no device paired" />
            ) : (
              <StatusDot
                tone="green"
                word={`${devices.length} device${devices.length === 1 ? "" : "s"}`}
              />
            )
          }
          action={
            <a
              href="/settings#devices"
              className="shrink-0 font-sans text-xs font-medium text-muted-foreground no-underline transition-colors hover:text-foreground"
            >
              Settings → Devices
            </a>
          }
        >
          Scan the QR from Settings → Devices, or run <Command>mend pair</Command> for one in the
          terminal. The phone gets its own token; revoke it there any time.
        </Step>
      </div>
    </section>
  );
}

/**
 * The one line that outlives the checklist: once a project exists, the phone
 * is still unpaired until it is, and this is where you would notice.
 */
export function PairHint() {
  const trpc = useTRPC();
  const devices =
    useQuery(trpc.devices.list.queryOptions(undefined, { staleTime: 30_000 })).data ?? [];
  if (devices.length > 0) return null;
  return (
    <a
      href="/settings#devices"
      className="font-sans text-xs font-medium text-muted-foreground no-underline transition-colors hover:text-foreground"
    >
      Pair your phone · Settings → Devices
    </a>
  );
}
