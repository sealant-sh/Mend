import { useState } from "react";

import { copyText } from "#/lib/workbench-menus";

/**
 * The machine's Mend deploy key — the public half with a copy affordance and
 * the one instruction that makes it useful. The private key never reaches the
 * browser; there is deliberately nothing else to show (docs/GIT-ACCESS.md).
 */
export function GitKeyCard({
  gitKey,
}: {
  readonly gitKey: { readonly publicKey: string | null; readonly fingerprint: string | null };
}) {
  const [copied, setCopied] = useState(false);

  if (gitKey.publicKey === null) return null;
  const publicKey = gitKey.publicKey;

  const copy = () => {
    copyText(publicKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="group">
      <button
        type="button"
        onClick={copy}
        title="Copy public key"
        className="w-full rounded-lg border border-rule bg-card p-2.5 text-left font-mono text-[11px] leading-relaxed break-all text-ink-2 transition-colors hover:border-[color-mix(in_oklab,var(--sw-accent)_45%,transparent)]"
      >
        {publicKey}
      </button>
      <div className="mt-1.5 flex items-baseline justify-between gap-2">
        {gitKey.fingerprint === null ? (
          <span />
        ) : (
          <p className="min-w-0 truncate font-mono text-[11px] text-faint">{gitKey.fingerprint}</p>
        )}
        <button
          type="button"
          onClick={copy}
          className={`shrink-0 font-sans text-xs transition-opacity ${
            copied
              ? "text-success opacity-100"
              : "text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-ink"
          }`}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        Add this as a deploy key on the git host (repository settings → deploy keys). Grant write
        access if this machine should push.
      </p>
    </div>
  );
}
