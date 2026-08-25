// Bundle the production web server (proxy + tRPC + SSR host) into one file:
// the runtime image ships dist/ alone — no source, no node_modules. The SSR
// bundle (dist/server/server.js) stays a separate artifact loaded at runtime.
import { build } from "esbuild";

await build({
  entryPoints: ["src/entry/main.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "dist/entry.mjs",
  // CJS deps in the graph use require() internally; give the ESM bundle one.
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
  logLevel: "warning",
});
