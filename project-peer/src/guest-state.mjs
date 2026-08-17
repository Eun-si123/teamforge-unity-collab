import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PRODUCT_VERSION, UUID_PATTERN } from "./constants.mjs";
import { fail } from "./errors.mjs";
import {
  assertNoRedirectedDirectorySegments,
  assertOrdinaryLocalPathSyntax,
  canonicalizeThroughExistingDirectory,
} from "./filesystem-safety.mjs";

export const GUEST_CORE_STATE_DIRECTORY = "guest-core";
export const GUEST_STATE_MARKER = ".teamforge-guest-state.json";
const GUEST_STATE_FORMAT = "teamforge-guest-state-v1";
const ALLOWED_ENTRIES = new Set([GUEST_STATE_MARKER, "handoff", "trust"]);

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." &&
    !path.isAbsolute(relative));
}

function validateAbsoluteRoot(value) {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.length > 4_096 ||
      /[\u0000-\u001f\u007f]/u.test(value)) {
    fail("invalid_guest_state_root", "Launcher state root must be a bounded absolute path.");
  }
  assertOrdinaryLocalPathSyntax(value, {
    code: "unsafe_guest_state_root",
    message: "Launcher state must use an ordinary local drive without reserved or ambiguous segments.",
  });
  const resolved = path.resolve(value);
  if (resolved === path.parse(resolved).root) {
    fail("unsafe_guest_state_root", "A filesystem root cannot be used for Launcher state.");
  }
  return resolved;
}

async function information(destination) {
  try { return await lstat(destination); } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function assertRealDirectory(destination, code) {
  const info = await information(destination);
  if (!info) return null;
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail(code, "Launcher state must use real directories, not redirected paths.");
  }
  return info;
}

function validateMarker(value) {
  const keys = ["createdAtUnixMs", "format", "productVersion", "rootId", "schemaVersion"];
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(keys) || value.schemaVersion !== 1 ||
      value.format !== GUEST_STATE_FORMAT || value.productVersion !== PRODUCT_VERSION ||
      !UUID_PATTERN.test(value.rootId ?? "") || value.rootId !== value.rootId.toLowerCase() ||
      !Number.isSafeInteger(value.createdAtUnixMs) || value.createdAtUnixMs < 1) {
    fail("invalid_guest_state_marker", "Guest state ownership marker is invalid.");
  }
  return value;
}

export async function inspectGuestStateRoot({ stateRoot, forbiddenRoots = [], destinationRoot = "" }) {
  const requestedLauncherRoot = validateAbsoluteRoot(stateRoot);
  await assertNoRedirectedDirectorySegments(requestedLauncherRoot, {
    code: "unsafe_guest_state_root",
    message: "Launcher state contains a redirected or non-directory path segment.",
  });
  const launcherRoot = await canonicalizeThroughExistingDirectory(requestedLauncherRoot, {
    code: "unsafe_guest_state_root",
    message: "Launcher state must resolve through safe real local directories.",
  });
  const guestRoot = path.join(launcherRoot, GUEST_CORE_STATE_DIRECTORY);
  for (const other of [...forbiddenRoots, destinationRoot].filter(Boolean)) {
    if (typeof other !== "string" || !path.isAbsolute(other)) {
      fail("invalid_forbidden_root", "Protected roots must be absolute paths.");
    }
    assertOrdinaryLocalPathSyntax(other, {
      code: "invalid_forbidden_root",
      message: "Protected roots must use ordinary local paths.",
    });
    const protectedRoot = await canonicalizeThroughExistingDirectory(path.resolve(other), {
      code: "invalid_forbidden_root",
      message: "Protected roots must resolve through safe real directories.",
    });
    if (isInside(protectedRoot, launcherRoot) || isInside(launcherRoot, protectedRoot)) {
      fail("guest_state_root_overlap", "Launcher state must be separate from runtime and Project folders.");
    }
  }
  await assertNoRedirectedDirectorySegments(launcherRoot, {
    code: "unsafe_guest_state_root",
    message: "Launcher state contains a redirected or non-directory path segment.",
  });
  await assertNoRedirectedDirectorySegments(guestRoot, {
    code: "unsafe_guest_state_root",
    message: "Guest state contains a redirected or non-directory path segment.",
  });
  const launcherInfo = await assertRealDirectory(launcherRoot, "unsafe_guest_state_root");
  if (!launcherInfo) return { launcherRoot, guestRoot, state: "available", managed: false };
  const guestInfo = await assertRealDirectory(guestRoot, "unsafe_guest_state_root");
  if (!guestInfo) return { launcherRoot, guestRoot, state: "available", managed: false };
  const markerPath = path.join(guestRoot, GUEST_STATE_MARKER);
  const markerInfo = await information(markerPath);
  const entries = await readdir(guestRoot, { withFileTypes: true });
  if (!markerInfo) {
    if (entries.length !== 0) fail("guest_state_conflict", "Guest state directory contains unmanaged data.");
    return { launcherRoot, guestRoot, state: "available", managed: false };
  }
  if (!markerInfo.isFile() || markerInfo.isSymbolicLink() || markerInfo.size <= 0 || markerInfo.size > 16_384) {
    fail("invalid_guest_state_marker", "Guest state marker is unsafe.");
  }
  let marker;
  try { marker = validateMarker(JSON.parse(await readFile(markerPath, "utf8"))); } catch (error) {
    if (error?.code) throw error;
    fail("invalid_guest_state_marker", "Guest state marker is damaged.");
  }
  for (const entry of entries) {
    if (!ALLOWED_ENTRIES.has(entry.name)) fail("guest_state_conflict", "Guest state contains unmanaged data.");
    if (entry.name !== GUEST_STATE_MARKER && (!entry.isDirectory() || entry.isSymbolicLink())) {
      fail("unsafe_guest_state_root", "Guest state contains a redirected path.");
    }
  }
  return { launcherRoot, guestRoot, state: "managed", managed: true, marker };
}

export async function prepareGuestStateRoot(options) {
  let inspected = await inspectGuestStateRoot(options);
  if (inspected.managed) return inspected;
  await mkdir(inspected.guestRoot, { recursive: true });
  inspected = await inspectGuestStateRoot(options);
  if (inspected.managed) return inspected;
  const marker = {
    schemaVersion: 1,
    format: GUEST_STATE_FORMAT,
    productVersion: PRODUCT_VERSION,
    rootId: randomUUID().toLowerCase(),
    createdAtUnixMs: Date.now(),
  };
  const destination = path.join(inspected.guestRoot, GUEST_STATE_MARKER);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(marker, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  let installed = false;
  try {
    await link(temporary, destination);
    installed = true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  } finally {
    await rm(temporary, { force: true });
  }
  try {
    return await inspectGuestStateRoot(options);
  } catch (error) {
    if (installed) await rm(destination, { force: true }).catch(() => {});
    throw error;
  }
}
