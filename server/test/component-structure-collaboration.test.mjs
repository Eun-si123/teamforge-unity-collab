import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { WebSocket } from "ws";
import { createTeamForgeServer } from "../src/teamforge-server.mjs";
import { componentSnapshotHash } from "../src/component-collaboration.mjs";
import { ChunkStore } from "../../project-peer/src/content-store.mjs";
import { temporaryRoot, publicationFixture, cleanup } from "../../project-peer/test/helpers.mjs";

const sceneId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const scenePath = "Assets/Scenes/Shared.unity";
const projectId = "m2-shared-colliders";
const projectUuid = "315b1ce0-5da1-4336-83ba-8ad070f38231";
const boxType = "UnityEngine.BoxCollider", sphereType = "UnityEngine.SphereCollider";
const gid = n => `GlobalObjectId_V1-2-${sceneId}-${n}-0`;
const components = [
  { objectId: gid(10), componentId: gid(20), typeName: boxType },
  { objectId: gid(11), componentId: gid(21), typeName: sphereType },
];
const properties = components.flatMap(identity => [
  { ...identity, propertyPath: "m_IsTrigger", valueKind: "boolean", value: false },
  { ...identity, propertyPath: "m_Center", valueKind: "vector3", value: { x: 0, y: 0, z: 0 } },
  identity.typeName === boxType
    ? { ...identity, propertyPath: "m_Size", valueKind: "vector3", value: { x: 1, y: 2, z: 3 } }
    : { ...identity, propertyPath: "m_Radius", valueKind: "float", value: 0.5 },
]);
const prefabFields = "  m_CorrespondingSourceObject: {fileID: 0}\n  m_PrefabInstance: {fileID: 0}\n  m_PrefabAsset: {fileID: 0}\n";
const sceneBytes = Buffer.from("%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n" +
  `--- !u!1 &10\nGameObject:\n${prefabFields}  m_Component:\n  - component: {fileID: 20}\n` +
  `--- !u!65 &20\nBoxCollider:\n${prefabFields}  m_GameObject: {fileID: 10}\n  m_IsTrigger: 0\n  m_Center: {x: 0, y: 0, z: 0}\n  m_Size: {x: 1, y: 2, z: 3}\n` +
  `--- !u!1 &11\nGameObject:\n${prefabFields}  m_Component:\n  - component: {fileID: 21}\n` +
  `--- !u!135 &21\nSphereCollider:\n${prefabFields}  m_GameObject: {fileID: 11}\n  m_IsTrigger: 0\n  m_Center: {x: 0, y: 0, z: 0}\n  m_Radius: 0.5\n`);
const metaBytes = Buffer.from(`fileFormatVersion: 2\nguid: ${sceneId}\nDefaultImporter:\n  externalObjects: {}\n`);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
let sequence = 0;
const envelope = (type, fields = {}) => ({ type, protocolVersion: 1, requestId: `m2-${++sequence}`, ...fields });

// Queue complete frames before waiting: a commit can arrive between the two
// peers' awaits, and reconnect deliberately discards an origin's ACK.
async function openClient(url) {
  const socket = new WebSocket(url);
  const queue = [], waiters = [];
  socket.on("message", data => {
    const value = JSON.parse(data.toString("utf8"));
    const index = waiters.findIndex(waiter => waiter.predicate(value));
    if (index < 0) queue.push(value);
    else {
      const [waiter] = waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(value);
    }
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket open timeout")), 3000);
    socket.once("open", () => { clearTimeout(timer); resolve(); });
    socket.once("error", error => { clearTimeout(timer); reject(error); });
  });
  const client = {
    socket,
    send: value => socket.send(JSON.stringify(value)),
    next(predicate = () => true) {
      const index = queue.findIndex(predicate);
      if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, timer: null };
        waiter.timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1);
          reject(new Error("Timed out waiting for M2 frame; queued: " + queue.map(value => value.type).join(", ")));
        }, 4000);
        waiters.push(waiter);
      });
    },
    request(value) {
      const result = client.next(reply => reply.requestId === value.requestId);
      client.send(value);
      return result;
    },
    async close() {
      if (socket.readyState === WebSocket.CLOSED) return;
      await new Promise(resolve => { socket.once("close", resolve); socket.terminate(); });
    },
  };
  return client;
}

const logical = n => "tf:c:" + n.toString(16).padStart(32, "0");
const signedExtraOwner = `--- !u!1 &12\nGameObject:\n${prefabFields}  m_Component:\n  - component: {fileID: 32}\n` +
  `--- !u!4 &32\nTransform:\n${prefabFields}  m_GameObject: {fileID: 12}\n`;
const emptyScene = Buffer.from("%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n" +
  `--- !u!1 &10\nGameObject:\n${prefabFields}  m_Component:\n  - component: {fileID: 30}\n` +
  `--- !u!4 &30\nTransform:\n${prefabFields}  m_GameObject: {fileID: 10}\n` + signedExtraOwner);

async function fixture(t, { empty = false, forgedOwner = false, prefabOwner = false, maximumBytes = 65536 } = {}) {
  const extraOwner = prefabOwner ? signedExtraOwner.replace("m_PrefabInstance: {fileID: 0}","m_PrefabInstance: {fileID: 999}") : signedExtraOwner;
  const storedSceneBytes = empty ? emptyScene : Buffer.concat([sceneBytes, Buffer.from(extraOwner)]);
  const seedComponents = empty ? [] : components;
  const seedProperties = empty ? [] : properties;
  const root = await temporaryRoot("teamforge-m2-wire-");
  const publication = await publicationFixture(root, {
    projectId, projectUuid, assetFiles: { [scenePath]: storedSceneBytes, [scenePath + ".meta"]: metaBytes },
  });
  const managedRoot = path.join(root, "managed");
  const metadataRoot = path.join(managedRoot,projectUuid,"metadata");
  await mkdir(metadataRoot,{recursive:true});
  await writeFile(path.join(metadataRoot,"project.json"),JSON.stringify({
    schemaVersion:1,productVersion:"0.5.1",projectId,projectUuid,createdAtUnixMs:Date.now(),
  }));
  const store = new ChunkStore(path.join(metadataRoot, "chunks"));
  for (const file of publication.manifest.files) {
    for (const chunk of file.chunks) await store.put(await publication.store.read(chunk.hash, chunk.size), chunk.hash);
  }
  for (const [directory, hash, value] of [
    ["manifests", publication.manifest.manifestHash, publication.manifest],
    ["descriptors", publication.descriptor.descriptorHash, publication.descriptor],
  ]) {
    await mkdir(path.join(metadataRoot, directory), { recursive: true });
    await writeFile(path.join(metadataRoot, directory, hash + ".json"), JSON.stringify(value));
  }
  // This is fixture storage, never a production approval bypass. The server
  // still validates its current Coordinator's signed manifest and every byte.
  await writeFile(path.join(metadataRoot,"published.json"), JSON.stringify({
    schemaVersion: 1, projectUuid, baselineRevision: 1,
    manifestHash: publication.manifest.manifestHash,
    descriptorHash: publication.descriptor.descriptorHash,
    ownerKeyId: publication.descriptor.ownerKeyId, approvedAtUnixMs: Date.now(),
  }));
  const server = createTeamForgeServer({
    host: "127.0.0.1", port: 0, enableComponentPropertySync: true,
    enableComponentStructureSync: true,
    componentProjectManagedRoot: managedRoot, maxRecentOperations: 4096,
    maxProjectPeersPerSession: 32, maxMessageBytes: maximumBytes,
    logger: { info() {}, warn() {}, error() {} },
  });
  const address = await server.start();
  const clients = [];
  t.after(async () => {
    await Promise.all(clients.map(client => client.close()));
    await server.stop();
    await cleanup(root);
  });
  const f = {
    server, publication, store,
    async connect(userId = "editor-a", capability = true, sessionId = "m2-wire-session") {
      const client = await openClient(`ws://127.0.0.1:${address.port}${address.wsPath}`);
      clients.push(client);
      client.userId = userId;
      client.ack = await client.request(envelope("hello", {
        projectId, sessionId, userId, userName: userId, userColor: "#AABBCC",
        supportsPresence: true, supportsTransformSync: true, supportsHierarchySync: true,
        supportsProjectTransfer: true, supportsComponentPropertySync: true,
        supportsComponentStructureSync: capability,
      }));
      assert.equal(client.ack.type, "hello_ack");
      return client;
    },
    async bootstrap(client) {
      const { descriptorSchemaVersion: _schema, projectId: _project, ...descriptor } = publication.descriptor;
      const published = await client.request(envelope("project_baseline_publish", { userId: client.userId, ...descriptor }));
      assert.equal(published.type, "project_baseline_changed");
      const seeded = await client.request(envelope("hierarchy_seed", {
        userId: client.userId, sceneId, baseRevision: 0,
        objects: [...new Set([gid(10), ...(empty ? [] : [gid(11)]), gid(12), ...(forgedOwner ? [gid(99)] : [])])].map((objectId, index) => ({
          objectId, name: "M2 owner " + index, parentObjectId: "", siblingIndex: index,
          localPosition: { x: 0, y: 0, z: 0 }, localRotation: { x: 0, y: 0, z: 0, w: 1 },
          localScale: { x: 1, y: 1, z: 1 },
        })),
      }));
      assert.equal(seeded.type, "hierarchy_seed_accepted");
      return seeded.serverRevision;
    },
    join(client, baseRevision = 0, overrides = {}) {
      return client.request(envelope("component_scene_join", {
        sceneId, scenePath, sceneFileSha256: sha(storedSceneBytes), sceneMetaSha256: sha(metaBytes),
        baseRevision, components: seedComponents, properties: seedProperties, ...overrides,
      }));
    },
    async lock(client, objectId = gid(10)) {
      const result = await client.request(envelope("lock_request", { userId: client.userId, sceneId, objectId }));
      assert.equal(result.type, "lock_granted", JSON.stringify(result));
      return result;
    },
    async release(client, objectId = gid(10)) {
      const result = await client.request(envelope("lock_release", { userId: client.userId, sceneId, objectId }));
      assert.equal(result.type, "lock_released");
    },
    structure(snapshot, overrides = {}) {
      return envelope("component_structure_set", {
        operationId: `structure-${++sequence}`, epoch: snapshot.epoch, sceneId,
        baseRevision: snapshot.serverRevision, kind: "add_component",
        objectId: gid(10), componentId: logical(sequence), typeName: boxType,
        expectedComponentRevision: 0, compensatesOperationId: "", ...overrides,
      });
    },
    set(snapshot, componentId, propertyPath, value, overrides = {}) {
      const target = snapshot.properties.find(row => row.componentId === componentId && row.propertyPath === propertyPath);
      assert.ok(target, "A property request must target the actual authoritative row.");
      return envelope("component_property_set", {
        operationId: `property-${++sequence}`, epoch: snapshot.epoch,
        sceneId, objectId: target.objectId, componentId, typeName: target.typeName,
        propertyPath, valueKind: target.valueKind, value,
        baseRevision: snapshot.serverRevision, expectedRevision: target.serverRevision,
        expectedValue: target.value, compensatesOperationId: "", ...overrides,
      });
    },
    snapshot(client, current, overrides = {}) {
      return client.request(envelope("component_snapshot_request", { sceneId, epoch: current.epoch, ...overrides }));
    },
  };
  return f;
}

function assertSnapshot(value, { type = "component_snapshot", count } = {}) {
  assert.equal(value.type, type, JSON.stringify(value));
  assert.equal(value.structureVersion, 1);
  assert.equal(value.sceneId, sceneId);
  assert.ok(Number.isSafeInteger(value.structureRevision));
  assert.ok(value.structureRevision <= value.serverRevision);
  assert.ok(Array.isArray(value.components));
  assert.ok(Array.isArray(value.tombstones));
  if (count !== undefined) assert.equal(value.components.length, count);
  assert.equal(value.properties.length, value.components.length * 3);
  const activeIds = new Set(value.components.map(row => row.componentId));
  assert.equal(activeIds.size, value.components.length);
  for (const row of value.properties) assert.ok(activeIds.has(row.componentId));
  for (const row of value.tombstones) assert.ok(!activeIds.has(row.componentId));
  assert.match(value.epoch, /^[a-f0-9-]{36}$/);
  assert.equal(value.snapshotHash, componentSnapshotHash(value));
}

function assertRejected(value, pattern = /./) {
  assert.equal(value.type, "component_property_rejected", JSON.stringify(value));
  assert.match(value.error, pattern);
}

function componentRevision(snapshot, componentId) {
  const component = snapshot.components.find(row => row.componentId === componentId);
  assert.ok(component, "Expected a live Component catalog identity.");
  return Math.max(component.serverRevision, ...snapshot.properties
    .filter(row => row.componentId === componentId).map(row => row.serverRevision));
}

function remove(f, snapshot, componentId, overrides = {}) {
  const component = snapshot.components.find(row => row.componentId === componentId);
  assert.ok(component);
  return f.structure(snapshot, {
    kind: "remove_component", objectId: component.objectId,
    componentId, typeName: component.typeName,
    expectedComponentRevision: componentRevision(snapshot, componentId), ...overrides,
  });
}

async function setup(t, options) {
  const f = await fixture(t, options);
  const a = await f.connect();
  assert.equal(a.ack.componentPropertySyncEnabled, true);
  assert.equal(a.ack.componentStructureSyncEnabled, true);
  await f.bootstrap(a);
  const initial = await f.join(a);
  assertSnapshot(initial, { count: options?.empty ? 0 : 2 });
  return { f, a, initial };
}

test("M2 real WebSocket adds duplicate Collider types, edits exact logical target, late joins and removes only that target after reconnect", async t => {
  const { f, a, initial } = await setup(t);
  const b = await f.connect("editor-b");
  await f.join(b);
  await f.lock(a);
  const firstRequest = f.structure(initial);
  const receivedFirst = b.next(value => value.type === "component_structure_applied" && value.operationId === firstRequest.operationId);
  const first = await a.request(firstRequest);
  assertSnapshot(first, { type: "component_structure_applied", count: 3 });
  assert.equal(first.serverRevision, initial.serverRevision + 1);
  assert.deepEqual((await receivedFirst).components, first.components);
  const firstRows = first.properties.filter(row => row.componentId === firstRequest.componentId);
  assert.deepEqual(firstRows.find(row => row.propertyPath === "m_Size").value, { x: 1, y: 1, z: 1 });
  assert.equal(firstRows.find(row => row.propertyPath === "m_IsTrigger").value, false);

  const secondRequest = f.structure(first);
  const second = await a.request(secondRequest);
  assertSnapshot(second, { type: "component_structure_applied", count: 4 });
  assert.equal(second.components.filter(row => row.objectId === gid(10) && row.typeName === boxType).length, 3);
  const edit = f.set(second, secondRequest.componentId, "m_Center", { x: 1.25, y: -2.5, z: 3 });
  const receivedEdit = b.next(value => value.type === "component_property_applied" && value.operationId === edit.operationId);
  const applied = await a.request(edit);
  assert.equal(applied.type, "component_property_applied", JSON.stringify(applied));
  assert.deepEqual((await receivedEdit).value, { x: 1.25, y: -2.5, z: 3 });
  const current = await f.snapshot(a, initial);
  assertSnapshot(current, { count: 4 });
  assert.deepEqual(current.properties.find(row => row.componentId === firstRequest.componentId && row.propertyPath === "m_Center").value,
    { x: 0, y: 0, z: 0 }, "A same-type sibling must retain its distinct value.");

  const c = await f.connect("editor-c");
  assert.equal(c.ack.componentStructureSceneId, sceneId);
  const late = await f.join(c, current.serverRevision, { components: [], properties: [] });
  assertSnapshot(late, { count: 4 });
  assert.deepEqual(late.components, current.components);
  assert.deepEqual(late.properties, current.properties);
  const deletion = remove(f, current, firstRequest.componentId);
  const observedDeletion = b.next(value => value.type === "component_structure_applied" && value.operationId === deletion.operationId);
  a.send(deletion);
  const removed = await observedDeletion;
  assertSnapshot(removed, { type: "component_structure_applied", count: 3 });
  await a.close(); // Origin ACK is lost; the server already committed once.
  const back = await f.connect("editor-a");
  const restored = await f.join(back, removed.serverRevision, { components: [], properties: [] });
  assertSnapshot(restored, { count: 3 });
  assert.equal(restored.epoch, initial.epoch);
  assert.ok(!restored.components.some(row => row.componentId === firstRequest.componentId));
  assert.ok(restored.components.some(row => row.componentId === secondRequest.componentId));
  assert.deepEqual(restored.properties.find(row => row.componentId === secondRequest.componentId && row.propertyPath === "m_Center").value,
    { x: 1.25, y: -2.5, z: 3 });
  const replay = await back.request({ ...deletion, requestId: `m2-retry-${++sequence}` });
  assert.equal(replay.type, "component_structure_applied", JSON.stringify(replay));
  assert.equal(replay.replayed, true);
  assert.equal(replay.serverRevision, removed.serverRevision);
  const afterReplay = await f.snapshot(back, restored);
  assert.equal(afterReplay.serverRevision, removed.serverRevision);
  assert.deepEqual(afterReplay.components, restored.components);
});

test("M2 replay is idempotent, operation IDs conflict, tombstones block ordinary reuse, and own structural compensation restores exact values", async t => {
  const { f, a, initial } = await setup(t);
  await f.lock(a);
  const add = f.structure(initial, { typeName: sphereType });
  const first = await a.request(add);
  assertSnapshot(first, { type: "component_structure_applied", count: 3 });
  assert.equal(first.properties.find(row => row.componentId === add.componentId && row.propertyPath === "m_Radius").value, 0.5);
  const replay = await a.request({ ...add, requestId: `m2-dup-${++sequence}` });
  assert.equal(replay.type, "component_structure_applied", JSON.stringify(replay));
  assert.equal(replay.replayed, true);
  assert.equal(replay.serverRevision, first.serverRevision);
  assertRejected(await a.request({ ...add, requestId: `m2-conflict-${++sequence}`, typeName: boxType }), /operation.*conflict|replay/);
  const deletion = remove(f, first, add.componentId, { compensatesOperationId: add.operationId });
  const deleted = await a.request(deletion);
  assertSnapshot(deleted, { type: "component_structure_applied", count: 2 });
  const tombstone = deleted.tombstones.find(row => row.componentId === add.componentId);
  assert.ok(tombstone);
  assert.equal(tombstone.serverRevision, deleted.serverRevision);
  assertRejected(await a.request(f.structure(deleted, { componentId: add.componentId, typeName: sphereType })), /reuse|collision|tombstone|identity/);
  const redo = f.structure(deleted, {
    componentId: add.componentId, typeName: sphereType,
    expectedComponentRevision: tombstone.serverRevision,
    compensatesOperationId: deletion.operationId,
  });
  const redone = await a.request(redo);
  assertSnapshot(redone, { type: "component_structure_applied", count: 3 });
  assert.ok(!redone.tombstones.some(row => row.componentId === add.componentId));

  const edited = await a.request(f.set(redone, add.componentId, "m_Radius", 3.25));
  assert.equal(edited.type, "component_property_applied", JSON.stringify(edited));
  const current = await f.snapshot(a, redone);
  const ordinaryRemoval = remove(f, current, add.componentId);
  const removed = await a.request(ordinaryRemoval);
  const restored = await a.request(f.structure(removed, {
    componentId: add.componentId, typeName: sphereType,
    expectedComponentRevision: removed.serverRevision,
    compensatesOperationId: ordinaryRemoval.operationId,
  }));
  assertSnapshot(restored, { type: "component_structure_applied", count: 3 });
  assert.equal(restored.properties.find(row => row.componentId === add.componentId && row.propertyPath === "m_Radius").value, 3.25,
    "Undo of removal must restore the removed Component's exact committed values, not constructor defaults.");
  const digestWithForgedCatalog = componentSnapshotHash({ ...restored,
    components: restored.components.map(row => row.componentId === add.componentId ? { ...row, objectId: gid(12) } : row) });
  assert.notEqual(digestWithForgedCatalog, restored.snapshotHash,
    "The structural digest must bind the identity catalog, not just property values.");
  const removedAgain = await a.request(remove(f, restored, add.componentId));
  assert.notEqual(componentSnapshotHash({ ...removedAgain, tombstones: [] }), removedAgain.snapshotHash,
    "Removing deletion metadata must change the recovery digest even though active properties are unchanged.");
});

test("M2 stale epoch, stale target version and foreign lock refuse without revision changes or unsafe compensation", async t => {
  const { f, a, initial } = await setup(t);
  const b = await f.connect("editor-b");
  await f.join(b);
  await f.lock(a);
  assertRejected(await b.request(f.structure(initial)), /lock/);
  assertRejected(await a.request(f.structure(initial, { epoch: "00000000-0000-4000-8000-000000000001" })), /epoch/);
  assertRejected(await a.request(f.structure(initial, { baseRevision: 999 })), /revision/);
  assert.equal((await f.snapshot(a, initial)).serverRevision, initial.serverRevision);
  const add = f.structure(initial);
  const created = await a.request(add);
  const changed = await a.request(f.set(created, add.componentId, "m_IsTrigger", true));
  assert.equal(changed.type, "component_property_applied");
  const current = await f.snapshot(a, initial);
  assertRejected(await a.request(remove(f, current, add.componentId, {
    expectedComponentRevision: created.serverRevision,
  })), /version|revision|conflict/);
  assertRejected(await a.request(remove(f, current, add.componentId, {
    compensatesOperationId: add.operationId,
  })), /compensat|undo|changed|conflict/);
  const after = await f.snapshot(a, initial);
  assert.equal(after.serverRevision, changed.serverRevision);
  assert.ok(after.components.some(row => row.componentId === add.componentId));
  assert.equal(after.properties.find(row => row.componentId === add.componentId && row.propertyPath === "m_IsTrigger").value, true);
});

test("M2 property-only peers cannot join, acquire locks, transform or edit Hierarchy in a structure Scene", async t => {
  const { f, a, initial } = await setup(t);
  const legacy = await f.connect("property-only", false);
  assert.equal(legacy.ack.componentStructureSyncEnabled, false);
  assertRejected(await f.join(legacy), /structure|capab|negotiat/);
  assertRejected(await legacy.request(f.structure(initial)), /structure|capab|negotiat|join/);
  const lock = await legacy.request(envelope("lock_request", { userId: legacy.userId, sceneId, objectId: gid(10) }));
  assert.equal(lock.type, "error", JSON.stringify(lock));
  assert.match(lock.code, /component|structure|capab/);
  const transform = await legacy.request(envelope("transform_update", {
    userId: legacy.userId, sceneId, objectId: gid(10), operationId: `legacy-transform-${++sequence}`,
    baseRevision: initial.serverRevision, localPosition: { x: 2, y: 0, z: 0 },
    localRotation: { x: 0, y: 0, z: 0, w: 1 }, localScale: { x: 1, y: 1, z: 1 },
  }));
  assert.equal(transform.type, "error", JSON.stringify(transform));
  assert.match(transform.code, /component|structure|capab/);
  const hierarchy = await legacy.request(envelope("hierarchy_operation", {
    userId: legacy.userId, sceneId, objectId: gid(10), operationId: `legacy-rename-${++sequence}`,
    kind: "rename_object", baseRevision: initial.serverRevision, name: "Unauthorized M2 rename",
  }));
  assert.equal(hierarchy.type, "error", JSON.stringify(hierarchy));
  assert.match(hierarchy.code, /component|structure|capab/);
  assert.equal((await f.snapshot(a, initial)).serverRevision, initial.serverRevision);
});

test("M2 signed owners allow first Collider on an empty owner but reject forged saved Hierarchy owners", async t => {
  const { f, a, initial } = await setup(t, { forgedOwner: true });
  await f.lock(a, gid(99));
  const forged = await a.request(f.structure(initial, { objectId: gid(99) }));
  assertRejected(forged, /owner|signed|source/);
  assert.equal((await f.snapshot(a, initial)).serverRevision, initial.serverRevision);
  await f.release(a, gid(99));
  await f.lock(a, gid(12));
  const firstOnOwner = await a.request(f.structure(initial, { objectId: gid(12), typeName: sphereType }));
  assertSnapshot(firstOnOwner, { type: "component_structure_applied", count: 3 });
  assert.equal(firstOnOwner.components.find(row => row.componentId === firstOnOwner.componentId).objectId, gid(12));
});

test("M2 removing the last Collider retains an empty runtime catalog across all-peer disconnect and permits re-add", async t => {
  const { f, a, initial } = await setup(t);
  let current = initial;
  for (const component of [...initial.components]) {
    await f.lock(a, component.objectId);
    current = await a.request(remove(f, current, component.componentId));
    assert.equal(current.type, "component_structure_applied", JSON.stringify(current));
    await f.release(a, component.objectId);
  }
  assertSnapshot(current, { type: "component_structure_applied", count: 0 });
  assert.equal(current.properties.length, 0);
  assert.equal(current.tombstones.length, 2);
  await a.close();
  const back = await f.connect("editor-a");
  const empty = await f.join(back, current.serverRevision, { components: [], properties: [] });
  assertSnapshot(empty, { count: 0 });
  assert.equal(empty.epoch, initial.epoch);
  assert.equal(empty.snapshotHash, current.snapshotHash);
  await f.lock(back);
  const added = await back.request(f.structure(empty, { typeName: sphereType }));
  assertSnapshot(added, { type: "component_structure_applied", count: 1 });
  assert.equal(added.tombstones.length, 2);
});

test("M2 verifies a signed initially empty Collider catalog before the first structural add", async t => {
  const { f, a, initial } = await setup(t, { empty: true });
  assert.equal(initial.properties.length, 0);
  await f.lock(a);
  const first = await a.request(f.structure(initial));
  assertSnapshot(first, { type: "component_structure_applied", count: 1 });
  assert.equal(first.components[0].componentId, first.componentId);
});


test("M2 reserves the full structural/replay envelope before publishing any oversized snapshot", async t=>{
  const maximumBytes=12500;
  const {f,a,initial}=await setup(t,{maximumBytes});
  await f.lock(a);
  let current=initial,refused=false;
  for(let index=0;index<30;index++) {
    const response=await a.request(f.structure(current));
    if(response.type==="component_property_rejected") {
      assert.match(response.error,/snapshot_size_limit/);
      const after=await f.snapshot(a,current);
      assert.equal(after.serverRevision,current.serverRevision);
      assert.deepEqual(after.components,current.components);
      assert.deepEqual(after.properties,current.properties);
      assert.deepEqual(after.tombstones,current.tombstones);
      refused=true;break;
    }
    assertSnapshot(response,{type:"component_structure_applied"});
    assert.ok(Buffer.byteLength(JSON.stringify(response))<=maximumBytes);
    current=response;
  }
  assert.equal(refused,true,"A bounded message budget must refuse before mutating the catalog.");
});


test("M2 signed Prefab-associated owner documents cannot establish structural authority",async t=>{
  const f=await fixture(t,{prefabOwner:true});
  const a=await f.connect();await f.bootstrap(a);
  assertRejected(await f.join(a),/serialized_collider_values_mismatch/);
  const another=await f.connect("editor-b");
  assert.equal(another.ack.componentStructureSceneId,"");
  const refused=await a.request(f.structure({epoch:"11111111-1111-4111-8111-111111111111",serverRevision:0},
    {objectId:gid(12)}));
  assertRejected(refused,/epoch_mismatch|join_required/);
});

test("M2 malformed structural wire shapes and unsupported types preserve the complete current snapshot",async t=>{
  const {f,a,initial}=await setup(t);await f.lock(a);
  const variants=[{extra:true},{expectedComponentRevision:-1},{baseRevision:0.5},
    {typeName:"UnityEngine.Transform"},{kind:"destroy_arbitrary"},{componentId:gid(900)}];
  for(const variant of variants) {
    assertRejected(await a.request(f.structure(initial,variant)),/invalid|identity_reused/);
    const after=await f.snapshot(a,initial);
    assert.equal(after.serverRevision,initial.serverRevision);
    assert.equal(after.snapshotHash,initial.snapshotHash);
    assert.deepEqual(after.components,initial.components);
    assert.deepEqual(after.properties,initial.properties);
    assert.deepEqual(after.tombstones,initial.tombstones);
  }
});
