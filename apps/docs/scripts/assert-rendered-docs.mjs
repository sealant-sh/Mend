import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const installPage = await readFile(
  new URL("../dist/getting-started/install/index.html", import.meta.url),
  "utf8",
);

const networkBoundary = installPage.indexOf('id="network-boundary"');
const createAccount = installPage.indexOf('id="create-your-mend-account"');

assert.notEqual(networkBoundary, -1, "Install page must explain its network boundary");
assert.notEqual(createAccount, -1, "Install page must explain account creation");
assert.ok(networkBoundary < createAccount, "Install page must state network risk before sign-up");

const homePage = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
for (const section of [
  "introduction",
  "what-mend-puts-in-one-place",
  "quick-look",
  "workspaces-that-match-the-project",
  "get-started",
  "learn-the-system",
]) {
  assert.ok(homePage.includes(`id="${section}"`), `Home page must render its ${section} section`);
}
assert.ok(
  (homePage.match(/class="mermaid"/g) ?? []).length >= 2,
  "Home page must render its deployment and session diagrams",
);
assert.ok(
  !homePage.includes('class="landing-hero'),
  "Home page must use the documentation layout rather than a custom marketing hero",
);
assert.ok(!homePage.includes(" :::"), "Rendered pages must not expose directive markers");

process.stdout.write("Rendered docs structure is valid\n");
