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

assert(gateNames.has("test-lab"), "quality-gates.json must define the Test Lab configuration gate.");
const testInfrastructureRule = config.rules.find((rule) => rule.id === "test-infrastructure");
assert(testInfrastructureRule, "quality-gates.json must classify Test Lab infrastructure explicitly.");
assert(testInfrastructureRule.exact?.includes("test-lab.json"), "Test Lab infrastructure rule must cover test-lab.json.");
assert(testInfrastructureRule.exact?.includes("scripts/test-lab.mjs"), "Test Lab infrastructure rule must cover scripts/test-lab.mjs.");

const packageJson = JSON.parse(await read("package.json"));
assert.equal(packageJson.scripts?.["validate:engineering"], "node scripts/validate-engineering.mjs",
  "package.json must expose npm run validate:engineering.");
assert.equal(packageJson.scripts?.["classify:change"], "node scripts/classify-change.mjs",
  "package.json must expose npm run classify:change.");
assert.equal(packageJson.scripts?.testlab, "node scripts/test-lab.mjs",
  "package.json must expose npm run testlab.");
assert.equal(packageJson.scripts?.["testlab:validate"], "node scripts/test-lab.mjs validate",
  "package.json must expose npm run testlab:validate.");

const testLab = JSON.parse(await read("test-lab.json"));
assert.equal(testLab.schemaVersion, 1, "test-lab.json schemaVersion must be 1.");
for (const requiredScenario of ["source", "core", "launcher", "all-local", "authority-chaos", "unity", "release", "field"]) {
  assert(testLab.scenarios?.[requiredScenario], `test-lab.json must define scenario: ${requiredScenario}`);
}
for (const boundaryScenario of ["authority-chaos", "unity", "field"]) {
  const steps = testLab.scenarios[boundaryScenario].steps || [];
  assert(steps.some((step) => step.kind === "external" || step.kind === "manual"),
    `${boundaryScenario} must preserve its external/manual evidence boundary.`);
}

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

const scriptsReadme = await read("scripts/README.md");
for (const genericEntry of ["build-launcher.mjs", "verify-launcher.mjs", "stage-release.mjs"]) {
  assert(scriptsReadme.includes(genericEntry),
    `scripts/README.md must advertise the WP-neutral release entry point ${genericEntry}.`);
}
assert(scriptsReadme.includes("test-lab.mjs"), "scripts/README.md must advertise the Test Lab runner.");

console.log(`Engineering policy passed: ${config.rules.length} change-classification rule(s), ${gateNames.size} gate(s).`);
