import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULTS } from "../src/config.mjs";
import { createSessionAuthority, makeSessionKey } from "../src/session-authority.mjs";
import { prepareComponentIdentityBaseline } from "../src/component-foundation.mjs";
import { prepareComponentPropertySnapshot } from "../src/component-property-foundation.mjs";

const sceneId = "scene-wp6-adapter";
const objectId = "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-10-0";
const componentId = "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-20-0";
const typeName = "UnityEngine.BoxCollider";
const zero = { x: 0, y: 0, z: 0 };
const unit = { x: 1, y: 1, z: 1 };
const rot = { x: 0, y: 0, z: 0, w: 1 };
const author = {
  connectionId: "connection-a", userId: "editor-a",
  userName: "Editor A", userColor: "#336699",
  supportsTransformSync: true, supportsHierarchySync: true,
  supportsPresence: true, projectId: "project", sessionId: "session",
  sessionKey: makeSessionKey("project", "session"),
};
function propertyPolicy() {
  return { maxProperties: 4, allowedProperties: new Map([
    [typeName, new Map([["m_IsTrigger", { kind: "boolean" }]])],
  ]) };
}
function edit(baseRevision, value = true) {
  return {
    sceneId, objectId, componentId, typeName, baseRevision,
    propertyPath: "m_IsTrigger", valueKind: "boolean", value,
  };
}
function setup() {
  const authority = createSessionAuthority(Object.freeze({ ...DEFAULTS }));
  const registration = authority.dispatch({
    type: "register_presence", connection: author,
    requestId: "hello", nowUnixMs: 1000,
  });
  assert.deepEqual(registration.effects.map(x => x.message?.type ?? x.type), [
    "user_joined", "presence_snapshot", "hierarchy_snapshot", "transform_snapshot",
  ]);
  const seeded = authority.dispatch({
    type: "hierarchy_seed", connection: author, nowUnixMs: 1500,
    message: {
      requestId: "hierarchy-seed", userId: author.userId, sceneId,
      baseRevision: 0, objects: [{
        objectId, name: "Saved Collider owner", parentObjectId: "", siblingIndex: 0,
        localPosition: zero, localRotation: rot, localScale: unit,
      }],
    },
  });
  assert.equal(seeded.effects[0].message.type, "hierarchy_seed_accepted");
  const session = authority.sessions.get(author.sessionKey);
  const identity = prepareComponentIdentityBaseline(session, {
    sceneId, baseRevision: session.revision,
    components: [{ objectId, componentId, typeName }],
  }, { maxComponents: 2, supportedTypes: new Set([typeName]) });
  assert.equal(identity.error, undefined);
  const p = propertyPolicy();
  const snapshot = prepareComponentPropertySnapshot(session, identity, {
    sceneId, baseRevision: session.revision,
    properties: [{
      objectId, componentId, typeName,
      propertyPath: "m_IsTrigger", valueKind: "boolean", value: false,
    }],
  }, p);
  assert.equal(snapshot.error, undefined);
  assert.equal(authority.seedComponentPropertiesForLocalTest(
    author.sessionKey, identity, snapshot, p,
  ).status, "seeded_for_local_simulation");
  const lock = authority.dispatch({
    type: "lock_request", connection: author,
    nowUnixMs: 2000,
    message: { requestId: "lock", userId: author.userId, sceneId, objectId },
  });
  assert.equal(lock.effects[0].message.type, "lock_granted");
  return { authority, session, identity, snapshot, policy: p };
}

test("WP6 Session adapter commits one trusted Component property, shares revision and observes idempotent retry", () => {
  const { authority, session } = setup();
  const committed = authority.commitComponentPropertyForLocalTest(author, edit(0), "property-op", 2500);
  assert.equal(committed.status, "committed_locally");
  assert.equal(session.revision, 1);
  assert.equal(session.operations.get("property-op").applied, committed.applied);
  const snapshot = authority.inspectComponentPropertiesForLocalTest(author.sessionKey);
  assert.equal(snapshot.properties[0].value, true);
  assert.equal(snapshot.serverRevision, 1);
  const beforeCount = session.operations.size;
  const retried = authority.commitComponentPropertyForLocalTest(author, edit(0), "property-op", 2501);
  assert.equal(retried.status, "replayed");
  assert.equal(retried.applied, committed.applied);
  assert.equal(session.revision, 1);
  assert.equal(session.operations.size, beforeCount);
  assert.equal(authority.commitComponentPropertyForLocalTest(author,
    edit(0, false), "property-op", 2501).error, "operation_id_conflict");
});

test("WP6 Session adapter refuses wrong Session, replaced actor, legacy Hierarchy capability and missing lock", () => {
  const { authority, session } = setup();
  const imposter = { ...author, sessionKey: makeSessionKey("other", "session") };
  assert.equal(authority.commitComponentPropertyForLocalTest(imposter, edit(0), "wrong-session", 2500).error,
    "component_session_not_registered");
  const legacy = { ...author, supportsHierarchySync: false };
  assert.equal(authority.commitComponentPropertyForLocalTest(legacy, edit(0), "legacy", 2500).error,
    "component_hierarchy_capability_required");
  session.members.set(author.userId, { connectionId: "new-connection", supportsHierarchySync: true });
  assert.equal(authority.commitComponentPropertyForLocalTest(author, edit(0), "old-owner", 2500).error,
    "component_session_not_registered");
  session.members.set(author.userId, {
    connectionId: author.connectionId, supportsHierarchySync: true,
  });
  session.locks.clear();
  assert.equal(authority.commitComponentPropertyForLocalTest(author, edit(0), "no-lock", 2500).error,
    "component_property_lock_required");
  assert.equal(session.revision, 0);
  assert.equal(session.operations.size, 0);
});

test("WP6 local property view refuses another authoritative Transform revision until explicit retirement/reseed", () => {
  const { authority, session } = setup();
  const transform = authority.dispatch({
    type: "transform_update", connection: author,
    nowUnixMs: 2500,
    message: {
      requestId: "transform", operationId: "transform-op",
      userId: author.userId, sceneId, objectId, baseRevision: 0,
      localPosition: { x: 2, y: 0, z: 0 },
      localRotation: rot, localScale: unit,
    },
  });
  assert.equal(transform.effects.at(-1).message.type, "transform_applied");
  assert.equal(session.revision, 1);
  assert.equal(authority.inspectComponentPropertiesForLocalTest(author.sessionKey).error,
    "component_transaction_reseed_required");
  assert.equal(authority.commitComponentPropertyForLocalTest(author,
    edit(1), "stale-local-ledger", 2600).error, "component_transaction_reseed_required");
  assert.equal(session.operations.has("stale-local-ledger"), false);
  assert.equal(session.operations.has("transform-op"), true);
  assert.equal(authority.retireComponentPropertiesForLocalTest(author.sessionKey), true);
  assert.equal(authority.inspectComponentPropertiesForLocalTest(author.sessionKey).error,
    "component_transaction_unseeded");
});

test("WP6 experimental adapter is not a WS/dispatched command or negotiated capability", () => {
  const { authority } = setup();
  for (const forbidden of [
    "component_property_seed_local", "component_property_commit_local",
    "component_property_snapshot", "component_property_operation",
  ]) {
    assert.throws(() => authority.dispatch({ type: forbidden }), /Unsupported Session Authority command/u);
  }
  const editorB = { ...author, userId: "editor-b", connectionId: "connection-b",
    userName: "Editor B" };
  const registered = authority.dispatch({
    type: "register_presence", connection: editorB, nowUnixMs: 3000,
    requestId: "guest-hello",
  });
  assert.equal(registered.effects.some(x => x.message?.type?.startsWith("component_")), false);
  assert.equal(authority.seedComponentPropertiesForLocalTest(
    "not-a-session", {}, {}, propertyPolicy(),
  ).error, "component_session_missing");
  assert.equal(authority.inspectComponentPropertiesForLocalTest("not-a-session").error,
    "component_session_missing");
  assert.equal(authority.retireComponentPropertiesForLocalTest("not-a-session"), false);
});
