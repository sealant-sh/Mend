import { describe, expect, it } from "vitest";

import { clampSidebarWidth, initialSidebarWidth, sidebarMaxWidth } from "./sidebar-width.ts";

describe("sidebar width contract", () => {
  it("lets the rail grow until the main pane would drop under its floor", () => {
    expect(sidebarMaxWidth(1440)).toBe(800);
    expect(clampSidebarWidth(900, 1440)).toBe(800);
  });

  it("keeps the minimum when the whole layout is narrower than its minimums", () => {
    expect(sidebarMaxWidth(700)).toBe(208);
    expect(clampSidebarWidth(300, 700)).toBe(208);
  });

  it("falls back to the default for nothing stored or garbage, then clamps", () => {
    expect(initialSidebarWidth(null, 1440)).toBe(272);
    expect(initialSidebarWidth(Number.NaN, 1440)).toBe(272);
    expect(initialSidebarWidth(100, 1440)).toBe(208);
    expect(initialSidebarWidth(5000, 1440)).toBe(800);
  });
});
