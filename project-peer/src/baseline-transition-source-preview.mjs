// Shared PURE Manifest-delta inspection for the standalone Project Peer AND
// Coordinator server. This module must never import the Project Peer Engine,
// CoordinatorClient or any WebSocket/transport dependency: the server can be
// installed with ONLY server/node_modules (CI and deployed Coordinator).
import { validateManifest } from "./manifest.mjs";

const unsafeDisplayCharacters = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

// Same file identity rules as ProjectPeerEngine.summarizePublicationChanges;
// no source file reads and no transport clients. Current and previous signed
// Manifests must be fully validated before the caller examines the delta.
export function summarizeSignedManifestChanges(currentManifest, previousManifest) {
  validateManifest(currentManifest);
  validateManifest(previousManifest, { expectedProjectUuid: currentManifest.projectUuid });
  const before = new Map(previousManifest.files.map(file => [file.path, file]));
  const after = new Map(currentManifest.files.map(file => [file.path, file]));
  const added = [], changed = [], deleted = [];
  for (const [path, file] of after) {
    const old = before.get(path);
    if (!old) added.push(path);
    else if (old.fileHash !== file.fileHash || old.executable !== file.executable ||
        old.kind !== file.kind || old.script !== file.script) changed.push(path);
  }
  for (const path of before.keys()) if (!after.has(path)) deleted.push(path);
  return { added, changed, deleted };
}

// A copied FBX/Prefab/texture without its Unity .meta companion can be
// transferred byte-perfectly yet lose stable GUID references on the Guest.
// This diagnostic is scoped to the actual signed delta, including a removed
// .meta for a retained Asset, rather than flagging every legacy fixture file.
// It is read-only: only Unity should generate/recover original GUID metadata.
export function missingChangedAssetMetadata(manifest, review) {
  const present = new Set(manifest.files.map(file => file.path));
  const touched = new Set();
  const isAsset = path => typeof path === "string" && path.startsWith("Assets/") &&
    !path.endsWith(".meta") && path.length > "Assets/".length;
  for (const path of [...review.added, ...review.changed])
    if (isAsset(path) && !present.has(`${path}.meta`)) touched.add(path);
  for (const meta of review.deleted)
    if (typeof meta === "string" && meta.startsWith("Assets/") && meta.endsWith(".meta")) {
      const asset = meta.slice(0, -".meta".length);
      if (isAsset(asset) && present.has(asset) && !present.has(meta)) touched.add(asset);
    }
  return [...touched].sort();
}

// Unity requires each Asset's .meta GUID to be unique. A pair of .meta files
// with identical signed fileHash necessarily has identical bytes (and thus
// the same GUID, when valid). Flag only the newly touched companion paths:
// historical duplicates outside the update cannot turn an exact no-op into a
// new failure. Different .meta bytes with the same GUID are NOT detected here;
// that requires a separately bounded content-level Unity GUID audit.
export function identicalChangedAssetMetadata(manifest, review) {
  const hashes = new Map();
  for (const file of manifest.files) {
    if (!file.path.startsWith("Assets/") || !file.path.endsWith(".meta") ||
        typeof file.fileHash !== "string" || !/^[0-9a-f]{64}$/u.test(file.fileHash)) continue;
    const group = hashes.get(file.fileHash) ?? [];
    group.push(file.path);
    hashes.set(file.fileHash, group);
  }
  const touched = new Set([...review.added, ...review.changed]);
  const collisions = [];
  for (const paths of hashes.values()) {
    if (paths.length < 2) continue;
    for (const path of paths) {
      if (touched.has(path) || touched.has(path.slice(0, -5)))
        collisions.push(path);
    }
  }
  return collisions.sort();
}

// This is a necessary SOURCE-side check for a future M4->M5 durable
// checkpoint transition, NOT permission to perform that transition. Runtime
// Collider edits are pinned to the exact signed Scene and .meta bytes; old
// GUID/Prefab/code changes require explicit reconciliation before retargeting
// any live Session. Keep this an immutable Manifest comparison; no read of
// untrusted source paths beyond the already validated manifest scan.
export function previewRetainedM4SourceChanges(approvedManifest, candidateManifest, review,
  missingMetadata = [], guidAudit = null) {
  const before = new Set(approvedManifest.files.map(file => file.path));
  const current = new Set(candidateManifest.files.map(file => file.path));
  const changed = new Set([...review.added, ...review.changed, ...review.deleted]);
  const savedScenes = [...before].filter(file => file.startsWith("Assets/") && file.endsWith(".unity"));
  const sceneSource = [];
  const priorMeta = [];
  const runtimeSources = [];
  const existingPrefabs = [];
  const priorAssets = [];
  for (const file of changed) {
    if (file.startsWith("Assets/") && (file.endsWith(".unity") || file.endsWith(".unity.meta")))
      sceneSource.push(file);
    if (before.has(file) && file.endsWith(".meta")) priorMeta.push(file);
    if (file.startsWith("Packages/") || file.startsWith("ProjectSettings/") ||
        /(?:\.(?:cs|asmdef|asmref|rsp|dll|exe|so|dylib|aar|jar))$/iu.test(file)) runtimeSources.push(file);
    if (before.has(file) && file.startsWith("Assets/") && file.endsWith(".prefab")) existingPrefabs.push(file);
    else if (before.has(file) && file.startsWith("Assets/") && !file.endsWith(".meta") &&
             !file.endsWith(".unity")) priorAssets.push(file);
  }
  // Even a previously missing original Scene .meta cannot establish a safe
  // continuity proof. Never infer that a matching Scene filename is enough.
  for (const scene of savedScenes)
    if (!before.has(`${scene}.meta`) || !current.has(scene) || !current.has(`${scene}.meta`))
      sceneSource.push(`${scene}.meta`);
  const identicalMeta = identicalChangedAssetMetadata(candidateManifest, review);
  const duplicateGuidPaths = guidAudit?.duplicateGuidPaths ?? [];
  const invalidGuidPaths = guidAudit?.invalidGuidPaths ?? [];
  const blockers = [...new Set([...sceneSource, ...priorMeta, ...runtimeSources,
    ...existingPrefabs, ...priorAssets, ...missingMetadata, ...identicalMeta,
    ...duplicateGuidPaths, ...invalidGuidPaths])].sort();
  const sourceOnlyCandidate = savedScenes.length > 0 && changed.size > 0 && blockers.length === 0;
  const status = changed.size === 0 && blockers.length === 0 ? "no_saved_changes" :
    sourceOnlyCandidate ? "source_inputs_unchanged" : "source_reconciliation_required";
  const bounded = blockers.filter(file => Buffer.byteLength(file, "utf8") <= 256 &&
    !unsafeDisplayCharacters.test(file)).slice(0, 12);
  return {
    status,
    retainedSceneCount: savedScenes.length,
    sceneSourceChangeCount: new Set(sceneSource).size,
    priorMetadataChangeCount: priorMeta.length,
    runtimeSourceChangeCount: runtimeSources.length,
    existingPrefabChangeCount: existingPrefabs.length,
    priorAssetChangeCount: priorAssets.length,
    identicalMetaCount: identicalMeta.length,
    duplicateGuidCount: duplicateGuidPaths.length,
    invalidGuidCount: invalidGuidPaths.length,
    blockerCount: blockers.length,
    blockersPreview: bounded,
    blockersTruncated: bounded.length !== blockers.length,
  };
}
