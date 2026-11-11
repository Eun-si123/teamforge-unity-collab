// One real Unity Editor + a Node peer fixture. Uses the production signed
// publication, WebSocket and Collider paths; never counts as two-Editor proof.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
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
const evidence = path.join(workspace, "test-results/component-e2e");
const projectId = "ci-m1-project", sessionId = "ci-m1-session", userId = "ci-m1-peer";
const deadline = Date.now() + 15 * 60_000;
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
let server, relay, peer, sequence = 0, stopping = false, holdNextAck = false;
const relaySockets = new Set();
const envelope = (type, fields = {}) => ({ type, protocolVersion: 1, requestId: `ci-component-${++sequence}`, ...fields });

async function boundedRead(file, maximum) {
  const input = await open(file, "r");
  try {
    const stat = await input.stat();
    assert(stat.isFile() && stat.size > 0 && stat.size <= maximum, "Invalid fixture file size.");
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
  throw new Error("Unity Component E2E fixture timed out or stopped.");
}
async function client(url) {
  const socket = new WebSocket(url), queue = [], waiters = [];
  socket.on("message", data => {
    const row = JSON.parse(data.toString("utf8"));
    const index = waiters.findIndex(x => x.predicate(row));
    if (index < 0) queue.push(row);
    else { const [waiter] = waiters.splice(index, 1); clearTimeout(waiter.timer); waiter.resolve(row); }
  });
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  function next(predicate) {
    const index = queue.findIndex(predicate);
    if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, timer: null };
      waiter.timer = setTimeout(() => { waiters.splice(waiters.indexOf(waiter), 1); reject(new Error("Component CI peer response timeout.")); }, 10_000);
      waiters.push(waiter);
    });
  }
  return { socket, next, async request(value) {
    const answer = next(row => row.requestId === value.requestId);
    socket.send(JSON.stringify(value));
    const result = await answer;
    assert.notEqual(result.type, "error", JSON.stringify(result));
    assert.notEqual(result.type, "component_property_rejected", JSON.stringify(result));
    return result;
  } };
}
async function connectPeer(url) {
  const connected = await client(url);
  const ack = await connected.request(envelope("hello", {
    projectId, sessionId, userId, userName: "CI M1 Node peer", userColor: "#AABBCC",
    supportsPresence: true, supportsTransformSync: true, supportsHierarchySync: true,
    supportsProjectTransfer: true, supportsComponentPropertySync: true,
  }));
  assert.equal(ack.componentPropertySyncEnabled, true);
  return connected;
}
async function startOwnedRelay(upstreamUrl) {
  // Fault injection touches only this fixture's Unity connection. No NIC,
  // firewall, remote management socket or unrelated TeamForge Session changes.
  relay = new WebSocketServer({ host: "127.0.0.1", port: 5082 });
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
      if (holdNextAck && message.type === "component_property_applied" && message.requestId) {
        holdNextAck = false;
        // The server has committed; the origin intentionally never sees this
        // ACK. Recovery must discover the commit through its real snapshot.
        void output("held-ack.json", { operationId: message.operationId, serverRevision: message.serverRevision });
      } else if (downstream.readyState === WebSocket.OPEN) downstream.send(data.toString("utf8"));
    });
    downstream.on("close", () => { relaySockets.delete(downstream); upstream.terminate(); });
    upstream.on("close", () => { relaySockets.delete(upstream); downstream.terminate(); });
    downstream.on("error", () => upstream.terminate());
    upstream.on("error", () => downstream.terminate());
  });
  await new Promise((resolve, reject) => { relay.once("listening", resolve); relay.once("error", reject); });
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
  assert(/^Assets\/__TeamForgeM1E2E\/[a-f0-9]{32}\.unity$/u.test(request.scenePath), "Invalid fixed fixture Scene path.");
  assert(/^(?!0{32})[a-f0-9]{32}$/u.test(request.sceneId));
  assert(Array.isArray(request.components) && request.components.length === 2);
  assert(Array.isArray(request.properties) && request.properties.length === 6);
  const sceneFile = path.join(workspace, "unity-project", request.scenePath);
  const sceneBytes = await boundedRead(sceneFile, 16 * 1024 * 1024);
  const metaBytes = await boundedRead(sceneFile + ".meta", 64 * 1024);
  const fixtureRoot = path.join(evidence, "fixture");
  const sourceRoot = path.join(fixtureRoot, "source");
  await createUnityProject(sourceRoot, { unityVersion: request.unityVersion,
    assetFiles: { [request.scenePath]: sceneBytes, [request.scenePath + ".meta"]: metaBytes } });
  const projectUuid = randomUUID(), managedRoot = path.join(fixtureRoot, "managed");
  const engine = new ProjectPeerEngine({ managedRoot });
  await engine.ensureProject({ projectId, projectUuid });
  const metadataRoot = engine.metadataRoot(projectUuid);
  const store = new ChunkStore(path.join(metadataRoot, "chunks"));
  const { manifest } = await buildManifest({ projectRoot: sourceRoot, projectUuid, baselineRevision: 1, store });
  const descriptor = createDescriptor({ projectId, projectUuid, baselineRevision: 1,
    manifestHash: manifest.manifestHash, unityVersion: request.unityVersion,
    ownerIdentity: generateIdentity("CI Component fixture") });
  for (const [directory, hash, value] of [["manifests", manifest.manifestHash, manifest], ["descriptors", descriptor.descriptorHash, descriptor]]) {
    await mkdir(path.join(metadataRoot, directory), { recursive: true });
    await writeFile(path.join(metadataRoot, directory, hash + ".json"), JSON.stringify(value));
  }
  await writeFile(engine.publishedPointerPath(projectUuid), JSON.stringify({ schemaVersion: 1,
    projectUuid, baselineRevision: 1, manifestHash: manifest.manifestHash,
    descriptorHash: descriptor.descriptorHash, ownerKeyId: descriptor.ownerKeyId, approvedAtUnixMs: Date.now() }));
  server = createTeamForgeServer({ host: "127.0.0.1", port: 5081,
    enableComponentPropertySync: true, componentProjectManagedRoot: managedRoot });
  const endpoint = await server.start(), serverAddress = `http://127.0.0.1:${endpoint.port}`;
  const url = `ws://127.0.0.1:${endpoint.port}${endpoint.wsPath}`;
  await startOwnedRelay(url);
  peer = await connectPeer(url);
  const { descriptorSchemaVersion, projectId: ignoredProjectId, ...baseline } = descriptor;
  const published = await peer.request(envelope("project_baseline_publish", { userId, ...baseline }));
  assert.equal(published.type, "project_baseline_changed");
  const localDescriptor = { schemaVersion: 1 };
  for (const field of ["projectUuid", "baselineRevision", "manifestHash", "descriptorHash", "unityVersion",
    "teamForgePackageVersion", "realtimeProtocolVersion", "transferProtocolVersion", "manifestSchemaVersion"])
    localDescriptor[field] = descriptor[field];
  await output("ready.json", { serverAddress: "http://127.0.0.1:5082", projectId, sessionId, descriptor: localDescriptor });
  const phase = await waitJson("phase.json", value => value.phase === "remote");
  assert.equal(phase.sceneId, request.sceneId);
  assert(request.components.some(row => row.objectId === phase.objectId && row.componentId === phase.componentId && row.typeName === "UnityEngine.BoxCollider"));
  // A fresh Hello obtains the common revision after Unity's local commits.
  peer.socket.terminate();
  peer = await connectPeer(url);
  const hierarchy = await peer.next(value => value.type === "hierarchy_snapshot");
  const snapshot = await peer.request(envelope("component_scene_join", {
    sceneId: request.sceneId, scenePath: request.scenePath,
    sceneFileSha256: sha(sceneBytes), sceneMetaSha256: sha(metaBytes),
    baseRevision: hierarchy.serverRevision, components: request.components, properties: request.properties,
  }));
  assert.equal(snapshot.type, "component_snapshot");
  const target = snapshot.properties.find(row => row.componentId === phase.componentId && row.propertyPath === "m_Center");
  assert(target);
  const lock = await peer.request(envelope("lock_request", { userId, sceneId: request.sceneId, objectId: phase.objectId }));
  assert.equal(lock.type, "lock_granted");
  const committed = await peer.request(envelope("component_property_set", {
    operationId: "ci-m1-peer-center", sceneId: request.sceneId, objectId: phase.objectId,
    componentId: phase.componentId, typeName: "UnityEngine.BoxCollider", propertyPath: "m_Center", valueKind: "vector3",
    value: { x: 7, y: 8, z: 9 }, epoch: snapshot.epoch, baseRevision: snapshot.serverRevision,
    expectedRevision: target.serverRevision, expectedValue: target.value, compensatesOperationId: "",
  }));
  assert.equal(committed.type, "component_property_applied");
  await peer.request(envelope("lock_release", { userId, sceneId: request.sceneId, objectId: phase.objectId }));
  await output("peer-result.json", { remoteCommitted: true, serverRevision: committed.serverRevision });
  await waitJson("phase.json", value => value.phase === "hold_next_ack");
  holdNextAck = true;
  await output("fault-ready.json", { ready: true, fault: "origin-commit-ack-loss" });
  const result = await waitJson("result.json", value => value.passed === true);
  assert.equal(result.passed, true);
  await output("fixture-result.json", { passed: true, evidenceClass: "one-unity-editor-plus-node-peer",
    sourceSha: process.env.GITHUB_SHA ?? "local-uncommitted", unityVersion: request.unityVersion,
    remoteCommitted: true });
  await stop();
} catch (error) {
  if (!stopping) {
    await output("failure.json", { passed: false, reason: String(error.message).slice(0, 2048) }).catch(() => {});
    console.error("Component E2E fixture failed:", error.message);
    process.exitCode = 1;
  }
  await stop();
}
