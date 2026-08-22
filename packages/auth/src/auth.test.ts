import { describe, expect, it } from "vitest";

import { trustedOrigins } from "./auth.ts";

const iface = (address: string, internal = false) => [
  {
    address,
    netmask: "255.255.255.0",
    family: "IPv4" as const,
    mac: "00:00:00:00:00:00",
    internal,
    cidr: null,
  },
];

describe("trustedOrigins", () => {
  it("trusts every address this machine answers on, on both ports", () => {
    const origins = trustedOrigins("http://localhost:3105", 3105, {
      lo: iface("127.0.0.1", true),
      tailscale0: iface("100.126.133.49"),
      wlan0: iface("192.168.1.245"),
    });
    expect(origins).toContain("http://100.126.133.49:3105");
    expect(origins).toContain("http://100.126.133.49:3101");
    expect(origins).toContain("http://192.168.1.245:3105");
    expect(origins).toContain("http://192.168.1.245:3101");
  });

  it("keeps APP_URL and localhost, and skips internal interfaces", () => {
    const origins = trustedOrigins("https://mend.example.com", 3105, {
      lo: iface("127.0.0.1", true),
    });
    expect(origins).toContain("https://mend.example.com");
    expect(origins).toContain("http://localhost:3105");
    expect(origins).toContain("http://localhost:3101");
    expect(origins.some((origin) => origin.includes("127.0.0.1"))).toBe(false);
  });

  it("carries a non-default PORT and repeats nothing", () => {
    const origins = trustedOrigins("http://localhost:8080", 8080, { wlan0: iface("10.0.0.4") });
    expect(origins).toContain("http://10.0.0.4:8080");
    expect(origins).toContain("http://10.0.0.4:3101");
    expect(new Set(origins).size).toBe(origins.length);
  });
});
