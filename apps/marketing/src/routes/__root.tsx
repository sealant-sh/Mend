import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { SunMoon } from "lucide-react";
import { type ReactNode } from "react";

import { GitHubLogo } from "#/components/github";
import { MendMark } from "#/components/logo";
import { PLATFORM_SITE_URL, PLATFORM_URL, REPO_URL } from "#/components/primitives";

import appCss from "../styles.css?url";

const TITLE = "Mend — code is now cheap, trust is not";
const DESCRIPTION =
  "Mend takes an issue from your tracker (GitHub, Linear, or Jira), has a coding agent fix it in a recorded sandbox, and reviews the change against that recording — everything else reads the diff and guesses. The PR arrives with the review done. Open source, self-hosted, built on Sealant.";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="marketing-body" id="top">
        <header className="sticky top-0 z-40 border-b border-border/60 bg-[color-mix(in_oklab,var(--sw-canvas)_82%,transparent)] backdrop-blur-md">
          <div className="mx-auto flex min-h-16 max-w-[1200px] items-center justify-between gap-3 px-6 sm:px-8">
            <div className="flex items-center gap-9">
              <Brand />
              <nav className="hidden items-center gap-7 lg:flex" aria-label="Primary">
                <TopLevelNavLink href="#why">Why</TopLevelNavLink>
                <TopLevelNavLink href="#review">The brief</TopLevelNavLink>
                <TopLevelNavLink href="#sources">Sources</TopLevelNavLink>
                <TopLevelNavLink href="#how">How it works</TopLevelNavLink>
                <TopLevelNavLink href={PLATFORM_SITE_URL}>Sealant</TopLevelNavLink>
              </nav>
            </div>
            <div className="flex items-center gap-2.5">
              <div className="hidden items-center gap-2.5 md:inline-flex">
                <ThemeSwitcher />
                <a
                  className="group inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 font-sans text-sm font-medium text-primary-foreground no-underline shadow-[var(--shadow-cobalt)] transition-[transform,background-color] duration-200 hover:-translate-y-0.5 hover:bg-[var(--primary-hover)]"
                  href={REPO_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  <GitHubLogo className="size-4" />
                  GitHub
                </a>
              </div>
              <div className="inline-flex items-center md:hidden">
                <ThemeSwitcher />
              </div>
            </div>
          </div>
        </header>
        <Outlet />
        <footer className="border-t border-border bg-[var(--sw-canvas)]">
          <div className="mx-auto max-w-[1200px] px-6 py-14 sm:px-8">
            <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr] lg:gap-8">
              <div className="min-w-0">
                <a
                  href="/"
                  className="inline-flex items-baseline gap-2.5 font-display text-lg font-semibold tracking-[-0.01em] text-foreground no-underline"
                >
                  <MendMark className="size-6 self-center" aria-hidden="true" />
                  Mend
                  <span className="font-mono text-xs font-normal text-faint">by Sealant</span>
                </a>
                <p className="mt-4 max-w-[34ch] text-sm leading-relaxed text-muted-foreground">
                  Reviews every agent change against a full recording of how it was made, and opens
                  pull requests with the review done. Open source and self-hosted.
                </p>
              </div>
              <FooterCol
                title="Product"
                links={[
                  ["Why", "#why"],
                  ["The brief", "#review"],
                  ["The source trail", "#sources"],
                  ["The mobile app", "#mobile"],
                  ["How it works", "#how"],
                  ["GitHub", REPO_URL],
                ]}
              />
              <FooterCol
                title="Platform"
                links={[
                  ["Sealant", PLATFORM_SITE_URL],
                  ["The Sealant repo", PLATFORM_URL],
                  ["@sealant/sdk on npm", "https://www.npmjs.com/package/@sealant/sdk"],
                ]}
              />
              <FooterCol
                title="Project"
                links={[
                  ["License", REPO_URL],
                  ["Roadmap", REPO_URL],
                  ["Discussions", REPO_URL],
                ]}
              />
            </div>
          </div>
        </footer>
        <Scripts />
      </body>
    </html>
  );
}

function Brand() {
  return (
    <a
      className="inline-flex items-baseline gap-2.5 font-display text-xl font-semibold tracking-[-0.01em] text-foreground no-underline"
      href="/"
      aria-label="Mend home"
    >
      <MendMark className="size-7 self-center" aria-hidden="true" />
      Mend
      <span className="hidden font-mono text-xs font-normal text-faint sm:inline">by Sealant</span>
    </a>
  );
}

function TopLevelNavLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}) {
  const external = href.startsWith("http");
  return (
    <a
      className="font-sans text-sm font-medium text-muted-foreground no-underline transition-colors duration-200 hover:text-foreground"
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
    >
      {children}
    </a>
  );
}

function FooterCol({
  title,
  links,
}: {
  readonly title: string;
  readonly links: ReadonlyArray<readonly [string, string]>;
}) {
  return (
    <div className="min-w-0">
      <p className="ev-eyebrow">{title}</p>
      <ul className="mt-4 space-y-2.5">
        {links.map(([label, href]) => {
          const external = href.startsWith("http");
          return (
            <li key={label}>
              <a
                href={href}
                {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
                className="text-sm text-muted-foreground no-underline transition-colors duration-200 hover:text-foreground"
              >
                {label}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ThemeSwitcher() {
  return (
    <button
      type="button"
      className="inline-flex size-9 items-center justify-center rounded-xl border border-border bg-panel text-muted-foreground shadow-[var(--shadow-xs)] transition-colors duration-200 hover:border-input hover:text-foreground"
      aria-label="Toggle color theme"
      title="Toggle theme"
      onClick={() => {
        document.documentElement.classList.toggle("dark");
      }}
    >
      <SunMoon className="size-4" aria-hidden="true" />
    </button>
  );
}
