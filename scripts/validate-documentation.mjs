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
  "docs/STATUS.md",
  "docs/STATUS.ko.md",
  "docs/ROADMAP.md",
  "docs/ROADMAP.ko.md",
  "docs/SOURCE.md",
  "CODEMAP.md",
  "AGENTS.md",
  ".github/CONTRIBUTING.md",
  ".github/SECURITY.md",
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
  status,
  statusKo,
  roadmap,
  roadmapKo,
  sourceGuide,
  codeMap,
  agents,
  contributing,
  packageText,
] = await Promise.all([
  read("docs/DOCUMENTATION_GUIDE.md"),
  read("docs/README.md"),
  read("docs/STATUS.md"),
  read("docs/STATUS.ko.md"),
  read("docs/ROADMAP.md"),
  read("docs/ROADMAP.ko.md"),
  read("docs/SOURCE.md"),
  read("CODEMAP.md"),
  read("AGENTS.md"),
  read(".github/CONTRIBUTING.md"),
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

assert.match(
  docsIndex,
  /DOCUMENTATION_GUIDE\.md/u,
  "docs/README.md must link to the documentation maintenance guide.",
);
assert.match(
  docsIndex,
  /one document that owns|canonical document/iu,
  "docs/README.md must keep canonical ownership visible.",
);

for (const phrase of [
  "one changing fact, one canonical owner",
  "documentation plan",
  "Minimum change surface",
  "Historical evidence",
  "npm run validate:docs",
]) {
  assert(
    documentationGuide.toLowerCase().includes(phrase.toLowerCase()),
    `docs/DOCUMENTATION_GUIDE.md must preserve the governance concept: ${phrase}`,
  );
}

assert.match(
  agents,
  /docs\/DOCUMENTATION_GUIDE\.md/u,
  "AGENTS.md must require agents to read the documentation maintenance guide before non-trivial documentation edits.",
);
assert.match(
  agents,
  /npm run validate:docs/u,
  "AGENTS.md must require the documentation validator.",
);
assert.match(
  contributing,
  /DOCUMENTATION_GUIDE\.md/u,
  "CONTRIBUTING.md must route documentation contributors to the maintenance guide.",
);

const roadmapVolatilePatterns = [
  /\bCI run\s*#?\d+/iu,
  /\bUnity Tests run\s*#?\d+/iu,
  /\bworkflow run\s*#?\d+/iu,
  /\bPR\s*#\d+\b/iu,
  /\bpull request\s*#\d+\b/iu,
  /\bhead\s+[`'\"]?[0-9a-f]{7,40}[`'\"]?/iu,
];

for (const [name, text] of [["docs/ROADMAP.md", roadmap], ["docs/ROADMAP.ko.md", roadmapKo]]) {
  for (const pattern of roadmapVolatilePatterns) {
    assert(
      !pattern.test(text),
      `${name} contains short-lived implementation/evidence detail (${pattern}). Put live state in STATUS/issues/evidence and keep ROADMAP direction-oriented.`,
    );
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
  assert(
    !/^Current release state\s*:/imu.test(text),
    `${relativePath} must not independently own current release state; link to docs/STATUS.md instead.`,
  );
  assert(
    !/^Current release lineage\s*:/imu.test(text),
    `${relativePath} must not independently own current release lineage; link to release-contract.json instead.`,
  );
}

const architecture = await read("docs/architecture.md");
for (const pattern of [
  /^Release state\s*:/imu,
  /^Current release identity\s*:/imu,
  /^Current packaged candidate/imu,
]) {
  assert(
    !pattern.test(architecture),
    `docs/architecture.md contains volatile release metadata (${pattern}); keep architecture structural and use STATUS/release-contract for live release identity.`,
  );
}

const projectState = await read("docs/project-state.md");
assert.match(
  projectState,
  /STATUS\.md/u,
  "docs/project-state.md is a compatibility pointer and must route current state to STATUS.md.",
);
assert(
  projectState.length < 5000,
  "docs/project-state.md has grown back into a second current-state database. Keep it as a compatibility pointer.",
);

const knownIssues = await read("docs/known-issues.md");
assert.match(
  knownIssues,
  /GitHub Issues/iu,
  "docs/known-issues.md must route live bug state to GitHub Issues.",
);
assert(
  !/\|\s*#\d+[^\n]*\|\s*(?:OPEN|CLOSED|FIXED|MERGED)\b/iu.test(knownIssues),
  "docs/known-issues.md must not become a hand-maintained duplicate issue-state table.",
);

assert.match(
  sourceGuide,
  /source checkout|fresh-clone|fresh clone/iu,
  "docs/SOURCE.md must remain task-oriented around source checkout/build/validation.",
);
assert.match(
  codeMap,
  /Start here by question|question.*read|Question/iu,
  "CODEMAP.md must remain the question-to-code navigation reference.",
);

for (const [name, text, expectedTerms] of [
  ["docs/STATUS.md", status, ["Capability", "FIELD BLOCKED"]],
  ["docs/STATUS.ko.md", statusKo, ["기능", "FIELD BLOCKED"]],
]) {
  for (const term of expectedTerms) {
    assert(text.includes(term), `${name} is missing expected current-state marker: ${term}`);
  }
}

const linkCheckFiles = [
  "docs/DOCUMENTATION_GUIDE.md",
  "docs/README.md",
  "docs/STATUS.md",
  "docs/STATUS.ko.md",
  "docs/ROADMAP.md",
  "docs/ROADMAP.ko.md",
  "docs/SOURCE.md",
  "CODEMAP.md",
  "AGENTS.md",
  ".github/CONTRIBUTING.md",
  ".github/SECURITY.md",
  "CHANGELOG.md",
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
    assert(
      resolved === root || resolved.startsWith(`${root}${sep}`),
      `${relativePath} contains a local link that escapes the repository: ${target}`,
    );
    try {
      await stat(resolved);
    } catch {
      assert.fail(`${relativePath} contains a broken local Markdown link: ${target}`);
    }
  }
}

console.log(`Documentation governance passed for ${requiredFiles.length} required files and ${linkCheckFiles.length} link-checked documents.`);
