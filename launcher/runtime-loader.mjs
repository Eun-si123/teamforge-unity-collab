import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MAXIMUM_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAXIMUM_RUNTIME_FILES = 10_000;
const SHA256 = /^[0-9a-f]{64}$/u;

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fail(message) {
  const error = new Error(message);
  error.code = "runtime_verification_failed";
  throw error;
}

async function hashFile(file) {
  const bytes = await readFile(file);
  return createHash("sha256").update(bytes).digest("hex");
}

async function collect(root, current = root, result = []) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isSymbolicLink()) fail("Runtime contains a symbolic link or reparse-like entry.");
    if (entry.isDirectory()) await collect(root, absolute, result);
    else if (entry.isFile()) result.push(path.relative(root, absolute).split(path.sep).join("/"));
    else fail("Runtime contains an unsupported filesystem entry.");
    if (result.length > MAXIMUM_RUNTIME_FILES) fail("Runtime contains too many files.");
  }
  return result;
}

export async function verifyLauncherRuntime(runtimeRoot, expectedManifestSha256) {
  if (typeof runtimeRoot !== "string" || !path.isAbsolute(runtimeRoot) ||
      typeof expectedManifestSha256 !== "string" || !SHA256.test(expectedManifestSha256)) {
    fail("Launcher runtime arguments are invalid.");
  }
  const root = path.resolve(runtimeRoot);
  const rootInfo = await lstat(root).catch(() => null);
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) fail("Launcher runtime directory is missing or unsafe.");
  if (await realpath(root) !== root) fail("Launcher runtime directory is not canonical.");

  const manifestPath = path.join(root, "runtime-manifest.json");
  const manifestInfo = await lstat(manifestPath).catch(() => null);
  if (!manifestInfo?.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.size > MAXIMUM_MANIFEST_BYTES) {
    fail("Launcher runtime manifest is missing or unsafe.");
  }
  if (await hashFile(manifestPath) !== expectedManifestSha256) fail("Launcher runtime manifest hash differs from the product pin.");

  let manifest;
  try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); } catch { fail("Launcher runtime manifest is damaged."); }
  if (manifest?.schemaVersion !== 1 || manifest.backendContractVersion !== 1 ||
      manifest.guestBridgeRelativePath !== "backend/project-peer/src/guest-orchestrator-cli.mjs" ||
      !Array.isArray(manifest.files) || manifest.files.length === 0 || manifest.files.length > MAXIMUM_RUNTIME_FILES) {
    fail("Launcher runtime contract is incompatible.");
  }

  const expected = new Map();
  for (const record of manifest.files) {
    if (!record || typeof record.path !== "string" || path.posix.isAbsolute(record.path) ||
        record.path.includes("\\") || record.path.split("/").some((part) => !part || part === "." || part === "..") ||
        !Number.isSafeInteger(record.size) || record.size < 0 || !SHA256.test(record.sha256 ?? "") ||
        expected.has(record.path)) {
      fail("Launcher runtime manifest contains an unsafe file record.");
    }
    const file = path.resolve(root, ...record.path.split("/"));
    if (!file.startsWith(`${root}${path.sep}`)) fail("Launcher runtime file escaped its trusted root.");
    const info = await lstat(file).catch(() => null);
    if (!info?.isFile() || info.isSymbolicLink() || info.size !== record.size || await hashFile(file) !== record.sha256) {
      fail("Launcher runtime file verification failed.");
    }
    expected.set(record.path, record);
  }
  const actual = (await collect(root)).filter((entry) => entry !== "runtime-manifest.json").sort();
  if (actual.length !== expected.size || actual.some((entry) => !expected.has(entry))) {
    fail("Launcher runtime contains a missing or unmanifested file.");
  }
  return { manifest, root };
}

async function main() {
  for (const name of [
    "NODE_OPTIONS", "NODE_PATH", "NPM_CONFIG_PREFIX", "NPM_CONFIG_USERCONFIG", "npm_config_prefix",
    "npm_config_userconfig", "TEAMFORGE_WORKSPACE_ROOT", "TEAMFORGE_NODE_PATH",
  ]) delete process.env[name];
  const verified = await verifyLauncherRuntime(argument("--runtime-root"), argument("--manifest-sha256"));
  process.env.TEAMFORGE_RUNTIME_KIND = "bundled_launcher";
  process.env.TEAMFORGE_RUNTIME_ROOT = verified.root;
  const bridge = path.resolve(verified.root, ...verified.manifest.guestBridgeRelativePath.split("/"));
  const module = await import(pathToFileURL(bridge).href);
  if (typeof module.runGuestBridge !== "function") fail("Launcher Guest bridge entry point is incompatible.");
  const launcherRoot = path.dirname(fileURLToPath(import.meta.url));
  await module.runGuestBridge({ forbiddenRoots: [launcherRoot, verified.root] });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stdout.write(`${JSON.stringify({
      id: null,
      event: "error",
      error: {
        code: error?.code === "runtime_verification_failed" ? error.code : "guest_bridge_failed",
        userMessage: "TeamForge의 내부 실행 파일을 확인할 수 없습니다.",
        recoveryAction: "TeamForge를 다시 설치하거나 최신 설치 파일로 복구하세요.",
        technicalDetail: error?.message ?? "Unknown runtime failure.",
      },
    })}\n`);
    process.exitCode = 1;
  });
}
