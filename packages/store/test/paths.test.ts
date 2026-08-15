import { describe, expect, it } from "vitest";

import { resolveMendHome } from "../src/paths.ts";

const existsAmong =
  (...present: ReadonlyArray<string>) =>
  (candidate: string) =>
    present.includes(candidate);

describe("resolveMendHome", () => {
  it("defaults a fresh machine to ~/.config/mend", () => {
    expect(
      resolveMendHome({ xdgConfigHome: undefined, homedir: "/home/u", exists: () => false }),
    ).toBe("/home/u/.config/mend");
  });

  it("honors XDG_CONFIG_HOME", () => {
    expect(
      resolveMendHome({ xdgConfigHome: "/xdg", homedir: "/home/u", exists: () => false }),
    ).toBe("/xdg/mend");
  });

  it("keeps a pre-XDG install on ~/.mend when it is the only one present", () => {
    expect(
      resolveMendHome({
        xdgConfigHome: undefined,
        homedir: "/home/u",
        exists: existsAmong("/home/u/.mend"),
      }),
    ).toBe("/home/u/.mend");
  });

  it("prefers the XDG directory once it exists, even beside a legacy one", () => {
    expect(
      resolveMendHome({
        xdgConfigHome: undefined,
        homedir: "/home/u",
        exists: existsAmong("/home/u/.mend", "/home/u/.config/mend"),
      }),
    ).toBe("/home/u/.config/mend");
  });

  it("treats an empty XDG_CONFIG_HOME as unset, per the spec", () => {
    expect(resolveMendHome({ xdgConfigHome: "", homedir: "/home/u", exists: () => false })).toBe(
      "/home/u/.config/mend",
    );
  });
});
