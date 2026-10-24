import assert from "node:assert/strict";
import test from "node:test";
import {
  observeIndependentColliderComparison,
  registerFirstEditorColliderEvidence,
} from "../src/component-observation-evidence.mjs";

const fixture = () => {
  const owner = { userId: "first-editor", connectionId: "origin-1" };
  const alice = { userId: "alice", connectionId: "alice-1" };
  const bob = { userId: "bob", connectionId: "bob-1" };
  const session = {
    revision: 0,
    members: new Map([
      [owner.userId, { connectionId: owner.connectionId }],
      [alice.userId, { connectionId: alice.connectionId }],
      [bob.userId, { connectionId: bob.connectionId }],
    ]),
  };
  const request = {
    sceneId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    objectId: "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-10-0",
    componentId: "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-20-0",
    typeName: "UnityEngine.BoxCollider",
    baseRevision: 0,
  };
  assert.equal(registerFirstEditorColliderEvidence(session, owner, request), true);
  return { session, owner, alice, bob, request };
};
const verdict = status => ({ status });

test("WP6 peer corroboration counts two different current Editors but never counts the declarer", () => {
  const { session, owner, alice, bob, request } = fixture();
  const original = observeIndependentColliderComparison(
    session, owner, request, verdict("observations_match"));
  assert.deepEqual(original, {
    evidenceLevel: "unverified_peer_observations",
    agreeingPeerCount: 0,
    divergingPeerCount: 0,
  });
  const first = observeIndependentColliderComparison(
    session, alice, request, verdict("observations_match"));
  assert.equal(first.agreeingPeerCount, 1);
  assert.equal(first.divergingPeerCount, 0);
  const other = observeIndependentColliderComparison(
    session, bob, request, verdict("observations_match"));
  assert.equal(other.agreeingPeerCount, 2);
  assert.equal(other.divergingPeerCount, 0);
  assert.equal(Object.isFrozen(other), true);
});

test("WP6 one identity's new disagreement replaces rather than inflates a previous matching report", () => {
  const { session, alice, bob, request } = fixture();
  observeIndependentColliderComparison(session, alice, request, verdict("observations_match"));
  observeIndependentColliderComparison(session, bob, request, verdict("observations_match"));
  let result = observeIndependentColliderComparison(
    session, alice, request, verdict("observations_differ"));
  assert.equal(result.agreeingPeerCount, 1);
  assert.equal(result.divergingPeerCount, 1);
  result = observeIndependentColliderComparison(
    session, alice, request, verdict("observations_differ"));
  assert.equal(result.agreeingPeerCount, 1);
  assert.equal(result.divergingPeerCount, 1);
  result = observeIndependentColliderComparison(
    session, alice, request, verdict("observations_match"));
  assert.equal(result.agreeingPeerCount, 2);
  assert.equal(result.divergingPeerCount, 0);
});

test("WP6 disconnected and superseded connections lose corroboration automatically", () => {
  const { session, alice, bob, request } = fixture();
  observeIndependentColliderComparison(session, alice, request, verdict("observations_match"));
  observeIndependentColliderComparison(session, bob, request, verdict("observations_match"));
  session.members.delete(alice.userId);
  let evidence = observeIndependentColliderComparison(
    session, bob, request, verdict("observations_differ"));
  assert.equal(evidence.agreeingPeerCount, 0);
  assert.equal(evidence.divergingPeerCount, 1);

  session.members.set(alice.userId, { connectionId: "alice-2" });
  evidence = observeIndependentColliderComparison(
    session, alice, request, verdict("observations_match"));
  assert.equal(evidence.agreeingPeerCount, 0,
    "The replaced connection cannot contribute a peer observation");
  assert.equal(evidence.evidenceLevel, "unavailable");
  evidence = observeIndependentColliderComparison(
    session, { ...alice, connectionId: "alice-2" }, request, verdict("observations_match"));
  assert.equal(evidence.agreeingPeerCount, 1);
  assert.equal(evidence.divergingPeerCount, 1);
});

test("WP6 a stale revision or different Component never returns live corroboration", () => {
  const { session, alice, request } = fixture();
  observeIndependentColliderComparison(session, alice, request, verdict("observations_match"));
  session.revision = 1;
  let evidence = observeIndependentColliderComparison(
    session, alice, request, verdict("observations_match"));
  assert.equal(evidence.evidenceLevel, "unavailable");
  assert.equal(evidence.agreeingPeerCount, 0);
  session.revision = 0;
  evidence = observeIndependentColliderComparison(
    session, alice, { ...request, componentId: "other-component" },
    verdict("observations_match"));
  assert.equal(evidence.evidenceLevel, "unavailable");
  assert.equal(evidence.divergingPeerCount, 0);
});

test("WP6 origin can be registered only once and malformed verdicts cannot inject evidence", () => {
  const { session, owner, alice, request } = fixture();
  assert.equal(registerFirstEditorColliderEvidence(session, owner, request), false);
  let evidence = observeIndependentColliderComparison(
    session, alice, request, { status: "attested_trusted" });
  assert.equal(evidence.evidenceLevel, "unavailable");
  evidence = observeIndependentColliderComparison(
    session, alice, request, verdict("observations_match"));
  assert.equal(evidence.evidenceLevel, "unverified_peer_observations");
  assert.equal(evidence.agreeingPeerCount, 1);
});
