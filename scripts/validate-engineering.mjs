import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = (path) => readFile(resolve(root, path), "utf8");

const config = JSON.parse(await read("quality-gates.json"));
assert.equal(config.schemaVersion, 1, "quality-gates.json schemaVersion must be 1.");
assert(Array.isArray(config.riskOrder) && config.riskOrder.join(",") === "low,medium,high",
  "quality-gates.json riskOrder must be low,medium,high.");

const gateNames = new Set(Object.keys(config.gates));
assert(gateNames.size > 0, "quality-gates.json must define at least one gate.");

const ruleIds = new Set();
for (const rule of config.rules) {
  assert(rule.id && !ruleIds.has(rule.id), `Duplicate or missing quality gate rule id: ${rule.id}`);
  ruleIds.add(rule.id);
  assert(config.riskOrder.includes(rule.risk), `Rule ${rule.id} has invalid risk ${rule.risk}.`);
  assert((rule.exact?.length || 0) + (rule.prefixes?.length || 0) > 0,
    `Rule ${rule.id} must match at least one exact path or prefix.`);
  for (const gate of rule.requires || []) {
    assert(gateNames.has(gate), `Rule ${rule.id} references unknown gate ${gate}.`);
  }
}
for (const gate of config.highRiskAdditionalGates || []) {
  assert(gateNames.has(gate), `highRiskAdditionalGates references unknown gate ${gate}.`);
}

const packageJson = JSON.parse(await read("package.json"));
assert.equal(packageJson.scripts?.["validate:engineering"], "node scripts/validate-engineering.mjs",
  "package.json must expose npm run validate:engineering.");
assert.equal(packageJson.scripts?.["classify:change"], "node scripts/classify-change.mjs",
  "package.json must expose npm run classify:change.");

const engineeringGuide = await read("docs/ENGINEERING_GUIDE.md");
for (const required of [
  "plan first, then implement",
  "Risk levels",
  "Core invariants",
  "Evidence classes are not interchangeable",
  "Quality-gate classification",
]) {
  assert(engineeringGuide.toLowerCase().includes(required.toLowerCase()),
    `docs/ENGINEERING_GUIDE.md must contain ${required}.`);
}

const changePlan = await read("docs/templates/CHANGE_PLAN.md");
for (const required of [
  "Risk classification",
  "Invariants that must remain true",
  "Failure modes considered",
  "Required evidence before merge",
  "Recovery / rollback",
  "Documentation plan",
  "Release impact",
]) {
  assert(changePlan.includes(required), `CHANGE_PLAN.md must contain section: ${required}`);
}

const agents = await read("AGENTS.md");
assert(agents.includes("docs/ENGINEERING_GUIDE.md"),
  "AGENTS.md must route substantial implementation changes through docs/ENGINEERING_GUIDE.md.");
assert(agents.includes("docs/templates/CHANGE_PLAN.md"),
  "AGENTS.md must reference the engineering change-plan template.");

const prTemplate = await read(".github/PULL_REQUEST_TEMPLATE.md");
for (const required of [
  "Risk classification",
  "Invariants / failure modes",
  "Evidence still missing",
  "Documentation impact",
  "Release / field-gate impact",
]) {
  assert(prTemplate.includes(required), `PR template must contain: ${required}`);
}

for (const genericEntry of [
  "scripts/build-launcher.mjs",
  "scripts/verify-launcher.mjs",
  "scripts/stage-release.mjs",
]) {
  const text = await read(genericEntry);
  assert(text.includes("WP-neutral release entry point"), `${genericEntry} must remain the WP-neutral entry point.`);
}

const publishWorkflow = await read(".github/workflows/publish-wp51-candidate.yml");
for (const genericEntry of ["scripts/build-launcher.mjs", "scripts/verify-launcher.mjs", "scripts/stage-release.mjs"]) {
  assert(publishWorkflow.includes(genericEntry),
    `Active publisher must call ${genericEntry} instead of adding new WP-specific entry points.`);
}

const releaseValidation = await read(".github/workflows/release-validation.yml");
assert(releaseValidation.includes("scripts/verify-launcher.mjs"),
  "Release validation must use the WP-neutral launcher verifier entry point.");

console.log(`Engineering policy passed: ${config.rules.length} change-classification rule(s), ${gateNames.size} gate(s).`);
