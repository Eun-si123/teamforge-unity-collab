import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { WebSocket } from "ws";
import { createTeamForgeServer } from "../src/teamforge-server.mjs";
import { componentSnapshotHash } from "../src/component-collaboration.mjs";
import { openDurableSessionStore } from "../src/durable-session-store.mjs";
import { hierarchyOperationFingerprint } from "../src/hierarchy-model.mjs";
import { ChunkStore } from "../../project-peer/src/content-store.mjs";
import { temporaryRoot, publicationFixture, cleanup } from "../../project-peer/test/helpers.mjs";

const sceneId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const scenePath = "Assets/Scenes/Shared.unity";
const projectId = "m3-shared-primitives";
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
const envelope = (type, fields = {}) => ({ type, protocolVersion: 1, requestId: `m3-${++sequence}`, ...fields });

// Queue complete frames before waiting: a commit can arrive between the two
// peers' awaits, and reconnect deliberately discards an origin's ACK.
async function openClient(url) {
  const socket = new WebSocket(url);
  const queue = [], waiters = [], frames = [];
  socket.on("message", data => {
    const value = JSON.parse(data.toString("utf8"));
    frames.push(value);
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
    socket, frames,
    send: value => socket.send(JSON.stringify(value)),
    next(predicate = () => true) {
      const index = queue.findIndex(predicate);
      if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, timer: null };
        waiter.timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1);
          reject(new Error("Timed out waiting for M3 frame; queued: " + queue.map(value =>
            value.type === "error" ? JSON.stringify(value) : value.type).join(", ")));
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

async function startCoordinatorProcess(options) {
  const moduleUrl = new URL("../src/teamforge-server.mjs", import.meta.url).href;
  const source = `
    import { createTeamForgeServer } from ${JSON.stringify(moduleUrl)};
    const server = createTeamForgeServer(JSON.parse(process.argv[1]));
    process.on('message', async message => {
      if (message === 'stop') { await server.stop(); process.exit(0); }
    });
    process.send({ type: 'ready', address: await server.start() });
  `;
  const { logger: _logger, ...serializable } = options;
  const child = spawn(process.execPath, ["--input-type=module", "-e", source, JSON.stringify(serializable)], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let diagnostics = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", chunk => { diagnostics = (diagnostics + chunk).slice(-8192); });
  const exited = new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
  const address = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL"); reject(new Error("Child Coordinator startup timed out: " + diagnostics));
    }, 10000);
    child.once("message", value => { clearTimeout(timer); resolve(value.address); });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => { clearTimeout(timer); reject(new Error(`Child Coordinator exited before ready (${code}): ${diagnostics}`)); });
  });
  return {
    address, pid: child.pid,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.send("stop");
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
      const result = await exited;
      clearTimeout(timer);
      assert.equal(result.code, 0, diagnostics);
    },
    async crash() {
      child.kill("SIGKILL");
      await exited;
    },
  };
}

const logical = n => "tf:c:" + n.toString(16).padStart(32, "0");
const signedExtraOwner = `--- !u!1 &12\nGameObject:\n${prefabFields}  m_Component:\n  - component: {fileID: 32}\n` +
  `--- !u!4 &32\nTransform:\n${prefabFields}  m_GameObject: {fileID: 12}\n`;
const emptyScene = Buffer.from("%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n" +
  `--- !u!1 &10\nGameObject:\n${prefabFields}  m_Component:\n  - component: {fileID: 30}\n` +
  `--- !u!4 &30\nTransform:\n${prefabFields}  m_GameObject: {fileID: 10}\n` + signedExtraOwner);

async function fixture(t, { empty = false, forgedOwner = false, prefabOwner = false, maximumBytes = 65536, enabled = true, maximumTombstones = 4096, durable = false, subprocess = false } = {}) {
  const extraOwner = prefabOwner ? signedExtraOwner.replace("m_PrefabInstance: {fileID: 0}","m_PrefabInstance: {fileID: 999}") : signedExtraOwner;
  const storedSceneBytes = empty ? emptyScene : Buffer.concat([sceneBytes, Buffer.from(extraOwner)]);
  const seedComponents = empty ? [] : components;
  const seedProperties = empty ? [] : properties;
  const root = await temporaryRoot("teamforge-m3-wire-");
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
  const databasePath = path.join(root, "sessions.sqlite");
  const serverOptions = {
    host: "127.0.0.1", port: 0, enableComponentPropertySync: true,
    enableComponentStructureSync: true, enablePrimitiveTemplateSync: enabled,
    componentProjectManagedRoot: managedRoot, maxRecentOperations: 4096,
    maxProjectPeersPerSession: 32, maxMessageBytes: maximumBytes, maxHierarchyTombstones:maximumTombstones,
    ...(durable ? { durableSessionDatabasePath: databasePath } : {}),
    logger: { info() {}, warn() {}, error() {} },
  };
  let server, address;
  async function startServer() {
    if (subprocess) {
      server = await startCoordinatorProcess(serverOptions);
      address = server.address;
    } else {
      server = createTeamForgeServer(serverOptions);
      address = await server.start();
    }
  }
  await startServer();
  const clients = [];
  t.after(async () => {
    await Promise.all(clients.map(client => client.close()));
    await server.stop();
    await cleanup(root);
  });
  const f = {
    get server() { return server; },
    publication, store, databasePath,
    async restart() {
      await Promise.all(clients.map(client => client.close()));
      await server.stop();
      await startServer();
    },
    async stop() {
      await Promise.all(clients.map(client => client.close()));
      await server.stop();
    },
    async crash() {
      assert.equal(subprocess, true, "Crash tests must own an actual child Coordinator process.");
      await server.crash();
      await Promise.all(clients.map(client => client.close()));
    },
    async connect(userId = "editor-a", { capability = true, primitive = true, hierarchy = true,
        presence = true, transform = true, property = true, sessionId = "m3-wire-session", expected = "hello_ack", recovery = durable } = {}) {
      const client = await openClient(`ws://127.0.0.1:${address.port}${address.wsPath}`);
      clients.push(client);
      client.userId = userId;
      client.ack = await client.request(envelope("hello", {
        projectId, sessionId, userId, userName: userId, userColor: "#AABBCC",
        supportsPresence: presence, supportsTransformSync: transform, supportsHierarchySync: hierarchy,
        supportsProjectTransfer: true, supportsComponentPropertySync: property,
        supportsComponentStructureSync: capability, supportsPrimitiveTemplateSync: primitive,
        ...(recovery ? { supportsDurableSessionRecovery: true } : {}),
      }));
      assert.equal(client.ack.type, expected, JSON.stringify(client.ack));
      return client;
    },
    async bootstrap(client, seedOverrides = {}) {
      const { descriptorSchemaVersion: _schema, projectId: _project, ...descriptor } = publication.descriptor;
      const published = await client.request(envelope("project_baseline_publish", { userId: client.userId, ...descriptor }));
      assert.equal(published.type, "project_baseline_changed");
      const seeded = await client.request(envelope("hierarchy_seed", {
        userId: client.userId, sceneId, baseRevision: 0,
        ...(durable ? { authorityEpoch: client.ack.authorityEpoch } : {}),
        objects: [...new Set([gid(10), ...(empty ? [] : [gid(11)]), gid(12), ...(forgedOwner ? [gid(99)] : [])])].map((objectId, index) => ({
          objectId, name: "M3 owner " + index, parentObjectId: "", siblingIndex: index,
          localPosition: { x: 0, y: 0, z: 0 }, localRotation: { x: 0, y: 0, z: 0, w: 1 },
          localScale: { x: 1, y: 1, z: 1 },
        })), ...seedOverrides,
      }));
      assert.equal(seeded.type, "hierarchy_seed_accepted");
      return seeded.serverRevision;
    },
    join(client, baseRevision = 0, overrides = {}) {
      return client.request(envelope("component_scene_join", {
        sceneId, scenePath, sceneFileSha256: sha(storedSceneBytes), sceneMetaSha256: sha(metaBytes),
        baseRevision, components: seedComponents, properties: seedProperties, ...overrides,
        ...(durable ? { authorityEpoch: client.ack.authorityEpoch } : {}),
      }));
    },
    async lock(client, objectId = gid(10)) {
      const result = await client.request(envelope("lock_request", { userId: client.userId, sceneId, objectId,
        ...(durable ? { authorityEpoch: client.ack.authorityEpoch } : {}) }));
      assert.equal(result.type, "lock_granted", JSON.stringify(result));
      return result;
    },
    async release(client, objectId = gid(10)) {
      const result = await client.request(envelope("lock_release", { userId: client.userId, sceneId, objectId,
        ...(durable ? { authorityEpoch: client.ack.authorityEpoch } : {}) }));
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

async function setup(t, options) {
  const f = await fixture(t, options);
  const a = await f.connect();
  assert.equal(a.ack.componentPropertySyncEnabled, true);
  assert.equal(a.ack.componentStructureSyncEnabled, true);
  assert.equal(a.ack.primitiveTemplateSyncEnabled, options?.enabled !== false);
  await f.bootstrap(a);
  const initial = await f.join(a);
  assertSnapshot(initial, { count: options?.empty ? 0 : 2 });
  return { f, a, initial };
}


const logicalObject = n => "tf:" + n.toString(16).padStart(32,"0");
function hierarchy(client, snapshot, kind = "create_object", overrides = {}) {
  const message=envelope("hierarchy_operation",{
    userId:client.userId,operationId:`primitive-operation-${++sequence}`,kind,sceneId,
    objectId:logicalObject(sequence),baseRevision:snapshot.serverRevision,
    ...(client.ack.durableSessionRecoveryEnabled ? { authorityEpoch: client.ack.authorityEpoch } : {}),
  });
  if(kind==="create_object") Object.assign(message,{
    name:"Shared Cube",parentObjectId:"",siblingIndex:999,
    localPosition:{x:2,y:3,z:4},localRotation:{x:0,y:0,z:0,w:1},localScale:{x:1,y:1,z:1},
    primitiveTemplate:"cube-v1",componentEpoch:snapshot.epoch,
  });
  return {...message,...overrides};
}
function deletion(client,snapshot,objectId,overrides={}) {
  return hierarchy(client,snapshot,"delete_object",{objectId,componentEpoch:snapshot.epoch,...overrides});
}
function assertRefused(value, pattern=/./) {
  assert.ok(["error","hierarchy_conflict","component_property_rejected"].includes(value.type),JSON.stringify(value));
  assert.match(value.code ?? value.error ?? value.reason ?? "",pattern,JSON.stringify(value));
}
async function topologyAfter(client,applied) {
  const snapshot=await client.next(value=>value.type==="component_topology_changed" && value.serverRevision===applied.serverRevision);
  assertSnapshot(snapshot,{type:"component_topology_changed"});
  assert.equal(snapshot.requestId,"");
  return snapshot;
}
function assertOrdered(client,operationId,revision) {
  const hierarchyIndex=client.frames.findIndex(value=>value.type==="hierarchy_applied" && value.operationId===operationId);
  const topologyIndex=client.frames.findIndex(value=>value.type==="component_topology_changed" && value.serverRevision===revision);
  assert.ok(hierarchyIndex>=0,"The regular Hierarchy result must be delivered.");
  assert.ok(topologyIndex>hierarchyIndex,"Topology must follow the Hierarchy object materialization frame.");
}
async function create(f,client,snapshot,overrides={}) {
  const message=hierarchy(client,snapshot,"create_object",overrides);
  const applied=await client.request(message);
  assert.equal(applied.type,"hierarchy_applied",JSON.stringify(applied));
  const topology=await topologyAfter(client,applied);
  assert.equal(topology.serverRevision,snapshot.serverRevision+1);
  assertOrdered(client,message.operationId,topology.serverRevision);
  const catalog=topology.components.filter(row=>row.objectId===message.objectId);
  assert.equal(catalog.length,1,"One primitive template must create exactly one logical Collider.");
  assert.match(catalog[0].componentId,/^tf:c:[0-9a-f]{32}$/);
  assert.equal(applied.changedObjects.find(row=>row.objectId===message.objectId)?.primitiveTemplate,message.primitiveTemplate);
  return {message,applied,topology,collider:catalog[0]};
}

test("M3 real WebSocket creates Cube and Sphere, moves/renames/edits exact Collider, late joins and atomically deletes without resurrection",async t=>{
  const {f,a,initial}=await setup(t);
  const b=await f.connect("editor-b");await f.join(b);
  const cube=await create(f,a,initial);
  const cubeAtB=await topologyAfter(b,cube.applied);
  assertOrdered(b,cube.message.operationId,cube.applied.serverRevision);
  assert.deepEqual(cubeAtB.components,cube.topology.components);
  assert.equal(cube.collider.typeName,boxType);
  assert.deepEqual(cube.topology.properties.find(row=>row.componentId===cube.collider.componentId && row.propertyPath==="m_Size").value,{x:1,y:1,z:1});
  await f.lock(a,cube.message.objectId);
  const transform=envelope("transform_update",{operationId:`primitive-move-${++sequence}`,userId:a.userId,sceneId,
    objectId:cube.message.objectId,baseRevision:cube.topology.serverRevision,
    localPosition:{x:9,y:8,z:7},localRotation:{x:0,y:0,z:0,w:1},localScale:{x:2,y:2,z:2}});
  const moved=await a.request(transform);
  assert.equal(moved.type,"transform_applied",JSON.stringify(moved));
  let current=await f.snapshot(a,cube.topology);
  const renamed=await a.request(hierarchy(a,current,"rename_object",{objectId:cube.message.objectId,name:"Shared crafted Cube"}));
  assert.equal(renamed.type,"hierarchy_applied",JSON.stringify(renamed));
  assert.equal(renamed.changedObjects.find(row=>row.objectId===cube.message.objectId)?.primitiveTemplate,"cube-v1");
  current=await f.snapshot(a,current);
  const edited=await a.request(f.set(current,cube.collider.componentId,"m_Center",{x:1.5,y:2.5,z:3.5}));
  assert.equal(edited.type,"component_property_applied",JSON.stringify(edited));
  current=await f.snapshot(a,current);
  const sphere=await create(f,a,current,{primitiveTemplate:"sphere-v1",name:"Shared Sphere"});
  assert.equal(sphere.collider.typeName,sphereType);
  assert.equal(sphere.topology.properties.find(row=>row.componentId===sphere.collider.componentId && row.propertyPath==="m_Radius").value,0.5);
  current=sphere.topology;
  // Additional explicitly shared Components on the primitive owner must be
  // removed with that owner, without touching a different primitive's Collider.
  const extraRequest=f.structure(current,{objectId:cube.message.objectId,typeName:sphereType});
  const extra=await a.request(extraRequest);
  assertSnapshot(extra,{type:"component_structure_applied",count:5});current=extra;
  const late=await f.connect("editor-late");
  const lateHierarchy=await late.next(value=>value.type==="hierarchy_snapshot");
  const lateCube=lateHierarchy.objects.find(row=>row.objectId===cube.message.objectId);
  assert.equal(lateCube.primitiveTemplate,"cube-v1");assert.equal(lateCube.name,"Shared crafted Cube");
  assert.deepEqual(lateCube.localPosition,{x:9,y:8,z:7});
  assert.equal(lateHierarchy.objects.find(row=>row.objectId===sphere.message.objectId)?.primitiveTemplate,"sphere-v1");
  const lateSnapshot=await f.join(late,current.serverRevision,{components:[],properties:[]});
  assert.deepEqual(lateSnapshot.components,current.components);
  assert.deepEqual(lateSnapshot.properties.find(row=>row.componentId===cube.collider.componentId && row.propertyPath==="m_Center").value,{x:1.5,y:2.5,z:3.5});
  const remove=deletion(a,current,cube.message.objectId);
  const peerDeleted=b.next(value=>value.type==="hierarchy_applied" && value.operationId===remove.operationId);
  a.send(remove);const removed=await peerDeleted;
  const deleted=await topologyAfter(b,removed);assertOrdered(b,remove.operationId,removed.serverRevision);
  assert.equal(deleted.components.length,3);
  assert.ok(!deleted.components.some(row=>row.objectId===cube.message.objectId));
  assert.ok(deleted.components.some(row=>row.componentId===sphere.collider.componentId));
  assert.ok(deleted.tombstones.some(row=>row.componentId===cube.collider.componentId));
  assert.ok(deleted.tombstones.some(row=>row.componentId===extraRequest.componentId));
  await a.close();
  const back=await f.connect("editor-a");
  const restoredHierarchy=await back.next(value=>value.type==="hierarchy_snapshot");
  assert.ok(!restoredHierarchy.objects.some(row=>row.objectId===cube.message.objectId));
  assert.equal(restoredHierarchy.objects.find(row=>row.objectId===sphere.message.objectId)?.primitiveTemplate,"sphere-v1");
  const recovered=await f.join(back,deleted.serverRevision,{components:[],properties:[]});
  assert.deepEqual(recovered.components,deleted.components);
  const replay=await back.request({...remove,requestId:`lost-delete-retry-${++sequence}`});
  assert.equal(replay.type,"hierarchy_applied",JSON.stringify(replay));
  assert.equal(replay.serverRevision,removed.serverRevision);
  const after=await f.snapshot(back,recovered);
  assert.equal(after.serverRevision,recovered.serverRevision);assert.deepEqual(after.components,recovered.components);
});

test("M3 matching replay preserves one logical Collider and rejects changed template or retired owner ID reuse",async t=>{
  const {f,a,initial}=await setup(t);
  const cube=await create(f,a,initial);
  await f.lock(a,cube.message.objectId);
  const renamed=await a.request(hierarchy(a,cube.topology,"rename_object",{objectId:cube.message.objectId,name:"Latest Cube name"}));
  assert.equal(renamed.type,"hierarchy_applied",JSON.stringify(renamed));
  const repeated=await a.request({...cube.message,requestId:`create-retry-${++sequence}`});
  assert.equal(repeated.type,"hierarchy_applied",JSON.stringify(repeated));
  assert.equal(repeated.serverRevision,renamed.serverRevision,"A lost create ACK must be rehydrated against current authority.");
  assert.equal(repeated.operationRevision,cube.applied.serverRevision);
  assert.equal(repeated.changedObjects.find(row=>row.objectId===cube.message.objectId)?.name,"Latest Cube name");
  let current=await f.snapshot(a,cube.topology);
  assert.equal(current.components.filter(row=>row.objectId===cube.message.objectId).length,1);
  assert.equal(current.components.find(row=>row.objectId===cube.message.objectId).componentId,cube.collider.componentId);
  assertRefused(await a.request({...cube.message,requestId:`changed-retry-${++sequence}`,primitiveTemplate:"sphere-v1"}),/operation_id_conflict/);
  assertRefused(await a.request({...cube.message,requestId:`wrong-epoch-retry-${++sequence}`,componentEpoch:"33333333-3333-4333-8333-333333333333"}),/epoch/);
  current=await f.snapshot(a,current);
  assert.equal(current.serverRevision,renamed.serverRevision);
  const removed=await a.request(deletion(a,current,cube.message.objectId));
  assert.equal(removed.type,"hierarchy_applied",JSON.stringify(removed));
  const deleted=await topologyAfter(a,removed);
  const retiredReplay=await a.request({...cube.message,requestId:`retired-create-retry-${++sequence}`});
  assert.equal(retiredReplay.type,"hierarchy_applied",JSON.stringify(retiredReplay));
  assert.equal(retiredReplay.serverRevision,deleted.serverRevision);
  assert.equal(retiredReplay.operationRevision,cube.applied.serverRevision);
  assert.ok(!retiredReplay.changedObjects.some(row=>row.objectId===cube.message.objectId),"An old create receipt must not recreate a deleted primitive.");
  assert.ok(retiredReplay.deletedObjectIds.includes(cube.message.objectId));
  assertRefused(await a.request(hierarchy(a,deleted,"create_object",{objectId:cube.message.objectId})),/deleted|tombstone|identity/);
  const after=await f.snapshot(a,deleted);
  assert.equal(after.serverRevision,deleted.serverRevision);
  assert.ok(!after.components.some(row=>row.componentId===cube.collider.componentId));
});

test("M3 primitive create and delete reject missing source admission, invalid tokens and stale epoch with no partial state",async t=>{
  const {f,a,initial}=await setup(t);
  const unjoined=await f.connect("unjoined-editor");
  assertRefused(await unjoined.request(hierarchy(unjoined,initial)),/component|join|primitive/);
  const variants=[{primitiveTemplate:"capsule-v1"},{primitiveTemplate:7},{primitiveTemplate:{type:"cube-v1"}},
    {componentEpoch:""},{componentEpoch:"33333333-3333-4333-8333-333333333333"}];
  for(const variant of variants) {
    assertRefused(await a.request(hierarchy(a,initial,"create_object",variant)),/invalid|primitive|epoch/);
    const after=await f.snapshot(a,initial);
    assert.equal(after.serverRevision,initial.serverRevision);assert.equal(after.snapshotHash,initial.snapshotHash);
  }
  assertRefused(await a.request(hierarchy(a,initial,"rename_object",{objectId:gid(12),name:"Unchanged",primitiveTemplate:"cube-v1"})),/invalid|primitive/);
  const rejectionReader=await f.connect("rejection-reader");
  const afterRejectedHierarchy=await rejectionReader.next(value=>value.type==="hierarchy_snapshot");
  assert.equal(afterRejectedHierarchy.objects.length,3,"Rejected creation must not leave an orphan Hierarchy record.");
  assert.equal(afterRejectedHierarchy.objects.find(row=>row.objectId===gid(12))?.name,"M3 owner 2");
  const cube=await create(f,a,initial);
  await f.lock(a,cube.message.objectId);
  assertRefused(await a.request(deletion(a,cube.topology,cube.message.objectId,{componentEpoch:"33333333-3333-4333-8333-333333333333"})),/epoch/);
  const after=await f.snapshot(a,cube.topology);
  assert.equal(after.serverRevision,cube.topology.serverRevision);assert.deepEqual(after.components,cube.topology.components);
});

test("M3 capability admission rejects incompatible Editors while preserving transfer-only peers and disabled M2 behavior",async t=>{
  const f=await fixture(t);
  const old=await f.connect("old-editor",{primitive:false,expected:"error"});
  assertRefused(old.ack,/invalid_hello/);
  assert.match(old.ack.message,/primitive template.*Component structure/);
  assert.equal(f.server.presenceMemberCount,0,"An incompatible Editor must not partially register a Session member.");
  const missingStructure=await f.connect("without-structure",{capability:false,expected:"error"});
  assertRefused(missingStructure.ack,/primitive|capability|compatib|hello/);
  const badFlag=await f.connect("bad-flag",{primitive:"true",expected:"error"});
  assertRefused(badFlag.ack,/hello|primitive/);
  const transfer=await f.connect("transfer-peer",{presence:false,transform:false,hierarchy:false,property:false,capability:false,primitive:false});
  assert.equal(transfer.ack.projectTransferEnabled,true);
  assert.notEqual(transfer.ack.primitiveTemplateSyncEnabled,true);
  const {f:disabled,a,initial}=await setup(t,{enabled:false});
  const disabledCreate=hierarchy(a,initial);
  assertRefused(await a.request(disabledCreate),/primitive|unsupported|not_negotiated/);
  const after=await disabled.snapshot(a,initial);
  assert.equal(after.serverRevision,initial.serverRevision);assert.deepEqual(after.components,initial.components);
  const disabledReader=await disabled.connect("disabled-reader");
  const disabledHierarchy=await disabledReader.next(value=>value.type==="hierarchy_snapshot");
  assert.ok(!disabledHierarchy.objects.some(row=>row.objectId===disabledCreate.objectId));
});

test("M3 rejects forged baseline primitive templates and treats empty optional DTO values as legacy creation",async t=>{
  const f=await fixture(t);const a=await f.connect();
  const {descriptorSchemaVersion:_schema,projectId:_project,...descriptor}=f.publication.descriptor;
  const published=await a.request(envelope("project_baseline_publish",{userId:a.userId,...descriptor}));
  assert.equal(published.type,"project_baseline_changed");
  const seeded=await a.request(envelope("hierarchy_seed",{userId:a.userId,sceneId,baseRevision:0,objects:[{
    objectId:gid(10),name:"Forged Cube",parentObjectId:"",siblingIndex:0,
    localPosition:{x:0,y:0,z:0},localRotation:{x:0,y:0,z:0,w:1},localScale:{x:1,y:1,z:1},primitiveTemplate:"cube-v1",
  }]}));
  assertRefused(seeded,/invalid|seed|primitive/);
  await f.bootstrap(a);const initial=await f.join(a);
  const plain=await a.request(hierarchy(a,initial,"create_object",{primitiveTemplate:"",componentEpoch:""}));
  assert.equal(plain.type,"hierarchy_applied",JSON.stringify(plain));
  const created=plain.changedObjects.find(row=>row.objectId===plain.objectId);
  assert.equal(Object.hasOwn(created,"primitiveTemplate"),false);
  const after=await f.snapshot(a,initial);
  assert.equal(after.serverRevision,initial.serverRevision+1);
  assert.deepEqual(after.components,initial.components);assert.deepEqual(after.tombstones,initial.tombstones);
});

test("M3 deletion requires owned leases, refuses foreign subtree locks and preserves nonprimitive Collider owners",async t=>{
  const {f,a,initial}=await setup(t);
  const b=await f.connect("editor-b");await f.join(b);
  const cube=await create(f,a,initial);
  assertRefused(await a.request(deletion(a,cube.topology,cube.message.objectId)),/lock|lease/);
  await f.lock(a,cube.message.objectId);
  const child=await create(f,a,cube.topology,{parentObjectId:cube.message.objectId,primitiveTemplate:"sphere-v1",name:"Child Sphere"});
  await f.lock(b,child.message.objectId);
  assertRefused(await a.request(deletion(a,child.topology,cube.message.objectId)),/lock|lease/);
  let current=await f.snapshot(a,child.topology);
  assert.equal(current.serverRevision,child.topology.serverRevision);assert.deepEqual(current.components,child.topology.components);
  await f.lock(a,gid(10));
  const nonprimitive=hierarchy(a,current,"delete_object",{objectId:gid(10)});
  assertRefused(await a.request(nonprimitive),/component_structure|collider|primitive/);
  current=await f.snapshot(a,current);assert.equal(current.serverRevision,child.topology.serverRevision);
  await f.release(b,child.message.objectId);await f.lock(a,child.message.objectId);
  const removed=await a.request(deletion(a,current,cube.message.objectId));
  assert.equal(removed.type,"hierarchy_applied",JSON.stringify(removed));
  const deleted=await topologyAfter(a,removed);
  assert.ok(removed.deletedObjectIds.includes(cube.message.objectId));assert.ok(removed.deletedObjectIds.includes(child.message.objectId));
  assert.equal(deleted.components.length,initial.components.length);
  assert.ok(deleted.tombstones.some(row=>row.componentId===cube.collider.componentId));
  assert.ok(deleted.tombstones.some(row=>row.componentId===child.collider.componentId));
});

test("M3 complete hierarchy and Collider projections refuse budget overflow without publishing a partial primitive",async t=>{
  const {f,a,initial}=await setup(t,{maximumBytes:18000});
  let current=initial,created=0,refused=false;
  for(let index=0;index<30;index++) {
    const request=hierarchy(a,current);
    const response=await a.request(request);
    if(response.type!=="hierarchy_applied") {
      assertRefused(response,/size|limit|budget|snapshot/);refused=true;
      const after=await f.snapshot(a,current);
      assert.equal(after.serverRevision,current.serverRevision);assert.equal(after.snapshotHash,current.snapshotHash);
      assert.deepEqual(after.components,current.components);assert.deepEqual(after.tombstones,current.tombstones);
      const reader=await f.connect("budget-reader");
      const hierarchySnapshot=await reader.next(value=>value.type==="hierarchy_snapshot");
      assert.equal(hierarchySnapshot.serverRevision,current.serverRevision);
      assert.equal(hierarchySnapshot.objects.filter(row=>row.primitiveTemplate).length,created);
      assert.ok(!hierarchySnapshot.objects.some(row=>row.objectId===request.objectId));
      break;
    }
    const changed=await topologyAfter(a,response);assertOrdered(a,request.operationId,response.serverRevision);
    assert.ok(Buffer.byteLength(JSON.stringify(response))<=18000);
    assert.ok(Buffer.byteLength(JSON.stringify(changed))<=18000);
    current=changed;created++;
  }
  assert.ok(created>0,"The budget fixture must exercise at least one actual primitive commit.");
  assert.equal(refused,true,"The finite snapshot budget must eventually refuse growth.");
});

test("M3 creates the first shared primitive from a signed Collider-empty Scene",async t=>{
  const {f,a,initial}=await setup(t,{empty:true});
  assert.equal(initial.components.length,0);assert.equal(initial.properties.length,0);
  const cube=await create(f,a,initial);
  assert.equal(cube.topology.components.length,1);assert.equal(cube.topology.properties.length,3);
  const peer=await f.connect("first-primitive-peer");
  const hierarchySnapshot=await peer.next(value=>value.type==="hierarchy_snapshot");
  assert.equal(hierarchySnapshot.objects.find(row=>row.objectId===cube.message.objectId)?.primitiveTemplate,"cube-v1");
  const recovered=await f.join(peer,cube.topology.serverRevision,{components:[],properties:[]});
  assert.equal(recovered.components[0].componentId,cube.collider.componentId);
  assert.deepEqual(recovered.properties,cube.topology.properties);
});


test("M3 retired primitive owner IDs remain unavailable after bounded Hierarchy tombstone eviction",async t=>{
  const {f,a,initial}=await setup(t,{maximumTombstones:1});
  const cube=await create(f,a,initial);await f.lock(a,cube.message.objectId);
  const firstDelete=await a.request(deletion(a,cube.topology,cube.message.objectId));
  assert.equal(firstDelete.type,"hierarchy_applied",JSON.stringify(firstDelete));
  let current=await topologyAfter(a,firstDelete);
  const sphere=await create(f,a,current,{primitiveTemplate:"sphere-v1",name:"Later Sphere"});
  await f.lock(a,sphere.message.objectId);
  const secondDelete=await a.request(deletion(a,sphere.topology,sphere.message.objectId));
  assert.equal(secondDelete.type,"hierarchy_applied",JSON.stringify(secondDelete));
  current=await topologyAfter(a,secondDelete);
  const reader=await f.connect("eviction-reader");
  const hierarchySnapshot=await reader.next(value=>value.type==="hierarchy_snapshot");
  assert.equal(hierarchySnapshot.tombstones.length,1);
  assert.ok(!hierarchySnapshot.tombstones.some(row=>row.objectId===cube.message.objectId),"The test must actually retire the older bounded Hierarchy tombstone.");
  assertRefused(await a.request(hierarchy(a,current,"create_object",{objectId:cube.message.objectId})),/identity|reuse|retired|tombstone|deleted/);
  assertRefused(await a.request(hierarchy(a,current,"create_object",{objectId:cube.message.objectId,primitiveTemplate:"",componentEpoch:""})),/identity|reuse|retired|tombstone|deleted/);
  const after=await f.snapshot(a,current);
  assert.equal(after.serverRevision,current.serverRevision);assert.deepEqual(after.components,current.components);
  assert.ok(!after.components.some(row=>row.objectId===cube.message.objectId));
});

test("M4 signed WebSocket edits survive a fresh Coordinator with stable lineage, a new epoch and no old leases", async t => {
  const f = await fixture(t, { empty: true, durable: true });
  const oldEditor = await f.connect("legacy-editor", { recovery: false, expected: "error" });
  assertRefused(oldEditor.ack, /invalid_hello/);
  assert.equal(f.server.presenceMemberCount, 0);
  const a = await f.connect();
  assert.equal(a.ack.durableSessionRecoveryEnabled, true);
  assert.match(a.ack.authorityEpoch, /^[a-f0-9-]{36}$/);
  assert.match(a.ack.durableSessionId, /^[a-f0-9-]{36}$/);
  const otherSession = await f.connect(a.userId, {sessionId:"m4-distinct-session"});
  assert.notEqual(otherSession.ack.authorityEpoch, a.ack.authorityEpoch);
  assert.notEqual(otherSession.ack.durableSessionId, a.ack.durableSessionId);
  assertRefused(await otherSession.request(envelope("hierarchy_seed", {
    userId:otherSession.userId, sceneId, baseRevision:0, objects:[], authorityEpoch:a.ack.authorityEpoch,
  })), /authority_epoch_mismatch/);
  const unsignedSeed = await a.request(envelope("hierarchy_seed", {
    userId: a.userId, sceneId, baseRevision: 0, objects: [], authorityEpoch: a.ack.authorityEpoch,
  }));
  assertRefused(unsignedSeed, /durable_source_required/);
  assert.equal(await f.bootstrap(a), 0, "The first signed Hierarchy seed remains revision zero.");
  const initial = await f.join(a, 0);
  assertSnapshot(initial, { count: 0 });
  assert.equal(initial.epoch, a.ack.authorityEpoch);
  const cube = await create(f, a, initial);
  const unscopedLock = await a.request(envelope("lock_request", {
    userId: a.userId, sceneId, objectId: cube.message.objectId,
  }));
  assertRefused(unscopedLock, /authority_epoch_mismatch/);
  assert.equal(f.server.activeLockCount, 0);
  await f.lock(a, cube.message.objectId);
  const move = envelope("transform_update", {
    operationId: `durable-transform-${++sequence}`, userId: a.userId, sceneId,
    objectId: cube.message.objectId, baseRevision: cube.applied.serverRevision,
    localPosition: { x: 9, y: 8, z: 7 }, localRotation: { x: 0, y: 0, z: 0, w: 1 },
    localScale: { x: 2, y: 3, z: 4 },
  });
  assertRefused(await a.request(move), /authority_epoch_mismatch/);
  const moved = await a.request({ ...move, requestId: `durable-move-${++sequence}`, authorityEpoch: a.ack.authorityEpoch });
  assert.equal(moved.type, "transform_applied", JSON.stringify(moved));
  let current = await f.snapshot(a, cube.topology);
  const edit = f.set(current, cube.collider.componentId, "m_Center", { x: 1.25, y: 2.5, z: 3.75 });
  const edited = await a.request(edit);
  assert.equal(edited.type, "component_property_applied", JSON.stringify(edited));
  current = await f.snapshot(a, current);
  assert.equal(current.serverRevision, 3);
  assert.equal(f.server.activeLockCount, 1);
  await f.stop();

  const stored = openDurableSessionStore({ filePath: f.databasePath });
  const scope = { projectId, sessionId: "m3-wire-session", projectUuid };
  try {
    const record = stored.load(scope);
    assert.equal(record.revision, current.serverRevision);
    assert.equal(record.epoch, a.ack.authorityEpoch);
    assert.equal(record.checkpoint.lineageId, a.ack.durableSessionId);
    const receipt = stored.findOperation({ scope, epoch: a.ack.authorityEpoch,
      operationId: cube.message.operationId, userId: a.userId, fingerprint: hierarchyOperationFingerprint(cube.message) });
    assert.equal(receipt.revision, cube.applied.serverRevision);
    assert.equal(receipt.result.type, "hierarchy_applied");
    assert.equal(receipt.result.changedObjects.find(row => row.objectId === cube.message.objectId)?.primitiveTemplate, "cube-v1");
    assert.throws(() => stored.findOperation({ scope, epoch: a.ack.authorityEpoch,
      operationId: cube.message.operationId, userId: "other-editor", fingerprint: hierarchyOperationFingerprint(cube.message) }),
      error => error.code === "OPERATION_CONFLICT");
    const intent = Object.fromEntries(["sceneId", "objectId", "componentId", "typeName", "propertyPath", "valueKind", "value", "baseRevision"].map(key => [key, edit[key]]));
    const propertyReceipt = stored.findOperation({ scope, epoch: a.ack.authorityEpoch,
      operationId: edit.operationId, userId: a.userId, fingerprint: JSON.stringify(["m2-property", a.userId, intent]) });
    assert.equal(propertyReceipt.revision, edited.serverRevision);
    assert.deepEqual(propertyReceipt.result.value, edit.value);
  } finally { stored.close(); }

  await f.restart();
  assert.equal(f.server.activeLockCount, 0);
  assert.equal(f.server.presenceMemberCount, 0);
  const b = await f.connect("editor-a");
  assert.equal(b.ack.durableSessionRecoveryEnabled, true);
  assert.equal(b.ack.durableSessionId, a.ack.durableSessionId);
  assert.notEqual(b.ack.authorityEpoch, a.ack.authorityEpoch);
  const restoredHierarchy = await b.next(value => value.type === "hierarchy_snapshot");
  assert.equal(restoredHierarchy.serverRevision, current.serverRevision);
  const restoredCube = restoredHierarchy.objects.find(row => row.objectId === cube.message.objectId);
  assert.equal(restoredCube?.primitiveTemplate, "cube-v1");
  assert.deepEqual(restoredCube.localPosition, move.localPosition);
  assert.deepEqual(restoredCube.localScale, move.localScale);
  const restoredTransforms = await b.next(value => value.type === "transform_snapshot");
  assert.equal(restoredTransforms.serverRevision, current.serverRevision);
  assert.deepEqual(restoredTransforms.locks, []);
  assert.deepEqual(restoredTransforms.transforms.find(row => row.objectId === cube.message.objectId)?.localPosition, move.localPosition);
  const recovered = await f.join(b, current.serverRevision, { components: [], properties: [] });
  assertSnapshot(recovered, { count: 1 });
  assert.equal(recovered.epoch, b.ack.authorityEpoch);
  assert.deepEqual(recovered.components, current.components);
  assert.deepEqual(recovered.properties, current.properties);
  assert.notEqual(recovered.snapshotHash, current.snapshotHash);
  for (const oldMessage of [
    { ...cube.message },
    { ...move, authorityEpoch: a.ack.authorityEpoch },
    envelope("lock_request", { userId: b.userId, sceneId, objectId: cube.message.objectId, authorityEpoch: a.ack.authorityEpoch }),
  ]) assertRefused(await b.request({ ...oldMessage, requestId: `old-epoch-${++sequence}` }), /authority_epoch_mismatch/);
  assertRejected(await b.request({ ...edit, requestId: `old-component-${++sequence}` }), /epoch/);
  assert.equal(f.server.activeLockCount, 0);
  const noLease = await b.request(f.set(recovered, cube.collider.componentId, "m_Center", { x: 4, y: 5, z: 6 }));
  assertRejected(noLease, /lock/);
  await f.lock(b, cube.message.objectId);
  const next = await b.request(f.set(recovered, cube.collider.componentId, "m_Center", { x: 4, y: 5, z: 6 }));
  assert.equal(next.type, "component_property_applied", JSON.stringify(next));
  assert.equal(next.serverRevision, current.serverRevision + 1);
  const after = await f.snapshot(b, recovered);
  assert.equal(after.components[0].componentId, cube.collider.componentId);
  assert.deepEqual(after.properties.find(row => row.componentId === cube.collider.componentId && row.propertyPath === "m_Center")?.value, { x: 4, y: 5, z: 6 });
});

test("M4 disabled retains legacy WebSocket editing and never creates a durable database", async t => {
  const { f, a, initial } = await setup(t, { empty: true });
  for (const key of ["durableSessionRecoveryEnabled", "authorityEpoch", "durableSessionId"])
    assert.equal(Object.hasOwn(a.ack, key), false);
  const cube = await create(f, a, initial);
  await f.lock(a, cube.message.objectId);
  assert.equal(f.server.activeLockCount, 1);
  await assert.rejects(stat(f.databasePath), error => error.code === "ENOENT");
  await f.stop();
  await assert.rejects(stat(f.databasePath), error => error.code === "ENOENT");
});

test("M4 reviewed Transform resubmission requires a current lease and both reviewed revisions", async t => {
  const {f,a,initial} = await setup(t, {empty:true, durable:true});
  const cube = await create(f,a,initial);
  const intent = envelope("transform_update", {
    operationId: `review-transform-${++sequence}`, userId:a.userId, sceneId,
    objectId:cube.message.objectId, baseRevision:cube.applied.serverRevision,
    authorityEpoch:a.ack.authorityEpoch, expectedTransformRevision:0,
    localPosition:{x:4,y:0,z:2}, localRotation:{x:0,y:0,z:0,w:1}, localScale:{x:1,y:1,z:1},
  });
  assertRefused(await a.request(intent), /lock_required/);
  await f.lock(a,cube.message.objectId);
  const first = await a.request(intent);
  assert.equal(first.type,"transform_applied",JSON.stringify(first));
  assert.equal(first.serverRevision,cube.applied.serverRevision+1);

  const next = {...intent, operationId:`review-transform-${++sequence}`, baseRevision:first.serverRevision,
    expectedTransformRevision:first.serverRevision, localPosition:{x:5,y:0,z:3}};
  for (const broken of [
    {...next, expectedTransformRevision:0},
    {...next, baseRevision:cube.applied.serverRevision},
  ]) assertRefused(await a.request({...broken, requestId:`stale-review-${++sequence}`}), /transform_recovery_conflict/);
  const unchanged = await f.snapshot(a,cube.topology);
  assert.equal(unchanged.serverRevision,first.serverRevision);
  const second = await a.request({...next, requestId:`confirmed-review-${++sequence}`});
  assert.equal(second.type,"transform_applied",JSON.stringify(second));
  assert.deepEqual(second.localPosition,next.localPosition);
  assert.equal(second.serverRevision,first.serverRevision+1);
  assertRefused(await a.request({...next, requestId:`changed-review-${++sequence}`, expectedTransformRevision:0}),
    /operation_id_conflict/);
});

test("M4 actual Coordinator SIGKILL retains a peer-confirmed Collider commit before origin recovery", async t => {
  const f = await fixture(t, { empty: true, durable: true, subprocess: true });
  const a = await f.connect("editor-origin");
  await f.bootstrap(a);
  const initial = await f.join(a);
  const b = await f.connect("editor-observer");
  await f.join(b);
  const cube = await create(f, a, initial);
  await topologyAfter(b, cube.applied);
  await f.lock(a, cube.message.objectId);
  const edit = f.set(cube.topology, cube.collider.componentId, "m_Size", { x: 2, y: 4, z: 8 });
  const observed = b.next(value => value.type === "component_property_applied" && value.operationId === edit.operationId);
  // The origin does not consume the ACK. A second peer's broadcast proves the
  // real Server completed its before-publication transaction before SIGKILL.
  a.send(edit);
  const committed = await observed;
  assert.equal(committed.serverRevision, 2);
  const firstPid = f.server.pid;
  await f.crash();
  await f.restart();
  assert.notEqual(f.server.pid, firstPid);
  const recovered = await f.connect("editor-origin");
  assert.equal(recovered.ack.durableSessionId, a.ack.durableSessionId);
  assert.notEqual(recovered.ack.authorityEpoch, a.ack.authorityEpoch);
  const hierarchySnapshot = await recovered.next(value => value.type === "hierarchy_snapshot");
  assert.equal(hierarchySnapshot.serverRevision, committed.serverRevision);
  assert.equal(hierarchySnapshot.objects.find(row => row.objectId === cube.message.objectId)?.primitiveTemplate, "cube-v1");
  const transforms = await recovered.next(value => value.type === "transform_snapshot");
  assert.deepEqual(transforms.locks, []);
  const snapshot = await f.join(recovered, committed.serverRevision, { components: [], properties: [] });
  assertSnapshot(snapshot, { count: 1 });
  assert.equal(snapshot.components[0].componentId, cube.collider.componentId);
  assert.deepEqual(snapshot.properties.find(row => row.componentId === cube.collider.componentId && row.propertyPath === "m_Size")?.value, edit.value);
  assertRejected(await recovered.request({ ...edit, requestId: `crash-stale-${++sequence}` }), /epoch/);
  const after = await f.snapshot(recovered, snapshot);
  assert.equal(after.serverRevision, committed.serverRevision);
  assert.equal(after.snapshotHash, snapshot.snapshotHash);
});
