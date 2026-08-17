import { describe, expect, it } from "vitest";

import { formatLoadReport } from "./env.ts";

describe("formatLoadReport", () => {
  it("renders names, lanes, actions, and reasons — never values", () => {
    const lines = formatLoadReport(
      {
        loaded: [
          { name: "PORT", lane: "configuration", action: "created" },
          { name: "STRIPE_API_KEY", lane: "secret", action: "updated" },
        ],
        rejected: [{ name: "GITHUB_TOKEN", reason: "reserved: use a connected account" }],
        malformedLines: [],
        environmentRevision: 3,
        secretRevision: 5,
      },
      { dim: (s) => s, warn: (s) => s },
    );
    expect(lines).toEqual([
      "  PORT            configuration · created · plaintext",
      "  STRIPE_API_KEY  secret · updated",
      "  GITHUB_TOKEN    rejected · reserved: use a connected account",
    ]);
  });
});
