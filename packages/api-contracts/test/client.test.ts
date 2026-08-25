import { describe, expect, it } from "vitest";

import { errorStatusByTag } from "../src/client.ts";

describe("errorStatusByTag", () => {
  it("derives every declared error's status from the contract itself", () => {
    // Spot-check the statuses transports depend on; the map is built by
    // walking MendApi, so a contract change moves these without code edits.
    expect(errorStatusByTag.get("Unauthorized")).toBe(401);
    expect(errorStatusByTag.get("NotFound")).toBe(404);
    expect(errorStatusByTag.get("EnvironmentRejected")).toBe(422);
    expect(errorStatusByTag.get("EnvironmentStaleWrite")).toBe(409);
    expect(errorStatusByTag.get("PairingRateLimited")).toBe(429);
    expect(errorStatusByTag.size).toBeGreaterThanOrEqual(10);
  });
});
