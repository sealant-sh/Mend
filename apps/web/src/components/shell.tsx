import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { MendMark } from "#/components/logo";
import { authClient } from "#/lib/auth-client";

export function AppShell({ children }: { readonly children: ReactNode }) {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-[color-mix(in_oklab,var(--sw-canvas)_82%,transparent)] backdrop-blur-md">
        <div className="mx-auto flex min-h-14 max-w-[1400px] items-center justify-between gap-3 px-6">
          <div className="flex items-center gap-8">
            <Link
              to="/"
              className="inline-flex items-baseline gap-2 font-display text-lg font-semibold tracking-[-0.01em] text-foreground no-underline"
              aria-label="Mend — the queue"
            >
              <MendMark className="size-6 self-center" aria-hidden="true" />
              Mend
            </Link>
            <nav className="flex items-center gap-6" aria-label="Primary">
              <NavItem to="/">Queue</NavItem>
              <NavItem to="/settings">Settings</NavItem>
            </nav>
          </div>
          <button
            type="button"
            className="font-sans text-sm font-medium text-muted-foreground transition-colors duration-200 hover:text-foreground"
            onClick={() => {
              void authClient.signOut().then(() => navigate({ to: "/login" }));
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-6 py-10">{children}</main>
    </div>
  );
}

function NavItem({ to, children }: { readonly to: string; readonly children: ReactNode }) {
  return (
    <Link
      to={to}
      className="font-sans text-sm font-medium text-muted-foreground no-underline transition-colors duration-200 hover:text-foreground"
      activeProps={{ className: "text-foreground" }}
      activeOptions={{ exact: to === "/" }}
    >
      {children}
    </Link>
  );
}
