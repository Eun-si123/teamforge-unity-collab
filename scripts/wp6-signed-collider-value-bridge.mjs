// Offline WP6 monorepo integration only: signed Project Peer stored Scene
// bytes versus Publisher-signed, server-private complete Collider snapshot.
// Not a real Unity Editor witness or authenticated runtime transport.
import { createHash } from "node:crypto";
import { types as nodeTypes } from "node:util";
import { ChunkStore } from "../project-peer/src/content-store.mjs";
import { inspectWp6ProjectSceneAndPublisherObservationForLocalTest }
  from "./wp6-source-approval-bridge.mjs";
import { inspectWp6SerializedColliderValuesFromSignedTextForLocalTest }
  from "./wp6-signed-collider-values.mjs";

const MAX_SCENE = 16 * 1024 * 1024;
const MAX_CHUNKS = 2048;
function deny(code, reason) {
  return Object.freeze({ error: code, reason, repair: "resnapshot_required" });
}
function sameSource(a,b) {
  return a?.sceneFileSha256 === b?.sceneFileSha256 &&
    a?.sceneMetaSha256 === b?.sceneMetaSha256 &&
    a?.manifestHash === b?.manifestHash &&
    a?.descriptorHash === b?.descriptorHash &&
    a?.sceneId === b?.sceneId &&
    a?.scenePath === b?.scenePath &&
    a?.sceneFileBytes === b?.sceneFileBytes &&
    a?.projectUuid === b?.projectUuid &&
    a?.baselineRevision === b?.baselineRevision &&
    a?.realtimeRevision === b?.realtimeRevision &&
    a?.identityFingerprintSha256 === b?.identityFingerprintSha256 &&
    a?.propertyFingerprintSha256 === b?.propertyFingerprintSha256;
}

// Unlike #518's identity-only bridge, a success from this helper implies
// that *the signed stored Scene's* direct Collider YAML values equal the
// signed Publisher-approved in-memory observation. It cannot prove any
// current Unity Editor actually loaded or applied those bytes.
export async function inspectWp6PublisherColliderValuesInSignedSceneForLocalTest(args = {}) {
  if (!args || typeof args !== "object" || Array.isArray(args) ||
      nodeTypes.isProxy(args) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(args)) ||
      Reflect.ownKeys(Object.getOwnPropertyDescriptors(args)).some(key => {
        const descriptor = Object.getOwnPropertyDescriptor(args, key);
        return typeof key !== "string" || !descriptor ||
          !Object.hasOwn(descriptor, "value");
      }))
    return deny("wp6_collider_source_invalid", "The input must be an inert offline test context.");
  const source = await inspectWp6ProjectSceneAndPublisherObservationForLocalTest(args);
  if (source.error) return source;
  const { publication } = args;
  if (!publication || nodeTypes.isProxy(publication) ||
      !(publication.store instanceof ChunkStore)) {
    return deny("wp6_collider_source_invalid",
      "A real previously verified Project Peer publication is required.");
  }
  let yaml;
  try {
    const manifest = publication.manifest;
    if (!manifest || nodeTypes.isProxy(manifest) ||
        !Array.isArray(manifest.files) || nodeTypes.isProxy(manifest.files)) {
      return deny("wp6_collider_source_invalid", "Manifest file table is missing.");
    }
    const entries = manifest.files.filter(row => row?.path === source.scenePath);
    if (entries.length !== 1) return deny("wp6_collider_source_invalid", "Scene file is ambiguous.");
    const entry = entries[0];
    if (entry.fileHash !== source.sceneFileSha256 ||
        entry.size !== source.sceneFileBytes || entry.kind !== "asset" ||
        entry.size < 1 || entry.size > MAX_SCENE ||
        !Array.isArray(entry.chunks) ||
        entry.chunks.length < 1 || entry.chunks.length > MAX_CHUNKS) {
      return deny("wp6_collider_source_unsupported",
        "Only a signed small direct text Scene is supported for exact value comparison.");
    }
    const buffers = [];
    const sha = createHash("sha256");
    let size = 0;
    for (const part of entry.chunks) {
      const bytes = await ChunkStore.prototype.read.call(
        publication.store, part.hash, part.size);
      size += bytes.length;
      if (size > MAX_SCENE || size > entry.size)
        return deny("wp6_collider_source_invalid", "Stored Scene exceeds bounded file size.");
      sha.update(bytes);
      buffers.push(bytes);
    }
    if (size !== entry.size || sha.digest("hex") !== source.sceneFileSha256)
      return deny("wp6_collider_source_changed", "Signed stored Scene bytes changed.");
    yaml = Buffer.concat(buffers, size);
  } catch {
    return deny("wp6_collider_source_invalid",
      "Signed Scene bytes could not be reconstructed safely.");
  }

  const compared = inspectWp6SerializedColliderValuesFromSignedTextForLocalTest({
    sceneBytes: yaml, sceneGuid: source.sceneId,
    identityBaseline: args.identityBaseline,
    propertySnapshot: args.propertySnapshot,
  });
  if (compared.error) return compared;

  // Both source and Session can change during awaited chunk reads;
  // compare the exact two proofs again before publishing a result.
  const after = await inspectWp6ProjectSceneAndPublisherObservationForLocalTest(args);
  if (after.error) return after;
  if (!sameSource(source, after))
    return deny("wp6_collider_source_epoch_changed",
      "Published Scene or Publisher observation changed during value comparison.");

  return Object.freeze({
    status: "signed_stored_scene_collider_values_match_approved_snapshot_offline",
    projectUuid: source.projectUuid,
    baselineRevision: source.baselineRevision,
    manifestHash: source.manifestHash,
    descriptorHash: source.descriptorHash,
    sceneId: source.sceneId, scenePath: source.scenePath,
    sceneFileSha256: source.sceneFileSha256,
    sceneMetaSha256: source.sceneMetaSha256,
    realtimeRevision: source.realtimeRevision,
    identityFingerprintSha256: source.identityFingerprintSha256,
    propertyFingerprintSha256: source.propertyFingerprintSha256,
    componentCount: compared.componentCount,
    propertyCount: compared.propertyCount,
    serializedValuesVerified: true,
    editorApplyVerified: false,
    networkWriteAuthorized: false,
  });
}
