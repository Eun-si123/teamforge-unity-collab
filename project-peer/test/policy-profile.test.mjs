import assert from "node:assert/strict";
import test from "node:test";
import {
  LEGACY_CONNECTION_DEFAULTS,
  LEGACY_TRANSFER_DEFAULTS,
  LegacyPhase4Compatible,
  PROFILE_NAME,
  legacyProjectPeerProfile,
} from "../src/policy-profile.mjs";

test("LegacyPhase4Compatible freezes every Project Peer connection and transfer default", () => {
  assert.equal(LegacyPhase4Compatible.name, PROFILE_NAME);
  assert.deepEqual({ ...LegacyPhase4Compatible.connectionPolicy }, LEGACY_CONNECTION_DEFAULTS);
  assert.deepEqual({ ...LegacyPhase4Compatible.transferPolicy }, LEGACY_TRANSFER_DEFAULTS);
  assert(Object.isFrozen(LegacyPhase4Compatible));
  assert(Object.isFrozen(LegacyPhase4Compatible.connectionPolicy));
  assert(Object.isFrozen(LegacyPhase4Compatible.transferPolicy));
});

test("resolved override snapshot preserves legacy defaults for every unspecified value", () => {
  const profile = legacyProjectPeerProfile({
    transfer: { maxConcurrency: 7, retryRounds: 5, maxBytesPerSecond: 65_536 },
  });
  assert.equal(profile.name, PROFILE_NAME);
  assert.equal(profile.transferPolicy.maxConcurrency, 7);
  assert.equal(profile.transferPolicy.retryRounds, 5);
  assert.equal(profile.transferPolicy.maxBytesPerSecond, 65_536);
  assert.equal(profile.transferPolicy.retryBaseMilliseconds, 100);
  assert.equal(profile.connectionPolicy.coordinatorTimeoutMilliseconds, 10_000);
});

test("trust requirements describe the mandatory legacy flow without disable flags", () => {
  const trust = LegacyPhase4Compatible.trustRequirements;
  assert.deepEqual(Object.keys(trust).sort(), [
    "activationMode", "ownerTrustMode", "publisherApprovalMode",
  ]);
  assert.equal(Object.values(trust).some((value) => typeof value === "boolean"), false);
  assert.equal(trust.ownerTrustMode, "signed-invite-owner-pin");
  assert.equal(trust.publisherApprovalMode, "explicit-fingerprint-approval");
  assert.equal(trust.activationMode, "verified-staging-then-atomic-activation");
});
