import assert from "node:assert/strict";
import test from "node:test";
import {
  isLogicalComponentId,
  isSavedComponentId,
  prepareComponentIdentityBaseline,
  validateComponentIdentityRecord,
} from "../src/component-foundation.mjs";

const sceneId = "scene-a";
const objectId = "GlobalObjectId_V1-2-11111111111111111111111111111111-10-0";
const secondObjectId = "GlobalObjectId_V1-2-11111111111111111111111111111111-11-0";
const componentGuid = "22222222222222222222222222222222";
const policy = Object.freeze({
  maxComponents: 3,
  supportedTypes: new Set(["UnityEngine.BoxCollider", "UnityEngine.SphereCollider"]),
});

function component(localId, overrides = {}) {
  return {
    objectId,
    componentId: "GlobalObjectId_V1-2-" + componentGuid + "-" + localId + "-0",
    typeName: "UnityEngine.BoxCollider",
    ...overrides,
  };
}

function session() {
  return {
    revision: 5,
    hierarchySceneIds: new Set([sceneId]),
    hierarchyObjects: new Map([
      [JSON.stringify([sceneId, objectId]), { objectId, sceneId }],
      [JSON.stringify([sceneId, secondObjectId]), { objectId: secondObjectId, sceneId }],
    ]),
  };
}

function seed(components, overrides = {}) {
  return { sceneId, baseRevision: 5, components, ...overrides };
}

test("WP6 pre-wire identity distinguishes multiple Components of identical type under one GameObject", () => {
  const first = component(200);
  const second = component(100);
  const s = session();
  const originalMap = new Map(s.hierarchyObjects);
  const prepared = prepareComponentIdentityBaseline(s, seed([first, second]), policy);
  assert.equal(prepared.error, undefined);
  assert.equal(prepared.records.length, 2);
  assert.deepEqual(prepared.records.map(x => x.componentId), [second.componentId, first.componentId]);
  assert.deepEqual(prepared.records.map(x => x.typeName), ["UnityEngine.BoxCollider", "UnityEngine.BoxCollider"]);
  assert.equal(Object.isFrozen(prepared.records), true);
  assert.equal(Object.isFrozen(prepared.records[0]), true);
  assert.deepEqual(s.hierarchyObjects, originalMap);
  assert.equal(s.revision, 5);
});

test("WP6 pre-wire identical inputs have a deterministic baseline fingerprint independent of iteration order", () => {
  const a = component(100);
  const b = component(200, { objectId: secondObjectId, typeName: "UnityEngine.SphereCollider" });
  const one = prepareComponentIdentityBaseline(session(), seed([b, a]), policy);
  const two = prepareComponentIdentityBaseline(session(), seed([a, b]), policy);
  assert.equal(one.fingerprint, two.fingerprint);
  a.typeName = "Malicious future mutation";
  assert.equal(one.records[0].typeName, "UnityEngine.BoxCollider", "prepared output is not an alias of mutable user input");
  assert.equal(one.fingerprint, two.fingerprint);
});

test("WP6 pre-wire rejects an identity collision even across different owners or Component types", () => {
  const a = component(100);
  const b = component(100, { objectId: secondObjectId, typeName: "UnityEngine.SphereCollider" });
  const prepared = prepareComponentIdentityBaseline(session(), seed([a, b]), policy);
  assert.equal(prepared.error, "component_identity_collision");
  assert.equal(prepared.records, undefined);
});

test("WP6 pre-wire refuses stale revisions and unseeded Scenes without assigning authority", () => {
  const s = session();
  assert.equal(prepareComponentIdentityBaseline(s, seed([component(100)], { baseRevision: 4 }), policy).error,
    "component_stale_revision");
  s.hierarchySceneIds.clear();
  assert.equal(prepareComponentIdentityBaseline(s, seed([component(100)]), policy).error,
    "component_scene_unseeded");
  assert.equal(s.revision, 5);
  assert.equal(s.hierarchyObjects.size, 2);
});

test("WP6 pre-wire rejects records whose owner is not in the authoritative Hierarchy", () => {
  const differentOwner = component(100, { objectId: "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-9-0" });
  const output = prepareComponentIdentityBaseline(session(), seed([differentOwner]), policy);
  assert.equal(output.error, "component_owner_missing");
  assert.equal(output.records, undefined);
});

test("WP6 pre-wire refuses unallowlisted Components and enforces an explicit bounded policy", () => {
  assert.equal(
    prepareComponentIdentityBaseline(session(), seed([component(100, { typeName: "UserScript.Example" })]), policy).error,
    "unsupported_component_type");
  assert.equal(prepareComponentIdentityBaseline(session(), seed([component(100)]), {}).error,
    "component_policy_missing");
  assert.equal(prepareComponentIdentityBaseline(session(), seed([component(100)]), {
    maxComponents: 1, supportedTypes: new Set(),
  }).error, "unsupported_component_type");
  assert.equal(prepareComponentIdentityBaseline(session(), seed([component(100), component(200)]), {
    ...policy, maxComponents: 1,
  }).error, "component_limit_exceeded");
});

test("WP6 pre-wire refuses property payloads, ambiguous IDs, malformed shapes and saved-component impersonation", () => {
  const examples = [
    { ...component(100), properties: { m_IsTrigger: true } },
    { ...component(100), componentId: "tf:c:0123456789abcdef0123456789abcdef" },
    { ...component(100), componentId: "tf:0123456789abcdef0123456789abcdef" },
    { ...component(100), componentId: "GlobalObjectId_V1-2-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-100-0" },
    { ...component(100), objectId: "tf:BAD" },
    { ...component(100), objectId: " " + objectId },
    { ...component(100), typeName: " UnityEngine.BoxCollider" },
    { ...component(100), typeName: "UnityEngine.BoxCollider\nunsafe" },
    { ...component(100), componentId: null },
    { ...component(100), componentId: component(100).componentId + "0".repeat(520) },
    [],
    null,
  ];
  for (const entry of examples) {
    assert.notEqual(validateComponentIdentityRecord(entry), null, "must reject invalid identity");
    const output = prepareComponentIdentityBaseline(session(), seed([entry]), policy);
    assert.equal(output.error, "invalid_component_identity");
    assert.equal(output.records, undefined);
  }
});

test("WP6 pre-wire has distinct strict logical namespaces without enabling logical baseline IDs", () => {
  const logicalComponent = "tf:c:0123456789abcdef0123456789abcdef";
  assert.equal(isLogicalComponentId(logicalComponent), true);
  assert.equal(isSavedComponentId(logicalComponent), false);
  assert.equal(isLogicalComponentId("tf:0123456789abcdef0123456789abcdef"), false);
  assert.equal(isLogicalComponentId("tf:c:0123456789ABCDEF0123456789abcdef"), false);
  assert.equal(isSavedComponentId(component(100).componentId), true);
  assert.equal(prepareComponentIdentityBaseline(session(), seed([
    component(100, { componentId: logicalComponent }),
  ]), policy).error, "invalid_component_identity");
});

test("WP6 pre-wire permits an empty identity-only candidate after Hierarchy seeding", () => {
  const output = prepareComponentIdentityBaseline(session(), seed([]), policy);
  assert.deepEqual(output.records, []);
  assert.equal(output.fingerprint, "[]");
});

test("WP6 pre-wire rejects invalid envelopes and absent authoritative state", () => {
  const s = session();
  const examples = [
    null, { sceneId, baseRevision: 5, components: null },
    seed([], { sceneId: " " }), seed([], { baseRevision: -1 }),
    seed([], { baseRevision: 5.5 }), seed([], { sceneId: sceneId + "\n" }),
    seed([], { requestedOperations: [{ kind: "delete_component" }] }),
  ];
  for (const candidate of examples) {
    assert.equal(prepareComponentIdentityBaseline(s, candidate, policy).error, "invalid_component_baseline");
  }
  assert.equal(prepareComponentIdentityBaseline({}, seed([]), policy).error, "component_authority_unavailable");
  assert.equal(prepareComponentIdentityBaseline(null, seed([]), policy).error, "component_authority_unavailable");
});
