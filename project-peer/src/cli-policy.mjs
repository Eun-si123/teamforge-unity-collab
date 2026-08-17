import path from "node:path";
import { fail } from "./errors.mjs";

export const WINDOWS_UNITY_PACKAGE_CACHE_HEADROOM = 162;
export const WINDOWS_PATH_HIGH_RISK_LENGTH = 260;

export function isNoOpPublicationReview(review) {
  return Boolean(review && !review.firstPublish &&
    review.addedCount === 0 && review.changedCount === 0 && review.deletedCount === 0);
}

export function enforceNoOpPublishPolicy(options, review) {
  const force = options["force-new-revision"];
  if (force !== undefined && force !== true) {
    fail("invalid_cli_option", "Use --force-new-revision as a flag without a value.");
  }
  if (isNoOpPublicationReview(review) && force !== true) {
    fail(
      "no_content_changes",
      "No content changes detected. Use 'seed' to re-advertise the existing Baseline, or pass --force-new-revision only when a metadata-identical new revision is intentional.",
    );
  }
}

function numericOption(options, name) {
  if (options[name] === undefined) return undefined;
  const value = Number(options[name]);
  if (!Number.isInteger(value) || value < 0 || value > 1_073_741_824) {
    fail("invalid_cli_option", `--${name} must be an integer between 0 and 1073741824.`);
  }
  if (value > 0 && value < 65_536) {
    fail("invalid_cli_option", `--${name} must be 0 or at least 65536.`);
  }
  return value;
}

export function transferRateOption(options, { sync = false } = {}) {
  const legacy = numericOption(options, "max-bytes-per-second");
  if (!sync) return legacy ?? 0;
  const explicit = numericOption(options, "partial-seed-max-bytes-per-second");
  if (legacy !== undefined && explicit !== undefined && legacy !== explicit) {
    fail(
      "conflicting_cli_options",
      "--max-bytes-per-second and --partial-seed-max-bytes-per-second disagree. For sync, prefer the explicit partial-seed option.",
    );
  }
  return explicit ?? legacy ?? 0;
}

export function expectedActivePath({ managedRoot, projectUuid, baselineRevision, manifestHash, platform = process.platform }) {
  const activeName = `${baselineRevision}-${String(manifestHash).slice(0, 12)}`;
  const pathApi = platform === "win32" ? path.win32 : path;
  return pathApi.resolve(managedRoot, String(projectUuid).toLowerCase(), "active", activeName);
}

export function assessWindowsUnityActivePath({
  managedRoot,
  projectUuid,
  baselineRevision,
  manifestHash,
  platform = process.platform,
  packageCacheHeadroom = WINDOWS_UNITY_PACKAGE_CACHE_HEADROOM,
}) {
  const activePath = expectedActivePath({ managedRoot, projectUuid, baselineRevision, manifestHash, platform });
  const activePathLength = activePath.length;
  const estimatedGeneratedPathLength = activePathLength + packageCacheHeadroom;
  const applies = platform === "win32";
  const highRisk = applies && estimatedGeneratedPathLength >= WINDOWS_PATH_HIGH_RISK_LENGTH;
  return {
    applies,
    highRisk,
    activePath,
    activePathLength,
    packageCacheHeadroom,
    estimatedGeneratedPathLength,
    recommendation: highRisk
      ? "Choose a shorter managed root (for example C:\\TF) before opening the Active project in Unity. TeamForge does not change Windows LongPaths registry policy."
      : "",
  };
}
