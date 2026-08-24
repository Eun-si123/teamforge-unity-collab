import fs from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";

const endpoint = process.env.TEAMFORGE_CI_WS_URL ?? "ws://127.0.0.1:5080/ws";
const outputDir = path.resolve(process.cwd(), "test-results", "lease-stall-e2e");
const readyPath = path.join(outputDir, "peer-ready.json");
const targetPath = path.join(outputDir, "peer-target.json");
const expiredPath = path.join(outputDir, "peer-saw-unity-lease-expire.json");
const takeoverPath = path.join(outputDir, "peer-takeover-transform.json");
const releasePath = path.join(outputDir, "peer-release.json");
const recoveryPath = path.join(outputDir, "peer-saw-unity-recovery-transform.json");
const unexpectedPath = path.join(outputDir, "unexpected-unity-transform-during-peer-lock.json");

const unityUserId = "ci-lease-stall-unity-a";
const peerUserId = "ci-lease-stall-peer-b";
const projectId = "ci-lease-stall-project";
const sessionId = "ci-lease-stall-session";

fs.mkdirSync(outputDir, { recursive: true });
for (const candidate of [readyPath, targetPath, expiredPath, takeoverPath, releasePath, recoveryPath, unexpectedPath]) {
  fs.rmSync(candidate, { force: true });
}

const socket = new WebSocket(endpoint);
let target = null;
let latestRevision = 0;
let peerOwns = false;
let takeoverRequested = false;
let peerApplied = false;
let peerReleased = false;
let renewalTimer = null;
let releaseTimer = null;
let renewalSequence = 0;
let shuttingDown = false;
const inbox = [];
let wake = null;

const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
const isTarget = (message) => Boolean(target && message?.sceneId === target.sceneId && message?.objectId === target.objectId);

function send(message) {
  if (socket.readyState !== WebSocket.OPEN) throw new Error("lease-stall peer socket is not open");
  socket.send(JSON.stringify(message));
}

function stopRenewal() {
  if (renewalTimer) {
    clearInterval(renewalTimer);
    renewalTimer = null;
  }
}

function startRenewal() {
  stopRenewal();
  renewalTimer = setInterval(() => {
    if (!peerOwns || !target || shuttingDown || socket.readyState !== WebSocket.OPEN) return;
    renewalSequence += 1;
    send({
      type: "lock_request",
      protocolVersion: 1,
      requestId: `lease-stall-renew-${renewalSequence}`,
      userId: peerUserId,
      ...target,
    });
  }, 550);
  renewalTimer.unref();
}

function requestTakeover() {
  if (!target || peerOwns || takeoverRequested || shuttingDown || socket.readyState !== WebSocket.OPEN) return;
  takeoverRequested = true;
  send({
    type: "lock_request",
    protocolVersion: 1,
    requestId: "lease-stall-peer-takeover",
    userId: peerUserId,
    ...target,
  });
}

function retryTakeover(delayMs = 80) {
  setTimeout(() => {
    takeoverRequested = false;
    requestTakeover();
  }, delayMs).unref();
}

function publishTakeoverTransform() {
  send({
    type: "transform_update",
    protocolVersion: 1,
    requestId: "lease-stall-peer-transform-request",
    operationId: "lease-stall-peer-transform-op",
    userId: peerUserId,
    ...target,
    baseRevision: latestRevision,
    localPosition: { x: 80, y: 90, z: 100 },
    localRotation: { x: 0, y: 0, z: 0, w: 1 },
    localScale: { x: 1, y: 1, z: 1 },
  });
}

function scheduleRelease() {
  if (releaseTimer || shuttingDown) return;
  releaseTimer = setTimeout(() => {
    releaseTimer = null;
    if (!peerOwns || !target || socket.readyState !== WebSocket.OPEN) return;
    stopRenewal();
    send({
      type: "lock_release",
      protocolVersion: 1,
      requestId: "lease-stall-peer-release",
      userId: peerUserId,
      ...target,
    });
  }, 7000);
  releaseTimer.unref();
}

function inspect(message) {
  if (typeof message?.serverRevision === "number") latestRevision = Math.max(latestRevision, message.serverRevision);

  if (message?.type === "lock_state_changed") {
    const state = message.lockState;
    if (!target && state?.ownerUserId === unityUserId) {
      target = { sceneId: state.sceneId, objectId: state.objectId };
      writeJson(targetPath, {
        observedAt: new Date().toISOString(),
        ...target,
        unityConnectionId: state.ownerConnectionId,
      });
    }
  }

  if (message?.type === "transform_applied" && isTarget(message)) {
    if (message.userId === unityUserId && !peerOwns && !peerReleased) {
      // Initial authorized Unity Transform. The peer now knows this is the target we will steal
      // only after the server reports lease expiry during the deliberate main-thread stall.
    } else if (message.userId === unityUserId && peerOwns) {
      writeJson(unexpectedPath, {
        observedAt: new Date().toISOString(),
        operationId: message.operationId,
        serverRevision: message.serverRevision,
        localPosition: message.localPosition,
      });
    } else if (message.userId === unityUserId && peerReleased) {
      writeJson(recoveryPath, {
        observedAt: new Date().toISOString(),
        operationId: message.operationId,
        serverRevision: message.serverRevision,
        localPosition: message.localPosition,
      });
    }

    if (message.userId === peerUserId && message.operationId === "lease-stall-peer-transform-op") {
      peerApplied = true;
      writeJson(takeoverPath, {
        observedAt: new Date().toISOString(),
        serverRevision: message.serverRevision,
        localPosition: message.localPosition,
      });
      scheduleRelease();
    }
  }

  if (message?.type === "lock_released" && isTarget(message)) {
    if (message.previousOwnerUserId === unityUserId && message.reason === "lease_expired") {
      writeJson(expiredPath, {
        observedAt: new Date().toISOString(),
        reason: message.reason,
        serverRevision: latestRevision,
      });
      requestTakeover();
    } else if (message.previousOwnerUserId === peerUserId) {
      peerOwns = false;
      peerReleased = true;
      stopRenewal();
      writeJson(releasePath, {
        observedAt: new Date().toISOString(),
        reason: message.reason,
        serverRevision: latestRevision,
      });
    }
  }

  if ((message?.type === "lock_denied" || message?.type === "error") &&
      message.requestId === "lease-stall-peer-takeover") {
    takeoverRequested = false;
    retryTakeover();
  }

  if (message?.type === "lock_granted" && message.requestId === "lease-stall-peer-takeover") {
    takeoverRequested = false;
    if (!isTarget(message.lockState) || message.lockState.ownerUserId !== peerUserId) {
      throw new Error(`Invalid lease-stall takeover grant: ${JSON.stringify(message)}`);
    }
    peerOwns = true;
    startRenewal();
    publishTakeoverTransform();
  }
}

socket.on("message", (data) => {
  const message = JSON.parse(data.toString("utf8"));
  inspect(message);
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

async function waitFor(predicate, label, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const index = inbox.findIndex(predicate);
    if (index >= 0) return inbox.splice(index, 1)[0];
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 100);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

const helloRequestId = "lease-stall-peer-hello";
send({
  type: "hello",
  protocolVersion: 1,
  requestId: helloRequestId,
  userName: "CI Lease Stall Peer B",
  userId: peerUserId,
  userColor: "#42A5F5",
  projectId,
  sessionId,
  supportsPresence: true,
  supportsTransformSync: true,
  supportsHierarchySync: true,
  supportsProjectTransfer: false,
});
const ack = await waitFor((message) => message?.type === "hello_ack" && message.requestId === helloRequestId, "hello_ack");
await waitFor((message) => message?.type === "presence_snapshot", "presence_snapshot");
await waitFor((message) => message?.type === "hierarchy_snapshot", "hierarchy_snapshot");
const transformSnapshot = await waitFor((message) => message?.type === "transform_snapshot", "transform_snapshot");
latestRevision = transformSnapshot.serverRevision ?? 0;

send({
  type: "presence_update",
  protocolVersion: 1,
  requestId: "lease-stall-peer-presence",
  userId: peerUserId,
  sceneId: "",
  sceneName: "",
  selectedObjectId: "",
  selectedObjectName: "",
  hasSceneView: false,
  cameraPosition: { x: 0, y: 0, z: 0 },
  cameraRotation: { x: 0, y: 0, z: 0, w: 1 },
  cameraPivot: { x: 0, y: 0, z: 0 },
  cameraSize: 10,
  cameraOrthographic: false,
  activity: "Lease Stall Ready",
});
await waitFor((message) => message?.type === "presence_updated" && message?.presence?.userId === peerUserId, "presence update");
writeJson(readyPath, {
  readyAt: new Date().toISOString(),
  connectionId: ack.connectionId,
  endpoint,
  projectId,
  sessionId,
  mode: "unity-main-thread-lease-stall",
});
console.info(`CI lease-stall peer ready at ${endpoint}.`);

function stop() {
  if (shuttingDown) return;
  shuttingDown = true;
  stopRenewal();
  if (releaseTimer) clearTimeout(releaseTimer);
  try { socket.close(); } catch {}
  setTimeout(() => process.exit(0), 50).unref();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
socket.on("close", () => {
  stopRenewal();
  if (!shuttingDown) {
    console.error("CI lease-stall peer WebSocket closed unexpectedly");
    process.exitCode = 1;
  }
});
setInterval(() => {}, 60000);
