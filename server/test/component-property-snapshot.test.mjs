import assert from "node:assert/strict";
import test from "node:test";
import { createSessionState } from "../src/session-authority.mjs";
import { prepareComponentIdentityBaseline } from "../src/component-foundation.mjs";
import {
  diffPreparedComponentPropertySnapshots,
  inspectComponentPropertyTarget,
  prepareComponentPropertySnapshot,
} from "../src/component-property-foundation.mjs";

const sceneId = "scene-property-snapshot";
const objectId = "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-10-0";
const componentId = "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-20-0";
const secondId = "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-21-0";
const typeName = "UnityEngine.BoxCollider";
const limitBytes = 256 * 1024;

function fixture({ type = typeName, owners = [objectId, objectId], paths } = {}) {
  const session = createSessionState();
  session.revision = 7;
  session.hierarchySceneIds.add(sceneId);
  for (const owner of owners) session.hierarchyObjects.set(JSON.stringify([sceneId, owner]), { sceneId, objectId: owner });
  const identity = prepareComponentIdentityBaseline(session, {
    sceneId, baseRevision: 7, components: [
      { objectId: owners[0], componentId, typeName: type },
      { objectId: owners[1], componentId: secondId, typeName: type },
    ],
  }, { maxComponents: 4, supportedTypes: new Set([type]) });
  assert.equal(identity.error, undefined);
  const policy = { maxProperties: 16, allowedProperties: new Map([[type, paths ?? new Map([
    ["m_IsTrigger", { kind: "boolean" }],
    ["m_Center", { kind: "vector3", maximumAbsolute: 100 }],
    // Hypothetical numeric paths test typed policy, not live Unity support.
    ["m_ProbeFloat", { kind: "float", minimum: 0, maximum: 100 }],
    ["m_ProbeInt", { kind: "int32", minimum: -5, maximum: 5 }],
  ])]]) };
  return { session, identity, policy };
}

function record(changes = {}) {
  return { objectId, componentId, typeName, propertyPath: "m_IsTrigger", valueKind: "boolean", value: false, ...changes };
}

function frame(properties = [record()], changes = {}) {
  return { sceneId, baseRevision: 7, properties, ...changes };
}

function prepare(f, snapshot = frame(), policy = f.policy, identity = f.identity) {
  return prepareComponentPropertySnapshot(f.session, identity, snapshot, policy);
}

function target(changes = {}) {
  return { sceneId, objectId, componentId, typeName, propertyPath: "m_IsTrigger", valueKind: "boolean", ...changes };
}

test("WP6 property snapshot freezes all typed values, preserves false/zero and never mutates Session/input", () => {
  const f = fixture(), before = structuredClone(f.session);
  const vector = { z: 0, y: -2, x: 1 };
  const source = frame([
    record(), record({ propertyPath: "m_ProbeInt", valueKind: "int32", value: 0 }),
    record({ propertyPath: "m_ProbeFloat", valueKind: "float", value: 0 }),
    record({ propertyPath: "m_Center", valueKind: "vector3", value: vector }),
    record({ componentId: secondId, value: true }),
  ]);
  const copy = structuredClone(source), snapshot = prepare(f, source);
  assert.equal(snapshot.error, undefined);
  assert(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.properties));
  assert(snapshot.properties.every(Object.isFrozen));
  assert.equal(snapshot.properties.find(r => r.valueKind === "boolean" && r.componentId === componentId).value, false);
  assert.equal(snapshot.properties.find(r => r.valueKind === "int32").value, 0);
  assert.equal(snapshot.properties.find(r => r.valueKind === "float").value, 0);
  const savedVector = snapshot.properties.find(r => r.valueKind === "vector3").value;
  assert(Object.isFrozen(savedVector));
  assert.deepEqual(savedVector, { x: 1, y: -2, z: 0 });
  assert.deepEqual(source, copy);
  vector.x = 90;
  source.properties.splice(0, 1);
  assert.equal(savedVector.x, 1);
  assert.equal(snapshot.properties.length, 5);
  assert.deepEqual(f.session, before);
});

test("WP6 equivalent property records and Vector3 axis order have deterministic fingerprints", () => {
  const f = fixture(), records = [
    record({ componentId: secondId, value: true }), record(),
    record({ propertyPath: "m_Center", valueKind: "vector3", value: { x: -0, y: 1, z: 2 } }),
  ];
  const first = prepare(f, frame(records));
  const reversed = prepare(f, frame([...records].reverse().map(r => r.valueKind === "vector3"
    ? { ...r, value: { z: 2, y: 1, x: 0 } } : r)));
  assert.equal(first.error, undefined);
  assert.equal(reversed.fingerprint, first.fingerprint);
  assert.deepEqual(first.properties.map(r => [r.componentId, r.propertyPath]),
    reversed.properties.map(r => [r.componentId, r.propertyPath]));
});

test("WP6 duplicate Component/path records are refused, never overwritten or normalized", () => {
  const f = fixture();
  for (const value of [false, true]) {
    assert.equal(prepare(f, frame([record(), record({ value })])).error, "component_property_identity_collision");
  }
  assert.equal(prepare(f, frame([record(), record({ componentId: secondId })])).error, undefined);
  assert.equal(f.session.revision, 7);
});

test("WP6 property snapshot rejects unsupported envelope/record fields, references and unsafe values", () => {
  const f = fixture();
  for (const value of [null, [], { ...frame(), authoritative: true }, frame([], { properties: {} }),
    frame([], { baseRevision: -1 }), frame([], { baseRevision: 7.5 })]) {
    assert.equal(prepare(f, value).error, "invalid_component_property_snapshot");
  }
  for (const value of [record({ extra: true }), record({ sceneId }), null, []]) {
    assert.equal(prepare(f, frame([value])).error, "invalid_component_property_snapshot");
  }
  for (const changes of [
    { value: 0 }, { propertyPath: "m_GameObject" },
    { propertyPath: "m_Center.x" }, { valueKind: "objectReference", value: objectId },
    { propertyPath: "m_ProbeFloat", valueKind: "float", value: NaN },
    { propertyPath: "m_Center", valueKind: "vector3", value: { x: 0, y: 0, z: Infinity } },
    { propertyPath: "m_Center", valueKind: "vector3", value: { x: 0, y: 0, z: 0, w: 1 } },
  ]) assert.equal(prepare(f, frame([record(changes)])).error, "invalid_component_property");
});

test("WP6 snapshot requires an explicit configured count and type/path/range policy", () => {
  const f = fixture();
  for (const maxProperties of [undefined, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(prepare(f, frame(), { ...f.policy, maxProperties }).error,
      "component_property_snapshot_policy_missing");
  }
  assert.equal(prepare(f, frame(), { maxProperties: 4 }).error, "component_property_snapshot_policy_missing");
  assert.equal(prepare(f, frame(), { maxProperties: 4, allowedProperties: new Map() }).error, "component_property_not_allowed");
  assert.equal(prepare(f, frame([record({ propertyPath: "m_ProbeFloat", valueKind: "float", value: -1 })])).error,
    "component_property_range_exceeded");
  const malformed = fixture();
  malformed.policy.allowedProperties.get(typeName).set("m_ProbeFloat", { kind: "float" });
  assert.equal(prepare(malformed, frame([record({ propertyPath: "m_ProbeFloat", valueKind: "float", value: 1 })])).error,
    "component_property_policy_invalid");
});

test("WP6 snapshot counts enforce the configured boundary and a larger policy cannot disable the hard ceiling", () => {
  const f = fixture(), two = frame([record(), record({ componentId: secondId })]);
  assert.equal(prepare(f, two, { ...f.policy, maxProperties: 1 }).error, "component_property_limit_exceeded");
  assert.equal(prepare(f, two, { ...f.policy, maxProperties: 2 }).error, undefined);
  assert.equal(prepare(f, frame(Array.from({ length: 2049 }, () => record())),
    { ...f.policy, maxProperties: Number.MAX_SAFE_INTEGER }).error, "component_property_limit_exceeded");
});

function budgetFixture(count, { type = typeName, secondOwner = "budget-owner-other" } = {}) {
  const paths = new Map(Array.from({ length: count }, (_, index) => [`m_Budget${index}`, { kind: "boolean" }]));
  const f = fixture({ type, owners: ["budget-owner", secondOwner], paths });
  f.policy.maxProperties = 2048;
  const properties = Array.from({ length: count }, (_, index) => record({
    typeName: type, propertyPath: `m_Budget${index}`, objectId: index === count - 1 ? secondOwner : "budget-owner",
    componentId: index === count - 1 ? secondId : componentId,
  }));
  return { ...f, source: frame(properties) };
}

test("WP6 property snapshot accepts exactly 256 KiB canonical bytes and refuses one byte more", () => {
  let low = 1, high = 2048;
  while (low < high) {
    const count = Math.ceil((low + high) / 2), f = budgetFixture(count), result = prepare(f, f.source);
    if (result.error) {
      assert.equal(result.error, "component_property_snapshot_size_limit");
      high = count - 1;
    } else low = count;
  }
  const f = budgetFixture(low), result = prepare(f, f.source);
  assert.equal(result.error, undefined);
  const gap = limitBytes - Buffer.byteLength(result.fingerprint, "utf8");
  assert(gap >= 0 && gap < 450, "One record's byte gap must fit within the owner identity bound.");
  const atLimit = budgetFixture(low, { secondOwner: "budget-owner-other" + "x".repeat(gap) });
  const accepted = prepare(atLimit, atLimit.source);
  assert.equal(accepted.error, undefined);
  assert.equal(Buffer.byteLength(accepted.fingerprint, "utf8"), limitBytes);
  const beyond = budgetFixture(low, { secondOwner: "budget-owner-other" + "x".repeat(gap + 1) });
  assert.equal(prepare(beyond, beyond.source).error, "component_property_snapshot_size_limit");
});

test("WP6 snapshot byte ceiling counts UTF-8 type/value-envelope bytes rather than string characters", () => {
  // Hypothetical allowlisted type names isolate byte accounting from Unity metadata.
  const ascii = budgetFixture(400, { type: "U." + "a".repeat(180) });
  const multibyte = budgetFixture(400, { type: "U." + "한".repeat(180) });
  assert.equal(prepare(ascii, ascii.source).error, undefined);
  assert.equal(prepare(multibyte, multibyte.source).error, "component_property_snapshot_size_limit");
});

test("WP6 empty property snapshots still require current same-Session identity and authoritative Scene", () => {
  const f = fixture();
  const empty = prepare(f, frame([]));
  assert.equal(empty.error, undefined);
  assert.deepEqual(empty.properties, []);
  const copy = { ...f.identity };
  assert.equal(prepare(f, frame([]), f.policy, copy).error, "component_authority_unavailable");
  const foreign = fixture();
  assert.equal(prepare(foreign, frame([]), foreign.policy, f.identity).error, "component_authority_unavailable");
  f.session.revision = 8;
  assert.equal(prepare(f, frame([], { baseRevision: 8 })).error, "component_property_stale_revision");
});

test("WP6 property snapshot refuses stale/ahead revisions, missing owners, Component/type and Scene mismatches", () => {
  const f = fixture();
  for (const baseRevision of [6, 8]) assert.equal(prepare(f, frame([], { baseRevision })).error, "component_property_stale_revision");
  assert.equal(prepare(f, frame([], { sceneId: "other-scene" })).error, "component_property_scene_mismatch");
  assert.equal(prepare(f, frame([record({ componentId: "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-999-0" })])).error,
    "component_property_identity_mismatch");
  assert.equal(prepare(f, frame([record({ typeName: "UnityEngine.SphereCollider" })])).error,
    "component_property_identity_mismatch");
  f.session.hierarchyObjects.clear();
  assert.equal(prepare(f).error, "component_property_owner_missing");
  f.session.hierarchySceneIds.clear();
  assert.equal(prepare(f, frame([])).error, "component_property_scene_mismatch");
});

test("WP6 exact target lookup returns only the requested current frozen property and no repair/grant", () => {
  const f = fixture(), source = frame([
    record(), record({ componentId: secondId, value: true }),
    record({ propertyPath: "m_Center", valueKind: "vector3", value: { x: 1, y: 2, z: 3 } }),
  ]);
  const snapshot = prepare(f, source), before = structuredClone(f.session);
  const selected = inspectComponentPropertyTarget(f.session, snapshot, target(), f.policy);
  assert.equal(selected.error, undefined);
  assert.equal(selected.value, false);
  assert.deepEqual(Object.keys(selected).sort(), [
    "sceneId", "objectId", "componentId", "typeName", "baseRevision", "propertyPath", "valueKind", "value",
  ].sort());
  assert(Object.isFrozen(selected));
  const second = inspectComponentPropertyTarget(f.session, snapshot, target({ componentId: secondId }), f.policy);
  assert.equal(second.value, true);
  const vector = inspectComponentPropertyTarget(f.session, snapshot, target({ propertyPath: "m_Center", valueKind: "vector3" }), f.policy);
  assert(Object.isFrozen(vector.value));
  assert.deepEqual(vector.value, { x: 1, y: 2, z: 3 });
  assert.notEqual(vector.value, snapshot.properties.find(r => r.valueKind === "vector3").value);
  assert.deepEqual(f.session, before);
});

test("WP6 target lookup refuses client lookalikes and foreign Session snapshots", () => {
  const f = fixture(), snapshot = prepare(f);
  for (const lookalike of [null, { ...snapshot }, structuredClone(snapshot), Object.freeze({ ...snapshot })]) {
    assert.equal(inspectComponentPropertyTarget(f.session, lookalike, target(), f.policy).error, "component_authority_unavailable");
  }
  const foreign = fixture();
  assert.equal(inspectComponentPropertyTarget(foreign.session, snapshot, target(), foreign.policy).error,
    "component_authority_unavailable");
});

test("WP6 target lookup never falls back to type/ordinal or another property on mismatched identity", () => {
  const f = fixture(), snapshot = prepare(f);
  for (const changes of [
    { objectId: "other-owner" }, { componentId: secondId },
    { typeName: "UnityEngine.SphereCollider" }, { propertyPath: "m_Enabled" },
    { valueKind: "int32" }, { componentId: " " + componentId },
  ]) assert.equal(inspectComponentPropertyTarget(f.session, snapshot, target(changes), f.policy).error,
    "component_property_target_missing");
  assert.equal(inspectComponentPropertyTarget(f.session, snapshot, target({ sceneId: "foreign-scene" }), f.policy).error,
    "component_property_scene_mismatch");
  for (const malformed of [null, [], { ...target(), value: true }, { ...target(), baseRevision: 7 }]) {
    assert.equal(inspectComponentPropertyTarget(f.session, snapshot, malformed, f.policy).error,
      "invalid_component_property_target");
  }
});

test("WP6 target lookup refuses stale snapshots and rechecks Scene/owner/policy after preparation", () => {
  const f = fixture(), snapshot = prepare(f);
  f.policy.allowedProperties.get(typeName).delete("m_IsTrigger");
  assert.equal(inspectComponentPropertyTarget(f.session, snapshot, target(), f.policy).error,
    "component_property_not_allowed");
  f.policy.allowedProperties.get(typeName).set("m_IsTrigger", { kind: "boolean" });
  f.session.hierarchyObjects.clear();
  assert.equal(inspectComponentPropertyTarget(f.session, snapshot, target(), f.policy).error,
    "component_property_owner_missing");
  f.session.hierarchySceneIds.clear();
  assert.equal(inspectComponentPropertyTarget(f.session, snapshot, target(), f.policy).error,
    "component_property_scene_mismatch");
  f.session.revision = 8;
  assert.equal(inspectComponentPropertyTarget(f.session, snapshot, target(), f.policy).error,
    "component_property_stale_revision");
});

test("WP6 target lookup revalidates numeric bounds rather than treating prepared data as permanent permission", () => {
  const f = fixture(), snapshot = prepare(f, frame([
    record({ propertyPath: "m_ProbeFloat", valueKind: "float", value: 10 }),
  ]));
  assert.equal(snapshot.error, undefined);
  f.policy.allowedProperties.get(typeName).set("m_ProbeFloat", { kind: "float", minimum: 0, maximum: 9 });
  assert.equal(inspectComponentPropertyTarget(f.session, snapshot,
    target({ propertyPath: "m_ProbeFloat", valueKind: "float" }), f.policy).error,
    "component_property_range_exceeded");
});


test("WP6 observation diff reports changed and observed-only paths without implying deletion", () => {
  const f = fixture();
  const before = prepare(f, frame([
    record(),
    record({ propertyPath: "m_ProbeInt", valueKind: "int32", value: 0 }),
    record({ propertyPath: "m_Center", valueKind: "vector3", value: { z: 3, y: 2, x: 1 } }),
  ]));
  const after = prepare(f, frame([
    record({ value: true }),
    record({ propertyPath: "m_Center", valueKind: "vector3", value: { x: 1, y: 2, z: 3 } }),
    record({ componentId: secondId, value: false }),
  ]));
  const originalSession = structuredClone(f.session);
  const comparison = diffPreparedComponentPropertySnapshots(f.session, before, after, f.policy);
  assert.equal(comparison.error, undefined);
  assert.equal(comparison.beforeFingerprint, before.fingerprint);
  assert.equal(comparison.afterFingerprint, after.fingerprint);
  assert.deepEqual(comparison.observedChanged.map(change => [change.before.value, change.after.value]),
    [[false, true]]);
  assert.deepEqual(comparison.observedOnlyBefore.map(entry => entry.propertyPath), ["m_ProbeInt"]);
  assert.deepEqual(comparison.observedOnlyAfter.map(entry => entry.componentId), [secondId]);
  assert(Object.isFrozen(comparison) && Object.isFrozen(comparison.observedChanged));
  assert(Object.isFrozen(comparison.observedChanged[0]) &&
    Object.isFrozen(comparison.observedChanged[0].before));
  assert.deepEqual(f.session, originalSession);
});

test("WP6 observation diff ignores input record/Vector3 ordering and signed numeric zero", () => {
  const f = fixture();
  const records = [
    record({ propertyPath: "m_ProbeFloat", valueKind: "float", value: -0 }),
    record({ propertyPath: "m_Center", valueKind: "vector3", value: { x: 2, y: 0, z: -0 } }),
    record({ value: false }),
  ];
  const before = prepare(f, frame(records));
  const after = prepare(f, frame([...records].reverse().map(entry =>
    entry.valueKind === "vector3"
      ? { ...entry, value: { z: 0, y: 0, x: 2 } }
      : entry.valueKind === "float" ? { ...entry, value: 0 } : entry)));
  const comparison = diffPreparedComponentPropertySnapshots(f.session, before, after, f.policy);
  assert.equal(comparison.error, undefined);
  assert.deepEqual([comparison.observedOnlyBefore, comparison.observedOnlyAfter, comparison.observedChanged],
    [[], [], []]);
  assert.equal(before.fingerprint, after.fingerprint);
});

test("WP6 observation diff rejects lookalikes, foreign sessions and divergent baselines", () => {
  const f = fixture(), prior = prepare(f), after = prepare(f, frame([record({ value: true })]));
  const diff = (a, b, session = f.session) =>
    diffPreparedComponentPropertySnapshots(session, a, b, f.policy);
  for (const fake of [null, [], { ...prior }, structuredClone(prior), Object.freeze({ ...prior })]) {
    assert.equal(diff(fake, after).error, "component_authority_unavailable");
    assert.equal(diff(prior, fake).error, "component_authority_unavailable");
  }
  const other = fixture();
  assert.equal(diff(prior, prepare(other)).error, "component_authority_unavailable");
  assert.equal(diff(prior, after, other.session).error, "component_authority_unavailable");
  const separateIdentity = prepareComponentIdentityBaseline(f.session, {
    sceneId, baseRevision: 7, components: [
      { objectId, componentId, typeName }, { objectId, componentId: secondId, typeName },
    ],
  }, { maxComponents: 4, supportedTypes: new Set([typeName]) });
  assert.equal(separateIdentity.error, undefined);
  assert.equal(diff(prior, prepare(f, frame(), f.policy, separateIdentity)).error,
    "component_property_baseline_mismatch");
  f.session.revision++;
  assert.equal(diff(prior, after).error, "component_property_stale_revision");
});

test("WP6 observation diff rechecks current Scene, owner and typed property policy", () => {
  const f = fixture(), before = prepare(f), after = prepare(f, frame([record({ value: true })]));
  const diff = (policy = f.policy) =>
    diffPreparedComponentPropertySnapshots(f.session, before, after, policy);
  assert.equal(diff(null).error, "component_property_policy_missing");
  f.policy.allowedProperties.get(typeName).delete("m_IsTrigger");
  assert.equal(diff().error, "component_property_not_allowed");
  f.policy.allowedProperties.get(typeName).set("m_IsTrigger", { kind: "boolean" });
  f.session.hierarchyObjects.clear();
  assert.equal(diff().error, "component_property_owner_missing");
  f.session.hierarchyObjects.set(JSON.stringify([sceneId, objectId]), { sceneId, objectId });
  f.session.hierarchySceneIds.clear();
  assert.equal(diff().error, "component_property_scene_mismatch");
});

test("WP6 observation diff refuses silently reinterpreting a property value kind", () => {
  const f = fixture(), before = prepare(f);
  const alternate = { maxProperties: 16, allowedProperties: new Map([
    [typeName, new Map([["m_IsTrigger", { kind: "int32", minimum: 0, maximum: 1 }]])],
  ]) };
  const after = prepare(f, frame([record({ valueKind: "int32", value: 1 })]), alternate);
  assert.equal(after.error, undefined);
  assert.equal(diffPreparedComponentPropertySnapshots(f.session, before, after, f.policy).error,
    "component_property_not_allowed");
});
