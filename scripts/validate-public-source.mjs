import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nodeRange = ">=22.23.2 <23 || >=24.18.1 <25";

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

const files = await collectFiles(root);
assert(files.length > 0, "Public source validation requires a non-empty checkout.");

const requiredSourceFiles = [
  "README.md",
  "README.ko.md",
  "AUTHORS.md",
  "NOTICE",
  "LICENSE",
  "release-contract.json",
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
  ".github/CONTRIBUTING.md",
  ".github/SECURITY.md",
  "scripts/validate-repository.mjs",
  "scripts/validate-public-source.mjs",
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
assert.equal(releaseContract.productVersion, "0.5.1");
assert.equal(releaseContract.releaseId, "0.5.1-wp5.1-path-resilience");
assert.equal(releaseContract.workPackage, "UX Bootstrap WP5.1 Path Resilience & Automatic Short Workspace");
assert.equal(releaseContract.target, "win-x64");
assert.equal(releaseContract.status, "FIELD_BLOCKED");
assert.deepEqual(releaseContract.protocols, {
  realtime: 1,
  projectTransfer: 1,
  projectManifest: 1,
  runtimeManifest: 1,
  launcherManifest: 1,
  releaseManifest: 1,
});
assert.equal(releaseContract.unity.packageLine, "6000.3");
assert.equal(releaseContract.unity.testedEditor, "6000.3.21f1");
assert.equal(releaseContract.node.version, "24.19.0");
assert.deepEqual(releaseContract.node.supportedMajors, [22, 24]);
assert.deepEqual(releaseContract.node.minimumVersions, { 22: "22.23.2", 24: "24.18.1" });
assert.equal(releaseContract.npm.version, "11.19.0");
assert.equal(releaseContract.ws.version, "8.21.3");
assert.equal(releaseContract.launcher.signed, false);

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
assert.equal(workspace.packageManager, `npm@${releaseContract.npm.version}`);
assert.equal(workspace.engines?.node, nodeRange, "Root package.json must declare the supported developer Node range.");
assert.equal(workspaceLock.packages?.[""]?.engines?.node, nodeRange,
  "Root package-lock.json must preserve the root Node engine metadata.");
assert.equal(server.engines?.node, nodeRange);
assert.equal(peer.engines?.node, nodeRange);
assert.equal(unity.unity, releaseContract.unity.packageLine);
assert.equal(unity.license, "AGPL-3.0-only");
assert(!/\bsafe project bootstrap coordination\b/iu.test(unity.description ?? ""),
  "Unity package metadata must not make a broad safety guarantee.");

const currentDocs = [
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
  ".github/CONTRIBUTING.md",
  ".github/SECURITY.md",
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

for (const [name, text] of [["STATUS.md", status], ["STATUS.ko.md", statusKo], ["architecture.md", architecture], ["project-state.md", projectState]]) {
  assert(text.includes(releaseContract.releaseId), `${name} omits the current release ID.`);
  assert(text.includes("FIELD BLOCKED"), `${name} omits the current FIELD BLOCKED state.`);
}
assert.match(status, /product version[\s\S]{0,1200}release ID[\s\S]{0,1200}artifact/iu,
  "STATUS.md should distinguish product, release, and artifact identity.");
assert.match(buildsReadme, /If the bytes change, the artifact identity changes/iu,
  "Build classification must distinguish byte-level artifact identity.");
assert.match(launcherReadme, /not committed to the public source checkout/iu,
  "Launcher README must distinguish source from the generated packaged layout.");
assert.match(decisions, /D-301[\s\S]*교체됨[\s\S]*Windows Guest Launcher/iu,
  "Architecture decisions must mark the old Node CLI fresh-Guest path as superseded.");
assert.match(decisions, /D-005[\s\S]*부분 교체/iu,
  "Architecture decisions must mark the old Node runtime assumption as partially superseded.");

const generatedRuntime = join(root, "unity-package/com.eunsung.teamforge/Runtime~/runtime-manifest.json");
const packagedLauncher = join(root, "launcher/win-x64/launcher-manifest.json");
const releaseAudit = join(root, "Release-Integrity-Audit.md");
const generatedPresent = [generatedRuntime, packagedLauncher, releaseAudit].filter((path) => files.includes(path));

console.log("TeamForge public-source validation passed.");
console.log(`Product: ${releaseContract.productVersion}`);
console.log(`Release ID: ${releaseContract.releaseId}`);
console.log(`State: ${releaseContract.status}`);
console.log(`Tracked source files inspected: ${files.length}`);
if (generatedPresent.length === 0) {
  console.log("Mode: public source checkout (generated Runtime/release evidence not required).");
} else {
  console.log("Mode: source tree with some generated/release artifacts present; public-source checks still passed.");
}
