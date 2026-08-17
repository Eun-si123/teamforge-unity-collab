import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULTS } from "../src/config.mjs";
import {
  AUTHORITY_EFFECTS,
  createSessionAuthority,
  makeSessionKey,
} from "../src/session-authority.mjs";

const config = Object.freeze({ ...DEFAULTS });

function connection(overrides = {}) {
  const value = {
    connectionId: "connection-a",
    supportsPresence: true,
    supportsTransformSync: true,
    supportsHierarchySync: true,
    userId: "editor-a",
    userName: "Editor A",
    userColor: "#336699",
    projectId: "project-a",
    sessionId: "session-a",
    sessionKey: makeSessionKey("project-a", "session-a"),
    ...overrides,
  };
  value.sessionKey = makeSessionKey(value.projectId, value.sessionId);
  return value;
}

function register(authority, value, nowUnixMs = 1_000) {
  return authority.dispatch({
    type: "register_presence",
    connection: value,
    requestId: `hello-${value.connectionId}`,
    nowUnixMs,
  });
}

function transformState() {
  return {
    localPosition: { x: 1, y: 2, z: 3 },
    localRotation: { x: 0, y: 0, z: 0, w: 1 },
    localScale: { x: 1, y: 1, z: 1 },
  };
}

function effectMessages(result) {
  return result.effects.map((effect) => effect.message?.type ?? effect.type);
}

test("Session Authority registers Presence and returns ordered transport effects without sockets", () => {
  const authority = createSessionAuthority(config);
  const editor = connection();
  const result = register(authority, editor);

  assert.equal(result.sessionKey, editor.sessionKey);
  assert.deepEqual(effectMessages(result), [
    "user_joined",
    "presence_snapshot",
    "hierarchy_snapshot",
    "transform_snapshot",
  ]);
  assert.equal(authority.sessions.get(editor.sessionKey).members.get(editor.userId).connectionId, editor.connectionId);
  assert.equal(result.effects.some((effect) => "socket" in effect), false);
});

test("Session Authority freezes lease expiry ordering and grants the next requester", () => {
  const authority = createSessionAuthority(config);
  const editorA = connection();
  const editorB = connection({
    connectionId: "connection-b",
    userId: "editor-b",
    userName: "Editor B",
    userColor: "#993366",
  });
  register(authority, editorA);
  register(authority, editorB);

  const lock = {
    requestId: "lock-a",
    userId: editorA.userId,
    sceneId: "scene-a",
    objectId: "object-a",
  };
  const granted = authority.dispatch({
    type: "lock_request",
    connection: editorA,
    message: lock,
    nowUnixMs: 2_000,
  });
  assert.deepEqual(effectMessages(granted), ["lock_granted", "lock_state_changed"]);
  assert.equal(granted.effects[0].message.lockState.expiresAtUnixMs, 2_000 + config.lockLeaseMilliseconds);

  const handoff = authority.dispatch({
    type: "lock_request",
    connection: editorB,
    message: { ...lock, requestId: "lock-b", userId: editorB.userId },
    nowUnixMs: 2_000 + config.lockLeaseMilliseconds,
  });
  assert.deepEqual(effectMessages(handoff), ["lock_released", "lock_granted", "lock_state_changed"]);
  assert.equal(handoff.effects[0].message.reason, "lease_expired");
});

test("Session Authority preserves stale Transform acceptance, revision, and operation replay rules", () => {
  const authority = createSessionAuthority(config);
  const editor = connection({ supportsHierarchySync: false });
  register(authority, editor);
  authority.dispatch({
    type: "lock_request",
    connection: editor,
    message: { requestId: "lock", userId: editor.userId, sceneId: "scene", objectId: "object" },
    nowUnixMs: 2_000,
  });

  const first = {
    requestId: "transform-1",
    operationId: "operation-1",
    userId: editor.userId,
    sceneId: "scene",
    objectId: "object",
    baseRevision: 0,
    ...transformState(),
  };
  const applied1 = authority.dispatch({
    type: "transform_update",
    connection: editor,
    message: first,
    nowUnixMs: 3_000,
  });
  assert.equal(applied1.effects.at(-1).message.serverRevision, 1);

  const stale = { ...first, requestId: "transform-2", operationId: "operation-2" };
  const applied2 = authority.dispatch({
    type: "transform_update",
    connection: editor,
    message: stale,
    nowUnixMs: 4_000,
  });
  assert.equal(applied2.effects.at(-1).message.serverRevision, 2);

  const replay = authority.dispatch({
    type: "transform_update",
    connection: editor,
    message: { ...stale, requestId: "transform-2-retry" },
    nowUnixMs: 5_000,
  });
  assert.equal(replay.effects[0].message.serverRevision, 2);
  assert.equal(replay.effects[0].message.requestId, "transform-2-retry");

  const conflict = authority.dispatch({
    type: "transform_update",
    connection: editor,
    message: { ...stale, requestId: "transform-conflict", localPosition: { x: 9, y: 9, z: 9 } },
    nowUnixMs: 6_000,
  });
  assert.equal(conflict.effects[0].message.code, "operation_id_conflict");
  assert.equal(authority.sessions.get(editor.sessionKey).revision, 2);
});

test("Session Authority preserves exact Hierarchy revision and non-resurrectable tombstones", () => {
  const authority = createSessionAuthority(config);
  const editor = connection();
  register(authority, editor);
  const seed = authority.dispatch({
    type: "hierarchy_seed",
    connection: editor,
    message: {
      requestId: "seed",
      userId: editor.userId,
      sceneId: "scene",
      baseRevision: 0,
      objects: [],
    },
    nowUnixMs: 2_000,
  });
  assert.equal(seed.effects[0].message.type, "hierarchy_seed_accepted");

  const objectId = "tf:11111111111111111111111111111111";
  const create = {
    requestId: "create",
    operationId: "operation-create",
    userId: editor.userId,
    sceneId: "scene",
    objectId,
    kind: "create_object",
    baseRevision: 0,
    name: "Object",
    parentObjectId: "",
    siblingIndex: 0,
    ...transformState(),
  };
  const created = authority.dispatch({
    type: "hierarchy_operation",
    connection: editor,
    message: create,
    nowUnixMs: 3_000,
  });
  assert.equal(created.effects.at(-1).message.serverRevision, 1);

  const deleted = authority.dispatch({
    type: "hierarchy_operation",
    connection: editor,
    message: {
      requestId: "delete",
      operationId: "operation-delete",
      userId: editor.userId,
      sceneId: "scene",
      objectId,
      kind: "delete_object",
      baseRevision: 1,
    },
    nowUnixMs: 4_000,
  });
  assert.equal(deleted.effects.at(-1).message.serverRevision, 2);

  const resurrect = authority.dispatch({
    type: "hierarchy_operation",
    connection: editor,
    message: { ...create, requestId: "resurrect", operationId: "operation-resurrect", baseRevision: 2 },
    nowUnixMs: 5_000,
  });
  assert.equal(resurrect.effects.at(-1).message.reason, "object_id_tombstoned");
  assert.equal(authority.sessions.get(editor.sessionKey).revision, 2);
});

test("Session Authority emits supersede cleanup before close and replacement Presence", () => {
  const authority = createSessionAuthority(config);
  const previous = connection();
  register(authority, previous);
  authority.dispatch({
    type: "lock_request",
    connection: previous,
    message: { requestId: "lock", userId: previous.userId, sceneId: "scene", objectId: "object" },
    nowUnixMs: 2_000,
  });
  const replacement = connection({ connectionId: "connection-new" });
  const result = register(authority, replacement, 3_000);

  assert.deepEqual(effectMessages(result), [
    "lock_released",
    AUTHORITY_EFFECTS.CONNECTION_SUPERSEDED,
    "error",
    AUTHORITY_EFFECTS.CLOSE,
    "presence_updated",
    "presence_snapshot",
    "hierarchy_snapshot",
    "transform_snapshot",
  ]);
  assert.equal(result.effects[0].message.reason, "session_superseded");
  assert.equal(result.effects[3].code, 4001);
});

test("Presence, Transform, Lock, Hierarchy, late join, and reconnect are directionally symmetric", () => {
  assert.deepEqual(runDirectionalAuthorityScenario(false), runDirectionalAuthorityScenario(true));
});

function runDirectionalAuthorityScenario(reverseActors) {
  const authority = createSessionAuthority(config);
  const editorA = connection();
  const editorB = connection({
    connectionId: "connection-b",
    userId: "editor-b",
    userName: "Editor B",
    userColor: "#993366",
  });
  const actor = reverseActors ? editorB : editorA;
  register(authority, editorA);
  register(authority, editorB, 1_100);

  authority.dispatch({
    type: "hierarchy_seed",
    connection: actor,
    message: { requestId: "seed", userId: actor.userId, sceneId: "scene", baseRevision: 0, objects: [] },
    nowUnixMs: 2_000,
  });

  const rootA = "tf:11111111111111111111111111111111";
  const rootB = "tf:22222222222222222222222222222222";
  const child = "tf:33333333333333333333333333333333";
  const sibling = "tf:44444444444444444444444444444444";
  const create = (objectId, name, parentObjectId, baseRevision, siblingIndex = 0) => authority.dispatch({
    type: "hierarchy_operation",
    connection: actor,
    message: {
      requestId: `create-${objectId}`,
      operationId: `operation-create-${objectId}`,
      userId: actor.userId,
      sceneId: "scene",
      objectId,
      kind: "create_object",
      baseRevision,
      name,
      parentObjectId,
      siblingIndex,
      ...transformState(),
    },
    nowUnixMs: 3_000 + baseRevision,
  });
  create(rootA, "Root A", "", 0);
  create(rootB, "Root B", "", 1, 1);
  create(child, "Child", rootA, 2);
  create(sibling, "Sibling", rootB, 3);

  const presence = authority.dispatch({
    type: "presence_update",
    connection: actor,
    message: {
      requestId: "presence-child",
      userId: actor.userId,
      sceneId: "scene",
      sceneName: "Scene",
      selectedObjectId: child,
      selectedObjectName: "Child",
      hasSceneView: false,
      cameraPosition: { x: 0, y: 0, z: 0 },
      cameraRotation: { x: 0, y: 0, z: 0, w: 1 },
      cameraPivot: { x: 0, y: 0, z: 0 },
      cameraSize: 10,
      cameraOrthographic: false,
      activity: "Selecting",
    },
    nowUnixMs: 4_100,
  });
  assert.deepEqual(effectMessages(presence), ["presence_updated"]);

  const lock = authority.dispatch({
    type: "lock_request",
    connection: actor,
    message: { requestId: "lock-child", userId: actor.userId, sceneId: "scene", objectId: child },
    nowUnixMs: 4_200,
  });
  assert.deepEqual(effectMessages(lock), ["lock_granted", "lock_state_changed"]);

  const transformed = authority.dispatch({
    type: "transform_update",
    connection: actor,
    message: {
      requestId: "transform-child",
      operationId: "operation-transform-child",
      userId: actor.userId,
      sceneId: "scene",
      objectId: child,
      baseRevision: 4,
      ...transformState(),
    },
    nowUnixMs: 4_300,
  });
  assert.equal(transformed.effects.at(-1).message.serverRevision, 5);

  const hierarchyOperation = (
    kind,
    baseRevision,
    overrides = {},
    nowUnixMs = 5_000 + baseRevision,
  ) => authority.dispatch({
    type: "hierarchy_operation",
    connection: actor,
    message: {
      requestId: kind,
      operationId: `operation-${kind}`,
      userId: actor.userId,
      sceneId: "scene",
      objectId: child,
      kind,
      baseRevision,
      ...overrides,
    },
    nowUnixMs,
  });
  const renamed = hierarchyOperation("rename_object", 5, { name: "Renamed Child" });
  const reparented = hierarchyOperation("reparent_object", 6, {
    parentObjectId: rootB,
    siblingIndex: 1,
    ...transformState(),
  });
  const reordered = hierarchyOperation("reorder_sibling", 7, { siblingIndex: 0 });
  assert.equal(
    reparented.effects.at(-1).message.type,
    "hierarchy_applied",
    JSON.stringify(reparented.effects.at(-1).message),
  );
  assert.deepEqual(
    [renamed, reparented, reordered].map((result) => result.effects.at(-1).message.serverRevision),
    [6, 7, 8],
  );

  const late = connection({
    connectionId: "connection-late",
    userId: "editor-late",
    userName: "Late Editor",
    userColor: "#669933",
  });
  const lateJoin = register(authority, late, 6_000);
  const lateHierarchy = lateJoin.effects.find((effect) => effect.message?.type === "hierarchy_snapshot").message;
  const lateTransform = lateJoin.effects.find((effect) => effect.message?.type === "transform_snapshot").message;
  assert.equal(lateHierarchy.serverRevision, 8);
  assert.equal(lateTransform.serverRevision, 8);
  assert.equal(lateHierarchy.objects.find((item) => item.objectId === child).name, "Renamed Child");
  assert.equal(lateHierarchy.objects.find((item) => item.objectId === child).parentObjectId, rootB);
  assert.equal(lateHierarchy.objects.find((item) => item.objectId === child).siblingIndex, 0);

  authority.dispatch({
    type: "lock_release",
    connection: actor,
    message: { requestId: "release-child", userId: actor.userId, sceneId: "scene", objectId: child },
    nowUnixMs: 6_100,
  });
  const deleted = hierarchyOperation("delete_object", 8, {}, 6_200);
  assert.equal(deleted.effects.find((effect) => effect.message?.type === "presence_updated")
    .message.presence.selectedObjectId, "");
  const operationRevisions = [transformed, renamed, reparented, reordered, deleted]
    .map((result) => result.effects.find((effect) => Number.isSafeInteger(effect.message?.serverRevision))
      ?.message.serverRevision);
  assert.deepEqual(operationRevisions, [5, 6, 7, 8, 9]);

  const replacement = connection({
    ...actor,
    connectionId: `replacement-${actor.userId}`,
  });
  const reconnected = register(authority, replacement, 7_000);
  const reconnectHierarchy = reconnected.effects.find((effect) => effect.message?.type === "hierarchy_snapshot").message;

  const session = authority.sessions.get(actor.sessionKey);
  assert.equal(session.revision, 9);
  const rolesByConnectionId = new Map([
    [actor.connectionId, "actor"],
    [(reverseActors ? editorA : editorB).connectionId, "observer"],
    [late.connectionId, "late"],
    [replacement.connectionId, "replacement"],
  ]);
  const normalizedRoutes = (result) => result.effects.map((effect) => ({
    type: effect.message?.type ?? effect.type,
    direct: effect.connectionId ? rolesByConnectionId.get(effect.connectionId) : undefined,
    broadcast: effect.connectionIds?.map((connectionId) => rolesByConnectionId.get(connectionId)).sort(),
  }));
  return {
    operationRevisions,
    directionalRoutes: [presence, lock, transformed, renamed, reparented, reordered, deleted]
      .map(normalizedRoutes),
    lateSnapshotOrder: effectMessages(lateJoin),
    reconnectSnapshotOrder: effectMessages(reconnected),
    finalRevision: session.revision,
    finalObjectIds: Array.from(session.hierarchyObjects.values(), (item) => item.objectId).sort(),
    tombstoneIds: Array.from(session.hierarchyTombstones.values(), (item) => item.objectId).sort(),
    reconnectRevision: reconnectHierarchy.serverRevision,
    lockCount: session.locks.size,
    transformCount: session.transforms.size,
  };
}
