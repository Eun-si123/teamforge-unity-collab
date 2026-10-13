import assert from "node:assert/strict";
import test from "node:test";
import { createSessionState } from "../src/session-authority.mjs";
import { prepareComponentIdentityBaseline } from "../src/component-foundation.mjs";
import {
  classifyComponentPropertyReplay,
  classifyComponentStructureReplay,
} from "../src/component-operation-preflight.mjs";
import {
  inspectComponentPropertyAuthority,
  inspectComponentStructureAuthority,
} from "../src/component-authority-preflight.mjs";

const sceneId = "scene-authority";
const objectId = "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-10-0";
const otherObjectId = "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-11-0";
const existingId = "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-20-0";
const pendingId = "tf:c:0123456789abcdef0123456789abcdef";
const typeName = "UnityEngine.BoxCollider";
const time = 10000;
const connection = Object.freeze({ userId: "editor-a", connectionId: "conn-a" });

function state() {
  const session = createSessionState();
  session.revision = 4;
  session.members.set(connection.userId, { connectionId: connection.connectionId });
  session.hierarchySceneIds.add(sceneId);
  session.hierarchyObjects.set(JSON.stringify([sceneId, objectId]), { sceneId, objectId });
  session.hierarchyObjects.set(JSON.stringify([sceneId, otherObjectId]), {
    sceneId, objectId: otherObjectId,
  });
  return session;
}

function prepared(session) {
  const value = prepareComponentIdentityBaseline(session, {
    sceneId, baseRevision: session.revision,
    components: [{ objectId, componentId: existingId, typeName }],
  }, { maxComponents: 5, supportedTypes: new Set([typeName]) });
  assert.equal(value.error, undefined);
  return value;
}

function policy() {
  return {
    maxComponents: 5,
    types: new Map([[typeName, {
      canAdd: true, canRemove: true, allowMultiple: true,
      minPerObject: 0, maxPerObject: 4, requires: [],
    }]]),
  };
}

function intent(overrides = {}) {
  return {
    kind: "add_component", sceneId, objectId,
    componentId: pendingId, typeName, baseRevision: 4, ...overrides,
  };
}

function lock(session, overrides = {}) {
  session.locks.set(JSON.stringify([sceneId, objectId]), {
    sceneId, objectId, ownerUserId: connection.userId,
    ownerConnectionId: connection.connectionId, expiresAtUnixMs: time + 5000,
    ...overrides,
  });
}

function inspect(session, baseline, proposed = intent(), actor = connection, now = time, userPolicy = policy()) {
  return inspectComponentStructureAuthority(session, baseline, proposed, userPolicy, "op-component-1", actor, now);
}

test("WP6 authority preflight observes an owned unexpired lock but performs no write", () => {
  const session = state(), baseline = prepared(session);
  lock(session);
  const previousObjects = new Map(session.hierarchyObjects);
  const previousOps = new Map(session.operations);
  const previousLocks = new Map(session.locks);
  const decision = inspect(session, baseline);
  assert.equal(decision.status, "unseen_candidate_with_live_lock");
  assert.equal(decision.serverRevision, 4);
  assert.equal(decision.applied, undefined);
  assert.equal(decision.allowed, undefined);
  assert.equal(decision.repair, "none");
  assert.equal(Object.isFrozen(decision), true);
  assert.deepEqual(session.hierarchyObjects, previousObjects);
  assert.deepEqual(session.operations, previousOps);
  assert.deepEqual(session.locks, previousLocks);
  assert.equal(session.revision, 4);
});

test("WP6 authority preflight denies structural changes when no lock is held, unlike some Hierarchy edits", () => {
  const session = state(), baseline = prepared(session);
  assert.equal(inspect(session, baseline).error, "component_structure_lock_required");
  assert.equal(session.locks.size, 0);
});

test("WP6 authority preflight denies foreign-owned lock for identical target", () => {
  const session = state(), baseline = prepared(session);
  lock(session, { ownerConnectionId: "conn-b", ownerUserId: "editor-b" });
  assert.equal(inspect(session, baseline).error, "component_structure_locked_by_other");
});

test("WP6 authority preflight rejects lock handoff to a new connection with the same user ID", () => {
  const session = state(), baseline = prepared(session);
  lock(session);
  const replaced = { userId: connection.userId, connectionId: "conn-after-reconnect" };
  assert.equal(inspect(session, baseline, intent(), replaced).error, "component_session_not_registered");
  session.members.set(replaced.userId, { connectionId: replaced.connectionId });
  assert.equal(inspect(session, baseline, intent(), replaced).error, "component_structure_locked_by_other");
});

test("WP6 authority preflight rejects a malformed lock whose stored target differs from its key", () => {
  const session = state(), baseline = prepared(session);
  lock(session, { sceneId: "unrelated-scene" });
  assert.equal(inspect(session, baseline).error, "component_structure_lock_invalid");
  lock(session, { objectId: otherObjectId });
  assert.equal(inspect(session, baseline).error, "component_structure_lock_invalid");
  assert.equal(session.operations.size, 0);
});

test("WP6 authority preflight enforces precise lease expiry boundary without modifying leases", () => {
  const session = state(), baseline = prepared(session);
  lock(session, { expiresAtUnixMs: time });
  assert.equal(inspect(session, baseline).error, "component_structure_lock_expired");
  lock(session, { expiresAtUnixMs: time + 1 });
  assert.equal(inspect(session, baseline).status, "unseen_candidate_with_live_lock");
  assert.equal(inspect(session, baseline, intent(), connection, time + 1).error,
    "component_structure_lock_expired");
  assert.equal(session.locks.size, 1);
});

test("WP6 authority preflight rejects malformed, absent or removed Session member and invalid time", () => {
  const session = state(), baseline = prepared(session);
  lock(session);
  assert.equal(inspect(session, baseline, intent(), connection, -1).error,
    "component_authority_context_invalid");
  assert.equal(inspect(session, baseline, intent(), connection, 1.5).error,
    "component_authority_context_invalid");
  assert.equal(inspect(session, baseline, intent(), { ...connection, userId: "bad\nid" }).error,
    "component_authority_context_invalid");
  session.members.clear();
  assert.equal(inspect(session, baseline).error, "component_session_not_registered");
  assert.equal(inspect({ revision: 4 }).error, "component_authority_context_invalid");
});

test("WP6 authority preflight uses exactly the Scene-object lock key: different objects do not share locks", () => {
  const session = state(), baseline = prepared(session);
  session.locks.set(JSON.stringify([sceneId, otherObjectId]), {
    ownerUserId: connection.userId, ownerConnectionId: connection.connectionId,
    expiresAtUnixMs: time + 1000,
  });
  assert.equal(inspect(session, baseline).error, "component_structure_lock_required");
});

test("WP6 authority preflight refuses foreign-Session baseline even when lock and metadata look identical", () => {
  const a = state(), b = state(), baseline = prepared(a);
  lock(b);
  assert.equal(inspect(b, baseline).error, "component_structure_authority_unavailable");
});

test("WP6 authority preflight returns resnapshot hint for unseen stale revision without including snapshot bytes", () => {
  const session = state(), baseline = prepared(session);
  lock(session);
  const result = inspect(session, baseline, intent({ baseRevision: 3 }));
  assert.equal(result.error, "component_structure_stale_revision");
  assert.equal(result.repair, "resnapshot_required");
  assert.equal(result.serverRevision, 4);
  assert.equal(result.snapshot, undefined);
  assert.equal(session.operations.size, 0);
});

test("WP6 authority preflight prioritizes matching prior operation observation before current lock and revision", () => {
  const session = state(), baseline = prepared(session), i = intent();
  const previous = classifyComponentStructureReplay(session, i, "op-component-1", connection.userId);
  assert.equal(previous.status, "unseen_requires_authority");
  session.operations.set("op-component-1", {
    fingerprint: previous.fingerprint,
    applied: {
      type: "component_structure_applied",
      operationId: "op-component-1",
      userId: connection.userId,
      kind: i.kind,
      sceneId: i.sceneId,
      objectId: i.objectId,
      componentId: i.componentId,
      typeName: i.typeName,
      baseRevision: i.baseRevision,
      serverRevision: 5,
    },
  });
  session.revision = 5;
  const result = inspect(session, baseline);
  assert.equal(result.status, "matching_prior_record_only");
  assert.equal(result.applied, undefined, "the classifier never replies with a stored ACK");
  assert.equal(result.repair, "none");
  assert.equal(session.locks.size, 0);
});

test("WP6 authority preflight refuses same operation ID with different actor or kind before lock checks", () => {
  const session = state(), baseline = prepared(session);
  session.operations.set("op-component-1", {
    fingerprint: JSON.stringify({ messageType: "hierarchy_operation", operationId: "op-component-1" }),
    applied: { operationId: "op-component-1", serverRevision: 4 },
  });
  const result = inspect(session, baseline);
  assert.equal(result.error, "operation_id_conflict");
  assert.equal(result.repair, "none");
});

test("WP6 authority preflight never lets stale matching lookalike membership claim an applied retry", () => {
  const session = state(), baseline = prepared(session);
  session.members.set(connection.userId, { connectionId: "new-active-connection" });
  session.operations.set("op-component-1", {
    fingerprint: classifyComponentStructureReplay(state(), intent(),
      "op-component-1", connection.userId).fingerprint,
    applied: { operationId: "op-component-1", serverRevision: 4 },
  });
  assert.equal(inspect(session, baseline).error, "component_session_not_registered");
});

test("WP6 authority preflight refuses invalid structural policy even with a valid lock", () => {
  const session = state(), baseline = prepared(session);
  lock(session);
  assert.equal(inspect(session, baseline, intent(), connection, time, {}).error,
    "component_structure_policy_missing");
  assert.equal(inspect(session, baseline, intent({ componentId: existingId })).error,
    "invalid_component_structure");
  assert.equal(session.revision, 4);
});

test("WP6 authority preflight never grants live Component protocol support on successful candidate", () => {
  const session = state(), baseline = prepared(session);
  lock(session);
  const decision = inspect(session, baseline);
  assert.deepEqual(Object.keys(decision).sort(), ["repair", "serverRevision", "status"]);
  assert.equal(decision.status, "unseen_candidate_with_live_lock");
  assert.equal(typeof decision.wireMessage, "undefined");
  assert.equal(session.operations.size, 0);
});

function propertyIntent(overrides = {}) {
  return {
    sceneId, objectId, componentId: existingId, typeName, baseRevision: 4,
    propertyPath: "m_IsTrigger", valueKind: "boolean", value: false, ...overrides,
  };
}

function propertyPolicy() {
  return { allowedProperties: new Map([[typeName, new Map([
    ["m_IsTrigger", { kind: "boolean" }],
    ["m_Center", { kind: "vector3", maximumAbsolute: 100 }],
    // Hypothetical numeric paths exercise policy, not Unity field support.
    ["m_ProbeFloat", { kind: "float", minimum: 0, maximum: 10 }],
    ["m_ProbeInt", { kind: "int32", minimum: 0, maximum: 10 }],
  ])]]) };
}

function inspectProperty(session, baseline, proposed = propertyIntent(), actor = connection,
  now = time, userPolicy = propertyPolicy(), operationId = "op-property-1") {
  return inspectComponentPropertyAuthority(session, baseline, proposed, userPolicy, operationId, actor, now);
}

function recordProperty(session, proposed = propertyIntent()) {
  const initial = classifyComponentPropertyReplay(session, proposed, "op-property-1", connection.userId);
  assert.equal(initial.status, "unseen_requires_authority");
  session.operations.set("op-property-1", {
    fingerprint: initial.fingerprint,
    applied: { ...proposed, type: "component_property_applied", operationId: "op-property-1",
      userId: connection.userId, serverRevision: 5 },
  });
  session.revision = 5;
}

test("WP6 property authority inspects all typed candidates with a live lease without state or input effects", () => {
  const session = state(), baseline = prepared(session);
  lock(session);
  const before = structuredClone(session);
  for (const changes of [
    {}, { value: true },
    { propertyPath: "m_Center", valueKind: "vector3", value: { z: 3, y: -2, x: 0 } },
    { propertyPath: "m_ProbeFloat", valueKind: "float", value: 0 },
    { propertyPath: "m_ProbeInt", valueKind: "int32", value: 10 },
  ]) {
    const proposed = propertyIntent(changes), original = structuredClone(proposed);
    const result = inspectProperty(session, baseline, proposed);
    assert.deepEqual(result, { status: "unseen_candidate_with_live_lock", serverRevision: 4, repair: "none" });
    assert.equal(Object.isFrozen(result), true);
    for (const field of ["allowed", "applied", "candidate", "snapshot", "wireMessage"]) {
      assert.equal(result[field], undefined, field);
    }
    assert.deepEqual(proposed, original);
  }
  assert.deepEqual(session, before);
});

test("WP6 property authority requires its exact Scene/object lease rather than an unrelated object's lock", () => {
  const session = state(), baseline = prepared(session);
  assert.equal(inspectProperty(session, baseline).error, "component_property_lock_required");
  session.locks.set(JSON.stringify([sceneId, otherObjectId]), {
    sceneId, objectId: otherObjectId, ownerUserId: connection.userId,
    ownerConnectionId: connection.connectionId, expiresAtUnixMs: time + 5000,
  });
  assert.equal(inspectProperty(session, baseline).error, "component_property_lock_required");
  lock(session, { sceneId: "another-scene" });
  assert.equal(inspectProperty(session, baseline).error, "component_property_lock_invalid");
  lock(session, { objectId: otherObjectId });
  assert.equal(inspectProperty(session, baseline).error, "component_property_lock_invalid");
});

test("WP6 property authority cannot inherit a previous connection's lease across rapid reconnect", () => {
  const session = state(), baseline = prepared(session);
  lock(session);
  const replaced = { ...connection, connectionId: "after-reconnect" };
  assert.equal(inspectProperty(session, baseline, propertyIntent(), replaced).error,
    "component_session_not_registered");
  session.members.set(connection.userId, { connectionId: replaced.connectionId });
  assert.equal(inspectProperty(session, baseline).error, "component_session_not_registered");
  assert.equal(inspectProperty(session, baseline, propertyIntent(), replaced).error,
    "component_property_locked_by_other");
  // Only hypothetical authoritative reacquisition changes the stored lease.
  lock(session, { ownerConnectionId: replaced.connectionId });
  assert.equal(inspectProperty(session, baseline, propertyIntent(), replaced).status,
    "unseen_candidate_with_live_lock");
  assert.equal(session.operations.size, 0);
});

test("WP6 property authority distinguishes both user and connection across competing lease owners", () => {
  const session = state(), baseline = prepared(session);
  const other = { userId: "editor-b", connectionId: "conn-b" };
  session.members.set(other.userId, { connectionId: other.connectionId });
  lock(session);
  assert.equal(inspectProperty(session, baseline, propertyIntent(), other).error,
    "component_property_locked_by_other");
  lock(session, { ownerUserId: other.userId, ownerConnectionId: other.connectionId });
  assert.equal(inspectProperty(session, baseline).error, "component_property_locked_by_other");
  assert.equal(inspectProperty(session, baseline, propertyIntent(), other).status,
    "unseen_candidate_with_live_lock");
  lock(session, { ownerUserId: other.userId });
  assert.equal(inspectProperty(session, baseline).error, "component_property_locked_by_other");
});

test("WP6 property authority rejects expired/malformed leases at the exact sampled server time", () => {
  const session = state(), baseline = prepared(session);
  for (const expiresAtUnixMs of [time - 1, time, null, undefined, NaN, Infinity, time + 0.5, String(time + 1)]) {
    lock(session, { expiresAtUnixMs });
    const before = structuredClone(session.locks);
    assert.equal(inspectProperty(session, baseline).error, "component_property_lock_expired");
    assert.deepEqual(session.locks, before);
  }
  lock(session, { expiresAtUnixMs: time + 1 });
  assert.equal(inspectProperty(session, baseline).status, "unseen_candidate_with_live_lock");
  assert.equal(inspectProperty(session, baseline, propertyIntent(), connection, time + 1).error,
    "component_property_lock_expired");
});

test("WP6 property authority refuses client baseline lookalikes and identical foreign-Session baselines", () => {
  const a = state(), b = state(), baseline = prepared(a);
  lock(a); lock(b);
  for (const lookalike of [null, { ...baseline }, structuredClone(baseline)]) {
    assert.equal(inspectProperty(a, lookalike).error, "component_authority_unavailable");
  }
  assert.equal(inspectProperty(b, baseline).error, "component_authority_unavailable");
});

test("WP6 property authority checks unseen intent and prepared baseline revisions independently", () => {
  const session = state(), baseline = prepared(session);
  lock(session);
  for (const baseRevision of [3, 5]) {
    const result = inspectProperty(session, baseline, propertyIntent({ baseRevision }));
    assert.equal(result.error, "component_property_stale_revision");
    assert.equal(result.repair, "resnapshot_required");
    assert.equal(result.serverRevision, 4);
  }
  session.revision = 5;
  const result = inspectProperty(session, baseline, propertyIntent({ baseRevision: 5 }));
  assert.equal(result.error, "component_property_stale_revision");
  assert.equal(result.repair, "resnapshot_required");
  assert.equal(result.snapshot, undefined);
  assert.equal(session.operations.size, 0);
});

test("WP6 property authority reports inert repair hints for Scene, owner and Component mismatch", () => {
  const session = state(), baseline = prepared(session);
  lock(session);
  for (const [changes, error] of [
    [{ sceneId: "other-scene" }, "component_property_scene_mismatch"],
    [{ componentId: "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-999-0" }, "component_property_identity_mismatch"],
    [{ typeName: "UnityEngine.SphereCollider" }, "component_property_identity_mismatch"],
  ]) {
    const result = inspectProperty(session, baseline, propertyIntent(changes));
    assert.equal(result.error, error);
    assert.equal(result.repair, "resnapshot_required");
    assert.equal(result.snapshot, undefined);
  }
  session.hierarchyObjects.delete(JSON.stringify([sceneId, objectId]));
  const result = inspectProperty(session, baseline);
  assert.equal(result.error, "component_property_owner_missing");
  assert.equal(result.repair, "resnapshot_required");
  assert.equal(session.locks.size, 1);
});

test("WP6 property authority binds repeated same-type components to exact IDs, not type or ordinal", () => {
  const session = state(), secondId = "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-21-0";
  lock(session);
  const baseline = prepareComponentIdentityBaseline(session, {
    sceneId, baseRevision: 4, components: [
      { objectId, componentId: existingId, typeName }, { objectId, componentId: secondId, typeName },
    ],
  }, { maxComponents: 5, supportedTypes: new Set([typeName]) });
  assert.equal(baseline.error, undefined);
  assert.equal(inspectProperty(session, baseline, propertyIntent({ componentId: secondId })).status,
    "unseen_candidate_with_live_lock");
  recordProperty(session);
  assert.equal(inspectProperty(session, baseline, propertyIntent({ componentId: secondId })).error,
    "operation_id_conflict");
});

test("WP6 property authority enforces exact configured kind/path/range before a lease can be sufficient", () => {
  const session = state(), baseline = prepared(session);
  lock(session);
  for (const [proposed, suppliedPolicy, error] of [
    [propertyIntent(), {}, "component_property_policy_missing"],
    [propertyIntent(), { allowedProperties: new Map() }, "component_property_not_allowed"],
    [propertyIntent({ propertyPath: "m_Unknown" }), propertyPolicy(), "component_property_not_allowed"],
    [propertyIntent({ propertyPath: "m_ProbeFloat" }), propertyPolicy(), "component_property_not_allowed"],
    [propertyIntent({ propertyPath: "m_ProbeFloat", valueKind: "float", value: -1 }), propertyPolicy(), "component_property_range_exceeded"],
    [propertyIntent({ propertyPath: "m_ProbeInt", valueKind: "int32", value: 11 }), propertyPolicy(), "component_property_range_exceeded"],
    [propertyIntent({ propertyPath: "m_Center", valueKind: "vector3", value: { x: 101, y: 0, z: 0 } }), propertyPolicy(), "component_property_range_exceeded"],
    [propertyIntent({ userId: connection.userId }), propertyPolicy(), "invalid_component_property"],
    [propertyIntent({ propertyPath: "m_GameObject" }), propertyPolicy(), "invalid_component_property"],
  ]) {
    const result = inspectProperty(session, baseline, proposed, connection, time, suppliedPolicy);
    assert.equal(result.error, error);
    assert.equal(result.repair, "none");
  }
  const badPolicy = propertyPolicy();
  badPolicy.allowedProperties.get(typeName).set("m_ProbeFloat", { kind: "float" });
  assert.equal(inspectProperty(session, baseline, propertyIntent({
    propertyPath: "m_ProbeFloat", valueKind: "float", value: 1,
  }), connection, time, badPolicy).error, "component_property_policy_invalid");
  assert.equal(session.operations.size, 0);
});

test("WP6 property committed retry observation precedes current lease, policy and baseline checks", () => {
  const session = state(), baseline = prepared(session);
  recordProperty(session);
  const before = structuredClone(session);
  const result = inspectProperty(session, null, propertyIntent(), connection, time, null);
  assert.deepEqual(result, { status: "matching_prior_record_only", serverRevision: 5, repair: "none" });
  assert.equal(result.applied, undefined);
  assert.equal(session.locks.size, 0);
  assert.deepEqual(session, before);
  assert.equal(inspectProperty(session, baseline, propertyIntent(), connection, time,
    propertyPolicy(), "fresh-id").error, "component_property_stale_revision");
});

test("WP6 property replaced/removed membership cannot observe a matching retry through a stale actor", () => {
  const session = state(), baseline = prepared(session);
  recordProperty(session);
  session.members.set(connection.userId, { connectionId: "replacement" });
  assert.equal(inspectProperty(session, baseline).error, "component_session_not_registered");
  const current = { ...connection, connectionId: "replacement" };
  assert.equal(inspectProperty(session, baseline, propertyIntent(), current).status,
    "matching_prior_record_only");
  assert.equal(inspectProperty(session, baseline, propertyIntent({ value: true }), current).error,
    "operation_id_conflict");
  session.members.clear();
  assert.equal(inspectProperty(session, baseline, propertyIntent(), current).error,
    "component_session_not_registered");
});

test("WP6 property corrupt histories and cross-kind ID collisions cannot produce a repair ACK", () => {
  const session = state(), baseline = prepared(session);
  lock(session);
  recordProperty(session);
  const entry = session.operations.get("op-property-1");
  entry.applied.value = true;
  const result = inspectProperty(session, baseline);
  assert.equal(result.error, "component_operation_history_invalid");
  assert.equal(result.repair, "none");
  assert.equal(result.applied, undefined);
  entry.fingerprint = classifyComponentStructureReplay(state(), intent(), "op-property-1", connection.userId).fingerprint;
  assert.equal(inspectProperty(session, baseline).error, "operation_id_conflict");
  assert.equal(session.operations.get("op-property-1"), entry);
});

test("WP6 property authority refuses malformed connection, time and Session state without effects", () => {
  const session = state(), baseline = prepared(session);
  lock(session);
  const before = structuredClone(session);
  for (const actor of [null, { ...connection, userId: " actor" }, { ...connection, connectionId: "bad\nid" }]) {
    assert.equal(inspectProperty(session, baseline, propertyIntent(), actor).error,
      "component_authority_context_invalid");
  }
  for (const now of [-1, 1.5, NaN, Infinity, null]) {
    assert.equal(inspectProperty(session, baseline, propertyIntent(), connection, now).error,
      "component_authority_context_invalid");
  }
  assert.equal(inspectProperty({ revision: 4 }, baseline).error, "component_authority_context_invalid");
  assert.deepEqual(session, before);
  session.operations = null;
  assert.equal(inspectProperty(session, baseline).error, "component_operation_history_unavailable");
});
