import { createHash } from "node:crypto";
import { lstat, open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_CHUNK_SIZE,
  MANIFEST_SCHEMA_VERSION,
  MAXIMUM_CHUNK_SIZE,
  MINIMUM_CHUNK_SIZE,
  SHA256_PATTERN,
  UUID_PATTERN,
} from "./constants.mjs";
import { canonicalJson } from "./canonical-json.mjs";
import { sha256 } from "./hash.mjs";
import { discoverProjectContent, normalizeRelativePath } from "./path-policy.mjs";
import { fail } from "./errors.mjs";

function validateChunkSize(chunkSize) {
  if (!Number.isInteger(chunkSize) || chunkSize < MINIMUM_CHUNK_SIZE || chunkSize > MAXIMUM_CHUNK_SIZE) {
    fail(
      "invalid_chunk_size",
      `Chunk size must be an integer between ${MINIMUM_CHUNK_SIZE} and ${MAXIMUM_CHUNK_SIZE}.`,
    );
  }
}

function unsignedManifest(manifest) {
  const { manifestHash: _manifestHash, signature: _signature, signatures: _signatures, ...unsigned } = manifest;
  return unsigned;
}

export function calculateManifestHash(manifest) {
  return sha256(Buffer.from(canonicalJson(unsignedManifest(manifest)), "utf8"));
}

async function hashFile(file, chunkSize, store) {
  const before = await stat(file.absolutePath);
  const handle = await open(file.absolutePath, "r");
  const fileHasher = createHash("sha256");
  const chunks = [];
  let offset = 0;
  try {
    while (offset < before.size) {
      const length = Math.min(chunkSize, before.size - offset);
      const buffer = Buffer.allocUnsafe(length);
      let filled = 0;
      while (filled < length) {
        const { bytesRead } = await handle.read(buffer, filled, length - filled, offset + filled);
        if (bytesRead === 0) {
          fail("source_changed", `Source file ended while being read: ${file.path}.`);
        }
        filled += bytesRead;
      }
      fileHasher.update(buffer);
      const hash = sha256(buffer);
      await store.put(buffer, hash);
      chunks.push({ hash, size: buffer.length, offset });
      offset += buffer.length;
    }
  } finally {
    await handle.close();
  }
  const after = await stat(file.absolutePath);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    fail("source_changed", `Source file changed while building the manifest: ${file.path}.`);
  }
  return {
    path: file.path,
    size: before.size,
    fileHash: fileHasher.digest("hex"),
    chunks,
    kind: file.kind,
    executable: file.executable,
    script: file.script,
  };
}

export async function assertEmbeddedPackageCoverage(projectRoot, manifestFiles) {
  const packagePath = path.resolve(projectRoot, "Packages");
  const entries = await readdir(packagePath, { withFileTypes: true });
  const paths = new Set(manifestFiles.map((file) => file.path));
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      continue;
    }
    const packageJson = path.resolve(packagePath, entry.name, "package.json");
    const info = await lstat(packageJson).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!info) {
      continue;
    }
    const expected = normalizeRelativePath(`Packages/${entry.name}/package.json`);
    if (!info.isFile() || info.isSymbolicLink() || !paths.has(expected)) {
      fail(
        "embedded_package_missing_from_manifest",
        `Embedded package at Packages/${entry.name} is missing its regular package.json from the Publish Manifest.`,
        { packagePath: `Packages/${entry.name}` },
      );
    }
  }
}

export async function buildManifest({
  projectRoot,
  projectUuid,
  baselineRevision,
  chunkSize = DEFAULT_CHUNK_SIZE,
  store,
}) {
  if (!UUID_PATTERN.test(projectUuid ?? "")) {
    fail("invalid_project_uuid", "projectUuid must be a canonical UUID.");
  }
  if (!Number.isSafeInteger(baselineRevision) || baselineRevision < 1) {
    fail("invalid_baseline_revision", "baselineRevision must be a positive safe integer.");
  }
  if (!store || typeof store.put !== "function") {
    fail("invalid_chunk_store", "A content-addressed ChunkStore is required.");
  }
  validateChunkSize(chunkSize);

  const discovery = await discoverProjectContent(projectRoot);
  const files = [];
  for (const file of discovery.files) {
    files.push(await hashFile(file, chunkSize, store));
  }
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  await assertEmbeddedPackageCoverage(projectRoot, files);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const totalChunks = files.reduce((sum, file) => sum + file.chunks.length, 0);
  const base = {
    manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
    projectUuid: projectUuid.toLowerCase(),
    baselineRevision,
    chunkSize,
    totalFiles: files.length,
    totalBytes,
    totalChunks,
    files,
  };
  const manifestHash = calculateManifestHash(base);
  const embeddedPackages = discovery.embeddedPackages.map((embedded) => {
    const prefix = `${embedded.path}/`;
    const packageFiles = files.filter((file) => file.path.startsWith(prefix));
    if (!packageFiles.some((file) => file.path === `${embedded.path}/package.json`)) {
      fail(
        "embedded_package_missing_from_manifest",
        `Embedded package ${embedded.name} is missing package.json from the Publish Manifest.`,
        { packageName: embedded.name, packagePath: embedded.path },
      );
    }
    return {
      ...embedded,
      fileCount: packageFiles.length,
      totalBytes: packageFiles.reduce((sum, file) => sum + file.size, 0),
      totalChunks: packageFiles.reduce((sum, file) => sum + file.chunks.length, 0),
    };
  });
  return { manifest: { ...base, manifestHash }, manifestHash, embeddedPackages };
}

function validInteger(value, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum;
}

export function validateManifest(manifest, {
  expectedProjectUuid = undefined,
  expectedManifestHash = undefined,
} = {}) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) ||
      manifest.manifestSchemaVersion !== MANIFEST_SCHEMA_VERSION ||
      !UUID_PATTERN.test(manifest.projectUuid ?? "") ||
      !validInteger(manifest.baselineRevision, 1) ||
      !validInteger(manifest.totalFiles) || !validInteger(manifest.totalBytes) ||
      !validInteger(manifest.totalChunks) || !Array.isArray(manifest.files)) {
    fail("invalid_manifest", "Manifest header is invalid.");
  }
  validateChunkSize(manifest.chunkSize);
  if (expectedProjectUuid && manifest.projectUuid.toLowerCase() !== expectedProjectUuid.toLowerCase()) {
    fail("project_uuid_mismatch", "Manifest Project UUID does not match the requested project.");
  }

  const paths = new Set();
  const foldedPaths = new Map();
  let totalBytes = 0;
  let totalChunks = 0;
  let previousPath = "";
  for (const file of manifest.files) {
    const normalized = normalizeRelativePath(file?.path);
    if (normalized !== file.path || (previousPath && previousPath >= file.path) || paths.has(file.path)) {
      fail("invalid_manifest_path_order", "Manifest file paths must be unique and strictly sorted.");
    }
    previousPath = file.path;
    paths.add(file.path);
    const folded = file.path.toLowerCase();
    if (foldedPaths.has(folded) && foldedPaths.get(folded) !== file.path) {
      fail("case_collision", "Manifest contains a case-insensitive path collision.");
    }
    foldedPaths.set(folded, file.path);
    if (!validInteger(file.size) || !SHA256_PATTERN.test(file.fileHash ?? "") ||
        !Array.isArray(file.chunks) || !["asset", "package", "projectSettings"].includes(file.kind) ||
        typeof file.executable !== "boolean" || typeof file.script !== "boolean") {
      fail("invalid_manifest_file", `Manifest file entry is invalid: ${file.path}.`);
    }
    let expectedOffset = 0;
    for (const chunk of file.chunks) {
      if (!SHA256_PATTERN.test(chunk?.hash ?? "") || !validInteger(chunk.size, 1) ||
          chunk.size > manifest.chunkSize || chunk.offset !== expectedOffset) {
        fail("invalid_manifest_chunk", `Manifest chunk entry is invalid: ${file.path}.`);
      }
      expectedOffset += chunk.size;
      totalChunks += 1;
    }
    if (expectedOffset !== file.size || (file.size === 0 && file.chunks.length !== 0)) {
      fail("invalid_manifest_file_size", `Manifest chunks do not reconstruct ${file.path}.`);
    }
    totalBytes += file.size;
  }
  if (manifest.totalFiles !== manifest.files.length || manifest.totalBytes !== totalBytes ||
      manifest.totalChunks !== totalChunks) {
    fail("invalid_manifest_totals", "Manifest totals do not match its file entries.");
  }
  const actualHash = calculateManifestHash(manifest);
  const declaredHash = manifest.manifestHash ?? actualHash;
  if (!SHA256_PATTERN.test(declaredHash) || declaredHash !== actualHash ||
      (expectedManifestHash && expectedManifestHash !== actualHash)) {
    fail("manifest_hash_mismatch", "Manifest hash verification failed.");
  }
  return { manifestHash: actualHash, totalBytes, totalChunks };
}

export function uniqueManifestChunks(manifest) {
  const chunks = new Map();
  for (const file of manifest.files) {
    for (const chunk of file.chunks) {
      const existing = chunks.get(chunk.hash);
      if (existing && existing.size !== chunk.size) {
        fail("chunk_size_conflict", `Chunk ${chunk.hash} has conflicting sizes.`);
      }
      chunks.set(chunk.hash, { hash: chunk.hash, size: chunk.size });
    }
  }
  return Array.from(chunks.values()).sort((left, right) => left.hash.localeCompare(right.hash));
}
