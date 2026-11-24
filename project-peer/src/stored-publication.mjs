// Read-only managed publication selection shared by the realtime server and
// Project Peer. Keep transport/Coordinator clients out of this dependency tree:
// the standalone server installs only its own WebSocket package.
import { readdir } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { ChunkStore } from "./content-store.mjs";
import { ManagedProjectStore } from "./managed-project.mjs";
import { validateManifest } from "./manifest.mjs";
import { validateDescriptor } from "./descriptor.mjs";
import { requireSha256 } from "./hash.mjs";
import { PRODUCT_VERSION, UUID_PATTERN } from "./constants.mjs";
import { fail } from "./errors.mjs";
import { assertNoRedirectedDirectorySegments } from "./filesystem-safety.mjs";
import { readStoredMetadataJson,
  STORED_DESCRIPTOR_MAX_BYTES, STORED_MANIFEST_MAX_BYTES,
  STORED_POINTER_MAX_BYTES, STORED_PROJECT_MAX_BYTES } from "./stored-metadata-reader.mjs";

function metadataRootForProject(managedRoot, projectUuid) {
  if (typeof managedRoot !== "string" || managedRoot.trim().length === 0)
    fail("invalid_managed_root", "Managed project root is required.");
  if (typeof projectUuid !== "string" || !UUID_PATTERN.test(projectUuid) || projectUuid !== projectUuid.toLowerCase())
    fail("invalid_project_uuid", "A canonical Project UUID is required.");
  return path.join(path.resolve(managedRoot),projectUuid,"metadata");
}

export async function readPublishedBaseline({managedRoot,projectUuid}) {
  const metadataRoot = metadataRootForProject(managedRoot,projectUuid);
  let pointer;
  try { pointer = await readStoredMetadataJson(path.join(metadataRoot,"published.json"),STORED_POINTER_MAX_BYTES); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
  if (!pointer || pointer.schemaVersion !== 1 || pointer.projectUuid !== projectUuid ||
      !Number.isSafeInteger(pointer.baselineRevision) || pointer.baselineRevision < 1 ||
      !/^[0-9a-f]{64}$/u.test(pointer.manifestHash ?? "") ||
      !/^[0-9a-f]{64}$/u.test(pointer.descriptorHash ?? "") ||
      !/^[0-9a-f]{64}$/u.test(pointer.ownerKeyId ?? "") ||
      !Number.isSafeInteger(pointer.approvedAtUnixMs) || pointer.approvedAtUnixMs < 1)
    fail("invalid_published_pointer", "Managed published Baseline pointer is invalid.");
  return pointer;
}

// projectId/UUID are selected by the owning registry or Engine.findProject,
// never by a peer path. Re-read stored metadata and require the same identity.
// Active/published pointers, manifest and descriptor retain the Engine's exact
// approval and cryptographic checks; signed Scene/chunk verification follows.
export async function loadStoredPublication({
  managedRoot,projectId,projectUuid,manifestHash=undefined,requireApproved=false,
}) {
  if (typeof projectId !== "string" || !projectId.trim() || projectId.length > 128 ||
      /[\u0000-\u001f\u007f]/u.test(projectId))
    fail("invalid_project_id", "Project ID is invalid.");
  if (manifestHash !== undefined) requireSha256(manifestHash,"manifestHash");
  const metadataRoot = metadataRootForProject(managedRoot,projectUuid);
  const project = await readStoredMetadataJson(path.join(metadataRoot,"project.json"),STORED_PROJECT_MAX_BYTES);
  if (!project || project.schemaVersion !== 1 || project.productVersion !== PRODUCT_VERSION ||
      project.projectUuid !== projectUuid || typeof project.projectId !== "string" ||
      !project.projectId.trim() || project.projectId.length > 128 ||
      !Number.isSafeInteger(project.createdAtUnixMs))
    fail("invalid_project_metadata", "Managed Project metadata is invalid.");
  if (project.projectId.trim() !== projectId.trim())
    fail("project_id_mismatch", "Stored Project metadata differs from the selected Project identity.");
  const current = await new ManagedProjectStore({
      managedRoot: managedRoot,
      projectUuid: project.projectUuid,
      chunkStore: new ChunkStore(path.join(metadataRoot, "chunks")),
    }).current();
  const published = await readPublishedBaseline({managedRoot,projectUuid:project.projectUuid});
  const selectedHash = manifestHash ?? current?.manifestHash ?? published?.manifestHash;
  if (manifestHash && requireApproved &&
      manifestHash !== current?.manifestHash && manifestHash !== published?.manifestHash) {
    fail("baseline_not_approved", "Requested Manifest is only a draft, not an Active or approved Baseline.");
  }
  if (!selectedHash) {
    fail("baseline_selection_required", "No Active or Coordinator-approved managed Baseline is available to seed.");
  }
  requireSha256(selectedHash, "manifestHash");
  const manifest = await readStoredMetadataJson(path.join(metadataRoot, "manifests", `${selectedHash}.json`),STORED_MANIFEST_MAX_BYTES);
  validateManifest(manifest, { expectedProjectUuid: project.projectUuid, expectedManifestHash: selectedHash });
  const selectedPointer = selectedHash === current?.manifestHash
    ? current : selectedHash === published?.manifestHash ? published : null;
  const expectedDescriptorHash = selectedPointer
    ? requireSha256(selectedPointer.descriptorHash, "descriptorHash") : "";
  // Approved/current state selects one canonical file. Unrelated drafts,
  // interrupted leftovers or corrupt entries cannot block that exact read.
  const descriptorFiles = expectedDescriptorHash
    ? [`${expectedDescriptorHash}.json`]
    : (await (async () => {
        const directory = path.join(metadataRoot, "descriptors");
        await assertNoRedirectedDirectorySegments(directory, {
          code: "unsafe_stored_metadata",
          message: "Managed signed Descriptor directory is redirected.",
        });
        return readdir(directory);
      })()).filter(file => /^[0-9a-f]{64}\.json$/u.test(file));
  let descriptor = null;
  for (const file of descriptorFiles) {
    let candidate;
    try {
      candidate = await readStoredMetadataJson(path.join(metadataRoot, "descriptors", file),STORED_DESCRIPTOR_MAX_BYTES);
    } catch (error) {
      if (expectedDescriptorHash && error.code === "ENOENT") {
        fail("descriptor_unavailable", "The exact approved signed descriptor is missing.");
      }
      throw error;
    }
    if (candidate.manifestHash === selectedHash &&
        (!expectedDescriptorHash || candidate.descriptorHash === expectedDescriptorHash)) {
      descriptor = validateDescriptor(candidate, {
        expectedProjectId: project.projectId,
        expectedProjectUuid: project.projectUuid,
        expectedManifestHash: selectedHash,
        trustedOwnerKeyId: selectedPointer?.ownerKeyId,
      });
      break;
    }
  }
  if (!descriptor) {
    fail("descriptor_unavailable", "Signed descriptor is missing for the selected manifest.");
  }
  if (descriptor.baselineRevision !== manifest.baselineRevision ||
      (selectedPointer && descriptor.baselineRevision !== selectedPointer.baselineRevision)) {
    fail("baseline_revision_mismatch", "Approved pointer, descriptor and manifest revisions must agree.");
  }
  // An approved Host revision or verified Guest Active can change while a
  // large signed Manifest is being inspected. Re-read the exact selection
  // before returning any authority-bearing source to the Coordinator.
  // This is a read invalidation fence, not a cross-store write freeze.
  const [latestProject, latestCurrent, latestPublished] = await Promise.all([
    readStoredMetadataJson(path.join(metadataRoot,"project.json"),STORED_PROJECT_MAX_BYTES),
    new ManagedProjectStore({managedRoot,projectUuid:project.projectUuid,
      chunkStore:new ChunkStore(path.join(metadataRoot,"chunks"))}).current(),
    readPublishedBaseline({managedRoot,projectUuid:project.projectUuid}),
  ]);
  if (!isDeepStrictEqual(project,latestProject) ||
      !isDeepStrictEqual(current,latestCurrent) ||
      !isDeepStrictEqual(published,latestPublished))
    fail("stored_publication_changed",
      "The approved Project or Active Baseline changed during signed source verification. Retry against the current revision.");
  const store = new ChunkStore(path.join(metadataRoot, "chunks"));
  return { project, manifest, descriptor, store };
}
