import assert from "node:assert/strict";
import test from "node:test";
import {
  assessWindowsUnityActivePath,
  enforceNoOpPublishPolicy,
  isNoOpPublicationReview,
  transferRateOption,
} from "../src/cli-policy.mjs";

function review(overrides = {}) {
  return { firstPublish: false, addedCount: 0, changedCount: 0, deletedCount: 0, ...overrides };
}

test("no-op publish review is detected and requires explicit force", () => {
  assert.equal(isNoOpPublicationReview(review()), true);
  assert.throws(() => enforceNoOpPublishPolicy({}, review()), (error) => error.code === "no_content_changes");
  assert.doesNotThrow(() => enforceNoOpPublishPolicy({ "force-new-revision": true }, review()));
  assert.equal(isNoOpPublicationReview(review({ changedCount: 1 })), false);
});

test("sync partial-seed limiter keeps legacy alias and rejects conflicting values", () => {
  assert.equal(transferRateOption({ "max-bytes-per-second": "65536" }, { sync: true }), 65536);
  assert.equal(transferRateOption({ "partial-seed-max-bytes-per-second": "131072" }, { sync: true }), 131072);
  assert.throws(
    () => transferRateOption({ "max-bytes-per-second": "65536", "partial-seed-max-bytes-per-second": "131072" }, { sync: true }),
    (error) => error.code === "conflicting_cli_options",
  );
});

test("Windows Unity path preflight flags the field-reproduced long Active path but not short root", () => {
  const common = {
    projectUuid: "ccf4e312-29f6-419b-9548-68c1aaf5fe4d",
    baselineRevision: 2,
    manifestHash: "87401117d0ad0000000000000000000000000000000000000000000000000000",
    platform: "win32",
  };
  const longPath = assessWindowsUnityActivePath({
    ...common,
    managedRoot: "C:\\Users\\Dev\\Desktop\\TeamForge-v041-E2E-Receiver",
  });
  const shortPath = assessWindowsUnityActivePath({ ...common, managedRoot: "C:\\Users\\Dev\\TF-R" });
  assert.equal(longPath.highRisk, true);
  assert.equal(shortPath.highRisk, false);
  assert.ok(longPath.estimatedGeneratedPathLength >= 260);
});
