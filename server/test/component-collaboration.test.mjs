import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { WebSocket } from "ws";
import { createTeamForgeServer } from "../src/teamforge-server.mjs";
import { createDescriptor } from "../../project-peer/src/descriptor.mjs";
import { buildManifest } from "../../project-peer/src/manifest.mjs";
import { ProjectCoordinatorCore } from "../src/project-coordinator-core.mjs";
import { ChunkStore } from "../../project-peer/src/content-store.mjs";
import { temporaryRoot, publicationFixture, cleanup } from "../../project-peer/test/helpers.mjs";

const sceneId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const scenePath = "Assets/Scenes/Shared.unity";
const projectId = "m1-shared-colliders";
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
const envelope = (type, fields = {}) => ({ type, protocolVersion: 1, requestId: `m1-${++sequence}`, ...fields });

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
          reject(new Error("Timed out waiting for M1 frame; queued: " + queue.map(value => value.type).join(", ")));
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

async function fixture(t, { enabled = true, maximumOperations = 4096, maximumProjectPeers = 32 } = {}) {
  const root = await temporaryRoot("teamforge-m1-wire-");
  const publication = await publicationFixture(root, {
    projectId, projectUuid, assetFiles: { [scenePath]: sceneBytes, [scenePath + ".meta"]: metaBytes },
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
    host: "127.0.0.1", port: 0, enableComponentPropertySync: enabled,
    componentProjectManagedRoot: managedRoot, maxRecentOperations: maximumOperations,
    maxProjectPeersPerSession: maximumProjectPeers,
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
    async connect(userId = "editor-a", capability = true, sessionId = "m1-wire-session") {
      const client = await openClient(`ws://127.0.0.1:${address.port}${address.wsPath}`);
      clients.push(client);
      client.userId = userId;
      client.ack = await client.request(envelope("hello", {
        projectId, sessionId, userId, userName: userId, userColor: "#AABBCC",
        supportsPresence: true, supportsTransformSync: true, supportsHierarchySync: true,
        supportsProjectTransfer: true, supportsComponentPropertySync: capability,
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
        objects: components.map((row, index) => ({
          objectId: row.objectId, name: index ? "Sphere" : "Box", parentObjectId: "", siblingIndex: index,
          localPosition: { x: 0, y: 0, z: 0 }, localRotation: { x: 0, y: 0, z: 0, w: 1 },
          localScale: { x: 1, y: 1, z: 1 },
        })),
      }));
      assert.equal(seeded.type, "hierarchy_seed_accepted");
      return seeded.serverRevision;
    },
    join(client, baseRevision = 0, overrides = {}) {
      return client.request(envelope("component_scene_join", {
        sceneId, scenePath, sceneFileSha256: sha(sceneBytes), sceneMetaSha256: sha(metaBytes),
        baseRevision, components, properties, ...overrides,
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
    set(snapshot, overrides = {}) {
      const target = snapshot.properties.find(row => row.componentId === gid(20) && row.propertyPath === "m_IsTrigger");
      return envelope("component_property_set", {
        operationId: `operation-${++sequence}`, epoch: snapshot.epoch,
        sceneId, objectId: gid(10), componentId: gid(20), typeName: boxType,
        propertyPath: "m_IsTrigger", valueKind: "boolean", value: !target.value,
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

function assertSnapshot(value) {
  assert.equal(value.type, "component_snapshot", JSON.stringify(value));
  assert.equal(value.sceneId, sceneId);
  assert.equal(value.properties.length, 6);
  assert.match(value.epoch, /^[a-f0-9-]{36}$/);
  assert.match(value.snapshotHash, /^[a-f0-9]{64}$/);
}
function assertRejected(value, pattern = /./) {
  assert.equal(value.type, "component_property_rejected", JSON.stringify(value));
  assert.match(value.error, pattern);
}

test("M1 real WebSocket repeats unsaved Box/Sphere edits, shares revisions and reports Editor application separately", async t => {
  const f = await fixture(t);
  const a = await f.connect();
  assert.equal(a.ack.componentPropertySyncEnabled, true);
  assert.equal(a.ack.componentStructureSyncEnabled, false);
  await f.bootstrap(a);
  const first = await f.join(a);
  assertSnapshot(first);
  const b = await f.connect("editor-b");
  const joinedB = await f.join(b);
  assertSnapshot(joinedB);
  assert.equal(joinedB.snapshotHash, first.snapshotHash);
  await f.lock(a);
  const edit = f.set(first);
  const broadcast = b.next(value => value.type === "component_property_applied" && value.operationId === edit.operationId);
  const applied = await a.request(edit);
  assert.equal(applied.type, "component_property_applied", JSON.stringify(applied));
  assert.equal(applied.serverRevision, first.serverRevision + 1);
  assert.equal(applied.previousValue, false);
  assert.equal((await broadcast).value, true);
  const snapshot = await f.snapshot(b, joinedB);
  assertSnapshot(snapshot);
  assert.equal(snapshot.properties.find(row => row.propertyPath === "m_IsTrigger" && row.componentId === gid(20)).value, true);
  assert.equal(snapshot.serverRevision, applied.serverRevision);

  const report = await b.request(envelope("component_apply_report", {
    sceneId, epoch: snapshot.epoch, serverRevision: snapshot.serverRevision,
    snapshotHash: snapshot.snapshotHash, status: "applied",
  }));
  assert.equal(report.type, "component_apply_report_ack");
  assert.equal(report.status, "editor_report_recorded");
  assert.equal(report.editorStatus, "applied");
  assert.equal(report.diskSaved, false);
  const forgedReport = await b.request(envelope("component_apply_report", {
    sceneId, epoch: snapshot.epoch, serverRevision: snapshot.serverRevision,
    snapshotHash: "f".repeat(64), status: "applied",
  }));
  assertRejected(forgedReport, /report|snapshot|hash/);

  // A Transform update advances the SAME Session revision without invalidating
  // the already admitted runtime Collider ledger or requiring a Scene save.
  const transformed = await a.request(envelope("transform_update", {
    userId: a.userId, sceneId, objectId: gid(10), operationId: `transform-${++sequence}`,
    baseRevision: snapshot.serverRevision, localPosition: { x: 5, y: 0, z: 0 },
    localRotation: { x: 0, y: 0, z: 0, w: 1 }, localScale: { x: 1, y: 1, z: 1 },
  }));
  assert.equal(transformed.type, "transform_applied", JSON.stringify(transformed));
  const afterTransform = await f.snapshot(a, snapshot);
  assertSnapshot(afterTransform);
  assert.equal(afterTransform.serverRevision, transformed.serverRevision);
  const second = await a.request(f.set(afterTransform, {
    propertyPath: "m_Center", valueKind: "vector3", value: { x: 1.25, y: -2.5, z: 3 },
    expectedRevision: first.serverRevision, expectedValue: { x: 0, y: 0, z: 0 },
  }));
  assert.equal(second.type, "component_property_applied", JSON.stringify(second));
  assert.equal(second.serverRevision, transformed.serverRevision + 1);
  await f.release(a);
  await f.lock(b, gid(11));
  const sphereState = await f.snapshot(b, joinedB);
  const sphere = await b.request(f.set(sphereState, {
    objectId: gid(11), componentId: gid(21), typeName: sphereType,
    propertyPath: "m_Radius", valueKind: "float", value: 2.75,
    expectedRevision: first.serverRevision, expectedValue: 0.5,
  }));
  assert.equal(sphere.type, "component_property_applied", JSON.stringify(sphere));
  const finalA = await f.snapshot(a, first), finalB = await f.snapshot(b, first);
  assert.deepEqual(finalA.properties, finalB.properties);
  assert.equal(finalA.snapshotHash, finalB.snapshotHash);
});

test("M1 rejects stale epoch, revision and foreign lock; conditional Undo cannot overwrite a newer peer edit", async t => {
  const f = await fixture(t);
  const a = await f.connect();
  await f.bootstrap(a);
  const initial = await f.join(a);
  assertSnapshot(initial);
  const b = await f.connect("editor-b");
  await f.join(b);
  await f.lock(a);
  assertRejected(await b.request(f.set(initial)), /lock/);
  assertRejected(await a.request(f.set(initial, { epoch: "00000000-0000-0000-0000-000000000001" })), /epoch/);
  assertRejected(await a.request(f.set(initial, { baseRevision: 999 })), /revision/);
  const original = f.set(initial);
  const applied = await a.request(original);
  assert.equal(applied.type, "component_property_applied");
  assertRejected(await a.request(f.set(initial)), /revision/);
  let current = await f.snapshot(a, initial);
  const undo = await a.request(f.set(current, { value: false, compensatesOperationId: original.operationId }));
  assert.equal(undo.type, "component_property_applied", JSON.stringify(undo));
  assert.equal(undo.value, false);
  current = await f.snapshot(a, initial);
  const ownAgain = f.set(current);
  assert.equal((await a.request(ownAgain)).type, "component_property_applied");
  await f.release(a);
  await f.lock(b);
  current = await f.snapshot(b, initial);
  assertRejected(await b.request(f.set(current, { value: false, compensatesOperationId: ownAgain.operationId })), /undo|compensat|owner/);
  const peerEdit = await b.request(f.set(current, { value: false }));
  assert.equal(peerEdit.type, "component_property_applied");
  await f.release(b);
  await f.lock(a);
  const staleUndo = f.set({ ...current, serverRevision: peerEdit.serverRevision }, {
    value: false, expectedValue: true, expectedRevision: peerEdit.serverRevision - 1,
    compensatesOperationId: ownAgain.operationId,
  });
  assertRejected(await a.request(staleUndo), /condition|conflict|revision|undo|compensat/);
  const after = await f.snapshot(a, initial);
  assert.equal(after.serverRevision, peerEdit.serverRevision);
  assert.equal(after.properties.find(row => row.componentId === gid(20) && row.propertyPath === "m_IsTrigger").value, false);
});

test("M1 duplicate and lost-ACK reconnect preserve one commit; late peers get dirty runtime values", async t => {
  const f = await fixture(t);
  const a = await f.connect();
  await f.bootstrap(a);
  const initial = await f.join(a);
  assertSnapshot(initial);
  const witness = await f.connect("editor-b");
  await f.join(witness);
  await f.lock(a);
  const edit = f.set(initial);
  const observed = witness.next(value => value.type === "component_property_applied" && value.operationId === edit.operationId);
  a.send(edit);
  const committed = await observed;
  await a.close(); // Discard the origin ACK. The server's commit is authoritative.
  const reconnected = await f.connect("editor-a");
  const recovered = await f.join(reconnected, committed.serverRevision);
  assertSnapshot(recovered);
  assert.equal(recovered.epoch, initial.epoch);
  assert.equal(recovered.serverRevision, committed.serverRevision);
  assert.equal(recovered.properties.find(row => row.componentId === gid(20) && row.propertyPath === "m_IsTrigger").value, true);
  const replay = await reconnected.request({ ...edit, requestId: `retry-${++sequence}` });
  assert.equal(replay.type, "component_property_applied", JSON.stringify(replay));
  assert.equal(replay.serverRevision, committed.serverRevision);
  assertRejected(await reconnected.request({ ...edit, requestId: `collision-${++sequence}`, value: false }), /operation_id_conflict/);
  const late = await f.connect("editor-c");
  const lateState = await f.join(late, committed.serverRevision);
  assertSnapshot(lateState);
  assert.deepEqual(lateState.properties, recovered.properties);
  assert.equal(lateState.snapshotHash, recovered.snapshotHash);
  await witness.close();
  await reconnected.close();
  await late.close();
  const allBack = await f.connect("editor-a");
  const afterAllDisconnected = await f.join(allBack, committed.serverRevision);
  assertSnapshot(afterAllDisconnected);
  assert.equal(afterAllDisconnected.epoch, initial.epoch);
  assert.equal(afterAllDisconnected.serverRevision, committed.serverRevision);
});

test("M1 signed source mismatch and legacy capability never acquire edit authority", async t => {
  const f = await fixture(t);
  const a = await f.connect();
  await f.bootstrap(a);
  assertRejected(await f.join(a, 0, { sceneFileSha256: "f".repeat(64) }), /source|hash/);
  const tampered = properties.map(row => row.componentId === gid(20) && row.propertyPath === "m_IsTrigger" ? { ...row, value: true } : row);
  assertRejected(await f.join(a, 0, { properties: tampered }), /source|serialized|collider|value/);
  const initial = await f.join(a);
  assertSnapshot(initial);
  const legacy = await f.connect("legacy-editor", false);
  assert.notEqual(legacy.ack.componentPropertySyncEnabled, true);
  assertRejected(await f.join(legacy), /capab|negotiat|unsupported/);
  const locked = await legacy.request(envelope("lock_request", { userId: legacy.userId, sceneId, objectId: gid(10) }));
  assert.equal(locked.type, "error", JSON.stringify(locked));
  assert.match(locked.code, /component|capab/);
  const transformed = await legacy.request(envelope("transform_update", {
    userId: legacy.userId, sceneId, objectId: gid(10), operationId: "legacy-transform", baseRevision: 0,
    localPosition: { x: 9, y: 0, z: 0 }, localRotation: { x: 0, y: 0, z: 0, w: 1 }, localScale: { x: 1, y: 1, z: 1 },
  }));
  assert.equal(transformed.type, "error", JSON.stringify(transformed));
  assert.match(transformed.code, /component|capab/);
  const renamed = await legacy.request(envelope("hierarchy_operation", {
    userId: legacy.userId, sceneId, objectId: gid(10), operationId: "legacy-rename",
    kind: "rename_object", baseRevision: initial.serverRevision, name: "Legacy rename",
  }));
  assert.equal(renamed.type, "error", JSON.stringify(renamed));
  assert.match(renamed.code, /component|capab/);
  const after = await f.snapshot(a, initial);
  assert.equal(after.serverRevision, initial.serverRevision);
});

test("M1 refuses altered signed Scene chunks before first admission", async t => {
  const f = await fixture(t);
  const a = await f.connect();
  await f.bootstrap(a);
  const scene = f.publication.manifest.files.find(file => file.path === scenePath);
  const chunk = scene.chunks[0];
  const corrupted = Buffer.from(await f.store.read(chunk.hash, chunk.size));
  corrupted[0] ^= 1;
  await writeFile(f.store.pathForHash(chunk.hash), corrupted);
  const result = await f.join(a);
  assertRejected(result, /source|hash|chunk/);
});

test("M1 replay after another peer changes the property never reapplies the old value", async t => {
  const f = await fixture(t);
  const a = await f.connect();
  await f.bootstrap(a);
  const initial = await f.join(a);
  assertSnapshot(initial);
  const b = await f.connect("editor-b");
  await f.join(b);
  await f.lock(a);
  const original = f.set(initial);
  const first = await a.request(original);
  assert.equal(first.type, "component_property_applied");
  await f.release(a);
  await f.lock(b);
  const current = await f.snapshot(b, initial);
  const newer = await b.request(f.set(current));
  assert.equal(newer.type, "component_property_applied");
  const replay = await a.request({ ...original, requestId: `late-retry-${++sequence}` });
  assert.equal(replay.type, "component_property_applied");
  assert.equal(replay.serverRevision, first.serverRevision);
  const after = await f.snapshot(a, initial);
  assert.equal(after.serverRevision, newer.serverRevision);
  assert.equal(after.properties.find(row => row.componentId === gid(20) && row.propertyPath === "m_IsTrigger").value, false);
});

test("M1 conditional Undo preserves unrelated peer edits; malformed numeric and target data cannot mutate", async t => {
  const f = await fixture(t);
  const a = await f.connect();
  await f.bootstrap(a);
  const initial = await f.join(a);
  assertSnapshot(initial);
  const b = await f.connect("editor-b");
  await f.join(b);
  await f.lock(a);
  const original = f.set(initial);
  assert.equal((await a.request(original)).type, "component_property_applied");
  await f.lock(b, gid(11));
  const current = await f.snapshot(b, initial);
  const radiusEdit = await b.request(f.set(current, {
    objectId: gid(11), componentId: gid(21), typeName: sphereType,
    propertyPath: "m_Radius", valueKind: "float", value: 3.5,
    expectedRevision: initial.serverRevision, expectedValue: 0.5,
  }));
  assert.equal(radiusEdit.type, "component_property_applied");
  const beforeUndo = await f.snapshot(a, initial);
  const undo = await a.request(f.set(beforeUndo, { value: false, compensatesOperationId: original.operationId }));
  assert.equal(undo.type, "component_property_applied", JSON.stringify(undo));
  const afterUndo = await f.snapshot(a, initial);
  assert.equal(afterUndo.properties.find(row => row.componentId === gid(21) && row.propertyPath === "m_Radius").value, 3.5);
  for (const invalid of [
    { propertyPath: "m_Size", valueKind: "vector3", value: null, expectedRevision: 0, expectedValue: { x: 1, y: 2, z: 3 } },
    { propertyPath: "m_Size", valueKind: "vector3", value: { x: -1, y: 1, z: 1 }, expectedRevision: 0, expectedValue: { x: 1, y: 2, z: 3 } },
    { propertyPath: "m_Center", valueKind: "vector3", value: { x: 1, y: 2, z: 3, w: 4 }, expectedRevision: 0, expectedValue: { x: 0, y: 0, z: 0 } },
    { propertyPath: "m_Center", valueKind: "vector3", value: { x: 101, y: 0, z: 0 }, expectedRevision: 0, expectedValue: { x: 0, y: 0, z: 0 } },
    { componentId: gid(999) },
    { propertyPath: "m_Script" },
  ]) assertRejected(await a.request(f.set(afterUndo, invalid)));
  const finalState = await f.snapshot(a, initial);
  assert.equal(finalState.serverRevision, undo.serverRevision);
  assert.deepEqual(finalState.properties, afterUndo.properties);
});

test("M1 Unity float32 values survive differently formatted numeric before-images and replay", async t => {
  const f = await fixture(t);
  const a = await f.connect();
  await f.bootstrap(a);
  const initial = await f.join(a);
  assertSnapshot(initial);
  await f.lock(a);
  const firstEdit = f.set(initial, {
    propertyPath: "m_Center", valueKind: "vector3", value: { x: 0.1, y: -0.2, z: 0.3 },
    expectedValue: { x: 0, y: 0, z: 0 }, expectedRevision: 0,
  });
  const first = await a.request(firstEdit);
  assert.equal(first.type, "component_property_applied", JSON.stringify(first));
  assert.deepEqual(first.value, { x: Math.fround(0.1), y: Math.fround(-0.2), z: Math.fround(0.3) });
  const snapshot = await f.snapshot(a, initial);
  const next = await a.request(f.set(snapshot, {
    propertyPath: "m_Center", valueKind: "vector3", value: { x: 0.4, y: 0.5, z: -0.6 },
    // JsonUtility can emit a short decimal for the same single-precision value.
    expectedValue: { x: 0.1, y: -0.2, z: 0.3 }, expectedRevision: first.serverRevision,
  }));
  assert.equal(next.type, "component_property_applied", JSON.stringify(next));
  const replay = await a.request({
    ...firstEdit, requestId: `float-retry-${++sequence}`,
    value: { x: Math.fround(0.1), y: Math.fround(-0.2), z: Math.fround(0.3) },
  });
  assert.equal(replay.type, "component_property_applied", JSON.stringify(replay));
  assert.equal(replay.serverRevision, first.serverRevision);
  const after = await f.snapshot(a, initial);
  assert.equal(after.serverRevision, next.serverRevision);
  assert.deepEqual(after.properties.find(row => row.componentId === gid(20) && row.propertyPath === "m_Center").value,
    { x: Math.fround(0.4), y: Math.fround(0.5), z: Math.fround(-0.6) });
});

test("M1 refuses a signed admission when shared authority changes during actual chunk reads", async t => {
  const f = await fixture(t);
  const a = await f.connect();
  await f.bootstrap(a);
  await f.lock(a);
  const scene = f.publication.manifest.files.find(file => file.path === scenePath);
  const originalRead = ChunkStore.prototype.read;
  let entered, release, intercepted = false;
  const reading = new Promise(resolve => { entered = resolve; });
  const resume = new Promise(resolve => { release = resolve; });
  let timer;
  ChunkStore.prototype.read = async function(hash, size) {
    if (!intercepted && this.root === f.store.root && hash === scene.chunks[0].hash) {
      intercepted = true;
      entered();
      await resume;
    }
    return originalRead.call(this, hash, size);
  };
  try {
    const pending = f.join(a);
    await Promise.race([reading, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Admission did not reach the real Scene chunk read")), 3000);
    })]);
    clearTimeout(timer);
    const transformed = await a.request(envelope("transform_update", {
      userId: a.userId, sceneId, objectId: gid(10), operationId: "during-source-read", baseRevision: 0,
      localPosition: { x: 8, y: 0, z: 0 }, localRotation: { x: 0, y: 0, z: 0, w: 1 }, localScale: { x: 1, y: 1, z: 1 },
    }));
    assert.equal(transformed.type, "transform_applied");
    release();
    const refused = await pending;
    assertRejected(refused, /changed|stale|revision/);
    const admitted = await f.join(a, transformed.serverRevision);
    assertSnapshot(admitted);
    assert.equal(admitted.serverRevision, transformed.serverRevision);
    assert.equal(admitted.properties.find(row => row.componentId === gid(20) && row.propertyPath === "m_IsTrigger").value, false);
  } finally {
    clearTimeout(timer);
    release();
    ChunkStore.prototype.read = originalRead;
  }
});

// Node peer tests prove the real server protocol, never native Unity Editor
// writes, Undo history behavior, saved Scene reopening or two-PC operation.


test("M1 runtime save/reopen rejoins changed saved bytes without granting changed Component identity", async t => {
  const f = await fixture(t);
  const a = await f.connect(); await f.bootstrap(a);
  const initial = await f.join(a); assertSnapshot(initial); await f.lock(a);
  const accepted = await a.request(f.set(initial));
  const runtime = await f.snapshot(a,initial);
  assert.equal(accepted.type,"component_property_applied");
  await a.close();
  const back = await f.connect();
  const changedProperties = runtime.properties.map(({objectId,componentId,typeName,propertyPath,valueKind,value})=>
    ({objectId,componentId,typeName,propertyPath,valueKind,value}));
  const reopened = await f.join(back,runtime.serverRevision,{
    sceneFileSha256:"f".repeat(64),properties:changedProperties,
  });
  assertSnapshot(reopened); assert.equal(reopened.epoch,initial.epoch);
  assert.deepEqual(reopened.properties,runtime.properties);
  const wrong = components.map((row,index)=>index ? row : {...row,componentId:gid(22)});
  assertRejected(await f.join(back,runtime.serverRevision,{components:wrong}),/identity|property|collider/);
});

test("M1 refuses Collider owner deletion and raw values that float32 rounding would hide", async t => {
  const f = await fixture(t); const a = await f.connect(); await f.bootstrap(a);
  const initial = await f.join(a); assertSnapshot(initial); await f.lock(a);
  const deletion = await a.request(envelope("hierarchy_operation",{
    operationId:"delete-shared-collider",userId:a.userId,sceneId,objectId:gid(10),
    kind:"delete_object",baseRevision:initial.serverRevision,
  }));
  assert.equal(deletion.type,"hierarchy_conflict");
  assert.equal(deletion.reason,"component_structure_sync_required");
  for (const [propertyPath,value,valueKind,expectedValue] of [
    ["m_Center",{x:100.000001,y:0,z:0},"vector3",{x:0,y:0,z:0}],
    ["m_Size",{x:-1e-50,y:2,z:3},"vector3",{x:1,y:2,z:3}],
  ]) {
    assertRejected(await a.request(f.set(initial,{propertyPath,value,valueKind,expectedValue})),/range/);
  }
  await f.lock(a,gid(11));
  assertRejected(await a.request(f.set(initial,{objectId:gid(11),componentId:gid(21),typeName:sphereType,
    propertyPath:"m_Radius",valueKind:"float",value:-1e-50,expectedValue:0.5})),/range/);
  const after = await f.snapshot(a,initial);
  assert.equal(after.serverRevision,initial.serverRevision);
  assert.deepEqual(after.properties,initial.properties);
});

test("M1 bounded history keeps accepting new edits and cannot resurrect an evicted operation", async t => {
  const f = await fixture(t,{maximumOperations:4}); const a = await f.connect(); await f.bootstrap(a);
  const initial = await f.join(a); assertSnapshot(initial); await f.lock(a);
  let current = initial, first;
  for (let index=0;index<7;index++) {
    const operation = f.set(current);
    if (!first) first = operation;
    const accepted = await a.request(operation);
    assert.equal(accepted.type,"component_property_applied",JSON.stringify(accepted));
    current = await f.snapshot(a,initial);
  }
  assert.equal(current.serverRevision,initial.serverRevision+7);
  assertRejected(await a.request({...first,requestId:"evicted-retry"}),/stale_revision/);
  assert.equal((await f.snapshot(a,initial)).serverRevision,current.serverRevision);
});


test("M1 Hierarchy capability gate uses the same trimmed Scene identity as the actual operation", async t=>{
  const f = await fixture(t); const a = await f.connect(); await f.bootstrap(a);
  const initial = await f.join(a); assertSnapshot(initial);
  for (const capability of [false,true]) {
    const unjoined = await f.connect(capability ? "capable-unjoined" : "legacy-unjoined",capability);
    const rejected = await unjoined.request(envelope("hierarchy_operation",{
      userId:unjoined.userId,sceneId:" "+sceneId+" ",objectId:gid(10),
      operationId:"whitespace-rename-"+capability,baseRevision:initial.serverRevision,
      kind:"rename_object",name:"must not rename shared Collider owner",
    }));
    assert.equal(rejected.type,"error",JSON.stringify(rejected));
    assert.equal(rejected.code,"component_sync_required");
  }
  const retained = await f.snapshot(a,initial);
  assert.equal(retained.serverRevision,initial.serverRevision);
});

test("M1 Project capacity denial disables Collider capability without breaking Hello or Presence", async t=>{
  const f = await fixture(t,{maximumProjectPeers:1}); const first = await f.connect();
  assert.equal(first.ack.componentPropertySyncEnabled,true);
  const rejected = await f.connect("over-capacity");
  assert.equal(rejected.ack.projectTransferEnabled,false);
  assert.equal(rejected.ack.componentPropertySyncEnabled,false);
  assert.equal(rejected.ack.presenceEnabled,true);
  assert.equal(rejected.ack.transformSyncEnabled,true);
  assert.equal((await rejected.request(envelope("ping",{clientTimestampUnixMs:Date.now()}))).type,"pong");
  const presence = await rejected.next(message=>message.type==="presence_snapshot");
  assert(presence.members.some(member=>member.userId===rejected.userId));
  // If a registration fails despite a successful preflight, the final ACK
  // must still advertise the actual result rather than an impossible capability.
  const originalCapacity = ProjectCoordinatorCore.prototype.registrationCapacityError;
  try {
    ProjectCoordinatorCore.prototype.registrationCapacityError = ()=>null;
    const failedRegistration = await f.connect("registration-denied-after-preflight");
    assert.equal(failedRegistration.ack.projectTransferEnabled,false);
    assert.equal(failedRegistration.ack.componentPropertySyncEnabled,false);
    assert.equal(failedRegistration.ack.presenceEnabled,true);
  } finally { ProjectCoordinatorCore.prototype.registrationCapacityError = originalCapacity; }
});

test("M1 preserves accepted runtime state by rejecting Project baseline rotation across Sessions", async t=>{
  const f = await fixture(t); const a = await f.connect(); await f.bootstrap(a);
  const initial = await f.join(a); assertSnapshot(initial); await f.lock(a);
  assert.equal((await a.request(f.set(initial))).type,"component_property_applied");
  const before = await f.snapshot(a,initial);
  const publisher = await f.connect("publisher-other-session",true,"other-session");
  const {descriptorSchemaVersion:_schema,projectId:_project,...sameDescriptor}=f.publication.descriptor;
  const replay = await publisher.request(envelope("project_baseline_publish",{userId:publisher.userId,...sameDescriptor}));
  assert.equal(replay.type,"project_baseline_changed"); assert.equal(replay.idempotent,true);
  const {manifest}=await buildManifest({projectRoot:f.publication.projectRoot,projectUuid,
    baselineRevision:2,chunkSize:65536,store:f.publication.store});
  const next = createDescriptor({projectId,projectUuid,baselineRevision:2,
    manifestHash:manifest.manifestHash,unityVersion:"6000.3.21f1",ownerIdentity:f.publication.owner});
  const {descriptorSchemaVersion:_nextSchema,projectId:_nextProject,...wireNext}=next;
  const denied = await publisher.request(envelope("project_baseline_publish",{userId:publisher.userId,...wireNext}));
  assert.equal(denied.type,"error"); assert.equal(denied.code,"component_checkpoint_required");
  const after = await f.snapshot(a,initial); assertSnapshot(after);
  assert.equal(after.epoch,before.epoch); assert.equal(after.serverRevision,before.serverRevision);
  assert.deepEqual(after.properties,before.properties); assert.deepEqual(after.source,before.source);
  const continued = await a.request(f.set(after));
  assert.equal(continued.type,"component_property_applied",JSON.stringify(continued));
});
