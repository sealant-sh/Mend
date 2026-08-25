// Keep the Helm chart's appVersion equal to the released @sealant/mend
// version — it is the default image tag, so drift means charts pulling
// images that predate the code they deploy. Runs inside `version-packages`,
// so every changesets version PR carries the chart bump with it.
import { readFileSync, writeFileSync } from "node:fs";

const version = JSON.parse(readFileSync("apps/cli/package.json", "utf8")).version;
const chartPath = "deploy/helm/mend/Chart.yaml";
const chart = readFileSync(chartPath, "utf8");
const updated = chart.replace(/^appVersion: ".*"$/m, `appVersion: "${version}"`);
if (updated === chart && !chart.includes(`appVersion: "${version}"`)) {
  throw new Error("appVersion line not found in Chart.yaml");
}
writeFileSync(chartPath, updated);
console.log(`chart appVersion → ${version}`);
