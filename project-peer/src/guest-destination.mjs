import { randomUUID } from "node:crypto";
import {
  lstat,
  link,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { PRODUCT_VERSION, UUID_PATTERN } from "./constants.mjs";
import { fail } from "./errors.mjs";
import {
  assertNoRedirectedDirectorySegments,
  assertOrdinaryLocalPathSyntax,
  canonicalizeThroughExistingDirectory,
} from "./filesystem-safety.mjs";

export const GUEST_MANAGED_ROOT_MARKER = ".teamforge-managed-root.json";
export const GUEST_MANAGED_ROOT_FORMAT = "teamforge-guest-managed-root-v1";

const MARKER_KEYS = Object.freeze([
  "createdAtUnixMs",
  "format",
  "productVersion",
  "rootId",
  "schemaVersion",
]);
const MAXIMUM_MARKER_BYTES = 16_384;

function exactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." &&
    !path.isAbsolute(relative));
}

function validateDestinationText(destinationRoot) {
  if (typeof destinationRoot !== "string" || destinationRoot.trim().length === 0 ||
      destinationRoot.length > 4_096 || /[\u0000-\u001f\u007f]/u.test(destinationRoot)) {
    fail("invalid_guest_destination", "A bounded destination directory is required.");
  }
  if (!path.isAbsolute(destinationRoot)) {
    fail("invalid_guest_destination", "Guest destination must be an absolute path.");
  }
  assertOrdinaryLocalPathSyntax(destinationRoot, {
    code: "unsafe_guest_destination",
    message: "Guest destination must use an ordinary local drive without reserved or ambiguous segments.",
  });
  const resolved = path.resolve(destinationRoot);
  if (resolved === path.parse(resolved).root) {
    fail("unsafe_guest_destination", "A filesystem root cannot be used as a Guest destination.");
  }
  return resolved;
}

async function assertOutsideForbiddenRoots(destination, forbiddenRoots) {
  for (const candidate of forbiddenRoots ?? []) {
    if (typeof candidate !== "string" || !path.isAbsolute(candidate)) {
      fail("invalid_forbidden_root", "Protected runtime roots must be absolute paths.");
    }
    assertOrdinaryLocalPathSyntax(candidate, {
      code: "invalid_forbidden_root",
      message: "Protected runtime roots must use ordinary local paths.",
    });
    const protectedRoot = await canonicalizeThroughExistingDirectory(path.resolve(candidate), {
      code: "invalid_forbidden_root",
      message: "Protected runtime roots must resolve through safe real directories.",
    });
    if (isInside(protectedRoot, destination) || isInside(destination, protectedRoot)) {
      fail(
        "destination_overlaps_runtime",
        "Guest projects cannot be stored inside or around the trusted TeamForge runtime.",
      );
    }
  }
}

async function pathInformation(destination) {
  try {
    return await lstat(destination);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function assertDirectoryNotLink(destination, code = "unsafe_guest_destination") {
  const information = await pathInformation(destination);
  if (!information) return null;
  if (!information.isDirectory() || information.isSymbolicLink()) {
    fail(code, "Guest destination must be a real directory, not a file or link.");
  }
  return information;
}

function validateMarker(marker) {
  if (!exactKeys(marker, MARKER_KEYS) || marker.schemaVersion !== 1 ||
      marker.format !== GUEST_MANAGED_ROOT_FORMAT || marker.productVersion !== PRODUCT_VERSION ||
      !UUID_PATTERN.test(marker.rootId ?? "") || marker.rootId !== marker.rootId.toLowerCase() ||
      !Number.isSafeInteger(marker.createdAtUnixMs) || marker.createdAtUnixMs < 1) {
    fail("invalid_guest_destination_marker", "TeamForge destination ownership marker is invalid.");
  }
  return marker;
}

async function readMarker(destination) {
  const markerPath = path.join(destination, GUEST_MANAGED_ROOT_MARKER);
  const information = await pathInformation(markerPath);
  if (!information) return null;
  if (!information.isFile() || information.isSymbolicLink() ||
      information.size <= 0 || information.size > MAXIMUM_MARKER_BYTES) {
    fail("invalid_guest_destination_marker", "TeamForge destination marker must be a bounded regular file.");
  }
  let marker;
  try {
    marker = JSON.parse(await readFile(markerPath, "utf8"));
  } catch {
    fail("invalid_guest_destination_marker", "TeamForge destination marker is damaged.");
  }
  return validateMarker(marker);
}

async function validateManagedEntries(destination) {
  const projects = [];
  for (const entry of await readdir(destination, { withFileTypes: true })) {
    if (entry.name === GUEST_MANAGED_ROOT_MARKER) continue;
    if (!UUID_PATTERN.test(entry.name) || entry.name !== entry.name.toLowerCase() ||
        !entry.isDirectory() || entry.isSymbolicLink()) {
      fail(
        "destination_contains_unmanaged_content",
        "The selected TeamForge destination contains content that is not managed by TeamForge.",
      );
    }
    const projectRoot = path.join(destination, entry.name);
    await assertDirectoryNotLink(projectRoot, "destination_contains_unmanaged_content");
    await assertDirectoryNotLink(path.join(projectRoot, "metadata"), "destination_contains_unmanaged_content");
    const metadataPath = path.join(projectRoot, "metadata", "project.json");
    const information = await pathInformation(metadataPath);
    if (!information || !information.isFile() || information.isSymbolicLink() || information.size > 65_536) {
      fail("destination_contains_unmanaged_content", "A managed Project identity is missing or unsafe.");
    }
    let metadata;
    try {
      metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    } catch {
      fail("destination_contains_unmanaged_content", "A managed Project identity is damaged.");
    }
    if (metadata?.schemaVersion !== 1 || metadata?.productVersion !== PRODUCT_VERSION ||
        metadata?.projectUuid !== entry.name || typeof metadata?.projectId !== "string" ||
        metadata.projectId.trim().length === 0 || metadata.projectId.length > 128) {
      fail("destination_contains_unmanaged_content", "A managed Project identity is incompatible.");
    }
    projects.push({ projectId: metadata.projectId, projectUuid: metadata.projectUuid });
  }
  projects.sort((left, right) => left.projectUuid.localeCompare(right.projectUuid, "en"));
  return projects;
}

export async function inspectGuestDestination({ destinationRoot, forbiddenRoots = [] }) {
  const requestedDestination = validateDestinationText(destinationRoot);
  await assertNoRedirectedDirectorySegments(requestedDestination, {
    code: "unsafe_guest_destination",
    message: "Guest destination contains a redirected or non-directory path segment.",
  });
  const destination = await canonicalizeThroughExistingDirectory(requestedDestination, {
    code: "unsafe_guest_destination",
    message: "Guest destination must resolve through safe real local directories.",
  });
  await assertOutsideForbiddenRoots(destination, forbiddenRoots);
  await assertNoRedirectedDirectorySegments(destination, {
    code: "unsafe_guest_destination",
    message: "Guest destination contains a redirected or non-directory path segment.",
  });
  const information = await assertDirectoryNotLink(destination);
  if (!information) {
    return { destination, state: "available", managed: false, projects: [] };
  }
  const marker = await readMarker(destination);
  const entries = await readdir(destination);
  if (!marker) {
    if (entries.length !== 0) {
      fail(
        "destination_contains_unmanaged_content",
        "Select an empty folder or an existing TeamForge Projects folder.",
      );
    }
    return { destination, state: "available", managed: false, projects: [] };
  }
  const projects = await validateManagedEntries(destination);
  return { destination, state: "managed", managed: true, marker, projects };
}

export async function prepareGuestDestination({ destinationRoot, forbiddenRoots = [] }) {
  let inspected = await inspectGuestDestination({ destinationRoot, forbiddenRoots });
  const destination = inspected.destination;
  if (!inspected.managed) {
    await mkdir(destination, { recursive: true });
    inspected = await inspectGuestDestination({ destinationRoot: destination, forbiddenRoots });
    if (!inspected.managed) {
      const marker = {
        schemaVersion: 1,
        format: GUEST_MANAGED_ROOT_FORMAT,
        productVersion: PRODUCT_VERSION,
        rootId: randomUUID().toLowerCase(),
        createdAtUnixMs: Date.now(),
      };
      const markerPath = path.join(destination, GUEST_MANAGED_ROOT_MARKER);
      const temporary = `${markerPath}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(marker, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      let installed = false;
      try {
        await link(temporary, markerPath);
        installed = true;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      } finally {
        await rm(temporary, { force: true });
      }
      try {
        inspected = await inspectGuestDestination({ destinationRoot: destination, forbiddenRoots });
      } catch (error) {
        if (installed) await rm(markerPath, { force: true }).catch(() => {});
        throw error;
      }
    }
  }
  return inspected;
}
