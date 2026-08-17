import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);
const releaseContract = JSON.parse(await readFile(path.join(root, "release-contract.json"), "utf8"));
const packageRoot = path.join(root, "unity-package", "com.eunsung.teamforge");
const runtimeTargetRoot = path.join(packageRoot, "Runtime~");
const runtimeRoot = path.join(root, "work", `runtime-build-${process.pid}`);
const arguments_ = Object.fromEntries(process.argv.slice(2).reduce((items, value, index, all) => {
  if (value.startsWith("--") && all[index + 1] && !all[index + 1].startsWith("--")) {
    items.push([value.slice(2), all[index + 1]]);
  }
  return items;
}, []));
const nodeRootArgument = arguments_["node-root"];
const nodeArchiveArgument = arguments_["node-archive"];
assert(typeof nodeRootArgument === "string" && path.isAbsolute(nodeRootArgument),
  "--node-root must be an explicit absolute path.");
assert(typeof nodeArchiveArgument === "string" && path.isAbsolute(nodeArchiveArgument),
  "--node-archive must be an explicit absolute path.");
const nodeRoot = path.normalize(nodeRootArgument);
const nodeArchive = path.normalize(nodeArchiveArgument);

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

assert.equal(releaseContract.schemaVersion, 1, "Unsupported release contract schema.");
assert.equal(path.basename(nodeArchive), releaseContract.node.sourceArchive,
  "Node source archive name differs from release-contract.json.");
assert.equal(await sha256(nodeArchive), releaseContract.node.sourceArchiveSha256,
  "Node source archive SHA-256 differs from the official pin in release-contract.json.");
const nodeExecutable = path.join(nodeRoot, "node.exe");
const { stdout: nodeVersionOutput } = await execFileAsync(nodeExecutable, ["--version"], { windowsHide: true });
assert.equal(nodeVersionOutput.trim(), `v${releaseContract.node.version}`,
  "Node source directory version differs from release-contract.json.");

async function filesBelow(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesBelow(target));
    else if (entry.isFile()) result.push(target);
    else throw new Error(`Unsafe runtime source entry: ${target}`);
  }
  return result;
}

async function copy(relativeSource, relativeDestination = relativeSource) {
  const source = path.join(root, relativeSource);
  const destination = path.join(runtimeRoot, "backend", relativeDestination);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, force: true, errorOnExist: false });
}

assert.equal(path.dirname(runtimeTargetRoot), packageRoot, "Runtime target escaped the Unity package.");
assert(runtimeRoot.startsWith(`${path.join(root, "work")}${path.sep}`),
  "Disposable Runtime build root escaped the repository work directory.");
await rm(runtimeRoot, { recursive: true, force: true });
await mkdir(runtimeRoot, { recursive: true });
for (const item of [
  "package.json", "package-lock.json",
  "server/package.json", "server/package-lock.json", "server/src", "server/node_modules/ws",
  "project-peer/package.json", "project-peer/package-lock.json", "project-peer/src", "project-peer/node_modules/ws",
]) await copy(item);

for (const relativeManifest of ["package.json", "server/package.json", "project-peer/package.json"]) {
  const sourceManifest = JSON.parse(await readFile(path.join(root, ...relativeManifest.split("/")), "utf8"));
  delete sourceManifest.scripts;
  delete sourceManifest.packageManager;
  sourceManifest.teamforgeRuntimeOnly = true;
  await writeFile(
    path.join(runtimeRoot, "backend", ...relativeManifest.split("/")),
    `${JSON.stringify(sourceManifest, null, 2)}\n`,
  );
}

const platformRoot = path.join(runtimeRoot, "platforms", "win-x64");
await mkdir(platformRoot, { recursive: true });
await cp(path.join(nodeRoot, "node.exe"), path.join(platformRoot, "node.exe"));
await cp(path.join(nodeRoot, "LICENSE"), path.join(platformRoot, "LICENSE"));

const packageManifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
const peerLock = JSON.parse(await readFile(path.join(root, "project-peer", "package-lock.json"), "utf8"));
assert.equal(packageManifest.version, releaseContract.productVersion,
  "Unity package version differs from release-contract.json.");
assert.equal(peerLock.packages["node_modules/ws"].version, releaseContract.ws.version,
  "Project Peer ws lock differs from release-contract.json.");
assert.equal(peerLock.packages["node_modules/ws"].integrity, releaseContract.ws.integrity,
  "Project Peer ws integrity differs from release-contract.json.");
const fileRecords = [];
for (const file of (await filesBelow(runtimeRoot)).sort()) {
  const details = await stat(file);
  fileRecords.push({
    path: path.relative(runtimeRoot, file).split(path.sep).join("/"),
    size: details.size,
    sha256: await sha256(file),
  });
}
const nodeVersion = releaseContract.node.version;
const manifest = {
  schemaVersion: 1,
  productVersion: packageManifest.version,
  backendContractVersion: 1,
  backendRelativePath: "backend",
  bridgeRelativePath: "backend/project-peer/src/host-orchestrator-cli.mjs",
  guestBridgeRelativePath: "backend/project-peer/src/guest-orchestrator-cli.mjs",
  nodeVersion,
  nodeSourceArchive: path.basename(nodeArchive),
  nodeSourceArchiveSha256: await sha256(nodeArchive),
  supportedNodeMajors: releaseContract.node.supportedMajors,
  minimumNodeVersions: releaseContract.node.minimumVersions,
  wsVersion: peerLock.packages["node_modules/ws"].version,
  wsIntegrity: peerLock.packages["node_modules/ws"].integrity,
  platforms: [{
    id: "win-x64",
    os: "win32",
    architecture: "x64",
    executable: "platforms/win-x64/node.exe",
    sha256: await sha256(path.join(platformRoot, "node.exe")),
  }],
  securityPolicy: {
    dependencyUpdateCadenceDays: 30,
    urgentSecurityReviewHours: 72,
    npmAuditRequiredForRelease: true,
    registrySignatureVerificationRequiredForRelease: true,
  },
  files: fileRecords,
};
const manifestPath = path.join(runtimeRoot, "runtime-manifest.json");
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
const manifestHash = await sha256(manifestPath);
const generated = `// Generated by scripts/build-runtime-bundle.mjs.\nnamespace EunSung.TeamForge\n{\n    internal static class TeamForgeRuntimeManifest\n    {\n        internal const string ExpectedSha256 = "${manifestHash}";\n        internal const string ProductVersion = "${packageManifest.version}";\n    }\n}\n`;
await rm(runtimeTargetRoot, { recursive: true, force: true });
await rename(runtimeRoot, runtimeTargetRoot);
await writeFile(path.join(packageRoot, "Editor", "UX", "TeamForgeRuntimeManifest.g.cs"), generated);
console.log(JSON.stringify({ runtimeRoot: runtimeTargetRoot, manifestHash, files: fileRecords.length, nodeVersion }, null, 2));
