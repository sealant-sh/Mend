import { describe, expect, it } from "vitest";

import { candidateBaseUrls, detectReachableAddresses, detectTailnetAddress } from "./machine.ts";

const iface = (address: string, internal = false) => [
  {
    address,
    netmask: "255.192.0.0",
    family: "IPv4" as const,
    mac: "00:00:00:00:00:00",
    internal,
    cidr: null,
  },
];

describe("detectTailnetAddress", () => {
  it("finds a CGNAT-range IPv4 address on any interface", () => {
    expect(
      detectTailnetAddress({ lo: iface("127.0.0.1", true), tailscale0: iface("100.101.1.5") }),
    ).toBe("100.101.1.5");
  });

  it("ignores addresses outside 100.64.0.0/10", () => {
    expect(
      detectTailnetAddress({ eth0: iface("100.20.0.1"), wlan0: iface("192.168.1.10") }),
    ).toBeNull();
  });

  it("treats the range edges as tailnet", () => {
    expect(detectTailnetAddress({ a: iface("100.64.0.1") })).toBe("100.64.0.1");
    expect(detectTailnetAddress({ b: iface("100.127.255.254") })).toBe("100.127.255.254");
    expect(detectTailnetAddress({ c: iface("100.128.0.1") })).toBeNull();
  });
});

describe("candidate base URLs", () => {
  it("lists the tailnet address first, then the LAN ones", () => {
    expect(
      detectReachableAddresses({
        lo: iface("127.0.0.1", true),
        wlan0: iface("192.168.1.245"),
        tailscale0: iface("100.126.133.49"),
      }),
    ).toEqual(["100.126.133.49", "192.168.1.245"]);
  });

  it("drops internal interfaces and repeats", () => {
    expect(
      detectReachableAddresses({
        lo: iface("127.0.0.1", true),
        docker0: iface("192.168.1.245"),
        wlan0: iface("192.168.1.245"),
      }),
    ).toEqual(["192.168.1.245"]);
  });

  it("puts the server's own port on every address", () => {
    expect(candidateBaseUrls(3105, { tailscale0: iface("100.126.133.49") })).toEqual([
      "http://100.126.133.49:3105",
    ]);
    expect(candidateBaseUrls(3105, { lo: iface("127.0.0.1", true) })).toEqual([]);
  });
});
