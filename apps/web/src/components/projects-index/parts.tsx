/**
 * How many sessions the machine reports live in a project, as dot + word
 * (DESIGN.md §4) — the same green-when-live dot the sidebar uses. Zero says so
 * plainly rather than inventing a project status; `quiet` drops that line
 * entirely where it would repeat down a column of otherwise idle rows.
 */
export function LiveMark({
  live,
  quiet = false,
}: {
  readonly live: number | null;
  readonly quiet?: boolean;
}) {
  if (live === null)
    return quiet ? null : (
      <span className="font-mono text-[11.5px] text-faint">Activity unavailable</span>
    );
  const alive = live > 0;
  if (!alive && quiet) return null;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap font-mono text-[11.5px] ${
        alive ? "text-success" : "text-faint"
      }`}
    >
      <span
        className={`size-[5px] shrink-0 rounded-full ${
          alive ? "bg-success-dot" : "border-[1.5px] border-faint bg-transparent"
        }`}
        aria-hidden="true"
      />
      {alive ? `${live} session${live === 1 ? "" : "s"} live` : "no live session"}
    </span>
  );
}
