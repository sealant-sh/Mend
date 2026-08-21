import { Button } from "@mend/ui/components/ui/button";
import { Input } from "@mend/ui/components/ui/input";
import { Label } from "@mend/ui/components/ui/label";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

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

/* Sign-in scale: the ui Input at form height, on the panel ground. */
const field = "no-drag h-10 bg-panel text-[14px]";

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

          <div className="mt-5 grid gap-1.5">
            <Label htmlFor="connect-url">Server URL</Label>
            <Input
              id="connect-url"
              className={`${field} font-mono text-[13.5px]`}
              value={serverUrl}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="http://localhost:3105"
              spellCheck={false}
              autoCapitalize="off"
            />
          </div>

          {mode === "password" ? (
            <>
              <div className="mt-4 grid gap-1.5">
                <Label htmlFor="connect-email">Email</Label>
                <Input
                  id="connect-email"
                  className={field}
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="username"
                  autoFocus
                />
              </div>
              <div className="mt-4 grid gap-1.5">
                <Label htmlFor="connect-password">Password</Label>
                <Input
                  id="connect-password"
                  className={field}
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                />
              </div>
            </>
          ) : (
            <div className="mt-4 grid gap-1.5">
              <Label htmlFor="connect-token">Bearer token</Label>
              <Input
                id="connect-token"
                className={`${field} font-mono text-[13.5px]`}
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="the token mend login saved, or MEND_AUTH_STATIC_TOKEN in dev"
                spellCheck={false}
                autoCapitalize="off"
                autoFocus
              />
            </div>
          )}

          {error !== null && <p className="mt-3 font-sans text-[12.5px] text-danger">{error}</p>}

          <div className="mt-6 flex items-center gap-3">
            <Button type="submit" size="lg" disabled={pending || serverUrl === ""}>
              {pending ? "Signing in…" : mode === "password" ? "Sign in" : "Use this token"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setError(null);
                setMode(mode === "password" ? "token" : "password");
              }}
            >
              {mode === "password" ? "Paste a token instead" : "Sign in with a password"}
            </Button>
            <span className="flex-1" />
            {connection?.signedIn === true && (
              <Button type="button" variant="ghost" onClick={() => void finish()}>
                Back to the cockpit
              </Button>
            )}
          </div>

          <p className="mt-6 font-sans text-[12.5px] leading-relaxed text-label">
            {connection === null
              ? ""
              : `credential file · ${connection.configPath} — shared with the mend CLI; mend login and mend logout land here too.`}
          </p>
          {connection?.signedIn === true && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="mt-2"
              onClick={() => {
                void window.mend.connection.signOut().then(() => {
                  queryClient.clear();
                  return null;
                });
              }}
            >
              sign out · removes the token from that file
            </Button>
          )}
        </form>
      </main>
    </>
  );
}
