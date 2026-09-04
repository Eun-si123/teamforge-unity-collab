import fs from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";

const endpoint = process.env.TEAMFORGE_CI_WS_URL ?? "ws://127.0.0.1:5080/ws";
const outputDir = path.resolve(process.cwd(), "test-results", "lock-marathon-e2e");
const readyPath = path.join(outputDir, "peer-ready.json");
const targetPath = path.join(outputDir, "peer-target.json");
const appliedPath = path.join(outputDir, "peer-authoritative-transform.json");
const renewalPath = path.join(outputDir, "peer-renewal-summary.json");
const releasePath = path.join(outputDir, "peer-release.json");
const recoveryPath = path.join(outputDir, "peer-saw-unity-recovery-transform.json");
const unexpectedPath = path.join(outputDir, "unexpected-unity-transform-during-peer-lock.json");

const peerUserId = "ci-lock-marathon-peer-b";
const unityUserId = "ci-lock-marathon-unity-a";
const projectId = "ci-lock-marathon-project";
const sessionId = "ci-lock-marathon-session";
const holdMs = Number.parseInt(process.env.TEAMFORGE_CHAOS_MARATHON_HOLD_MS ?? "26000", 10);
const renewalDelays = [450, 1250, 700, 1650, 500, 1050, 800, 1450, 600, 900, 1750, 550];

fs.mkdirSync(outputDir, { recursive: true });
for (const candidate of [readyPath, targetPath, appliedPath, renewalPath, releasePath, recoveryPath, unexpectedPath]) {
  fs.rmSync(candidate, { force: true });
}

const socket = new WebSocket(endpoint);
const inbox = [];
let wake = null;
let target = null;
let latestRevision = 0;
let initialUnityTransformSeen = false;
let peerOwns = false;
let peerReleased = false;
let takeoverInFlight = false;
let renewalTimer = null;
let releaseTimer = null;
let renewalSequence = 0;
let renewalGranted = 0;
let renewalRejected = 0;
let shuttingDown = false;

const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
const isTarget = (message) => Boolean(target && message?.sceneId === target.sceneId && message?.objectId === target.objectId);

function send(message) {
  if (socket.readyState !== WebSocket.OPEN) throw new Error("lock-marathon peer socket is not open");
  socket.send(JSON.stringify(message));
}

function scheduleRenewal() {
  if (!peerOwns || shuttingDown || renewalTimer) return;
  const delay = renewalDelays[renewalSequence % renewalDelays.length];
  renewalTimer = setTimeout(() => {
    renewalTimer = null;
    if (!peerOwns || shuttingDown || !target || socket.readyState !== WebSocket.OPEN) return;
    renewalSequence += 1;
    send({
      type: "lock_request",
      protocolVersion: 1,
      requestId: `lock-marathon-renew-${renewalSequence}`,
      userId: peerUserId,
      ...target,
    });
  }, delay);
  renewalTimer.unref();
}

function requestTakeover() {
  if (!target || !initialUnityTransformSeen || peerOwns || takeoverInFlight || shuttingDown) return;
  takeoverInFlight = true;
  send({
    type: "lock_request",
    protocolVersion: 1,
    requestId: "lock-marathon-peer-takeover",
    userId: peerUserId,
    ...target,
  });
}

function publishAuthoritativeTransform() {
  send({
    type: "transform_update",
    protocolVersion: 1,
    requestId: "lock-marathon-peer-transform-request",
    operationId: "lock-marathon-peer-transform-op",
    userId: peerUserId,
    ...target,
    baseRevision: latestRevision,
    localPosition: { x: 20, y: 30, z: 40 },
    localRotation: { x: 0, y: 0, z: 0, w: 1 },
    localScale: { x: 1, y: 1, z: 1 },
  });
}

function scheduleRelease() {
  if (releaseTimer || shuttingDown) return;
  releaseTimer = setTimeout(() => {
    releaseTimer = null;
    if (!peerOwns || !target || socket.readyState !== WebSocket.OPEN) return;
    if (renewalTimer) {
      clearTimeout(renewalTimer);
      renewalTimer = null;
    }
    writeJson(renewalPath, {
      observedAt: new Date().toISOString(),
      renewalSequence,
      renewalGranted,
      renewalRejected,
      holdMs,
      renewalDelays,
    });
    send({
      type: "lock_release",
      protocolVersion: 1,
      requestId: "lock-marathon-peer-release",
      userId: peerUserId,
      ...target,
    });
  }, holdMs);
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
      initialUnityTransformSeen = true;
    } else if (message.userId === unityUserId && peerOwns) {
      writeJson(unexpectedPath, {
        observedAt: new Date().toISOString(),
        operationId: message.operationId,
        serverRevision: message.serverRevision,
        localPosition: message.localPosition,
        localRotation: message.localRotation,
        localScale: message.localScale,
      });
    } else if (message.userId === unityUserId && peerReleased) {
      writeJson(recoveryPath, {
        observedAt: new Date().toISOString(),
        operationId: message.operationId,
        serverRevision: message.serverRevision,
        localPosition: message.localPosition,
      });
    }

    if (message.userId === peerUserId && message.operationId === "lock-marathon-peer-transform-op") {
      writeJson(appliedPath, {
        observedAt: new Date().toISOString(),
        serverRevision: message.serverRevision,
        localPosition: message.localPosition,
      });
      scheduleRenewal();
      scheduleRelease();
    }
  }

  if (typeof message?.requestId === "string" && message.requestId.startsWith("lock-marathon-renew-")) {
    if (message.type === "lock_granted") {
      renewalGranted += 1;
      scheduleRenewal();
    } else if (message.type === "lock_denied" || message.type === "error") {
      renewalRejected += 1;
      writeJson(renewalPath, {
        observedAt: new Date().toISOString(),
        renewalSequence,
        renewalGranted,
        renewalRejected,
        failedRequestId: message.requestId,
        responseType: message.type,
        reason: message.reason ?? message.code ?? "",
      });
      throw new Error(`Lock-marathon renewal failed: ${JSON.stringify(message)}`);
    }
  }

  if (message?.type === "lock_released" && isTarget(message)) {
    if (message.previousOwnerUserId === unityUserId && !peerOwns && !peerReleased) {
      requestTakeover();
    } else if (message.previousOwnerUserId === peerUserId) {
      peerOwns = false;
      peerReleased = true;
      if (renewalTimer) {
        clearTimeout(renewalTimer);
        renewalTimer = null;
      }
      writeJson(releasePath, {
        observedAt: new Date().toISOString(),
        reason: message.reason,
        serverRevision: latestRevision,
        renewalSequence,
        renewalGranted,
        renewalRejected,
      });
    }
  }

  if ((message?.type === "lock_denied" || message?.type === "error") &&
      message.requestId === "lock-marathon-peer-takeover") {
    takeoverInFlight = false;
    setTimeout(requestTakeover, 100).unref();
  }

  if (message?.type === "lock_granted" && message.requestId === "lock-marathon-peer-takeover") {
    takeoverInFlight = false;
    if (!isTarget(message.lockState) || message.lockState.ownerUserId !== peerUserId) {
      throw new Error(`Invalid marathon takeover grant: ${JSON.stringify(message)}`);
    }
    peerOwns = true;
    publishAuthoritativeTransform();
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

const helloRequestId = "lock-marathon-peer-hello";
send({
  type: "hello",
  protocolVersion: 1,
  requestId: helloRequestId,
  userName: "CI Lock Marathon Peer B",
  userId: peerUserId,
  userColor: "#29B6F6",
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
  requestId: "lock-marathon-peer-presence",
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
  activity: "Lock Marathon Ready",
});
await waitFor((message) => message?.type === "presence_updated" && message?.presence?.userId === peerUserId, "presence update");
writeJson(readyPath, {
  readyAt: new Date().toISOString(),
  connectionId: ack.connectionId,
  endpoint,
  projectId,
  sessionId,
  holdMs,
  renewalDelays,
  mode: "long-hold-jitter-renewal",
});
console.info(`CI lock-marathon peer ready at ${endpoint}.`);

function stop() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (renewalTimer) clearTimeout(renewalTimer);
  if (releaseTimer) clearTimeout(releaseTimer);
  try { socket.close(); } catch {}
  setTimeout(() => process.exit(0), 50).unref();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
socket.on("close", () => {
  if (!shuttingDown) {
    console.error("CI lock-marathon peer WebSocket closed unexpectedly");
    process.exitCode = 1;
  }
});
setInterval(() => {}, 60000);
