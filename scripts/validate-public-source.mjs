import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const ignoredDirectories = new Set([
  ".git",
  ".agents",
  ".codex",
  "node_modules",
  "Library",
  "Temp",
  "Logs",
  "UserSettings",
  "obj",
  "bin",
  "work",
  ".tmp-npm-server",
  ".tmp-npm-peer",
]);

async function collectFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await collectFiles(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function assertLocalMarkdownLinks(relativePath) {
  const file = join(root, relativePath);
  const markdown = await readFile(file, "utf8");
  for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const raw = match[1].trim();
    const destination = raw.split("#", 1)[0];
    if (!destination || /^(?:https?:|mailto:|sandbox:)/u.test(destination)) continue;
    const localPath = resolve(dirname(file), decodeURIComponent(destination));
    assert(await exists(localPath), `Broken local Markdown link in ${relativePath}: ${destination}`);
  }
}

function assertRecord(value, label) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value),
    `release-contract.json must declare ${label} as an object.`);
  return value;
}

function nodeRangeFromContract(node) {
  assert(Array.isArray(node.supportedMajors) && node.supportedMajors.length > 0,
    "release-contract.json must declare supported Node majors.");
  assert(node.minimumVersions && typeof node.minimumVersions === "object" && !Array.isArray(node.minimumVersions),
    "release-contract.json must declare minimum Node versions.");
  return [...node.supportedMajors]
    .sort((left, right) => left - right)
    .map((major) => {
      assert(Number.isInteger(major) && major > 0,
        "release-contract.json supported Node majors must be positive integers.");
      const minimum = node.minimumVersions[String(major)];
      assert.match(minimum ?? "", /^\d+\.\d+\.\d+$/u,
        `release-contract.json is missing a semver minimum for Node ${major}.`);
      return `>=${minimum} <${major + 1}`;
    })
    .join(" || ");
}

const files = await collectFiles(root);
assert(files.length > 0, "Public source validation requires a non-empty checkout.");

const requiredSourceFiles = [
  "README.md",
  "README.ko.md",
  "AUTHORS.md",
  "NOTICE",
  "LICENSE",
  "CODEMAP.md",
  "llms.txt",
  "release-contract.json",
  "builds/README.md",
  "package.json",
  "package-lock.json",
  "server/package.json",
  "server/package-lock.json",
  "server/README.md",
  "project-peer/package.json",
  "project-peer/package-lock.json",
  "project-peer/README.md",
  "project-peer/src/path-resilience-contract.json",
  "project-peer/test/wp5-diagnostics-recovery.test.mjs",
  "project-peer/test/wp51-path-resilience-static.test.mjs",
  "launcher/README.md",
  "launcher/runtime-loader.mjs",
  "launcher/src/TeamForge.Launcher.Core/DiagnosticsRecovery.cs",
  "launcher/src/TeamForge.Launcher.Core/PathResilience.cs",
  "launcher/src/TeamForge.Launcher.Core/ExecutionAliasManager.cs",
  "launcher/src/TeamForge.Launcher/app.manifest",
  "unity-package/com.eunsung.teamforge/package.json",
  "unity-package/com.eunsung.teamforge/README.md",
  "docs/STATUS.md",
  "docs/STATUS.ko.md",
  "docs/architecture.md",
  "docs/architecture-decisions.md",
  "docs/project-state.md",
  "docs/known-issues.md",
  "docs/compatibility.md",
  "docs/deployment.md",
  "docs/ROADMAP.md",
  "docs/ROADMAP.ko.md",
  "docs/SOURCE.md",
  "docs/AI_DISCOVERY.md",
  ".github/CONTRIBUTING.md",
  ".github/SECURITY.md",
  ".github/SUPPORT.md",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/testing_report.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/pages.yml",
  ".github/workflows/indexnow.yml",
  "scripts/teamforge.ps1",
  "scripts/validate-repository.mjs",
  "scripts/validate-public-source.mjs",
  "scripts/build-agent-web.py",
  "scripts/build-sitemap.py",
  "scripts/verify-agent-site.py",
];

for (const required of requiredSourceFiles) {
  assert(await exists(join(root, required)), `Missing required public-source file: ${required}`);
}

for (const file of files.filter((path) => path.endsWith(".json"))) {
  JSON.parse(await readFile(file, "utf8"));
}

const releaseContract = JSON.parse(await readFile(join(root, "release-contract.json"), "utf8"));
assert.equal(releaseContract.schemaVersion, 1);
assert.equal(releaseContract.product, "Unity TeamForge");
assert.match(releaseContract.productVersion ?? "", /^\d+\.\d+\.\d+$/u);
assert.equal(typeof releaseContract.releaseId, "string");
assert(releaseContract.releaseId.startsWith(`${releaseContract.productVersion}-`),
  "releaseId must remain namespaced under the product version.");
assert.equal(typeof releaseContract.workPackage, "string");
assert(releaseContract.workPackage.length > 0, "release-contract.json must name the current work package.");
assert.equal(typeof releaseContract.target, "string");
assert(releaseContract.target.length > 0, "release-contract.json must name the release target.");
assert.equal(typeof releaseContract.status, "string");
assert(releaseContract.status.length > 0, "release-contract.json must name the candidate state.");

const protocols = assertRecord(releaseContract.protocols, "protocols");
const unityContract = assertRecord(releaseContract.unity, "unity");
const nodeContract = assertRecord(releaseContract.node, "node");
const npmContract = assertRecord(releaseContract.npm, "npm");
const wsContract = assertRecord(releaseContract.ws, "ws");
const dotnetContract = assertRecord(releaseContract.dotnet, "dotnet");
const launcherContract = assertRecord(releaseContract.launcher, "launcher");

assert.deepEqual(Object.keys(protocols).sort(), [
  "launcherManifest",
  "projectManifest",
  "projectTransfer",
  "realtime",
  "releaseManifest",
  "runtimeManifest",
]);
for (const [name, version] of Object.entries(protocols)) {
  assert(Number.isInteger(version) && version >= 1,
    `release-contract.json protocol ${name} must be a positive integer.`);
}
assert.match(unityContract.packageLine ?? "", /^\d+\.\d+$/u);
assert.match(unityContract.testedEditor ?? "", /^\d+\.\d+\.\d+f\d+$/u);
assert(unityContract.testedEditor.startsWith(`${unityContract.packageLine}.`),
  "The tested Unity Editor must belong to the declared Unity package line.");
assert.match(nodeContract.version ?? "", /^\d+\.\d+\.\d+$/u);
const nodeRange = nodeRangeFromContract(nodeContract);
assert.match(npmContract.version ?? "", /^\d+\.\d+\.\d+$/u);
assert.match(wsContract.version ?? "", /^\d+\.\d+\.\d+$/u);
assert.match(dotnetContract.targetFramework ?? "", /^net\d+\.\d+-windows$/u);
assert.match(dotnetContract.runtimeVersion ?? "", /^\d+\.\d+\.\d+$/u);
assert.match(dotnetContract.testedSdk ?? "", /^\d+\.\d+\.\d+$/u);
assert.equal(typeof launcherContract.signed, "boolean");

const workspace = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const workspaceLock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
const server = JSON.parse(await readFile(join(root, "server/package.json"), "utf8"));
const peer = JSON.parse(await readFile(join(root, "project-peer/package.json"), "utf8"));
const unity = JSON.parse(await readFile(join(root, "unity-package/com.eunsung.teamforge/package.json"), "utf8"));

for (const [name, packageJson] of [
  ["workspace", workspace],
  ["server", server],
  ["project-peer", peer],
  ["Unity package", unity],
]) {
  assert.equal(packageJson.version, releaseContract.productVersion, `${name} product version differs from release-contract.json.`);
}
assert.equal(workspace.packageManager, `npm@${npmContract.version}`);
assert.equal(workspace.engines?.node, nodeRange, "Root package.json must declare the release-contract Node range.");
assert.equal(workspaceLock.packages?.[""]?.engines?.node, nodeRange,
  "Root package-lock.json must preserve the root Node engine metadata.");
assert.equal(server.engines?.node, nodeRange);
assert.equal(peer.engines?.node, nodeRange);
assert.equal(unity.unity, unityContract.packageLine);
assert.equal(unity.license, "AGPL-3.0-only");
assert(!/\bsafe project bootstrap coordination\b/iu.test(unity.description ?? ""),
  "Unity package metadata must not make a broad safety guarantee.");
assert.equal(workspace.scripts?.validate, "node scripts/validate-public-source.mjs",
  "npm run validate must remain the fresh/public-source validator.");
assert.equal(workspace.scripts?.["validate:release"], "node scripts/validate-repository.mjs",
  "npm run validate:release must remain the staged release-candidate validator.");
assert.match(workspace.scripts?.test ?? "", /npm run validate/u,
  "The root test script must finish with public-source validation, not the staged release validator.");

const currentDocs = [
  "README.md",
  "README.ko.md",
  "CODEMAP.md",
  "llms.txt",
  "builds/README.md",
  "docs/STATUS.md",
  "docs/STATUS.ko.md",
  "docs/architecture.md",
  "docs/project-state.md",
  "docs/known-issues.md",
  "docs/compatibility.md",
  "docs/deployment.md",
  "docs/SOURCE.md",
  "docs/AI_DISCOVERY.md",
  "server/README.md",
  "project-peer/README.md",
  "launcher/README.md",
  "unity-package/com.eunsung.teamforge/README.md",
  ".github/CONTRIBUTING.md",
  ".github/SECURITY.md",
  ".github/SUPPORT.md",
];

for (const relativePath of currentDocs) {
  await assertLocalMarkdownLinks(relativePath);
}

const operationalDocs = [
  "README.md",
  "README.ko.md",
  "docs/STATUS.md",
  "docs/STATUS.ko.md",
  "docs/architecture.md",
  "docs/project-state.md",
  "docs/known-issues.md",
  "docs/compatibility.md",
  "docs/deployment.md",
  "server/README.md",
  "project-peer/README.md",
  "launcher/README.md",
  "unity-package/com.eunsung.teamforge/README.md",
];
for (const relativePath of operationalDocs) {
  const text = await readFile(join(root, relativePath), "utf8");
  assert(text.includes(releaseContract.productVersion),
    `Current operational document omits product version ${releaseContract.productVersion}: ${relativePath}`);
  assert(!/Node(?:\.js)?\s+20(?:\s|\+|$)|Node\.js 20 or newer/iu.test(text),
    `Current operational document advertises obsolete Node 20: ${relativePath}`);
  assert(!/(?:current|latest)\s+(?:upstream\s+)?(?:same-line\s+)?patch/iu.test(text),
    `Current operational document contains a time-sensitive "current/latest patch" claim: ${relativePath}`);
  assert(!/not known vulnerable/iu.test(text),
    `Current operational document makes an unsupported broad vulnerability claim: ${relativePath}`);
  assert(!/Release-Integrity-Audit\.md|executable-smoke-results\.md/u.test(text),
    `Current operational document points at stale release-only evidence: ${relativePath}`);
}

const status = await readFile(join(root, "docs/STATUS.md"), "utf8");
const statusKo = await readFile(join(root, "docs/STATUS.ko.md"), "utf8");
const architecture = await readFile(join(root, "docs/architecture.md"), "utf8");
const projectState = await readFile(join(root, "docs/project-state.md"), "utf8");
const buildsReadme = await readFile(join(root, "builds/README.md"), "utf8");
const launcherReadme = await readFile(join(root, "launcher/README.md"), "utf8");
const decisions = await readFile(join(root, "docs/architecture-decisions.md"), "utf8");
const llms = await readFile(join(root, "llms.txt"), "utf8");
const ciWorkflow = await readFile(join(root, ".github/workflows/ci.yml"), "utf8");
const pagesWorkflow = await readFile(join(root, ".github/workflows/pages.yml"), "utf8");

for (const [name, text] of [["STATUS.md", status], ["STATUS.ko.md", statusKo], ["architecture.md", architecture], ["project-state.md", projectState]]) {
  assert(text.includes(releaseContract.releaseId), `${name} omits the current release ID.`);
  assert(text.includes(releaseContract.status), `${name} omits the current candidate state ${releaseContract.status}.`);
}
assert(llms.includes(releaseContract.releaseId), "llms.txt omits the current release ID.");
assert.match(status, /product version[\s\S]{0,1200}release ID[\s\S]{0,1200}artifact/iu,
  "STATUS.md should distinguish product, release, and artifact identity.");
assert.match(status, /Public source contract[\s\S]{0,1000}npm run validate/iu,
  "STATUS.md must describe the public-source CI/validation boundary.");
assert.match(statusKo, /Public source contract[\s\S]{0,1000}npm run validate/iu,
  "STATUS.ko.md must describe the public-source CI/validation boundary.");
assert.match(buildsReadme, /If the bytes change, the artifact identity changes/iu,
  "Build classification must distinguish byte-level artifact identity.");
assert.match(launcherReadme, /not committed to the public source checkout/iu,
  "Launcher README must distinguish source from the generated packaged layout.");
assert.match(decisions, /D-301[\s\S]*교체됨[\s\S]*Windows Guest Launcher/iu,
  "Architecture decisions must mark the old Node CLI fresh-Guest path as superseded.");
assert.match(decisions, /D-005[\s\S]*부분 교체/iu,
  "Architecture decisions must mark the old Node runtime assumption as partially superseded.");
assert.match(ciWorkflow, /source-contract:[\s\S]*npm run validate/u,
  "CI must keep a public-source contract job that runs npm run validate.");
assert.match(pagesWorkflow, /cp release-contract\.json \.pages-site\/release-contract\.json/u,
  "Pages must publish the source-controlled release contract.");
assert.match(pagesWorkflow, /verify-agent-site\.py/u,
  "Pages must run the agent/search output verifier before deployment.");

const generatedRuntime = join(root, "unity-package/com.eunsung.teamforge/Runtime~/runtime-manifest.json");
const packagedLauncher = join(root, "launcher/win-x64/launcher-manifest.json");
const releaseAudit = join(root, "Release-Integrity-Audit.md");
const generatedPresent = [generatedRuntime, packagedLauncher, releaseAudit].filter((path) => files.includes(path));

console.log("TeamForge public-source validation passed.");
console.log(`Product: ${releaseContract.productVersion}`);
console.log(`Release ID: ${releaseContract.releaseId}`);
console.log(`State: ${releaseContract.status}`);
console.log(`Files inspected: ${files.length}`);
if (generatedPresent.length === 0) {
  console.log("Mode: public source checkout (generated Runtime/release evidence not required).");
} else {
  console.log("Mode: source tree with some generated/release artifacts present; public-source checks still passed.");
}
