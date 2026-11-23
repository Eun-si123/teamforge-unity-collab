// Complete, budgeted, READ-ONLY verification of a staged, signed M5 Manifest.
// A ChunkStore read verifies the individual content-addressed chunk hash;
// the streaming SHA-256 below also checks each reconstructed FILE hash, so a
// signed manifest with a bad file/chunk relationship cannot look complete.
// This does not promote a Project or promise that files remain present later.
// No network/Coordinator/ProjectPeerEngine imports: standalone Server safe.
import { createHash } from "node:crypto";

const DEFAULT_BUDGET = Object.freeze({
  maxFiles: 32_768,
  maxBytes: 256 * 1024 * 1024,
  maxChunks: 65_536,
});

/**
 * Read each source file in signed manifest order, never buffering a whole
 * asset/scene, and refuse partial results when the complete candidate is
 * over budget. Missing or modified staged chunks throw, not 'verified'.
 */
export async function auditSignedCandidateContents(publication, {
  signal,
  budget = DEFAULT_BUDGET,
} = {}) {
  const manifest = publication?.manifest;
  if (!Array.isArray(manifest?.files) ||
      !Number.isSafeInteger(manifest.totalFiles) || !Number.isSafeInteger(manifest.totalBytes) ||
      !Number.isSafeInteger(manifest.totalChunks) ||
      typeof publication.store?.read !== "function") {
    throw new TypeError("A previously verified signed Manifest and a checked ChunkStore are required.");
  }
  if (manifest.totalFiles > budget.maxFiles || manifest.totalBytes > budget.maxBytes ||
      manifest.totalChunks > budget.maxChunks) {
    // All-or-nothing. Verify no chunks if the requested signed project
    // exceeds limits, so 0/0/0 cannot be misread as an incomplete success.
    return {status:"resource_limit", verifiedFiles:0, verifiedBytes:0, verifiedChunks:0};
  }
  let verifiedFiles = 0, verifiedBytes = 0, verifiedChunks = 0;
  for (const file of manifest.files) {
    signal?.throwIfAborted();
    const sha = createHash("sha256");
    let size = 0;
    for (const chunk of file.chunks) {
      signal?.throwIfAborted();
      // read() rejects missing, symlinked, oversized, wrong-length and
      // hash-corrupt entries through its pinned, bounded file handle.
      const bytes = await publication.store.read(chunk.hash, chunk.size);
      signal?.throwIfAborted();
      if (bytes.length !== chunk.size || size + bytes.length > file.size)
        throw new Error("A stored chunk cannot reconstruct its signed file.");
      sha.update(bytes);
      size += bytes.length;
      verifiedChunks++;
    }
    if (size !== file.size || sha.digest("hex") !== file.fileHash)
      throw new Error("Stored candidate file digest differs from its signed Manifest.");
    verifiedFiles++;
    verifiedBytes += size;
  }
  // A direct caller must never be able to represent a truncated, malformed
  // manifest as fully verified even if it omitted some signed files/chunks.
  if (verifiedFiles !== manifest.totalFiles || verifiedBytes !== manifest.totalBytes ||
      verifiedChunks !== manifest.totalChunks)
    throw new Error("Signed candidate inventory totals do not match the verified content.");
  return {status:"verified", verifiedFiles, verifiedBytes, verifiedChunks};
}
