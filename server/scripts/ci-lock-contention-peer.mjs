import fs from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";

const endpoint = process.env.TEAMFORGE_CI_WS_URL ?? "ws://127.0.0.1:5080/ws";
const outputDir = path.resolve(process.cwd(), "test-results", "contention-e2e");
const readyPath = path.join(outputDir, "peer-ready.json");
const targetPath = path.join(outputDir, "peer-target.json");
const peerAppliedPath = path.join(outputDir, "peer-authoritative-transform.json");
const peerReleasedPath = path.join(outputDir, "peer-release.json");
const unityRecoveryPath = path.join(outputDir, "peer-saw-unity-recovery-transform.json");
const unexpectedUnityTransformPath = path.join(outputDir, "unexpected-unity-transform-during-peer-lock.json");
const evidencePaths = [
  readyPath,
  targetPath,
  peerAppliedPath,
  peerReleasedPath,
  unityRecoveryPath,
  unexpectedUnityTransformPath,
];

const peerUserId = "ci-contention-peer-b";
const unityUserId = "ci-contention-unity-a";
const projectId = "ci-contention-project";
const sessionId = "ci-contention-session";

fs.mkdirSync(outputDir, { recursive: true });
for (const candidate of evidencePaths) {
  fs.rmSync(candidate, { force: true });
}

const socket = new WebSocket(endpoint);
const inbox = [];
let wake = null;
let shuttingDown = false;
let target = null;
let latestServerRevision = 0;
let unityInitialTransformSeen = false;
let peerOwnsLock = false;
let peerTransformApplied = false;
let peerReleased = false;
let renewalTimer = null;
let releaseTimer = null;
let renewalSequence = 0;

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isTarget(message) {
  return Boolean(target && message?.sceneId === target.sceneId && message?.objectId === target.objectId);
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
    if (shuttingDown || !peerOwnsLock || !target || socket.readyState !== WebSocket.OPEN) return;
    renewalSequence += 1;
    socket.send(JSON.stringify({
      type: "lock_request",
      protocolVersion: 1,
      requestId: `ci-contention-renew-${renewalSequence}`,
      userId: peerUserId,
      ...target,
    }));
  }, 2_000);
  renewalTimer.unref();
}

function scheduleRelease() {
  if (releaseTimer || !peerOwnsLock || !target) return;
  releaseTimer = setTimeout(() => {
    releaseTimer = null;
    if (shuttingDown || !peerOwnsLock || socket.readyState !== WebSocket.OPEN) return;
    stopRenewal();
    socket.send(JSON.stringify({
      type: "lock_release",
      protocolVersion: 1,
      requestId: "ci-contention-peer-release",
      userId: peerUserId,
      ...target,
    }));
  }, 12_000);
  releaseTimer.unref();
}

function requestTakeover() {
  if (!target || !unityInitialTransformSeen || peerOwnsLock || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({
    type: "lock_request",
    protocolVersion: 1,
    requestId: "ci-contention-peer-takeover",
    userId: peerUserId,
    ...target,
  }));
}

function sendAuthoritativeTransform() {
  socket.send(JSON.stringify({
    type: "transform_update",
    protocolVersion: 1,
    requestId: "ci-contention-peer-transform-request",
    operationId: "ci-contention-peer-transform-1",
    userId: peerUserId,
    ...target,
    baseRevision: latestServerRevision,
    localPosition: { x: 20, y: 30, z: 40 },
    localRotation: { x: 0, y: 0, z: 0, w: 1 },
    localScale: { x: 1, y: 1, z: 1 },
  }));
}

function inspectMessage(message) {
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
    if (isTarget(message) && message.userId === unityUserId && !peerOwnsLock && !peerReleased) {
      unityInitialTransformSeen = true;
    } else if (isTarget(message) && message.userId === unityUserId && peerOwnsLock) {
      writeJson(unexpectedUnityTransformPath, {
        observedAt: new Date().toISOString(),
        operationId: message.operationId,
        serverRevision: message.serverRevision,
        localPosition: message.localPosition,
      });
    } else if (isTarget(message) && message.userId === unityUserId && peerReleased) {
      writeJson(unityRecoveryPath, {
        observedAt: new Date().toISOString(),
        operationId: message.operationId,
        serverRevision: message.serverRevision,
        localPosition: message.localPosition,
      });
    }

    if (isTarget(message) && message.userId === peerUserId && message.operationId === "ci-contention-peer-transform-1") {
      peerTransformApplied = true;
      writeJson(peerAppliedPath, {
        observedAt: new Date().toISOString(),
        operationId: message.operationId,
        serverRevision: message.serverRevision,
        localPosition: message.localPosition,
      });
      scheduleRelease();
    }
  }

  if (message?.type === "lock_released" && isTarget(message)) {
    if (message.previousOwnerUserId === unityUserId && !peerOwnsLock && !peerTransformApplied) {
      requestTakeover();
    } else if (message.previousOwnerUserId === peerUserId) {
      peerOwnsLock = false;
      peerReleased = true;
      stopRenewal();
      writeJson(peerReleasedPath, {
        observedAt: new Date().toISOString(),
        reason: message.reason,
        serverRevision: latestServerRevision,
      });
    }
  }

  if (message?.type === "lock_granted" && message.requestId === "ci-contention-peer-takeover") {
    if (!isTarget(message.lockState) || message.lockState.ownerUserId !== peerUserId) {
      throw new Error("Contention peer received an invalid takeover grant.");
    }
    peerOwnsLock = true;
    startRenewal();
    sendAuthoritativeTransform();
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
    if (index >= 0) return inbox.splice(index, 1)[0];
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

const helloRequestId = "ci-contention-peer-hello";
socket.send(JSON.stringify({
  type: "hello",
  protocolVersion: 1,
  requestId: helloRequestId,
  userName: "CI Contention Peer B",
  userId: peerUserId,
  userColor: "#4FC3F7",
  projectId,
  sessionId,
  supportsPresence: true,
  supportsTransformSync: true,
  supportsHierarchySync: true,
  supportsProjectTransfer: false,
}));

const ack = await waitFor(
  (message) => message?.type === "hello_ack" && message?.requestId === helloRequestId,
  "contention hello acknowledgement",
);
if (!ack.presenceEnabled || !ack.transformSyncEnabled || !ack.hierarchySyncEnabled) {
  throw new Error("Server did not negotiate all contention capabilities.");
}
await waitFor((message) => message?.type === "presence_snapshot", "contention presence snapshot");
await waitFor((message) => message?.type === "hierarchy_snapshot", "contention hierarchy snapshot");
const initialTransformSnapshot = await waitFor(
  (message) => message?.type === "transform_snapshot",
  "contention transform snapshot",
);
latestServerRevision = initialTransformSnapshot.serverRevision ?? 0;

socket.send(JSON.stringify({
  type: "presence_update",
  protocolVersion: 1,
  requestId: "ci-contention-peer-presence",
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
  activity: "Contention Ready",
}));
await waitFor(
  (message) => message?.type === "presence_updated" && message?.presence?.userId === peerUserId,
  "contention presence update",
);

writeJson(readyPath, {
  readyAt: new Date().toISOString(),
  endpoint,
  userId: peerUserId,
  projectId,
  sessionId,
  mode: "remote-lock-contention",
});
console.info(`CI contention peer ready at ${endpoint}.`);

function stop() {
  if (shuttingDown) return;
  shuttingDown = true;
  stopRenewal();
  if (releaseTimer) clearTimeout(releaseTimer);
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
  stopRenewal();
  if (!shuttingDown) {
    console.error("CI contention peer WebSocket closed unexpectedly.");
    process.exitCode = 1;
  }
});

setInterval(() => {}, 60_000);
