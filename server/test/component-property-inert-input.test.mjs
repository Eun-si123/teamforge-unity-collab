import assert from "node:assert/strict";
import test from "node:test";
import { prepareComponentIdentityBaseline } from "../src/component-foundation.mjs";
import {
  prepareComponentPropertyCandidate,
  prepareComponentPropertySnapshot,
  validateComponentPropertyCandidate,
} from "../src/component-property-foundation.mjs";

const sceneId = "scene-property-inert";
const objectId = "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-10-0";
const componentId = "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-20-0";
const typeName = "UnityEngine.BoxCollider";

function fixture() {
  const session = {
    revision: 7,
    hierarchySceneIds: new Set([sceneId]),
    hierarchyObjects: new Map([[JSON.stringify([sceneId, objectId]), { sceneId, objectId }]]),
  };
  const identity = prepareComponentIdentityBaseline(session, {
    sceneId, baseRevision: 7, components: [{ objectId, componentId, typeName }],
  }, { maxComponents: 4, supportedTypes: new Set([typeName]) });
  assert.equal(identity.error, undefined);
  const policy = {
    maxProperties: 4,
    allowedProperties: new Map([[typeName, new Map([
      ["m_IsTrigger", { kind: "boolean" }],
      ["m_Center", { kind: "vector3", maximumAbsolute: 100 }],
    ])]]),
  };
  return { session, identity, policy };
}

function candidate(changes = {}) {
  return { sceneId, objectId, componentId, typeName, baseRevision: 7,
    propertyPath: "m_IsTrigger", valueKind: "boolean", value: false, ...changes };
}
function record(changes = {}) {
  const { sceneId: _scene, baseRevision: _revision, ...entry } = candidate(changes);
  return entry;
}
function prepareSnapshot(f, properties) {
  return prepareComponentPropertySnapshot(f.session, f.identity,
    { sceneId, baseRevision: 7, properties }, f.policy);
}

test("WP6 property candidate rejects accessor-backed fields and Vector3 axes without executing getters", () => {
  const f = fixture();
  let calls = 0;
  const accessor = candidate();
  Object.defineProperty(accessor, "value", { enumerable: true, get() { calls++; return false; } });
  assert.notEqual(validateComponentPropertyCandidate(accessor), null);
  assert.equal(prepareComponentPropertyCandidate(f.session, f.identity, accessor, f.policy).error,
    "invalid_component_property");

  const vector = { x: 1, y: 2, z: 3 };
  Object.defineProperty(vector, "y", { enumerable: true, get() { calls++; return 2; } });
  const proposed = candidate({ propertyPath: "m_Center", valueKind: "vector3", value: vector });
  assert.notEqual(validateComponentPropertyCandidate(proposed), null);
  assert.equal(prepareComponentPropertyCandidate(f.session, f.identity, proposed, f.policy).error,
    "invalid_component_property");

  const hidden = candidate();
  Object.defineProperty(hidden, "value", { value: false, enumerable: false });
  assert.notEqual(validateComponentPropertyCandidate(hidden), null);
  const symbol = candidate();
  symbol[Symbol("extra")] = true;
  assert.notEqual(validateComponentPropertyCandidate(symbol), null);
  assert.equal(calls, 0);

  const nullPrototype = Object.assign(Object.create(null), candidate());
  assert.equal(validateComponentPropertyCandidate(nullPrototype), null);
  assert.equal(prepareComponentPropertyCandidate(f.session, f.identity, nullPrototype, f.policy).error,
    undefined);
});

test("WP6 property policy never invokes an accessor-backed kind descriptor", () => {
  const f = fixture();
  let calls = 0;
  const descriptor = { maximumAbsolute: 100 };
  Object.defineProperty(descriptor, "kind", { enumerable: true, get() { calls++; return "vector3"; } });
  f.policy.allowedProperties.get(typeName).set("m_Center", descriptor);
  const result = prepareComponentPropertyCandidate(f.session, f.identity,
    candidate({ propertyPath: "m_Center", valueKind: "vector3", value: { x: 1, y: 2, z: 3 } }), f.policy);
  assert.equal(result.error, "component_property_policy_invalid");
  assert.equal(calls, 0);
});

test("WP6 property snapshot rejects getter entries, inherited holes and extra array keys", () => {
  const f = fixture();
  let calls = 0;
  const envelope = { sceneId, baseRevision: 7, properties: [record()] };
  Object.defineProperty(envelope, "properties", {
    enumerable: true, get() { calls++; return [record()]; },
  });
  assert.equal(prepareComponentPropertySnapshot(f.session, f.identity, envelope, f.policy).error,
    "invalid_component_property_snapshot");

  const entry = record();
  Object.defineProperty(entry, "value", { enumerable: true, get() { calls++; return false; } });
  assert.equal(prepareSnapshot(f, [entry]).error, "invalid_component_property_snapshot");

  const array = [record()];
  Object.defineProperty(array, "0", { enumerable: true, get() { calls++; return record(); } });
  assert.equal(prepareSnapshot(f, array).error, "invalid_component_property_snapshot");

  const sparse = Array(1);
  Object.setPrototypeOf(sparse, Object.create(Array.prototype, {
    0: { value: record(), enumerable: true },
  }));
  assert.equal(prepareSnapshot(f, sparse).error, "invalid_component_property_snapshot");

  const hidden = [record()];
  Object.defineProperty(hidden, "extra", { value: true, enumerable: false });
  assert.equal(prepareSnapshot(f, hidden).error, "invalid_component_property_snapshot");
  const symbol = [record()];
  symbol[Symbol("extra")] = true;
  assert.equal(prepareSnapshot(f, symbol).error, "invalid_component_property_snapshot");
  assert.equal(calls, 0);

  const frozen = Object.freeze([Object.freeze(record())]);
  assert.equal(prepareSnapshot(f, frozen).error, undefined);
});

test("WP6 property snapshot rejects inherited descriptor substitution under prototype pollution", () => {
  const f = fixture();
  const sparse = Array(1);
  sparse.extra = "surplus own key";
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, "0");
  let result;
  try {
    Object.defineProperty(Object.prototype, "0", {
      configurable: true, writable: true, value: { enumerable: true, value: record() },
    });
    result = prepareSnapshot(f, sparse);
  } finally {
    if (previous) Object.defineProperty(Object.prototype, "0", previous);
    else delete Object.prototype["0"];
  }
  assert.equal(result.error, "invalid_component_property_snapshot");
});

test("WP6 rejects Proxy-backed candidate, Vector3, envelope and list without executing traps", () => {
  const f = fixture();
  let calls = 0;
  const traps = {
    get() { calls++; throw Error("unexpected get"); },
    getPrototypeOf() { calls++; throw Error("unexpected getPrototypeOf"); },
    ownKeys() { calls++; throw Error("unexpected ownKeys"); },
    getOwnPropertyDescriptor() { calls++; throw Error("unexpected descriptor"); },
  };
  const hostile = value => new Proxy(value, traps);
  assert.notEqual(validateComponentPropertyCandidate(hostile(candidate())), null);
  assert.equal(prepareComponentPropertyCandidate(f.session, f.identity, hostile(candidate()), f.policy).error,
    "invalid_component_property");
  assert.notEqual(validateComponentPropertyCandidate(candidate({
    propertyPath: "m_Center", valueKind: "vector3", value: hostile({ x: 1, y: 2, z: 3 }),
  })), null);
  assert.equal(prepareComponentPropertySnapshot(f.session, f.identity,
    hostile({ sceneId, baseRevision: 7, properties: [record()] }), f.policy).error,
    "invalid_component_property_snapshot");
  assert.equal(prepareSnapshot(f, hostile([record()])).error, "invalid_component_property_snapshot");
  const revoked = Proxy.revocable([record()], {});
  revoked.revoke();
  assert.equal(prepareSnapshot(f, revoked.proxy).error, "invalid_component_property_snapshot");
  assert.equal(calls, 0);
});

test("WP6 rejects Proxy policy descriptors and revoked candidate without evaluating traps", () => {
  const f = fixture();
  let calls = 0;
  const descriptor = new Proxy({ kind: "boolean" }, {
    get() { calls++; throw Error("unexpected policy get"); },
    getOwnPropertyDescriptor() { calls++; throw Error("unexpected policy descriptor"); },
  });
  f.policy.allowedProperties.get(typeName).set("m_IsTrigger", descriptor);
  assert.equal(prepareComponentPropertyCandidate(f.session, f.identity, candidate(), f.policy).error,
    "component_property_policy_invalid");
  const revoked = Proxy.revocable(candidate(), {});
  revoked.revoke();
  assert.notEqual(validateComponentPropertyCandidate(revoked.proxy), null);
  assert.equal(prepareComponentPropertyCandidate(f.session, f.identity, revoked.proxy, f.policy).error,
    "invalid_component_property");
  assert.equal(calls, 0);
});
