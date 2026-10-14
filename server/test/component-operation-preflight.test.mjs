import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyComponentPropertyReplay,
  classifyComponentStructureReplay,
} from "../src/component-operation-preflight.mjs";

const sceneId = "scene-replay";
const objectId = "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-10-0";
const savedId = "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-21-0";
const pendingId = "tf:c:0123456789abcdef0123456789abcdef";
const typeName = "UnityEngine.BoxCollider";

function session() {
  return { revision: 17, operations: new Map() };
}

function intent(overrides = {}) {
  return {
    kind: "add_component",
    sceneId,
    objectId,
    componentId: pendingId,
    typeName,
    baseRevision: 17,
    ...overrides,
  };
}

function classify(s, proposed = intent(), operationId = "op-1", actor = "authenticated-editor-1") {
  return classifyComponentStructureReplay(s, proposed, operationId, actor);
}

function appliedFor(proposed = intent(), serverRevision = 18, overrides = {}) {
  return {
    type: "component_structure_applied",
    operationId: "op-1",
    userId: "authenticated-editor-1",
    kind: proposed.kind,
    sceneId: proposed.sceneId,
    objectId: proposed.objectId,
    componentId: proposed.componentId,
    typeName: proposed.typeName,
    baseRevision: proposed.baseRevision,
    serverRevision,
    ...overrides,
  };
}

test("WP6 operation preflight makes an unseen ID an inert authority request, never an applied operation", () => {
  const s = session(), before = new Map(s.operations);
  const result = classify(s);
  assert.equal(result.status, "unseen_requires_authority");
  assert.equal(typeof result.fingerprint, "string");
  assert.match(result.fingerprint, /"messageType":"component_structure_operation"/u);
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(s.operations, before);
  assert.equal(s.revision, 17);
  assert.equal(result.applied, undefined);
});

test("WP6 preflight classifies same ID/content against the successful Session record without rebroadcasting", () => {
  const s = session(), first = classify(s);
  // A *hypothetical* successful authority commit placed a fingerprint in the
  // existing Session-wide cache. This preflight cannot write that cache.
  s.operations.set("op-1", {
    fingerprint: first.fingerprint,
    applied: appliedFor(),
  });
  s.revision = 18;
  const replay = classify(s);
  assert.equal(replay.status, "matching_prior_record_only");
  assert.equal(replay.fingerprint, first.fingerprint);
  assert.equal(replay.applied, undefined, "preflight never returns an authoritative ACK");
  assert.equal(s.revision, 18);
  assert.equal(s.operations.size, 1);
});

test("WP6 preflight uses exactly one operationId namespace across Component/Hierarchy/Transform", () => {
  const s = session();
  s.operations.set("op-1", {
    fingerprint: JSON.stringify({ messageType: "transform_update", operationId: "op-1" }),
    applied: { type: "transform_applied", operationId: "op-1", serverRevision: 17 },
  });
  assert.equal(classify(s).error, "operation_id_conflict");
  s.operations.set("op-1", {
    fingerprint: JSON.stringify({ messageType: "hierarchy_operation", operationId: "op-1" }),
    applied: { type: "hierarchy_applied", operationId: "op-1", serverRevision: 17 },
  });
  assert.equal(classify(s).error, "operation_id_conflict");
});

test("WP6 preflight rejects changing actor, owner, type, operation kind or identity under a reused ID", () => {
  const s = session(), f = classify(s).fingerprint;
  s.operations.set("op-1", {
    fingerprint: f, applied: { operationId: "op-1", serverRevision: 17 },
  });
  const changed = [
    [intent(), "another-authenticated-user"],
    [intent({ objectId: "GlobalObjectId_V1-2-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-10-0" })],
    [intent({ componentId: "tf:c:ffffffffffffffffffffffffffffffff" })],
    [intent({ typeName: "UnityEngine.SphereCollider" })],
    [intent({ baseRevision: 18 })],
    [intent({
      kind: "remove_component",
      componentId: savedId,
    })],
  ];
  for (const [candidate, actor = "authenticated-editor-1"] of changed) {
    assert.equal(classify(s, candidate, "op-1", actor).error, "operation_id_conflict");
  }
});

test("WP6 replay classification comes before current revision refusal for already applied IDs", () => {
  const s = session(), initial = classify(s);
  s.operations.set("op-1", {
    fingerprint: initial.fingerprint, applied: appliedFor(),
  });
  s.revision = 19;
  assert.equal(classify(s).status, "matching_prior_record_only");
  const fresh = classify(s, intent(), "fresh-after-advance");
  assert.equal(fresh.error, "component_structure_stale_revision");
});

test("WP6 preflight rejects ahead-of-authority and stale unseen intents without Session effects", () => {
  const s = session();
  for (const baseRevision of [16, 18]) {
    assert.equal(classify(s, intent({ baseRevision })).error, "component_structure_stale_revision");
  }
  assert.equal(s.operations.size, 0);
  assert.equal(s.revision, 17);
});

test("WP6 operation ID reuse in a different Session is not treated as a matching earlier commit", () => {
  const a = session(), b = session();
  const f = classify(a);
  a.operations.set("op-1", {
    fingerprint: f.fingerprint, applied: appliedFor(),
  });
  a.revision = 18;
  assert.equal(classify(a).status, "matching_prior_record_only");
  assert.equal(classify(b).status, "unseen_requires_authority");
  assert.equal(b.operations.size, 0);
});

test("WP6 preflight rejects malformed identities and malformed or missing Session operation history", () => {
  const s = session();
  for (const operationId of ["", " ", " op-1", "op-1 ", "bad\nid", "x".repeat(129), null]) {
    assert.equal(classify(s, intent(), operationId).error, "invalid_component_operation_identity");
  }
  for (const actor of ["", " bad", "bad\nactor", null]) {
    assert.equal(classify(s, intent(), "op-1", actor).error, "invalid_component_operation_identity");
  }
  assert.equal(classify({ revision: 17, operations: [] }).error,
    "component_operation_history_unavailable");
  assert.equal(classify({ revision: Number.NaN, operations: new Map() }).error,
    "component_operation_history_unavailable");
});

test("WP6 preflight refuses malicious extra fields, invalid structural shapes and corrupt cached entries", () => {
  const s = session();
  for (const bad of [
    { ...intent(), futureValue: true },
    intent({ kind: "set_component" }),
    intent({ componentId: savedId }),
    intent({ baseRevision: -1 }),
    null,
    [],
  ]) {
    assert.equal(classify(s, bad).error, "invalid_component_structure");
  }
  s.operations.set("op-1", { fingerprint: null });
  assert.equal(classify(s).error, "component_operation_history_invalid");
  s.operations.set("op-1", { fingerprint: classify(session()).fingerprint });
  assert.equal(classify(s).error, "component_operation_history_invalid");
  s.operations.set("op-1", {
    fingerprint: classify(session()).fingerprint,
    applied: { operationId: "another-id", serverRevision: 17 },
  });
  assert.equal(classify(s).error, "component_operation_history_invalid");
  s.operations.set("op-1", {
    fingerprint: classify(session()).fingerprint,
    applied: appliedFor(intent(), 18),
  });
  assert.equal(classify(s).error, "component_operation_history_invalid",
    "a future applied revision cannot be accepted as an authoritative replay record");
  s.operations.set("op-1", null);
  assert.equal(classify(s).error, "component_operation_history_invalid");
});

test("WP6 matching replay must contain authentic applied-result type and the same component identity", () => {
  const s = session(), first = classify(s);
  s.revision = 18;
  for (const changes of [
    { type: "hierarchy_applied" },
    { type: "transform_applied" },
    { userId: "other-editor" },
    { kind: "remove_component" },
    { sceneId: "wrong-scene" },
    { objectId: "wrong-owner" },
    { componentId: savedId },
    { typeName: "UnityEngine.SphereCollider" },
    { baseRevision: 18 },
    { serverRevision: 17 },
    { serverRevision: 19 },
  ]) {
    s.operations.set("op-1", { fingerprint: first.fingerprint, applied: appliedFor(intent(), 18, changes) });
    assert.equal(classify(s).error, "component_operation_history_invalid",
      "a matching operation ID must not mask corrupt cached Component applied details");
  }
  s.operations.set("op-1", { fingerprint: first.fingerprint, applied: appliedFor() });
  assert.equal(classify(s).status, "matching_prior_record_only");
  assert.equal(s.operations.size, 1);
});

test("WP6 conflicting operation fingerprints retain cross-type collision errors even when cached ACK is foreign", () => {
  const s = session();
  s.operations.set("op-1", {
    fingerprint: JSON.stringify({ messageType: "hierarchy_operation", operationId: "op-1" }),
    applied: { type: "hierarchy_applied", operationId: "op-1", serverRevision: 17 },
  });
  assert.equal(classify(s).error, "operation_id_conflict");
  assert.equal(s.revision, 17);
});

test("WP6 prototype deliberately does not authorize lock ownership or reserve an operation", () => {
  const s = session();
  const a = classify(s), b = classify(s);
  assert.deepEqual(a, b);
  assert.equal(s.operations.size, 0);
  assert.equal(a.lockOwner, undefined);
  assert.equal(a.allowed, undefined);
  assert.equal(a.serverRevision, undefined);
});

function propertyIntent(overrides = {}) {
  return {
    sceneId, objectId, componentId: savedId, typeName, baseRevision: 17,
    propertyPath: "m_IsTrigger", valueKind: "boolean", value: false,
    ...overrides,
  };
}

function classifyProperty(s, proposed = propertyIntent(), operationId = "op-1", actor = "authenticated-editor-1") {
  return classifyComponentPropertyReplay(s, proposed, operationId, actor);
}

function propertyApplied(proposed = propertyIntent(), overrides = {}) {
  return {
    ...proposed, type: "component_property_applied", operationId: "op-1",
    userId: "authenticated-editor-1", serverRevision: 18, ...overrides,
  };
}

function rememberProperty(s, proposed = propertyIntent(), applied = propertyApplied(proposed)) {
  const first = classifyProperty(s, proposed);
  assert.equal(first.status, "unseen_requires_authority");
  // Hypothetical authority commit: preflight itself never inserts this entry.
  s.operations.set("op-1", { fingerprint: first.fingerprint, applied });
  s.revision = 18;
  return first;
}

for (const [valueKind, value] of [
  ["boolean", false], ["int32", 0], ["float", 1.25],
  ["vector3", { x: 1, y: -2, z: 0 }],
]) {
  test(`WP6 property replay matches complete ${valueKind} records without returning an ACK`, () => {
    const s = session(), proposed = propertyIntent({ valueKind, value });
    const original = structuredClone(proposed);
    const initial = classifyProperty(s, proposed);
    assert.equal(initial.status, "unseen_requires_authority");
    assert.equal(s.operations.size, 0);
    assert.match(initial.fingerprint, /"messageType":"component_property_operation"/u);
    rememberProperty(s, proposed);
    const history = structuredClone(s.operations);
    s.revision = 20;
    const replay = classifyProperty(s, proposed);
    assert.equal(replay.status, "matching_prior_record_only");
    assert.equal(replay.fingerprint, initial.fingerprint);
    assert.equal(Object.isFrozen(replay), true);
    assert.equal(replay.applied, undefined);
    assert.equal(replay.allowed, undefined);
    assert.equal(s.revision, 20);
    assert.deepEqual(s.operations, history);
    assert.deepEqual(proposed, original);
    assert.equal(classifyProperty(s, proposed, "fresh-id").error, "component_property_stale_revision");
  });
}

test("WP6 property replay canonicalizes Vector3 axis order and JSON signed zero", () => {
  const s = session(), proposed = propertyIntent({
    propertyPath: "m_Center", valueKind: "vector3", value: { x: -0, y: 2, z: 3 },
  });
  rememberProperty(s, proposed);
  assert.equal(classifyProperty(s, propertyIntent({
    propertyPath: "m_Center", valueKind: "vector3", value: { z: 3, y: 2, x: 0 },
  })).status, "matching_prior_record_only");
  assert.equal(classifyProperty(s, propertyIntent({
    propertyPath: "m_Center", valueKind: "vector3", value: { x: 0, y: 2, z: 4 },
  })).error, "operation_id_conflict");
});

test("WP6 property fingerprints do not alias successive float values or declared numeric kinds", () => {
  const s = session(), proposed = propertyIntent({ valueKind: "float", value: 0.1 });
  rememberProperty(s, proposed);
  assert.equal(classifyProperty(s, { ...proposed, value: 0.10000000000000002 }).error,
    "operation_id_conflict");
  const integers = session(), numeric = propertyIntent({ valueKind: "int32", value: 0 });
  rememberProperty(integers, numeric);
  assert.equal(classifyProperty(integers, { ...numeric, valueKind: "float" }).error,
    "operation_id_conflict");
});

test("WP6 property ID reuse rejects every changed identity, actor, path, kind and value", () => {
  const s = session();
  rememberProperty(s);
  for (const changes of [
    { sceneId: "another-scene" },
    { objectId: "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-11-0" },
    { componentId: "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-22-0" },
    { typeName: "UnityEngine.SphereCollider" },
    { baseRevision: 18 }, { propertyPath: "m_Enabled" },
    { valueKind: "int32", value: 0 }, { value: true },
  ]) {
    assert.equal(classifyProperty(s, propertyIntent(changes)).error, "operation_id_conflict");
  }
  assert.equal(classifyProperty(s, propertyIntent(), "op-1", "another-editor").error,
    "operation_id_conflict");
});

test("WP6 property and structure IDs share the existing Hierarchy/Transform Session namespace", () => {
  const s = session(), first = classifyProperty(s);
  s.operations.set("op-1", { fingerprint: first.fingerprint, applied: propertyApplied() });
  assert.equal(classify(s).error, "operation_id_conflict");
  const structure = classify(session());
  s.operations.set("op-1", { fingerprint: structure.fingerprint, applied: appliedFor() });
  assert.equal(classifyProperty(s).error, "operation_id_conflict");
  for (const messageType of ["hierarchy_operation", "transform_update"]) {
    s.operations.set("op-1", { fingerprint: JSON.stringify({ messageType, operationId: "op-1" }) });
    assert.equal(classifyProperty(s).error, "operation_id_conflict");
  }
});

test("WP6 property replay refuses corrupt or incomplete applied identities even with a matching fingerprint", () => {
  const s = session(), first = rememberProperty(s);
  const correct = propertyApplied();
  for (const key of Object.keys(correct)) {
    const applied = { ...correct };
    delete applied[key];
    s.operations.set("op-1", { fingerprint: first.fingerprint, applied });
    assert.equal(classifyProperty(s).error, "component_operation_history_invalid", key);
  }
  for (const changes of [
    { type: "component_structure_applied" }, { type: "transform_applied" },
    { operationId: "other-op" }, { userId: "other-editor" },
    { sceneId: "wrong-scene" }, { objectId: "wrong-owner" },
    { componentId: pendingId }, { typeName: "UnityEngine.SphereCollider" },
    { baseRevision: 18 }, { serverRevision: 17 }, { serverRevision: 19 },
    { serverRevision: 17.5 }, { propertyPath: "m_Enabled" },
    { valueKind: "int32", value: 0 }, { value: true }, { value: null },
  ]) {
    s.operations.set("op-1", { fingerprint: first.fingerprint, applied: { ...correct, ...changes } });
    assert.equal(classifyProperty(s).error, "component_operation_history_invalid");
  }
});

test("WP6 property replay validates complete cached vectors rather than accepting matching axes alone", () => {
  const s = session(), proposed = propertyIntent({ valueKind: "vector3", value: { x: 0, y: 1, z: 2 } });
  const first = rememberProperty(s, proposed);
  for (const value of [
    { x: 0, y: 1 }, { x: 0, y: 1, z: 2, w: 0 },
    { x: 0, y: 1, z: 2, [Symbol("hidden")]: 0 },
    { x: 0, y: 1, z: NaN }, { x: 0, y: 1, z: 1000001 },
    [0, 1, 2], null,
  ]) {
    s.operations.set("op-1", { fingerprint: first.fingerprint, applied: propertyApplied(proposed, { value }) });
    assert.equal(classifyProperty(s, proposed).error, "component_operation_history_invalid");
  }
});

test("WP6 property replay rejects non-JSON values and client actor fields before examining history", () => {
  const s = session();
  rememberProperty(s);
  for (const proposed of [
    null, [], { ...propertyIntent(), userId: "trusted-looking-actor" },
    propertyIntent({ value: undefined }), propertyIntent({ value: 0 }),
    propertyIntent({ propertyPath: "m_Center.x" }),
    propertyIntent({ valueKind: "objectReference", value: savedId }),
    propertyIntent({ valueKind: "float", value: NaN }),
    propertyIntent({ valueKind: "float", value: Infinity }),
    propertyIntent({ componentId: "GlobalObjectId_V1-1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-21-0" }),
  ]) {
    assert.equal(classifyProperty(s, proposed).error, "invalid_component_property");
  }
});

test("WP6 property replay rejects invalid history/operation context and retains corrupt cache entries", () => {
  for (const s of [null, { revision: -1, operations: new Map() }, { revision: 17, operations: [] }]) {
    assert.equal(classifyProperty(s).error, "component_operation_history_unavailable");
  }
  const s = session();
  for (const operationId of [null, "", " op-1", "op-1\n", "x".repeat(129)]) {
    assert.equal(classifyProperty(s, propertyIntent(), operationId).error, "invalid_component_operation_identity");
  }
  assert.equal(classifyProperty(s, propertyIntent(), "op-1", " actor").error,
    "invalid_component_operation_identity");
  for (const entry of [null, {}, { fingerprint: null }, { fingerprint: classifyProperty(session()).fingerprint }]) {
    s.operations.set("op-1", entry);
    assert.equal(classifyProperty(s).error, "component_operation_history_invalid");
    assert.equal(s.operations.get("op-1"), entry);
  }
});

test("WP6 property histories remain Session-local and unseen future revisions do not reserve IDs", () => {
  const a = session(), b = session();
  rememberProperty(a);
  assert.equal(classifyProperty(a).status, "matching_prior_record_only");
  assert.equal(classifyProperty(b).status, "unseen_requires_authority");
  assert.equal(classifyProperty(b, propertyIntent({ baseRevision: 18 })).error,
    "component_property_stale_revision");
  assert.equal(b.revision, 17);
  assert.equal(b.operations.size, 0);
});
