import { describe, expect, it } from "vitest";

import { bridgeUrlOf, retryDelayMs } from "./agent-share.ts";

describe("bridgeUrlOf", () => {
  it("turns the server url into the bridge websocket with host and token", () => {
    const url = bridgeUrlOf("https://mend.example", "tok", "laptop");
    expect(url.toString()).toBe("wss://mend.example/api/keys/bridge/ws?host=laptop&token=tok");
    expect(bridgeUrlOf("http://10.0.0.216:3105", null, "laptop").toString()).toBe(
      "ws://10.0.0.216:3105/api/keys/bridge/ws?host=laptop",
    );
  });
});

describe("retryDelayMs", () => {
  it("doubles from a second and caps at thirty", () => {
    expect([1, 2, 3, 6, 7, 20].map(retryDelayMs)).toEqual(
      [1000, 2000, 4000, 32_000, 32_000, 32_000].map((ms) => Math.min(ms, 30_000)),
    );
  });
});
