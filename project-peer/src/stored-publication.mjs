// Read-only managed publication selection shared by the realtime server and
// Project Peer. Keep transport/Coordinator clients out of this dependency tree:
// the standalone server installs only its own WebSocket package.
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { ChunkStore } from "./content-store.mjs";
import { ManagedProjectStore } from "./managed-project.mjs";
import { validateManifest } from "./manifest.mjs";
import { validateDescriptor } from "./descriptor.mjs";
import { requireSha256 } from "./hash.mjs";
import { PRODUCT_VERSION, UUID_PATTERN } from "./constants.mjs";
import { fail } from "./errors.mjs";

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
  try { pointer = JSON.parse(await readFile(path.join(metadataRoot,"published.json"),"utf8")); }
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
  const project = JSON.parse(await readFile(path.join(metadataRoot,"project.json"),"utf8"));
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
  const manifest = JSON.parse(await readFile(path.join(metadataRoot, "manifests", `${selectedHash}.json`), "utf8"));
  validateManifest(manifest, { expectedProjectUuid: project.projectUuid, expectedManifestHash: selectedHash });
  const selectedPointer = selectedHash === current?.manifestHash
    ? current : selectedHash === published?.manifestHash ? published : null;
  const expectedDescriptorHash = selectedPointer
    ? requireSha256(selectedPointer.descriptorHash, "descriptorHash") : "";
  // Approved/current state selects one canonical file. Unrelated drafts,
  // interrupted leftovers or corrupt entries cannot block that exact read.
  const descriptorFiles = expectedDescriptorHash
    ? [`${expectedDescriptorHash}.json`]
    : (await readdir(path.join(metadataRoot, "descriptors")))
      .filter(file => /^[0-9a-f]{64}\.json$/u.test(file));
  let descriptor = null;
  for (const file of descriptorFiles) {
    let candidate;
    try {
      candidate = JSON.parse(await readFile(path.join(metadataRoot, "descriptors", file), "utf8"));
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
  const store = new ChunkStore(path.join(metadataRoot, "chunks"));
  return { project, manifest, descriptor, store };
}
