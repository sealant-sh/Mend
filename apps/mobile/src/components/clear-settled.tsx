// Sweep every settled session in one gesture — armed by a first tap, the
// second removes. No bulk endpoint exists; the mutation loops DELETE per
// session (same as web) and whatever refuses stays listed.

import { useState } from "react";

import { EvButton } from "@/components/button";

export function ClearSettledButton({
  sessionIds,
  pending,
  onClear,
}: {
  readonly sessionIds: ReadonlyArray<string>;
  readonly pending: boolean;
  readonly onClear: (sessionIds: ReadonlyArray<string>) => void;
}) {
  const [armed, setArmed] = useState(false);
  if (sessionIds.length === 0) return null;
  let label = armed ? `Remove ${sessionIds.length}?` : "Clear settled";
  if (pending) label = "Removing…";
  return (
    <EvButton
      size="sm"
      variant="ghost"
      label={label}
      disabled={pending}
      onPress={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        onClear(sessionIds);
      }}
    />
  );
}
