import fs from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";

const endpoint = process.env.TEAMFORGE_CI_WS_URL ?? "ws://127.0.0.1:5080/ws";
const outputDir = path.resolve(process.cwd(), "test-results", "e2e");
const readyPath = path.join(outputDir, "peer-ready.json");
const sawUnityPath = path.join(outputDir, "peer-saw-unity.json");
const targetPath = path.join(outputDir, "peer-target.json");
const sawUnityBeforePath = path.join(outputDir, "peer-saw-unity-transform-before-takeover.json");
const peerAppliedPath = path.join(outputDir, "peer-applied-transform.json");
const sawUnityAfterPath = path.join(outputDir, "peer-saw-unity-transform-after-takeover.json");
const evidencePaths = [
  readyPath,
  sawUnityPath,
  targetPath,
  sawUnityBeforePath,
  peerAppliedPath,
  sawUnityAfterPath,
];
const peerUserId = "ci-peer-b";
const unityUserId = "ci-unity-a";
const projectId = "ci-e2e-project";
const sessionId = "ci-e2e-session";

fs.mkdirSync(outputDir, { recursive: true });
for (const candidate of evidencePaths) {
  try {
    fs.rmSync(candidate, { force: true });
  } catch {
    // Best effort cleanup only.
  }
}

const socket = new WebSocket(endpoint);
const inbox = [];
let wake = null;
let shuttingDown = false;
let target = null;
let latestServerRevision = 0;
let firstUnityTransformObserved = false;
let peerTakeoverRequested = false;
let peerOwnsLock = false;
let peerTransformApplied = false;
let lockRenewalTimer = null;
let releaseTimer = null;
let renewalSequence = 0;

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isTarget(message) {
  return Boolean(
    target &&
    message?.sceneId === target.sceneId &&
    message?.objectId === target.objectId,
  );
}

function stopLockRenewal() {
  if (lockRenewalTimer) {
    clearInterval(lockRenewalTimer);
    lockRenewalTimer = null;
  }
}

function startLockRenewal() {
  stopLockRenewal();
  lockRenewalTimer = setInterval(() => {
    if (shuttingDown || !peerOwnsLock || !target || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    renewalSequence += 1;
    socket.send(JSON.stringify({
      type: "lock_request",
      protocolVersion: 1,
      requestId: `ci-peer-b-renew-${renewalSequence}`,
      userId: peerUserId,
      ...target,
    }));
  }, 2_000);
  lockRenewalTimer.unref();
}

function schedulePeerRelease() {
  if (releaseTimer || !peerOwnsLock || !target) {
    return;
  }
  releaseTimer = setTimeout(() => {
    releaseTimer = null;
    if (shuttingDown || !peerOwnsLock || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    stopLockRenewal();
    socket.send(JSON.stringify({
      type: "lock_release",
      protocolVersion: 1,
      requestId: "ci-peer-b-release-after-transform",
      userId: peerUserId,
      ...target,
    }));
  }, 6_000);
  releaseTimer.unref();
}

function requestPeerTakeover() {
  if (
    shuttingDown ||
    peerTakeoverRequested ||
    !target ||
    !firstUnityTransformObserved ||
    socket.readyState !== WebSocket.OPEN
  ) {
    return;
  }
  peerTakeoverRequested = true;
  socket.send(JSON.stringify({
    type: "lock_request",
    protocolVersion: 1,
    requestId: "ci-peer-b-takeover-lock",
    userId: peerUserId,
    ...target,
  }));
}

function sendPeerTransform() {
  if (!peerOwnsLock || !target || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(JSON.stringify({
    type: "transform_update",
    protocolVersion: 1,
    requestId: "ci-peer-b-transform-request",
    operationId: "ci-peer-b-transform-1",
    userId: peerUserId,
    ...target,
    baseRevision: latestServerRevision,
    localPosition: { x: 2, y: 4, z: 6 },
    localRotation: { x: 0, y: 0, z: 0, w: 1 },
    localScale: { x: 1, y: 1, z: 1 },
  }));
}

function inspectMessage(message) {
  const presence = message?.presence;
  if (
    (message?.type === "user_joined" || message?.type === "presence_updated") &&
    presence?.userId === unityUserId
  ) {
    writeJson(sawUnityPath, {
      observedAt: new Date().toISOString(),
      type: message.type,
      userId: presence.userId,
      displayName: presence.displayName,
      connectionId: presence.connectionId,
    });
  }

  if (message?.type === "lock_state_changed") {
    const lockState = message.lockState;
    if (lockState?.ownerUserId === unityUserId && !target) {
      target = { sceneId: lockState.sceneId, objectId: lockState.objectId };
      writeJson(targetPath, {
        observedAt: new Date().toISOString(),
        ...target,
        unityConnectionId: lockState.ownerConnectionId,
      });
    }
  }

  if (message?.type === "transform_applied") {
    latestServerRevision = Math.max(latestServerRevision, message.serverRevision ?? 0);
    if (isTarget(message) && message.userId === unityUserId) {
      const evidence = {
        observedAt: new Date().toISOString(),
        operationId: message.operationId,
        userId: message.userId,
        sceneId: message.sceneId,
        objectId: message.objectId,
        serverRevision: message.serverRevision,
        localPosition: message.localPosition,
      };
      if (!firstUnityTransformObserved) {
        firstUnityTransformObserved = true;
        writeJson(sawUnityBeforePath, evidence);
      } else if (peerTransformApplied) {
        writeJson(sawUnityAfterPath, evidence);
      }
    }

    if (isTarget(message) && message.userId === peerUserId && message.operationId === "ci-peer-b-transform-1") {
      peerTransformApplied = true;
      writeJson(peerAppliedPath, {
        observedAt: new Date().toISOString(),
        operationId: message.operationId,
        serverRevision: message.serverRevision,
        localPosition: message.localPosition,
      });
      schedulePeerRelease();
    }
  }

  if (message?.type === "lock_released" && isTarget(message)) {
    if (message.previousOwnerUserId === unityUserId) {
      requestPeerTakeover();
    } else if (message.previousOwnerUserId === peerUserId) {
      peerOwnsLock = false;
      stopLockRenewal();
    }
  }

  if (message?.type === "lock_granted" && message.requestId === "ci-peer-b-takeover-lock") {
    if (!isTarget(message.lockState) || message.lockState.ownerUserId !== peerUserId) {
      throw new Error("CI Peer B received an invalid takeover lock grant.");
    }
    peerOwnsLock = true;
    startLockRenewal();
    sendPeerTransform();
  }
}

socket.on("message", (data) => {
  const message = JSON.parse(data.toString("utf8"));
  inspectMessage(message);
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
    if (index >= 0) {
      return inbox.splice(index, 1)[0];
    }
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (wake === onWake) wake = null;
        resolve();
      }, 100);
      const onWake = () => {
        clearTimeout(timer);
        resolve();
      };
      wake = onWake;
    });
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

const helloRequestId = "ci-peer-b-hello";
socket.send(JSON.stringify({
  type: "hello",
  protocolVersion: 1,
  requestId: helloRequestId,
  userName: "CI Peer B",
  userId: peerUserId,
  userColor: "#64B5F6",
  projectId,
  sessionId,
  supportsPresence: true,
  supportsTransformSync: true,
  supportsHierarchySync: true,
  supportsProjectTransfer: false,
}));

const ack = await waitFor(
  (message) => message?.type === "hello_ack" && message?.requestId === helloRequestId,
  "hello acknowledgement",
);
if (!ack.presenceEnabled || !ack.transformSyncEnabled || !ack.hierarchySyncEnabled) {
  throw new Error("Server did not negotiate Presence, Transform, and Hierarchy Sync for CI Peer B.");
}
await waitFor((message) => message?.type === "presence_snapshot", "presence snapshot");
await waitFor((message) => message?.type === "hierarchy_snapshot", "hierarchy snapshot");
const initialTransformSnapshot = await waitFor(
  (message) => message?.type === "transform_snapshot",
  "transform snapshot",
);
latestServerRevision = initialTransformSnapshot.serverRevision ?? 0;

socket.send(JSON.stringify({
  type: "presence_update",
  protocolVersion: 1,
  requestId: "ci-peer-b-presence",
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
  activity: "CI Ready",
}));
await waitFor(
  (message) => message?.type === "presence_updated" && message?.presence?.userId === peerUserId,
  "CI Peer B presence update",
);

writeJson(readyPath, {
  readyAt: new Date().toISOString(),
  endpoint,
  userId: peerUserId,
  projectId,
  sessionId,
  mode: "wait-for-real-unity-target",
});
console.info(`CI Peer B ready at ${endpoint}; waiting for Unity to select and lock a real target.`);

function stop() {
  if (shuttingDown) return;
  shuttingDown = true;
  stopLockRenewal();
  if (releaseTimer) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
  try {
    socket.close();
  } catch {
    // Best effort shutdown only.
  }
  setTimeout(() => process.exit(0), 50).unref();
}

process.on("SIGTERM", stop);
process.on("SIGINT", stop);
socket.on("close", () => {
  stopLockRenewal();
  if (!shuttingDown) {
    console.error("CI Peer B WebSocket closed unexpectedly.");
    process.exitCode = 1;
  }
});

// Keep a live event-loop handle instead of an intentionally unresolved top-level await.
// Node 24 reports unresolved top-level await as unsettled and may terminate the helper.
setInterval(() => {}, 60_000);
