// Read-only audit of Unity Asset GUIDs from the exact *staged, signed* Project
// Manifest and content-addressed chunks. Reuses the existing ChunkStore's
// hash-checked pinned-handle reads; never trusts Host filesystem paths, does
// not write or promote a Baseline, and has an all-or-nothing byte budget.
// Includes embedded package metadata: imported Assets can reference Package
// resources by GUID, and a conflicting GUID must not be silently accepted.
// This module has no WebSocket/CoordinatorClient dependency: standalone
// Coordinator installs only server/node_modules.
import { createHash } from "node:crypto";

const DEFAULT_LIMITS = Object.freeze({
  maxMetadataFiles: 8192,
  maxMetadataBytes: 32 * 1024 * 1024,
  maxIndividualMetadataBytes: 2 * 1024 * 1024,
  maxMetadataChunks: 8192,
});
const assetMeta = path => (path.startsWith("Assets/") || path.startsWith("Packages/")) &&
  path.endsWith(".meta");
const guidLine = /^guid:[ \t]*([0-9a-fA-F]{32})[ \t]*$/gmu;
const sourceHash = /^[0-9a-f]{64}$/u;

function touchedSource(path, changed) {
  return changed.has(path) || changed.has(path.slice(0, -5));
}

export async function auditSignedAssetGuids(publication, delta, {
  limits = DEFAULT_LIMITS, signal,
} = {}) {
  // The caller already verified the signed Manifest and Descriptor via
  // loadStoredPublication. Confirm the shape here for internal misuse too.
  if (!Array.isArray(publication?.manifest?.files) ||
      typeof publication?.store?.read !== "function" ||
      !Array.isArray(delta?.added) || !Array.isArray(delta?.changed))
    throw new TypeError("A verified staged Manifest, ChunkStore and change delta are required.");
  const metadata = publication.manifest.files.filter(file => assetMeta(file.path));
  const totalBytes = metadata.reduce((sum, file) => sum + file.size, 0);
  const chunks = metadata.reduce((sum, file) => sum + file.chunks.length, 0);
  // A large Project remains reviewable at the lighter Manifest/source level;
  // never report 'GUID verified' from a partial scan. Caller must not infer
  // zero conflicts from an unverified result.
  if (metadata.length > limits.maxMetadataFiles ||
      totalBytes > limits.maxMetadataBytes || chunks > limits.maxMetadataChunks ||
      metadata.some(file => file.size > limits.maxIndividualMetadataBytes)) {
    return {status:"resource_limit", auditedMetadataFiles:0,
      duplicateGuidPaths:[], invalidGuidPaths:[]};
  }
  const touched = new Set([...delta.added, ...delta.changed]);
  const seen = new Map();
  const invalidGuidPaths = [];
  const duplicateGuidPaths = new Set();
  for (const file of metadata) {
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(file.size) || file.size < 0 ||
        !sourceHash.test(file.fileHash) || !Array.isArray(file.chunks))
      throw new TypeError("Signed Project metadata file was not validated.");
    const buffers = [];
    const fileHasher = createHash("sha256");
    let length = 0;
    for (const chunk of file.chunks) {
      signal?.throwIfAborted();
      const bytes = await publication.store.read(chunk.hash, chunk.size);
      signal?.throwIfAborted();
      length += bytes.length;
      if (length > file.size) throw new Error("Signed metadata exceeds the declared byte length.");
      fileHasher.update(bytes);
      buffers.push(bytes);
    }
    if (length !== file.size || fileHasher.digest("hex") !== file.fileHash)
      throw new Error("Signed metadata file hash does not match its staged chunks.");
    let decoded;
    try { decoded = new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(buffers,length)); }
    catch { decoded = ""; }
    // RegExp.matchAll uses a fresh regex cursor for every file. Exactly one
    // canonical nonzero GUID is required for a valid Unity .meta companion.
    const matches = [...decoded.matchAll(guidLine)];
    if (matches.length !== 1 || /^0{32}$/u.test(matches[0][1])) {
      if (touchedSource(file.path,touched)) invalidGuidPaths.push(file.path);
      continue;
    }
    const guid = matches[0][1].toLowerCase();
    const same = seen.get(guid) ?? [];
    same.push(file.path);
    seen.set(guid,same);
  }
  for (const paths of seen.values()) {
    if (paths.length < 2) continue;
    for (const path of paths)
      if (touchedSource(path,touched)) duplicateGuidPaths.add(path);
  }
  return {status:"verified",auditedMetadataFiles:metadata.length,
    duplicateGuidPaths:[...duplicateGuidPaths].sort(),
    invalidGuidPaths:invalidGuidPaths.sort()};
}
