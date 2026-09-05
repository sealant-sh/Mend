import { hostname, networkInterfaces, platform } from "node:os";

import { MachineView, MendApi } from "@mend/api-contracts";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

/**
 * Tailscale hands every node an IPv4 address in the CGNAT range 100.64.0.0/10.
 * An interface carrying one is the observation the shell reports as
 * "tailnet · reachable" (plan §7.5); nothing else is inferred from it.
 */
const isTailnetAddress = (address: string): boolean => {
  const parts = address.split(".").map(Number);
  const first = parts[0];
  const second = parts[1];
  if (parts.length !== 4 || first === undefined || second === undefined) return false;
  return first === 100 && second >= 64 && second <= 127;
};

/** The first tailnet-range IPv4 address bound to any interface, if one is up. */
export const detectTailnetAddress = (
  interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces(),
): string | null => {
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal && isTailnetAddress(entry.address)) {
        return entry.address;
      }
    }
  }
  return null;
};

export const readMachine = (): MachineView => {
  const address = detectTailnetAddress();
  return new MachineView({
    hostname: hostname(),
    platform: platform(),
    tailnet:
      address === null
        ? { status: "not-detected", address: null }
        : { status: "reachable", address },
  });
};

export const MachineGroupLive = HttpApiBuilder.group(MendApi, "machine", (handlers) =>
  handlers.handle("get", () => Effect.sync(readMachine)),
);
