// `curl -fsSL https://mend.sealant.dev/install.sh` serves apps/marketing/public/install.sh. It is a
// copy of the repo's install.sh, refreshed by scripts/sync-install-script.mjs on every build; this
// test fails the moment the two drift, so a fix to one is never served as the other.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..", "..");

describe("the installer this site serves", () => {
  it("is byte-identical to the repo's install.sh", () => {
    const source = readFileSync(join(root, "install.sh"));
    const served = readFileSync(join(root, "apps", "marketing", "public", "install.sh"));
    expect(served.equals(source)).toBe(true);
  });
});
