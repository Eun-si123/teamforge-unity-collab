import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sortedPreview(values) {
  return Object.freeze([...values].sort().slice(0, 20));
}

export async function launchSettingsDigest(filePath) {
  return sha256(await readFile(filePath));
}

export function publicPublishReview(review) {
  return Object.freeze({
    firstPublish: review.firstPublish,
    reuseExistingBaseline: review.reuseExistingBaseline === true,
    added: review.addedCount,
    changed: review.changedCount,
    deleted: review.deletedCount,
    unchanged: review.unchangedCount,
    totalFiles: review.totalFiles,
    totalBytes: review.totalBytes,
    totalChunks: review.totalChunks,
    embeddedPackages: Object.freeze(review.embeddedPackages.map((item) => Object.freeze({ ...item }))),
    addedPreview: sortedPreview(review.added),
    changedPreview: sortedPreview(review.changed),
    deletedPreview: sortedPreview(review.deleted),
    previewTruncated: review.added.length > 20 || review.changed.length > 20 || review.deleted.length > 20,
  });
}

export function createPublishReviewFingerprint({
  launchDigest,
  sourceDescriptorDigest,
  baselineRevision,
  manifestHash,
  review,
  hostMode = "publish",
}) {
  const payload = {
    contract: "teamforge-publish-review-v1",
    hostMode,
    launchSettingsDigest: launchDigest,
    sourceDescriptorDigest,
    baselineRevision,
    manifestHash,
    review: {
      firstPublish: review.firstPublish,
      added: [...review.added].sort(),
      changed: [...review.changed].sort(),
      deleted: [...review.deleted].sort(),
      totalFiles: review.totalFiles,
      totalBytes: review.totalBytes,
      totalChunks: review.totalChunks,
    },
  };
  return sha256(JSON.stringify(payload));
}
