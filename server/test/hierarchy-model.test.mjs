import assert from "node:assert/strict";
import test from "node:test";
import {
  isLogicalHierarchyObjectId,
  prepareHierarchyOperation,
  prepareHierarchySeed,
  validateHierarchyOperation,
  validateHierarchySeed,
} from "../src/hierarchy-model.mjs";

const config = Object.freeze({
  maxHierarchyObjects: 3,
  maxHierarchyTombstones: 4,
  maxHierarchySnapshotBytes: 1024 * 1024,
  maxHierarchyDepth: 8,
  maxHierarchyNameLength: 128,
});

function transform() {
  return {
    localPosition: { x: 0, y: 0, z: 0 },
    localRotation: { x: 0, y: 0, z: 0, w: 1 },
    localScale: { x: 1, y: 1, z: 1 },
  };
}

function saved(objectId, parentObjectId = "", siblingIndex = 0) {
  return {
    objectId,
    name: objectId,
    parentObjectId,
    siblingIndex,
    ...transform(),
  };
}

function seed(sceneId, baseRevision, objects) {
  return {
    requestId: `seed-${sceneId}`,
    userId: "editor-a",
    sceneId,
    baseRevision,
    objects,
  };
}

function session() {
  return {
    revision: 0,
    hierarchyObjects: new Map(),
    hierarchyTombstones: new Map(),
    hierarchySceneIds: new Set(),
  };
}

test("hierarchy names preserve printable leading/trailing spaces instead of revision-loop normalization", () => {
  const message = seed("scene-spaces", 0, [{ ...saved("global-spaced"), name: "  Spaced Name  " }]);
  assert.equal(validateHierarchySeed(message, config), null);
  const prepared = prepareHierarchySeed(session(), message, config);
  assert.equal(prepared.error, undefined);
  assert.equal(Array.from(prepared.nextObjects.values())[0].name, "  Spaced Name  ");
});

test("logical hierarchy IDs are strict lowercase session IDs", () => {
  assert.equal(isLogicalHierarchyObjectId("tf:0123456789abcdef0123456789abcdef"), true);
  assert.equal(isLogicalHierarchyObjectId("tf:0123456789ABCDEF0123456789abcdef"), false);
  assert.equal(isLogicalHierarchyObjectId("tf:0123"), false);
  assert.equal(isLogicalHierarchyObjectId("GlobalObjectId_V1-2-scene-1-0"), false);
});

test("clean hierarchy seed rejects logical identities and aggregate Session growth", () => {
  const invalidLogical = seed("scene-a", 0, [saved("tf:0123456789abcdef0123456789abcdef")]);
  assert.match(validateHierarchySeed(invalidLogical, config), /saved-object identity/);

  const state = session();
  const first = seed("scene-a", 0, [saved("global-a"), saved("global-b", "global-a")]);
  assert.equal(validateHierarchySeed(first, config), null);
  const preparedFirst = prepareHierarchySeed(state, first, config);
  assert.equal(preparedFirst.error, undefined);
  state.hierarchyObjects = preparedFirst.nextObjects;
  state.hierarchySceneIds.add("scene-a");

  const second = seed("scene-b", 0, [saved("global-c"), saved("global-d")]);
  assert.equal(validateHierarchySeed(second, config), null);
  const preparedSecond = prepareHierarchySeed(state, second, config);
  assert.equal(preparedSecond.error, "hierarchy_object_limit");
  assert.equal(state.hierarchyObjects.size, 2, "prepare must not mutate authoritative state on rejection");
});

test("hierarchy operations reject malformed logical create IDs and stale revisions without mutation", () => {
  const state = session();
  const first = seed("scene-a", 0, [saved("global-root")]);
  state.hierarchyObjects = prepareHierarchySeed(state, first, config).nextObjects;
  state.hierarchySceneIds.add("scene-a");

  const malformed = {
    requestId: "request-create",
    operationId: "operation-create",
    userId: "editor-a",
    sceneId: "scene-a",
    objectId: "tf:BAD",
    kind: "create_object",
    baseRevision: 0,
    name: "Child",
    parentObjectId: "global-root",
    siblingIndex: 0,
    ...transform(),
  };
  assert.match(validateHierarchyOperation(malformed, config), /logical objectId/);

  const unseeded = {
    ...malformed,
    objectId: "tf:0123456789abcdef0123456789abcdef",
    sceneId: "scene-b",
    baseRevision: 0,
  };
  assert.equal(validateHierarchyOperation(unseeded, config), null);
  const unseededPrepared = prepareHierarchyOperation(state, unseeded, { userId: "editor-a" }, config, false);
  assert.equal(unseededPrepared.conflict, "hierarchy_scene_unseeded");

  const stale = {
    ...malformed,
    objectId: "tf:0123456789abcdef0123456789abcdef",
    baseRevision: 1,
  };
  assert.equal(validateHierarchyOperation(stale, config), null);
  const prepared = prepareHierarchyOperation(state, stale, { userId: "editor-a" }, config, false);
  assert.equal(prepared.conflict, "stale_revision");
  assert.equal(state.hierarchyObjects.size, 1);
  assert.equal(state.revision, 0);
});

const wideConfig = Object.freeze({
  ...config,
  maxHierarchyObjects: 16,
  maxHierarchyTombstones: 16,
});

function commitPrepared(state, prepared) {
  assert.equal(prepared.conflict, undefined);
  assert.equal(prepared.error, undefined);
  if (prepared.nextObjects) state.hierarchyObjects = prepared.nextObjects;
  if (prepared.nextTombstones) state.hierarchyTombstones = prepared.nextTombstones;
  if (Number.isSafeInteger(prepared.serverRevision)) state.revision = prepared.serverRevision;
  return prepared;
}

function operation(kind, overrides = {}) {
  const result = {
    requestId: `request-${kind}`,
    operationId: `operation-${kind}`,
    userId: "editor-a",
    kind,
    sceneId: "scene-ops",
    objectId: "tf:11111111111111111111111111111111",
    baseRevision: 0,
    ...overrides,
  };
  if (kind === "create_object") {
    Object.assign(result, {
      name: "Duplicate Name",
      parentObjectId: "global-root",
      siblingIndex: 1,
      ...transform(),
      ...overrides,
    });
  } else if (kind === "rename_object") {
    result.name = overrides.name ?? "Renamed";
  } else if (kind === "reparent_object") {
    Object.assign(result, {
      parentObjectId: overrides.parentObjectId ?? "global-root",
      siblingIndex: overrides.siblingIndex ?? 0,
      ...transform(),
      ...overrides,
    });
  } else if (kind === "reorder_sibling") {
    result.siblingIndex = overrides.siblingIndex ?? 0;
  }
  return result;
}

test("create, reorder, and reparent preserve initial transform while canonicalizing sibling order", () => {
  const state = session();
  const baseline = seed("scene-ops", 0, [
    saved("global-root"),
    { ...saved("global-a", "global-root", 0), name: "Duplicate Name" },
    { ...saved("global-b", "global-root", 1), name: "Other" },
  ]);
  state.hierarchyObjects = prepareHierarchySeed(state, baseline, wideConfig).nextObjects;
  state.hierarchySceneIds.add("scene-ops");

  const createdMessage = operation("create_object", {
    localPosition: { x: 7, y: 8, z: 9 },
    localScale: { x: 2, y: 3, z: 4 },
  });
  assert.equal(validateHierarchyOperation(createdMessage, wideConfig), null);
  const created = commitPrepared(
    state,
    prepareHierarchyOperation(state, createdMessage, { userId: "editor-a" }, wideConfig, false),
  );
  const createdRecord = created.changedObjects.find((item) => item.objectId === createdMessage.objectId);
  assert.equal(createdRecord.name, "Duplicate Name", "duplicate GameObject names must remain allowed");
  assert.deepEqual(createdRecord.localPosition, { x: 7, y: 8, z: 9 });
  assert.deepEqual(createdRecord.localScale, { x: 2, y: 3, z: 4 });
  assert.equal(createdRecord.siblingIndex, 1);
  assert.equal(state.hierarchyObjects.get(JSON.stringify(["scene-ops", "global-b"])).siblingIndex, 2);

  const reordered = commitPrepared(
    state,
    prepareHierarchyOperation(
      state,
      operation("reorder_sibling", { baseRevision: 1, siblingIndex: 0 }),
      { userId: "editor-a" },
      wideConfig,
      false,
    ),
  );
  assert.equal(reordered.serverRevision, 2);
  assert.equal(state.hierarchyObjects.get(JSON.stringify(["scene-ops", createdMessage.objectId])).siblingIndex, 0);
  assert.equal(state.hierarchyObjects.get(JSON.stringify(["scene-ops", "global-a"])).siblingIndex, 1);

  const movedToRoot = commitPrepared(
    state,
    prepareHierarchyOperation(
      state,
      operation("reparent_object", { baseRevision: 2, parentObjectId: "", siblingIndex: 0 }),
      { userId: "editor-a" },
      wideConfig,
      false,
    ),
  );
  assert.equal(movedToRoot.serverRevision, 3);
  assert.equal(state.hierarchyObjects.get(JSON.stringify(["scene-ops", createdMessage.objectId])).parentObjectId, "");
  assert.equal(state.hierarchyObjects.get(JSON.stringify(["scene-ops", createdMessage.objectId])).siblingIndex, 0);

  commitPrepared(
    state,
    prepareHierarchyOperation(
      state,
      operation("reparent_object", { baseRevision: 3, parentObjectId: "global-root", siblingIndex: 99 }),
      { userId: "editor-a" },
      wideConfig,
      false,
    ),
  );
  const childSiblings = Array.from(state.hierarchyObjects.values())
    .filter((item) => item.sceneId === "scene-ops" && item.parentObjectId === "global-root")
    .sort((a, b) => a.siblingIndex - b.siblingIndex);
  assert.deepEqual(childSiblings.map((item) => item.siblingIndex), [0, 1, 2]);
  assert.equal(childSiblings.at(-1).objectId, createdMessage.objectId, "out-of-range sibling index must clamp canonically");
});

test("delete removes a full logical subtree, tombstones every ID, and prevents resurrection", () => {
  const state = session();
  state.hierarchyObjects = prepareHierarchySeed(
    state,
    seed("scene-ops", 0, [saved("global-root")]),
    wideConfig,
  ).nextObjects;
  state.hierarchySceneIds.add("scene-ops");

  const parentId = "tf:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const childId = "tf:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  commitPrepared(state, prepareHierarchyOperation(
    state,
    operation("create_object", { objectId: parentId, siblingIndex: 0 }),
    { userId: "editor-a" }, wideConfig, false,
  ));
  commitPrepared(state, prepareHierarchyOperation(
    state,
    operation("create_object", {
      operationId: "operation-create-child",
      requestId: "request-create-child",
      objectId: childId,
      baseRevision: 1,
      parentObjectId: parentId,
      siblingIndex: 0,
    }),
    { userId: "editor-a" }, wideConfig, false,
  ));

  const deleted = commitPrepared(state, prepareHierarchyOperation(
    state,
    operation("delete_object", { objectId: parentId, baseRevision: 2 }),
    { userId: "editor-a" }, wideConfig, false,
  ));
  assert.equal(deleted.serverRevision, 3);
  assert.deepEqual(new Set(deleted.deletedObjectIds), new Set([parentId, childId]));
  assert.equal(state.hierarchyObjects.has(JSON.stringify(["scene-ops", parentId])), false);
  assert.equal(state.hierarchyObjects.has(JSON.stringify(["scene-ops", childId])), false);
  assert.equal(state.hierarchyTombstones.has(JSON.stringify(["scene-ops", parentId])), true);
  assert.equal(state.hierarchyTombstones.has(JSON.stringify(["scene-ops", childId])), true);

  const renameAfterDelete = prepareHierarchyOperation(
    state,
    operation("rename_object", { objectId: parentId, baseRevision: 3 }),
    { userId: "editor-a" }, wideConfig, false,
  );
  assert.equal(renameAfterDelete.conflict, "object_deleted");

  const recreate = prepareHierarchyOperation(
    state,
    operation("create_object", { objectId: parentId, baseRevision: 3 }),
    { userId: "editor-a" }, wideConfig, false,
  );
  assert.equal(recreate.conflict, "object_id_tombstoned");
});

test("missing parents, cycles, and concurrent same-revision edits fail closed without mutating authoritative state", () => {
  const state = session();
  state.hierarchyObjects = prepareHierarchySeed(
    state,
    seed("scene-ops", 0, [saved("global-root"), saved("global-child", "global-root")]),
    wideConfig,
  ).nextObjects;
  state.hierarchySceneIds.add("scene-ops");

  const missingParent = prepareHierarchyOperation(
    state,
    operation("reparent_object", {
      objectId: "global-child",
      parentObjectId: "missing-parent",
      baseRevision: 0,
    }),
    { userId: "editor-a" }, wideConfig, false,
  );
  assert.equal(missingParent.conflict, "missing_parent");
  assert.equal(state.revision, 0);

  const cycle = prepareHierarchyOperation(
    state,
    operation("reparent_object", {
      objectId: "global-root",
      parentObjectId: "global-child",
      baseRevision: 0,
    }),
    { userId: "editor-a" }, wideConfig, false,
  );
  assert.equal(cycle.conflict, "parent_cycle");
  assert.equal(state.revision, 0);

  const firstRename = operation("rename_object", {
    objectId: "global-child",
    name: "First Writer",
    operationId: "first-writer",
    requestId: "first-writer",
    baseRevision: 0,
  });
  const secondRename = operation("rename_object", {
    objectId: "global-child",
    name: "Second Writer",
    operationId: "second-writer",
    requestId: "second-writer",
    baseRevision: 0,
  });
  commitPrepared(state, prepareHierarchyOperation(state, firstRename, { userId: "editor-a" }, wideConfig, false));
  const staleSecond = prepareHierarchyOperation(state, secondRename, { userId: "editor-b" }, wideConfig, false);
  assert.equal(staleSecond.conflict, "stale_revision");
  assert.equal(state.revision, 1);
  assert.equal(state.hierarchyObjects.get(JSON.stringify(["scene-ops", "global-child"])).name, "First Writer");
});
