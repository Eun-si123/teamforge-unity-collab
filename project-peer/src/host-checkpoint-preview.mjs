import { isDeepStrictEqual } from "node:util";
import { SHA256_PATTERN, UUID_PATTERN } from "./constants.mjs";
import { fail } from "./errors.mjs";
import { loadLaunchSettings } from "./launch-settings.mjs";
import { buildManifest } from "./manifest.mjs";
import { ProjectPeerEngine } from "./project-peer.mjs";
import { publicPublishReview } from "./publication-plan.mjs";
import { loadStoredPublication, readPublishedBaseline } from "./stored-publication.mjs";
import { readUnityProjectDescriptor } from "./unity-project-descriptor.mjs";
import { missingChangedAssetMetadata, previewRetainedM4SourceChanges }
  from "./baseline-transition-source-preview.mjs";
export { missingChangedAssetMetadata, previewRetainedM4SourceChanges }
  from "./baseline-transition-source-preview.mjs";

const discardChunks = Object.freeze({ put() {} });
const reviewFields = ["addedPreview", "changedPreview", "deletedPreview"];
const unsafeDisplayCharacters = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

function matchesBaseline(value, pin) {
  return value?.projectUuid === pin.projectUuid && value.baselineRevision === pin.revision &&
    value.manifestHash === pin.manifestHash && value.descriptorHash === pin.descriptorHash;
}

function changedBaseline() {
  fail("host_preview_baseline_changed", "The current approved Project changed. Check Host status and review again.");
}

async function capturePreviewSource(launch, pin) {
  if (launch.settings.projectUuid !== pin.projectUuid) changedBaseline();
  const [source, published] = await Promise.all([
    readUnityProjectDescriptor(launch.sourceProjectRoot, {
      explicitPath: launch.projectDescriptorPath, expectedProjectUuid: pin.projectUuid, required: true,
    }),
    readPublishedBaseline({ managedRoot: launch.managedRoot, projectUuid: pin.projectUuid }),
  ]);
  if (!matchesBaseline(source.descriptor, pin) || !matchesBaseline(published, pin)) changedBaseline();
  return { source, published };
}

// Host previews expose short relative filenames only. A very deep path can
// contribute to exact counts without overflowing the Editor's response limit.
function boundedReview(review, missingMetadata = []) {
  const result = { ...publicPublishReview(review) };
  for (const field of reviewFields) {
    const entries = result[field];
    result[field] = entries.filter(value => Buffer.byteLength(value, "utf8") <= 640 &&
      !unsafeDisplayCharacters.test(value));
    result.previewTruncated ||= result[field].length !== entries.length;
  }
  const safe = missingMetadata.filter(value => Buffer.byteLength(value, "utf8") <= 640 &&
    !unsafeDisplayCharacters.test(value));
  result.missingAssetMetaCount = missingMetadata.length;
  result.missingAssetMetaPreview = safe.slice(0, 20);
  result.missingAssetMetaTruncated = result.missingAssetMetaPreview.length !== missingMetadata.length;
  return result;
}

export async function previewHostCheckpoint({
  launchSettingsPath, launchSettingsDigest, projectUuid, revision, manifestHash, descriptorHash,
}, scanManifest = buildManifest) {
  if (typeof launchSettingsPath !== "string" || !launchSettingsPath ||
      typeof launchSettingsDigest !== "string" || !SHA256_PATTERN.test(launchSettingsDigest) ||
      typeof projectUuid !== "string" || !UUID_PATTERN.test(projectUuid) || projectUuid !== projectUuid.toLowerCase() ||
      !Number.isSafeInteger(revision) || revision < 1 ||
      typeof manifestHash !== "string" || !SHA256_PATTERN.test(manifestHash) ||
      typeof descriptorHash !== "string" || !SHA256_PATTERN.test(descriptorHash)) {
    fail("invalid_host_preview_request", "An exact Host baseline is required before checking saved Project changes.");
  }
  const baseline = Object.freeze({ projectUuid, revision, manifestHash, descriptorHash });
  const launch = await loadLaunchSettings(launchSettingsPath, { requireSeedSource: true });
  if (launch.digest !== launchSettingsDigest) changedBaseline();
  const before = await capturePreviewSource(launch, baseline);
  const approved = await loadStoredPublication({
    managedRoot: launch.managedRoot, projectId: launch.settings.projectId, projectUuid, manifestHash, requireApproved: true,
  });
  if (!matchesBaseline(approved.descriptor, baseline) || approved.descriptor.ownerKeyId !== before.published.ownerKeyId ||
      approved.descriptor.unityVersion !== before.source.descriptor.unityVersion) changedBaseline();

  const { manifest } = await scanManifest({
    projectRoot: launch.sourceProjectRoot,
    projectUuid,
    baselineRevision: revision,
    chunkSize: approved.manifest.chunkSize,
    store: discardChunks,
  });

  const currentLaunch = await loadLaunchSettings(launch.filePath, { requireSeedSource: true });
  if (currentLaunch.digest !== launch.digest) changedBaseline();
  const after = await capturePreviewSource(currentLaunch, baseline);
  if (after.source.digest !== before.source.digest || !isDeepStrictEqual(after.published, before.published)) changedBaseline();

  const engine = new ProjectPeerEngine({ managedRoot: launch.managedRoot });
  const review = engine.summarizePublicationChanges(manifest, approved.manifest);
  review.reuseExistingBaseline = review.addedCount + review.changedCount + review.deletedCount === 0;
  const missingMetadata = missingChangedAssetMetadata(manifest, review);
  const transition = previewRetainedM4SourceChanges(approved.manifest, manifest, review, missingMetadata);
  return { state: "preview_ready", baseline, review: boundedReview(review, missingMetadata), transition };
}
