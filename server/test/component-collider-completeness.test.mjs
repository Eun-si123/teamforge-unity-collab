import assert from "node:assert/strict";
import test from "node:test";
import { createSessionState } from "../src/session-authority.mjs";
import { prepareComponentIdentityBaseline } from "../src/component-foundation.mjs";
import { prepareComponentPropertySnapshot } from "../src/component-property-foundation.mjs";
import {
  inspectCompleteSavedColliderObservation,
  seedCompleteSavedColliderTransactionForLocalTest,
} from "../src/component-collider-completeness.mjs";
import {
  commitComponentPropertyTransaction,
  readComponentPropertyTransaction,
} from "../src/component-property-transaction.mjs";

const guid = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const sceneId = guid;
const objectId = `GlobalObjectId_V1-2-${guid}-10-0`;
const otherObjectId = `GlobalObjectId_V1-2-${guid}-11-0`;
const boxId = `GlobalObjectId_V1-2-${guid}-20-0`;
const boxSecondId = `GlobalObjectId_V1-2-${guid}-21-0`;
const sphereId = `GlobalObjectId_V1-2-${guid}-22-0`;
const box = "UnityEngine.BoxCollider";
const sphere = "UnityEngine.SphereCollider";
const actor = { userId: "owner", connectionId: "owner-connection" };
const now = 25000;

const initialIdentities = [
  { objectId, componentId: boxId, typeName: box },
  { objectId, componentId: boxSecondId, typeName: box },
  { objectId: otherObjectId, componentId: sphereId, typeName: sphere },
];
const center = { x: 0, y: -2, z: 3 };
function propsFor(identity) {
  const common = { objectId: identity.objectId, componentId: identity.componentId,
    typeName: identity.typeName };
  return [
    { ...common, propertyPath: "m_IsTrigger", valueKind: "boolean", value: false },
    { ...common, propertyPath: "m_Center", valueKind: "vector3", value: center },
    identity.typeName === box
      ? { ...common, propertyPath: "m_Size", valueKind: "vector3",
        value: { x: 1, y: 2, z: 3 } }
      : { ...common, propertyPath: "m_Radius", valueKind: "float", value: 2.5 },
  ];
}
function policy() {
  return {
    maxProperties: 2048,
    allowedProperties: new Map([
      [box, new Map([
        ["m_IsTrigger", { kind: "boolean" }],
        ["m_Center", { kind: "vector3", maximumAbsolute: 100 }],
        ["m_Size", { kind: "vector3", maximumAbsolute: 100 }],
        ["m_Bonus", { kind: "boolean" }],
      ])],
      [sphere, new Map([
        ["m_IsTrigger", { kind: "boolean" }],
        ["m_Center", { kind: "vector3", maximumAbsolute: 100 }],
        ["m_Radius", { kind: "float", minimum: -100, maximum: 100 }],
      ])],
    ]),
  };
}
function setup({ identities = initialIdentities, records = identities.flatMap(propsFor),
  revision = 7, scene = sceneId, ownerIds = [objectId, otherObjectId],
  widenedPolicy = false, radiusIntPolicy = false } = {}) {
  const session = createSessionState();
  session.revision = revision;
  session.hierarchySceneIds.add(scene);
  for (const owner of ownerIds) {
    session.hierarchyObjects.set(JSON.stringify([scene, owner]), { sceneId: scene, objectId: owner });
  }
  session.members.set(actor.userId, { connectionId: actor.connectionId });
  session.locks.set(JSON.stringify([scene, objectId]), {
    sceneId: scene, objectId, ownerUserId: actor.userId,
    ownerConnectionId: actor.connectionId, expiresAtUnixMs: now + 1000,
  });
  const identity = prepareComponentIdentityBaseline(session, {
    sceneId: scene, baseRevision: revision, components: identities,
  }, { maxComponents: 2048,
    supportedTypes: new Set([...new Set(identities.map(x => x.typeName))]) });
  assert.equal(identity.error, undefined, identity.reason);
  const p = policy();
  if (widenedPolicy) {
    p.allowedProperties.get(box).set("m_Center",
      { kind: "vector3", maximumAbsolute: 200 });
  }
  if (radiusIntPolicy) {
    p.allowedProperties.get(sphere).set("m_Radius",
      { kind: "int32", minimum: 0, maximum: 100 });
  }
  const snapshot = prepareComponentPropertySnapshot(session, identity, {
    sceneId: scene, baseRevision: revision, properties: records,
  }, p);
  assert.equal(snapshot.error, undefined, snapshot.reason);
  return { session, identity, snapshot, policy: p };
}

test("WP6 strict local Collider preflight accepts two same-type Components and a Sphere without changing Session", () => {
  const { session, identity, snapshot } = setup();
  const before = { revision: session.revision, history: session.operations.size,
    locks: session.locks.size, members: session.members.size };
  const verdict = inspectCompleteSavedColliderObservation(session, identity, snapshot);
  assert.equal(verdict.status, "complete_local_observation_unverified");
  assert.deepEqual({ sceneId: verdict.sceneId, baseRevision: verdict.baseRevision,
    componentCount: verdict.componentCount, propertyCount: verdict.propertyCount },
  { sceneId, baseRevision: 7, componentCount: 3, propertyCount: 9 });
  assert.equal(verdict.identityFingerprint, identity.fingerprint);
  assert.equal(verdict.propertyFingerprint, snapshot.fingerprint);
  assert(Object.isFrozen(verdict));
  assert.deepEqual({ revision: session.revision, history: session.operations.size,
    locks: session.locks.size, members: session.members.size }, before);
  assert.equal(readComponentPropertyTransaction(session).error, "component_transaction_unseeded");
});

test("WP6 strict preflight rejects a missing property or a missing whole Component without seeding", () => {
  for (const records of [
    initialIdentities.flatMap(propsFor).slice(0, -1),
    initialIdentities.slice(0, 2).flatMap(propsFor),
  ]) {
    const f = setup({ records });
    const denied = seedCompleteSavedColliderTransactionForLocalTest(
      f.session, f.identity, f.snapshot, f.policy);
    assert.equal(denied.error, "component_collider_observation_incomplete");
    assert.equal(readComponentPropertyTransaction(f.session).error, "component_transaction_unseeded");
    assert.equal(f.session.revision, 7);
    assert.equal(f.session.operations.size, 0);
  }
});

test("WP6 strict preflight rejects extra valid-policy property rather than silently treating it as a Collider field", () => {
  const records = initialIdentities.flatMap(propsFor);
  records.push({ objectId, componentId: boxId, typeName: box,
    propertyPath: "m_Bonus", valueKind: "boolean", value: true });
  const f = setup({ records });
  assert.equal(inspectCompleteSavedColliderObservation(f.session, f.identity, f.snapshot).error,
    "component_collider_observation_incomplete");
});

test("WP6 strict preflight refuses wrong field kinds and Unity-side range mismatches", () => {
  const variants = [
    { mutate: rows => { rows[2] = { ...rows[2], value: { x: -0.25, y: 1, z: 1 } }; } },
    { mutate: rows => { rows[8] = { ...rows[8], value: -1 }; } },
    { mutate: rows => { rows[1] = { ...rows[1], value: { x: 100, y: 0, z: 101 } }; },
      widenedPolicy: true },
    { mutate: rows => { rows[8] = { ...rows[8], valueKind: "int32", value: 2 }; },
      radiusIntPolicy: true },
    { mutate: rows => {
      const previous = rows[0];
      rows[0] = { ...previous, propertyPath: "m_Bonus" };
    } },
  ];
  for (const { mutate, widenedPolicy, radiusIntPolicy } of variants) {
    const rows = initialIdentities.flatMap(propsFor);
    mutate(rows);
    const f = setup({ records: rows, widenedPolicy, radiusIntPolicy });
    const denied = inspectCompleteSavedColliderObservation(f.session, f.identity, f.snapshot);
    assert.equal(denied.error, "component_collider_property_invalid", denied.reason);
    assert.equal(f.session.operations.size, 0);
  }
});

test("WP6 same-Session private registry forbids clones, other Sessions and revision drift", () => {
  const f = setup();
  const foreign = setup();
  for (const [session, identity, snapshot] of [
    [f.session, { ...f.identity }, f.snapshot],
    [f.session, f.identity, { ...f.snapshot }],
    [foreign.session, f.identity, f.snapshot],
    [f.session, null, f.snapshot],
  ]) assert.equal(inspectCompleteSavedColliderObservation(session, identity, snapshot).error,
    "component_collider_observation_untrusted");
  f.session.revision++;
  assert.equal(inspectCompleteSavedColliderObservation(f.session, f.identity, f.snapshot).error,
    "component_collider_observation_stale");
  assert.equal(readComponentPropertyTransaction(f.session).error, "component_transaction_unseeded");
});

test("WP6 strict preflight rejects non-Scene GUIDs, wrong owner Scene and unsupported prefab-instance IDs", () => {
  const forged = setup({ scene: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" });
  assert.equal(inspectCompleteSavedColliderObservation(forged.session, forged.identity,
    forged.snapshot).error, "component_collider_identity_invalid");
  const wrongScene = setup({ scene: "unverified-scene-name" });
  assert.equal(inspectCompleteSavedColliderObservation(wrongScene.session, wrongScene.identity,
    wrongScene.snapshot).error, "component_collider_scene_unverified");
  const prefabIdentities = initialIdentities.map((x, index) =>
    index === 1 ? { ...x, componentId: x.componentId.slice(0, -1) + "100" } : x);
  const prefab = setup({ identities: prefabIdentities });
  assert.equal(inspectCompleteSavedColliderObservation(prefab.session, prefab.identity,
    prefab.snapshot).error, "component_collider_identity_invalid");
  const staleOwner = setup();
  staleOwner.session.hierarchyObjects.delete(JSON.stringify([sceneId, objectId]));
  assert.equal(inspectCompleteSavedColliderObservation(staleOwner.session, staleOwner.identity,
    staleOwner.snapshot).error, "component_collider_identity_invalid");
});

test("WP6 strict preflight refuses unsupported Component types even when caller policy accepts them", () => {
  const extra = { objectId, componentId: boxId, typeName: "UnityEngine.MeshCollider" };
  const f = setup({ identities: [extra], records: [] });
  assert.equal(inspectCompleteSavedColliderObservation(f.session, f.identity, f.snapshot).error,
    "component_collider_observation_incomplete");
  // Having no property records cannot yield a complete baseline; even when
  // a caller starts from a larger upstream allowlist, no write is permitted.
  assert.equal(readComponentPropertyTransaction(f.session).error, "component_transaction_unseeded");
});

test("WP6 strict preflight refuses over 512 Collider identities even when a prepared snapshot is empty", () => {
  const oversized = Array.from({ length: 513 }, (_, i) => ({
    objectId, componentId: `GlobalObjectId_V1-2-${guid}-${1000 + i}-0`, typeName: box,
  }));
  const f = setup({ identities: oversized, records: [] });
  assert.equal(inspectCompleteSavedColliderObservation(f.session, f.identity, f.snapshot).error,
    "component_collider_observation_incomplete");
});

test("WP6 complete local-only seed can commit one already-approved property under a live lock", () => {
  const f = setup();
  const seeded = seedCompleteSavedColliderTransactionForLocalTest(
    f.session, f.identity, f.snapshot, f.policy);
  assert.equal(seeded.status, "seeded_for_local_simulation");
  assert.equal(seeded.properties, 9);
  const before = readComponentPropertyTransaction(f.session);
  assert.equal(before.properties.length, 9);
  assert.equal(before.serverRevision, 7);
  const applied = commitComponentPropertyTransaction(f.session, {
    sceneId, objectId, componentId: boxId, typeName: box, baseRevision: 7,
    propertyPath: "m_IsTrigger", valueKind: "boolean", value: true,
  }, "local-collider-probe", actor, now);
  assert.equal(applied.status, "committed_locally", applied.reason);
  assert.equal(f.session.revision, 8);
  assert.equal(readComponentPropertyTransaction(f.session).serverRevision, 8);
  assert.equal(f.session.operations.size, 1);
});
