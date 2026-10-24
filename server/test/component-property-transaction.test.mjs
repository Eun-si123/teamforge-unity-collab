import assert from "node:assert/strict";
import test from "node:test";
import { createSessionState } from "../src/session-authority.mjs";
import { prepareComponentIdentityBaseline } from "../src/component-foundation.mjs";
import { prepareComponentPropertySnapshot } from "../src/component-property-foundation.mjs";
import {
  seedComponentPropertyTransaction,
  commitComponentPropertyTransaction,
  readComponentPropertyTransaction,
} from "../src/component-property-transaction.mjs";

const sceneId = "wp6-local-txn-scene";
const objectId = "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-10-0";
const componentId = "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-20-0";
const typeName = "UnityEngine.BoxCollider";
const actor = Object.freeze({ userId: "editor-a", connectionId: "conn-a" });
const key = JSON.stringify([sceneId, objectId]);
const now = 20000;

function policy() {
  return {
    maxProperties: 6,
    allowedProperties: new Map([[typeName, new Map([
      ["m_IsTrigger", { kind: "boolean" }],
      ["m_Center", { kind: "vector3", maximumAbsolute: 100 }],
    ])]]),
  };
}
function fixture() {
  const session = createSessionState();
  session.revision = 7;
  session.hierarchySceneIds.add(sceneId);
  session.hierarchyObjects.set(key, { sceneId, objectId });
  session.members.set(actor.userId, { connectionId: actor.connectionId });
  session.locks.set(key, {
    sceneId, objectId, ownerUserId: actor.userId, ownerConnectionId: actor.connectionId,
    expiresAtUnixMs: now + 1000,
  });
  const identities = prepareComponentIdentityBaseline(session, {
    sceneId, baseRevision: 7,
    components: [{ objectId, componentId, typeName }],
  }, { maxComponents: 6, supportedTypes: new Set([typeName]) });
  assert.equal(identities.error, undefined);
  const p = policy();
  const snapshot = prepareComponentPropertySnapshot(session, identities, {
    sceneId, baseRevision: 7,
    properties: [
      { objectId, componentId, typeName, propertyPath: "m_IsTrigger", valueKind: "boolean", value: false },
      { objectId, componentId, typeName, propertyPath: "m_Center", valueKind: "vector3",
        value: { x: 0, y: 0, z: 0 } },
    ],
  }, p);
  assert.equal(snapshot.error, undefined);
  const seeded = seedComponentPropertyTransaction(session, identities, snapshot, p);
  assert.equal(seeded.status, "seeded_for_local_simulation");
  return { session, identities, snapshot, policy: p };
}
function edit(overrides = {}) {
  return {
    sceneId, objectId, componentId, typeName, baseRevision: 7,
    propertyPath: "m_IsTrigger", valueKind: "boolean", value: true,
    ...overrides,
  };
}

test("WP6 offline transaction atomically commits an allowed property with shared revision and server-owned history", () => {
  const { session } = fixture();
  const before = readComponentPropertyTransaction(session);
  assert.equal(before.serverRevision, 7);
  const applied = commitComponentPropertyTransaction(session, edit(), "txn-one", actor, now);
  assert.equal(applied.status, "committed_locally");
  assert.equal(applied.applied.serverRevision, 8);
  assert.equal(session.revision, 8);
  assert.equal(session.operations.get("txn-one").applied, applied.applied);
  const after = readComponentPropertyTransaction(session);
  assert.equal(after.serverRevision, 8);
  assert.equal(after.properties.find(x => x.propertyPath === "m_IsTrigger").value, true);
  assert.equal(before.properties.find(x => x.propertyPath === "m_IsTrigger").value, false);
  assert.equal(Object.isFrozen(after.properties), true);
  assert.equal(Object.isFrozen(after.properties[0]), true);
});

test("WP6 matching retry reports only transaction-owned history, without rewriting after a lost lock", () => {
  const { session } = fixture();
  const first = commitComponentPropertyTransaction(session, edit(), "txn-one", actor, now);
  session.locks.clear();
  const replay = commitComponentPropertyTransaction(session, edit(), "txn-one", actor, now + 5000);
  assert.equal(replay.status, "replayed");
  assert.equal(replay.applied, first.applied);
  assert.equal(session.revision, 8);
  assert.equal(readComponentPropertyTransaction(session).properties.length, 2);
  const collision = commitComponentPropertyTransaction(session, edit({ value: false }), "txn-one", actor, now);
  assert.equal(collision.error, "operation_id_conflict");
  assert.equal(session.revision, 8);
});

test("WP6 property transaction blocks foreign lock, missing lock, stale revision and unseeded target with no writes", () => {
  const { session } = fixture();
  const original = readComponentPropertyTransaction(session);
  session.locks.get(key).ownerUserId = "editor-b";
  assert.equal(commitComponentPropertyTransaction(session, edit(), "foreign", actor, now).error,
    "component_property_locked_by_other");
  session.locks.clear();
  assert.equal(commitComponentPropertyTransaction(session, edit(), "no-lock", actor, now).error,
    "component_property_lock_required");
  session.locks.set(key, { sceneId, objectId, ownerUserId: actor.userId,
    ownerConnectionId: actor.connectionId, expiresAtUnixMs: now + 100 });
  assert.equal(commitComponentPropertyTransaction(session, edit({ baseRevision: 6 }),
    "stale", actor, now).error, "component_property_stale_revision");
  assert.equal(commitComponentPropertyTransaction(session, edit({
    propertyPath: "m_Unknown",
  }), "unknown", actor, now).error, "component_property_not_allowed");
  assert.equal(session.revision, 7);
  assert.equal(session.operations.size, 0);
  assert.deepEqual(readComponentPropertyTransaction(session), original);
});

test("WP6 offline transaction validates finite property bounds, records vector by value, and rejects outdated membership", () => {
  const { session } = fixture();
  const value = { x: 2, y: -3, z: 4 };
  const vector = commitComponentPropertyTransaction(session, edit({
    propertyPath: "m_Center", valueKind: "vector3", value,
  }), "vector", actor, now);
  assert.equal(vector.status, "committed_locally");
  value.x = 9999;
  assert.equal(vector.applied.value.x, 2);
  assert.equal(Object.isFrozen(vector.applied.value), true);
  session.members.set(actor.userId, { connectionId: "replaced-connection" });
  const denied = commitComponentPropertyTransaction(session, edit({ baseRevision: 8 }),
    "replaced", actor, now);
  assert.equal(denied.error, "component_session_not_registered");
  assert.equal(session.revision, 8);
});

test("WP6 seed cannot be silently overwritten, forged across Sessions, or omitted", () => {
  const { session, identities, snapshot, policy: p } = fixture();
  assert.equal(seedComponentPropertyTransaction(session, identities, snapshot, p).error,
    "component_transaction_already_seeded");
  assert.equal(commitComponentPropertyTransaction(createSessionState(), edit(), "x", actor, now).error,
    "component_transaction_unseeded");
  const other = createSessionState();
  other.revision = 7;
  other.hierarchySceneIds.add(sceneId);
  other.hierarchyObjects.set(key, { sceneId, objectId });
  assert.equal(seedComponentPropertyTransaction(other, identities, snapshot, p).error,
    "component_transaction_seed_untrusted");
  assert.equal(seedComponentPropertyTransaction(session, identities, { ...snapshot }, p).error,
    "component_transaction_seed_untrusted");
  const invalidSession = createSessionState();
  invalidSession.revision = 7;
  invalidSession.hierarchySceneIds.add(sceneId);
  invalidSession.hierarchyObjects.set(key, { sceneId, objectId });
  const itsIds = prepareComponentIdentityBaseline(invalidSession, {
    sceneId, baseRevision: 7, components: [{ objectId, componentId, typeName }],
  }, { maxComponents: 6, supportedTypes: new Set([typeName]) });
  assert.equal(seedComponentPropertyTransaction(invalidSession, itsIds, { ...snapshot }, p).error,
    "component_transaction_seed_untrusted");
});

test("WP6 externally advanced Session revision cannot silently reuse a stale local property ledger", () => {
  const { session } = fixture();
  const before = readComponentPropertyTransaction(session);
  session.revision += 1; // Represent another authoritative Hierarchy/Transform operation.
  const denied = commitComponentPropertyTransaction(session, edit({ baseRevision: 8 }),
    "external", actor, now);
  assert.equal(denied.error, "component_transaction_reseed_required");
  assert.equal(readComponentPropertyTransaction(session).error, "component_transaction_reseed_required");
  assert.equal(session.operations.size, 0);
  assert.equal(before.serverRevision, 7);
});

test("WP6 bounded history fails closed without evicting existing Transform/Hierarchy operation IDs", () => {
  const session = createSessionState();
  session.revision = 7;
  session.hierarchySceneIds.add(sceneId);
  session.hierarchyObjects.set(key, { sceneId, objectId });
  session.members.set(actor.userId, { connectionId: actor.connectionId });
  session.locks.set(key, {
    sceneId, objectId, ownerUserId: actor.userId,
    ownerConnectionId: actor.connectionId, expiresAtUnixMs: now + 100,
  });
  const identities = prepareComponentIdentityBaseline(session, {
    sceneId, baseRevision: 7, components: [{ objectId, componentId, typeName }],
  }, { maxComponents: 1, supportedTypes: new Set([typeName]) });
  const p = policy();
  const snapshot = prepareComponentPropertySnapshot(session, identities, {
    sceneId, baseRevision: 7, properties: [
      { objectId, componentId, typeName, propertyPath: "m_IsTrigger", valueKind: "boolean", value: false },
    ],
  }, p);
  assert.equal(seedComponentPropertyTransaction(session, identities, snapshot, p, 1).status,
    "seeded_for_local_simulation");
  const unrelated = { fingerprint: "other-operation", applied: { type: "transform_applied" } };
  session.operations.set("old-transform", unrelated);
  assert.equal(commitComponentPropertyTransaction(session, edit(), "new-component", actor, now).error,
    "component_transaction_history_full");
  assert.equal(session.operations.get("old-transform"), unrelated);
  assert.equal(session.revision, 7);
  assert.equal(readComponentPropertyTransaction(session).properties[0].value, false);
});
