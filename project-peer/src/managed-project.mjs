import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { DOWNLOAD_STATES, PRODUCT_VERSION, SHA256_PATTERN, UUID_PATTERN } from "./constants.mjs";
import { validateDescriptor } from "./descriptor.mjs";
import { validateManifest } from "./manifest.mjs";
import { normalizeRelativePath, sameSourceIdentity } from "./path-policy.mjs";
import { fail, TeamForgePeerError, throwIfDownloadCancelled } from "./errors.mjs";
import { withProcessBoundLock } from "./process-bound-lock.mjs";
import { assertNoRedirectedDirectorySegments } from "./filesystem-safety.mjs";
import { refuseOrphanActive, verifyOrphanActive } from "./orphan-active.mjs";
import {
  readUnityProjectDescriptor,
  writeUnityProjectDescriptor,
} from "./unity-project-descriptor.mjs";

const CURRENT_POINTER_KEYS = Object.freeze([
  "activatedAtUnixMs",
  "activeRelativePath",
  "baselineRevision",
  "descriptorHash",
  "manifestHash",
  "projectUuid",
  "publisherKeyId",
  "schemaVersion",
]);
const MAXIMUM_METADATA_BYTES = 2_097_152;

function sameCurrentPointer(expected, actual) {
  if (expected === null || actual === null) return expected === actual;
  return CURRENT_POINTER_KEYS.every((key) => expected[key] === actual[key]);
}

function assertReviewedCurrent(expected, actual) {
  if (expected !== undefined && !sameCurrentPointer(expected, actual)) {
    fail("project_update_stale", "The current Project changed during this receive. Review the update again.");
  }
}

// The embedded or referenced TeamForge Package must match this product. It is
// checked on the staged copy BEFORE activation as well as on every validated
// read, so an incompatible revision never replaces a working Active (#651).
async function assertTeamForgePackageCompatible(projectPath, {
  requirePresent = true, readVerifiedMetadata,
} = {}) {
  const packageManifest = JSON.parse(await (readVerifiedMetadata
    ? readVerifiedMetadata("Packages/manifest.json")
    : readFile(path.join(projectPath, "Packages", "manifest.json"), "utf8")));
  const teamForgeDependency = packageManifest?.dependencies?.["com.eunsung.teamforge"];
  const embeddedPackageRelative = "Packages/com.eunsung.teamforge/package.json";
  const embeddedPackagePath = path.join(projectPath, embeddedPackageRelative);
  const embeddedPackage = await (readVerifiedMetadata
    ? readVerifiedMetadata(embeddedPackageRelative)
    : lstat(embeddedPackagePath).then((information) => {
      if (!information.isFile() || information.isSymbolicLink()) {
        fail("active_teamforge_package_invalid", "Embedded TeamForge Package metadata is unsafe.");
      }
      return readFile(embeddedPackagePath, "utf8").catch(() => {
        fail("active_teamforge_package_invalid", "Embedded TeamForge Package metadata is invalid.");
      });
    })).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!teamForgeDependency && embeddedPackage === null) {
    if (!requirePresent) return;
    fail("active_teamforge_package_missing", "Active Project does not contain a TeamForge Package dependency.");
  }
  if (embeddedPackage === null && teamForgeDependency !== PRODUCT_VERSION) {
    fail("active_teamforge_package_incompatible", "TeamForge Package dependency version is incompatible.");
  }
  if (embeddedPackage !== null) {
    let metadata;
    try {
      metadata = JSON.parse(embeddedPackage);
    } catch {
      fail("active_teamforge_package_invalid", "Embedded TeamForge Package metadata is invalid.");
    }
    if (metadata?.name !== "com.eunsung.teamforge" || metadata?.version !== PRODUCT_VERSION) {
      fail("active_teamforge_package_incompatible", "Embedded TeamForge Package version is incompatible.");
    }
  }
}

function assertNewerThanCurrent(descriptor, current) {
  if (current && descriptor.baselineRevision <= current.baselineRevision) {
    fail("project_update_stale", "The Project Baseline is not newer than the current active revision.");
  }
}

function safeProjectDirectory(root, relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const destination = path.resolve(root, ...normalized.split("/"));
  const relative = path.relative(root, destination);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    fail("staging_path_escape", `Manifest path escaped staging: ${relativePath}.`);
  }
  return destination;
}

async function writeJsonAtomic(destination, value, { flush = false } = {}) {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600, flush });
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function exists(destination) {
  try {
    await lstat(destination);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function readBoundedRegular(destination, maximumBytes = MAXIMUM_METADATA_BYTES, { singleLink = false } = {}) {
  let information;
  try {
    information = await lstat(destination, { bigint: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      fail("active_metadata_missing", "Required Active Project metadata is missing.");
    }
    throw error;
  }
  if (!information.isFile() || information.isSymbolicLink() || (singleLink && information.nlink !== 1n) ||
      information.size <= 0n || information.size > BigInt(maximumBytes)) {
    fail("active_metadata_unsafe", "Active Project metadata must be a bounded regular file.");
  }
  // Read through one pinned handle, not a second path lookup after lstat.
  // A file can grow between the size check and readFile(), so cap actual reads.
  const flags = process.platform === "win32" ? "r"
    : fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0);
  const handle = await open(destination, flags);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!sameSourceIdentity(information, opened) || (singleLink && opened.nlink !== 1n)) {
      fail("active_metadata_changed", "Active Project metadata changed while it was being verified.");
    }
    const chunks = [];
    const buffer = Buffer.allocUnsafe(Math.min(65_536, maximumBytes + 1));
    let total = 0;
    while (total <= maximumBytes) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, maximumBytes + 1 - total), null);
      if (bytesRead === 0) break;
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
      total += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const pathAfter = await lstat(destination, { bigint: true });
    if (BigInt(total) !== information.size || !sameSourceIdentity(opened, after) ||
        !sameSourceIdentity(opened, pathAfter) ||
        (singleLink && (after.nlink !== 1n || pathAfter.nlink !== 1n))) {
      fail("active_metadata_changed", "Active Project metadata changed while it was being verified.");
    }
    return Buffer.concat(chunks, total);
  } finally {
    await handle.close();
  }
}

async function activeDirectoryIdentity(directory) {
  const information = await lstat(directory, { bigint: true });
  if (!information.isDirectory() || information.isSymbolicLink()) refuseOrphanActive();
  if (information.ino <= 0n) return null;
  return `${information.dev}:${information.ino}:${information.birthtimeNs}`;
}

async function verifyOrphanIntent(intentPath, activePath, stagingRoot, descriptor, previous) {
  const roots = [path.dirname(intentPath), activePath, stagingRoot];
  for (const directory of roots) {
    await assertNoRedirectedDirectorySegments(directory, {
      code: "active_revision_exists",
      message: "Existing Active revision or its activation record uses a redirected path. Its files have been preserved.",
    });
  }
  let intent;
  try {
    intent = JSON.parse((await readBoundedRegular(intentPath, 16_384, { singleLink: true })).toString("utf8"));
  } catch (error) {
    if (error instanceof SyntaxError || ["ENOENT", "ELOOP", "active_metadata_missing",
      "active_metadata_unsafe", "active_metadata_changed"].includes(error.code)) refuseOrphanActive();
    throw error;
  }
  if (intent?.schemaVersion !== 1 || intent.descriptorHash !== descriptor.descriptorHash ||
      intent.manifestHash !== descriptor.manifestHash || intent.baselineRevision !== descriptor.baselineRevision ||
      typeof intent.downloadId !== "string" || !UUID_PATTERN.test(intent.downloadId) ||
      (intent.previous !== null && (typeof intent.previous !== "object" ||
        Object.keys(intent.previous).length !== CURRENT_POINTER_KEYS.length ||
        CURRENT_POINTER_KEYS.some((key) => !Object.hasOwn(intent.previous, key)))) ||
      !sameCurrentPointer(intent.previous, previous)) {
    refuseOrphanActive();
  }
  const originalStaging = path.join(stagingRoot, intent.downloadId);
  await assertNoRedirectedDirectorySegments(originalStaging, {
    code: "active_revision_exists",
    message: "The interrupted activation staging path is redirected. Its files have been preserved.",
  });
  const identity = await activeDirectoryIdentity(activePath);
  if (identity === null || identity !== intent.rootIdentity ||
      !(await exists(originalStaging)) ||
      await exists(path.join(originalStaging, "project"))) {
    refuseOrphanActive();
  }
  return intent.downloadId;
}

async function assertSafeTree(root, maximumEntries = 1_000_000) {
  const pending = [root];
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    const information = await lstat(current).catch((error) => {
      if (error.code === "ENOENT") fail("active_project_changed", "Active Project changed during verification.");
      throw error;
    });
    if (information.isSymbolicLink() || (!information.isDirectory() && !information.isFile())) {
      fail("active_project_reparse_point", "Active Project contains a link or unsupported filesystem object.");
    }
    visited += 1;
    if (visited > maximumEntries) {
      fail("active_project_too_large", "Active Project contains too many filesystem entries to verify safely.");
    }
    if (information.isDirectory()) {
      for (const name of await readdir(current)) pending.push(path.join(current, name));
    }
  }
}

export class ManagedProjectStore {
  constructor({ managedRoot, projectUuid, chunkStore }) {
    if (!UUID_PATTERN.test(projectUuid ?? "") || !chunkStore || typeof chunkStore.read !== "function") {
      fail("invalid_managed_project", "Managed root, Project UUID, and ChunkStore are required.");
    }
    this.projectUuid = projectUuid.toLowerCase();
    this.root = path.resolve(managedRoot, this.projectUuid);
    this.activeRoot = path.join(this.root, "active");
    this.stagingRoot = path.join(this.root, "staging");
    this.metadataRoot = path.join(this.root, "metadata");
    this.currentPath = path.join(this.metadataRoot, "current.json");
    this.activationLockPath = path.join(this.metadataRoot, "activation.lock");
    this.chunkStore = chunkStore;
  }

  async initialize() {
    await Promise.all([
      mkdir(this.activeRoot, { recursive: true }),
      mkdir(this.stagingRoot, { recursive: true }),
      mkdir(this.metadataRoot, { recursive: true }),
    ]);
  }

  async retainFailure({ state = DOWNLOAD_STATES.DirectTransferUnavailable, descriptor = null, details = {} }) {
    await this.initialize();
    const downloadId = randomUUID();
    const stagingPath = path.join(this.stagingRoot, downloadId);
    await mkdir(stagingPath, { recursive: false });
    await this.#writeStatus(stagingPath, state, {
      downloadId,
      baselineRevision: descriptor?.baselineRevision ?? null,
      manifestHash: descriptor?.manifestHash ?? "",
      ...details,
    });
    if (descriptor) {
      await writeJsonAtomic(path.join(stagingPath, "descriptor.json"), descriptor);
    }
    return stagingPath;
  }

  async current() {
    try {
      const current = JSON.parse((await readBoundedRegular(this.currentPath, 65_536)).toString("utf8"));
      if (!current || typeof current !== "object" || Array.isArray(current) ||
          current.projectUuid !== this.projectUuid ||
          !Number.isSafeInteger(current.baselineRevision) || current.baselineRevision < 1 ||
          typeof current.manifestHash !== "string" ||
          typeof current.activeRelativePath !== "string") {
        fail("invalid_current_pointer", "Managed current pointer is invalid.");
      }
      const activePath = safeProjectDirectory(this.root, current.activeRelativePath);
      if (!activePath.startsWith(`${this.activeRoot}${path.sep}`) || !(await exists(activePath))) {
        fail("invalid_current_pointer", "Managed current pointer does not reference an existing active revision.");
      }
      return { ...current, activePath };
    } catch (error) {
      if (error.code === "active_metadata_missing") {
        return null;
      }
      throw error;
    }
  }

  async validatedCurrent() {
    let pointer;
    try {
      pointer = JSON.parse((await readBoundedRegular(this.currentPath, 65_536)).toString("utf8"));
    } catch (error) {
      if (error.code === "active_metadata_missing") return null;
      if (error instanceof SyntaxError) {
        fail("invalid_current_pointer", "Managed current pointer is not valid JSON.");
      }
      throw error;
    }
    if (!pointer || typeof pointer !== "object" || Array.isArray(pointer) ||
        JSON.stringify(Object.keys(pointer).sort()) !== JSON.stringify([...CURRENT_POINTER_KEYS].sort()) ||
        pointer.schemaVersion !== 1 || pointer.projectUuid !== this.projectUuid ||
        !Number.isSafeInteger(pointer.baselineRevision) || pointer.baselineRevision < 1 ||
        !SHA256_PATTERN.test(pointer.manifestHash ?? "") ||
        !SHA256_PATTERN.test(pointer.descriptorHash ?? "") ||
        !SHA256_PATTERN.test(pointer.publisherKeyId ?? "") ||
        !Number.isSafeInteger(pointer.activatedAtUnixMs) || pointer.activatedAtUnixMs < 1) {
      fail("invalid_current_pointer", "Managed current pointer is invalid.");
    }
    const activeName = `${pointer.baselineRevision}-${pointer.manifestHash.slice(0, 12)}`;
    if (pointer.activeRelativePath !== `active/${activeName}`) {
      fail("invalid_current_pointer", "Managed current pointer does not use the content-bound Active path.");
    }
    const activePath = safeProjectDirectory(this.root, pointer.activeRelativePath);
    await assertNoRedirectedDirectorySegments(activePath, {
      code: "active_project_reparse_point",
      message: "Managed Active Project path contains a redirected segment.",
    });
    for (const directory of [this.root, this.activeRoot, activePath]) {
      const information = await lstat(directory).catch((error) => {
        if (error.code === "ENOENT") fail("invalid_current_pointer", "Managed Active Project is missing.");
        throw error;
      });
      if (!information.isDirectory() || information.isSymbolicLink()) {
        fail("active_project_reparse_point", "Managed Active Project path contains a link.");
      }
    }
    for (const relative of ["Assets", "Packages", "ProjectSettings"]) {
      await assertSafeTree(path.join(activePath, relative));
    }

    let descriptor;
    let manifest;
    try {
      descriptor = JSON.parse((await readBoundedRegular(
        path.join(this.metadataRoot, "descriptors", `${pointer.descriptorHash}.json`),
      )).toString("utf8"));
      manifest = JSON.parse((await readBoundedRegular(
        path.join(this.metadataRoot, "manifests", `${pointer.manifestHash}.json`),
      )).toString("utf8"));
    } catch (error) {
      if (error instanceof SyntaxError) {
        fail("active_metadata_invalid", "Signed Active Project metadata is not valid JSON.");
      }
      throw error;
    }
    validateDescriptor(descriptor, {
      expectedProjectUuid: this.projectUuid,
      expectedManifestHash: pointer.manifestHash,
    });
    validateManifest(manifest, {
      expectedProjectUuid: this.projectUuid,
      expectedManifestHash: pointer.manifestHash,
    });
    if (descriptor.descriptorHash !== pointer.descriptorHash ||
        descriptor.baselineRevision !== pointer.baselineRevision ||
        descriptor.publisherKeyId !== pointer.publisherKeyId ||
        manifest.baselineRevision !== pointer.baselineRevision) {
      fail("active_metadata_mismatch", "Active pointer and signed Baseline metadata do not exactly match.");
    }
    await this.#verifyUnityProject(activePath, descriptor, manifest);
    const unityDescriptor = await readUnityProjectDescriptor(activePath, {
      expectedProjectUuid: this.projectUuid,
      expectedUnityVersion: descriptor.unityVersion,
      required: true,
    });
    if (unityDescriptor.descriptor.baselineRevision !== pointer.baselineRevision ||
        unityDescriptor.descriptor.manifestHash !== pointer.manifestHash ||
        unityDescriptor.descriptor.descriptorHash !== pointer.descriptorHash) {
      fail("active_descriptor_mismatch", "Active Unity descriptor does not match the signed Baseline.");
    }

    await assertTeamForgePackageCompatible(activePath);
    return {
      ...pointer,
      activePath,
      descriptor,
      manifest,
      unityVersion: descriptor.unityVersion,
    };
  }

  async #writeStatus(stagingPath, state, details = {}) {
    await writeJsonAtomic(path.join(stagingPath, "status.json"), {
      state,
      projectUuid: this.projectUuid,
      updatedAtUnixMs: Date.now(),
      ...details,
    });
  }

  async #materialize(projectPath, manifest, signal) {
    throwIfDownloadCancelled(signal);
    await mkdir(projectPath, { recursive: false });
    await mkdir(path.join(projectPath, "Assets"), { recursive: true });
    for (const file of manifest.files) {
      throwIfDownloadCancelled(signal);
      const destination = safeProjectDirectory(projectPath, file.path);
      await mkdir(path.dirname(destination), { recursive: true });
      const handle = await open(destination, "wx", file.executable ? 0o755 : 0o644);
      const fileHasher = createHash("sha256");
      let position = 0;
      try {
        for (const chunk of file.chunks) {
          throwIfDownloadCancelled(signal);
          const bytes = await this.chunkStore.read(chunk.hash, chunk.size);
          throwIfDownloadCancelled(signal);
          fileHasher.update(bytes);
          let written = 0;
          while (written < bytes.length) {
            const result = await handle.write(bytes, written, bytes.length - written, position + written);
            written += result.bytesWritten;
          }
          position += bytes.length;
        }
        await handle.sync();
      } finally {
        await handle.close();
      }
      throwIfDownloadCancelled(signal);
      if (position !== file.size || fileHasher.digest("hex") !== file.fileHash) {
        fail("file_verification_failed", `Reassembled file failed verification: ${file.path}.`);
      }
      if (file.executable) {
        await chmod(destination, 0o755).catch(() => {});
      }
    }
  }

  async #verifyUnityProject(projectPath, descriptor, manifest,
    readMetadata = (relativePath) => readFile(path.join(projectPath, relativePath), "utf8")) {
    const required = new Set([
      "Packages/manifest.json",
      "Packages/packages-lock.json",
      "ProjectSettings/ProjectVersion.txt",
    ]);
    for (const file of manifest.files) {
      required.delete(file.path);
    }
    if (required.size > 0) {
      fail("invalid_unity_project", `Baseline is missing required Unity files: ${Array.from(required).join(", ")}.`);
    }
    let packageManifest;
    let packageLock;
    try {
      packageManifest = JSON.parse(await readMetadata("Packages/manifest.json"));
      packageLock = JSON.parse(await readMetadata("Packages/packages-lock.json"));
    } catch (error) {
      if (error instanceof SyntaxError) {
        fail("invalid_unity_packages", "Unity Packages metadata is not valid JSON.");
      }
      fail("invalid_unity_packages", `Unity Packages metadata is invalid: ${error.message}`);
    }
    if ([packageManifest, packageLock].some(value =>
      !value || typeof value !== "object" || Array.isArray(value))) {
      fail("invalid_unity_packages", "Unity Packages metadata must contain JSON objects.");
    }
    const projectVersion = await readMetadata("ProjectSettings/ProjectVersion.txt");
    const editorVersion = projectVersion.match(/^m_EditorVersion:\s*([^\s]+)$/m)?.[1];
    if (!editorVersion || editorVersion !== descriptor.unityVersion) {
      fail(
        "unity_version_mismatch",
        `ProjectVersion ${editorVersion ?? "missing"} does not match descriptor ${descriptor.unityVersion}.`,
      );
    }
  }

  async activate({ descriptor, manifest, trustApproval, sourcePeers = [], signal = undefined,
    expectedCurrent = undefined, verifyActivationPublication = undefined,
    onActivationCommitStart = undefined }) {
    throwIfDownloadCancelled(signal);
    await this.initialize();
    throwIfDownloadCancelled(signal);
    validateDescriptor(descriptor, {
      expectedProjectUuid: this.projectUuid,
      expectedManifestHash: manifest.manifestHash,
    });
    validateManifest(manifest, {
      expectedProjectUuid: this.projectUuid,
      expectedManifestHash: descriptor.manifestHash,
    });
    if (manifest.baselineRevision !== descriptor.baselineRevision) {
      fail("baseline_revision_mismatch", "Descriptor and manifest baseline revisions differ.");
    }
    const existingCurrent = await this.current();
    throwIfDownloadCancelled(signal);
    assertReviewedCurrent(expectedCurrent, existingCurrent);
    if (existingCurrent?.manifestHash === manifest.manifestHash &&
        existingCurrent.baselineRevision === descriptor.baselineRevision) {
      return { state: DOWNLOAD_STATES.Complete, alreadyActive: true, ...existingCurrent };
    }
    // Ordinary activation only moves forward, whether or not a UI review
    // supplied expectedCurrent. Rollback is a separate recovery action (#651).
    assertNewerThanCurrent(descriptor, existingCurrent);

    const activeName = `${descriptor.baselineRevision}-${descriptor.manifestHash.slice(0, 12)}`;
    const activePath = path.join(this.activeRoot, activeName);
    const intentPath = path.join(this.metadataRoot, `activation-${activeName}.json`);
    let orphan;
    let orphanDownloadId;
    if (await exists(activePath)) {
      orphanDownloadId = await verifyOrphanIntent(intentPath, activePath, this.stagingRoot, descriptor, existingCurrent);
      orphan = await verifyOrphanActive({ activePath, descriptor, manifest, signal });
    }
    throwIfDownloadCancelled(signal);

    const downloadId = randomUUID();
    const stagingPath = path.join(this.stagingRoot, downloadId);
    const stagedProjectPath = path.join(stagingPath, "project");
    await mkdir(stagingPath, { recursive: false });
    await this.#writeStatus(stagingPath, DOWNLOAD_STATES.Verifying, {
      downloadId,
      baselineRevision: descriptor.baselineRevision,
      manifestHash: descriptor.manifestHash,
      sourcePeers,
    });
    try {
      if (!orphan) await this.#materialize(stagedProjectPath, manifest, signal);
      const verifiedProjectPath = orphan ? activePath : stagedProjectPath;
      await this.#verifyUnityProject(verifiedProjectPath, descriptor, manifest, orphan?.readVerifiedMetadata);
      // A missing package stays a launch-time (validatedCurrent) refusal; a
      // present but incompatible one must not replace the working Active.
      await assertTeamForgePackageCompatible(verifiedProjectPath, {
        requirePresent: false,
        readVerifiedMetadata: orphan?.readVerifiedMetadata,
      });
      throwIfDownloadCancelled(signal);
      if (!orphan) {
        await writeUnityProjectDescriptor({
          projectRoot: stagedProjectPath,
          baselineDescriptor: descriptor,
          expectedDigest: null,
        });
      }
      await writeJsonAtomic(path.join(stagingPath, "descriptor.json"), descriptor);
      await writeJsonAtomic(path.join(stagingPath, "manifest.json"), manifest);

      const trustSummary = {
        projectId: descriptor.projectId,
        projectUuid: descriptor.projectUuid,
        baselineRevision: descriptor.baselineRevision,
        manifestHash: descriptor.manifestHash,
        ownerKeyId: descriptor.ownerKeyId,
        publisherKeyId: descriptor.publisherKeyId,
        publisherFingerprint: descriptor.publisherKeyId,
        containsScripts: manifest.files.some((file) => file.script),
        containsPackages: manifest.files.some((file) => file.kind === "package"),
        sourcePeers,
        totalFiles: manifest.totalFiles,
        totalBytes: manifest.totalBytes,
      };
      await this.#writeStatus(stagingPath, DOWNLOAD_STATES.AwaitingTrust, { downloadId, ...trustSummary });
      throwIfDownloadCancelled(signal);
      const approved = typeof trustApproval === "function" && await trustApproval(trustSummary);
      throwIfDownloadCancelled(signal);
      if (!approved) {
        return {
          state: DOWNLOAD_STATES.AwaitingTrust,
          approved: false,
          stagingPath,
          trustSummary,
        };
      }

      await this.#writeStatus(stagingPath, DOWNLOAD_STATES.Activating, { downloadId, ...trustSummary });
      // The lock is released by the OS if this process dies, so a killed
      // activation no longer blocks every retry (#648).
      return await withProcessBoundLock(this.activationLockPath, async () => {
        // Mandatory compare-and-swap under the activation lock: the pointer
        // must still be exactly what this attempt observed before its trust
        // and staging awaits. expectedCurrent, when given, already equals it.
        const lockedCurrent = await this.current();
        assertReviewedCurrent(existingCurrent, lockedCurrent);
        assertNewerThanCurrent(descriptor, lockedCurrent);
        if (orphan) {
          const originalDownloadId = await verifyOrphanIntent(
            intentPath, activePath, this.stagingRoot, descriptor, lockedCurrent,
          );
          if (originalDownloadId !== orphanDownloadId) refuseOrphanActive();
          await orphan.checkUnchanged(signal);
        } else {
          if (await exists(activePath)) refuseOrphanActive();
          // Record exactly which staged directory this lock holder may move.
          // Keep the record across rename/pointer errors so a fresh review can
          // recognize that directory after process exit. Never adopt by name alone.
          const rootIdentity = await activeDirectoryIdentity(stagedProjectPath);
          if (rootIdentity === null) {
            // Filesystems that do not expose file IDs can still receive a
            // Project, but cannot prove which directory was moved on retry.
            await rm(intentPath, { force: true });
          } else {
            const previous = lockedCurrent === null ? null : Object.fromEntries(
              CURRENT_POINTER_KEYS.map((key) => [key, lockedCurrent[key]]),
            );
            await writeJsonAtomic(intentPath, {
              schemaVersion: 1,
              downloadId,
              rootIdentity,
              previous,
              descriptorHash: descriptor.descriptorHash,
              manifestHash: descriptor.manifestHash,
              baselineRevision: descriptor.baselineRevision,
            }, { flush: true });
          }
          if (await exists(activePath)) refuseOrphanActive();
        }
        const pointer = {
          schemaVersion: 1,
          projectUuid: this.projectUuid,
          baselineRevision: descriptor.baselineRevision,
          manifestHash: descriptor.manifestHash,
          descriptorHash: descriptor.descriptorHash,
          publisherKeyId: descriptor.publisherKeyId,
          activeRelativePath: `active/${activeName}`,
          activatedAtUnixMs: Date.now(),
        };
        // Keep these synchronous checks at the boundary before the project
        // move or pointer commit. Once it starts, finish despite cancellation.
        throwIfDownloadCancelled(signal);
        verifyActivationPublication?.();
        onActivationCommitStart?.();
        if (!orphan) await rename(stagedProjectPath, activePath);
        await writeJsonAtomic(this.currentPath, pointer);
        await rm(intentPath, { force: true }).catch(() => {});
        await this.#writeStatus(stagingPath, DOWNLOAD_STATES.Complete, {
          downloadId,
          activeRelativePath: pointer.activeRelativePath,
        });
        return { state: DOWNLOAD_STATES.Complete, activePath, stagingPath, ...pointer };
      }, { busyCode: "activation_busy", busyMessage: "Another Project activation is already in progress." });
    } catch (error) {
      await this.#writeStatus(stagingPath, DOWNLOAD_STATES.Rejected, {
        downloadId,
        code: error.code ?? "activation_failed",
        message: error.message,
      }).catch(() => {});
      if (error instanceof TeamForgePeerError) {
        error.details = { ...(error.details ?? {}), stagingPath };
      }
      throw error;
    }
  }
}
