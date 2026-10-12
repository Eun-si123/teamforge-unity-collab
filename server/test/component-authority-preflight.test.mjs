import assert from "node:assert/strict";
import test from "node:test";
import { createSessionState } from "../src/session-authority.mjs";
import { prepareComponentIdentityBaseline } from "../src/component-foundation.mjs";
import { classifyComponentStructureReplay } from "../src/component-operation-preflight.mjs";
import { inspectComponentStructureAuthority } from "../src/component-authority-preflight.mjs";

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
    applied: { operationId: "op-component-1", serverRevision: 5 },
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
