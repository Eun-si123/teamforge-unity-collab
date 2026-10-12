import assert from "node:assert/strict";
import test from "node:test";
import {
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
    applied: { type: "component_structure_applied", serverRevision: 18 },
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
    applied: { type: "transform_applied" },
  });
  assert.equal(classify(s).error, "operation_id_conflict");
  s.operations.set("op-1", {
    fingerprint: JSON.stringify({ messageType: "hierarchy_operation", operationId: "op-1" }),
    applied: { type: "hierarchy_applied" },
  });
  assert.equal(classify(s).error, "operation_id_conflict");
});

test("WP6 preflight rejects changing actor, owner, type, operation kind or identity under a reused ID", () => {
  const s = session(), f = classify(s).fingerprint;
  s.operations.set("op-1", { fingerprint: f });
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
  s.operations.set("op-1", { fingerprint: initial.fingerprint });
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
  a.operations.set("op-1", { fingerprint: f.fingerprint });
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
  s.operations.set("op-1", null);
  assert.equal(classify(s).error, "component_operation_history_invalid");
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
