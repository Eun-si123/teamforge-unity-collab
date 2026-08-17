import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { ChunkStore } from "./content-store.mjs";
import { buildManifest, uniqueManifestChunks, validateManifest } from "./manifest.mjs";
import {
  createDescriptor,
  createOwnerProof,
  validateDescriptor,
} from "./descriptor.mjs";
import {
  generateIdentity,
  loadIdentity,
  saveIdentity,
} from "./identity.mjs";
import { createInvite, loadInvite, saveInvite, validateInvite } from "./invite.mjs";
import { createBootstrapInvite } from "./bootstrap-invite.mjs";
import { DirectTransferServer, createTransferToken } from "./direct-transfer-server.mjs";
import { DirectTransferClient } from "./direct-transfer-client.mjs";
import { SwarmDownloader } from "./swarm-downloader.mjs";
import {
  PROJECT_TRANSFER_SOURCE_CONTRACT,
  assertProjectTransferSource,
  transferSourceErrorInfo,
} from "./transfer-source.mjs";
import { ManagedProjectStore } from "./managed-project.mjs";
import { CoordinatorClient } from "./coordinator-client.mjs";
import { DOWNLOAD_STATES, PRODUCT_VERSION, UUID_PATTERN } from "./constants.mjs";
import {
  assertUnityProjectDescriptorUnchanged,
  readUnityProjectDescriptor,
  writeUnityProjectDescriptor,
} from "./unity-project-descriptor.mjs";
import { fail, TeamForgePeerError } from "./errors.mjs";
import {
  LEGACY_CONNECTION_DEFAULTS,
  LEGACY_TRANSFER_DEFAULTS,
} from "./policy-profile.mjs";

async function exists(filePath) {
  try {
    await open(filePath, "r").then((handle) => handle.close());
    return true;
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") {
      return error.code === "EISDIR";
    }
    throw error;
  }
}

export function endpointWithAdvertisedHost(boundEndpoint, advertisedHost) {
  if (advertisedHost === undefined) return boundEndpoint;
  if (typeof advertisedHost !== "string" || advertisedHost.trim() !== advertisedHost ||
      advertisedHost.length === 0 || advertisedHost.length > 253 ||
      /[\u0000-\u001f\u007f]/u.test(advertisedHost)) {
    fail("invalid_peer_endpoint", "Advertised direct-transfer host is invalid.");
  }
  const authority = isIP(advertisedHost) === 6 ? `[${advertisedHost}]` : advertisedHost;
  let hostUrl;
  let endpoint;
  try {
    hostUrl = new URL(`http://${authority}/`);
    endpoint = new URL(boundEndpoint);
  } catch {
    fail("invalid_peer_endpoint", "Advertised direct-transfer host is invalid.");
  }
  if (hostUrl.username || hostUrl.password || hostUrl.port || hostUrl.pathname !== "/" ||
      hostUrl.search || hostUrl.hash || hostUrl.hostname === "0.0.0.0" ||
      hostUrl.hostname === "[::]") {
    fail("invalid_peer_endpoint", "Advertised direct-transfer host must be a reachable host, not a bind wildcard.");
  }
  endpoint.hostname = hostUrl.hostname;
  return endpoint.toString();
}

async function writeJsonAtomic(destination, value) {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  try {
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function writeJsonContentAddressed(destination, value) {
  await mkdir(path.dirname(destination), { recursive: true });
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  try {
    await writeFile(destination, serialized, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }
    if (await readFile(destination, "utf8") !== serialized) {
      fail("metadata_hash_collision", `Content-addressed metadata differs at ${destination}.`);
    }
  }
}

async function readUnityVersion(projectRoot) {
  const source = await readFile(
    path.join(path.resolve(projectRoot), "ProjectSettings", "ProjectVersion.txt"),
    "utf8",
  ).catch((error) => {
    fail("unity_project_version_missing", `Could not read ProjectVersion.txt: ${error.message}`);
  });
  const version = source.match(/^m_EditorVersion:\s*([^\s]+)$/m)?.[1];
  if (!version || !/^6000\.3\.\d+f\d+$/u.test(version)) {
    fail("unsupported_unity_version", "Project must record a Unity 6000.3.x LTS Editor version.");
  }
  return version;
}

export class ProjectPeerEngine {
  constructor({ managedRoot }) {
    if (typeof managedRoot !== "string" || managedRoot.trim().length === 0) {
      fail("invalid_managed_root", "Managed project root is required.");
    }
    this.managedRoot = path.resolve(managedRoot);
  }

  projectRoot(projectUuid) {
    if (!UUID_PATTERN.test(projectUuid ?? "")) {
      fail("invalid_project_uuid", "Project UUID is invalid.");
    }
    return path.join(this.managedRoot, projectUuid.toLowerCase());
  }

  metadataRoot(projectUuid) {
    return path.join(this.projectRoot(projectUuid), "metadata");
  }

  publishedPointerPath(projectUuid) {
    return path.join(this.metadataRoot(projectUuid), "published.json");
  }

  async publishedBaseline(projectUuid) {
    const destination = this.publishedPointerPath(projectUuid);
    if (!(await exists(destination))) {
      return null;
    }
    const pointer = JSON.parse(await readFile(destination, "utf8"));
    if (!pointer || pointer.schemaVersion !== 1 || pointer.projectUuid !== projectUuid ||
        !Number.isSafeInteger(pointer.baselineRevision) || pointer.baselineRevision < 1 ||
        !/^[0-9a-f]{64}$/u.test(pointer.manifestHash ?? "") ||
        !/^[0-9a-f]{64}$/u.test(pointer.descriptorHash ?? "") ||
        !/^[0-9a-f]{64}$/u.test(pointer.ownerKeyId ?? "") ||
        !Number.isSafeInteger(pointer.approvedAtUnixMs) || pointer.approvedAtUnixMs < 1) {
      fail("invalid_published_pointer", "Managed published Baseline pointer is invalid.");
    }
    return pointer;
  }

  async #markPublished(publication, { allowForwardJump = false } = {}) {
    const { project, descriptor } = publication;
    validateDescriptor(descriptor, { expectedProjectId: project.projectId, expectedProjectUuid: project.projectUuid });
    const lockPath = path.join(this.metadataRoot(project.projectUuid), "published.lock");
    await mkdir(path.dirname(lockPath), { recursive: true });
    const lock = await open(lockPath, "wx", 0o600).catch((error) => {
      if (error.code === "EEXIST") {
        fail("published_pointer_busy", "Another approved Baseline pointer update is in progress.");
      }
      throw error;
    });
    try {
      const existing = await this.publishedBaseline(project.projectUuid);
      if (existing?.descriptorHash === descriptor.descriptorHash &&
          existing.manifestHash === descriptor.manifestHash &&
          existing.baselineRevision === descriptor.baselineRevision) {
        return existing;
      }
      if (existing && (descriptor.baselineRevision <= existing.baselineRevision ||
          (!allowForwardJump && descriptor.baselineRevision !== existing.baselineRevision + 1))) {
        fail("published_pointer_conflict", "Refusing a downgrade or gap in the approved Baseline pointer.");
      }
      if (!existing && !allowForwardJump && descriptor.baselineRevision !== 1) {
        fail("published_pointer_gap", "The first locally approved Baseline pointer must be revision 1.");
      }
      const pointer = {
        schemaVersion: 1,
        projectUuid: project.projectUuid,
        baselineRevision: descriptor.baselineRevision,
        manifestHash: descriptor.manifestHash,
        descriptorHash: descriptor.descriptorHash,
        ownerKeyId: descriptor.ownerKeyId,
        approvedAtUnixMs: Date.now(),
      };
      await writeJsonAtomic(this.publishedPointerPath(project.projectUuid), pointer);
      return pointer;
    } finally {
      await lock.close();
      await rm(lockPath, { force: true });
    }
  }

  async findProject(projectId) {
    await mkdir(this.managedRoot, { recursive: true });
    for (const entry of await readdir(this.managedRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !UUID_PATTERN.test(entry.name)) {
        continue;
      }
      try {
        const metadata = JSON.parse(await readFile(
          path.join(this.managedRoot, entry.name, "metadata", "project.json"),
          "utf8",
        ));
        if (metadata.schemaVersion !== 1 || metadata.productVersion !== PRODUCT_VERSION ||
            metadata.projectUuid !== entry.name || metadata.projectUuid !== metadata.projectUuid.toLowerCase() ||
            typeof metadata.projectId !== "string" || metadata.projectId.trim().length === 0 ||
            metadata.projectId.length > 128 || !Number.isSafeInteger(metadata.createdAtUnixMs)) {
          fail("invalid_project_metadata", `Managed Project metadata is invalid for ${entry.name}.`);
        }
        if (metadata.projectId === projectId) {
          return metadata;
        }
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
    }
    return null;
  }

  async ensureProject({ projectId, projectUuid = undefined }) {
    if (typeof projectId !== "string" || projectId.trim().length === 0 || projectId.length > 128 ||
        /[\u0000-\u001f\u007f]/u.test(projectId)) {
      fail("invalid_project_id", "Project ID is invalid.");
    }
    const existing = await this.findProject(projectId.trim());
    if (existing) {
      if (projectUuid && existing.projectUuid !== projectUuid.toLowerCase()) {
        fail("project_uuid_conflict", "Stored Project UUID conflicts with the requested identity.");
      }
      return existing;
    }
    const identity = (projectUuid ?? randomUUID()).toLowerCase();
    if (!UUID_PATTERN.test(identity)) {
      fail("invalid_project_uuid", "Project UUID is invalid.");
    }
    const metadata = {
      schemaVersion: 1,
      productVersion: PRODUCT_VERSION,
      projectId: projectId.trim(),
      projectUuid: identity,
      createdAtUnixMs: Date.now(),
    };
    const destination = path.join(this.metadataRoot(identity), "project.json");
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, `${JSON.stringify(metadata, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    return metadata;
  }

  ownerKeyPath(projectUuid) {
    return path.join(this.metadataRoot(projectUuid), "private", "owner-key.json");
  }

  async #ownerEvidence(projectUuid, sourceDescriptor = null) {
    const metadataRoot = this.metadataRoot(projectUuid);
    const evidence = [];
    let expectedOwnerKeyId = "";
    if (sourceDescriptor?.baselineRevision > 0) {
      evidence.push("published_source_descriptor");
    }
    const invitePath = path.join(metadataRoot, "invite.json");
    if (await exists(invitePath)) {
      const invite = await loadInvite(invitePath);
      expectedOwnerKeyId = invite.ownerKeyId;
      evidence.push("signed_invite");
    }
    const descriptorDirectory = path.join(metadataRoot, "descriptors");
    for (const name of await readdir(descriptorDirectory).catch(() => [])) {
      if (!name.endsWith(".json")) {
        continue;
      }
      const descriptor = validateDescriptor(JSON.parse(await readFile(path.join(descriptorDirectory, name), "utf8")));
      if (descriptor.projectUuid !== projectUuid) {
        fail("project_uuid_conflict", "Stored Baseline descriptor belongs to another Project UUID.");
      }
      if (expectedOwnerKeyId && expectedOwnerKeyId !== descriptor.ownerKeyId) {
        fail("owner_key_conflict", "Stored Project evidence disagrees about the Owner key.");
      }
      expectedOwnerKeyId = descriptor.ownerKeyId;
      evidence.push("signed_baseline_descriptor");
      break;
    }
    if (await exists(path.join(metadataRoot, "current.json"))) {
      evidence.push("active_baseline_pointer");
    }
    const activeEntries = await readdir(path.join(this.projectRoot(projectUuid), "active")).catch(() => []);
    if (activeEntries.length > 0) {
      evidence.push("active_baseline");
    }
    return { evidence, expectedOwnerKeyId };
  }

  async ensureOwnerIdentity(projectUuid, label = "TeamForge Project Owner", {
    sourceDescriptor = null,
    expectedOwnerKeyId = "",
    identityPath = undefined,
  } = {}) {
    const keyPath = this.ownerKeyPath(projectUuid);
    const evidence = await this.#ownerEvidence(projectUuid, sourceDescriptor);
    const anchoredKeyId = expectedOwnerKeyId || evidence.expectedOwnerKeyId;
    if (expectedOwnerKeyId && evidence.expectedOwnerKeyId &&
        expectedOwnerKeyId !== evidence.expectedOwnerKeyId) {
      fail("owner_key_conflict", "Coordinator and local evidence disagree about the Owner key.");
    }
    if (await exists(keyPath)) {
      const identity = await loadIdentity(keyPath);
      if (anchoredKeyId && identity.keyId !== anchoredKeyId) {
        fail("owner_key_conflict", "Managed Owner key conflicts with trusted Project evidence.");
      }
      return identity;
    }
    if (identityPath) {
      const restored = await loadIdentity(identityPath);
      if (!anchoredKeyId || restored.keyId !== anchoredKeyId) {
        fail(
          "owner_key_restore_unverified",
          "The supplied Owner-key backup cannot be matched to an existing trusted Owner fingerprint.",
        );
      }
      await saveIdentity(keyPath, restored);
      return restored;
    }
    if (evidence.evidence.length > 0 || anchoredKeyId) {
      throw new TeamForgePeerError(
        "owner_key_missing",
        "The existing Project Owner key is missing. Restore a verified backup before publishing; a new Owner key was not generated.",
        { keyPath, evidence: evidence.evidence, expectedOwnerKeyId: anchoredKeyId },
      );
    }
    const identity = generateIdentity(label);
    await saveIdentity(keyPath, identity);
    return identity;
  }

  async resolveSourceProject({
    projectRoot,
    projectId,
    expectedProjectUuid = undefined,
    projectDescriptorPath = undefined,
    requireDescriptor = false,
  }) {
    const root = path.resolve(projectRoot);
    const unityVersion = await readUnityVersion(root);
    const sourceDescriptorState = await readUnityProjectDescriptor(root, {
      explicitPath: projectDescriptorPath,
      expectedProjectUuid,
      expectedUnityVersion: unityVersion,
      required: requireDescriptor,
    });
    const pinnedUuid = sourceDescriptorState.descriptor?.projectUuid ?? expectedProjectUuid;
    const project = await this.ensureProject({ projectId, projectUuid: pinnedUuid });
    if (sourceDescriptorState.descriptor && sourceDescriptorState.descriptor.projectUuid !== project.projectUuid) {
      fail("project_uuid_conflict", "Source Unity Project and managed Project UUIDs differ.");
    }
    return { project, projectRoot: root, unityVersion, sourceDescriptorState };
  }

  async validatePublishBase({ projectId, source, coordinatorBaseline }) {
    if (!source?.project || source.project.projectId !== projectId) {
      fail("invalid_publish_source", "Resolved source Project is required before Publish validation.");
    }
    const local = source.sourceDescriptorState?.descriptor ?? null;
    if (!coordinatorBaseline) {
      const published = await this.publishedBaseline(source.project.projectUuid);
      if ((local && local.baselineRevision > 0) || published) {
        fail(
          "coordinator_registry_empty",
          "This source already has a published Baseline but the Coordinator registry is empty. Seed the signed existing Baseline to rebuild the registry before publishing changes.",
        );
      }
      return { previousPublication: null };
    }
    if (!local || local.baselineRevision === 0 ||
        local.projectUuid !== coordinatorBaseline.projectUuid ||
        local.baselineRevision !== coordinatorBaseline.baselineRevision ||
        local.manifestHash !== coordinatorBaseline.manifestHash ||
        local.descriptorHash !== coordinatorBaseline.descriptorHash) {
      fail(
        "owner_sync_required",
        "Source Project descriptor is not the exact current Coordinator Baseline. Sync first, or use repair-source-descriptor when matching approved signed metadata is already local.",
      );
    }
    let previousPublication;
    try {
      previousPublication = await this.loadPublication({
        projectId,
        manifestHash: coordinatorBaseline.manifestHash,
        requireApproved: true,
      });
    } catch (error) {
      throw new TeamForgePeerError(
        "owner_metadata_missing",
        "The exact previous approved Manifest/Descriptor is unavailable locally. Restore metadata, sync, or run descriptor repair before publishing.",
        { causeCode: error.code ?? "metadata_unavailable" },
      );
    }
    if (previousPublication.descriptor.descriptorHash !== coordinatorBaseline.descriptorHash ||
        previousPublication.descriptor.baselineRevision !== coordinatorBaseline.baselineRevision ||
        previousPublication.descriptor.ownerKeyId !== coordinatorBaseline.ownerKeyId) {
      fail(
        "owner_metadata_mismatch",
        "Local previous Baseline metadata conflicts with the Coordinator trust anchor.",
      );
    }
    return { previousPublication };
  }

  summarizePublicationChanges(currentManifest, previousManifest = null, embeddedPackages = []) {
    validateManifest(currentManifest);
    if (previousManifest) {
      validateManifest(previousManifest, { expectedProjectUuid: currentManifest.projectUuid });
    }
    const before = new Map((previousManifest?.files ?? []).map((file) => [file.path, file]));
    const after = new Map(currentManifest.files.map((file) => [file.path, file]));
    const added = [];
    const changed = [];
    const deleted = [];
    for (const [filePath, file] of after) {
      const old = before.get(filePath);
      if (!old) {
        added.push(filePath);
      } else if (old.fileHash !== file.fileHash || old.executable !== file.executable ||
          old.kind !== file.kind || old.script !== file.script) {
        changed.push(filePath);
      }
    }
    for (const filePath of before.keys()) {
      if (!after.has(filePath)) {
        deleted.push(filePath);
      }
    }
    return {
      firstPublish: previousManifest === null,
      addedCount: added.length,
      changedCount: changed.length,
      deletedCount: deleted.length,
      unchangedCount: currentManifest.totalFiles - added.length - changed.length,
      totalFiles: currentManifest.totalFiles,
      totalBytes: currentManifest.totalBytes,
      totalChunks: currentManifest.totalChunks,
      embeddedPackages: embeddedPackages.map((embedded) => ({ ...embedded })),
      added,
      changed,
      deleted,
    };
  }

  async repairSourceDescriptor({ projectId, source, coordinatorBaseline }) {
    if (!coordinatorBaseline || coordinatorBaseline.projectUuid !== source?.project?.projectUuid) {
      fail("descriptor_repair_unavailable", "Coordinator has no matching approved Baseline to repair from.");
    }
    let approved;
    try {
      approved = await this.loadPublication({
        projectId,
        manifestHash: coordinatorBaseline.manifestHash,
        requireApproved: false,
      });
    } catch (error) {
      throw new TeamForgePeerError(
        "descriptor_repair_unavailable",
        "Matching signed Baseline metadata is not available locally for descriptor repair.",
        { causeCode: error.code ?? "metadata_unavailable" },
      );
    }
    const descriptor = approved.descriptor;
    if (descriptor.descriptorHash !== coordinatorBaseline.descriptorHash ||
        descriptor.baselineRevision !== coordinatorBaseline.baselineRevision ||
        descriptor.ownerKeyId !== coordinatorBaseline.ownerKeyId ||
        descriptor.projectUuid !== coordinatorBaseline.projectUuid) {
      fail("descriptor_repair_mismatch", "Local signed metadata does not exactly match the Coordinator Baseline.");
    }
    const result = await writeUnityProjectDescriptor({
      projectRoot: source.projectRoot,
      baselineDescriptor: descriptor,
      explicitPath: source.sourceDescriptorState.destination,
      expectedDigest: source.sourceDescriptorState.digest,
    });
    await this.#markPublished(approved, { allowForwardJump: true });
    return {
      repaired: true,
      projectId,
      baselineRevision: descriptor.baselineRevision,
      destination: result.destination,
    };
  }

  async initOwner({ outputPath, label = "TeamForge Project Owner" }) {
    const identity = generateIdentity(label);
    await saveIdentity(outputPath, identity);
    return { keyId: identity.keyId, outputPath: path.resolve(outputPath) };
  }

  async backupOwnerKey({ projectId, outputPath }) {
    const project = await this.findProject(projectId);
    if (!project) {
      fail("project_not_initialized", `Managed Project '${projectId}' is not initialized.`);
    }
    const identity = await loadIdentity(this.ownerKeyPath(project.projectUuid));
    await saveIdentity(outputPath, identity);
    return { keyId: identity.keyId, outputPath: path.resolve(outputPath) };
  }

  async importInvite({ invitePath }) {
    const invite = await loadInvite(invitePath);
    return this.importInviteValue({ invite });
  }

  async importInviteValue({ invite }) {
    validateInvite(invite);
    const project = await this.ensureProject({ projectId: invite.projectId, projectUuid: invite.projectUuid });
    const destination = path.join(this.metadataRoot(project.projectUuid), "invite.json");
    if (await exists(destination)) {
      const existing = validateInvite(JSON.parse(await readFile(destination, "utf8")));
      if (existing.projectUuid !== invite.projectUuid || existing.projectId !== invite.projectId) {
        fail("invite_conflict", "Stored invite Project identity conflicts with the new signed invite.");
      }
      if (existing.ownerKeyId !== invite.ownerKeyId) {
        fail("untrusted_owner", "Stored invite Owner identity conflicts with the new signed invite.");
      }
      if (JSON.stringify(existing) !== JSON.stringify(invite)) {
        // Session/endpoint fields are intentionally refreshable, but only after
        // both signed invites bind the same immutable Project and Owner.
        await writeJsonAtomic(destination, invite);
      }
    } else {
      await saveInvite(destination, invite);
    }
    return { project, invite, destination };
  }

  async storedInvite(projectUuid) {
    const destination = path.join(this.metadataRoot(projectUuid), "invite.json");
    return (await exists(destination)) ? loadInvite(destination) : null;
  }

  async createInvite({ projectId, serverAddress, realtimePath = "ws", sessionId, outputPath }) {
    const project = await this.findProject(projectId);
    if (!project) {
      fail("project_not_initialized", "Publish the project once before creating an invite.");
    }
    const ownerIdentity = await this.ensureOwnerIdentity(project.projectUuid);
    const invite = createInvite({
      serverAddress,
      realtimePath,
      projectId: project.projectId,
      projectUuid: project.projectUuid,
      sessionId,
      ownerIdentity,
    });
    await saveInvite(outputPath, invite);
    return { invite, outputPath: path.resolve(outputPath) };
  }

  async createBootstrapInvite({ projectId, projectInvite, sessionJoinCode }) {
    const project = await this.findProject(projectId);
    if (!project || project.projectUuid !== projectInvite?.projectUuid) {
      fail("project_not_initialized", "Bootstrap invite Project identity is unavailable.");
    }
    const ownerIdentity = await this.ensureOwnerIdentity(project.projectUuid);
    return createBootstrapInvite({ projectInvite, sessionJoinCode, ownerIdentity });
  }

  async preparePublication({
    projectRoot,
    projectId,
    projectUuid = undefined,
    baselineRevision,
    publisherKeyPath = undefined,
    ownerKeyPath = undefined,
    projectDescriptorPath = undefined,
    requireSourceDescriptor = false,
    expectedOwnerKeyId = "",
    chunkSize = undefined,
  }) {
    const source = await this.resolveSourceProject({
      projectRoot,
      projectId,
      expectedProjectUuid: projectUuid,
      projectDescriptorPath,
      requireDescriptor: requireSourceDescriptor,
    });
    const { project } = source;
    const ownerIdentity = await this.ensureOwnerIdentity(project.projectUuid, "TeamForge Project Owner", {
      sourceDescriptor: source.sourceDescriptorState.descriptor,
      expectedOwnerKeyId,
      identityPath: ownerKeyPath,
    });
    const publisherIdentity = publisherKeyPath ? await loadIdentity(publisherKeyPath) : ownerIdentity;
    const metadataRoot = this.metadataRoot(project.projectUuid);
    const store = new ChunkStore(path.join(metadataRoot, "chunks"));
    const unityVersion = source.unityVersion;
    const { manifest, manifestHash, embeddedPackages } = await buildManifest({
      projectRoot,
      projectUuid: project.projectUuid,
      baselineRevision,
      ...(chunkSize === undefined ? {} : { chunkSize }),
      store,
    });
    const descriptor = createDescriptor({
      projectId: project.projectId,
      projectUuid: project.projectUuid,
      baselineRevision,
      manifestHash,
      unityVersion,
      ownerIdentity,
      publisherIdentity,
    });
    await writeJsonContentAddressed(path.join(metadataRoot, "manifests", `${manifestHash}.json`), manifest);
    await writeJsonContentAddressed(path.join(metadataRoot, "descriptors", `${descriptor.descriptorHash}.json`), descriptor);
    return {
      project,
      ownerIdentity,
      publisherIdentity,
      manifest,
      embeddedPackages,
      descriptor,
      store,
      sourceProjectRoot: source.projectRoot,
      sourceDescriptorState: source.sourceDescriptorState,
    };
  }

  async loadPublication({ projectId, manifestHash = undefined, requireApproved = false }) {
    const project = await this.findProject(projectId);
    if (!project) {
      fail("project_not_initialized", `Managed Project '${projectId}' is not initialized.`);
    }
    const metadataRoot = this.metadataRoot(project.projectUuid);
    const current = await new ManagedProjectStore({
        managedRoot: this.managedRoot,
        projectUuid: project.projectUuid,
        chunkStore: new ChunkStore(path.join(metadataRoot, "chunks")),
      }).current();
    const published = await this.publishedBaseline(project.projectUuid);
    let selectedHash = manifestHash ?? current?.manifestHash ?? published?.manifestHash;
    if (manifestHash && requireApproved &&
        manifestHash !== current?.manifestHash && manifestHash !== published?.manifestHash) {
      fail("baseline_not_approved", "Requested Manifest is only a draft, not an Active or approved Baseline.");
    }
    if (!selectedHash) {
      fail("baseline_selection_required", "No Active or Coordinator-approved managed Baseline is available to seed.");
    }
    const manifest = JSON.parse(await readFile(path.join(metadataRoot, "manifests", `${selectedHash}.json`), "utf8"));
    validateManifest(manifest, { expectedProjectUuid: project.projectUuid, expectedManifestHash: selectedHash });
    const descriptorFiles = await readdir(path.join(metadataRoot, "descriptors"));
    const expectedDescriptorHash = selectedHash === current?.manifestHash
      ? current.descriptorHash
      : selectedHash === published?.manifestHash
        ? published.descriptorHash
        : "";
    let descriptor = null;
    for (const file of descriptorFiles) {
      const candidate = JSON.parse(await readFile(path.join(metadataRoot, "descriptors", file), "utf8"));
      if (candidate.manifestHash === selectedHash &&
          (!expectedDescriptorHash || candidate.descriptorHash === expectedDescriptorHash)) {
        descriptor = validateDescriptor(candidate);
        break;
      }
    }
    if (!descriptor) {
      fail("descriptor_unavailable", "Signed descriptor is missing for the selected manifest.");
    }
    const store = new ChunkStore(path.join(metadataRoot, "chunks"));
    return { project, manifest, descriptor, store };
  }

  async startSeed({
    publication,
    host = LEGACY_TRANSFER_DEFAULTS.host,
    port = LEGACY_TRANSFER_DEFAULTS.port,
    advertisedEndpoint = undefined,
    advertisedHost = undefined,
    transferToken = createTransferToken(),
    coordinatorOptions = undefined,
    sessionId = undefined,
    publish = false,
    maxBytesPerSecond = LEGACY_TRANSFER_DEFAULTS.maxBytesPerSecond,
  }) {
    const { project, manifest, descriptor, store } = publication;
    const effectiveSessionId = sessionId ?? coordinatorOptions?.sessionId;
    const transferServer = new DirectTransferServer({
      host, port, sessionId: effectiveSessionId,
      projectUuid: project.projectUuid, manifest, descriptor, store, transferToken, maxBytesPerSecond,
    });
    const bound = await transferServer.start();
    if (advertisedEndpoint !== undefined && advertisedHost !== undefined) {
      fail("invalid_peer_endpoint", "Choose either a complete advertised endpoint or an advertised host, not both.");
    }
    const endpoint = advertisedEndpoint ?? endpointWithAdvertisedHost(bound.endpoint, advertisedHost);
    let coordinator = null;
    let stopped = false;
    let connecting = false;
    let reconnectTimer = null;
    let reconnectPromise = null;
    const reconnectState = { attempts: 0, lastError: "", nextDelayMilliseconds: 0 };
    const chunks = uniqueManifestChunks(manifest);
    const connectAndAnnounce = async (publishBaseline) => {
      connecting = true;
      const client = new CoordinatorClient({
        ...coordinatorOptions,
        projectId: project.projectId,
      });
      coordinator = client;
      client.once("close", () => {
        if (coordinator === client) coordinator = null;
        if (!stopped && !connecting) scheduleReconnect();
      });
      try {
        await client.connect();
        if (publishBaseline) {
          if (publication.sourceProjectRoot && publication.sourceDescriptorState) {
            await assertUnityProjectDescriptorUnchanged({
              projectRoot: publication.sourceProjectRoot,
              explicitPath: publication.sourceDescriptorState.destination,
              expectedDigest: publication.sourceDescriptorState.digest,
            });
          }
          await client.publishBaseline(descriptor);
          await this.#markPublished(publication);
          if (publication.sourceProjectRoot && publication.sourceDescriptorState) {
            await writeUnityProjectDescriptor({
              projectRoot: publication.sourceProjectRoot,
              baselineDescriptor: descriptor,
              explicitPath: publication.sourceDescriptorState.destination,
              expectedDigest: publication.sourceDescriptorState.digest,
            });
          }
        }
        const ownerIdentity = publication.ownerIdentity ??
          await loadIdentity(this.ownerKeyPath(project.projectUuid)).catch(() => null);
        const ownerProofSignature = ownerIdentity?.keyId === descriptor.ownerKeyId
          ? createOwnerProof(ownerIdentity, {
              projectId: project.projectId,
              projectUuid: project.projectUuid,
              connectionId: client.connectionId,
              baselineRevision: descriptor.baselineRevision,
              manifestHash: descriptor.manifestHash,
              endpoint,
              transferToken,
            })
          : "";
        const available = await store.inventory(chunks.map((chunk) => chunk.hash));
        await client.announce({
          descriptor,
          completeBaseline: available.length === chunks.length,
          availableChunkCount: available.length,
          totalChunkCount: chunks.length,
          endpoint,
          transferToken,
          ownerProofSignature,
        });
        reconnectState.attempts = 0;
        reconnectState.lastError = "";
        reconnectState.nextDelayMilliseconds = 0;
      } catch (error) {
        if (coordinator === client) coordinator = null;
        client.close();
        throw error;
      } finally {
        connecting = false;
      }
    };
    const scheduleReconnect = () => {
      if (stopped || !coordinatorOptions || reconnectTimer || reconnectPromise) {
        return;
      }
      const delay = Math.min(
        LEGACY_CONNECTION_DEFAULTS.reconnectMaximumMilliseconds,
        LEGACY_CONNECTION_DEFAULTS.reconnectBaseMilliseconds *
          (2 ** Math.min(LEGACY_CONNECTION_DEFAULTS.reconnectExponentLimit, reconnectState.attempts)),
      );
      reconnectState.nextDelayMilliseconds = delay;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (stopped) return;
        reconnectPromise = connectAndAnnounce(false)
          .catch((error) => {
            reconnectState.attempts += 1;
            reconnectState.lastError = `${error.code ?? "coordinator_error"}: ${error.message}`;
          })
          .finally(() => {
            reconnectPromise = null;
            if (!stopped && !coordinator) scheduleReconnect();
          });
      }, delay);
      reconnectTimer.unref?.();
    };
    try {
      if (coordinatorOptions) {
        await connectAndAnnounce(publish);
      }
      return {
        endpoint,
        transferToken,
        get coordinator() { return coordinator; },
        reconnectState,
        transferServer,
        async stop() {
          stopped = true;
          if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
          }
          coordinator?.close();
          await reconnectPromise?.catch(() => {});
          await transferServer.stop();
        },
      };
    } catch (error) {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      coordinator?.close();
      await transferServer.stop();
      throw error;
    }
  }

  async syncFromSnapshot({
    projectId,
    snapshot,
    trustApproval,
    host = LEGACY_TRANSFER_DEFAULTS.host,
    port = LEGACY_TRANSFER_DEFAULTS.port,
    advertisedEndpoint = undefined,
    advertisedHost = undefined,
    coordinator = undefined,
    sessionId = undefined,
    maxConcurrency = LEGACY_TRANSFER_DEFAULTS.maxConcurrency,
    retryRounds = LEGACY_TRANSFER_DEFAULTS.retryRounds,
    retryBaseMilliseconds = LEGACY_TRANSFER_DEFAULTS.retryBaseMilliseconds,
    retryMaximumMilliseconds = LEGACY_TRANSFER_DEFAULTS.retryMaximumMilliseconds,
    maxBytesPerSecond = LEGACY_TRANSFER_DEFAULTS.maxBytesPerSecond,
    onProgress = () => {},
    onDiagnostic = () => {},
    signal = undefined,
  }) {
    if (!snapshot?.baseline || !Array.isArray(snapshot.peers)) {
      throw new TeamForgePeerError("baseline_unavailable", "Coordinator has no published baseline or direct peer.");
    }
    const baseline = snapshot.baseline;
    const effectiveSessionId = sessionId ?? coordinator?.sessionId;
    const projectUuid = baseline.projectUuid ?? snapshot.projectUuid;
    const project = await this.ensureProject({ projectId, projectUuid });
    const invite = await this.storedInvite(project.projectUuid);
    if (invite && invite.ownerKeyId !== baseline.ownerKeyId) {
      fail("untrusted_owner", "Coordinator baseline conflicts with the signed invite Owner key.");
    }
    const seeds = snapshot.peers
      .filter((peer) => peer.projectUuid === project.projectUuid &&
        peer.baselineRevision === baseline.baselineRevision &&
        peer.manifestHash === baseline.manifestHash &&
        peer.seedRank < 99 && peer.endpoint && peer.transferToken)
      .sort((left, right) => left.seedRank - right.seedRank ||
        String(left.connectionId).localeCompare(String(right.connectionId)));
    if (seeds.length === 0) {
      throw new TeamForgePeerError("baseline_unavailable", "Published baseline has no direct Project Peer.");
    }
    const metadataRoot = this.metadataRoot(project.projectUuid);
    const store = new ChunkStore(path.join(metadataRoot, "chunks"));
    const downloader = new SwarmDownloader({
      store,
      maxConcurrency,
      retryRounds,
      retryBaseMilliseconds,
      retryMaximumMilliseconds,
      onProgress,
      onDiagnostic,
    });
    const discovered = await downloader.discover({
      seeds,
      projectId,
      projectUuid: project.projectUuid,
      manifestHash: baseline.manifestHash,
      sessionId: effectiveSessionId,
      trustedOwnerKeyId: invite?.ownerKeyId,
      signal,
    });
    const { descriptor, manifest } = discovered;
    await writeJsonContentAddressed(path.join(metadataRoot, "manifests", `${manifest.manifestHash}.json`), manifest);
    await writeJsonContentAddressed(path.join(metadataRoot, "descriptors", `${descriptor.descriptorHash}.json`), descriptor);
    await this.#markPublished({ project, descriptor, manifest, store }, { allowForwardJump: true });

    const transferToken = createTransferToken();
    const partialServer = new DirectTransferServer({
      host, port, sessionId: effectiveSessionId,
      projectUuid: project.projectUuid, manifest, descriptor, store, transferToken, maxBytesPerSecond,
    });
    const bound = await partialServer.start();
    if (advertisedEndpoint !== undefined && advertisedHost !== undefined) {
      fail("invalid_peer_endpoint", "Choose either a complete advertised endpoint or an advertised host, not both.");
    }
    const endpoint = advertisedEndpoint ?? endpointWithAdvertisedHost(bound.endpoint, advertisedHost);
    let lastAnnounceAt = 0;
    const chunks = uniqueManifestChunks(manifest);
    downloader.onPartialSeed = async () => {
      if (!coordinator || Date.now() - lastAnnounceAt < 500) {
        return;
      }
      lastAnnounceAt = Date.now();
      const available = await store.inventory(chunks.map((chunk) => chunk.hash));
      await coordinator.announce({
        descriptor,
        completeBaseline: available.length === chunks.length,
        availableChunkCount: available.length,
        totalChunkCount: chunks.length,
        endpoint,
        transferToken,
        ownerProofSignature: "",
      });
    };

    const managed = new ManagedProjectStore({
      managedRoot: this.managedRoot,
      projectUuid: project.projectUuid,
      chunkStore: store,
    });
    try {
      const download = await downloader.download({ manifest, seeds, sessionId: effectiveSessionId, signal });
      if (coordinator) {
        await coordinator.announce({
          descriptor,
          completeBaseline: true,
          availableChunkCount: chunks.length,
          totalChunkCount: chunks.length,
          endpoint,
          transferToken,
          ownerProofSignature: "",
        });
      }
      const activation = await managed.activate({
        descriptor,
        manifest,
        trustApproval,
        sourcePeers: download.peers.filter((peer) => peer.successes > 0).map((peer) => peer.id),
      });
      return { project, descriptor, manifest, download, activation, partialServer, endpoint, transferToken };
    } catch (error) {
      const existingStagingPath = error instanceof TeamForgePeerError
        ? error.details?.stagingPath
        : "";
      const stagingPath = existingStagingPath || await managed.retainFailure({
        state: error.code === "baseline_unavailable"
          ? DOWNLOAD_STATES.BaselineUnavailable
          : ["direct_transfer_unavailable", "chunk_unavailable"].includes(error.code)
            ? DOWNLOAD_STATES.DirectTransferUnavailable
            : DOWNLOAD_STATES.Rejected,
        descriptor,
        details: { code: error.code ?? "sync_failed", message: error.message },
      }).catch(() => "");
      if (error instanceof TeamForgePeerError && stagingPath) {
        error.details = { ...(error.details ?? {}), stagingPath };
      }
      await partialServer.stop();
      throw error;
    }
  }

  async status({ projectId, verbose = false }) {
    const project = await this.findProject(projectId);
    if (!project) {
      return { initialized: false, projectId };
    }
    const metadataRoot = this.metadataRoot(project.projectUuid);
    const chunkStore = new ChunkStore(path.join(metadataRoot, "chunks"));
    const managed = new ManagedProjectStore({
      managedRoot: this.managedRoot,
      projectUuid: project.projectUuid,
      chunkStore,
    });
    const current = await managed.current();
    const published = await this.publishedBaseline(project.projectUuid);
    const result = {
      initialized: true,
      projectId: project.projectId,
      active: Boolean(current),
      activePath: current?.activePath ?? "",
      baselineRevision: current?.baselineRevision ?? published?.baselineRevision ?? null,
    };
    if (verbose) {
      result.projectUuid = project.projectUuid;
      result.manifestHash = current?.manifestHash ?? published?.manifestHash ?? "";
      result.publisherKeyId = current?.publisherKeyId ?? "";
      result.metadataRoot = metadataRoot;
    }
    return result;
  }
}

export const PROJECT_PEER_STABLE_BACKEND = Object.freeze({
  id: "project-peer",
  protocolVersion: 1,
  engine: ProjectPeerEngine,
  transferSourceContract: PROJECT_TRANSFER_SOURCE_CONTRACT,
  transferSourceAdapters: Object.freeze([DirectTransferClient]),
});

export {
  ChunkStore,
  CoordinatorClient,
  DirectTransferClient,
  DirectTransferServer,
  PROJECT_TRANSFER_SOURCE_CONTRACT,
  ManagedProjectStore,
  SwarmDownloader,
  buildManifest,
  createDescriptor,
  createInvite,
  generateIdentity,
  loadIdentity,
  saveIdentity,
  assertProjectTransferSource,
  transferSourceErrorInfo,
  validateDescriptor,
  validateInvite,
  validateManifest,
  readUnityProjectDescriptor,
  writeUnityProjectDescriptor,
};
