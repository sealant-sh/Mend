// BUILT ON THE SDK — Mend exists to prove the Sealant platform by consuming
// the public SDK from the outside. The code shown is the loop Mend actually
// runs, in a light mono panel (never a dark terminal hero).

import { Display, Eyebrow, PLATFORM_URL, Reveal } from "#/components/primitives";

// A line is a list of [text, tone] spans. Tones map to the token vocabulary.
type Tone = "kw" | "str" | "fn" | "comment" | "plain";

const CODE: ReadonlyArray<ReadonlyArray<readonly [string, Tone]>> = [
  [
    ["const", "kw"],
    [" sandbox = ", "plain"],
    ["await", "kw"],
    [" sealant.sandboxes.", "plain"],
    ["create", "fn"],
    ["({", "plain"],
  ],
  [
    ["  repository: ", "plain"],
    ["issue.repository", "plain"],
    [",", "plain"],
  ],
  [
    ["  harness: ", "plain"],
    ["opencode", "fn"],
    ["(),", "plain"],
  ],
  [["})", "plain"]],
  [["", "plain"]],
  [
    ["const", "kw"],
    [" run = ", "plain"],
    ["await", "kw"],
    [" sandbox.harness.", "plain"],
    ["start", "fn"],
    ["(", "plain"],
    ["promptFor", "fn"],
    ["(issue))", "plain"],
  ],
  [["", "plain"]],
  [
    ["for await", "kw"],
    [" (", "plain"],
    ["const", "kw"],
    [" event ", "plain"],
    ["of", "kw"],
    [" run.record.", "plain"],
    ["stream", "fn"],
    ["()) {", "plain"],
  ],
  [
    ["  board.", "plain"],
    ["update", "fn"],
    ["(issue, event) ", "plain"],
    ["// the live mending card", "comment"],
  ],
  [["}", "plain"]],
  [["", "plain"]],
  [
    ["await", "kw"],
    [" run.", "plain"],
    ["wait", "fn"],
    ["()", "plain"],
  ],
  [
    ["const", "kw"],
    [" pr = ", "plain"],
    ["await", "kw"],
    [" github.", "plain"],
    ["openPullRequest", "fn"],
    ["(run.changes, run.record)", "plain"],
  ],
];

const TONE_CLASS: Record<Tone, string> = {
  kw: "text-primary",
  str: "text-success",
  fn: "text-primary",
  comment: "text-faint",
  plain: "text-ink-2",
};

function LightCode() {
  return (
    <div className="overflow-x-auto rounded-2xl border border-rule bg-[var(--sw-sunken)] px-5 py-5 font-mono text-[0.78rem] leading-[1.85] shadow-[var(--shadow-sm)]">
      <pre>
        <code>
          {CODE.map((line, i) => (
            <span key={i} className="block">
              {line.length === 1 && line[0]![0] === "" ? (
                <span> </span>
              ) : (
                line.map((part, j) => (
                  <span key={j} className={TONE_CLASS[part[1]]}>
                    {part[0]}
                  </span>
                ))
              )}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

export function BuiltOnSdk() {
  return (
    <section id="sdk" className="bg-panel py-24 lg:py-32">
      <div className="mx-auto w-full max-w-[1200px] px-6 sm:px-8">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <Reveal className="min-w-0">
            <Eyebrow>Built on the public SDK</Eyebrow>
            <Display className="mt-5 text-[2rem] leading-[1.08] sm:text-4xl lg:text-[2.85rem]">
              Proof the platform is real — from the outside.
            </Display>
            <p className="mt-5 max-w-[52ch] text-lg leading-relaxed text-muted-foreground">
              Mend is built on{" "}
              <span className="text-foreground">the same @sealant/sdk you can npm-install</span> —
              no internal imports, no private APIs. The loop on the right is the loop Mend runs:
              create a sandbox around the issue's repository, start the harness, stream the record
              onto the board, and open the PR from the settled changes.
            </p>
            <p className="mt-6 max-w-[52ch] text-sm leading-relaxed text-muted-foreground">
              When the SDK can't express something Mend needs, that's recorded as platform feedback
              — never worked around. If Mend works, the platform is real.
            </p>
            <a
              href={PLATFORM_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-6 inline-flex items-center gap-1 font-sans text-sm font-medium text-primary no-underline transition-colors hover:text-[var(--primary-hover)]"
            >
              Build your own on the Sealant SDK →
            </a>
          </Reveal>

          <Reveal className="min-w-0">
            <LightCode />
            <p className="mt-3 text-center font-mono text-xs text-faint">
              npm i @sealant/sdk · the products are the proof, the platform is the point
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
