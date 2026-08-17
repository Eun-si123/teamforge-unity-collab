import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arguments_ = Object.fromEntries(process.argv.slice(2).reduce((items, value, index, all) => {
  if (value.startsWith("--") && all[index + 1] && !all[index + 1].startsWith("--")) {
    items.push([value.slice(2), all[index + 1]]);
  }
  return items;
}, []));
const releaseContract = JSON.parse(await readFile(path.join(root, "release-contract.json"), "utf8"));
const launcherRoot = path.join(root, "launcher", "win-x64");
const unityRuntimeRoot = path.join(root, "unity-package", "com.eunsung.teamforge", "Runtime~");
const scratchParent = path.resolve(arguments_["scratch-root"] ?? path.join(root, "work"));
assert(path.isAbsolute(scratchParent) && scratchParent !== root && path.dirname(scratchParent) !== scratchParent,
  "--scratch-root must resolve to a dedicated absolute directory.");
const MAXIMUM_MANIFEST_BYTES = 8 * 1024 * 1024;
const MAXIMUM_FILES = 10_000;
const MAXIMUM_CHILD_OUTPUT_BYTES = 1024 * 1024;
const CHILD_TIMEOUT_MS = 45_000;
const SHA256 = /^[0-9a-f]{64}$/u;
const EXPECTED_SELF_TEST_PASS = "{\"ok\":true,\"code\":\"runtime_self_test_passed\"}";
const EXPECTED_SELF_TEST_FAILURE = "{\"ok\":false,\"code\":\"runtime_self_test_failed\"}";

function portable(value) {
  return value.split(path.sep).join("/");
}

function assertExactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object.`);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label} has an unexpected field set.`);
}

function assertSafeRelative(relative, label) {
  assert.equal(typeof relative, "string", `${label} path must be a string.`);
  assert(relative.length > 0 && !path.posix.isAbsolute(relative) && !relative.includes("\\") && !relative.includes(":"),
    `${label} has an unsafe path: ${relative}`);
  const parts = relative.split("/");
  assert(parts.every((part) => part && part !== "." && part !== ".." && !/[. ]$/u.test(part)),
    `${label} has an unsafe path segment: ${relative}`);
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function collectFiles(directory, current = directory, result = []) {
  const rootInfo = current === directory ? await lstat(directory) : null;
  if (rootInfo) {
    assert(rootInfo.isDirectory() && !rootInfo.isSymbolicLink(), `Unsafe or missing directory: ${directory}`);
  }
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    const info = await lstat(absolute);
    assert(!info.isSymbolicLink(), `Symbolic link or junction-like entry is not allowed: ${absolute}`);
    if (info.isDirectory()) {
      await collectFiles(directory, absolute, result);
    } else {
      assert(info.isFile(), `Unsupported filesystem entry: ${absolute}`);
      result.push({ absolute, relative: portable(path.relative(directory, absolute)), size: info.size });
      assert(result.length <= MAXIMUM_FILES, `Directory contains more than ${MAXIMUM_FILES} files: ${directory}`);
    }
  }
  return result;
}

async function readJsonFile(file, maximumBytes, label) {
  const info = await lstat(file);
  assert(info.isFile() && !info.isSymbolicLink() && info.size > 0 && info.size <= maximumBytes,
    `${label} is missing, empty, oversized, or unsafe.`);
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON.`, { cause: error });
  }
}

function validateLauncherIdentity(manifest) {
  assertExactKeys(manifest, [
    "schemaVersion", "product", "productVersion", "target", "deployment", "signed",
    "targetFramework", "dotnetSdkVersion", "dotnetRuntimeVersion", "runtimeManifestSha256", "loaderSha256", "files",
  ], "Launcher manifest");
  assert.equal(manifest.schemaVersion, releaseContract.protocols.launcherManifest,
    "Launcher manifest schema is incompatible.");
  assert.equal(manifest.product, "TeamForge Launcher", "Launcher product identity differs.");
  assert.equal(manifest.productVersion, releaseContract.productVersion, "Launcher product version differs.");
  assert.equal(manifest.target, releaseContract.target, "Launcher target differs.");
  assert.equal(manifest.deployment, releaseContract.launcher.deployment, "Launcher deployment identity differs.");
  assert.equal(manifest.signed, releaseContract.launcher.signed,
    "Launcher signing declaration differs from release-contract.json.");
  assert.equal(manifest.targetFramework, releaseContract.dotnet.targetFramework,
    "Launcher target framework differs from release-contract.json.");
  assert.equal(manifest.dotnetSdkVersion, releaseContract.dotnet.testedSdk,
    "Launcher build SDK differs from release-contract.json.");
  assert.equal(manifest.dotnetRuntimeVersion, releaseContract.dotnet.runtimeVersion,
    "Launcher .NET runtime differs from release-contract.json.");
  assert(SHA256.test(manifest.runtimeManifestSha256 ?? ""), "Launcher Runtime manifest hash is not canonical SHA-256.");
  assert(SHA256.test(manifest.loaderSha256 ?? ""), "Launcher loader hash is not canonical SHA-256.");
  assert(Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.files.length <= MAXIMUM_FILES,
    "Launcher manifest file inventory is missing or too large.");
}

async function verifyLauncherManifest() {
  const manifestPath = path.join(launcherRoot, "launcher-manifest.json");
  const manifest = await readJsonFile(manifestPath, MAXIMUM_MANIFEST_BYTES, "Launcher manifest");
  validateLauncherIdentity(manifest);

  const expected = new Map();
  const caseFolded = new Set();
  for (const record of manifest.files) {
    assertExactKeys(record, ["path", "size", "sha256"], "Launcher file record");
    assertSafeRelative(record.path, "Launcher file record");
    assert(Number.isSafeInteger(record.size) && record.size >= 0, `Invalid Launcher file size: ${record.path}`);
    assert(SHA256.test(record.sha256 ?? ""), `Invalid Launcher file hash: ${record.path}`);
    assert(!expected.has(record.path), `Duplicate Launcher file record: ${record.path}`);
    const folded = record.path.toLowerCase();
    assert(!caseFolded.has(folded), `Case-insensitive Launcher path collision: ${record.path}`);
    caseFolded.add(folded);
    expected.set(record.path, record);
  }

  const actualFiles = (await collectFiles(launcherRoot))
    .filter((item) => item.relative !== "launcher-manifest.json")
    .sort((left, right) => left.relative.localeCompare(right.relative));
  assert.equal(actualFiles.length, expected.size, "Launcher folder file count differs from its manifest.");
  for (const file of actualFiles) {
    const record = expected.get(file.relative);
    assert(record, `Launcher contains an unmanifested file: ${file.relative}`);
    assert.equal(file.size, record.size, `Launcher file size differs: ${file.relative}`);
    assert.equal(await sha256(file.absolute), record.sha256, `Launcher file hash differs: ${file.relative}`);
  }
  for (const relative of expected.keys()) {
    assert(actualFiles.some((item) => item.relative === relative), `Launcher manifest names a missing file: ${relative}`);
  }

  for (const required of [
    "TeamForge.Launcher.exe",
    "runtime-loader.mjs",
    "Runtime/runtime-manifest.json",
    "Runtime/platforms/win-x64/node.exe",
  ]) assert(expected.has(required), `Required Launcher artifact is absent from the manifest: ${required}`);
  assert(![...expected.keys()].some((entry) => /\.(?:pdb|xml)$/iu.test(entry)),
    "Launcher contains a debug symbol or generated XML artifact.");

  const runtimeManifestPath = path.join(launcherRoot, "Runtime", "runtime-manifest.json");
  const loaderPath = path.join(launcherRoot, "runtime-loader.mjs");
  assert.equal(await sha256(runtimeManifestPath), manifest.runtimeManifestSha256,
    "Launcher identity does not pin its actual Runtime manifest.");
  assert.equal(await sha256(loaderPath), manifest.loaderSha256,
    "Launcher identity does not pin its actual Runtime loader.");
  return manifest;
}

function validateRuntimeContract(manifest) {
  assert.equal(manifest?.schemaVersion, releaseContract.protocols.runtimeManifest, "Runtime schema is incompatible.");
  assert.equal(manifest?.productVersion, releaseContract.productVersion, "Runtime product version differs.");
  assert.equal(manifest?.backendContractVersion, 1, "Runtime backend contract differs.");
  assert.equal(manifest?.guestBridgeRelativePath, "backend/project-peer/src/guest-orchestrator-cli.mjs",
    "Runtime Guest bridge identity differs.");
  assert.equal(manifest?.nodeVersion, releaseContract.node.version, "Runtime Node version differs.");
  assert.deepEqual(manifest?.supportedNodeMajors, releaseContract.node.supportedMajors,
    "Runtime supported Node lines differ.");
  assert.deepEqual(manifest?.minimumNodeVersions, releaseContract.node.minimumVersions,
    "Runtime minimum security patches differ.");
  assert.equal(manifest?.wsVersion, releaseContract.ws.version, "Runtime ws version differs.");
  assert.equal(manifest?.wsIntegrity, releaseContract.ws.integrity, "Runtime ws integrity differs.");
  assert(Array.isArray(manifest?.files) && manifest.files.length > 0 && manifest.files.length <= MAXIMUM_FILES,
    "Runtime file inventory is missing or too large.");
  const platform = manifest?.platforms?.find((item) => item?.id === "win-x64");
  assert(platform && platform.os === "win32" && platform.architecture === "x64"
    && platform.executable === "platforms/win-x64/node.exe" && SHA256.test(platform.sha256 ?? ""),
  "Runtime Windows x64 platform identity differs.");
  return platform;
}

async function verifyRuntimeByteIdentity(launcherManifest) {
  const launcherRuntime = path.join(launcherRoot, "Runtime");
  const launcherManifestPath = path.join(launcherRuntime, "runtime-manifest.json");
  const unityManifestPath = path.join(unityRuntimeRoot, "runtime-manifest.json");
  const launcherManifestBytes = await readFile(launcherManifestPath);
  const unityManifestBytes = await readFile(unityManifestPath);
  assert.deepEqual(launcherManifestBytes, unityManifestBytes,
    "Launcher Runtime manifest is not byte-identical to Unity Runtime~.");
  assert.equal(createHash("sha256").update(unityManifestBytes).digest("hex"), launcherManifest.runtimeManifestSha256,
    "Unity Runtime~ manifest does not match the Launcher identity pin.");

  const runtimeContract = JSON.parse(unityManifestBytes.toString("utf8"));
  const platform = validateRuntimeContract(runtimeContract);
  const expected = new Map();
  const caseFolded = new Set();
  for (const record of runtimeContract.files) {
    assertExactKeys(record, ["path", "size", "sha256"], "Runtime file record");
    assertSafeRelative(record.path, "Runtime file record");
    assert(Number.isSafeInteger(record.size) && record.size >= 0, `Invalid Runtime file size: ${record.path}`);
    assert(SHA256.test(record.sha256 ?? ""), `Invalid Runtime file hash: ${record.path}`);
    assert(!expected.has(record.path), `Duplicate Runtime file record: ${record.path}`);
    const folded = record.path.toLowerCase();
    assert(!caseFolded.has(folded), `Case-insensitive Runtime path collision: ${record.path}`);
    caseFolded.add(folded);
    expected.set(record.path, record);
  }

  const [launcherFiles, unityFiles] = await Promise.all([
    collectFiles(launcherRuntime),
    collectFiles(unityRuntimeRoot),
  ]);
  const launcherByPath = new Map(launcherFiles.map((item) => [item.relative, item]));
  const unityByPath = new Map(unityFiles.map((item) => [item.relative, item]));
  assert.equal(launcherByPath.size, unityByPath.size, "Launcher Runtime and Unity Runtime~ file counts differ.");
  assert.equal(launcherByPath.size, expected.size + 1, "Runtime folder file count differs from its manifest.");
  assert(launcherByPath.has("runtime-manifest.json") && unityByPath.has("runtime-manifest.json"),
    "Runtime manifest is missing from a Runtime folder.");
  for (const [relative, unityFile] of unityByPath) {
    const launcherFile = launcherByPath.get(relative);
    assert(launcherFile, `Launcher Runtime is missing Unity Runtime~ file: ${relative}`);
    assert.equal(launcherFile.size, unityFile.size, `Runtime byte length differs: ${relative}`);
    const [launcherHash, unityHash] = await Promise.all([sha256(launcherFile.absolute), sha256(unityFile.absolute)]);
    assert.equal(launcherHash, unityHash, `Runtime file is not byte-identical: ${relative}`);
    if (relative !== "runtime-manifest.json") {
      const record = expected.get(relative);
      assert(record, `Runtime contains an unmanifested file: ${relative}`);
      assert.equal(unityFile.size, record.size, `Runtime manifest size differs: ${relative}`);
      assert.equal(unityHash, record.sha256, `Runtime manifest hash differs: ${relative}`);
    }
  }
  assert.equal(await sha256(path.join(launcherRuntime, ...platform.executable.split("/"))), platform.sha256,
    "Bundled Windows Node executable does not match its Runtime platform pin.");
  return { runtimeContract, platform };
}

function scrubbedEnvironment() {
  const result = { ...process.env };
  for (const name of Object.keys(result)) {
    if (name.toUpperCase().startsWith("NODE_")
      || name.toUpperCase().startsWith("NPM_")
      || name.toUpperCase().startsWith("NPM_CONFIG_")
      || name.toUpperCase().startsWith("COREPACK_")
      || name.toUpperCase().startsWith("TEAMFORGE_")
      || ["SSL_CERT_FILE", "SSL_CERT_DIR", "OPENSSL_CONF"].includes(name.toUpperCase())) {
      delete result[name];
    }
  }
  return result;
}

async function runChild(file, args, { cwd, env, timeoutMs = CHILD_TIMEOUT_MS } = {}) {
  assert(path.isAbsolute(file), `Child executable must be an absolute path: ${file}`);
  assert(path.isAbsolute(cwd), `Child working directory must be an absolute path: ${cwd}`);
  return await new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let failure;
    let settled = false;
    let timer;
    let forcedTimer;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forcedTimer);
      callback();
    };
    const stop = (error) => {
      if (failure) return;
      failure = error;
      child.kill();
      forcedTimer = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        finish(() => reject(failure));
      }, 2_000);
      forcedTimer.unref();
    };
    const append = (kind, chunk) => {
      if (failure) return;
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) + chunk.length > MAXIMUM_CHILD_OUTPUT_BYTES) {
        stop(new Error(`Child output exceeded ${MAXIMUM_CHILD_OUTPUT_BYTES} bytes: ${file}`));
        return;
      }
      if (kind === "stdout") stdout += chunk.toString("utf8");
      else stderr += chunk.toString("utf8");
    };
    child.stdout.on("data", (chunk) => append("stdout", chunk));
    child.stderr.on("data", (chunk) => append("stderr", chunk));
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code, signal) => finish(() => failure
      ? reject(failure)
      : resolve({ code, signal, stdout, stderr })));
    timer = setTimeout(() => stop(new Error(`Child timed out after ${timeoutMs} ms: ${file}`)), timeoutMs);
    timer.unref();
  });
}

function assertSelfTestPass(result, label) {
  assert.equal(result.signal, null, `${label} was terminated by a signal.`);
  assert.equal(result.code, 0, `${label} exited ${result.code}; stderr=${result.stderr.trim()}`);
  assert.equal(result.stderr.trim(), "", `${label} wrote unexpected stderr.`);
  assert.equal(result.stdout.trim(), EXPECTED_SELF_TEST_PASS, `${label} did not return the exact success JSON.`);
}

function assertStableSelfTestFailure(result, label) {
  assert.equal(result.signal, null, `${label} was terminated by a signal.`);
  assert.equal(result.code, 2, `${label} did not use the stable fail-closed exit code.`);
  assert.equal(result.stderr.trim(), "", `${label} wrote unexpected stderr.`);
  assert.equal(result.stdout.trim(), EXPECTED_SELF_TEST_FAILURE,
    `${label} did not return the exact stable fail-closed JSON.`);
}

async function pathExists(target) {
  return Boolean(await stat(target).catch(() => null));
}

function assertContained(target, parent, label) {
  const resolvedTarget = path.resolve(target);
  const resolvedParent = path.resolve(parent);
  assert(resolvedTarget.startsWith(`${resolvedParent}${path.sep}`), `${label} escaped its disposable parent.`);
  return resolvedTarget;
}

async function withIsolatedLauncherCopy(tempRoot, name, callback) {
  const copyRoot = assertContained(path.join(tempRoot, name), tempRoot, "Isolated Launcher copy");
  await cp(launcherRoot, copyRoot, {
    recursive: true,
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
    dereference: false,
  });
  try {
    await callback(copyRoot);
  } finally {
    assert.equal(path.dirname(copyRoot), tempRoot, "Refusing to remove a non-isolated Launcher copy.");
    await rm(copyRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

async function main() {
  assert.equal(process.platform, "win32", "WP4 Launcher verification is packaged for Windows only.");
  assert(path.isAbsolute(root) && path.isAbsolute(launcherRoot) && path.isAbsolute(unityRuntimeRoot),
    "Verifier paths must be absolute.");
  const launcherManifest = await verifyLauncherManifest();
  const { runtimeContract } = await verifyRuntimeByteIdentity(launcherManifest);
  const nodeExecutable = path.join(launcherRoot, "Runtime", "platforms", "win-x64", "node.exe");
  const launcherExecutable = path.join(launcherRoot, "TeamForge.Launcher.exe");
  const safeEnvironment = scrubbedEnvironment();
  const observations = {};

  const nodeVersion = await runChild(nodeExecutable, ["--version"], {
    cwd: launcherRoot,
    env: safeEnvironment,
    timeoutMs: 15_000,
  });
  assert.equal(nodeVersion.signal, null, "Bundled Node version check was terminated.");
  assert.equal(nodeVersion.code, 0, `Bundled Node version check exited ${nodeVersion.code}.`);
  assert.equal(nodeVersion.stderr.trim(), "", "Bundled Node version check wrote unexpected stderr.");
  assert.equal(nodeVersion.stdout.trim(), `v${runtimeContract.nodeVersion}`,
    "Bundled Node version differs from the verified Runtime manifest.");
  observations.bundledNode = { exitCode: nodeVersion.code, stdout: nodeVersion.stdout.trim() };

  const baseline = await runChild(launcherExecutable, ["--self-test-runtime"], {
    cwd: launcherRoot,
    env: safeEnvironment,
  });
  assertSelfTestPass(baseline, "Canonical Launcher self-test");
  observations.canonicalSelfTest = { exitCode: baseline.code, stdout: baseline.stdout.trim() };

  await mkdir(scratchParent, { recursive: true });
  const tempRoot = await mkdtemp(path.join(scratchParent, "wp4-launcher-verify-"));
  assert.equal(path.dirname(tempRoot), scratchParent, "Disposable verification root was created outside its parent.");
  const projectedRuntimeNode = path.join(
    tempRoot,
    "corrupt-runtime-case",
    "Runtime",
    "platforms",
    "win-x64",
    "node.exe",
  );
  assert(projectedRuntimeNode.length <= 240,
    `Launcher verifier scratch path exceeds the Windows execution budget (${projectedRuntimeNode.length} > 240); use --scratch-root with a shorter absolute directory.`);
  try {
    const markerPath = assertContained(path.join(tempRoot, "node-options-marker.txt"), tempRoot, "NODE_OPTIONS marker");
    const markerModule = assertContained(path.join(tempRoot, "marker-writer.cjs"), tempRoot, "NODE_OPTIONS module");
    const markerCode = `require("node:fs").writeFileSync(${JSON.stringify(markerPath)}, "executed", { flag: "wx" });\n`;
    await writeFile(markerModule, markerCode, { flag: "wx" });
    const maliciousNodeOptions = `--require=${JSON.stringify(markerModule)}`;

    const control = await runChild(nodeExecutable, ["--eval", "void 0"], {
      cwd: tempRoot,
      env: { ...safeEnvironment, NODE_OPTIONS: maliciousNodeOptions },
      timeoutMs: 15_000,
    });
    assert.equal(control.code, 0,
      `NODE_OPTIONS marker control invocation failed; stderr=${control.stderr.trim()}`);
    assert(await pathExists(markerPath), "NODE_OPTIONS marker payload was not valid, so the scrub test would be inconclusive.");
    await rm(markerPath, { force: false });

    const fakeProject = assertContained(path.join(tempRoot, "Fake Project Workspace"), tempRoot, "Fake Project workspace");
    const fakeRuntime = path.join(fakeProject, "Runtime");
    const fakeNodeModules = path.join(fakeProject, "node_modules");
    const fakeLoaderMarker = path.join(tempRoot, "fake-runtime-loader-marker.txt");
    await mkdir(path.join(fakeRuntime, "platforms", "win-x64"), { recursive: true });
    await mkdir(fakeNodeModules, { recursive: true });
    await writeFile(path.join(fakeRuntime, "runtime-manifest.json"), "{\"schemaVersion\":1,\"productVersion\":\"untrusted\"}\n", { flag: "wx" });
    await writeFile(path.join(fakeRuntime, "platforms", "win-x64", "node.exe"), "not an executable\n", { flag: "wx" });
    await writeFile(path.join(fakeProject, "runtime-loader.mjs"),
      `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(fakeLoaderMarker)}, "executed");\n`, { flag: "wx" });

    const attackedEnvironment = {
      ...safeEnvironment,
      NODE_OPTIONS: maliciousNodeOptions,
      NODE_PATH: fakeNodeModules,
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      SSL_CERT_FILE: path.join(fakeProject, "untrusted-ca.pem"),
      OPENSSL_CONF: path.join(fakeProject, "untrusted-openssl.cnf"),
      TEAMFORGE_WORKSPACE_ROOT: fakeProject,
      TEAMFORGE_RUNTIME_ROOT: fakeRuntime,
      TEAMFORGE_NODE_PATH: path.join(fakeRuntime, "platforms", "win-x64", "node.exe"),
      TEAMFORGE_RUNTIME_LOADER: path.join(fakeProject, "runtime-loader.mjs"),
    };
    const attacked = await runChild(launcherExecutable, ["--self-test-runtime"], {
      cwd: fakeProject,
      env: attackedEnvironment,
    });
    assertSelfTestPass(attacked, "Launcher self-test with hostile inherited environment and fake Project Runtime");
    assert(!await pathExists(markerPath), "Launcher passed inherited NODE_OPTIONS to its bundled Node process.");
    assert(!await pathExists(fakeLoaderMarker), "Launcher executed a Project-local runtime loader.");
    observations.hostileEnvironmentAndFakeProjectRuntime = {
      exitCode: attacked.code,
      stdout: attacked.stdout.trim(),
      nodeOptionsMarkerAbsent: true,
      fakeRuntimeLoaderMarkerAbsent: true,
    };

    await withIsolatedLauncherCopy(tempRoot, "corrupt-runtime-case", async (copyRoot) => {
      const corruptFile = path.join(copyRoot, "Runtime", "backend", "project-peer", "src", "guest-orchestrator-cli.mjs");
      await appendFile(corruptFile, "\n// integrity corruption for isolated fail-closed verification\n");
      const result = await runChild(path.join(copyRoot, "TeamForge.Launcher.exe"), ["--self-test-runtime"], {
        cwd: copyRoot,
        env: safeEnvironment,
      });
      assertStableSelfTestFailure(result, "Corrupt Runtime self-test");
      observations.corruptRuntime = { exitCode: result.code, stdout: result.stdout.trim() };
    });

    await withIsolatedLauncherCopy(tempRoot, "missing-runtime-case", async (copyRoot) => {
      const runtime = path.join(copyRoot, "Runtime");
      const quarantined = path.join(copyRoot, "Runtime.missing-for-verification");
      await rename(runtime, quarantined);
      assert(!await pathExists(runtime), "Isolated missing-Runtime case still has a Runtime folder.");
      const result = await runChild(path.join(copyRoot, "TeamForge.Launcher.exe"), ["--self-test-runtime"], {
        cwd: copyRoot,
        env: safeEnvironment,
      });
      assertStableSelfTestFailure(result, "Missing Runtime self-test");
      observations.missingRuntime = { exitCode: result.code, stdout: result.stdout.trim() };
    });
  } finally {
    assert.equal(path.dirname(tempRoot), scratchParent, "Refusing to remove a non-disposable verification root.");
    assert(path.basename(tempRoot).startsWith("wp4-launcher-verify-"), "Unexpected disposable verification root name.");
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }

  await verifyLauncherManifest();
  await verifyRuntimeByteIdentity(launcherManifest);
  console.log(JSON.stringify({
    ok: true,
    verifier: "teamforge-wp4-launcher-verifier-v1",
    target: "win-x64",
    launcherFiles: launcherManifest.files.length,
    runtimeFiles: runtimeContract.files.length,
    nodeVersion: runtimeContract.nodeVersion,
    observations,
    checks: [
      "launcher_manifest_exact",
      "unity_launcher_runtime_byte_identity",
      "bundled_node_version",
      "launcher_runtime_self_test",
      "hostile_environment_scrub",
      "project_runtime_ignored",
      "corrupt_runtime_fail_closed",
      "missing_runtime_fail_closed",
      "canonical_output_unchanged",
    ],
  }, null, 2));
}

main().catch((error) => {
  console.error(`WP4 Launcher verification FAILED: ${error?.stack ?? error}`);
  process.exitCode = 1;
});
