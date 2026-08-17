import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import {
  baselineCanonicalPayload,
  ownerProofPayload,
} from "../src/project-coordinator.mjs";
import {
  COORDINATOR_EFFECTS,
  createProjectCoordinatorCore,
} from "../src/project-coordinator-core.mjs";

const config = {
  maxProjectPeersPerSession: 4,
  maxProjectRegistries: 4,
  maxSnapshotBytes: 1_000_000,
};
const projectUuid = "b3b67aa1-524b-4d69-b7f3-82448f45770c";

function keyMaterial() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" });
  return {
    privateKey,
    publicKeyBase64: der.toString("base64"),
    keyId: createHash("sha256").update(der).digest("hex"),
  };
}

function connection(overrides = {}) {
  return {
    connectionId: "connection-a",
    userId: "user-a",
    userName: "User A",
    projectId: "project-a",
    sessionId: "session-a",
    sessionKey: "",
    supportsProjectTransfer: true,
    ...overrides,
  };
}

function descriptor(owner, overrides = {}) {
  const value = {
    userId: "user-a",
    projectUuid,
    baselineRevision: 1,
    manifestHash: "a".repeat(64),
    descriptorHash: "",
    unityVersion: "6000.3.21f1",
    teamForgePackageVersion: "0.5.1",
    realtimeProtocolVersion: 1,
    transferProtocolVersion: 1,
    manifestSchemaVersion: 1,
    ownerKeyId: owner.keyId,
    ownerPublicKey: owner.publicKeyBase64,
    publisherKeyId: owner.keyId,
    publisherPublicKey: owner.publicKeyBase64,
    publisherAuthorization: "",
    baselineSignature: "",
    ...overrides,
  };
  const canonical = baselineCanonicalPayload("project-a", value);
  value.descriptorHash = createHash("sha256").update(canonical).digest("hex");
  value.baselineSignature = sign(null, Buffer.from(canonical), owner.privateKey).toString("base64");
  return value;
}

function publish(value, requestId = "publish") {
  return { type: "project_baseline_publish", protocolVersion: 1, requestId, ...value };
}

function announce(value, owner, connectionId, requestId = "announce") {
  const message = {
    type: "project_peer_announce",
    protocolVersion: 1,
    requestId,
    ...value,
    completeBaseline: true,
    availableChunkCount: 2,
    totalChunkCount: 2,
    endpoint: "http://127.0.0.1:5091/teamforge-transfer/v1",
    transferToken: "0123456789abcdef0123456789abcdef",
    ownerProofSignature: "",
  };
  message.ownerProofSignature = sign(
    null,
    Buffer.from(ownerProofPayload("project-a", connectionId, message)),
    owner.privateKey,
  ).toString("base64");
  return message;
}

function register(core, client, nowUnixMs = 1_000) {
  return core.dispatch({ type: "register_client", connection: client, nowUnixMs });
}

test("Project Coordinator owns session-isolated registration and bounded snapshots", () => {
  const core = createProjectCoordinatorCore(config);
  const a = connection();
  const b = connection({ connectionId: "connection-b", userId: "user-b", sessionId: "session-b" });
  assert.equal(register(core, a).error, null);
  assert.equal(register(core, b).error, null);
  const snapshot = core.dispatch({ type: "send_snapshot", connection: a, requestId: "hello", nowUnixMs: 2_000 });
  assert.equal(core.sessions.size, 2);
  assert.equal(snapshot.effects[0].type, COORDINATOR_EFFECTS.SEND_BOUNDED);
  assert.deepEqual(snapshot.effects[0].message.peers, []);
});

test("Project registry snapshots are atomically empty or fully bound to one UUID across announce and supersede", () => {
  const core = createProjectCoordinatorCore(config);
  const owner = keyMaterial();
  const initial = connection();
  assert.equal(register(core, initial).error, null);

  const empty = core.dispatch({
    type: "send_snapshot",
    connection: initial,
    requestId: "empty",
    nowUnixMs: 2_000,
  }).effects[0].message;
  assert.equal(empty.projectUuid, "");
  assert.equal(empty.baseline, null);
  assert.deepEqual(empty.peers, []);

  const signed = descriptor(owner);
  core.dispatch({
    type: "peer_announce",
    connection: initial,
    message: announce(signed, owner, initial.connectionId),
    nowUnixMs: 3_000,
  });
  const announced = core.dispatch({
    type: "send_snapshot",
    connection: initial,
    requestId: "announced",
    nowUnixMs: 4_000,
  }).effects[0].message;
  assert.equal(announced.projectUuid, projectUuid);
  assert.equal(announced.baseline.projectUuid, projectUuid);
  assert.deepEqual(announced.peers.map((peer) => peer.projectUuid), [projectUuid]);

  const replacement = connection({ connectionId: "connection-new" });
  const replaced = register(core, replacement, 5_000);
  assert.deepEqual(replaced.removedConnectionIds, [initial.connectionId]);
  const lateSnapshot = core.dispatch({
    type: "send_snapshot",
    connection: replacement,
    requestId: "replacement",
    nowUnixMs: 6_000,
  }).effects[0].message;
  assert.equal(lateSnapshot.projectUuid, projectUuid);
  assert.equal(lateSnapshot.baseline.projectUuid, projectUuid);
  assert.deepEqual(lateSnapshot.peers, []);
});

test("same-user supersede removes the stale Project member before ordered send and close effects", () => {
  const core = createProjectCoordinatorCore(config);
  const previous = connection();
  register(core, previous);
  const replacement = connection({ connectionId: "connection-new" });
  const result = register(core, replacement, 2_000);
  assert.deepEqual(result.removedConnectionIds, [previous.connectionId]);
  assert.deepEqual(result.effects.map((effect) => effect.type), [
    COORDINATOR_EFFECTS.SEND,
    COORDINATOR_EFFECTS.CLOSE,
  ]);
  assert.equal(result.effects[0].message.code, "session_superseded");
  assert.deepEqual(
    Array.from(Array.from(core.sessions.values())[0].members.keys()),
    [replacement.connectionId],
  );
});

test("Baseline publish preserves serial revision and idempotent retry semantics", () => {
  const core = createProjectCoordinatorCore(config);
  const client = connection();
  const owner = keyMaterial();
  register(core, client);
  const first = descriptor(owner);
  const accepted = core.dispatch({ type: "baseline_publish", connection: client, message: publish(first), nowUnixMs: 2_000 });
  assert.equal(accepted.effects[0].message.idempotent, false);
  const retry = core.dispatch({ type: "baseline_publish", connection: client, message: publish(first, "retry"), nowUnixMs: 3_000 });
  assert.equal(retry.effects[0].message.idempotent, true);
  const conflict = descriptor(owner, { manifestHash: "b".repeat(64) });
  const rejected = core.dispatch({ type: "baseline_publish", connection: client, message: publish(conflict, "conflict"), nowUnixMs: 4_000 });
  assert.equal(rejected.effects[0].message.code, "baseline_revision_conflict");
  assert.equal(core.projects.get("project-a").baseline.manifestHash, first.manifestHash);
});

test("a compatible signed announce reconstructs TOFU state and preserves verified seed ranking", () => {
  const core = createProjectCoordinatorCore(config);
  const client = connection();
  const owner = keyMaterial();
  register(core, client);
  const signed = descriptor(owner);
  const result = core.dispatch({
    type: "peer_announce",
    connection: client,
    message: announce(signed, owner, client.connectionId),
    nowUnixMs: 2_000,
  });
  assert.equal(core.projects.get("project-a").projectUuid, projectUuid);
  assert.deepEqual(result.effects.map((effect) => effect.message.type), [
    "project_baseline_changed",
    "project_peer_joined",
  ]);
  assert.equal(result.effects[1].message.peer.seedRank, 0);
});

test("established Project UUID and Owner pin reject a different signed identity", () => {
  const core = createProjectCoordinatorCore(config);
  const first = connection();
  const second = connection({ connectionId: "connection-b", userId: "user-b", sessionId: "session-b" });
  const ownerA = keyMaterial();
  const ownerB = keyMaterial();
  register(core, first);
  register(core, second);
  core.dispatch({ type: "baseline_publish", connection: first, message: publish(descriptor(ownerA)), nowUnixMs: 2_000 });
  const other = descriptor(ownerB, { userId: "user-b" });
  const rejected = core.dispatch({
    type: "baseline_publish",
    connection: second,
    message: publish(other, "owner-mismatch"),
    nowUnixMs: 3_000,
  });
  assert.equal(rejected.effects[0].message.code, "owner_key_mismatch");
  assert.equal(core.projects.size, 1);
});
