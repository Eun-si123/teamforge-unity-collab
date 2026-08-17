import { createHash, randomUUID } from "node:crypto";
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
import { normalizeRelativePath } from "./path-policy.mjs";
import { fail, TeamForgePeerError } from "./errors.mjs";
import { assertNoRedirectedDirectorySegments } from "./filesystem-safety.mjs";
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

function safeProjectDirectory(root, relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const destination = path.resolve(root, ...normalized.split("/"));
  const relative = path.relative(root, destination);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    fail("staging_path_escape", `Manifest path escaped staging: ${relativePath}.`);
  }
  return destination;
}

async function writeJsonAtomic(destination, value, mode = 0o600) {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode });
  try {
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
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

async function readBoundedRegular(destination, maximumBytes = MAXIMUM_METADATA_BYTES) {
  let information;
  try {
    information = await lstat(destination);
  } catch (error) {
    if (error.code === "ENOENT") {
      fail("active_metadata_missing", "Required Active Project metadata is missing.");
    }
    throw error;
  }
  if (!information.isFile() || information.isSymbolicLink() ||
      information.size <= 0 || information.size > maximumBytes) {
    fail("active_metadata_unsafe", "Active Project metadata must be a bounded regular file.");
  }
  const bytes = await readFile(destination);
  if (bytes.length !== information.size) {
    fail("active_metadata_changed", "Active Project metadata changed while it was being verified.");
  }
  return bytes;
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
      const current = JSON.parse(await readFile(this.currentPath, "utf8"));
      if (current.projectUuid !== this.projectUuid ||
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
      if (error.code === "ENOENT") {
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

    const packageManifest = JSON.parse(await readFile(path.join(activePath, "Packages", "manifest.json"), "utf8"));
    const teamForgeDependency = packageManifest?.dependencies?.["com.eunsung.teamforge"];
    const embeddedPackagePath = path.join(activePath, "Packages", "com.eunsung.teamforge", "package.json");
    const embeddedPackageInformation = await lstat(embeddedPackagePath).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!teamForgeDependency && !embeddedPackageInformation) {
      fail("active_teamforge_package_missing", "Active Project does not contain a TeamForge Package dependency.");
    }
    if (!embeddedPackageInformation && teamForgeDependency !== PRODUCT_VERSION) {
      fail("active_teamforge_package_incompatible", "TeamForge Package dependency version is incompatible.");
    }
    if (embeddedPackageInformation) {
      if (!embeddedPackageInformation.isFile() || embeddedPackageInformation.isSymbolicLink()) {
        fail("active_teamforge_package_invalid", "Embedded TeamForge Package metadata is unsafe.");
      }
      let embeddedPackage;
      try {
        embeddedPackage = JSON.parse(await readFile(embeddedPackagePath, "utf8"));
      } catch {
        fail("active_teamforge_package_invalid", "Embedded TeamForge Package metadata is invalid.");
      }
      if (embeddedPackage?.name !== "com.eunsung.teamforge" || embeddedPackage?.version !== PRODUCT_VERSION) {
        fail("active_teamforge_package_incompatible", "Embedded TeamForge Package version is incompatible.");
      }
    }
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

  async #materialize(projectPath, manifest) {
    await mkdir(projectPath, { recursive: false });
    await mkdir(path.join(projectPath, "Assets"), { recursive: true });
    for (const file of manifest.files) {
      const destination = safeProjectDirectory(projectPath, file.path);
      await mkdir(path.dirname(destination), { recursive: true });
      const handle = await open(destination, "wx", file.executable ? 0o755 : 0o644);
      const fileHasher = createHash("sha256");
      let position = 0;
      try {
        for (const chunk of file.chunks) {
          const bytes = await this.chunkStore.read(chunk.hash, chunk.size);
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
      if (position !== file.size || fileHasher.digest("hex") !== file.fileHash) {
        fail("file_verification_failed", `Reassembled file failed verification: ${file.path}.`);
      }
      if (file.executable) {
        await chmod(destination, 0o755).catch(() => {});
      }
    }
  }

  async #verifyUnityProject(projectPath, descriptor, manifest) {
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
    try {
      JSON.parse(await readFile(path.join(projectPath, "Packages", "manifest.json"), "utf8"));
      JSON.parse(await readFile(path.join(projectPath, "Packages", "packages-lock.json"), "utf8"));
    } catch (error) {
      fail("invalid_unity_packages", `Unity Packages metadata is invalid: ${error.message}`);
    }
    const projectVersion = await readFile(
      path.join(projectPath, "ProjectSettings", "ProjectVersion.txt"),
      "utf8",
    );
    const editorVersion = projectVersion.match(/^m_EditorVersion:\s*([^\s]+)$/m)?.[1];
    if (!editorVersion || editorVersion !== descriptor.unityVersion) {
      fail(
        "unity_version_mismatch",
        `ProjectVersion ${editorVersion ?? "missing"} does not match descriptor ${descriptor.unityVersion}.`,
      );
    }
  }

  async activate({ descriptor, manifest, trustApproval, sourcePeers = [] }) {
    await this.initialize();
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
    if (existingCurrent?.manifestHash === manifest.manifestHash &&
        existingCurrent.baselineRevision === descriptor.baselineRevision) {
      return { state: DOWNLOAD_STATES.Complete, alreadyActive: true, ...existingCurrent };
    }

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
      await this.#materialize(stagedProjectPath, manifest);
      await this.#verifyUnityProject(stagedProjectPath, descriptor, manifest);
      await writeUnityProjectDescriptor({
        projectRoot: stagedProjectPath,
        baselineDescriptor: descriptor,
        expectedDigest: null,
      });
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
      if (typeof trustApproval !== "function" || !(await trustApproval(trustSummary))) {
        return {
          state: DOWNLOAD_STATES.AwaitingTrust,
          approved: false,
          stagingPath,
          trustSummary,
        };
      }

      await this.#writeStatus(stagingPath, DOWNLOAD_STATES.Activating, { downloadId, ...trustSummary });
      const lock = await open(this.activationLockPath, "wx", 0o600).catch((error) => {
        if (error.code === "EEXIST") {
          fail("activation_busy", "Another Project activation is already in progress.");
        }
        throw error;
      });
      const activeName = `${descriptor.baselineRevision}-${descriptor.manifestHash.slice(0, 12)}`;
      const activePath = path.join(this.activeRoot, activeName);
      try {
        if (await exists(activePath)) {
          fail("active_revision_exists", `Refusing to overwrite existing active revision ${activeName}.`);
        }
        await rename(stagedProjectPath, activePath);
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
        await writeJsonAtomic(this.currentPath, pointer);
        await this.#writeStatus(stagingPath, DOWNLOAD_STATES.Complete, {
          downloadId,
          activeRelativePath: pointer.activeRelativePath,
        });
        return { state: DOWNLOAD_STATES.Complete, activePath, stagingPath, ...pointer };
      } finally {
        await lock.close();
        await rm(this.activationLockPath, { force: true });
      }
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
