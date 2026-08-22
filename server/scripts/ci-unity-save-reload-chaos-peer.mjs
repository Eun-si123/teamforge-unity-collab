import fs from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";

const endpoint = process.env.TEAMFORGE_CI_WS_URL ?? "ws://127.0.0.1:5080/ws";
const outputDir = path.resolve(process.cwd(), "test-results", "save-reload-e2e");
const readyPath = path.join(outputDir, "peer-ready.json");
const firstPath = path.join(outputDir, "peer-first-authoritative-transform.json");
const secondPath = path.join(outputDir, "peer-second-authoritative-transform.json");
const targetPath = path.join(outputDir, "peer-target.json");
const unityUserId = "ci-save-reload-unity-a";
const peerUserId = "ci-save-reload-peer-b";
const projectId = "ci-save-reload-project";
const sessionId = "ci-save-reload-session";

fs.mkdirSync(outputDir, { recursive: true });
for (const file of [readyPath, firstPath, secondPath, targetPath]) fs.rmSync(file, { force: true });

const socket = new WebSocket(endpoint);
const inbox = [];
let wake = null;
let target = null;
let latestRevision = 0;
let firstApplied = false;
let secondApplied = false;
let takeoverInFlight = false;
let shuttingDown = false;

const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
const isTarget = (message) => Boolean(target && message?.sceneId === target.sceneId && message?.objectId === target.objectId);

function send(message) {
  if (socket.readyState !== WebSocket.OPEN) throw new Error("save/reload peer socket is not open");
  socket.send(JSON.stringify(message));
}

function requestTakeover(phase) {
  if (!target || takeoverInFlight || shuttingDown) return;
  takeoverInFlight = true;
  send({
    type: "lock_request",
    protocolVersion: 1,
    requestId: `save-reload-${phase}-takeover`,
    userId: peerUserId,
    ...target,
  });
}

function publishAndRelease(phase, position) {
  send({
    type: "transform_update",
    protocolVersion: 1,
    requestId: `save-reload-${phase}-transform-request`,
    operationId: `save-reload-${phase}-transform-op`,
    userId: peerUserId,
    ...target,
    baseRevision: latestRevision,
    localPosition: position,
    localRotation: { x: 0, y: 0, z: 0, w: 1 },
    localScale: { x: 1, y: 1, z: 1 },
  });
}

socket.on("message", (data) => {
  const message = JSON.parse(data.toString("utf8"));
  if (typeof message?.serverRevision === "number") latestRevision = Math.max(latestRevision, message.serverRevision);

  if (message?.type === "lock_state_changed") {
    const lockState = message.lockState;
    if (!target && lockState?.ownerUserId === unityUserId) {
      target = { sceneId: lockState.sceneId, objectId: lockState.objectId };
      writeJson(targetPath, { observedAt: new Date().toISOString(), ...target });
    }
  }

  if (message?.type === "lock_released" && isTarget(message) && message.previousOwnerUserId === unityUserId && !firstApplied) {
    requestTakeover("first");
  }

  if (message?.type === "lock_granted" && message.requestId === "save-reload-first-takeover") {
    takeoverInFlight = false;
    publishAndRelease("first", { x: 20, y: 30, z: 40 });
  }
  if (message?.type === "lock_granted" && message.requestId === "save-reload-second-takeover") {
    takeoverInFlight = false;
    publishAndRelease("second", { x: 80, y: 90, z: 100 });
  }

  if (message?.type === "transform_applied" && isTarget(message) && message.userId === peerUserId) {
    if (message.operationId === "save-reload-first-transform-op") {
      firstApplied = true;
      writeJson(firstPath, {
        observedAt: new Date().toISOString(),
        serverRevision: message.serverRevision,
        localPosition: message.localPosition,
      });
      send({
        type: "lock_release", protocolVersion: 1,
        requestId: "save-reload-first-release", userId: peerUserId, ...target,
      });
    } else if (message.operationId === "save-reload-second-transform-op") {
      secondApplied = true;
      writeJson(secondPath, {
        observedAt: new Date().toISOString(),
        serverRevision: message.serverRevision,
        localPosition: message.localPosition,
      });
      send({
        type: "lock_release", protocolVersion: 1,
        requestId: "save-reload-second-release", userId: peerUserId, ...target,
      });
    }
  }

  if (message?.type === "presence_left" && message.userId === unityUserId && firstApplied && !secondApplied) {
    // Unity deliberately disconnected while its Scene was dirty. Wait a beat for server lock cleanup,
    // then publish a new authoritative state before Unity reconnects.
    setTimeout(() => requestTakeover("second"), 100).unref();
  }

  inbox.push(message);
  if (wake) {
    const current = wake;
    wake = null;
    current();
  }
});

await new Promise((resolve, reject) => {
  socket.once("open", resolve);
  socket.once("error", reject);
});

async function waitFor(predicate, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const index = inbox.findIndex(predicate);
    if (index >= 0) return inbox.splice(index, 1)[0];
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 100);
      const onWake = () => { clearTimeout(timer); resolve(); };
      wake = onWake;
    });
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const helloRequestId = "save-reload-peer-hello";
send({
  type: "hello", protocolVersion: 1, requestId: helloRequestId,
  userName: "CI Save Reload Peer B", userId: peerUserId, userColor: "#42A5F5",
  projectId, sessionId,
  supportsPresence: true, supportsTransformSync: true,
  supportsHierarchySync: true, supportsProjectTransfer: false,
});
const ack = await waitFor((m) => m?.type === "hello_ack" && m.requestId === helloRequestId, "hello acknowledgement");
await waitFor((m) => m?.type === "presence_snapshot", "presence snapshot");
await waitFor((m) => m?.type === "hierarchy_snapshot", "hierarchy snapshot");
const transformSnapshot = await waitFor((m) => m?.type === "transform_snapshot", "transform snapshot");
latestRevision = transformSnapshot.serverRevision ?? 0;
writeJson(readyPath, { readyAt: new Date().toISOString(), connectionId: ack.connectionId, endpoint, projectId, sessionId });
console.info(`CI save/reload peer ready at ${endpoint}`);

function stop() {
  if (shuttingDown) return;
  shuttingDown = true;
  try { socket.close(); } catch {}
  setTimeout(() => process.exit(0), 50).unref();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
socket.on("close", () => {
  if (!shuttingDown) {
    console.error("CI save/reload peer WebSocket closed unexpectedly");
    process.exitCode = 1;
  }
});
setInterval(() => {}, 60_000);
