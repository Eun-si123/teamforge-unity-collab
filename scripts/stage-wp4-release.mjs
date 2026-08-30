import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseContractSource = await readFile(path.join(root, "release-contract.json"));
const releaseContract = JSON.parse(releaseContractSource.toString("utf8"));
const arguments_ = Object.fromEntries(process.argv.slice(2).reduce((items, value, index, all) => {
  if (value.startsWith("--") && all[index + 1] && !all[index + 1].startsWith("--")) {
    items.push([value.slice(2), all[index + 1]]);
  }
  return items;
}, []));
const stagingArgument = arguments_.staging;
assert(typeof stagingArgument === "string" && path.isAbsolute(stagingArgument),
  "--staging must be an explicit absolute path.");
const staging = path.normalize(stagingArgument);
assert(path.isAbsolute(staging) && staging !== root && path.dirname(staging) !== staging,
  "--staging must be a dedicated absolute directory.");

const excludedSourceDirectories = new Set([
  ".git", ".agents", ".codex", ".vs", ".vscode", "Library", "Temp", "Logs", "UserSettings",
  "node_modules", "obj", "bin", "work", "validation-output",
  "test-results", "artifacts",
]);

// Keep this list aligned with the current public-source contract. Historical WP4/WP5
// release-only evidence files that are no longer part of the public repository must
// not be resurrected as release requirements.
const sourceSpecs = [
  ".editorconfig", ".gitattributes", ".gitignore",
  "AGENTS.md", "AUTHORS.md", "CHANGELOG.md", "CODEMAP.md", "LICENSE", "NOTICE",
  "README.md", "README.ko.md", "TeamForge-readme-demo-hq-1280-12fps.gif", "llms.txt",
  "package.json", "package-lock.json", "release-contract.json", "global.json",
  "builds/README.md",
  ".github",
  "docs",
  "server/src", "server/test", "server/scripts", "server/package.json", "server/package-lock.json",
  "server/README.md", "server/LICENSE", "server/THIRD_PARTY_NOTICES.md", "server/Dockerfile", "server/compose.yaml",
  "project-peer/src", "project-peer/test", "project-peer/scripts", "project-peer/support",
  "project-peer/package.json", "project-peer/package-lock.json", "project-peer/README.md",
  "scripts",
  "unity-package/com.eunsung.teamforge",
  "unity-project/Assets", "unity-project/Packages/manifest.json",
  "unity-project/ProjectSettings/ProjectVersion.txt", "unity-project/README.md",
  "launcher/README.md", "launcher/Directory.Build.props", "launcher/runtime-loader.mjs", "launcher/src", "launcher/test", "launcher/tests", "launcher/win-x64",
];

function portable(value) {
  return value.split(path.sep).join("/");
}

async function copyAllowed(source, destination, allowGeneratedRuntime = false) {
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw new Error(`Refusing symbolic/reparse-like source: ${source}`);
  if (info.isFile()) {
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, { errorOnExist: true, force: false });
    return;
  }
  assert(info.isDirectory(), `Unsupported release source entry: ${source}`);
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const childSource = path.join(source, entry.name);
    const childDestination = path.join(destination, entry.name);
    const sourceRelative = portable(path.relative(root, childSource));
    const runtimeDependency = /^(?:unity-package\/com\.eunsung\.teamforge\/Runtime~|launcher\/win-x64\/Runtime)\/backend\/(?:server|project-peer)\/node_modules(?:$|\/ws(?:$|\/))/u
      .test(sourceRelative);
    const insideDependencyTree = sourceRelative.split("/").includes("node_modules");
    if (insideDependencyTree && !(allowGeneratedRuntime && runtimeDependency)) {
      continue;
    }
    if (entry.isDirectory() && excludedSourceDirectories.has(entry.name) &&
        !(allowGeneratedRuntime && runtimeDependency)) {
      continue;
    }
    await copyAllowed(childSource, childDestination, allowGeneratedRuntime);
  }
}

await mkdir(staging, { recursive: false });
for (const spec of sourceSpecs) {
  const source = path.join(root, ...spec.split("/"));
  const destination = path.join(staging, ...spec.split("/"));
  await copyAllowed(source, destination, spec.includes("Runtime") || spec === "unity-package/com.eunsung.teamforge" ||
    spec === "launcher/win-x64");
}

async function collect(directory, result = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Release contains a symbolic link: ${target}`);
    if (entry.isDirectory()) await collect(target, result);
    else if (entry.isFile()) result.push(target);
    else throw new Error(`Release contains an unsupported entry: ${target}`);
  }
  return result;
}

function assertPortableSafe(relative) {
  assert(!path.posix.isAbsolute(relative) && !relative.includes("\\") && !relative.includes(":"),
    `Unsafe release path: ${relative}`);
  const parts = relative.split("/");
  assert(parts.every((part) => part && part !== "." && part !== ".." && !/[. ]$/u.test(part)),
    `Unsafe release path segment: ${relative}`);
  const banned = new Set(["library", "temp", "logs", "usersettings", "obj", "bin", ".git", ".agents", ".codex"]);
  assert(!parts.some((part) => banned.has(part.toLowerCase())), `Generated/cache path leaked: ${relative}`);
  if (parts.some((part) => part.toLowerCase() === "node_modules")) {
    assert(/^(?:unity-package\/com\.eunsung\.teamforge\/Runtime~|launcher\/win-x64\/Runtime)\/backend\/(?:server|project-peer)\/node_modules\/ws\//u.test(relative),
      `Development node_modules leaked: ${relative}`);
  }
  assert(!/(?:^|\/)\.(?:env|npmrc)(?:\.|$)|\.(?:pfx|p12|key|pem|log|zip)$/iu.test(relative),
    `Secret/cache/archive-like file leaked: ${relative}`);
}

const files = (await collect(staging)).sort((left, right) => portable(left).localeCompare(portable(right)));
const caseFolded = new Set();
const records = [];
for (const file of files) {
  const relative = portable(path.relative(staging, file));
  assertPortableSafe(relative);
  const folded = relative.toLowerCase();
  assert(!caseFolded.has(folded), `Case-insensitive release path collision: ${relative}`);
  caseFolded.add(folded);
  const bytes = await readFile(file);
  if (bytes.length < 5_000_000 && /\.(?:cs|json|md|mjs|js|ps1|cmd|sh|txt|xml|props|targets|csproj|sln|yaml|yml)$/iu.test(relative)) {
    const text = bytes.toString("utf8");
    // CHANGELOG documents the already-redacted generic fixture C:\Users\Dev\...
    // from the privacy migration. Ignore only that exact literal while keeping all
    // other user-profile paths fail-closed. Synthetic tests should assemble realistic
    // user-profile fixtures at runtime rather than adding broader scanner exemptions here.
    const localPathProbe = text.replaceAll("C:\\Users\\Dev\\...", "C:\\Users\\<generic>\\...");
    assert(!/(?:[A-Za-z]:\\Users\\[^<\\\r\n]+|\/Users\/[^<\/\r\n]+|\/home\/[^<\/\r\n]+)/u.test(localPathProbe),
      `Local user path leaked in ${relative}`);
    assert(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(text), `Private key leaked in ${relative}`);
  }
  records.push({ path: relative, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
}

const runtimeManifest = await readFile(path.join(staging,
  "unity-package", "com.eunsung.teamforge", "Runtime~", "runtime-manifest.json"));
const launcherRuntimeManifest = await readFile(path.join(staging,
  "launcher", "win-x64", "Runtime", "runtime-manifest.json"));
assert.deepEqual(launcherRuntimeManifest, runtimeManifest,
  "Unity package Runtime and Launcher Runtime manifests are not byte-identical.");
const runtimeContract = JSON.parse(runtimeManifest.toString("utf8"));
assert.equal(runtimeContract.productVersion, releaseContract.productVersion,
  "Runtime product version differs from release-contract.json.");
for (const item of runtimeContract.files) {
  const unityRuntimeFile = path.join(staging, "unity-package", "com.eunsung.teamforge", "Runtime~",
    ...item.path.split("/"));
  const launcherRuntimeFile = path.join(staging, "launcher", "win-x64", "Runtime", ...item.path.split("/"));
  assert.deepEqual(await readFile(launcherRuntimeFile), await readFile(unityRuntimeFile),
    `Launcher Runtime byte drift: ${item.path}`);
}
const launcherManifest = await readFile(path.join(staging, "launcher", "win-x64", "launcher-manifest.json"));
const launcherContract = JSON.parse(launcherManifest.toString("utf8"));
assert.equal(launcherContract.productVersion, releaseContract.productVersion,
  "Launcher product version differs from release-contract.json.");
const release = {
  schemaVersion: releaseContract.protocols.releaseManifest,
  product: releaseContract.product,
  productVersion: releaseContract.productVersion,
  releaseId: releaseContract.releaseId,
  workPackage: releaseContract.workPackage,
  target: releaseContract.target,
  status: releaseContract.status,
  releaseContractSha256: createHash("sha256").update(releaseContractSource).digest("hex"),
  runtimeManifestSha256: createHash("sha256").update(runtimeManifest).digest("hex"),
  launcherManifestSha256: createHash("sha256").update(launcherManifest).digest("hex"),
  files: records,
};
await writeFile(path.join(staging, "release-manifest.json"), `${JSON.stringify(release, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ staging, files: records.length, bytes: records.reduce((sum, item) => sum + item.size, 0),
  runtimeManifestSha256: release.runtimeManifestSha256, launcherManifestSha256: release.launcherManifestSha256 }, null, 2));
