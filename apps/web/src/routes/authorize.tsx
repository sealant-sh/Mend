import { Button } from "@mend/ui/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { TRPCClientError } from "@trpc/client";
import { useState } from "react";

import { MendMark } from "#/components/logo";
import { approveCliAuth, denyCliAuth } from "#/lib/api";
import { useTRPC } from "#/lib/trpc";

/**
 * The browser side of `mend login`: the CLI opened an authorize request and
 * pointed this browser here with the short code. A signed-in user compares
 * the code with the terminal's and decides; the CLI's next poll collects a
 * device token. A signed-out visitor walks through /login and returns —
 * the QueryCache's 401 walk carries this page (code included) as `next`.
 */
export const Route = createFileRoute("/authorize")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    code: typeof search["code"] === "string" ? search["code"] : "",
  }),
  component: AuthorizePage,
});

/** "ABCDEFGH" → "ABCD-EFGH", tolerant of already-grouped or typed-in forms. */
const groupCode = (code: string): string => {
  const bare = code.replace(/[^0-9a-z]/gi, "").toUpperCase();
  return bare.length <= 4 ? bare : `${bare.slice(0, 4)}-${bare.slice(4)}`;
};

const minutesLeft = (expiresAt: string): number =>
  Math.max(0, Math.round((Date.parse(expiresAt) - Date.now()) / 60_000));

// The lookup's two honest "no such request" answers: 404 (unknown code) and
// the 410 the tRPC bridge surfaces as BAD_REQUEST (spent code). Anything else
// — network, server down — is a lookup failure, not a verdict on the code.
const requestIsGone = (error: unknown): boolean =>
  error instanceof TRPCClientError &&
  (error.data?.code === "NOT_FOUND" || error.data?.code === "BAD_REQUEST");

function AuthorizePage() {
  const { code } = Route.useSearch();
  const trpc = useTRPC();
  const [decided, setDecided] = useState<"approved" | "denied" | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useQuery(
    trpc.devices.cliAuthRequest.queryOptions(
      { code },
      // A spent code stays spent — retrying only delays the honest answer.
      { enabled: code !== "" && decided === null, retry: false, staleTime: Infinity },
    ),
  );

  const decide = (decision: "approved" | "denied") => {
    setPending(true);
    setError(null);
    void (decision === "approved" ? approveCliAuth(code) : denyCliAuth(code))
      .then(() => setDecided(decision))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setPending(false));
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-baseline gap-2.5">
          <MendMark className="size-7 self-center" aria-hidden="true" />
          <span className="font-display text-xl font-semibold tracking-[-0.01em]">Mend</span>
          <span className="font-mono text-xs text-faint">by Sealant</span>
        </div>
        <div className="rounded-3xl bg-panel p-7 shadow-[var(--shadow-md)]">
          {decided !== null ? (
            <Decided decision={decided} />
          ) : code === "" || (request.isError && requestIsGone(request.error)) ? (
            <SpentOrMissing missing={code === ""} />
          ) : request.isError ? (
            <LookupFailed onRetry={() => void request.refetch()} />
          ) : request.data === undefined ? (
            <p className="font-mono text-[12.5px] text-label">looking up the request…</p>
          ) : (
            <>
              <h1 className="font-display text-lg font-semibold tracking-[-0.01em]">
                Authorize this terminal?
              </h1>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                <span className="font-mono text-[12.5px]">mend login</span> on{" "}
                <span className="font-medium text-foreground">{request.data.name}</span> asked for
                access as you. Approve only if this code matches the one in that terminal.
              </p>
              <p className="mt-6 text-center font-mono text-[28px] font-medium tracking-[0.08em] text-foreground">
                {groupCode(request.data.code)}
              </p>
              <p className="mt-2 text-center font-mono text-[12px] text-label">
                expires in {minutesLeft(request.data.expiresAt)} min · one terminal, once
              </p>
              {error === null ? null : (
                <p
                  className="mt-4 border-l-2 border-[var(--sw-red)] pl-3 text-[13px] leading-relaxed text-danger"
                  role="alert"
                >
                  {error}
                </p>
              )}
              <div className="mt-7 flex items-center justify-between gap-4">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => decide("denied")}
                >
                  Deny
                </Button>
                <Button
                  type="button"
                  size="lg"
                  disabled={pending}
                  onClick={() => decide("approved")}
                >
                  {pending ? "One moment…" : "Authorize"}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Decided({ decision }: { readonly decision: "approved" | "denied" }) {
  return (
    <>
      <h1 className="font-display text-lg font-semibold tracking-[-0.01em]">
        {decision === "approved" ? "Authorized" : "Denied"}
      </h1>
      <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
        {decision === "approved"
          ? "The terminal signs in on its next poll. Its token appears under Settings → Devices, where revoking it ends its access."
          : "The terminal is told no on its next poll. Nothing was granted."}
      </p>
    </>
  );
}

function LookupFailed({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <>
      <h1 className="font-display text-lg font-semibold tracking-[-0.01em]">
        Could not look up the request
      </h1>
      <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
        The server did not answer, so nothing was decided. The code may still be waiting.
      </p>
      <Button type="button" variant="ghost" size="sm" className="mt-5" onClick={onRetry}>
        Try again
      </Button>
    </>
  );
}

function SpentOrMissing({ missing }: { readonly missing: boolean }) {
  return (
    <>
      <h1 className="font-display text-lg font-semibold tracking-[-0.01em]">
        {missing ? "No code to authorize" : "This code is not waiting"}
      </h1>
      <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
        {missing
          ? "This page authorizes a terminal's sign-in and needs the code from one. Run "
          : "It may have expired, or it was already decided. Run "}
        <span className="font-mono text-[12.5px]">mend login</span> in the terminal to open a fresh
        request.
      </p>
    </>
  );
}
