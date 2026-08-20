import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "#/components/button";
import { Titlebar } from "#/components/titlebar";
import { useConnection } from "#/lib/connection";
import { queryClient } from "#/lib/queries";

/**
 * Where the desktop points, and who it is. Sign in once here or with
 * `mend login` in a terminal — both write the same credential file, so the
 * CLI and the cockpit are signed in together. Nothing asks for a password
 * again until the token is rejected.
 */

interface ConnectSearch {
  readonly reason?: "signed-out" | "unauthorized";
}

export const Route = createFileRoute("/connect")({
  validateSearch: (search: Record<string, unknown>): ConnectSearch => {
    const reason = search["reason"];
    return reason === "signed-out" || reason === "unauthorized" ? { reason } : {};
  },
  component: Connect,
});

const field =
  "no-drag w-full rounded-xl border border-[var(--sw-rule)] bg-panel px-3 py-2 font-sans text-[14px] text-foreground outline-none placeholder:text-faint focus:border-[var(--sw-accent)]";

function Connect() {
  const { reason } = Route.useSearch();
  const navigate = useNavigate();
  const connection = useConnection();
  const [url, setUrl] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [mode, setMode] = useState<"password" | "token">("password");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const serverUrl = url ?? connection?.url ?? "";

  const finish = async () => {
    queryClient.clear();
    await navigate({ to: "/" });
  };

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      if (mode === "password") {
        const result = await window.mend.connection.signIn({ url: serverUrl, email, password });
        if (!result.ok) {
          setError(result.reason);
          return;
        }
      } else {
        if (token.trim() === "") {
          setError("paste the token first");
          return;
        }
        await window.mend.connection.setToken({ url: serverUrl, token });
      }
      await finish();
    } finally {
      setPending(false);
    }
  };

  const note =
    reason === "unauthorized"
      ? "The saved token was rejected — sign in again."
      : reason === "signed-out"
        ? "Not signed in to a Mend server yet."
        : null;

  return (
    <>
      <Titlebar liveCount={null} />
      <main className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto bg-canvas px-6 py-16">
        <form
          className="w-full max-w-[440px] rounded-2xl border border-rule bg-panel p-6 shadow-sm"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <p className="font-mono text-[11px] tracking-[0.57px] text-muted-foreground">
            MEND / CONNECT
          </p>
          <h1 className="mt-1.5 font-display text-[24px] leading-tight font-medium text-foreground">
            Connect to your Mend server
          </h1>
          {note !== null && <p className="mt-2 font-sans text-[13.5px] text-warning">{note}</p>}

          <label className="mt-5 block">
            <span className="font-sans text-[12.5px] font-medium text-muted-foreground">
              Server URL
            </span>
            <input
              className={`${field} mt-1.5 font-mono text-[13.5px]`}
              value={serverUrl}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="http://localhost:3105"
              spellCheck={false}
              autoCapitalize="off"
            />
          </label>

          {mode === "password" ? (
            <>
              <label className="mt-4 block">
                <span className="font-sans text-[12.5px] font-medium text-muted-foreground">
                  Email
                </span>
                <input
                  className={`${field} mt-1.5`}
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="username"
                  autoFocus
                />
              </label>
              <label className="mt-4 block">
                <span className="font-sans text-[12.5px] font-medium text-muted-foreground">
                  Password
                </span>
                <input
                  className={`${field} mt-1.5`}
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                />
              </label>
            </>
          ) : (
            <label className="mt-4 block">
              <span className="font-sans text-[12.5px] font-medium text-muted-foreground">
                Bearer token
              </span>
              <input
                className={`${field} mt-1.5 font-mono text-[13.5px]`}
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="the token mend login saved, or MEND_AUTH_STATIC_TOKEN in dev"
                spellCheck={false}
                autoCapitalize="off"
                autoFocus
              />
            </label>
          )}

          {error !== null && <p className="mt-3 font-sans text-[12.5px] text-danger">{error}</p>}

          <div className="mt-6 flex items-center gap-3">
            <Button variant="primary" type="submit" disabled={pending || serverUrl === ""}>
              {pending ? "Signing in…" : mode === "password" ? "Sign in" : "Use this token"}
            </Button>
            <button
              type="button"
              className="font-sans text-[13px] text-muted-foreground hover:text-foreground"
              onClick={() => {
                setError(null);
                setMode(mode === "password" ? "token" : "password");
              }}
            >
              {mode === "password" ? "Paste a token instead" : "Sign in with a password"}
            </button>
            <span className="flex-1" />
            {connection?.signedIn === true && (
              <button
                type="button"
                className="font-sans text-[13px] text-muted-foreground hover:text-foreground"
                onClick={() => void finish()}
              >
                Back to the cockpit
              </button>
            )}
          </div>

          <p className="mt-6 font-sans text-[12.5px] leading-relaxed text-label">
            {connection === null
              ? ""
              : `credential file · ${connection.configPath} — shared with the mend CLI; mend login and mend logout land here too.`}
          </p>
          {connection?.signedIn === true && (
            <button
              type="button"
              className="mt-2 font-sans text-[12px] text-muted-foreground hover:text-danger"
              onClick={() => {
                void window.mend.connection.signOut().then(() => {
                  queryClient.clear();
                  return null;
                });
              }}
            >
              sign out · removes the token from that file
            </button>
          )}
        </form>
      </main>
    </>
  );
}
