import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseContract = JSON.parse(await readFile(path.join(root, "release-contract.json"), "utf8"));
const runtimeRoot = path.join(root, "unity-package", "com.eunsung.teamforge", "Runtime~");
const manifestPath = path.join(runtimeRoot, "runtime-manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const forcedPackagedMode = process.argv.includes("--packaged");
const forcedSourceMode = process.argv.includes("--source");
assert(!(forcedPackagedMode && forcedSourceMode), "Use only one of --packaged or --source.");
const sourceDependenciesPresent = (await Promise.all([
  path.join(root, "server", "node_modules", "ws", "package.json"),
  path.join(root, "project-peer", "node_modules", "ws", "package.json"),
].map((file) => lstat(file).then((entry) => entry.isFile()).catch(() => false)))).every(Boolean);
const packagedMode = forcedPackagedMode || (!forcedSourceMode && !sourceDependenciesPresent);
const hash = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");

assert.equal(manifest.schemaVersion, releaseContract.protocols.runtimeManifest);
assert.equal(manifest.productVersion, releaseContract.productVersion);
assert.equal(manifest.backendContractVersion, 1);
assert.equal(manifest.guestBridgeRelativePath, "backend/project-peer/src/guest-orchestrator-cli.mjs");
assert.equal(manifest.nodeVersion, releaseContract.node.version);
assert.deepEqual(manifest.supportedNodeMajors, releaseContract.node.supportedMajors);
assert.deepEqual(manifest.minimumNodeVersions, releaseContract.node.minimumVersions);
assert.equal(manifest.wsVersion, releaseContract.ws.version);
assert.equal(manifest.wsIntegrity, releaseContract.ws.integrity);
const peerLock = JSON.parse(await readFile(path.join(root, "project-peer", "package-lock.json"), "utf8"));
assert.equal(peerLock.packages["node_modules/ws"].version, manifest.wsVersion);
assert.equal(peerLock.packages["node_modules/ws"].integrity, manifest.wsIntegrity);
const expectedPaths = new Set(manifest.files.map((item) => item.path));
for (const item of manifest.files) {
  assert(!path.isAbsolute(item.path) && !item.path.split("/").includes(".."), `Unsafe manifest path ${item.path}`);
  const file = path.resolve(runtimeRoot, ...item.path.split("/"));
  assert(file.startsWith(`${runtimeRoot}${path.sep}`));
  assert.equal((await stat(file)).size, item.size, `${item.path} size mismatch`);
  assert.equal(await hash(file), item.sha256, `${item.path} hash mismatch`);
}
async function collect(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await collect(target));
    else if (entry.isFile() && target !== manifestPath) result.push(path.relative(runtimeRoot, target).split(path.sep).join("/"));
    else if (!entry.isFile()) throw new Error(`Unsafe runtime entry ${target}`);
  }
  return result;
}
assert.deepEqual(new Set(await collect(runtimeRoot)), expectedPaths, "Runtime contains missing or unmanifested files.");

async function canonicalFiles(relativeSource, relativeDestination = relativeSource) {
  const sourceRoot = path.join(root, relativeSource);
  const sourceInfo = await lstat(sourceRoot);
  if (sourceInfo.isFile()) return [[relativeDestination.split(path.sep).join("/"), sourceRoot]];
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) {
        const child = path.relative(sourceRoot, target);
        files.push([path.join(relativeDestination, child).split(path.sep).join("/"), target]);
      } else {
        throw new Error(`Unsafe canonical runtime source entry ${target}`);
      }
    }
  }
  await visit(sourceRoot);
  return files;
}

const canonicalRecords = new Map();
const canonicalSources = [
  ["package-lock.json"],
  ["server/package-lock.json"], ["server/src"],
  ["project-peer/package-lock.json"], ["project-peer/src"],
];
if (!packagedMode) {
  canonicalSources.push(["server/node_modules/ws"], ["project-peer/node_modules/ws"]);
}
for (const [source, destination = source] of canonicalSources) {
  for (const [relative, sourceFile] of await canonicalFiles(source, destination)) {
    const runtimeRelative = `backend/${relative}`;
    assert(!canonicalRecords.has(runtimeRelative), `Duplicate canonical runtime path ${runtimeRelative}`);
    canonicalRecords.set(runtimeRelative, sourceFile);
  }
}
const runtimeBackendRecords = new Set(
  manifest.files.map((item) => item.path).filter((item) => item.startsWith("backend/")),
);
const dependencyPrefixes = [
  "backend/server/node_modules/ws/",
  "backend/project-peer/node_modules/ws/",
];
const generatedRuntimeManifests = new Set([
  "backend/package.json",
  "backend/server/package.json",
  "backend/project-peer/package.json",
]);
const comparableRuntimeRecords = packagedMode
  ? new Set([...runtimeBackendRecords].filter((item) =>
    !dependencyPrefixes.some((prefix) => item.startsWith(prefix)) && !generatedRuntimeManifests.has(item)))
  : new Set([...runtimeBackendRecords].filter((item) => !generatedRuntimeManifests.has(item)));
assert.deepEqual(comparableRuntimeRecords, new Set(canonicalRecords.keys()),
  "Canonical backend and Runtime file sets differ.");
for (const [relative, sourceFile] of canonicalRecords) {
  assert.equal(await hash(path.join(runtimeRoot, ...relative.split("/"))), await hash(sourceFile),
    `Canonical backend byte mismatch: ${relative}`);
}
if (packagedMode) {
  const serverWsRoot = path.join(runtimeRoot, "backend", "server", "node_modules", "ws");
  const peerWsRoot = path.join(runtimeRoot, "backend", "project-peer", "node_modules", "ws");
  const relativeFiles = async (directory) => (await canonicalFiles(path.relative(root, directory), ""))
    .map(([relative, absolute]) => [relative.replace(/^\//u, ""), absolute])
    .sort(([left], [right]) => left.localeCompare(right));
  const serverWs = await relativeFiles(serverWsRoot);
  const peerWs = await relativeFiles(peerWsRoot);
  assert.deepEqual(serverWs.map(([relative]) => relative), peerWs.map(([relative]) => relative),
    "Packaged Server and Project Peer ws file sets differ.");
  for (let index = 0; index < serverWs.length; index += 1) {
    assert.equal(await hash(serverWs[index][1]), await hash(peerWs[index][1]),
      `Packaged ws byte mismatch: ${serverWs[index][0]}`);
  }
  const wsPackage = JSON.parse(await readFile(path.join(serverWsRoot, "package.json"), "utf8"));
  assert.equal(wsPackage.version, manifest.wsVersion);
  assert([...runtimeBackendRecords].every((item) => canonicalRecords.has(item) ||
    generatedRuntimeManifests.has(item) ||
    dependencyPrefixes.some((prefix) => item.startsWith(prefix))),
  "Packaged Runtime contains an unexpected backend dependency path.");
}
for (const relativeManifest of generatedRuntimeManifests) {
  const manifestPath = path.join(runtimeRoot, ...relativeManifest.split("/"));
  const packageManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(packageManifest.teamforgeRuntimeOnly, true,
    `${relativeManifest} must declare its runtime-only surface.`);
  assert.equal(packageManifest.scripts, undefined,
    `${relativeManifest} must not advertise omitted developer scripts.`);
  for (const [name, target] of Object.entries(packageManifest.bin ?? {})) {
    assert.equal(typeof target, "string", `${relativeManifest} bin ${name} must name a file.`);
    const targetPath = path.resolve(path.dirname(manifestPath), ...target.split("/"));
    assert(targetPath.startsWith(`${path.dirname(manifestPath)}${path.sep}`),
      `${relativeManifest} bin ${name} escapes its package.`);
    assert((await lstat(targetPath)).isFile(), `${relativeManifest} bin ${name} target is missing: ${target}`);
  }
}
const generated = await readFile(path.join(root, "unity-package", "com.eunsung.teamforge", "Editor", "UX", "TeamForgeRuntimeManifest.g.cs"), "utf8");
assert(generated.includes(await hash(manifestPath)), "Generated C# manifest pin differs.");

function run(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { ...options, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
    if (options.input) child.stdin.end(options.input); else child.stdin.end();
  });
}

const platform = manifest.platforms.find((item) => item.os === "win32" && item.architecture === "x64");
if (process.platform === "win32" && process.arch === "x64") {
  const node = path.join(runtimeRoot, ...platform.executable.split("/"));
  assert(node.length <= 240,
    `Bundled Runtime Node path is ${node.length} characters; extract or stage TeamForge under a shorter path (maximum gate: 240).`);
  const version = await run(node, ["--version"]);
  assert.equal(version.code, 0);
  assert.equal(version.stdout, `v${manifest.nodeVersion}`);
  const bridge = path.join(runtimeRoot, ...manifest.bridgeRelativePath.split("/"));
  const request = JSON.stringify({ requestId: "wp35-runtime-verification", operation: "inspect", arguments: {} }) + "\n";
  const response = await run(node, [bridge, "--workspace-root", path.join(runtimeRoot, "backend")], {
    cwd: path.join(runtimeRoot, "backend"),
    env: { ...process.env, TEAMFORGE_RUNTIME_KIND: "bundled_package" },
    input: request,
  });
  assert.equal(response.code, 0, response.stderr);
  const result = JSON.parse(response.stdout.split(/\r?\n/u).find((line) => line.includes("wp35-runtime-verification")));
  assert.equal(result.state, "idle", JSON.stringify(result.failures));
  assert.equal(result.runtimeStrategy.kind, "bundled_package");
  assert.equal(result.runtimeStrategy.npmCli, null);
} else {
  console.log("Runtime execution NOT RUN: this candidate bundles win-x64 only.");
}
console.log(JSON.stringify({
  verified: true,
  canonicalMode: packagedMode ? "packaged" : "source",
  manifestFiles: manifest.files.length,
  runtimeExecution: process.platform === "win32" && process.arch === "x64" ? "PASS" : "NOT RUN",
}, null, 2));
