import { describe, expect, it } from "vitest";

import { forwardHeaders } from "./proxy-headers.ts";

describe("forwardHeaders", () => {
  it("preserves the configured same-origin Host but strips address inference headers", () => {
    expect(
      forwardHeaders({
        headers: {
          host: "mac-mini.local:3105",
          forwarded: "host=evil.invalid;proto=https",
          "x-forwarded-host": "evil.invalid",
          "x-forwarded-proto": "https",
        },
        remoteAddress: "192.168.1.20",
      }),
    ).toEqual({
      host: "mac-mini.local:3105",
      "x-forwarded-for": "192.168.1.20",
    });
  });

  it("appends its observed peer after the untrusted forwarded-for prefix", () => {
    expect(
      forwardHeaders({
        headers: { "x-forwarded-for": "203.0.113.9" },
        remoteAddress: "100.84.1.2",
      })["x-forwarded-for"],
    ).toBe("203.0.113.9, 100.84.1.2");
  });
});
