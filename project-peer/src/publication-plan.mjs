import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { fail, TeamForgePeerError } from "./errors.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sortedPreview(values) {
  return Object.freeze([...values].sort().slice(0, 20));
}

// The Publish fingerprint must not hash an unbounded or swapped file after
// loadLaunchSettings has inspected the path. Keep its byte budget identical.
const MAXIMUM_LAUNCH_SETTINGS_BYTES = 65_536;

export async function launchSettingsDigest(filePath) {
  let handle;
  try {
    const before = await lstat(filePath, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() ||
        before.size <= 0n || before.size > BigInt(MAXIMUM_LAUNCH_SETTINGS_BYTES)) {
      fail("invalid_launch_settings_file", "Publish review requires a bounded regular launch settings file.");
    }
    const flags = constants.O_RDONLY | (process.platform === "win32" ? 0 :
      (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    handle = await open(filePath, flags);
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.size !== before.size ||
        opened.dev !== before.dev || opened.ino !== before.ino) {
      fail("invalid_launch_settings_file", "Launch settings changed before Publish review hashing.");
    }
    // The 64 KiB size budget makes this conversion exact and bounded.
    const bytes = Buffer.allocUnsafe(Number(opened.size) + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (BigInt(length) !== opened.size) {
      fail("invalid_launch_settings_file", "Launch settings changed while Publish review was hashing.");
    }
    const [after, current] = await Promise.all([
      handle.stat({ bigint: true }), lstat(filePath, { bigint: true }),
    ]);
    if (!after.isFile() || after.size !== opened.size ||
        after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs ||
        !current.isFile() || current.isSymbolicLink() ||
        current.dev !== opened.dev || current.ino !== opened.ino ||
        current.size !== opened.size) {
      fail("invalid_launch_settings_file", "Launch settings changed while Publish review was hashing.");
    }
    return sha256(bytes.subarray(0, length));
  } catch (error) {
    if (error instanceof TeamForgePeerError) throw error;
    fail("launch_settings_load_failed", "Could not safely hash launch settings for Publish review.");
  } finally {
    await handle?.close();
  }
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
