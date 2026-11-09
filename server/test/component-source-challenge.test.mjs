import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { baselineCanonicalPayload } from "../src/project-coordinator.mjs";
import { createProjectCoordinatorCore } from "../src/project-coordinator-core.mjs";
import { createSessionAuthority, makeSessionKey } from "../src/session-authority.mjs";
import {
  issueComponentSourceChallenge,
  consumeComponentSourceChallenge,
} from "../src/component-source-challenge.mjs";

const sceneId = "0123456789abcdef0123456789abcdef";
const projectId = "source-probe-project";
const sessionId = "first-session";
function fixture() {
  const coordinator = createProjectCoordinatorCore({
    maxProjectPeersPerSession: 5, maxProjectRegistries: 5,
    maxSnapshotBytes: 1_000_000,
  });
  const authority = createSessionAuthority({
    maxPeersPerSession: 5, maxOperationsPerSession: 10_000,
    maxLocksPerSession: 20, maxLocksPerConnection: 10,
  });
  const connection = {
    connectionId: "current-editor", userId: "editor-1",
    userName: "Editor", userColor: "#556677",
    projectId, sessionId, sessionKey: makeSessionKey(projectId, sessionId),
    supportsPresence: true, supportsHierarchySync: true,
    supportsProjectTransfer: true, supportsTransformSync: true,
    projectClientRegistered: false,
  };
  assert.equal(coordinator.dispatch({
    type: "register_client", connection, nowUnixMs: 1000,
  }).error, null);
  authority.dispatch({
    type: "register_presence", connection,
    requestId: "register", nowUnixMs: 1000,
  });
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  const keyId = createHash("sha256").update(spki).digest("hex");
  const publisher = (revision, manifestHash = "a".repeat(64)) => {
    const value = {
      userId: connection.userId,
      projectUuid: "01234567-89ab-4def-a012-3456789abcde",
      baselineRevision: revision, manifestHash, descriptorHash: "",
      unityVersion: "6000.3.21f1", teamForgePackageVersion: "0.5.1",
      realtimeProtocolVersion: 1, transferProtocolVersion: 1,
      manifestSchemaVersion: 1,
      ownerKeyId: keyId, ownerPublicKey: spki.toString("base64"),
      publisherKeyId: keyId, publisherPublicKey: spki.toString("base64"),
      publisherAuthorization: "", baselineSignature: "",
    };
    const payload = baselineCanonicalPayload(projectId, value);
    value.descriptorHash = createHash("sha256").update(Buffer.from(payload)).digest("hex");
    value.baselineSignature = sign(null, Buffer.from(payload), privateKey).toString("base64");
    const result = coordinator.dispatch({
      type: "baseline_publish", connection, nowUnixMs: revision * 2000,
      message: { type: "project_baseline_publish", protocolVersion: 1,
        requestId: "publish-" + revision, ...value },
    });
    assert.equal(result.error, undefined);
  };
  publisher(1);
  return {
    coordinator, authority, connection, publisher,
    issue: (scene = sceneId, now = 100_000, actor = connection) =>
      issueComponentSourceChallenge(coordinator, authority, actor, scene, now),
    consume: (nonce, now = 100_001, actor = connection, scene = sceneId) =>
      consumeComponentSourceChallenge(coordinator, authority, actor, scene, nonce, now),
  };
}

test("WP6 nonce binds exact signed live Project epoch, Session, Editor and Scene; single-use and no authority", () => {
  const f = fixture();
  const issued = f.issue();
  assert.match(issued.nonce, /^[a-f0-9]{64}$/);
  assert.equal(issued.status, "server_source_freshness_probe_unverified");
  assert.equal(issued.manifestHash, "a".repeat(64));
  assert.equal(issued.sceneBytesAttested, false);
  assert.equal(issued.editorApplyVerified, false);
  assert.equal(issued.networkWriteAuthorized, false);
  assert(Object.isFrozen(issued));
  assert.equal(f.issue().error, "component_source_challenge_outstanding");
  const consumed = f.consume(issued.nonce);
  assert.equal(consumed.status, "same_connection_challenge_echo_unverified");
  assert.equal(consumed.challengeConsumed, true);
  assert.equal(consumed.sceneBytesAttested, false);
  assert.equal(consumed.editorApplyVerified, false);
  assert.equal(consumed.networkWriteAuthorized, false);
  assert.equal(f.consume(issued.nonce).error, "component_source_challenge_absent");
  const next = f.issue();
  assert.notEqual(next.nonce, issued.nonce);
  assert.equal(f.consume(next.nonce).status, "same_connection_challenge_echo_unverified");
  const session = f.authority.activeSession(f.connection).session;
  assert.equal(session.revision, 0);
  assert.equal(session.operations.size, 0);
});

test("WP6 incorrect nonce burns challenge, no brute-force/replay; expired challenges cannot confirm", () => {
  const f = fixture();
  const old = f.issue();
  assert.equal(f.consume("f".repeat(64)).error, "component_source_challenge_nonce_mismatch");
  assert.equal(f.consume(old.nonce).error, "component_source_challenge_absent");
  const next = f.issue(sceneId, 100_010);
  assert.equal(f.consume(next.nonce, 115_010).error, "component_source_challenge_expired");
  assert.equal(f.consume(next.nonce).error, "component_source_challenge_absent");
});

test("WP6 Baseline rotation and tampering invalidate outstanding nonce", () => {
  const f = fixture();
  const old = f.issue();
  f.publisher(2, "b".repeat(64));
  assert.equal(f.consume(old.nonce).error, "component_source_challenge_epoch_changed");
  assert.equal(f.consume(old.nonce).error, "component_source_challenge_absent");
  const issued = f.issue();
  f.coordinator.projects.get(projectId).baseline.baselineSignature =
    Buffer.alloc(64).toString("base64");
  assert.equal(f.consume(issued.nonce).error, "component_source_challenge_epoch_changed");
  assert.equal(f.issue().error, "component_recovery_signed_baseline_required");
});

test("WP6 changed Scene or replaced exact Project member can't use another connection's challenge", () => {
  const f = fixture();
  const issued = f.issue();
  assert.equal(f.consume(issued.nonce, 100_001, {
    ...f.connection,
  }).error, "component_source_challenge_absent");
  assert.equal(f.consume(issued.nonce, 100_001, f.connection,
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").error, "component_source_challenge_epoch_changed");
  assert.equal(f.consume(issued.nonce).error, "component_source_challenge_absent");
  const newNonce = f.issue();
  const replacement = {
    ...f.connection, connectionId: "replacement", projectClientRegistered: false,
  };
  assert.equal(f.coordinator.dispatch({
    type: "register_client", connection: replacement, nowUnixMs: 3000,
  }).error, null);
  assert.equal(f.consume(newNonce.nonce).error, "component_source_challenge_epoch_changed");
});

test("WP6 realtime Session revision advancement invalidates an outstanding Scene challenge", () => {
  const f = fixture();
  const issued = f.issue();
  const session = f.authority.activeSession(f.connection).session;
  assert.equal(issued.sessionRevision, session.revision);
  // Simulate a separately accepted Session operation advancing its
  // authority epoch before the as-yet-unverified source echo arrives.
  session.revision += 1;
  assert.equal(f.consume(issued.nonce).error, "component_source_challenge_epoch_changed");
  assert.equal(f.consume(issued.nonce).error, "component_source_challenge_absent");
});

test("WP6 malformed Scene/nonce/timestamp and missing registration always fail closed", () => {
  const f = fixture();
  for (const badScene of [sceneId.toUpperCase(), "scene-one", "", null,
    "00000000000000000000000000000000"]) {
    assert.equal(f.issue(badScene).error, "component_source_challenge_invalid");
  }
  assert.equal(f.issue(sceneId, Number.MAX_SAFE_INTEGER).error,
    "component_source_challenge_invalid");
  assert.equal(f.consume("a".repeat(63)).error, "component_source_challenge_invalid");
  assert.equal(f.consume("z".repeat(64)).error, "component_source_challenge_invalid");
  const clone = { ...f.connection };
  assert.equal(f.issue(sceneId, 100_000, clone).error,
    "component_recovery_project_membership_required");
});
