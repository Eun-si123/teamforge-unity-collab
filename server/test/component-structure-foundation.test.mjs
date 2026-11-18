import assert from "node:assert/strict";
import test from "node:test";
import { prepareComponentIdentityBaseline } from "../src/component-foundation.mjs";
import {
  prepareComponentStructureCandidate,
  validateComponentStructureCandidate,
} from "../src/component-structure-foundation.mjs";

const sceneId = "scene-struct";
const owner = "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-10-0";
const otherOwner = "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-11-0";
const savedA = "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-200-0";
const savedB = "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-201-0";
const savedC = "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-202-0";
const pending = "tf:c:0123456789abcdef0123456789abcdef";
const BOX = "UnityEngine.BoxCollider";
const SPHERE = "UnityEngine.SphereCollider";
const DEPENDENT = "Fixture.RequiredByBox"; // Synthetic test metadata, not an approved Unity component.

function authority() {
  return {
    revision: 13,
    hierarchySceneIds: new Set([sceneId]),
    hierarchyObjects: new Map([
      [JSON.stringify([sceneId, owner]), { sceneId, objectId: owner }],
      [JSON.stringify([sceneId, otherOwner]), { sceneId, objectId: otherOwner }],
    ]),
  };
}

function record(componentId, objectId = owner, typeName = BOX) {
  return { componentId, objectId, typeName };
}

function identity(s, rows = [record(savedA)]) {
  const b = prepareComponentIdentityBaseline(s, {
    sceneId, baseRevision: s.revision, components: rows,
  }, {
    maxComponents: 16,
    supportedTypes: new Set([BOX, SPHERE, DEPENDENT]),
  });
  assert.equal(b.error, undefined);
  return b;
}

function descriptor(overrides = {}) {
  return {
    canAdd: true, canRemove: true, allowMultiple: true,
    requires: [], minPerObject: 0, maxPerObject: 5,
    ...overrides,
  };
}

function policy(overrides = {}) {
  return {
    maxComponents: 10,
    types: new Map([
      [BOX, descriptor()],
      [SPHERE, descriptor({ allowMultiple: false, maxPerObject: 1 })],
      [DEPENDENT, descriptor({ requires: [BOX] })],
    ]),
    ...overrides,
  };
}

function add(overrides = {}) {
  return {
    kind: "add_component", sceneId, objectId: owner,
    componentId: pending, typeName: BOX, baseRevision: 13, ...overrides,
  };
}

function remove(overrides = {}) {
  return {
    kind: "remove_component", sceneId, objectId: owner,
    componentId: savedA, typeName: BOX, baseRevision: 13, ...overrides,
  };
}

test("WP6 pre-wire add permits same-type duplicates as distinct pending IDs without modifying authority", () => {
  const s = authority();
  const prepared = identity(s, [record(savedA), record(savedB)]);
  const before = new Map(s.hierarchyObjects);
  const proposal = prepareComponentStructureCandidate(s, prepared, add(), policy());
  assert.equal(proposal.error, undefined);
  assert.equal(proposal.kind, "add_component");
  assert.equal(proposal.componentId, pending);
  assert.deepEqual(proposal.requiredTypes, []);
  assert.equal(Object.isFrozen(proposal), true);
  assert.equal(Object.isFrozen(proposal.requiredTypes), true);
  assert.equal(prepared.records.length, 2);
  assert.equal(s.revision, 13);
  assert.deepEqual(s.hierarchyObjects, before);
});

test("WP6 pre-wire remove allows exact saved Component identity without deleting it", () => {
  const s = authority(), prepared = identity(s);
  const proposed = prepareComponentStructureCandidate(s, prepared, remove(), policy());
  assert.equal(proposed.error, undefined);
  assert.equal(proposed.kind, "remove_component");
  assert.equal(proposed.componentId, savedA);
  assert.equal(prepared.records.length, 1);
  assert.equal(s.revision, 13);
});

test("WP6 structural intents reject unknown fields, malformed ids, and unimplemented operation kinds", () => {
  const failures = [
    add({ kind: "reorder_component" }),
    add({ kind: "replace_component" }),
    add({ componentId: savedB }),
    add({ componentId: "tf:c:ABCDEF" }),
    add({ componentId: pending + "\n" }),
    remove({ componentId: pending }),
    remove({ componentId: "GlobalObjectId_V1-2-BAD" }),
    add({ baseRevision: 13.1 }),
    add({ sceneId: " " + sceneId }),
    add({ typeName: BOX + "\n" }),
    { ...add(), extra: "dynamic property" },
    { ...remove(), desiredProperties: {} },
    null,
    [],
  ];
  for (const candidate of failures) {
    assert.notEqual(validateComponentStructureCandidate(candidate), null);
    assert.equal(prepareComponentStructureCandidate(authority(), identity(authority()), candidate, policy()).error,
      "component_structure_authority_unavailable");
  }
  const s = authority(), b = identity(s);
  for (const candidate of failures) {
    assert.equal(prepareComponentStructureCandidate(s, b, candidate, policy()).error,
      "invalid_component_structure");
  }
});

test("WP6 structural proposals cannot reuse another Session's baseline or a forged baseline", () => {
  const s = authority(), b = identity(s);
  assert.equal(prepareComponentStructureCandidate(authority(), b, add(), policy()).error,
    "component_structure_authority_unavailable");
  assert.equal(prepareComponentStructureCandidate(s, { ...b }, add(), policy()).error,
    "component_structure_authority_unavailable");
  assert.equal(prepareComponentStructureCandidate(s, null, add(), policy()).error,
    "component_structure_authority_unavailable");
});

test("WP6 structural proposals are revision fenced and owner/Scene constrained", () => {
  const s = authority(), b = identity(s);
  assert.equal(prepareComponentStructureCandidate(s, b, add({ baseRevision: 12 }), policy()).error,
    "component_structure_stale_revision");
  s.revision = 14;
  assert.equal(prepareComponentStructureCandidate(s, b, add({ baseRevision: 14 }), policy()).error,
    "component_structure_stale_revision");
  s.revision = 13;
  assert.equal(prepareComponentStructureCandidate(s, b, add({ sceneId: "other" }), policy()).error,
    "component_structure_scene_mismatch");
  assert.equal(prepareComponentStructureCandidate(s, b, remove({ objectId: otherOwner }), policy()).error,
    "component_structure_identity_mismatch");
  s.hierarchyObjects.delete(JSON.stringify([sceneId, owner]));
  assert.equal(prepareComponentStructureCandidate(s, b, add(), policy()).error,
    "component_structure_owner_missing");
});

test("WP6 structural planning requires explicit and well-formed type metadata", () => {
  const s = authority(), b = identity(s);
  assert.equal(prepareComponentStructureCandidate(s, b, add(), {}).error,
    "component_structure_policy_missing");
  assert.equal(prepareComponentStructureCandidate(s, b, add(), { ...policy(), maxComponents: 0 }).error,
    "component_structure_policy_missing");
  const malformed = [
    descriptor({ canRemove: "yes" }),
    descriptor({ requires: [BOX, BOX] }),
    descriptor({ requires: "UnityEngine.Rigidbody" }),
    descriptor({ minPerObject: 2, maxPerObject: 1 }),
    descriptor({ allowMultiple: false, maxPerObject: 2 }),
    descriptor({ extra: "unexpected" }),
  ];
  for (const metadata of malformed) {
    const bad = policy({ types: new Map([[BOX, metadata]]) });
    assert.equal(prepareComponentStructureCandidate(s, b, add(), bad).error,
      "component_structure_policy_invalid");
  }
  const protectedType = policy({
    types: new Map([[BOX, descriptor()], ["UnityEngine.Transform", descriptor()]]),
  });
  assert.equal(prepareComponentStructureCandidate(s, b, add(), protectedType).error,
    "component_structure_policy_invalid");
});

test("WP6 structural add refuses unsafe type, disabled operation, and multiplicity/aggregate bounds", () => {
  const s = authority(), b = identity(s);
  assert.equal(prepareComponentStructureCandidate(s, b, add({ typeName: "SomeUnknownBehaviour" }), policy()).error,
    "component_structure_type_not_allowed");
  const noAdds = policy({ types: new Map([[BOX, descriptor({ canAdd: false })]]) });
  assert.equal(prepareComponentStructureCandidate(s, b, add(), noAdds).error,
    "component_structure_add_denied");
  assert.equal(prepareComponentStructureCandidate(s, b,
    add({ typeName: SPHERE }), policy({
      types: new Map([[BOX, descriptor()], [SPHERE, descriptor({
        allowMultiple: false, maxPerObject: 1,
      })]]),
    })).error, undefined);
  const sphere = identity(s, [record(savedA, owner, SPHERE)]);
  assert.equal(prepareComponentStructureCandidate(s, sphere,
    add({ typeName: SPHERE }), policy()).error, "component_structure_limit_exceeded");
  assert.equal(prepareComponentStructureCandidate(s, b, add(), policy({
    maxComponents: 1,
  })).error, "component_structure_limit_exceeded");
});

test("WP6 structural add only succeeds when required dependencies exist on the same owner", () => {
  const s = authority(), b = identity(s, [record(savedA)]);
  const intent = add({ typeName: DEPENDENT });
  const result = prepareComponentStructureCandidate(s, b, intent, policy());
  assert.equal(result.error, undefined);
  assert.deepEqual(result.requiredTypes, [BOX]);
  const wrongOwner = identity(s, [record(savedA, otherOwner)]);
  assert.equal(prepareComponentStructureCandidate(s, wrongOwner, intent, policy()).error,
    "component_structure_dependency_missing");
  const missingMetadata = policy({ types: new Map([
    [BOX, descriptor()],
    [DEPENDENT, descriptor({ requires: ["Fixture.NotDeclared"] })],
  ]) });
  assert.equal(prepareComponentStructureCandidate(s, b, intent, missingMetadata).error,
    "component_structure_policy_incomplete");
});

test("WP6 structural remove refuses orphaning a dependent Component or deleting minimum-required instance", () => {
  const s = authority();
  const rows = [record(savedA), record(savedB, owner, DEPENDENT)];
  const b = identity(s, rows);
  assert.equal(prepareComponentStructureCandidate(s, b, remove(), policy()).error,
    "component_structure_dependency_in_use");
  const protectedPolicy = policy({ types: new Map([
    [BOX, descriptor({ minPerObject: 1 })],
    [DEPENDENT, descriptor({ requires: [BOX] })],
  ]) });
  assert.equal(prepareComponentStructureCandidate(s, identity(s), remove(), protectedPolicy).error,
    "component_structure_minimum_required");
  const denyRemove = policy({ types: new Map([[BOX, descriptor({ canRemove: false })]]) });
  assert.equal(prepareComponentStructureCandidate(s, identity(s), remove(), denyRemove).error,
    "component_structure_remove_denied");
});

test("WP6 structural remove permits one duplicate when another satisfies dependent's required type", () => {
  const s = authority();
  const b = identity(s, [record(savedA), record(savedB), record(savedC, owner, DEPENDENT)]);
  const r = prepareComponentStructureCandidate(s, b, remove(), policy());
  assert.equal(r.error, undefined);
  assert.equal(b.records.length, 3);
});

test("WP6 structural operation never deletes unknown-dependency Components without metadata", () => {
  const s = authority();
  const b = identity(s, [record(savedA), record(savedB, owner, SPHERE)]);
  const incomplete = policy({ types: new Map([[BOX, descriptor()]]) });
  assert.equal(prepareComponentStructureCandidate(s, b, remove(), incomplete).error,
    "component_structure_policy_incomplete");
});

test("WP6 remove candidates reject non-Scene and noncanonical identities before target lookup", () => {
  const s = authority(), b = identity(s);
  for (const componentId of [
    "GlobalObjectId_V1-0-00000000000000000000000000000000-0-0",
    "GlobalObjectId_V1-3-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-200-0",
    "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-0200-0",
    "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-18446744073709551616-0",
  ]) {
    const proposed = remove({ componentId });
    assert.notEqual(validateComponentStructureCandidate(proposed), null, componentId);
    assert.equal(prepareComponentStructureCandidate(s, b, proposed, policy()).error,
      "invalid_component_structure", componentId);
  }
  assert.equal(s.revision, 13);
  assert.equal(b.records.length, 1);
});

test("WP6 structural planning does not authorize Component creation, reserve IDs or alter Session state", () => {
  const s = authority(), b = identity(s);
  const candidate = prepareComponentStructureCandidate(s, b, add(), policy());
  const reused = prepareComponentStructureCandidate(s, b, add(), policy());
  assert.deepEqual(reused, candidate, "same pending ID is not a reserved or authoritative ID");
  assert.equal(s.revision, 13);
  assert.equal(s.hierarchyObjects.size, 2);
  assert.equal(b.records.length, 1);
});

test("WP6 structural intent rejects getter and proxy before invoking their code", () => {
  let getterCalls = 0;
  const accessor = add();
  Object.defineProperty(accessor, "kind", {
    enumerable: true,
    get() { getterCalls += 1; throw new Error("intent getter executed"); },
  });
  assert.doesNotThrow(() => {
    assert.notEqual(validateComponentStructureCandidate(accessor), null);
  });
  assert.equal(getterCalls, 0, "intent validation must never run an accessor");

  let proxyTraps = 0;
  const trapped = new Proxy(add(), {
    getPrototypeOf() { proxyTraps += 1; throw new Error("intent proxy trap executed"); },
  });
  assert.doesNotThrow(() => {
    assert.notEqual(validateComponentStructureCandidate(trapped), null);
  });
  assert.equal(proxyTraps, 0, "intent validation must reject a Proxy before querying its prototype");

  const hidden = add();
  Object.defineProperty(hidden, "secret", { value: 5, enumerable: false });
  assert.notEqual(validateComponentStructureCandidate(hidden), null);
  assert.notEqual(validateComponentStructureCandidate({ ...add(), [Symbol("shadow")]: true }), null);
});

test("WP6 structural policy rejects accessors and proxy metadata without executing them", () => {
  const s = authority(), b = identity(s);
  let getterCalls = 0;
  const metadata = descriptor();
  Object.defineProperty(metadata, "canAdd", {
    enumerable: true,
    get() { getterCalls += 1; throw new Error("metadata getter executed"); },
  });
  const accessorPolicy = policy({ types: new Map([[BOX, metadata]]) });
  assert.doesNotThrow(() => {
    assert.equal(prepareComponentStructureCandidate(s, b, add(), accessorPolicy).error,
      "component_structure_policy_invalid");
  });
  assert.equal(getterCalls, 0);

  let proxyTraps = 0;
  const trappedMetadata = new Proxy(descriptor(), {
    getPrototypeOf() { proxyTraps += 1; throw new Error("policy proxy trap executed"); },
  });
  assert.doesNotThrow(() => {
    assert.equal(prepareComponentStructureCandidate(s, b, add(),
      policy({ types: new Map([[BOX, trappedMetadata]]) })).error,
      "component_structure_policy_invalid");
  });
  assert.equal(proxyTraps, 0);

  const topLevelPolicy = policy();
  Object.defineProperty(topLevelPolicy, "maxComponents", {
    enumerable: true,
    get() { getterCalls += 1; throw new Error("top-level policy getter executed"); },
  });
  assert.doesNotThrow(() => {
    assert.equal(prepareComponentStructureCandidate(s, b, add(), topLevelPolicy).error,
      "component_structure_policy_missing");
  });
  assert.equal(getterCalls, 0);

  const trappedMap = new Proxy(new Map([[BOX, descriptor()]]), {
    getPrototypeOf() { proxyTraps += 1; throw new Error("Map proxy trap executed"); },
  });
  assert.doesNotThrow(() => {
    assert.equal(prepareComponentStructureCandidate(s, b, add(),
      policy({ types: trappedMap })).error, "component_structure_policy_missing");
  });
  assert.equal(proxyTraps, 0);

  const policyProxy = new Proxy(policy(), {
    getPrototypeOf() { proxyTraps += 1; throw new Error("policy wrapper proxy trap executed"); },
  });
  assert.doesNotThrow(() => {
    assert.equal(prepareComponentStructureCandidate(s, b, add(), policyProxy).error,
      "component_structure_policy_missing");
  });
  assert.equal(proxyTraps, 0);
});

test("WP6 dependency arrays reject sparse, accessor, proxy and hidden entries without executing them", () => {
  const s = authority(), b = identity(s);
  let getterCalls = 0, proxyTraps = 0;
  const accessorRequires = [BOX];
  Object.defineProperty(accessorRequires, "0", {
    enumerable: true,
    get() { getterCalls += 1; throw new Error("dependency accessor executed"); },
  });
  const proxyRequires = new Proxy([BOX], {
    get(target, name, receiver) {
      proxyTraps += 1;
      throw new Error("dependency array proxy trap executed: " + String(name));
    },
  });
  const hiddenRequires = [BOX];
  Object.defineProperty(hiddenRequires, "other", { value: "secret", enumerable: false });

  for (const requires of [new Array(1), accessorRequires, proxyRequires, hiddenRequires]) {
    assert.doesNotThrow(() => {
      assert.equal(prepareComponentStructureCandidate(s, b, add(),
        policy({ types: new Map([[BOX, descriptor({ requires })]]) })).error,
        "component_structure_policy_invalid");
    });
  }
  assert.equal(getterCalls, 0);
  assert.equal(proxyTraps, 0);
});

test("WP6 structural guard rejects revoked proxies before Array.isArray or property access", () => {
  const s = authority(), b = identity(s);
  const revokedIntent = Proxy.revocable(add(), {});
  const revokedMetadata = Proxy.revocable(descriptor(), {});
  const revokedRequires = Proxy.revocable([BOX], {});
  const revokedTypes = Proxy.revocable(new Map([[BOX, descriptor()]]), {});
  revokedIntent.revoke();
  revokedMetadata.revoke();
  revokedRequires.revoke();
  revokedTypes.revoke();

  assert.doesNotThrow(() => {
    assert.notEqual(validateComponentStructureCandidate(revokedIntent.proxy), null);
    assert.equal(prepareComponentStructureCandidate(s, b, add(),
      policy({ types: new Map([[BOX, revokedMetadata.proxy]]) })).error,
      "component_structure_policy_invalid");
    assert.equal(prepareComponentStructureCandidate(s, b, add(),
      policy({ types: new Map([[BOX, descriptor({ requires: revokedRequires.proxy })]]) })).error,
      "component_structure_policy_invalid");
    assert.equal(prepareComponentStructureCandidate(s, b, add(),
      policy({ types: revokedTypes.proxy })).error, "component_structure_policy_missing");
  });
});

test("WP6 structural policy rejects forged Map prototype without native internal slots", () => {
  const s = authority(), b = identity(s);
  const forged = Object.create(Map.prototype);
  assert.equal(forged instanceof Map, true);
  assert.doesNotThrow(() => {
    assert.equal(prepareComponentStructureCandidate(s, b, add(),
      policy({ types: forged })).error, "component_structure_policy_missing");
  });
});
