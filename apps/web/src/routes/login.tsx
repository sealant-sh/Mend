import { Button } from "@mend/ui/components/ui/button";
import { Input } from "@mend/ui/components/ui/input";
import { Label } from "@mend/ui/components/ui/label";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { MendMark } from "#/components/logo";
import { authClient } from "#/lib/auth-client";

/**
 * Where to walk after signing in. Only a same-origin path is honoured —
 * anything else (a full URL, a protocol-relative `//host`) falls back to the
 * workbench, so a crafted login link cannot walk a user off this instance.
 */
export const safeNextPath = (value: unknown): string =>
  typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/";

export const Route = createFileRoute("/login")({
  ssr: false,
  // `next` stays optional so every existing `navigate({ to: "/login" })` keeps
  // compiling; absent means the workbench root.
  validateSearch: (search: Record<string, unknown>): { readonly next?: string } => {
    const next = safeNextPath(search["next"]);
    return next === "/" ? {} : { next };
  },
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const next = Route.useSearch().next ?? "/";
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setPending(true);
    setError(null);
    const result =
      mode === "sign-in"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ name: name === "" ? email : name, email, password });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "That did not work — check the details and try again.");
      return;
    }
    // A plain string path (validated same-origin above) — assign like the 401
    // walk does, so the freshly signed-in session re-runs whatever loads there.
    if (next === "/") void navigate({ to: "/" });
    else window.location.assign(next);
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
          <h1 className="font-display text-lg font-semibold tracking-[-0.01em]">
            {mode === "sign-in" ? "Sign in" : "Create your account"}
          </h1>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {mode === "sign-in"
              ? "Your Mend, on your machines."
              : "The first account on a fresh instance is yours to create."}
          </p>
          <form
            className="mt-6 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {mode === "sign-up" ? (
              <Field label="Name" type="text" value={name} onChange={setName} autoComplete="name" />
            ) : null}
            <Field
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              autoComplete="email"
              required
            />
            <Field
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
              required
            />
            {error === null ? null : (
              <p className="border-l-2 border-[var(--sw-red)] pl-3 text-[13px] leading-relaxed text-danger">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" disabled={pending} className="w-full">
              {pending ? "One moment…" : mode === "sign-in" ? "Sign in" : "Create account"}
            </Button>
          </form>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-5"
            onClick={() => {
              setMode(mode === "sign-in" ? "sign-up" : "sign-in");
              setError(null);
            }}
          >
            {mode === "sign-in" ? "New instance? Create an account" : "Have an account? Sign in"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  autoComplete,
  required,
}: {
  readonly label: string;
  readonly type: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly autoComplete: string;
  readonly required?: boolean;
}) {
  const id = `login-${label.toLowerCase()}`;
  return (
    <div>
      <Label htmlFor={id} className="mb-1.5 block">
        {label}
      </Label>
      <Input
        id={id}
        className="h-10 bg-background"
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        {...(required === true ? { required: true } : {})}
      />
    </div>
  );
}
