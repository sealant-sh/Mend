import { Button } from "@mend/ui/components/ui/button";
import { Input } from "@mend/ui/components/ui/input";
import { Label } from "@mend/ui/components/ui/label";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { MendMark } from "#/components/logo";
import { authClient } from "#/lib/auth-client";

export const Route = createFileRoute("/login")({
  ssr: false,
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
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
    void navigate({ to: "/" });
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
