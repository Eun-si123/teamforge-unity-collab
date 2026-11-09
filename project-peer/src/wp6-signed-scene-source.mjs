// WP6 source-only, read-only verified published *bytes* bridge.
// This does not parse Unity YAML, establish in-memory Component values,
// mutate active files, or authorize a realtime Inspector operation.
import { createHash } from "node:crypto";
import { types as nodeTypes } from "node:util";
import { ChunkStore } from "./content-store.mjs";
import { validateDescriptor } from "./descriptor.mjs";
import { fail } from "./errors.mjs";
import { validateManifest } from "./manifest.mjs";
import { normalizeRelativePath } from "./path-policy.mjs";

const SCENE_GUID = /^[0-9a-f]{32}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const MAX_SCENE_BYTES = 128 * 1024 * 1024;
const MAX_META_BYTES = 64 * 1024;
const MAX_FILE_CHUNKS = 2048;
const BASELINE_KEYS = Object.freeze([
  "projectId", "projectUuid", "baselineRevision",
  "manifestHash", "descriptorHash", "ownerKeyId",
]);
const NO_SCENE_CONTENT_ATTESTATION = "signed_manifest_scene_bytes_verified_unparsed";

function pinnedBaseline(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      nodeTypes.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const fields = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(fields);
  return keys.length === BASELINE_KEYS.length && keys.every(key =>
    typeof key === "string" && BASELINE_KEYS.includes(key) &&
    fields[key].enumerable && Object.hasOwn(fields[key], "value"));
}

function inertStoredPublication(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      nodeTypes.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return ["manifest", "descriptor", "store"].every(key =>
    Object.hasOwn(descriptors, key) &&
    descriptors[key].enumerable &&
    Object.hasOwn(descriptors[key], "value"));
}

function validScenePath(scenePath) {
  if (typeof scenePath !== "string" || scenePath.length > 1024 ||
      !scenePath.startsWith("Assets/") || !scenePath.endsWith(".unity")) return false;
  try {
    return normalizeRelativePath(scenePath) === scenePath;
  } catch {
    return false;
  }
}

function validatedFile(files, filePath, maxBytes) {
  const matches = files.filter(file => file.path === filePath);
  if (matches.length !== 1 || matches[0].kind !== "asset") {
    fail("wp6_scene_source_missing", "The exact Scene and its Unity .meta asset must be present in the signed Manifest.");
  }
  const file = matches[0];
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > maxBytes ||
      !SHA256.test(file.fileHash) || !Array.isArray(file.chunks) ||
      file.chunks.length < 1 || file.chunks.length > MAX_FILE_CHUNKS) {
    fail("wp6_scene_source_limit", "Scene or Unity metadata exceeds its bounded verification budget.");
  }
  // Copy the validated immutable facts before the first async chunk read.
  // No mutation of a caller's manifest can change which bytes are checked.
  return Object.freeze({
    size: file.size, fileHash: file.fileHash,
    chunks: Object.freeze(file.chunks.map(chunk => Object.freeze({
      hash: chunk.hash, size: chunk.size,
    }))),
  });
}

async function verifiedStoredBytes(file, store, collect = false) {
  const hash = createHash("sha256");
  const parts = collect ? [] : null;
  let position = 0;
  for (const chunk of file.chunks) {
    // Reuse the ChunkStore's opened-inode size and hash checks, never an
    // untrusted storage adapter or a direct unbounded readFile().
    const bytes = await ChunkStore.prototype.read.call(store, chunk.hash, chunk.size);
    position += bytes.length;
    if (position > file.size) {
      fail("wp6_scene_source_size_mismatch", "Signed Scene chunk bytes exceed the expected file size.");
    }
    hash.update(bytes);
    if (parts) parts.push(bytes);
  }
  if (position !== file.size || hash.digest("hex") !== file.fileHash) {
    fail("wp6_scene_source_hash_mismatch", "The reconstructed Scene asset differs from the signed Manifest entry.");
  }
  return parts ? Buffer.concat(parts, position) : null;
}

function verifiedMetaGuid(bytes) {
  // Unity's .meta file binds the Scene's GUID to the exact published asset
  // bytes. This is deliberately NOT a general Unity Scene/YAML parser.
  let content;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("wp6_scene_meta_invalid", "Unity Scene metadata is not valid UTF-8.");
  }
  const lines = content.split(/\r?\n/u);
  let count = 0, sceneGuid = "";
  let fileFormatVersionCount = 0;
  for (const line of lines) {
    if (line.startsWith("guid:")) {
      count++;
      const match = /^guid: ([0-9a-f]{32})$/u.exec(line);
      if (!match) fail("wp6_scene_meta_invalid", "Unity metadata has a malformed Scene GUID.");
      sceneGuid = match[1];
    }
    if (line.startsWith("fileFormatVersion:")) {
      fileFormatVersionCount++;
      if (line !== "fileFormatVersion: 2") {
        fail("wp6_scene_meta_invalid", "Unexpected Unity metadata format.");
      }
    }
  }
  if (count !== 1 || fileFormatVersionCount !== 1 ||
      sceneGuid === "00000000000000000000000000000000") {
    fail("wp6_scene_meta_invalid", "Unity Scene metadata requires one canonical nonzero GUID.");
  }
  return sceneGuid;
}

// IMPORTANT: expectedBaseline must originate from the server-owned CURRENT
// Project Coordinator registry, not a peer's JSON and not the supplied
// descriptor. This API cross-checks a pinned Owner key + signed Baseline
// and reconstructs the actual .unity/.meta bytes from verified stored chunks.
// It makes no claim that a *loaded* Unity Scene or Collider snapshot matches
// those bytes. The user must still implement that independent attestation.
export async function verifyWp6PublishedSceneSource({
  publication, expectedBaseline, scenePath, sceneGuid,
  maxSceneBytes = MAX_SCENE_BYTES,
} = {}) {
  if (!pinnedBaseline(expectedBaseline) ||
      typeof expectedBaseline.projectId !== "string" ||
      expectedBaseline.projectId.length < 1 ||
      typeof expectedBaseline.projectUuid !== "string" ||
      !Number.isSafeInteger(expectedBaseline.baselineRevision) ||
      expectedBaseline.baselineRevision < 1 ||
      !SHA256.test(expectedBaseline.manifestHash) ||
      !SHA256.test(expectedBaseline.descriptorHash) ||
      !SHA256.test(expectedBaseline.ownerKeyId)) {
    fail("wp6_scene_baseline_untrusted", "The current server-pinned Project Baseline and Owner key are required.");
  }
  if (!validScenePath(scenePath) || !SCENE_GUID.test(sceneGuid ?? "") ||
      sceneGuid === "00000000000000000000000000000000") {
    fail("wp6_scene_identity_invalid", "The saved Unity Scene needs a canonical asset path and nonzero GUID.");
  }
  if (!inertStoredPublication(publication) ||
      !(publication.store instanceof ChunkStore) ||
      !Number.isSafeInteger(maxSceneBytes) || maxSceneBytes < 1 ||
      maxSceneBytes > MAX_SCENE_BYTES) {
    fail("wp6_scene_source_config_invalid", "A real bounded content-addressed ChunkStore is required.");
  }

  const { manifest, descriptor, store } = publication;
  if (!manifest || !descriptor) {
    fail("wp6_scene_source_missing", "Signed Project baseline metadata is missing.");
  }
  // verifyDescriptor authenticates the signature and delegated Publisher
  // authorization under the trusted Owner pin; the expected hash is obtained
  // OUTSIDE the untrusted publication.
  validateDescriptor(descriptor, {
    expectedProjectId: expectedBaseline.projectId,
    expectedProjectUuid: expectedBaseline.projectUuid,
    expectedManifestHash: expectedBaseline.manifestHash,
    trustedOwnerKeyId: expectedBaseline.ownerKeyId,
  });
  if (descriptor.descriptorHash !== expectedBaseline.descriptorHash ||
      descriptor.baselineRevision !== expectedBaseline.baselineRevision) {
    fail("wp6_scene_baseline_mismatch", "The registered Publisher's exact Project Baseline has changed.");
  }
  validateManifest(manifest, {
    expectedProjectUuid: expectedBaseline.projectUuid,
    expectedManifestHash: expectedBaseline.manifestHash,
  });
  if (manifest.baselineRevision !== expectedBaseline.baselineRevision) {
    fail("wp6_scene_baseline_mismatch", "Signed manifest and Publisher Baseline revisions differ.");
  }

  const effectiveMax = Math.min(maxSceneBytes, MAX_SCENE_BYTES);
  const sceneFile = validatedFile(manifest.files, scenePath, effectiveMax);
  const metadataFile = validatedFile(manifest.files, scenePath + ".meta", MAX_META_BYTES);
  // Metadata first: refuse a wrong asset identity before hashing a large Scene.
  const meta = await verifiedStoredBytes(metadataFile, store, true);
  if (verifiedMetaGuid(meta) !== sceneGuid) {
    fail("wp6_scene_guid_mismatch", "The signed Unity Scene metadata GUID differs from the expected Scene.");
  }
  await verifiedStoredBytes(sceneFile, store);

  return Object.freeze({
    status: NO_SCENE_CONTENT_ATTESTATION,
    projectUuid: expectedBaseline.projectUuid,
    baselineRevision: expectedBaseline.baselineRevision,
    manifestHash: expectedBaseline.manifestHash,
    descriptorHash: expectedBaseline.descriptorHash,
    scenePath, sceneGuid,
    sceneFileSha256: sceneFile.fileHash,
    sceneMetaSha256: metadataFile.fileHash,
    sceneFileBytes: sceneFile.size,
  });
}
