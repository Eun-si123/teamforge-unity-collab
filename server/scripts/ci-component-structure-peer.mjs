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
const deadline = Date.now() + 20 * 60_000;
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
let server, relay, peer, sequence = 0, stopping = false, holdNextAck = false;
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
  return { socket, next, async request(value) {
    const answer = next(row => row.requestId === value.requestId);
    socket.send(JSON.stringify(value));
    const result = await answer;
    assert.notEqual(result.type, "error", JSON.stringify(result));
    assert.notEqual(result.type, "component_property_rejected", JSON.stringify(result));
    assert.notEqual(result.type, "component_structure_rejected", JSON.stringify(result));
    return result;
  } };
}

async function connectPeer(url) {
  const connected = await client(url);
  const acknowledgement = await connected.request(envelope("hello", {
    projectId, sessionId, userId, userName: "CI M2 Node peer", userColor: "#AABBCC",
    supportsPresence: true, supportsTransformSync: true, supportsHierarchySync: true,
    supportsProjectTransfer: true, supportsComponentPropertySync: true,
    supportsComponentStructureSync: true,
  }));
  assert.equal(acknowledgement.componentPropertySyncEnabled, true);
  assert.equal(acknowledgement.componentStructureSyncEnabled, true);
  return connected;
}

async function startOwnedRelay(upstreamUrl) {
  // Fault injection owns only this fixture's Editor connection. It never
  // touches NICs, firewalls, remote management or another TeamForge Session.
  relay = new WebSocketServer({ host: "127.0.0.1", port: 5084 });
  relay.on("connection", downstream => {
    const upstream = new WebSocket(upstreamUrl), queued = [];
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
  await mkdir(evidence, { recursive: true });
  await output("waiting.json", { ready: true });
  const request = await waitJson("request.json");
  assert(/^Assets\/__TeamForgeM2E2E\/[a-f0-9]{32}\.unity$/u.test(request.scenePath),
    "Invalid fixed structure fixture Scene path.");
  assert(/^(?!0{32})[a-f0-9]{32}$/u.test(request.sceneId));
  assert(Array.isArray(request.components) && request.components.length === 1);
  assert(Array.isArray(request.properties) && request.properties.length === 3);
  assert(request.components.every(row => row.objectId === request.objectId));
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
  server = createTeamForgeServer({
    host: "127.0.0.1", port: 5083,
    enableComponentPropertySync: true, enableComponentStructureSync: true,
    componentProjectManagedRoot: managedRoot,
  });
  const endpoint = await server.start();
  const url = "ws://127.0.0.1:" + endpoint.port + endpoint.wsPath;
  await startOwnedRelay(url);
  peer = await connectPeer(url);
  const { descriptorSchemaVersion: _schema, projectId: _project, ...baseline } = descriptor;
  const published = await peer.request(envelope("project_baseline_publish", { userId, ...baseline }));
  assert.equal(published.type, "project_baseline_changed");
  const localDescriptor = { schemaVersion: 1 };
  for (const field of [
    "projectUuid", "baselineRevision", "manifestHash", "descriptorHash", "unityVersion",
    "teamForgePackageVersion", "realtimeProtocolVersion", "transferProtocolVersion", "manifestSchemaVersion",
  ]) localDescriptor[field] = descriptor[field];
  await output("ready.json", {
    serverAddress: "http://127.0.0.1:5084", projectId, sessionId, descriptor: localDescriptor, sourceSha,
  });

  async function currentSnapshot() {
    peer.socket.terminate();
    peer = await connectPeer(url);
    const hierarchy = await peer.next(value => value.type === "hierarchy_snapshot");
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
  const result = await waitJson("result.json", value => value.passed === true);
  assert.equal(result.sourceSha, sourceSha);
  for (const field of [
    "logicalAddRemove", "multipleSameType", "propertyEdit", "saveReopenBinding",
    "conditionalUndoRedo", "reconnectRecovery", "pendingAckLossRecovery",
  ]) assert.equal(result[field], true, "Editor evidence missing " + field);
  snapshot = await currentSnapshot();
  assert.equal(snapshot.components.length, 1, "Final post-empty re-add must contain exactly one Collider.");
  assert.equal(snapshot.components[0].typeName, "UnityEngine.SphereCollider");
  assert.equal(snapshot.properties.length, 3);
  assert.equal(snapshot.properties.find(row => row.propertyPath === "m_Radius").value, 0.5);
  assert(snapshot.tombstones.length >= 4, "Removed Component identities must remain tombstoned.");
  assert(!snapshot.tombstones.some(row => row.componentId === snapshot.components[0].componentId));
  await output("fixture-result.json", {
    passed: true, evidenceClass: "one-unity-editor-plus-node-peer", sourceSha,
    unityVersion: request.unityVersion, remoteCommitted: true,
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
