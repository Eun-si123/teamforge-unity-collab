// Local Project Peer -> Unity Editor read-only source witness.
// Verify activated signed Manifest, then actual .unity and .meta file bytes.
// NO realtime Session, Inspector-value, Editor apply, or write authority.
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { ManagedProjectStore } from "./managed-project.mjs";
import { normalizeRelativePath } from "./path-policy.mjs";
import { assertNoRedirectedDirectorySegments } from "./filesystem-safety.mjs";
import { fail } from "./errors.mjs";

const MAX_SCENE_BYTES = 16 * 1024 * 1024;
const MAX_META_BYTES = 64 * 1024;
const GUID = /^[0-9a-f]{32}$/u;

function refused(message) {
  fail("wp6_active_scene_source_invalid",
    "WP6 signed Active Scene source rejected: " + message);
}
function sceneRelativePath(value) {
  if (typeof value !== "string" || value.length < 14 ||
      value.length > 1024 || !value.startsWith("Assets/") ||
      !value.endsWith(".unity") || value.includes("\\") || value.includes("\0"))
    refused("requires a canonical Assets/.../*.unity relative path");
  let normalized;
  try { normalized = normalizeRelativePath(value); }
  catch { refused("Scene path does not use canonical project-relative segments"); }
  if (normalized !== value) refused("Scene path is not canonical");
  return normalized;
}
function manifestEntry(manifest, wantedPath, maxBytes) {
  const rows = manifest.files.filter(row => row.path === wantedPath);
  if (rows.length !== 1 || rows[0].kind !== "asset" ||
      !Number.isSafeInteger(rows[0].size) || rows[0].size < 1 ||
      rows[0].size > maxBytes)
    refused("Scene or metadata is missing, duplicated or oversized in the signed Manifest");
  return rows[0];
}
async function hashActiveFile(activePath, relative, expected) {
  const destination = path.join(activePath, ...relative.split("/"));
  await assertNoRedirectedDirectorySegments(path.dirname(destination), {
    code: "wp6_active_scene_source_invalid",
    message: "Active Scene source path contains a redirected ancestor",
  });
  let observed;
  try { observed = await lstat(destination, { bigint: true }); }
  catch { refused("Active source file does not exist"); }
  if (!observed.isFile() || observed.isSymbolicLink() ||
      observed.size !== BigInt(expected.size))
    refused("Active Scene is not the signed exact-size regular file");

  let handle;
  try {
    const flags = fsConstants.O_RDONLY | (process.platform === "win32" ? 0 :
      ((fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0)));
    handle = await open(destination, flags);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.dev !== observed.dev ||
        before.ino !== observed.ino || before.size !== observed.size ||
        before.mtimeNs !== observed.mtimeNs || before.ctimeNs !== observed.ctimeNs)
      refused("Active source changed before read");

    const buffer = Buffer.alloc(Number(observed.size) + 1);
    let count = 0;
    while (count < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer, count, buffer.length - count, count);
      if (!bytesRead) break;
      count += bytesRead;
    }
    if (count !== Number(observed.size)) refused("Active source length changed");
    const after = await handle.stat({ bigint: true });
    const pathAfter = await lstat(destination, { bigint: true });
    if (!after.isFile() || !pathAfter.isFile() || pathAfter.isSymbolicLink() ||
        after.dev !== before.dev || after.ino !== before.ino ||
        after.size !== before.size || after.mtimeNs !== before.mtimeNs ||
        after.ctimeNs !== before.ctimeNs ||
        pathAfter.dev !== before.dev || pathAfter.ino !== before.ino ||
        pathAfter.size !== before.size || pathAfter.mtimeNs !== before.mtimeNs ||
        pathAfter.ctimeNs !== before.ctimeNs)
      refused("Active source changed while being read");
    const sha256 = createHash("sha256")
      .update(buffer.subarray(0, count)).digest("hex");
    if (sha256 !== expected.fileHash)
      refused("Active Scene source SHA-256 differs from signed Manifest");
    return buffer.subarray(0, count);
  } catch (error) {
    if (error?.code === "wp6_active_scene_source_invalid") throw error;
    refused("Active source could not be safely read");
  } finally {
    if (handle) await handle.close();
  }
}
function checkUnityTextScene(scene) {
  let source;
  try { source = new TextDecoder("utf-8", { fatal: true }).decode(scene); }
  catch { refused("Unity Scene source must be strict UTF-8 text"); }
  if (!source.startsWith("%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n") ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(source))
    refused("Unity Scene is not supported clean text YAML");
}
function checkMetaGuid(meta, sceneGuid) {
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(meta); }
  catch { refused("Scene metadata must use strict UTF-8"); }
  const lines = text.split(/\r?\n/u);
  const guids = lines.filter(line => /^\s*guid:/u.test(line));
  if (guids.length !== 1 || guids[0] !== "guid: " + sceneGuid)
    refused("Scene metadata GUID is missing, duplicated or differs");
}
function sameActive(a,b) {
  return a && b && [
    "projectUuid", "baselineRevision", "manifestHash", "descriptorHash",
    "publisherKeyId", "activeRelativePath",
  ].every(key => a[key] === b[key]) &&
    a.descriptor.ownerKeyId === b.descriptor.ownerKeyId &&
    a.descriptor.ownerPublicKey === b.descriptor.ownerPublicKey &&
    a.descriptor.baselineSignature === b.descriptor.baselineSignature;
}

// Actual Project Peer Active source, not caller-supplied hash claims.
export async function inspectWp6ActiveSceneProvenance({
  managed, scenePath, sceneGuid,
} = {}) {
  if (!(managed instanceof ManagedProjectStore))
    refused("requires an actual managed Project Peer Active store");
  const relative = sceneRelativePath(scenePath);
  if (typeof sceneGuid !== "string" || !GUID.test(sceneGuid) ||
      sceneGuid === "00000000000000000000000000000000")
    refused("requires a canonical nonzero 32-digit Unity Scene GUID");

  let before;
  try { before = await managed.validatedCurrent(); }
  catch { refused("signed Active Project failed full metadata verification"); }
  if (!before) refused("no complete signed Active Project exists");
  const sceneEntry = manifestEntry(before.manifest, relative, MAX_SCENE_BYTES);
  const metaEntry = manifestEntry(before.manifest, relative + ".meta", MAX_META_BYTES);
  const scene = await hashActiveFile(before.activePath, relative, sceneEntry);
  const meta = await hashActiveFile(before.activePath, relative + ".meta", metaEntry);
  checkUnityTextScene(scene);
  checkMetaGuid(meta, sceneGuid);
  // File IO yielded to event loop: reject source promotion or source mutation.
  let after;
  try { after = await managed.validatedCurrent(); }
  catch { refused("Active Project was invalidated during inspection"); }
  if (!sameActive(before, after)) refused("Active Project baseline changed during inspection");
  await hashActiveFile(after.activePath, relative, sceneEntry);
  await hashActiveFile(after.activePath, relative + ".meta", metaEntry);

  return Object.freeze({
    schemaVersion: 1,
    status: "signed_active_scene_file_bytes_verified_local",
    projectId: before.descriptor.projectId,
    projectUuid: before.projectUuid,
    baselineRevision: before.baselineRevision,
    manifestHash: before.manifestHash,
    descriptorHash: before.descriptorHash,
    ownerKeyId: before.descriptor.ownerKeyId,
    publisherKeyId: before.descriptor.publisherKeyId,
    sceneId: sceneGuid,
    scenePath: relative,
    sceneFileSha256: sceneEntry.fileHash,
    sceneFileBytes: scene.length,
    sceneMetaSha256: metaEntry.fileHash,
    manifestMembershipVerified: true,
    signedActiveFileBytesVerified: true,
    inspectorValuesVerified: false,
    currentServerSessionVerified: false,
    editorApplyVerified: false,
    networkWriteAuthorized: false,
  });
}
