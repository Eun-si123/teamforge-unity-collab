import assert from "node:assert/strict";
import test from "node:test";
import { prepareComponentIdentityBaseline } from "../src/component-foundation.mjs";
import {
  prepareComponentPropertyCandidate,
  validateComponentPropertyCandidate,
} from "../src/component-property-foundation.mjs";

const sceneId = "scene-props";
const objectId = "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-11-0";
const componentId = "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-20-0";
const otherComponentId = "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-21-0";
const typeName = "UnityEngine.BoxCollider";

function authority() {
  return {
    revision: 7,
    hierarchySceneIds: new Set([sceneId]),
    hierarchyObjects: new Map([[JSON.stringify([sceneId, objectId]), { sceneId, objectId }]]),
  };
}

function baseline(session = authority()) {
  const b = prepareComponentIdentityBaseline(session, {
    sceneId, baseRevision: session.revision,
    components: [
      { objectId, componentId, typeName },
      { objectId, componentId: otherComponentId, typeName },
    ],
  }, { maxComponents: 4, supportedTypes: new Set([typeName]) });
  assert.equal(b.error, undefined);
  return b;
}

function policy() {
  return {
    allowedProperties: new Map([[typeName, new Map([
      ["m_IsTrigger", { kind: "boolean" }],
      ["m_Center", { kind: "vector3", maximumAbsolute: 100 }],
      ["m_Radius", { kind: "float", minimum: 0, maximum: 100 }],
      ["m_Layer", { kind: "int32", minimum: -2147483648, maximum: 2147483647 }],
    ])]]),
  };
}

function edit(overrides = {}) {
  return {
    sceneId, objectId, componentId, typeName, baseRevision: 7,
    propertyPath: "m_IsTrigger", valueKind: "boolean", value: false,
    ...overrides,
  };
}

test("WP6 typed property candidate accepts explicitly allowed false and true booleans without touching authority", () => {
  const s = authority();
  const source = edit();
  const trusted = baseline(s);
  const before = new Map(s.hierarchyObjects);
  const first = prepareComponentPropertyCandidate(s, trusted, source, policy());
  const second = prepareComponentPropertyCandidate(s, trusted, edit({ value: true }), policy());
  assert.equal(first.error, undefined);
  assert.equal(first.value, false);
  assert.equal(second.value, true);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(s.revision, 7);
  assert.deepEqual(s.hierarchyObjects, before);
});

test("WP6 property candidates reject unsaved, asset and numeric-alias Component identities before lookup", () => {
  const s = authority(), trusted = baseline(s);
  for (const componentId of [
    "GlobalObjectId_V1-0-00000000000000000000000000000000-0-0",
    "GlobalObjectId_V1-2-00000000000000000000000000000000-20-0",
    "GlobalObjectId_V1-1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-20-0",
    "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-020-0",
    "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-20-18446744073709551616",
  ]) {
    const proposed = edit({ componentId });
    assert.notEqual(validateComponentPropertyCandidate(proposed), null, componentId);
    assert.equal(prepareComponentPropertyCandidate(s, trusted, proposed, policy()).error,
      "invalid_component_property", componentId);
  }
  assert.equal(s.revision, 7);
  assert.equal(trusted.records.length, 2);
});

test("WP6 typed property candidate copies frozen vector3 without aliasing user input", () => {
  const s = authority(), trusted = baseline(s);
  const value = { x: 1, y: -2, z: 3 };
  const result = prepareComponentPropertyCandidate(s, trusted,
    edit({ propertyPath: "m_Center", valueKind: "vector3", value }), policy());
  assert.equal(result.error, undefined);
  assert.deepEqual(result.value, { x: 1, y: -2, z: 3 });
  assert.equal(Object.isFrozen(result.value), true);
  value.x = 500;
  assert.equal(result.value.x, 1);
});

test("WP6 typed candidate requires a locally validated identity baseline rather than a forged snapshot", () => {
  const s = authority(), prepared = baseline(s);
  const lookalike = { ...prepared, records: [...prepared.records] };
  assert.equal(prepareComponentPropertyCandidate(s, lookalike, edit(), policy()).error,
    "component_authority_unavailable");
  assert.equal(prepareComponentPropertyCandidate(s, null, edit(), policy()).error,
    "component_authority_unavailable");
  assert.equal(prepareComponentPropertyCandidate({}, prepared, edit(), policy()).error,
    "component_authority_unavailable");
  // A real baseline from Session A must never be accepted on Session B,
  // even when the two Sessions happen to have the same Scene IDs and revision.
  const anotherSession = authority();
  assert.equal(prepareComponentPropertyCandidate(anotherSession, prepared, edit(), policy()).error,
    "component_authority_unavailable");
});

test("WP6 typed candidate refuses stale revision of either edit or identity baseline", () => {
  const s = authority(), trusted = baseline(s);
  assert.equal(prepareComponentPropertyCandidate(s, trusted, edit({ baseRevision: 6 }), policy()).error,
    "component_property_stale_revision");
  s.revision = 8;
  assert.equal(prepareComponentPropertyCandidate(s, trusted, edit({ baseRevision: 8 }), policy()).error,
    "component_property_stale_revision");
  assert.equal(s.revision, 8);
});

test("WP6 typed candidate refuses unknown Component, owner, type, or Scene even with a real baseline", () => {
  const s = authority(), trusted = baseline(s), p = policy();
  assert.equal(prepareComponentPropertyCandidate(s, trusted,
    edit({ componentId: "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-999-0" }), p).error,
    "component_property_identity_mismatch");
  assert.equal(prepareComponentPropertyCandidate(s, trusted,
    edit({ typeName: "UnityEngine.SphereCollider" }), p).error,
    "component_property_identity_mismatch");
  assert.equal(prepareComponentPropertyCandidate(s, trusted,
    edit({ sceneId: "other-scene" }), p).error,
    "component_property_scene_mismatch");
  s.hierarchyObjects.clear();
  assert.equal(prepareComponentPropertyCandidate(s, trusted, edit(), p).error,
    "component_property_owner_missing");
});

test("WP6 typed candidate is fail-closed without an exact configured type/path/kind allowlist", () => {
  const s = authority(), trusted = baseline(s);
  assert.equal(prepareComponentPropertyCandidate(s, trusted, edit(), {}).error,
    "component_property_policy_missing");
  assert.equal(prepareComponentPropertyCandidate(s, trusted, edit(), {
    allowedProperties: new Map(),
  }).error, "component_property_not_allowed");
  assert.equal(prepareComponentPropertyCandidate(s, trusted, edit({
    propertyPath: "m_Radius", valueKind: "boolean",
  }), policy()).error, "component_property_not_allowed");
  assert.equal(prepareComponentPropertyCandidate(s, trusted, edit({
    propertyPath: "m_Unexpected", valueKind: "boolean",
  }), policy()).error, "component_property_not_allowed");
});

test("WP6 typed candidate rejects object references, arrays, managed refs, Prefab and script paths", () => {
  const invalidPaths = [
    "m_Script", "m_GameObject", "m_PrefabInstance", "m_PrefabAsset",
    "m_CorrespondingSourceObject", "m_ManagedReferences",
    "m_Array.data[0]", "m_Clips.Array.data[0]", "m_Center.x",
    " m_Radius", "m_Radius ", "__proto__", "m_Radius/__other",
  ];
  for (const propertyPath of invalidPaths) {
    assert.match(validateComponentPropertyCandidate(edit({ propertyPath })), /property path|SerializedProperty/u);
  }
  const invalidValues = [
    ["objectReference", { instanceId: 1 }],
    ["managedReference", { type: "Injected" }],
    ["array", []], ["string", "test"], ["color", { r: 1, g: 1, b: 1, a: 1 }],
  ];
  for (const [valueKind, value] of invalidValues) {
    assert.match(validateComponentPropertyCandidate(edit({ valueKind, value })), /only|supported/iu);
  }
});

test("WP6 typed candidate rejects NaN, infinity, out of bounds floats and malformed vectors", () => {
  const errors = [
    edit({ propertyPath: "m_Radius", valueKind: "float", value: Number.NaN }),
    edit({ propertyPath: "m_Radius", valueKind: "float", value: Infinity }),
    edit({ propertyPath: "m_Radius", valueKind: "float", value: 1000001 }),
    edit({ propertyPath: "m_Layer", valueKind: "int32", value: 2147483648 }),
    edit({ propertyPath: "m_Layer", valueKind: "int32", value: 0.5 }),
    edit({ propertyPath: "m_Center", valueKind: "vector3", value: [1, 2, 3] }),
    edit({ propertyPath: "m_Center", valueKind: "vector3", value: { x: 0, y: 1, z: NaN } }),
    edit({ propertyPath: "m_Center", valueKind: "vector3", value: { x: 0, y: 1, z: 2, w: 1 } }),
    edit({ propertyPath: "m_IsTrigger", value: 1 }),
  ];
  for (const candidate of errors) {
    assert.match(validateComponentPropertyCandidate(candidate), /value|shape/u);
  }
});

test("WP6 typed candidate accepts bounded scalar and vector shapes with explicit policy", () => {
  const s = authority(), trusted = baseline(s), p = policy();
  const examples = [
    edit({ propertyPath: "m_Radius", valueKind: "float", value: 0 }),
    edit({ propertyPath: "m_Radius", valueKind: "float", value: 100 }),
    edit({ propertyPath: "m_Layer", valueKind: "int32", value: -2147483648 }),
    edit({ propertyPath: "m_Layer", valueKind: "int32", value: 2147483647 }),
    edit({ propertyPath: "m_Center", valueKind: "vector3", value: { x: 0, y: 0, z: 0 } }),
  ];
  for (const c of examples) {
    const result = prepareComponentPropertyCandidate(s, trusted, c, p);
    assert.equal(result.error, undefined);
  }
});

test("WP6 numeric policy rejects negative Collider radius and values outside a type-specific range", () => {
  const s = authority(), trusted = baseline(s), p = policy();
  const invalidRadius = edit({ propertyPath: "m_Radius", valueKind: "float", value: -0.5 });
  assert.equal(validateComponentPropertyCandidate(invalidRadius), null,
    "generic type validation allows a finite float, but per-property policy must reject it");
  assert.equal(prepareComponentPropertyCandidate(s, trusted, invalidRadius, p).error,
    "component_property_range_exceeded");
  assert.equal(prepareComponentPropertyCandidate(s, trusted,
    edit({ propertyPath: "m_Radius", valueKind: "float", value: 100.5 }), p).error,
    "component_property_range_exceeded");
  assert.equal(prepareComponentPropertyCandidate(s, trusted,
    edit({ propertyPath: "m_Center", valueKind: "vector3", value: { x: 0, y: -101, z: 0 } }), p).error,
    "component_property_range_exceeded");
});

test("WP6 property policy refuses unspecified numeric bounds and unexpected descriptor fields", () => {
  const s = authority(), trusted = baseline(s);
  const malformed = [
    "float", { kind: "float" }, { kind: "float", minimum: 0, maximum: Infinity },
    { kind: "float", minimum: 9, maximum: 1 },
    { kind: "float", minimum: 0, maximum: 100, unsafe: true },
  ];
  for (const descriptor of malformed) {
    const badPolicy = { allowedProperties: new Map([[typeName,
      new Map([["m_Radius", descriptor]])]]) };
    assert.equal(prepareComponentPropertyCandidate(s, trusted,
      edit({ propertyPath: "m_Radius", valueKind: "float", value: 2 }), badPolicy).error,
      "component_property_policy_invalid");
  }
  const booleanBad = { allowedProperties: new Map([[typeName,
    new Map([["m_IsTrigger", { kind: "boolean", minimum: 0 }]])]]) };
  assert.equal(prepareComponentPropertyCandidate(s, trusted, edit(), booleanBad).error,
    "component_property_policy_invalid");
  const vectorBad = { allowedProperties: new Map([[typeName,
    new Map([["m_Center", { kind: "vector3", maximumAbsolute: -1 }]])]]) };
  assert.equal(prepareComponentPropertyCandidate(s, trusted,
    edit({ propertyPath: "m_Center", valueKind: "vector3", value: { x: 0, y: 1, z: 0 } }), vectorBad).error,
    "component_property_policy_invalid");
});

test("WP6 typed property candidate rejects hidden fields, prototype tricks, missing fields and wrong identity", () => {
  const s = authority(), trusted = baseline(s), p = policy();
  for (const candidate of [
    { ...edit(), futureOperation: "delete_component" },
    { ...edit(), value: null },
    { ...edit(), baseRevision: -1 },
    { ...edit(), objectId: "tf:BAD" },
    Object.assign(Object.create({ injected: true }), edit()),
    { ...edit(), componentId: null },
  ]) {
    assert.equal(prepareComponentPropertyCandidate(s, trusted, candidate, p).error,
      "invalid_component_property");
  }
  const symbolKey = { ...edit() };
  symbolKey[Symbol("hidden")] = "invalid";
  assert.equal(validateComponentPropertyCandidate(symbolKey) !== null, true);
});
