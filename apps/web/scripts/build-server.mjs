// Bundle the web FRONT (the /api relay + nitro supervisor) into the nitro
// output directory, so the production image ships `.output/` alone:
// front.mjs beside server/index.mjs, assets in public/.
import { build } from "esbuild";

await build({
  entryPoints: ["src/entry/main.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: ".output/front.mjs",
  logLevel: "warning",
});
