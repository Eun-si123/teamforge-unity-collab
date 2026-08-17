import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fail } from "./errors.mjs";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const WINDOWS_ABSOLUTE = /^(?:[a-zA-Z]:[\\/]|\\\\|\/\/)/;
const WINDOWS_DRIVE_PREFIX = /^[a-zA-Z]:/;
const URI_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const WINDOWS_INVALID_SEGMENT_CHARACTERS = /[<>:"|?*]/u;
const WINDOWS_RESERVED_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const EXCLUDED_DIRECTORY_NAMES = new Set([
  "library", "temp", "logs", "obj", "usersettings", ".git", ".vs", ".idea",
  ".vscode", "build", "builds", "crash", "crashes", "memorycaptures",
  "recordings", "artifacts", "node_modules", ".secrets", "secrets",
]);
const EXCLUDED_FILE_NAMES = new Set([
  ".ds_store", "thumbs.db", "desktop.ini", "teamforgeproject.json",
]);
const EXCLUDED_FILE_PATTERNS = [
  /^\.env(?:\..*)?$/i,
  /^~\$/,
  /(?:^|\.)tmp$/i,
  /(?:^|\.)temp$/i,
  /\.dmp$/i,
  /\.crash$/i,
  /\.stackdump$/i,
  /\.pfx$/i,
  /\.p12$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.token$/i,
  /^credentials(?:\..*)?$/i,
  /^(?:teamforge-)?owner-key(?:\..*)?\.json$/i,
  /(?:^|[-_.])(?:bearer|auth|transfer|server)[-_]?(?:token|secret)(?:[-_.]|$)/i,
];
const SCRIPT_EXTENSIONS = new Set([
  ".cs", ".js", ".mjs", ".cjs", ".ts", ".py", ".sh", ".bash", ".ps1",
  ".bat", ".cmd", ".exe", ".dll", ".so", ".dylib", ".asmdef", ".asmref", ".rsp",
]);

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function requireRegularFile(filePath, code, label) {
  const info = await lstat(filePath).catch((error) => {
    if (error.code === "ENOENT") {
      fail(code, `${label} is required and was not found.`);
    }
    throw error;
  });
  if (!info.isFile() || info.isSymbolicLink()) {
    fail(code, `${label} must be a regular file and cannot be a symbolic link or junction.`);
  }
  return info;
}

async function requireJsonObject(filePath, code, label) {
  let value;
  try {
    value = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    fail(code, `${label} is not valid JSON: ${error.message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(code, `${label} must contain a JSON object.`);
  }
  return value;
}

async function assertContainedRealPath(absoluteRoot, canonicalRoot, candidate, label) {
  const resolved = path.resolve(candidate);
  if (!isInside(absoluteRoot, resolved) || resolved === absoluteRoot) {
    fail("external_local_package", `${label} resolves outside the project root and cannot be transferred.`);
  }
  const relative = path.relative(absoluteRoot, resolved);
  let current = absoluteRoot;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    const info = await lstat(current).catch((error) => {
      if (error.code === "ENOENT") {
        fail("invalid_embedded_package", `${label} does not exist inside the project root.`);
      }
      throw error;
    });
    if (info.isSymbolicLink()) {
      fail("symlink_rejected", `${label} traverses a symbolic link or junction: ${current}`);
    }
  }
  const canonicalCandidate = await realpath(resolved);
  if (!isInside(canonicalRoot, canonicalCandidate) || canonicalCandidate === canonicalRoot) {
    fail("external_local_package", `${label} resolves outside the canonical project root.`);
  }
  return resolved;
}

function validatePortableSegment(segment, value) {
  if (WINDOWS_INVALID_SEGMENT_CHARACTERS.test(segment)) {
    fail("non_portable_path", `Project path contains a Windows-invalid character: ${value}`);
  }
  if (/[. ]$/u.test(segment)) {
    fail("non_portable_path", `Project path segments cannot end in a dot or space: ${value}`);
  }
  if (WINDOWS_RESERVED_DEVICE.test(segment)) {
    fail("windows_reserved_path", `Project path uses a reserved Windows device name: ${value}`);
  }
}

export function normalizeRelativePath(value) {
  if (typeof value !== "string" || value.length === 0) {
    fail("invalid_path", "Project path must be a non-empty string.");
  }
  if (CONTROL_CHARACTERS.test(value)) {
    fail("invalid_path_control", "Project path cannot contain control characters.");
  }
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || WINDOWS_ABSOLUTE.test(value)) {
    fail("absolute_path_rejected", `Absolute project path is not allowed: ${value}`);
  }
  if (value.includes("\\")) {
    fail("backslash_path_rejected", `Project paths must use '/' separators: ${value}`);
  }
  const portable = value;
  if (portable.normalize("NFC") !== portable) {
    fail("non_nfc_path", `Project path must already be Unicode NFC: ${value}`);
  }
  const segments = portable.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    fail("path_traversal_rejected", `Project path has an unsafe segment: ${value}`);
  }
  for (const segment of segments) {
    validatePortableSegment(segment, value);
  }
  return segments.join("/");
}

function normalizeFilesystemRelativePath(value) {
  return normalizeRelativePath(value.split(path.sep).join("/"));
}

function localPackageReferenceSegments(value) {
  if (typeof value !== "string" || value.length === 0 || CONTROL_CHARACTERS.test(value) ||
      path.posix.isAbsolute(value) || path.win32.isAbsolute(value) ||
      WINDOWS_ABSOLUTE.test(value) || WINDOWS_DRIVE_PREFIX.test(value) || URI_SCHEME.test(value)) {
    fail("external_local_package", "Local package reference must be a portable relative path.");
  }
  const portable = value.replaceAll("\\", "/");
  if (portable.normalize("NFC") !== portable) {
    fail("non_nfc_path", `Local package reference must already be Unicode NFC: ${value}`);
  }
  const segments = portable.split("/");
  if (segments.some((segment) => segment.length === 0)) {
    fail("path_traversal_rejected", `Local package reference has an empty segment: ${value}`);
  }
  for (const segment of segments) {
    if (segment !== "." && segment !== "..") {
      validatePortableSegment(segment, value);
    }
  }
  return segments;
}

function shouldExclude(relativePath, isDirectory, allowLockedRuntimeDependency = false) {
  const segments = relativePath.split("/");
  if (segments.some((segment) =>
    (EXCLUDED_DIRECTORY_NAMES.has(segment.toLowerCase()) &&
      !(allowLockedRuntimeDependency && segment.toLowerCase() === "node_modules")) ||
      /^\.env(?:\..*)?$/iu.test(segment))) {
    return true;
  }
  if (isDirectory) {
    return false;
  }
  const name = segments.at(-1);
  return EXCLUDED_FILE_NAMES.has(name.toLowerCase()) ||
    EXCLUDED_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

async function rejectOwnerPrivateKeyContent(absolutePath, relativePath) {
  if (path.extname(relativePath).toLowerCase() !== ".json") {
    return;
  }
  const markers = {
    privateKey: false,
    publicKey: false,
    keyId: false,
  };
  let tail = "";
  for await (const chunk of createReadStream(absolutePath, { encoding: "utf8" })) {
    const source = `${tail}${chunk}`;
    markers.privateKey ||= /"privateKey"\s*:/u.test(source);
    markers.publicKey ||= /"publicKey"\s*:/u.test(source);
    markers.keyId ||= /"keyId"\s*:/u.test(source);
    if (markers.privateKey && markers.publicKey && markers.keyId) {
      fail(
        "secret_file_rejected",
        `A JSON file matching the TeamForge Owner identity shape cannot be transferred: ${relativePath}`,
      );
    }
    tail = source.slice(-128);
  }
}

function fileKind(relativePath) {
  if (relativePath === "Packages/manifest.json" || relativePath === "Packages/packages-lock.json") {
    return "package";
  }
  if (relativePath.startsWith("Packages/")) {
    return "package";
  }
  if (relativePath.startsWith("ProjectSettings/")) {
    return "projectSettings";
  }
  return "asset";
}

function isScript(relativePath) {
  return SCRIPT_EXTENSIONS.has(path.posix.extname(relativePath).toLowerCase());
}

async function localPackageRoots(projectRoot, manifestPath) {
  let source;
  try {
    source = await readFile(manifestPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch (error) {
    fail("invalid_packages_manifest", `Packages/manifest.json is not valid JSON: ${error.message}`);
  }

  const roots = [];
  for (const [packageName, specification] of Object.entries(manifest.dependencies ?? {})) {
    if (typeof specification !== "string" || !specification.startsWith("file:")) {
      continue;
    }
    let localReference;
    try {
      localReference = decodeURIComponent(specification.slice("file:".length));
    } catch {
      fail("invalid_local_package", `Local package ${packageName} has invalid URL encoding.`);
    }
    if (!localReference || localReference.includes("?") || localReference.includes("#")) {
      fail("invalid_local_package", `Local package ${packageName} has an unsafe file reference.`);
    }
    let referenceSegments;
    try {
      referenceSegments = localPackageReferenceSegments(localReference);
    } catch (error) {
      fail(
        "external_local_package",
        `Local package ${packageName} has an unsafe or traversing file reference and cannot be transferred.`,
        { packageName, specification, reason: error.code ?? "invalid_path" },
      );
    }
    const absolute = path.resolve(path.dirname(manifestPath), ...referenceSegments);
    if (!isInside(projectRoot, absolute) || absolute === projectRoot) {
      fail(
        "external_local_package",
        `Local package ${packageName} resolves outside the project root and cannot be transferred.`,
        { packageName, specification },
      );
    }
    try {
      normalizeFilesystemRelativePath(path.relative(projectRoot, absolute));
    } catch (error) {
      fail(
        "external_local_package",
        `Local package ${packageName} resolves to a non-portable project path.`,
        { packageName, specification, reason: error.code ?? "invalid_path" },
      );
    }
    roots.push({ absolutePath: absolute, packageName, source: "file" });
  }
  return roots;
}

async function readPackageIdentity(packageRoot, fallbackName, source) {
  const rootInfo = await lstat(packageRoot).catch((error) => {
    if (error.code === "ENOENT") {
      fail(
        "invalid_embedded_package",
        `Local package ${fallbackName} does not exist.`,
        { packageName: fallbackName, source },
      );
    }
    throw error;
  });
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    fail(
      "invalid_embedded_package",
      `Local package ${fallbackName} must be a real directory.`,
      { packageName: fallbackName, source },
    );
  }
  const packageJsonPath = path.join(packageRoot, "package.json");
  const info = await lstat(packageJsonPath).catch((error) => {
    if (error.code === "ENOENT") {
      fail(
        "invalid_embedded_package",
        `Local package ${fallbackName} is missing package.json.`,
        { packageName: fallbackName, source },
      );
    }
    throw error;
  });
  if (!info.isFile() || info.isSymbolicLink()) {
    fail(
      "invalid_embedded_package",
      `Local package ${fallbackName} must have a regular package.json file.`,
      { packageName: fallbackName, source },
    );
  }
  let value;
  try {
    value = JSON.parse(await readFile(packageJsonPath, "utf8"));
  } catch (error) {
    fail(
      "invalid_embedded_package",
      `Local package ${fallbackName} has invalid package.json: ${error.message}`,
      { packageName: fallbackName, source },
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      typeof value.name !== "string" || value.name.trim().length === 0 || value.name.length > 214 ||
      typeof value.version !== "string" || value.version.trim().length === 0 || value.version.length > 128 ||
      CONTROL_CHARACTERS.test(value.name) || CONTROL_CHARACTERS.test(value.version)) {
    fail(
      "invalid_embedded_package",
      `Local package ${fallbackName} package.json must declare a safe name and version.`,
      { packageName: fallbackName, source },
    );
  }
  return {
    absolutePath: packageRoot,
    name: value.name.trim(),
    version: value.version.trim(),
    source,
  };
}

async function embeddedPackageRoots(projectRoot) {
  const packagesRoot = path.join(projectRoot, "Packages");
  const entries = await readdir(packagesRoot, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  const result = [];
  for (const entry of entries) {
    if (entry.name === "manifest.json" || entry.name === "packages-lock.json" || entry.name.endsWith(".meta")) {
      continue;
    }
    const candidate = path.join(packagesRoot, entry.name);
    if (entry.isSymbolicLink()) {
      fail("symlink_rejected", `Symbolic links and junctions are not transferable: ${candidate}`);
    }
    if (!entry.isDirectory()) {
      continue;
    }
    const packageJson = path.join(candidate, "package.json");
    const packageJsonInfo = await lstat(packageJson).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!packageJsonInfo) {
      continue;
    }
    result.push({ absolutePath: candidate, packageName: entry.name, source: "embedded" });
  }
  return result;
}

export async function discoverProjectContent(projectRoot) {
  const absoluteRoot = path.resolve(projectRoot);
  const rootInfo = await lstat(absoluteRoot).catch((error) => {
    fail("project_root_unavailable", `Project root is unavailable: ${error.message}`);
  });
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    fail("invalid_project_root", "Project root must be a real directory, not a symbolic link.");
  }
  const canonicalRoot = await realpath(absoluteRoot);
  if (canonicalRoot !== absoluteRoot && process.platform !== "win32") {
    fail("project_root_alias", "Project root must not resolve through a symbolic-link alias.");
  }

  const packageManifest = path.join(absoluteRoot, "Packages", "manifest.json");
  const packageLock = path.join(absoluteRoot, "Packages", "packages-lock.json");
  await requireRegularFile(packageManifest, "required_packages_manifest_missing", "Packages/manifest.json");
  await requireRegularFile(packageLock, "required_packages_lock_missing", "Packages/packages-lock.json");
  await assertContainedRealPath(absoluteRoot, canonicalRoot, packageManifest, "Packages/manifest.json");
  await assertContainedRealPath(absoluteRoot, canonicalRoot, packageLock, "Packages/packages-lock.json");
  await requireJsonObject(packageLock, "invalid_packages_lock", "Packages/packages-lock.json");
  const localRoots = await localPackageRoots(absoluteRoot, packageManifest);
  const embeddedRoots = await embeddedPackageRoots(absoluteRoot);
  const packageRoots = new Map();
  for (const candidate of [...localRoots, ...embeddedRoots]) {
    const resolved = path.resolve(candidate.absolutePath);
    let entry = packageRoots.get(resolved);
    if (!entry) {
      entry = {
        absolutePath: resolved,
        sources: new Set(),
        declaredNames: new Set(),
        fallbackName: candidate.packageName ?? path.basename(resolved),
      };
      packageRoots.set(resolved, entry);
    }
    entry.sources.add(candidate.source);
    if (candidate.source === "file" && candidate.packageName) {
      entry.declaredNames.add(candidate.packageName);
    }
  }
  for (const candidate of packageRoots.values()) {
    candidate.absolutePath = await assertContainedRealPath(
      absoluteRoot,
      canonicalRoot,
      candidate.absolutePath,
      `Local package ${candidate.fallbackName}`,
    );
    const identity = await readPackageIdentity(
      candidate.absolutePath,
      candidate.fallbackName,
      Array.from(candidate.sources).sort().join("+"),
    );
    if (candidate.declaredNames.size > 1 ||
        (candidate.declaredNames.size === 1 && !candidate.declaredNames.has(identity.name))) {
      fail(
        "embedded_package_collision",
        `Package dependency name does not match package.json for ${candidate.fallbackName}.`,
      );
    }
    candidate.name = identity.name;
    candidate.version = identity.version;
    candidate.source = candidate.sources.has("embedded") ? "embedded" : "file";
  }
  const packageNames = new Map();
  for (const candidate of packageRoots.values()) {
    const existing = packageNames.get(candidate.name.toLowerCase());
    if (existing && existing.absolutePath !== candidate.absolutePath) {
      fail(
        "embedded_package_collision",
        `Package name '${candidate.name}' resolves to more than one project path.`,
      );
    }
    packageNames.set(candidate.name.toLowerCase(), candidate);
  }
  const roots = [
    path.join(absoluteRoot, "Assets"),
    path.join(absoluteRoot, "ProjectSettings"),
    packageManifest,
    packageLock,
    ...Array.from(packageRoots.values()).flatMap((candidate) => [
      candidate.absolutePath,
      `${candidate.absolutePath}.meta`,
    ]),
  ];

  const discovered = new Map();
  const caseFolded = new Map();
  const visitedRoots = new Set();
  const lockedRuntimeDependencyPrefixes = Array.from(packageRoots.values())
    .filter((candidate) => candidate.name === "com.eunsung.teamforge")
    .flatMap((candidate) => ["server", "project-peer"].map((target) =>
      normalizeFilesystemRelativePath(path.relative(
        absoluteRoot,
        path.join(candidate.absolutePath, "Runtime~", "backend", target, "node_modules", "ws"),
      ))));
  const isLockedRuntimeDependencyPath = (relative) => lockedRuntimeDependencyPrefixes.some((prefix) =>
    relative === prefix || relative.startsWith(`${prefix}/`) || prefix.startsWith(`${relative}/`));

  async function addFile(absolute, info) {
    const relative = normalizeFilesystemRelativePath(path.relative(absoluteRoot, absolute));
    if (shouldExclude(relative, false, isLockedRuntimeDependencyPath(relative))) {
      return;
    }
    await rejectOwnerPrivateKeyContent(absolute, relative);
    const folded = relative.toLowerCase();
    const collision = caseFolded.get(folded);
    if (collision && collision !== relative) {
      fail("case_collision", `Case-insensitive path collision: '${collision}' and '${relative}'.`);
    }
    caseFolded.set(folded, relative);
    if (!discovered.has(relative)) {
      let kind = fileKind(relative);
      if (kind === "asset") {
        for (const packageRoot of packageRoots.values()) {
          if (isInside(packageRoot.absolutePath, absolute)) {
            kind = "package";
            break;
          }
        }
      }
      discovered.set(relative, {
        absolutePath: absolute,
        path: relative,
        kind,
        executable: (info.mode & 0o111) !== 0,
        script: isScript(relative),
      });
    }
  }

  async function walk(absolute) {
    const info = await lstat(absolute).catch((error) => {
      if (error.code === "ENOENT") {
        return null;
      }
      throw error;
    });
    if (!info) {
      return;
    }
    if (info.isSymbolicLink()) {
      fail("symlink_rejected", `Symbolic links and junctions are not transferable: ${absolute}`);
    }
    if (!isInside(absoluteRoot, absolute)) {
      fail("path_escape", `Discovered path escaped the project root: ${absolute}`);
    }
    const relativeRaw = path.relative(absoluteRoot, absolute);
    if (relativeRaw) {
      const relative = normalizeFilesystemRelativePath(relativeRaw);
      if (shouldExclude(relative, info.isDirectory(), isLockedRuntimeDependencyPath(relative))) {
        return;
      }
    }
    if (info.isFile()) {
      await addFile(absolute, info);
      return;
    }
    if (!info.isDirectory()) {
      fail("special_file_rejected", `Only regular files and directories are transferable: ${absolute}`);
    }
    const entries = await readdir(absolute);
    entries.sort((left, right) => left.localeCompare(right, "en"));
    for (const entry of entries) {
      await walk(path.join(absolute, entry));
    }
  }

  for (const root of roots) {
    const resolved = path.resolve(root);
    if (visitedRoots.has(resolved)) {
      continue;
    }
    visitedRoots.add(resolved);
    await walk(resolved);
  }

  const files = Array.from(discovered.values()).sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const embeddedPackages = Array.from(packageRoots.values())
    .filter((candidate) => candidate.source === "embedded")
    .map((candidate) => ({
      name: candidate.name,
      version: candidate.version,
      path: normalizeFilesystemRelativePath(path.relative(absoluteRoot, candidate.absolutePath)),
    }))
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  for (const embedded of embeddedPackages) {
    const packageJsonPath = `${embedded.path}/package.json`;
    if (!discovered.has(packageJsonPath)) {
      fail(
        "embedded_package_missing_from_manifest",
        `Embedded package ${embedded.name} is missing from the discovered project files.`,
        { packageName: embedded.name, packagePath: embedded.path },
      );
    }
  }
  return { files, embeddedPackages };
}

export async function discoverProjectFiles(projectRoot) {
  return (await discoverProjectContent(projectRoot)).files;
}

export const PATH_POLICY_DEFAULTS = Object.freeze({
  excludedDirectories: Array.from(EXCLUDED_DIRECTORY_NAMES).sort(),
  excludedFiles: Array.from(EXCLUDED_FILE_NAMES).sort(),
});
