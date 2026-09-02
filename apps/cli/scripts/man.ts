// Write the man pages next to dist/: mend.1 and one mend-<command>.1 per page.
// Runs as part of `pnpm build`; npm installs `man/` through package.json's
// `directories.man`, so `man mend` works after a global install.
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { COMMANDS, manFileName, renderManIndex, renderManPage } from "../src/help.ts";
import { cliVersion } from "../src/version.ts";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "man");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const version = cliVersion();
fs.writeFileSync(path.join(out, manFileName(null)), renderManIndex(version));
for (const doc of COMMANDS) {
  if (doc.hidden) continue;
  fs.writeFileSync(path.join(out, manFileName(doc)), renderManPage(doc, version));
}
process.stdout.write(`${fs.readdirSync(out).length} man pages in ${out}\n`);
