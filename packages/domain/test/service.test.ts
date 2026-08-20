import { SealantWorkspaceId, ServiceForwardId, ServiceId, SessionId } from "@mend/domain";
import { Service, ServiceForward, resolveServiceEndpoints } from "@mend/domain/workbench";
import { describe, expect, it } from "vitest";

const now = new Date("2026-08-20T00:00:00.000Z");

const service = (browserScheme: "http" | "https" | null) =>
  new Service({
    id: ServiceId.make("service-1"),
    sessionId: SessionId.make("session-1"),
    name: "web",
    declarationSource: "explicit-run",
    workspacePort: 3000,
    transport: "tcp",
    browserScheme,
    bindAddresses: ["127.0.0.1", "192.168.1.4", "fe80::1%eth0"],
    preferredHostPort: null,
    currentAttemptId: null,
    currentForwardId: ServiceForwardId.make("forward-1"),
    attemptHistoryComplete: true,
    forwardHistoryComplete: true,
    observationHistoryComplete: true,
    createdAt: now,
    updatedAt: now,
  });

const forward = new ServiceForward({
  id: ServiceForwardId.make("forward-1"),
  serviceId: ServiceId.make("service-1"),
  sealantWorkspaceId: SealantWorkspaceId.make("workspace-1"),
  preferredHostPort: null,
  hostPort: 43127,
  boundAddresses: ["127.0.0.1", "192.168.1.4", "fe80::1%eth0"],
  state: "bound",
  error: null,
  supersedesForwardId: null,
  createdAt: now,
  boundAt: now,
  closedAt: null,
  updatedAt: now,
});

describe("resolveServiceEndpoints", () => {
  it("returns exact loopback, private, and scoped IPv6 endpoints from bound facts", () => {
    const endpoints = resolveServiceEndpoints(service("https"), forward);

    expect(endpoints.map((endpoint) => endpoint.authority)).toEqual([
      "127.0.0.1:43127",
      "192.168.1.4:43127",
      "[fe80::1%eth0]:43127",
    ]);
    expect(endpoints.map((endpoint) => endpoint.browserUrl)).toEqual([
      "https://127.0.0.1:43127/",
      "https://192.168.1.4:43127/",
      "https://[fe80::1%25eth0]:43127/",
    ]);
    expect(endpoints.map((endpoint) => endpoint.scope)).toEqual(["loopback", "private", "private"]);
    expect(endpoints.every((endpoint) => endpoint.mendAuthentication === "none")).toBe(true);
  });

  it("does not invent browser behavior for raw TCP", () => {
    expect(
      resolveServiceEndpoints(service(null), forward).map((endpoint) => endpoint.browserUrl),
    ).toEqual([null, null, null]);
  });

  it("returns no endpoint without a recorded bound address and port", () => {
    expect(resolveServiceEndpoints(service("http"), null)).toEqual([]);
  });
});
