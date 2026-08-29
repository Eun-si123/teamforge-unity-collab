import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const requiredFiles = [
  "docs/DOCUMENTATION_GUIDE.md",
  "docs/templates/DOCUMENTATION_PLAN.md",
  "docs/templates/ADR.md",
  "docs/templates/HOW_TO.md",
  "docs/templates/STATUS_CHANGE.md",
  "docs/README.md",
  "docs/HOW_IT_WORKS.md",
  "docs/HOW_IT_WORKS.ko.md",
  "docs/TEST_LAB.md",
  "docs/ENGINEERING_GUIDE.md",
  "docs/STATUS.md",
  "docs/STATUS.ko.md",
  "docs/ROADMAP.md",
  "docs/ROADMAP.ko.md",
  "docs/SOURCE.md",
  "docs/testing-strategy.md",
  "CODEMAP.md",
  "README.md",
  "README.ko.md",
  "llms.txt",
  "AGENTS.md",
  ".github/CONTRIBUTING.md",
  ".github/SECURITY.md",
  ".github/workflows/pages.yml",
  "release-contract.json",
  "builds/README.md",
];

async function read(relativePath) {
  return readFile(join(root, relativePath), "utf8");
}

for (const relativePath of requiredFiles) {
  await access(join(root, relativePath));
}

const [
  documentationGuide,
  docsIndex,
  howItWorks,
  howItWorksKo,
  testLabGuide,
  status,
  statusKo,
  roadmap,
  roadmapKo,
  sourceGuide,
  testingStrategy,
  codeMap,
  readme,
  readmeKo,
  llms,
  agents,
  contributing,
  pagesWorkflow,
  buildsReadme,
  packageText,
] = await Promise.all([
  read("docs/DOCUMENTATION_GUIDE.md"),
  read("docs/README.md"),
  read("docs/HOW_IT_WORKS.md"),
  read("docs/HOW_IT_WORKS.ko.md"),
  read("docs/TEST_LAB.md"),
  read("docs/STATUS.md"),
  read("docs/STATUS.ko.md"),
  read("docs/ROADMAP.md"),
  read("docs/ROADMAP.ko.md"),
  read("docs/SOURCE.md"),
  read("docs/testing-strategy.md"),
  read("CODEMAP.md"),
  read("README.md"),
  read("README.ko.md"),
  read("llms.txt"),
  read("AGENTS.md"),
  read(".github/CONTRIBUTING.md"),
  read(".github/workflows/pages.yml"),
  read("builds/README.md"),
  read("package.json"),
]);

const packageJson = JSON.parse(packageText);
assert.equal(
  packageJson.scripts?.["validate:docs"],
  "node scripts/validate-documentation.mjs",
  "package.json must expose npm run validate:docs.",
);
assert.match(
  packageJson.scripts?.test ?? "",
  /(?:^|&&\s*)npm run validate:docs(?:\s*&&|$)/u,
  "npm test must include npm run validate:docs so documentation governance is not optional in the normal test path.",
);

assert.match(docsIndex, /DOCUMENTATION_GUIDE\.md/u, "docs/README.md must link to the documentation maintenance guide.");
assert.match(docsIndex, /HOW_IT_WORKS\.md/u, "docs/README.md must expose the end-to-end How It Works guide.");
assert.match(docsIndex, /TEST_LAB\.md/u, "docs/README.md must expose the named Test Lab guide.");
assert.match(docsIndex, /one document that owns|canonical document/iu, "docs/README.md must keep canonical ownership visible.");

for (const phrase of [
  "one changing fact, one canonical owner",
  "documentation plan",
  "Minimum change surface",
  "Historical evidence",
  "Canonical-document propagation",
  "npm run validate:docs",
]) {
  assert(
    documentationGuide.toLowerCase().includes(phrase.toLowerCase()),
    `docs/DOCUMENTATION_GUIDE.md must preserve the governance concept: ${phrase}`,
  );
}

for (const phrase of [
  "60-second model",
  "fresh Guest joins",
  "someone edits a supported Scene object",
  "Reconnect and connection epochs",
  "CODEMAP.md",
]) {
  assert(howItWorks.toLowerCase().includes(phrase.toLowerCase()),
    `docs/HOW_IT_WORKS.md must preserve the explanatory layer: ${phrase}`);
}
for (const phrase of ["60초", "Fresh Guest", "Reconnect", "CODEMAP.md"]) {
  assert(howItWorksKo.toLowerCase().includes(phrase.toLowerCase()),
    `docs/HOW_IT_WORKS.ko.md must preserve the paired explanatory layer: ${phrase}`);
}
for (const phrase of ["thin scenario runner", "incomplete", "no automatic retry", "quality-gates.json"]) {
  assert(testLabGuide.toLowerCase().includes(phrase.toLowerCase()),
    `docs/TEST_LAB.md must preserve the Test Lab evidence boundary: ${phrase}`);
}

// Current paired/user-facing navigation must not leave the Korean entry point behind.
for (const [name, text, expected] of [
  ["README.md", readme, "docs/HOW_IT_WORKS.md"],
  ["README.ko.md", readmeKo, "docs/HOW_IT_WORKS.ko.md"],
]) {
  assert(text.includes(expected), `${name} must expose its current How It Works entry point: ${expected}`);
}
assert.match(readme, /TEST_LAB\.md/u, "README.md must expose Test Lab in the source/validation path.");
assert.match(readmeKo, /TEST_LAB\.md/u, "README.ko.md must expose Test Lab in the source/validation path.");

// llms.txt is a first-class routing surface. It must follow the current information architecture.
for (const path of [
  "docs/HOW_IT_WORKS.md",
  "docs/ENGINEERING_GUIDE.md",
  "docs/DOCUMENTATION_GUIDE.md",
  "docs/TEST_LAB.md",
  "CODEMAP.md",
  "docs/SOURCE.md",
]) {
  assert(llms.includes(path), `llms.txt must route to current canonical guide: ${path}`);
}
assert(
  !/SOURCE[^\n]{0,80}(?:LLM|code)[ -]reading guide|(?:LLM|code)[ -]reading guide[^\n]{0,80}SOURCE/iu.test(llms),
  "llms.txt must not restore the obsolete SOURCE-as-code-reading-guide role; CODEMAP owns question-to-code navigation.",
);

assert.match(agents, /docs\/DOCUMENTATION_GUIDE\.md/u,
  "AGENTS.md must require agents to read the documentation maintenance guide before non-trivial documentation edits.");
assert.match(agents, /npm run validate:docs/u, "AGENTS.md must require the documentation validator.");
assert.match(contributing, /DOCUMENTATION_GUIDE\.md/u,
  "CONTRIBUTING.md must route documentation contributors to the maintenance guide.");

// Pages is a curated discovery surface. Current canonical guides must be mirrored intentionally.
for (const [source, target] of [
  ["docs/HOW_IT_WORKS.md", "how-it-works.txt"],
  ["docs/HOW_IT_WORKS.ko.md", "how-it-works.ko.txt"],
  ["docs/ENGINEERING_GUIDE.md", "engineering-guide.txt"],
  ["docs/DOCUMENTATION_GUIDE.md", "documentation-guide.txt"],
  ["docs/TEST_LAB.md", "test-lab.txt"],
]) {
  const escapedSource = source.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const escapedTarget = target.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  assert(
    new RegExp(`cp\\s+${escapedSource}\\s+\\.pages-site/${escapedTarget}`, "u").test(pagesWorkflow),
    `Pages must mirror current canonical guide ${source} as ${target}.`,
  );
  assert(
    pagesWorkflow.includes(source),
    `Pages curated/full-context configuration must reference canonical guide ${source}.`,
  );
}
for (const key of ["howItWorks", "engineeringGuide", "documentationGuide", "testLab"]) {
  assert(pagesWorkflow.includes(`'${key}'`), `Pages project.json must expose documentation route: ${key}`);
}
assert(
  !/grep\s+-Fq\s+'LLM reading guide'\s+\.pages-site\/source\.txt/u.test(pagesWorkflow),
  "Pages must not enforce the obsolete SOURCE 'LLM reading guide' label.",
);

// Test strategy must describe the Test Lab that exists, not a hypothetical future runner.
assert.match(testingStrategy, /current repository includes|current.*Test Lab/iu,
  "docs/testing-strategy.md must describe the current Test Lab implementation.");
assert(!/future unified Test Lab may/iu.test(testingStrategy),
  "docs/testing-strategy.md still describes Test Lab as future work even though it exists.");

// SOURCE and CODEMAP role boundaries, including newly added operability code.
assert.match(sourceGuide, /source checkout|fresh-clone|fresh clone/iu,
  "docs/SOURCE.md must remain task-oriented around source checkout/build/validation.");
assert.match(sourceGuide, /TeamForge\.Diagnostics\.Tests/u,
  "docs/SOURCE.md must include the current Launcher diagnostics contract in source validation guidance.");
assert.match(sourceGuide, /TEST_LAB\.md|testlab/iu,
  "docs/SOURCE.md must route validation-bundle discovery to Test Lab.");
assert(!/repository.?s?\s+LLM reading guide/iu.test(sourceGuide),
  "docs/SOURCE.md should not preserve an obsolete LLM-reading-guide label solely for old discovery checks.");
assert.match(codeMap, /Start here by question|question.*read|Question/iu,
  "CODEMAP.md must remain the question-to-code navigation reference.");
for (const path of ["DiagnosticSupportBundle.cs", "MainWindow.Diagnostics.cs", "TeamForge.Diagnostics.Tests", "scripts/test-lab.mjs"]) {
  assert(codeMap.includes(path), `CODEMAP.md must route current implementation/tooling path: ${path}`);
}

// Current source/package divergence is release-significant and must remain explicit until a superseding package exists.
for (const [name, text] of [["docs/STATUS.md", status], ["docs/STATUS.ko.md", statusKo], ["builds/README.md", buildsReadme]]) {
  assert(/support bundle|Support Bundle|support-bundle/iu.test(text), `${name} must record the post-r4 support-bundle source divergence.`);
  assert(/not.*(?:byte|behavior).*equivalent|동일한 Package|behavior가 동일/iu.test(text),
    `${name} must make clear that r4 is not equivalent to current main after post-r4 behavior changes.`);
}

const roadmapVolatilePatterns = [
  /\bCI run\s*#?\d+/iu,
  /\bUnity Tests run\s*#?\d+/iu,
  /\bworkflow run\s*#?\d+/iu,
  /\bPR\s*#\d+\b/iu,
  /\bpull request\s*#\d+\b/iu,
  /\bhead\s+[`'"]?[0-9a-f]{7,40}[`'"]?/iu,
];
for (const [name, text] of [["docs/ROADMAP.md", roadmap], ["docs/ROADMAP.ko.md", roadmapKo]]) {
  for (const pattern of roadmapVolatilePatterns) {
    assert(!pattern.test(text),
      `${name} contains short-lived implementation/evidence detail (${pattern}). Put live state in STATUS/issues/evidence and keep ROADMAP direction-oriented.`);
  }
}

const moduleReadmes = [
  "server/README.md",
  "project-peer/README.md",
  "launcher/README.md",
  "unity-package/com.eunsung.teamforge/README.md",
];
for (const relativePath of moduleReadmes) {
  const text = await read(relativePath);
  assert(!/^Current release state\s*:/imu.test(text),
    `${relativePath} must not independently own current release state; link to docs/STATUS.md instead.`);
  assert(!/^Current release lineage\s*:/imu.test(text),
    `${relativePath} must not independently own current release lineage; link to release-contract.json instead.`);
}

const architecture = await read("docs/architecture.md");
for (const pattern of [/^Release state\s*:/imu, /^Current release identity\s*:/imu, /^Current packaged candidate/imu]) {
  assert(!pattern.test(architecture),
    `docs/architecture.md contains volatile release metadata (${pattern}); keep architecture structural and use STATUS/release-contract for live release identity.`);
}

const projectState = await read("docs/project-state.md");
assert.match(projectState, /STATUS\.md/u,
  "docs/project-state.md is a compatibility pointer and must route current state to STATUS.md.");
assert(projectState.length < 5000,
  "docs/project-state.md has grown back into a second current-state database. Keep it as a compatibility pointer.");

const knownIssues = await read("docs/known-issues.md");
assert.match(knownIssues, /GitHub Issues/iu, "docs/known-issues.md must route live bug state to GitHub Issues.");
assert(!/\|\s*#\d+[^\n]*\|\s*(?:OPEN|CLOSED|FIXED|MERGED)\b/iu.test(knownIssues),
  "docs/known-issues.md must not become a hand-maintained duplicate issue-state table.");

for (const [name, text, expectedTerms] of [
  ["docs/STATUS.md", status, ["Capability", "FIELD BLOCKED"]],
  ["docs/STATUS.ko.md", statusKo, ["기능", "FIELD BLOCKED"]],
]) {
  for (const term of expectedTerms) {
    assert(text.includes(term), `${name} is missing expected current-state marker: ${term}`);
  }
}

const linkCheckFiles = [
  "README.md",
  "README.ko.md",
  "docs/DOCUMENTATION_GUIDE.md",
  "docs/README.md",
  "docs/HOW_IT_WORKS.md",
  "docs/HOW_IT_WORKS.ko.md",
  "docs/TEST_LAB.md",
  "docs/STATUS.md",
  "docs/STATUS.ko.md",
  "docs/ROADMAP.md",
  "docs/ROADMAP.ko.md",
  "docs/SOURCE.md",
  "docs/testing-strategy.md",
  "CODEMAP.md",
  "AGENTS.md",
  ".github/CONTRIBUTING.md",
  ".github/SECURITY.md",
  "CHANGELOG.md",
  "builds/README.md",
];

function localMarkdownTargets(text) {
  const targets = [];
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)) {
    let target = match[1].trim();
    if (!target || target.startsWith("#") || /^[a-z][a-z0-9+.-]*:/iu.test(target)) continue;
    if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
    target = target.split("#", 1)[0].split("?", 1)[0];
    if (!target) continue;
    try {
      target = decodeURIComponent(target);
    } catch {
      // Keep the original target; filesystem validation will report it if invalid.
    }
    targets.push(target);
  }
  return targets;
}

for (const relativePath of linkCheckFiles) {
  const text = await read(relativePath);
  const base = dirname(join(root, relativePath));
  for (const target of localMarkdownTargets(text)) {
    const resolved = normalize(resolve(base, target));
    assert(resolved === root || resolved.startsWith(`${root}${sep}`),
      `${relativePath} contains a local link that escapes the repository: ${target}`);
    try {
      await stat(resolved);
    } catch {
      assert.fail(`${relativePath} contains a broken local Markdown link: ${target}`);
    }
  }
}

console.log(`Documentation governance passed for ${requiredFiles.length} required files and ${linkCheckFiles.length} link-checked documents.`);
