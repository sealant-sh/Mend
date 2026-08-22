// The installer is served from this site, so `public/install.sh` must be the repo's `install.sh`
// and nothing else. It is copied here at build time and asserted identical by install-script.test.ts
// — two files kept equal by a step, never by hand.

import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const SOURCE = join(here, "..", "..", "..", "install.sh");
export const TARGET = join(here, "..", "public", "install.sh");

mkdirSync(dirname(TARGET), { recursive: true });
copyFileSync(SOURCE, TARGET);
