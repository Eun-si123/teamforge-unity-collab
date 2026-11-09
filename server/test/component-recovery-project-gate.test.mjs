import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { baselineCanonicalPayload } from "../src/project-coordinator.mjs";
import { createProjectCoordinatorCore } from "../src/project-coordinator-core.mjs";
import { createSessionAuthority, makeSessionKey } from "../src/session-authority.mjs";
import { inspectCurrentSignedProjectForRecoveryPreview } from
  "../src/component-recovery-project-gate.mjs";

const projectId = "component-project";
const sessionId = "preview";
const projectUuid = "58b9ee65-e855-45dd-a3f6-cce2a26faea8";

function fixture() {
  const coordinator = createProjectCoordinatorCore({
    maxProjectPeersPerSession: 5, maxProjectRegistries: 5,
    maxSnapshotBytes: 1_000_000,
  });
  const realtime = createSessionAuthority({
    maxPeersPerSession: 5, maxOperationsPerSession: 10_000,
    maxLocksPerSession: 20, maxLocksPerConnection: 10,
  });
  const connection = {
    connectionId: "viewer-a", userId: "editor-a",
    userName: "Editor", userColor: "#336699",
    projectId, sessionId, sessionKey: makeSessionKey(projectId, sessionId),
    supportsPresence: true, supportsHierarchySync: true,
    supportsProjectTransfer: true,
    supportsTransformSync: true,
    projectClientRegistered: false,
  };
  assert.equal(coordinator.dispatch({
    type: "register_client", connection, nowUnixMs: 1000,
  }).error, null);
  realtime.dispatch({
    type: "register_presence", connection,
    requestId: "join", nowUnixMs: 1000,
  });
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = publicKey.export({ format: "der", type: "spki" });
  const keyId = createHash("sha256").update(pub).digest("hex");
  function publish(revision = 1, manifestHash = "a".repeat(64)) {
    const value = {
      userId: connection.userId, projectUuid, baselineRevision: revision,
      manifestHash, descriptorHash: "",
      unityVersion: "6000.3.21f1", teamForgePackageVersion: "0.5.1",
      realtimeProtocolVersion: 1, transferProtocolVersion: 1,
      manifestSchemaVersion: 1,
      ownerKeyId: keyId, ownerPublicKey: pub.toString("base64"),
      publisherKeyId: keyId, publisherPublicKey: pub.toString("base64"),
      publisherAuthorization: "", baselineSignature: "",
    };
    const payload = baselineCanonicalPayload(projectId, value);
    value.descriptorHash = createHash("sha256").update(Buffer.from(payload)).digest("hex");
    value.baselineSignature = sign(null, Buffer.from(payload), privateKey).toString("base64");
    coordinator.dispatch({
      type: "baseline_publish", connection, nowUnixMs: 2000,
      message: { type: "project_baseline_publish", protocolVersion: 1,
        requestId: "publish-" + revision, ...value },
    });
  }
  const inspect = c => inspectCurrentSignedProjectForRecoveryPreview(
    coordinator, realtime, c ?? connection);
  return { coordinator, realtime, connection, publish, inspect };
}

test("WP6 signed Baseline and exact live Project plus realtime membership permit only read-only preview", () => {
  const f = fixture();
  assert.equal(f.inspect().error, "component_recovery_signed_baseline_required");
  f.publish();
  const result = f.inspect();
  assert.equal(result.status, "signed_project_baseline_current_preview_only");
  assert.equal(result.projectUuid, projectUuid);
  assert.equal(result.baselineRevision, 1);
  assert.equal(result.manifestHash, "a".repeat(64));
  assert.equal(result.sceneBytesAttested, false);
  assert.equal(result.editorApplyVerified, false);
  assert.equal(result.networkWriteAuthorized, false);
  assert(Object.isFrozen(result));
  assert.equal(f.realtime.activeSession(f.connection).session.revision, 0);
  assert.equal(f.realtime.activeSession(f.connection).session.operations.size, 0);
  f.publish(2, "b".repeat(64));
  assert.equal(f.inspect().baselineRevision, 2);
  assert.equal(f.inspect().manifestHash, "b".repeat(64));
});

test("WP6 forged copies, wrong session, unregistered and capability-revoked sockets fail", () => {
  const f = fixture();
  f.publish();
  for (const changed of [
    { ...f.connection },
    { ...f.connection, sessionKey: makeSessionKey(projectId, "wrong") },
    { ...f.connection, supportsProjectTransfer: false },
    { ...f.connection, supportsHierarchySync: false },
    { ...f.connection, projectClientRegistered: false },
  ]) {
    assert.equal(f.inspect(changed).error, "component_recovery_project_membership_required");
  }
  f.connection.supportsProjectTransfer = false;
  assert.equal(f.inspect().error, "component_recovery_project_membership_required");
  f.connection.supportsProjectTransfer = true;
  assert.equal(f.inspect().status, "signed_project_baseline_current_preview_only");
});

test("WP6 tampering with registered Owner, Publisher, signed Manifest or delegate refuses recovery", () => {
  for (const mutate of [
    project => { project.ownerKeyId = "0".repeat(64); },
    project => { project.ownerPublicKey = "wrong-key"; },
    project => { project.baseline.manifestHash = "f".repeat(64); },
    project => { project.baseline.publisherAuthorization = "AA=="; },
    project => { project.baseline.baselineSignature = Buffer.alloc(64).toString("base64"); },
    project => { project.baseline.teamForgePackageVersion = "0.0.0"; },
  ]) {
    const f = fixture();
    f.publish();
    mutate(f.coordinator.projects.get(projectId));
    assert.equal(f.inspect().error, "component_recovery_signed_baseline_required");
    const session = f.realtime.activeSession(f.connection).session;
    assert.equal(session.operations.size, 0);
    assert.equal(session.revision, 0);
  }
});

test("WP6 replaced Project connection, realtime Session or registry cannot reuse old preview authority", () => {
  const f = fixture();
  f.publish();
  const peer = {
    ...f.connection, userId: "editor-b", connectionId: "viewer-b",
    projectClientRegistered: false,
  };
  assert.equal(f.coordinator.dispatch({
    type: "register_client", connection: peer, nowUnixMs: 3000,
  }).error, null);
  assert.equal(f.inspect(peer).error, "component_recovery_project_membership_required");
  assert.equal(f.inspect().status, "signed_project_baseline_current_preview_only");
  // Replacement of SAME user supersedes original and invalidates original
  // exact connection object in Project Coordinator even if realtime hasn't
  // yet sent a separate presence-leave notification.
  const replacement = {
    ...f.connection, connectionId: "viewer-replacement",
    projectClientRegistered: false,
  };
  assert.equal(f.coordinator.dispatch({
    type: "register_client", connection: replacement, nowUnixMs: 4000,
  }).error, null);
  assert.equal(f.inspect().error, "component_recovery_project_membership_required");
  const oldRevision = f.realtime.activeSession(f.connection)?.session.revision ?? 0;
  assert.equal(oldRevision, 0);
});
