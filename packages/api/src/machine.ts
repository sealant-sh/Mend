import { hostname, networkInterfaces, platform } from "node:os";

import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { MachineView, MendApi } from "./contract.ts";

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

/**
 * Every non-internal IPv4 bound to this machine, tailnet addresses first, then
 * the LAN ones. These are the addresses a phone could try; whether a packet
 * arrives is the phone's observation, not this machine's claim.
 */
export const detectReachableAddresses = (
  interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces(),
): ReadonlyArray<string> => {
  const tailnet: Array<string> = [];
  const lan: Array<string> = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      if (isTailnetAddress(entry.address)) tailnet.push(entry.address);
      else lan.push(entry.address);
    }
  }
  return [...new Set([...tailnet, ...lan])];
};

/** The reachable addresses as base URLs on the port this server answers on. */
export const candidateBaseUrls = (
  port: number,
  interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces(),
): ReadonlyArray<string> =>
  detectReachableAddresses(interfaces).map((address) => `http://${address}:${port}`);

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
