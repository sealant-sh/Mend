import type { CheckpointDto } from "#/lib/api";

/**
 * A settled session is not a dead tile (Figma 82:558): the record replays
 * like video, and the checkpoints are the ticks on the bar. Each tick is a
 * seek — the terminal reattaches with `?from=<seq>` and the server replays
 * the byte-exact record from that checkpoint on. The label says exactly
 * that, nothing more.
 */
export function ReplayScrubber({
  checkpoints,
  from,
  onSeek,
}: {
  readonly checkpoints: ReadonlyArray<CheckpointDto>;
  readonly from: string;
  readonly onSeek: (seq: string) => void;
}) {
  const seqs = checkpoints.map((c) => Number(c.seq)).filter((n) => Number.isFinite(n));
  const max = Math.max(1, ...seqs);
  const current = Number(from);
  const position = Number.isFinite(current) ? Math.min(1, Math.max(0, current / max)) : 0;
  const index = checkpoints.findIndex((c) => c.seq === from);
  const label =
    checkpoints.length === 0
      ? "▶ replay · from seq 0 · no checkpoints"
      : index === -1
        ? `▶ replay · from seq ${from} · ${checkpoints.length} checkpoint${
            checkpoints.length === 1 ? "" : "s"
          }`
        : `▶ replay · from seq ${from} · checkpoint ${index} of ${checkpoints.length - 1}`;

  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-t border-term-rule bg-term px-3 pt-2 pb-2.5">
      <div className="relative h-3.5 w-full" role="group" aria-label="Replay checkpoints">
        <div className="absolute top-1.5 right-0 left-0 h-0.5 bg-term-rule" />
        {checkpoints.map((checkpoint, i) => {
          const seq = Number(checkpoint.seq);
          const left = Number.isFinite(seq) ? (seq / max) * 100 : 0;
          return (
            <button
              key={checkpoint.id}
              type="button"
              title={`checkpoint ${i} · ${checkpoint.trigger} · seq ${checkpoint.seq}`}
              aria-label={`Replay from checkpoint ${i}, seq ${checkpoint.seq}`}
              onClick={() => onSeek(checkpoint.seq)}
              className="absolute top-0 h-3.5 w-3 -translate-x-1/2 cursor-pointer"
              style={{ left: `${left}%` }}
            >
              <span className="absolute top-[3px] left-1/2 h-2 w-0.5 -translate-x-1/2 bg-term-dim" />
            </button>
          );
        })}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-0.5 size-2.5 -translate-x-1/2 rounded-full bg-term-accent"
          style={{ left: `${position * 100}%` }}
        />
      </div>
      <p className="font-mono text-[11.5px] text-term-dim">{label}</p>
    </div>
  );
}
