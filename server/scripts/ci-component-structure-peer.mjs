// One actual Unity Editor and a Node peer exercise production Component
// lifecycle collaboration. This fixture does not establish two-Editor proof.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { createTeamForgeServer } from "../src/teamforge-server.mjs";
import { ProjectPeerEngine } from "../../project-peer/src/project-peer.mjs";
import { ChunkStore } from "../../project-peer/src/content-store.mjs";
import { buildManifest } from "../../project-peer/src/manifest.mjs";
import { createDescriptor } from "../../project-peer/src/descriptor.mjs";
import { generateIdentity } from "../../project-peer/src/identity.mjs";
import { createUnityProject } from "../../project-peer/test/helpers.mjs";

const workspace = fileURLToPath(new URL("../../", import.meta.url));
const evidence = path.join(workspace, "test-results/component-structure-e2e");
const projectId = "ci-m2-project", sessionId = "ci-m2-session", userId = "ci-m2-peer";
const sourceSha = process.env.GITHUB_SHA ?? "local-uncommitted";
const primitiveEnabled = process.env.TEAMFORGE_PRIMITIVE_E2E === "1";
const durableEnabled = process.env.TEAMFORGE_DURABLE_E2E === "1";
const durableTransformEnabled = process.env.TEAMFORGE_DURABLE_TRANSFORM_E2E === "1";
const durableHierarchyEnabled = process.env.TEAMFORGE_DURABLE_HIERARCHY_E2E === "1";
const durableReparentEnabled = process.env.TEAMFORGE_DURABLE_REPARENT_E2E === "1";
const durableSiblingEnabled = process.env.TEAMFORGE_DURABLE_SIBLING_E2E === "1";
const recoveredOwnerName = "M4 reviewed local Hierarchy name";
const authorityEpochCommands = new Set([
  "hierarchy_seed", "hierarchy_operation", "transform_update", "lock_request", "lock_release", "component_scene_join",
]);
const uuid = /^(?!00000000-0000-0000-0000-000000000000$)[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const deadline = Date.now() + 20 * 60_000;
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
let server, relay, peer, sequence = 0, stopping = false, holdNextAck = false;
let holdPrimitiveDeleteTarget = "";
const relaySockets = new Set();
const envelope = (type, fields = {}) => ({
  type, protocolVersion: 1, requestId: "ci-structure-" + ++sequence, ...fields,
});

async function boundedRead(file, maximum) {
  const input = await open(file, "r");
  try {
    const stat = await input.stat();
    assert(stat.isFile() && stat.size > 0 && stat.size <= maximum, "Invalid bounded fixture file.");
    const bytes = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await input.read(bytes, offset, bytes.length - offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    assert.equal(offset, stat.size, "Fixture changed during its bounded read.");
    return bytes.subarray(0, offset);
  } finally { await input.close(); }
}

async function output(name, value) {
  const file = path.join(evidence, name);
  await writeFile(file + ".tmp", JSON.stringify(value));
  await rename(file + ".tmp", file);
}

async function waitJson(name, predicate = () => true) {
  while (!stopping && Date.now() < deadline) {
    try {
      const value = JSON.parse(await boundedRead(path.join(evidence, name), 512 * 1024));
      if (predicate(value)) return value;
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    await delay(100);
  }
  throw new Error("Unity Component structure fixture timed out or stopped.");
}

async function client(url) {
  const socket = new WebSocket(url), queue = [], waiters = [];
  socket.on("message", data => {
    const row = JSON.parse(data.toString("utf8"));
    const index = waiters.findIndex(waiter => waiter.predicate(row));
    if (index < 0) queue.push(row);
    else {
      const [waiter] = waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(row);
    }
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("M2 fixture socket open timeout.")), 10_000);
    socket.once("open", () => { clearTimeout(timer); resolve(); });
    socket.once("error", error => { clearTimeout(timer); reject(error); });
  });
  function next(predicate) {
    const index = queue.findIndex(predicate);
    if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, timer: null };
      waiter.timer = setTimeout(() => {
        waiters.splice(waiters.indexOf(waiter), 1);
        reject(new Error("M2 fixture response timeout; queued types: " + queue.map(row => row.type).join(", ")));
      }, 15_000);
      waiters.push(waiter);
    });
  }
  const connected = { socket, next, authorityEpoch: "", durableSessionId: "", async request(value) {
    if (durableEnabled && authorityEpochCommands.has(value.type)) {
      assert(uuid.test(connected.authorityEpoch), "A durable write must use its negotiated authority epoch.");
      value = { ...value, authorityEpoch: connected.authorityEpoch };
    }
    const answer = next(row => row.requestId === value.requestId);
    socket.send(JSON.stringify(value));
    const result = await answer;
    assert.notEqual(result.type, "error", JSON.stringify(result));
    assert.notEqual(result.type, "component_property_rejected", JSON.stringify(result));
    assert.notEqual(result.type, "component_structure_rejected", JSON.stringify(result));
    return result;
  } };
  return connected;
}

async function connectPeer(url) {
  const connected = await client(url);
  const acknowledgement = await connected.request(envelope("hello", {
    projectId, sessionId, userId, userName: "CI M2 Node peer", userColor: "#AABBCC",
    supportsPresence: true, supportsTransformSync: true, supportsHierarchySync: true,
    supportsProjectTransfer: true, supportsComponentPropertySync: true,
    supportsComponentStructureSync: true,
    ...(primitiveEnabled ? { supportsPrimitiveTemplateSync: true } : {}),
    ...(durableEnabled ? { supportsDurableSessionRecovery: true } : {}),
    ...(durableHierarchyEnabled ? { supportsHierarchyRenameRecovery: true } : {}),
    ...(durableReparentEnabled ? { supportsHierarchyReparentRecovery: true } : {}),
    ...(durableSiblingEnabled ? { supportsHierarchySiblingRecovery: true } : {}),
  }));
  assert.equal(acknowledgement.componentPropertySyncEnabled, true);
  assert.equal(acknowledgement.componentStructureSyncEnabled, true);
  if (primitiveEnabled) assert.equal(acknowledgement.primitiveTemplateSyncEnabled, true);
  if (durableEnabled) {
    assert.equal(acknowledgement.durableSessionRecoveryEnabled, true);
    assert(uuid.test(acknowledgement.authorityEpoch));
    assert(uuid.test(acknowledgement.durableSessionId));
    connected.authorityEpoch = acknowledgement.authorityEpoch;
    connected.durableSessionId = acknowledgement.durableSessionId;
  }
  if (durableHierarchyEnabled) assert.equal(acknowledgement.hierarchyRenameRecoveryEnabled, true);
  if (durableReparentEnabled) assert.equal(acknowledgement.hierarchyReparentRecoveryEnabled, true);
  if (durableSiblingEnabled) assert.equal(acknowledgement.hierarchySiblingRecoveryEnabled, true);
  return connected;
}

async function startOwnedRelay(upstreamUrl) {
  // Fault injection owns only this fixture's Editor connection. It never
  // touches NICs, firewalls, remote management or another TeamForge Session.
  relay = new WebSocketServer({ host: "127.0.0.1", port: 5084 });
  relay.on("connection", downstream => {
    const upstream = new WebSocket(upstreamUrl), queued = [];
    let withheldDelete;
    relaySockets.add(downstream); relaySockets.add(upstream);
    downstream.on("message", data => {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data.toString("utf8"));
      else queued.push(data.toString("utf8"));
    });
    upstream.on("open", () => {
      for (const frame of queued) upstream.send(frame);
      queued.length = 0;
    });
    upstream.on("message", data => {
      const message = JSON.parse(data.toString("utf8"));
      if (message.type === "hierarchy_applied" && message.kind === "delete_object" && message.componentTopologyChanged &&
          (message.objectId === holdPrimitiveDeleteTarget || message.operationId === withheldDelete?.operationId)) {
        if (!withheldDelete) {
          holdPrimitiveDeleteTarget = "";
          withheldDelete = { operationId: message.operationId, objectId: message.objectId, serverRevision: message.serverRevision };
          void output("durable-delete-held.json", withheldDelete).catch(error => {
            console.error("Could not record the fixture's held deletion:", error.code ?? "write_failed");
            process.exitCode = 1;
            void stop();
          });
        }
        return;
      }
      if (message.type === "component_topology_changed" && message.serverRevision === withheldDelete?.serverRevision) return;
      if (holdNextAck && message.type === "component_structure_applied" && message.requestId) {
        holdNextAck = false;
        void output("held-ack.json", {
          operationId: message.operationId, componentId: message.componentId,
          serverRevision: message.serverRevision,
        }).catch(error => {
          console.error("M2 fixture could not record its owned fault marker:", error.code ?? "write_failed");
          process.exitCode = 1;
          void stop();
        });
      } else if (downstream.readyState === WebSocket.OPEN) downstream.send(data.toString("utf8"));
    });
    downstream.on("close", () => { relaySockets.delete(downstream); upstream.terminate(); });
    upstream.on("close", () => { relaySockets.delete(upstream); downstream.terminate(); });
    downstream.on("error", () => upstream.terminate());
    upstream.on("error", () => downstream.terminate());
  });
  await new Promise((resolve, reject) => {
    relay.once("listening", resolve); relay.once("error", reject);
  });
}

async function stop() {
  if (stopping) return;
  stopping = true;
  peer?.socket.terminate();
  for (const socket of relaySockets) socket.terminate();
  if (relay) await new Promise(resolve => relay.close(resolve));
  await server?.stop();
}

process.once("SIGTERM", () => void stop());
process.once("SIGINT", () => void stop());

try {
  assert(!durableEnabled || primitiveEnabled, "Durable E2E requires the full shared primitive E2E.");
  assert(!durableTransformEnabled || durableEnabled, "Transform recovery E2E requires durable restart E2E.");
  assert(!durableHierarchyEnabled || durableTransformEnabled, "Hierarchy E2E requires the full durable recovery sequence.");
  assert(!durableReparentEnabled || durableHierarchyEnabled, "Reparent E2E requires the full durable recovery sequence.");
  assert(!durableSiblingEnabled || durableReparentEnabled, "Sibling E2E follows restored root placement.");
  await mkdir(evidence, { recursive: true });
  await output("waiting.json", { ready: true });
  const request = await waitJson("request.json");
  assert(/^Assets\/__TeamForgeM2E2E\/[a-f0-9]{32}\.unity$/u.test(request.scenePath),
    "Invalid fixed structure fixture Scene path.");
  assert(/^(?!0{32})[a-f0-9]{32}$/u.test(request.sceneId));
  assert(Array.isArray(request.components) && request.components.length === 1);
  assert(Array.isArray(request.properties) && request.properties.length === 3);
  assert(request.components.every(row => row.objectId === request.objectId));
  assert.equal(request.ownerName, "M2 exact Collider owner");
  assert.deepEqual(request.localPosition, { x: 0, y: 0, z: 0 });
  assert.deepEqual(request.localRotation, { x: 0, y: 0, z: 0, w: 1 });
  assert.deepEqual(request.localScale, { x: 1, y: 1, z: 1 });
  assert.equal(request.primitiveEnabled, primitiveEnabled, "Editor and Node must request the same primitive evidence.");
  assert.equal(request.durableEnabled, durableEnabled, "Editor and Node must request the same durable evidence.");
  assert.equal(request.durableTransformEnabled, durableTransformEnabled,
    "Editor and Node must request the same Transform recovery evidence.");
  assert.equal(request.durableHierarchyEnabled ?? false, durableHierarchyEnabled,
    "Editor and Node must request the same Hierarchy recovery evidence.");
  assert.equal(request.durableReparentEnabled ?? false, durableReparentEnabled,
    "Editor and Node must request the same reparent recovery evidence.");
  assert.equal(request.durableSiblingEnabled ?? false, durableSiblingEnabled,
    "Editor and Node must request the same sibling recovery evidence.");
  const sceneFile = path.join(workspace, "unity-project", request.scenePath);
  const sceneBytes = await boundedRead(sceneFile, 16 * 1024 * 1024);
  const metaBytes = await boundedRead(sceneFile + ".meta", 64 * 1024);
  const fixtureRoot = path.join(evidence, "fixture"), sourceRoot = path.join(fixtureRoot, "source");
  await createUnityProject(sourceRoot, { unityVersion: request.unityVersion,
    assetFiles: { [request.scenePath]: sceneBytes, [request.scenePath + ".meta"]: metaBytes } });
  const projectUuid = randomUUID(), managedRoot = path.join(fixtureRoot, "managed");
  const engine = new ProjectPeerEngine({ managedRoot });
  await engine.ensureProject({ projectId, projectUuid });
  const metadataRoot = engine.metadataRoot(projectUuid);
  const store = new ChunkStore(path.join(metadataRoot, "chunks"));
  const { manifest } = await buildManifest({ projectRoot: sourceRoot, projectUuid, baselineRevision: 1, store });
  const descriptor = createDescriptor({
    projectId, projectUuid, baselineRevision: 1, manifestHash: manifest.manifestHash,
    unityVersion: request.unityVersion, ownerIdentity: generateIdentity("CI structure fixture"),
  });
  for (const [directory, hash, value] of [
    ["manifests", manifest.manifestHash, manifest], ["descriptors", descriptor.descriptorHash, descriptor],
  ]) {
    await mkdir(path.join(metadataRoot, directory), { recursive: true });
    await writeFile(path.join(metadataRoot, directory, hash + ".json"), JSON.stringify(value));
  }
  await writeFile(engine.publishedPointerPath(projectUuid), JSON.stringify({
    schemaVersion: 1, projectUuid, baselineRevision: 1, manifestHash: manifest.manifestHash,
    descriptorHash: descriptor.descriptorHash, ownerKeyId: descriptor.ownerKeyId, approvedAtUnixMs: Date.now(),
  }));
  const serverOptions = {
    host: "127.0.0.1", port: 5083,
    enableComponentPropertySync: true, enableComponentStructureSync: true,
    ...(primitiveEnabled ? { enablePrimitiveTemplateSync: true } : {}),
    ...(durableEnabled ? { durableSessionDatabasePath: path.join(managedRoot, "session-state.sqlite") } : {}),
    componentProjectManagedRoot: managedRoot,
  };
  server = createTeamForgeServer(serverOptions);
  const endpoint = await server.start();
  const url = "ws://127.0.0.1:" + endpoint.port + endpoint.wsPath;
  await startOwnedRelay(url);
  peer = await connectPeer(url);
  const originalAuthorityEpoch = peer.authorityEpoch, durableSessionId = peer.durableSessionId;
  const { descriptorSchemaVersion: _schema, projectId: _project, ...baseline } = descriptor;
  const published = await peer.request(envelope("project_baseline_publish", { userId, ...baseline }));
  assert.equal(published.type, "project_baseline_changed");
  // Retain an admitted catalog before the first Editor connects. The Scene on
  // disk is still the original signed source; legitimate authority snapshots
  // will change its loaded owner and dirty it before Collider admission.
  const seeded = await peer.request(envelope("hierarchy_seed", {
    userId, sceneId: request.sceneId, baseRevision: 0,
    objects: [{
      objectId: request.objectId, name: request.ownerName, parentObjectId: "", siblingIndex: 0,
      localPosition: request.localPosition, localRotation: request.localRotation,
      localScale: request.localScale,
    }],
  }));
  assert.equal(seeded.type, "hierarchy_seed_accepted");
  const admitted = await peer.request(envelope("component_scene_join", {
    sceneId: request.sceneId, scenePath: request.scenePath,
    sceneFileSha256: sha(sceneBytes), sceneMetaSha256: sha(metaBytes),
    baseRevision: seeded.serverRevision, components: request.components, properties: request.properties,
  }));
  assert.equal(admitted.type, "component_snapshot");
  assert.equal(admitted.structureVersion, 1);
  assert.equal(admitted.components.length, 1);
  const initialLease = await peer.request(envelope("lock_request", {
    userId, sceneId: request.sceneId, objectId: request.objectId,
  }));
  assert.equal(initialLease.type, "lock_granted");
  const lateJoinOwnerName = "M2 authoritative owner before Collider join";
  const renamed = await peer.request(envelope("hierarchy_operation", {
    operationId: "ci-m2-peer-before-join-rename", userId,
    kind: "rename_object", sceneId: request.sceneId, objectId: request.objectId,
    baseRevision: admitted.serverRevision, name: lateJoinOwnerName,
  }));
  assert.equal(renamed.type, "hierarchy_applied");
  const lateJoinLocalPosition = { x: 2.25, y: -1.5, z: 3 };
  const moved = await peer.request(envelope("transform_update", {
    operationId: "ci-m2-peer-before-join-transform", userId,
    sceneId: request.sceneId, objectId: request.objectId, baseRevision: renamed.serverRevision,
    localPosition: lateJoinLocalPosition, localRotation: request.localRotation,
    localScale: request.localScale,
  }));
  assert.equal(moved.type, "transform_applied");
  assert.deepEqual(moved.localPosition, lateJoinLocalPosition);
  const released = await peer.request(envelope("lock_release", {
    userId, sceneId: request.sceneId, objectId: request.objectId,
  }));
  assert.equal(released.type, "lock_released");
  const retained = await peer.request(envelope("component_snapshot_request", {
    sceneId: request.sceneId, epoch: admitted.epoch,
  }));
  assert.equal(retained.type, "component_snapshot");
  assert.equal(retained.components.length, 1);
  assert.equal(retained.serverRevision, moved.serverRevision);
  assert.equal(retained.source.sceneFileSha256, sha(sceneBytes));
  assert.equal(retained.source.sceneMetaSha256, sha(metaBytes));
  const localDescriptor = { schemaVersion: 1 };
  for (const field of [
    "projectUuid", "baselineRevision", "manifestHash", "descriptorHash", "unityVersion",
    "teamForgePackageVersion", "realtimeProtocolVersion", "transferProtocolVersion", "manifestSchemaVersion",
  ]) localDescriptor[field] = descriptor[field];
  await output("ready.json", {
    serverAddress: "http://127.0.0.1:5084", projectId, sessionId, descriptor: localDescriptor, sourceSha,
    lateJoinOwnerName, lateJoinLocalPosition, lateJoinServerRevision: retained.serverRevision,
    primitiveEnabled, durableEnabled, durableTransformEnabled, durableHierarchyEnabled, durableReparentEnabled, durableSiblingEnabled,
    ...(durableEnabled ? { authorityEpoch: originalAuthorityEpoch, durableSessionId } : {}),
  });

  let latestHierarchy;
  async function currentSnapshot() {
    peer.socket.terminate();
    peer = await connectPeer(url);
    const hierarchy = await peer.next(value => value.type === "hierarchy_snapshot");
    latestHierarchy = hierarchy;
    const snapshot = await peer.request(envelope("component_scene_join", {
      sceneId: request.sceneId, scenePath: request.scenePath,
      sceneFileSha256: sha(sceneBytes), sceneMetaSha256: sha(metaBytes),
      baseRevision: hierarchy.serverRevision, components: [], properties: [],
    }));
    assert.equal(snapshot.type, "component_snapshot");
    assert.equal(snapshot.structureVersion, 1);
    assert.equal(snapshot.source.sceneFileSha256, sha(sceneBytes));
    assert.equal(snapshot.source.sceneMetaSha256, sha(metaBytes));
    return snapshot;
  }

  const phase = await waitJson("phase.json", value => value.phase === "remote");
  assert.equal(phase.sceneId, request.sceneId);
  assert.equal(phase.objectId, request.objectId);
  assert(/^tf:c:[a-f0-9]{32}$/u.test(phase.componentId));
  let snapshot = await currentSnapshot();
  assert(snapshot.components.some(row => row.componentId === phase.componentId &&
    row.objectId === phase.objectId && row.typeName === "UnityEngine.BoxCollider"));
  const lease = await peer.request(envelope("lock_request", {
    userId, sceneId: request.sceneId, objectId: phase.objectId,
  }));
  assert.equal(lease.type, "lock_granted");
  const remoteId = "tf:c:" + randomUUID().replaceAll("-", "");
  const added = await peer.request(envelope("component_structure_set", {
    operationId: "ci-m2-peer-add-sphere", sceneId: request.sceneId, epoch: snapshot.epoch,
    baseRevision: snapshot.serverRevision, kind: "add_component", objectId: phase.objectId,
    componentId: remoteId, typeName: "UnityEngine.SphereCollider",
    expectedComponentRevision: 0, compensatesOperationId: "",
  }));
  assert.equal(added.type, "component_structure_applied");
  assert(added.components.some(row => row.componentId === remoteId));
  const radius = added.properties.find(row => row.componentId === remoteId && row.propertyPath === "m_Radius");
  assert(radius);
  const radiusCommit = await peer.request(envelope("component_property_set", {
    operationId: "ci-m2-peer-radius", sceneId: request.sceneId, epoch: added.epoch,
    objectId: phase.objectId, componentId: remoteId, typeName: "UnityEngine.SphereCollider",
    propertyPath: "m_Radius", valueKind: "float", value: 1.75, baseRevision: added.serverRevision,
    expectedRevision: radius.serverRevision, expectedValue: radius.value, compensatesOperationId: "",
  }));
  assert.equal(radiusCommit.type, "component_property_applied");
  snapshot = await peer.request(envelope("component_snapshot_request", {
    sceneId: request.sceneId, epoch: added.epoch,
  }));
  const center = snapshot.properties.find(row => row.componentId === phase.componentId && row.propertyPath === "m_Center");
  assert(center);
  const centerCommit = await peer.request(envelope("component_property_set", {
    operationId: "ci-m2-peer-center", sceneId: request.sceneId, epoch: added.epoch,
    objectId: phase.objectId, componentId: phase.componentId, typeName: "UnityEngine.BoxCollider",
    propertyPath: "m_Center", valueKind: "vector3", value: { x: 7, y: 8, z: 9 },
    baseRevision: snapshot.serverRevision, expectedRevision: center.serverRevision,
    expectedValue: center.value, compensatesOperationId: "",
  }));
  assert.equal(centerCommit.type, "component_property_applied");
  await peer.request(envelope("lock_release", { userId, sceneId: request.sceneId, objectId: phase.objectId }));
  await output("peer-result.json", {
    remoteCommitted: true, serverRevision: centerCommit.serverRevision, addedComponentId: remoteId,
  });

  await waitJson("phase.json", value => value.phase === "hold_next_ack");
  holdNextAck = true;
  // Let the Editor become the sole member. Its following disconnects must
  // retain both committed additions and an empty catalog without a live peer.
  await new Promise(resolve => {
    if (peer.socket.readyState === WebSocket.CLOSED) return resolve();
    peer.socket.once("close", resolve);
    peer.socket.terminate();
  });
  await output("fault-ready.json", { ready: true, fault: "origin-structure-commit-ack-loss" });
  let cubeOwnerId, cubeColliderId, sphereOwnerId, sphereColliderId;
  let durableRestartVerified = false, durableTransformVerified = false, durableHierarchyVerified = false;
  let durableReparentVerified = false;
  let durableSiblingVerified = false, durableDeleteVerified = false;
  if (primitiveEnabled) {
    const primitivePhase = await waitJson("phase.json", value => value.phase === "primitive");
    assert.equal(primitivePhase.sceneId, request.sceneId);
    assert(/^tf:[a-f0-9]{32}$/u.test(primitivePhase.objectId));
    assert(/^tf:c:[a-f0-9]{32}$/u.test(primitivePhase.componentId));
    snapshot = await currentSnapshot();
    cubeOwnerId = primitivePhase.objectId;
    cubeColliderId = primitivePhase.componentId;
    const cube = latestHierarchy.objects.find(row => row.objectId === cubeOwnerId && row.sceneId === request.sceneId);
    assert(cube, "The Editor-created primitive must be present in the real Hierarchy snapshot.");
    assert.equal(cube.primitiveTemplate, "cube-v1");
    assert.deepEqual(cube.localPosition, { x: 4, y: 1, z: -2 });
    assert.deepEqual(cube.localScale, { x: 1.5, y: 2, z: 0.75 });
    assert(Math.abs(cube.localRotation.x) < 0.00001 && Math.abs(cube.localRotation.z) < 0.00001);
    assert(Math.abs(cube.localRotation.y - Math.sin(Math.PI / 12)) < 0.00001);
    assert(Math.abs(cube.localRotation.w - Math.cos(Math.PI / 12)) < 0.00001);
    const cubeRows = snapshot.components.filter(row => row.objectId === cubeOwnerId);
    assert.equal(cubeRows.length, 1);
    assert.equal(cubeRows[0].componentId, cubeColliderId);
    assert.equal(cubeRows[0].typeName, "UnityEngine.BoxCollider");
    assert.deepEqual(snapshot.properties.find(row => row.componentId === cubeColliderId &&
      row.propertyPath === "m_Size").value, { x: 2, y: 3, z: 4 });
    sphereOwnerId = "tf:" + randomUUID().replaceAll("-", "");
    const createdSphere = await peer.request(envelope("hierarchy_operation", {
      operationId: "ci-m3-peer-create-sphere", userId, sceneId: request.sceneId,
      componentEpoch: snapshot.epoch, baseRevision: snapshot.serverRevision,
      kind: "create_object", objectId: sphereOwnerId, name: "CI Node shared Sphere",
      parentObjectId: "", siblingIndex: latestHierarchy.objects.filter(row =>
        row.sceneId === request.sceneId && row.parentObjectId === "").length,
      primitiveTemplate: "sphere-v1", localPosition: { x: -3, y: 2, z: 1 },
      localRotation: { x: 0, y: 0, z: 0, w: 1 }, localScale: { x: 1, y: 1, z: 1 },
    }));
    assert.equal(createdSphere.type, "hierarchy_applied");
    const sphereTopology = await peer.next(value => value.type === "component_topology_changed" &&
      value.serverRevision === createdSphere.serverRevision);
    assert.equal(sphereTopology.components.length, 3);
    const sphereRows = sphereTopology.components.filter(row => row.objectId === sphereOwnerId);
    assert.equal(sphereRows.length, 1);
    assert.equal(sphereRows[0].typeName, "UnityEngine.SphereCollider");
    sphereColliderId = sphereRows[0].componentId;
    const sphereRadius = sphereTopology.properties.find(row => row.componentId === sphereColliderId &&
      row.propertyPath === "m_Radius");
    assert(sphereRadius);
    const sphereLease = await peer.request(envelope("lock_request", {
      userId, sceneId: request.sceneId, objectId: sphereOwnerId,
    }));
    assert.equal(sphereLease.type, "lock_granted");
    const sphereEdit = await peer.request(envelope("component_property_set", {
      operationId: "ci-m3-peer-sphere-radius", sceneId: request.sceneId, epoch: sphereTopology.epoch,
      objectId: sphereOwnerId, componentId: sphereColliderId, typeName: "UnityEngine.SphereCollider",
      propertyPath: "m_Radius", valueKind: "float", value: 1.25,
      baseRevision: sphereTopology.serverRevision, expectedRevision: sphereRadius.serverRevision,
      expectedValue: sphereRadius.value, compensatesOperationId: "",
    }));
    assert.equal(sphereEdit.type, "component_property_applied");
    await peer.request(envelope("lock_release", { userId, sceneId: request.sceneId, objectId: sphereOwnerId }));
    // Reconnect must recover the templates and catalog without another live
    // participant. Publish the marker only after this peer really closes.
    await new Promise(resolve => {
      if (peer.socket.readyState === WebSocket.CLOSED) return resolve();
      peer.socket.once("close", resolve);
      peer.socket.terminate();
    });
    await output("primitive-peer-result.json", {
      primitiveVerified: true, cubeObjectId: cubeOwnerId, cubeComponentId: cubeColliderId,
      sphereObjectId: sphereOwnerId, sphereComponentId: sphereColliderId,
      serverRevision: sphereEdit.serverRevision,
    });
    if (durableEnabled) {
      const restartPhase = await waitJson("phase.json", value => value.phase === "durable-restart");
      assert.equal(restartPhase.sceneId, request.sceneId);
      assert.equal(restartPhase.objectId, cubeOwnerId);
      assert.equal(restartPhase.componentId, cubeColliderId);
      assert.equal(peer.socket.readyState, WebSocket.CLOSED,
        "The Node peer must close before the last Editor requests a durable restart.");
      const closeDeadline = Date.now() + 5000;
      while (relaySockets.size && Date.now() < closeDeadline) await delay(25);
      assert.equal(relaySockets.size, 0, "The Editor must disconnect its owned relay before restart.");
      // Stop the actual authority, close SQLite, and construct a fresh server.
      // Its approved Project source and database are the same exact files;
      // no in-memory Session or operation result is carried across this boundary.
      await server.stop();
      server = createTeamForgeServer(serverOptions);
      const restartedEndpoint = await server.start();
      assert.equal(restartedEndpoint.port, endpoint.port);
      assert.equal(restartedEndpoint.wsPath, endpoint.wsPath);
      snapshot = await currentSnapshot();
      const restoredProjects = await peer.next(value => value.type === "project_registry_snapshot");
      assert.deepEqual(restoredProjects.baseline, published.baseline);
      assert.deepEqual(restoredProjects.peers, []);
      const restoredTransforms = await peer.next(value => value.type === "transform_snapshot");
      assert.deepEqual(restoredTransforms.locks, [], "A durable restart must not restore dead socket leases.");
      assert.notEqual(peer.authorityEpoch, originalAuthorityEpoch);
      assert.equal(peer.durableSessionId, durableSessionId);
      assert.equal(snapshot.epoch, peer.authorityEpoch);
      assert(snapshot.serverRevision >= sphereEdit.serverRevision);
      assert.equal(snapshot.components.length, 3);
      assert(snapshot.components.some(row => row.objectId === request.objectId && row.typeName === "UnityEngine.SphereCollider"));
      for (const [ownerId, componentId, template, typeName, position] of [
        [cubeOwnerId, cubeColliderId, "cube-v1", "UnityEngine.BoxCollider", { x: 4, y: 1, z: -2 }],
        [sphereOwnerId, sphereColliderId, "sphere-v1", "UnityEngine.SphereCollider", { x: -3, y: 2, z: 1 }],
      ]) {
        const owner = latestHierarchy.objects.find(row => row.objectId === ownerId);
        assert(owner, "Restart must restore each exact logical primitive owner.");
        assert.equal(owner.primitiveTemplate, template);
        assert.deepEqual(owner.localPosition, position);
        const components = snapshot.components.filter(row => row.objectId === ownerId);
        assert.equal(components.length, 1, "Restart must not duplicate primitive Colliders.");
        assert.equal(components[0].componentId, componentId);
        assert.equal(components[0].typeName, typeName);
      }
      assert.deepEqual(snapshot.properties.find(row => row.componentId === cubeColliderId &&
        row.propertyPath === "m_Size").value, { x: 2, y: 3, z: 4 });
      assert.equal(snapshot.properties.find(row => row.componentId === sphereColliderId &&
        row.propertyPath === "m_Radius").value, 1.25);
      const authorityEpoch = peer.authorityEpoch;
      await new Promise(resolve => {
        peer.socket.once("close", resolve);
        peer.socket.terminate();
      });
      await output("durable-restart-result.json", {
        durableRestartVerified: true, sourceSha, oldEpoch: originalAuthorityEpoch,
        newEpoch: authorityEpoch, durableSessionId, serverRevision: snapshot.serverRevision,
        cubeObjectId: cubeOwnerId, cubeComponentId: cubeColliderId,
        sphereObjectId: sphereOwnerId, sphereComponentId: sphereColliderId,
      });
      const resubmitPhase = await waitJson("phase.json", value => value.phase === "durable-resubmit");
      assert.equal(resubmitPhase.sceneId, request.sceneId);
      assert.equal(resubmitPhase.objectId, sphereOwnerId);
      assert.equal(resubmitPhase.componentId, sphereColliderId);
      const restoredRevision = snapshot.serverRevision;
      snapshot = await currentSnapshot();
      assert.equal(peer.authorityEpoch, authorityEpoch);
      assert.equal(peer.durableSessionId, durableSessionId);
      assert.equal(snapshot.components.filter(row => row.objectId === sphereOwnerId).length, 1);
      const resubmittedRadius = snapshot.properties.find(row => row.componentId === sphereColliderId &&
        row.propertyPath === "m_Radius");
      assert.equal(resubmittedRadius.value, 2.5,
        "Explicit recovery resubmission must become the shared state seen by another participant.");
      assert(resubmittedRadius.serverRevision > restoredRevision);
      await new Promise(resolve => {
        peer.socket.once("close", resolve);
        peer.socket.terminate();
      });
      durableRestartVerified = true;
      await output("durable-resubmit-result.json", {
        durableResubmitVerified: true, sourceSha, authorityEpoch,
        componentId: sphereColliderId, value: resubmittedRadius.value, serverRevision: resubmittedRadius.serverRevision,
      });
      if (durableTransformEnabled) {
        const transformPhase = await waitJson("phase.json", value => value.phase === "durable-transform-resubmit");
        assert.equal(transformPhase.sceneId, request.sceneId);
        assert.equal(transformPhase.objectId, cubeOwnerId);
        assert.equal(transformPhase.componentId, cubeColliderId);
        snapshot = await currentSnapshot();
        assert.equal(peer.authorityEpoch, authorityEpoch);
        assert.equal(peer.durableSessionId, durableSessionId);
        const transforms = await peer.next(value => value.type === "transform_snapshot");
        const sharedCube = transforms.transforms.find(row => row.objectId === cubeOwnerId && row.sceneId === request.sceneId);
        assert(sharedCube, "Explicit Transform recovery must be visible in another participant's snapshot.");
        assert.deepEqual(sharedCube.localPosition, { x: 6, y: 1, z: -2 });
        assert.deepEqual(sharedCube.localScale, { x: 1.5, y: 2, z: 0.75 });
        assert(Math.abs(sharedCube.localRotation.x) < 0.00001 && Math.abs(sharedCube.localRotation.z) < 0.00001);
        assert(Math.abs(sharedCube.localRotation.y - Math.sin(Math.PI / 12)) < 0.00001);
        assert(Math.abs(sharedCube.localRotation.w - Math.cos(Math.PI / 12)) < 0.00001);
        assert(sharedCube.serverRevision > resubmittedRadius.serverRevision);
        assert.equal(snapshot.serverRevision, sharedCube.serverRevision);
        const hierarchyCube = latestHierarchy.objects.find(row => row.objectId === cubeOwnerId);
        assert.deepEqual(hierarchyCube.localPosition, sharedCube.localPosition);
        assert.equal(snapshot.components.filter(row => row.objectId === cubeOwnerId).length, 1);
        await new Promise(resolve => { peer.socket.once("close", resolve); peer.socket.terminate(); });
        durableTransformVerified = true;
        await output("durable-transform-result.json", {
          durableTransformVerified, sourceSha, authorityEpoch, durableSessionId,
          objectId: cubeOwnerId, localPosition: sharedCube.localPosition,
          localRotation: sharedCube.localRotation, localScale: sharedCube.localScale,
          serverRevision: sharedCube.serverRevision,
        });
      }
      if (durableHierarchyEnabled) {
        const phase = await waitJson("phase.json", value => value.phase === "durable-hierarchy-before");
        assert.equal(phase.sceneId, request.sceneId);
        assert.equal(phase.objectId, request.objectId);
        snapshot = await currentSnapshot();
        assert.equal(peer.authorityEpoch, authorityEpoch);
        assert.equal(peer.durableSessionId, durableSessionId);
        const before = latestHierarchy.objects.find(row => row.sceneId === request.sceneId && row.objectId === request.objectId);
        assert(before, "The signed original owner must be visible to the second participant.");
        assert.equal(before.name, lateJoinOwnerName, "The archived rename must not be replayed on reconnect.");
        await output("durable-hierarchy-ready.json", {
          sourceSha, authorityEpoch, durableSessionId, objectId: before.objectId, name: before.name,
          hierarchyRevision: before.hierarchyRevision, serverRevision: snapshot.serverRevision,
        });
        const committed = await peer.next(value => value.type === "hierarchy_applied" &&
          value.kind === "rename_object" && value.objectId === request.objectId);
        assert.equal(committed.sceneId, request.sceneId);
        assert.equal(committed.changedObjects.length, 1);
        assert.equal(committed.changedObjects[0].name, recoveredOwnerName);
        assert(committed.serverRevision > snapshot.serverRevision);
        snapshot = await currentSnapshot();
        const owner = latestHierarchy.objects.find(row => row.sceneId === request.sceneId && row.objectId === request.objectId);
        assert.equal(owner?.name, recoveredOwnerName);
        assert.equal(owner.hierarchyRevision, committed.serverRevision);
        assert.equal(snapshot.components.filter(row => row.objectId === request.objectId).length, 1,
          "A reviewed rename must preserve the owner's exact Collider topology.");
        durableHierarchyVerified = true;
        await output("durable-hierarchy-result.json", {
          durableHierarchyVerified, sourceSha, authorityEpoch, durableSessionId, objectId: owner.objectId,
          name: owner.name, operationId: committed.operationId, serverRevision: committed.serverRevision,
        });
      }
      if (durableReparentEnabled) {
        const phase = await waitJson("phase.json", value => value.phase === "durable-reparent-before");
        assert.equal(phase.sceneId, request.sceneId);
        assert.equal(phase.objectId, sphereOwnerId);
        snapshot = await currentSnapshot();
        assert.equal(peer.authorityEpoch, authorityEpoch);
        assert.equal(peer.durableSessionId, durableSessionId);
        const transforms = await peer.next(value => value.type === "transform_snapshot");
        const before = latestHierarchy.objects.find(row => row.objectId === sphereOwnerId && row.sceneId === request.sceneId);
        assert(before, "The exact original Sphere must survive Session recovery.");
        assert.equal(before.parentObjectId, "", "The archived placement must not be sent on reconnect.");
        assert.deepEqual(before.localPosition, { x: -3, y: 2, z: 1 });
        const trackedChild = transforms.transforms.find(row => row.objectId === sphereOwnerId && row.sceneId === request.sceneId);
        await output("durable-reparent-ready.json", {
          sourceSha, authorityEpoch, durableSessionId, objectId: before.objectId, parentObjectId: before.parentObjectId,
          localPosition: before.localPosition, hierarchyRevision: before.hierarchyRevision,
          transformRevision: trackedChild?.serverRevision ?? 0, serverRevision: snapshot.serverRevision,
        });

        const committed = await peer.next(value => value.type === "hierarchy_applied" &&
          value.kind === "reparent_object" && value.objectId === sphereOwnerId);
        assert.equal(committed.sceneId, request.sceneId);
        assert(committed.serverRevision > snapshot.serverRevision);
        const moved = committed.changedObjects.find(row => row.objectId === sphereOwnerId);
        assert.equal(moved?.parentObjectId, cubeOwnerId);
        assert.equal(moved.siblingIndex, 0);
        assert.deepEqual(moved.localPosition, { x: 0.25, y: 0.5, z: 0.75 });
        assert.deepEqual(moved.localRotation, { x: 0, y: 0, z: 0, w: 1 });
        assert.deepEqual(moved.localScale, { x: 1, y: 1, z: 1 });
        snapshot = await currentSnapshot();
        const sharedChild = latestHierarchy.objects.find(row => row.sceneId === request.sceneId && row.objectId === sphereOwnerId);
        const unaffectedParent = latestHierarchy.objects.find(row => row.sceneId === request.sceneId && row.objectId === cubeOwnerId);
        assert.deepEqual(sharedChild, moved);
        assert.deepEqual(unaffectedParent.localPosition, { x: 6, y: 1, z: -2 });
        assert.equal(snapshot.components.filter(row => row.objectId === sphereOwnerId).length, 1);
        durableReparentVerified = true;
        await output("durable-reparent-result.json", {
          durableReparentVerified, sourceSha, authorityEpoch, durableSessionId, objectId: sphereOwnerId,
          parentObjectId: cubeOwnerId, siblingIndex: moved.siblingIndex, localPosition: moved.localPosition,
          localRotation: moved.localRotation, localScale: moved.localScale, operationId: committed.operationId,
          serverRevision: committed.serverRevision,
        });
      }
      if (durableSiblingEnabled) {
        const phase = await waitJson("phase.json", value => value.phase === "durable-sibling-before");
        assert.equal(phase.sceneId, request.sceneId);
        assert.equal(phase.objectId, request.objectId);
        snapshot = await currentSnapshot();
        assert.equal(peer.authorityEpoch, authorityEpoch);
        assert.equal(peer.durableSessionId, durableSessionId);
        const group = () => latestHierarchy.objects.filter(row => row.sceneId === request.sceneId && !row.parentObjectId)
          .sort((left, right) => left.siblingIndex - right.siblingIndex);
        const before = group();
        const beforeIds = [request.objectId, cubeOwnerId, sphereOwnerId];
        const afterIds = [cubeOwnerId, sphereOwnerId, request.objectId];
        assert.deepEqual(before.map(row => row.objectId), beforeIds,
          "Rejoining must restore shared root order without publishing the archived move.");
        const tracked = async () => (await peer.next(value => value.type === "transform_snapshot")).transforms
          .filter(row => row.sceneId === request.sceneId && beforeIds.includes(row.objectId))
          .sort((left, right) => left.objectId.localeCompare(right.objectId));
        const beforeTransforms = await tracked();
        const beforeRecord = { sourceSha, authorityEpoch, durableSessionId, objectId: request.objectId,
          parentObjectId: "", order: beforeIds, hierarchyRevision: before[0].hierarchyRevision, serverRevision: snapshot.serverRevision };
        await output("durable-sibling-ready.json", beforeRecord);
        const committed = await peer.next(value => value.type === "hierarchy_applied" &&
          value.kind === "reorder_sibling" && value.objectId === request.objectId);
        assert.equal(committed.sceneId, request.sceneId);
        assert.equal(committed.serverRevision, beforeRecord.serverRevision + 1);
        assert.deepEqual(committed.deletedObjectIds, []);
        assert.deepEqual([...committed.changedObjects].sort((left, right) => left.siblingIndex - right.siblingIndex)
          .map(row => row.objectId), afterIds);
        snapshot = await currentSnapshot();
        const after = group();
        assert.deepEqual(after.map(row => row.objectId), afterIds);
        assert.deepEqual(after.map(row => row.siblingIndex), [0, 1, 2]);
        assert.deepEqual(after.map(row => row.hierarchyRevision), afterIds.map(() => committed.serverRevision));
        assert.deepEqual(await tracked(), beforeTransforms, "Sibling ordering must not publish a Transform update.");
        assert.equal(snapshot.components.length, 3);
        await output("durable-sibling-result.json", { ...beforeRecord, order: afterIds,
          hierarchyRevision: committed.serverRevision, serverRevision: committed.serverRevision,
          operationId: committed.operationId, transformUnchanged: true, durableSiblingVerified: true });

        const arm = await waitJson("phase.json", value => value.phase === "durable-sibling-concurrent-arm");
        assert.equal(arm.sceneId, request.sceneId);
        assert.equal(arm.objectId, cubeOwnerId);
        const extraId = "tf:" + randomUUID().replaceAll("-", "");
        const extra = await peer.request(envelope("hierarchy_operation", {
          operationId: randomUUID(), userId, sceneId: request.sceneId, kind: "create_object", objectId: extraId,
          name: "M4 ordinary sibling deletion fixture", parentObjectId: "", siblingIndex: afterIds.length,
          baseRevision: snapshot.serverRevision, localPosition: { x: 0, y: 0, z: 0 },
          localRotation: { x: 0, y: 0, z: 0, w: 1 }, localScale: { x: 1, y: 1, z: 1 },
        }));
        assert.equal(extra.type, "hierarchy_applied");
        assert.equal(extra.changedObjects.find(row => row.objectId === extraId)?.siblingIndex, afterIds.length);
        const draftLock = await peer.request(envelope("lock_request", { userId, sceneId: request.sceneId, objectId: cubeOwnerId }));
        assert.equal(draftLock.type, "lock_granted");
        const concurrent = { sourceSha, authorityEpoch, durableSessionId, movedObjectId: cubeOwnerId, deletedObjectId: extraId,
          beforeOrder: [...afterIds, extraId], draftOrder: [...afterIds.slice(1), extraId, cubeOwnerId], serverRevision: extra.serverRevision };
        await output("durable-sibling-concurrent-ready.json", concurrent);
        const collision = await waitJson("phase.json", value => value.phase === "durable-sibling-concurrent-delete");
        assert.equal(collision.sceneId, request.sceneId);
        assert.equal(collision.objectId, extraId);
        const deleted = await peer.request(envelope("hierarchy_operation", {
          operationId: randomUUID(), userId, sceneId: request.sceneId, kind: "delete_object", objectId: extraId,
          baseRevision: extra.serverRevision,
        }));
        assert.equal(deleted.type, "hierarchy_applied");
        assert.deepEqual(deleted.deletedObjectIds, [extraId]);
        assert.deepEqual(deleted.changedObjects, [], "Deleting the last root sends no shifted siblings for the Editor to apply.");
        assert.equal(deleted.serverRevision, extra.serverRevision + 1);
        snapshot = await currentSnapshot();
        assert.deepEqual(group().map(row => row.objectId), afterIds);
        assert.equal(snapshot.components.length, 3);
        durableSiblingVerified = true;
        await output("durable-sibling-concurrent-result.json", { ...concurrent, finalOrder: afterIds,
          serverRevision: deleted.serverRevision, operationId: deleted.operationId });

        const deleteReview = await waitJson("phase.json", value => value.phase === "durable-delete-before");
        assert.equal(deleteReview.sceneId, request.sceneId);
        assert.equal(deleteReview.objectId, cubeOwnerId);
        assert.equal(deleteReview.componentId, cubeColliderId);
        snapshot = await currentSnapshot();
        const cube = latestHierarchy.objects.find(row => row.sceneId === request.sceneId && row.objectId === cubeOwnerId);
        assert.equal(cube?.primitiveTemplate, "cube-v1", "An offline request must not replay automatically.");
        assert(snapshot.components.some(row => row.objectId === cubeOwnerId && row.componentId === cubeColliderId));
        const review = { sourceSha, authorityEpoch, durableSessionId, objectId: cubeOwnerId, componentId: cubeColliderId,
          createdRevision: cube.createdRevision, serverRevision: snapshot.serverRevision };
        holdPrimitiveDeleteTarget = cubeOwnerId;
        await output("durable-delete-before.json", review);

        const removal = await peer.next(value => value.type === "hierarchy_applied" && value.kind === "delete_object" &&
          value.objectId === cubeOwnerId);
        assert.equal(removal.componentTopologyChanged, true);
        assert.deepEqual(removal.deletedObjectIds, [cubeOwnerId]);
        assert.equal(removal.serverRevision, review.serverRevision + 1);
        const topology = await peer.next(value => value.type === "component_topology_changed" && value.serverRevision === removal.serverRevision);
        assert(topology.tombstones.some(row => row.componentId === cubeColliderId && row.objectId === cubeOwnerId &&
          row.serverRevision === removal.serverRevision));
        snapshot = await currentSnapshot();
        assert(latestHierarchy.tombstones.some(row => row.objectId === cubeOwnerId && row.deletedRevision === removal.serverRevision));
        assert(!latestHierarchy.objects.some(row => row.objectId === cubeOwnerId));
        assert(!snapshot.components.some(row => row.componentId === cubeColliderId));
        assert.equal(snapshot.components.length, 2);
        durableDeleteVerified = true;
        await output("durable-delete-result.json", { ...review, serverRevision: removal.serverRevision,
          operationId: removal.operationId, colliderTombstone: true, hierarchyTombstone: true });
      }
    }
  }
  const result = await waitJson("result.json", value => value.passed === true);
  assert.equal(result.sourceSha, sourceSha);
  for (const field of [
    "logicalAddRemove", "multipleSameType", "propertyEdit", "saveReopenBinding",
    "conditionalUndoRedo", "reconnectRecovery", "pendingAckLossRecovery",
  ]) assert.equal(result[field], true, "Editor evidence missing " + field);
  if (primitiveEnabled) {
    for (const field of ["primitiveCreate", "primitiveRemoteApply", "primitiveColliderEdit", "primitiveReconnectDelete"])
      assert.equal(result[field], true, "Editor primitive evidence missing " + field);
  }
  if (durableEnabled) assert.equal(result.durableRestartVerified, true, "Editor did not verify actual durable restart recovery.");
  if (durableTransformEnabled) assert.equal(result.durableTransformVerified, true,
    "Editor did not verify explicit Transform recovery against the restarted authority.");
  if (durableHierarchyEnabled) assert.equal(result.durableHierarchyVerified, true,
    "Editor did not verify the exact reviewed Hierarchy rename and native application.");
  if (durableReparentEnabled) assert.equal(result.durableReparentVerified, true,
    "Editor did not verify the exact reviewed reparent and native application.");
  if (durableSiblingEnabled) assert.equal(result.durableSiblingVerified, true,
    "Editor did not verify the exact reviewed sibling reorder and native application.");
  if (durableSiblingEnabled) assert.equal(result.durableDeleteVerified, true,
    "Editor did not recover the accepted deletion after the origin lost its receipt.");
  snapshot = await currentSnapshot();
  assert.equal(snapshot.components.length, 1, "Final post-empty re-add must contain exactly one Collider.");
  assert.equal(snapshot.components[0].typeName, "UnityEngine.SphereCollider");
  assert.equal(snapshot.properties.length, 3);
  assert.equal(snapshot.properties.find(row => row.propertyPath === "m_Radius").value, 0.5);
  assert(snapshot.tombstones.length >= 4, "Removed Component identities must remain tombstoned.");
  assert(!snapshot.tombstones.some(row => row.componentId === snapshot.components[0].componentId));
  if (primitiveEnabled) {
    for (const ownerId of [cubeOwnerId, sphereOwnerId]) {
      assert(!latestHierarchy.objects.some(row => row.objectId === ownerId),
        "A fresh late join must observe both primitive deletions.");
      assert(!snapshot.components.some(row => row.objectId === ownerId),
        "A primitive deletion must remove its Collider from the same authoritative state.");
      assert(snapshot.tombstones.some(row => row.objectId === ownerId),
        "The removed primitive Collider must leave its exact tombstone.");
    }
  }
  await output("fixture-result.json", {
    passed: true, evidenceClass: "one-unity-editor-plus-node-peer", sourceSha,
    unityVersion: request.unityVersion, remoteCommitted: true,
    ...(primitiveEnabled ? { primitiveVerified: true } : {}),
    ...(durableEnabled ? { durableRestartVerified } : {}),
    ...(durableTransformEnabled ? { durableTransformVerified } : {}),
    ...(durableHierarchyEnabled ? { durableHierarchyVerified } : {}),
    ...(durableReparentEnabled ? { durableReparentVerified } : {}),
    ...(durableSiblingEnabled ? { durableSiblingVerified } : {}),
    ...(durableSiblingEnabled ? { durableDeleteVerified } : {}),
  });
  await stop();
} catch (error) {
  if (!stopping) {
    await output("failure.json", { passed: false, reason: String(error.message).slice(0, 2048) }).catch(() => {});
    console.error("Component structure E2E fixture failed:", error.message);
    process.exitCode = 1;
  }
  await stop();
}
