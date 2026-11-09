import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { DEFAULTS } from "../src/config.mjs";
import { baselineCanonicalPayload, publisherAuthorizationPayload } from "../src/project-coordinator.mjs";
import { createProjectCoordinatorCore } from "../src/project-coordinator-core.mjs";
import { createSessionAuthority, makeSessionKey } from "../src/session-authority.mjs";
import { prepareComponentIdentityBaseline } from "../src/component-foundation.mjs";
import { prepareComponentPropertySnapshot } from "../src/component-property-foundation.mjs";
import { readComponentPropertyTransaction } from "../src/component-property-transaction.mjs";
import {
  beginPublisherApprovedColliderLedgerForLocalTest,
  inspectPublisherApprovedColliderLedgerForLocalTest,
  commitPublisherApprovedColliderLedgerForLocalTest,
  retirePublisherApprovedColliderLedgerForLocalTest,
} from "../src/component-publisher-ledger-lifecycle.mjs";
import {
  publisherObservationApprovalPayload,
  verifyPublisherApprovedColliderObservationForLocalTest,
} from "../src/component-publisher-observation-approval.mjs";

const projectId = "wp6-approved-project";
const projectUuid = "b3b67aa1-524b-4d69-b7f3-82448f45770c";
const sessionId = "wp6-approved-session";
const sceneId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const objectId = `GlobalObjectId_V1-2-${sceneId}-10-0`;
const otherObjectId = `GlobalObjectId_V1-2-${sceneId}-11-0`;
const boxId = `GlobalObjectId_V1-2-${sceneId}-20-0`;
const secondBoxId = `GlobalObjectId_V1-2-${sceneId}-21-0`;
const sphereId = `GlobalObjectId_V1-2-${sceneId}-22-0`;
const box = "UnityEngine.BoxCollider";
const sphere = "UnityEngine.SphereCollider";
const maxPolicy = 32;
function hash(value) { return createHash("sha256").update(value, "utf8").digest("hex"); }
function keyMaterial() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" });
  return {
    privateKey, publicKeyBase64: der.toString("base64"),
    keyId: createHash("sha256").update(der).digest("hex"),
  };
}
function signedDescriptor(owner, publisher = owner, revision = 1, manifestHash = "b".repeat(64)) {
  const value = {
    userId: "editor-a", projectUuid,
    baselineRevision: revision, manifestHash,
    descriptorHash: "",
    unityVersion: "6000.3.21f1", teamForgePackageVersion: "0.5.1",
    realtimeProtocolVersion: 1, transferProtocolVersion: 1, manifestSchemaVersion: 1,
    ownerKeyId: owner.keyId, ownerPublicKey: owner.publicKeyBase64,
    publisherKeyId: publisher.keyId, publisherPublicKey: publisher.publicKeyBase64,
    publisherAuthorization: publisher === owner ? "" : sign(
      null, Buffer.from(publisherAuthorizationPayload(projectUuid, publisher.keyId)), owner.privateKey,
    ).toString("base64"),
    baselineSignature: "",
  };
  const payload = baselineCanonicalPayload(projectId, value);
  value.descriptorHash = hash(payload);
  value.baselineSignature = sign(null, Buffer.from(payload), publisher.privateKey).toString("base64");
  return value;
}
function connection() {
  return {
    connectionId: "connection-a", userId: "editor-a", userName: "Editor A",
    userColor: "#336699", projectId, sessionId,
    sessionKey: makeSessionKey(projectId, sessionId),
    supportsProjectTransfer: true, supportsHierarchySync: true,
    supportsTransformSync: true, supportsPresence: true,
  };
}
function policy() {
  return {
    maxProperties: maxPolicy,
    allowedProperties: new Map([
      [box, new Map([
        ["m_IsTrigger", { kind: "boolean" }],
        ["m_Center", { kind: "vector3", maximumAbsolute: 100 }],
        ["m_Size", { kind: "vector3", maximumAbsolute: 100 }],
      ])],
      [sphere, new Map([
        ["m_IsTrigger", { kind: "boolean" }],
        ["m_Center", { kind: "vector3", maximumAbsolute: 100 }],
        ["m_Radius", { kind: "float", minimum: 0, maximum: 100 }],
      ])],
    ]),
  };
}
function properties(component) {
  const common = { objectId: component.objectId,
    componentId: component.componentId, typeName: component.typeName };
  return [
    { ...common, propertyPath: "m_IsTrigger", valueKind: "boolean", value: false },
    { ...common, propertyPath: "m_Center", valueKind: "vector3", value: { x: 1, y: 2, z: 3 } },
    component.typeName === box
      ? { ...common, propertyPath: "m_Size", valueKind: "vector3", value: { x: 2, y: 3, z: 4 } }
      : { ...common, propertyPath: "m_Radius", valueKind: "float", value: 2 },
  ];
}
function fixture({ delegated = false, incomplete = false } = {}) {
  const owner = keyMaterial(), publisher = delegated ? keyMaterial() : owner;
  const coordinator = createProjectCoordinatorCore({
    maxProjectPeersPerSession: 5, maxProjectRegistries: 5, maxSnapshotBytes: 1_000_000,
  });
  const realtime = createSessionAuthority({ ...DEFAULTS });
  const actor = connection();
  assert.equal(coordinator.dispatch({ type: "register_client", connection: actor, nowUnixMs: 1000 }).error, null);
  realtime.dispatch({ type: "register_presence", connection: actor,
    requestId: "join", nowUnixMs: 1000 });
  const descriptor = signedDescriptor(owner, publisher);
  const publish = coordinator.dispatch({
    type: "baseline_publish", connection: actor,
    message: { type: "project_baseline_publish", protocolVersion: 1, requestId: "publish", ...descriptor },
    nowUnixMs: 2000,
  });
  assert.equal(publish.error, undefined);
  assert.equal(coordinator.projects.get(projectId).baseline.descriptorHash, descriptor.descriptorHash);
  const session = realtime.activeSession(actor).session;
  session.revision = 7;
  session.hierarchySceneIds.add(sceneId);
  for (const id of [objectId, otherObjectId])
    session.hierarchyObjects.set(JSON.stringify([sceneId, id]), { sceneId, objectId: id });
  const identities = [
    { objectId, componentId: boxId, typeName: box },
    { objectId, componentId: secondBoxId, typeName: box },
    { objectId: otherObjectId, componentId: sphereId, typeName: sphere },
  ];
  const identity = prepareComponentIdentityBaseline(session, {
    sceneId, baseRevision: 7, components: identities,
  }, { maxComponents: 8, supportedTypes: new Set([box, sphere]) });
  assert.equal(identity.error, undefined);
  const snapshot = prepareComponentPropertySnapshot(session, identity, {
    sceneId, baseRevision: 7, properties: (incomplete ? identities.slice(0, -1) : identities).flatMap(properties),
  }, policy());
  assert.equal(snapshot.error, undefined);
  const approval = {
    schemaVersion: 1, projectUuid: descriptor.projectUuid,
    baselineRevision: descriptor.baselineRevision,
    manifestHash: descriptor.manifestHash,
    descriptorHash: descriptor.descriptorHash, sceneId,
    realtimeRevision: session.revision,
    identityFingerprintSha256: hash(identity.fingerprint),
    propertyFingerprintSha256: hash(snapshot.fingerprint), signature: "",
  };
  function signedApproval(changes = {}, signingKey = publisher) {
    const receipt = { ...approval, ...changes, signature: "" };
    const payload = publisherObservationApprovalPayload(projectId, sessionId, actor.connectionId, receipt);
    receipt.signature = sign(null, Buffer.from(payload), signingKey.privateKey).toString("base64");
    return receipt;
  }
  function verifyReceipt(receipt, changes = {}) {
    return verifyPublisherApprovedColliderObservationForLocalTest(
      changes.coordinator ?? coordinator,
      changes.realtime ?? realtime,
      changes.actor ?? actor,
      changes.identity ?? identity,
      changes.snapshot ?? snapshot,
      receipt,
    );
  }
  return { owner, publisher, coordinator, realtime, actor, session,
    identity, snapshot, descriptor, signedApproval, verifyReceipt };
}

test("WP6 owner-signed approval binds real registered Project + realtime memberships and current complete observation", () => {
  const f = fixture();
  const before = { revision: f.session.revision, history: f.session.operations.size,
    projects: f.coordinator.projects.size };
  const result = f.verifyReceipt(f.signedApproval());
  assert.equal(result.status, "publisher_approved_local_observation_scene_bytes_unverified");
  assert.equal(result.projectUuid, projectUuid);
  assert.equal(result.baselineRevision, 1);
  assert.equal(result.sceneId, sceneId);
  assert.equal(result.realtimeRevision, 7);
  assert.equal(result.componentCount, 3);
  assert.equal(result.propertyCount, 9);
  assert.equal(result.propertyFingerprintSha256, hash(f.snapshot.fingerprint));
  assert(Object.isFrozen(result));
  assert.deepEqual({ revision: f.session.revision, history: f.session.operations.size,
    projects: f.coordinator.projects.size }, before);
});

test("WP6 separately delegated Publisher signature works only under the Owner-authorized signed project descriptor", () => {
  const f = fixture({ delegated: true });
  assert.notEqual(f.publisher.keyId, f.owner.keyId);
  assert.equal(f.verifyReceipt(f.signedApproval()).status,
    "publisher_approved_local_observation_scene_bytes_unverified");
  assert.equal(f.verifyReceipt(f.signedApproval({}, f.owner)).error,
    "component_publisher_signature_invalid");
  f.coordinator.projects.get(projectId).baseline.publisherAuthorization = "";
  assert.equal(f.verifyReceipt(f.signedApproval()).error, "component_publisher_descriptor_invalid");
});

test("WP6 wrong Publisher key, altered signature or noncanonical signature never verifies", () => {
  const f = fixture();
  const approval = f.signedApproval();
  const wrong = keyMaterial();
  assert.equal(f.verifyReceipt(f.signedApproval({}, wrong)).error, "component_publisher_signature_invalid");
  for (const signature of ["", "AA==", "a".repeat(88),
    approval.signature.slice(0, -2) + "!!"]) {
    assert.equal(f.verifyReceipt({ ...approval, signature }).error,
      "component_publisher_signature_invalid");
  }
});

test("WP6 Publisher approval refuses tampered Project/Scene/revision/fingerprint and unknown fields", () => {
  const f = fixture();
  for (const altered of [
    { projectUuid: "00000000-0000-0000-0000-000000000001" },
    { baselineRevision: 2 }, { manifestHash: "0".repeat(64) },
    { descriptorHash: "f".repeat(64) },
    { sceneId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    { realtimeRevision: 8 }, { schemaVersion: 2 },
  ]) {
    assert.equal(f.verifyReceipt(f.signedApproval(altered)).error,
      "component_publisher_approval_mismatch");
  }
  for (const altered of [
    { identityFingerprintSha256: "0".repeat(64) },
    { propertyFingerprintSha256: "0".repeat(64) },
  ]) assert.equal(f.verifyReceipt(f.signedApproval(altered)).error,
    "component_publisher_observation_changed");
  assert.equal(f.verifyReceipt({ ...f.signedApproval(), unknown: "ignored?" }).error,
    "component_publisher_approval_mismatch");
  const accessor = { ...f.signedApproval() };
  Object.defineProperty(accessor, "sceneId", { get() { throw Error("must never execute"); },
    enumerable: true });
  assert.equal(f.verifyReceipt(accessor).error, "component_publisher_approval_mismatch");
  assert.equal(f.verifyReceipt(new Proxy(f.signedApproval(), {})).error,
    "component_publisher_approval_mismatch");
});

test("WP6 signed approval is replay-fenced to the exact registered connection, Session and current descriptor", () => {
  const f = fixture();
  const original = f.signedApproval();
  const replaced = { ...f.actor, connectionId: "connection-b" };
  assert.equal(f.verifyReceipt(original, { actor: replaced }).error,
    "component_publisher_membership_stale");
  const copied = { ...f.actor };
  assert.equal(f.verifyReceipt(original, { actor: copied }).error,
    "component_publisher_membership_stale");
  const forgedSession = { ...f.actor, sessionId: "different-session",
    sessionKey: makeSessionKey(projectId, "different-session") };
  assert.equal(f.verifyReceipt(original, { actor: forgedSession }).error,
    "component_publisher_membership_stale");
  const relocated = { ...f.actor, projectId: "other-project",
    sessionKey: makeSessionKey("other-project", sessionId) };
  assert.equal(f.verifyReceipt(original, { actor: relocated }).error,
    "component_publisher_membership_stale");

  f.session.members.set(f.actor.userId, { connectionId: "replaced",
    supportsHierarchySync: true });
  assert.equal(f.verifyReceipt(original).error, "component_publisher_membership_stale");
  f.session.members.set(f.actor.userId, { connectionId: f.actor.connectionId,
    supportsHierarchySync: true });
  f.session.revision++;
  assert.equal(f.verifyReceipt(original).error, "component_collider_observation_stale");
});

test("WP6 a newly registered Editor cannot replay another live Editor's Publisher approval", () => {
  const f = fixture();
  const actorB = { ...connection(), connectionId: "connection-b", userId: "editor-b",
    userName: "Editor B", projectClientRegistered: false };
  assert.equal(f.coordinator.dispatch({ type: "register_client",
    connection: actorB, nowUnixMs: 4000 }).error, null);
  // This fixture seeded a minimal Hierarchy record directly, so avoid
  // dispatching a snapshot that expects the full production Transform fields.
  f.session.members.set(actorB.userId, {
    connectionId: actorB.connectionId, supportsHierarchySync: true,
  });
  assert(f.coordinator.activeRecord(actorB));
  assert(f.realtime.activeSession(actorB));
  assert.equal(f.verifyReceipt(f.signedApproval(), { actor: actorB }).error,
    "component_publisher_signature_invalid",
    "Two active registered Editors do not share observation approval across connection IDs.");
  assert.equal(f.verifyReceipt(f.signedApproval()).status,
    "publisher_approved_local_observation_scene_bytes_unverified");
});

test("WP6 a valid signature for a prior observation is rejected after actual property bytes change", () => {
  const f = fixture();
  const previous = f.signedApproval();
  const entries = f.snapshot.properties.map(row => ({
    ...row, value: row.valueKind === "vector3" ? { ...row.value } : row.value,
  }));
  const trigger = entries.find(row => row.propertyPath === "m_IsTrigger");
  trigger.value = !trigger.value;
  const changed = prepareComponentPropertySnapshot(f.session, f.identity, {
    sceneId, baseRevision: f.session.revision, properties: entries,
  }, policy());
  assert.equal(changed.error, undefined);
  assert.notEqual(changed.fingerprint, f.snapshot.fingerprint);
  assert.equal(f.verifyReceipt(previous, { snapshot: changed }).error,
    "component_publisher_observation_changed");
  assert.equal(f.verifyReceipt(f.signedApproval({
    propertyFingerprintSha256: hash(changed.fingerprint),
  }), { snapshot: changed }).status,
    "publisher_approved_local_observation_scene_bytes_unverified");
  assert.equal(f.session.operations.size, 0);
  assert.equal(f.session.revision, 7);
});

test("WP6 approval rejects current registered Project baseline rotation and descriptor alteration", () => {
  const f = fixture();
  const original = f.signedApproval();
  const upgraded = signedDescriptor(f.owner, f.publisher, 2, "e".repeat(64));
  f.coordinator.dispatch({
    type: "baseline_publish", connection: f.actor, nowUnixMs: 3000,
    message: { type: "project_baseline_publish", protocolVersion: 1,
      requestId: "publish-2", ...upgraded },
  });
  assert.equal(f.coordinator.projects.get(projectId).baseline.baselineRevision, 2);
  assert.equal(f.verifyReceipt(original).error, "component_publisher_approval_mismatch");
  f.coordinator.projects.get(projectId).baseline.manifestHash = "c".repeat(64);
  assert.equal(f.verifyReceipt(original).error, "component_publisher_descriptor_invalid");
});

test("WP6 complete locally prepared observation gate runs before signature and does not seed simulator", () => {
  const f = fixture({ incomplete: true });
  assert.equal(f.verifyReceipt(f.signedApproval()).error, "component_collider_observation_incomplete");
  assert.equal(f.session.revision, 7);
  assert.equal(f.session.operations.size, 0);
});

test("WP6 inactive or missing Coordinator Project and unnegotiated transfer fail before reading signatures", () => {
  const f = fixture();
  const approval = f.signedApproval();
  f.actor.supportsProjectTransfer = false;
  assert.equal(f.verifyReceipt(approval).error, "component_publisher_context_invalid");
  f.actor.supportsProjectTransfer = true;
  f.coordinator.projects.delete(projectId);
  assert.equal(f.verifyReceipt(approval).error, "component_publisher_baseline_missing");
});

test("WP6 binding to authentic SessionAuthority and Coordinator objects cannot be replaced by a lookalike", () => {
  const f = fixture();
  const approval = f.signedApproval();
  assert.equal(f.verifyReceipt(approval, { coordinator: { ...f.coordinator } }).error,
    "component_publisher_context_invalid");
  assert.equal(f.verifyReceipt(approval, { realtime: { ...f.realtime } }).error,
    "component_publisher_context_invalid");
});


function lockedPublisherLedger(f, opts = {}) {
  const result = beginPublisherApprovedColliderLedgerForLocalTest({
    coordinator: f.coordinator, realtime: f.realtime, actor: f.actor,
    identityBaseline: f.identity, propertySnapshot: f.snapshot,
    publisherApproval: opts.approval ?? f.signedApproval(),
    propertyPolicy: policy(),
  });
  assert.equal(result.error, undefined, result.reason);
  return result;
}

function approvedEdit(overrides = {}) {
  return {
    sceneId, objectId, componentId: boxId, typeName: box,
    propertyPath: "m_IsTrigger", valueKind: "boolean",
    value: true, baseRevision: 7, ...overrides,
  };
}

function grantLocalLock(f, expiresAtUnixMs = 26000) {
  f.session.locks.set(JSON.stringify([sceneId, objectId]), {
    sceneId, objectId, ownerUserId: f.actor.userId,
    ownerConnectionId: f.actor.connectionId, expiresAtUnixMs,
  });
}

test("WP6 publisher-bound local ledger commits an exact Server-owned applied record and replays without double revision", () => {
  const f = fixture();
  const handle = lockedPublisherLedger(f);
  grantLocalLock(f);
  assert.equal(handle.status, "publisher_bound_local_ledger_scene_bytes_unverified");
  assert(Object.isFrozen(handle));
  const initial = inspectPublisherApprovedColliderLedgerForLocalTest(handle);
  assert.equal(initial.status, "publisher_bound_local_ledger_read_only");
  assert.equal(initial.serverRevision, 7);
  assert.equal(initial.properties.length, 9);
  const write = commitPublisherApprovedColliderLedgerForLocalTest(
    handle, approvedEdit(), "publisher-local-one", 25000);
  assert.equal(write.status, "publisher_bound_local_commit", write.reason);
  assert.equal(write.sceneBytesAttested, false);
  assert.equal(write.applied.type, "component_property_applied");
  assert.equal(write.applied.serverRevision, 8);
  assert.equal(f.session.revision, 8);
  assert.equal(f.session.operations.get("publisher-local-one").applied, write.applied);
  assert.equal(inspectPublisherApprovedColliderLedgerForLocalTest(handle).serverRevision, 8);

  f.session.locks.clear();
  const replay = commitPublisherApprovedColliderLedgerForLocalTest(
    handle, approvedEdit(), "publisher-local-one", 29000);
  assert.equal(replay.status, "publisher_bound_local_replayed");
  assert.equal(replay.applied, write.applied);
  assert.equal(f.session.revision, 8);
  const collision = commitPublisherApprovedColliderLedgerForLocalTest(
    handle, approvedEdit({ value: false }), "publisher-local-one", 25000);
  assert.equal(collision.error, "operation_id_conflict");
  assert.equal(f.session.revision, 8);
  assert.equal(f.session.operations.size, 1);
});

test("WP6 publisher-bound ledger never accepts a forged handle or partial/incorrect signature", () => {
  const f = fixture();
  for (const approval of [
    { ...f.signedApproval(), signature: "" },
    f.signedApproval({ sceneId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }),
  ]) {
    const denied = beginPublisherApprovedColliderLedgerForLocalTest({
      coordinator: f.coordinator, realtime: f.realtime, actor: f.actor,
      identityBaseline: f.identity, propertySnapshot: f.snapshot,
      publisherApproval: approval, propertyPolicy: policy(),
    });
    assert(denied.error);
    assert.equal(readComponentPropertyTransaction(f.session).error, "component_transaction_unseeded");
    assert.equal(f.session.operations.size, 0);
  }
  const handle = lockedPublisherLedger(f);
  assert.equal(inspectPublisherApprovedColliderLedgerForLocalTest({ ...handle }).error,
    "component_publisher_ledger_retired");
  assert.equal(commitPublisherApprovedColliderLedgerForLocalTest({ ...handle },
    approvedEdit(), "forged", 25000).error, "component_publisher_ledger_retired");
  assert.equal(beginPublisherApprovedColliderLedgerForLocalTest({
    coordinator: f.coordinator, realtime: f.realtime, actor: f.actor,
    identityBaseline: f.identity, propertySnapshot: f.snapshot,
    publisherApproval: f.signedApproval(), propertyPolicy: policy(),
  }).error, "component_publisher_ledger_already_active");
  assert.equal(f.session.revision, 7);
  assert.equal(retirePublisherApprovedColliderLedgerForLocalTest(handle), true);
  assert.equal(retirePublisherApprovedColliderLedgerForLocalTest(handle), false);
});

test("WP6 full signed baseline rotation immediately retires an approved local ledger before mutation", () => {
  const f = fixture();
  const handle = lockedPublisherLedger(f);
  grantLocalLock(f);
  const upgraded = signedDescriptor(f.owner, f.publisher, 2, "e".repeat(64));
  f.coordinator.dispatch({
    type: "baseline_publish", connection: f.actor, nowUnixMs: 3000,
    message: {
      type: "project_baseline_publish", protocolVersion: 1,
      requestId: "rotate-approved-local", ...upgraded,
    },
  });
  assert.equal(f.coordinator.projects.get(projectId).baseline.baselineRevision, 2);
  const denied = commitPublisherApprovedColliderLedgerForLocalTest(
    handle, approvedEdit(), "old-baseline", 25000);
  assert.equal(denied.error, "component_publisher_ledger_baseline_rotated");
  assert.equal(denied.repair, "resnapshot_required");
  assert.equal(readComponentPropertyTransaction(f.session).error, "component_transaction_unseeded");
  assert.equal(inspectPublisherApprovedColliderLedgerForLocalTest(handle).error,
    "component_publisher_ledger_retired");
  assert.equal(f.session.revision, 7);
  assert.equal(f.session.operations.size, 0);
});

test("WP6 signed Publisher delegation revoked after setup retires the ledger", () => {
  const f = fixture({ delegated: true });
  const handle = lockedPublisherLedger(f);
  f.coordinator.projects.get(projectId).baseline.publisherAuthorization = "";
  assert.equal(inspectPublisherApprovedColliderLedgerForLocalTest(handle).error,
    "component_publisher_ledger_baseline_rotated");
  assert.equal(readComponentPropertyTransaction(f.session).error, "component_transaction_unseeded");
  assert.equal(f.session.revision, 7);
});

test("WP6 replaced active member denies even matching replay and retires the ledger", () => {
  const f = fixture();
  const handle = lockedPublisherLedger(f);
  grantLocalLock(f);
  assert.equal(commitPublisherApprovedColliderLedgerForLocalTest(
    handle, approvedEdit(), "initial", 25000).status, "publisher_bound_local_commit");
  f.session.members.set(f.actor.userId, {
    connectionId: "replacement", supportsHierarchySync: true,
  });
  assert.equal(commitPublisherApprovedColliderLedgerForLocalTest(
    handle, approvedEdit(), "initial", 25000).error,
  "component_publisher_ledger_member_replaced");
  assert.equal(readComponentPropertyTransaction(f.session).error, "component_transaction_unseeded");
  assert.equal(f.session.revision, 8, "Existing historical Session commit is not rolled back.");
  assert.equal(f.session.operations.size, 1);
});

test("WP6 mutation of the same live connection object cannot silently rebind an approved ledger", () => {
  const f = fixture();
  const handle = lockedPublisherLedger(f);
  const previousId = f.actor.connectionId;
  f.actor.connectionId = "mutated-editor-connection";
  assert.equal(inspectPublisherApprovedColliderLedgerForLocalTest(handle).error,
    "component_publisher_ledger_member_replaced");
  f.actor.connectionId = previousId;
  grantLocalLock(f);
  assert.equal(commitPublisherApprovedColliderLedgerForLocalTest(
    handle, approvedEdit(), "mutated", 25000).error,
    "component_publisher_ledger_retired");
  assert.equal(f.session.revision, 7);
  assert.equal(f.session.operations.size, 0);
});

test("WP6 unrelated current Session revision invalidates old ledger without mutating history", () => {
  const f = fixture();
  const handle = lockedPublisherLedger(f);
  f.session.revision = 8; // unrelated already-accepted Hierarchy operation
  const denied = inspectPublisherApprovedColliderLedgerForLocalTest(handle);
  assert.equal(denied.error, "component_publisher_ledger_stale");
  assert.equal(denied.repair, "resnapshot_required");
  assert.equal(readComponentPropertyTransaction(f.session).error, "component_transaction_unseeded");
  assert.equal(f.session.revision, 8);
  assert.equal(f.session.operations.size, 0);
});

test("WP6 local ledger requires existing per-object lock; rejected edit cannot increment shared revision", () => {
  const f = fixture();
  const handle = lockedPublisherLedger(f);
  const rejected = commitPublisherApprovedColliderLedgerForLocalTest(
    handle, approvedEdit(), "no-lock", 25000);
  assert.equal(rejected.error, "component_property_lock_required");
  assert.equal(f.session.revision, 7);
  assert.equal(f.session.operations.size, 0);
  grantLocalLock(f, 20000);
  const expired = commitPublisherApprovedColliderLedgerForLocalTest(
    handle, approvedEdit(), "expired-lock", 25000);
  assert.equal(expired.error, "component_property_lock_expired");
  assert.equal(f.session.revision, 7);
  grantLocalLock(f);
  assert.equal(commitPublisherApprovedColliderLedgerForLocalTest(
    handle, approvedEdit({ baseRevision: 6 }), "stale", 25000).error,
    "component_property_stale_revision");
  assert.equal(f.session.operations.size, 0);
  assert.equal(f.session.revision, 7);
});

test("WP6 incomplete Collider observation never starts a publisher-bound transaction", () => {
  const f = fixture({ incomplete: true });
  const denied = beginPublisherApprovedColliderLedgerForLocalTest({
    coordinator: f.coordinator, realtime: f.realtime, actor: f.actor,
    identityBaseline: f.identity, propertySnapshot: f.snapshot,
    publisherApproval: f.signedApproval(), propertyPolicy: policy(),
  });
  assert.equal(denied.error, "component_collider_observation_incomplete");
  assert.equal(readComponentPropertyTransaction(f.session).error, "component_transaction_unseeded");
  assert.equal(f.session.revision, 7);
});

test("WP6 successfully retired local ledger rejects future commits even if a lock is present", () => {
  const f = fixture();
  const handle = lockedPublisherLedger(f);
  grantLocalLock(f);
  assert.equal(retirePublisherApprovedColliderLedgerForLocalTest(handle), true);
  assert.equal(commitPublisherApprovedColliderLedgerForLocalTest(
    handle, approvedEdit(), "late", 25000).error, "component_publisher_ledger_retired");
  assert.equal(f.session.revision, 7);
  assert.equal(f.session.operations.size, 0);
});
