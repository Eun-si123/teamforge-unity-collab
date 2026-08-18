// Filesystem trust-boundary helpers for Project transfer/activation paths.
// These functions intentionally reject redirected, non-canonical, or unusual
// path layouts instead of trying to normalize them into something usable.
// Do not weaken these checks as a convenience fix without matching path-safety
// tests, especially on Windows where reparse/UNC/reserved-name behavior differs.
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { fail } from "./errors.mjs";

const WINDOWS_LOCAL_ROOT = /^[A-Za-z]:\\$/u;
const WINDOWS_RESERVED_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const WINDOWS_INVALID_SEGMENT = /[<>:"|?*]/u;

// Syntactic Windows gate: transfer destinations must be ordinary local-drive
// paths with segments that Windows will not reinterpret or alias unexpectedly.
export function assertOrdinaryLocalPathSyntax(destination, {
  code = "unsafe_filesystem_path",
  message = "Filesystem path must use an ordinary local drive.",
} = {}) {
  if (process.platform !== "win32") return destination;
  const windowsPath = String(destination ?? "").replaceAll("/", "\\");
  const parsed = path.win32.parse(windowsPath);
  const pathForSegments = windowsPath.length > parsed.root.length && windowsPath.endsWith("\\")
    ? windowsPath.slice(0, -1)
    : windowsPath;
  const remainder = pathForSegments.slice(parsed.root.length);
  const segments = remainder ? remainder.split("\\") : [];
  if (!WINDOWS_LOCAL_ROOT.test(parsed.root) || windowsPath.startsWith("\\\\") ||
      segments.some((segment) => !segment || /[. ]$/u.test(segment) ||
        WINDOWS_RESERVED_SEGMENT.test(segment) || WINDOWS_INVALID_SEGMENT.test(segment))) {
    fail(code, message);
  }
  return destination;
}

// Resolve only through ancestors that already exist and are real directories.
// Missing descendants are appended after the trusted canonical ancestor so a
// symlink/reparse-like existing segment cannot redirect a future destination.
export async function canonicalizeThroughExistingDirectory(destination, {
  code = "unsafe_filesystem_path",
  message = "Filesystem path contains an unsafe existing ancestor.",
} = {}) {
  if (typeof destination !== "string" || !path.isAbsolute(destination)) fail(code, message);
  const resolved = path.resolve(destination);
  const missing = [];
  let current = resolved;
  while (true) {
    let information;
    try {
      information = await lstat(current);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) fail(code, message);
      missing.push(path.basename(current));
      current = parent;
      continue;
    }
    if (!information.isDirectory() || information.isSymbolicLink()) fail(code, message);
    const canonical = await realpath(current);
    return path.resolve(canonical, ...missing.reverse());
  }
}

// Walk every existing segment without following links. The first missing
// segment ends the check because later segments do not exist yet; callers must
// still create/use the resulting path under their normal containment policy.
export async function assertNoRedirectedDirectorySegments(destination, {
  code = "unsafe_filesystem_path",
  message = "Filesystem path contains a redirected or non-directory segment.",
} = {}) {
  if (typeof destination !== "string" || !path.isAbsolute(destination)) {
    fail(code, message);
  }
  const resolved = path.resolve(destination);
  const parsed = path.parse(resolved);
  const relative = resolved.slice(parsed.root.length);
  const segments = relative.split(path.sep).filter(Boolean);
  let current = parsed.root;
  const candidates = [current];
  for (const segment of segments) {
    current = path.join(current, segment);
    candidates.push(current);
  }
  for (const candidate of candidates) {
    let information;
    try {
      information = await lstat(candidate);
    } catch (error) {
      if (error.code === "ENOENT") return resolved;
      throw error;
    }
    if (!information.isDirectory() || information.isSymbolicLink()) {
      fail(code, message);
    }
  }
  return resolved;
}