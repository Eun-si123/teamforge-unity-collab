import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULTS } from "../src/config.mjs";
import { createSessionAuthority, makeSessionKey } from "../src/session-authority.mjs";
import { prepareComponentIdentityBaseline } from "../src/component-foundation.mjs";
import { prepareComponentPropertySnapshot } from "../src/component-property-foundation.mjs";

const sceneId = "wp6-recovery-scene";
const objectId = "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-10-0";
const componentId = "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-20-0";
const typeName = "UnityEngine.BoxCollider";
const zero = { x: 0, y: 0, z: 0 };
const unit = { x: 1, y: 1, z: 1 };
const rotation = { x: 0, y: 0, z: 0, w: 1 };
const sessionKey = makeSessionKey("project-wp6", "session-wp6");
function editor(userId, connectionId, capability = true) {
  return {
    userId, connectionId, sessionKey,
    projectId: "project-wp6", sessionId: "session-wp6",
    userName: userId, userColor: "#3388aa", supportsPresence: true,
    supportsTransformSync: true, supportsHierarchySync: capability,
  };
}
const author = editor("alice", "alice-1");
const observer = editor("bob", "bob-1");

function policy() {
  return {
    maxProperties: 2,
    allowedProperties: new Map([[typeName,
      new Map([["m_IsTrigger", { kind: "boolean" }]])]]),
  };
}
function request(overrides = {}) {
  return {
    requestId: "recovery-1", sceneId,
    knownRevision: 0, knownFingerprint: "",
    ...overrides,
  };
}
function preview(authority, user = author, r = request(), maxBytes = undefined) {
  return authority.inspectComponentRecoveryForLocalTest(user, r, maxBytes);
}
function setup() {
  const authority = createSessionAuthority(Object.freeze({ ...DEFAULTS }));
  const register = connection => authority.dispatch({
    type: "register_presence", connection,
    requestId: "hello-" + connection.connectionId, nowUnixMs: 1000,
  });
  register(author);
  register(observer);
  const initial = authority.dispatch({
    type: "hierarchy_seed", connection: author, nowUnixMs: 1100,
    message: {
      requestId: "seed", userId: author.userId,
      sceneId, baseRevision: 0,
      objects: [{
        objectId, name: "Saved Object", parentObjectId: "",
        siblingIndex: 0, localPosition: zero,
        localRotation: rotation, localScale: unit,
      }],
    },
  });
  assert.equal(initial.effects[0].message.type, "hierarchy_seed_accepted");
  const session = authority.sessions.get(sessionKey);
  const componentIdentity = prepareComponentIdentityBaseline(session, {
    sceneId, baseRevision: 0,
    components: [{ objectId, componentId, typeName }],
  }, { maxComponents: 1, supportedTypes: new Set([typeName]) });
  assert.equal(componentIdentity.error, undefined);
  const trustedPolicy = policy();
  const snapshot = prepareComponentPropertySnapshot(session, componentIdentity, {
    sceneId, baseRevision: 0,
    properties: [{
      objectId, componentId, typeName,
      propertyPath: "m_IsTrigger", valueKind: "boolean", value: false,
    }],
  }, trustedPolicy);
  assert.equal(snapshot.error, undefined);
  assert.equal(authority.seedComponentPropertiesForLocalTest(
    sessionKey, componentIdentity, snapshot, trustedPolicy,
  ).status, "seeded_for_local_simulation");
  const lock = authority.dispatch({
    type: "lock_request", connection: author,
    message: {
      requestId: "lock", userId: author.userId,
      sceneId, objectId,
    },
    nowUnixMs: 1200,
  });
  assert.equal(lock.effects[0].message.type, "lock_granted");
  return { authority, session, register };
}
function changeTrigger(authority) {
  return authority.commitComponentPropertyForLocalTest(author, {
    sceneId, objectId, componentId, typeName, baseRevision: 0,
    propertyPath: "m_IsTrigger", valueKind: "boolean", value: true,
  }, "property-commit", 1300);
}

test("WP6 recovery preview has deterministic digest, exact unchanged check, and immutable observations", () => {
  const { authority, session } = setup();
  const first = preview(authority);
  assert.equal(first.status, "local_preview_resnapshot");
  assert.equal(first.serverRevision, 0);
  assert.match(first.fingerprint, /^[0-9a-f]{64}$/u);
  assert.equal(first.observedProperties.length, 1);
  assert.equal(first.observedProperties[0].value, false);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.observedProperties), true);
  const same = preview(authority);
  assert.equal(same.fingerprint, first.fingerprint);
  const unchanged = preview(authority, author,
    request({ knownFingerprint: first.fingerprint }));
  assert.equal(unchanged.status, "local_preview_unchanged");
  assert.equal(unchanged.observedProperties, undefined);
  const badHash = preview(authority, author,
    request({ knownFingerprint: "f".repeat(64) }));
  assert.equal(badHash.status, "local_preview_resnapshot",
    "An equal revision without matching content proof must resend the preview");
  assert.equal(session.revision, 0);
  assert.equal(session.operations.size, 0);
});

test("WP6 active late join receives newer preview but never a cached stale mutation", () => {
  const { authority, session } = setup();
  const initial = preview(authority);
  assert.equal(changeTrigger(authority).status, "committed_locally");
  const late = preview(authority, observer,
    request({ knownFingerprint: initial.fingerprint }));
  assert.equal(late.status, "local_preview_resnapshot");
  assert.equal(late.observedProperties[0].value, true);
  assert.equal(late.serverRevision, 1);
  assert.notEqual(late.fingerprint, initial.fingerprint);
  assert.equal(preview(authority, observer,
    request({ knownRevision: 1, knownFingerprint: late.fingerprint })).status,
  "local_preview_unchanged");
  assert.equal(session.operations.size, 1);
});

test("WP6 recovery blocks replaced/unknown members, wrong Session and missing Hierarchy capability", () => {
  const { authority, session, register } = setup();
  const guest = editor("charlie", "charlie-1");
  assert.equal(preview(authority, guest).error,
    "component_recovery_session_not_registered");
  const wrongSession = { ...observer, sessionKey: makeSessionKey("another", "session") };
  assert.equal(preview(authority, wrongSession).error,
    "component_recovery_session_not_registered");
  const incompatible = { ...observer, supportsHierarchySync: false };
  assert.equal(preview(authority, incompatible).error,
    "component_recovery_hierarchy_required");
  const newObserver = editor("bob", "bob-2");
  register(newObserver);
  assert.equal(preview(authority, observer).error,
    "component_recovery_session_not_registered");
  assert.equal(preview(authority, newObserver).status, "local_preview_resnapshot");
  assert.equal(session.revision, 0);
  assert.equal(session.operations.size, 0);
});

test("WP6 recovery validates exact request data before any property exposure", () => {
  const { authority, session } = setup();
  const invalid = [
    request({ requestId: " bad " }),
    request({ sceneId: sceneId + " " }),
    request({ knownRevision: -1 }),
    request({ knownRevision: 0.5 }),
    request({ knownFingerprint: "NOT-A-DIGEST" }),
    request({ knownFingerprint: "F".repeat(64) }),
    { ...request(), unintended: "field" },
    Object.assign(Object.create({ inherited: 1 }), request()),
    Object.assign(Object.create(null), { ...request(), knownRevision: Infinity }),
  ];
  const accessor = { ...request() };
  Object.defineProperty(accessor, "sceneId", { get() { throw Error("accessor ran"); }, enumerable: true });
  invalid.push(accessor);
  const symbol = { ...request(), [Symbol("hidden")]: true };
  invalid.push(symbol);
  const proxied = new Proxy(request(), { get() { throw Error("proxy read"); } });
  invalid.push(proxied);
  for (const value of invalid) {
    const rejected = preview(authority, author, value);
    assert.equal(rejected.error, "component_recovery_request_invalid");
    assert.equal(rejected.observedProperties, undefined);
  }
  assert.equal(preview(authority, author, request({ knownRevision: 1 })).error,
    "component_recovery_revision_ahead");
  assert.equal(preview(authority, author, request({ sceneId: "unseeded-scene" })).error,
    "component_recovery_scene_unseeded");
  assert.equal(session.revision, 0);
});

test("WP6 recovery rejects small/excessive byte limits and full snapshot overflow without changing Session", () => {
  const { authority, session } = setup();
  assert.equal(preview(authority, author, request(), 255).error,
    "component_recovery_limit_invalid");
  assert.equal(preview(authority, author, request(), 256 * 1024 + 1).error,
    "component_recovery_limit_invalid");
  assert.equal(preview(authority, author, request(), 256).error,
    "component_recovery_snapshot_size_limit");
  const large = preview(authority, author, request(), 256 * 1024);
  assert.equal(large.status, "local_preview_resnapshot");
  assert.equal(session.revision, 0);
  assert.equal(session.operations.size, 0);
});

test("WP6 unrelated Transform revision requires trusted reseed before a recovery preview is usable", () => {
  const { authority, session } = setup();
  const update = authority.dispatch({
    type: "transform_update", connection: author, nowUnixMs: 1300,
    message: {
      requestId: "transform", userId: author.userId,
      operationId: "transform-1", sceneId, objectId,
      baseRevision: 0,
      localPosition: { x: 3, y: 0, z: 0 },
      localRotation: rotation, localScale: unit,
    },
  });
  assert.equal(update.effects.at(-1).message.type, "transform_applied");
  assert.equal(preview(authority).error, "component_transaction_reseed_required");
  assert.equal(preview(authority).repair, "resnapshot_required");
  assert.equal(session.revision, 1);
  assert.equal(session.operations.size, 1);
});

test("WP6 internal recovery preview is never routed as a WebSocket/Session command", () => {
  const { authority } = setup();
  for (const forbidden of ["component_recovery_preview", "component_property_snapshot"]) {
    assert.throws(() => authority.dispatch({ type: forbidden }), /Unsupported Session Authority command/u);
  }
});
