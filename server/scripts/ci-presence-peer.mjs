import fs from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";

const endpoint = process.env.TEAMFORGE_CI_WS_URL ?? "ws://127.0.0.1:5080/ws";
const outputDir = path.resolve(process.cwd(), "test-results", "e2e");
const readyPath = path.join(outputDir, "peer-ready.json");
const sawUnityPath = path.join(outputDir, "peer-saw-unity.json");
const sawUnityTransformPath = path.join(outputDir, "peer-saw-unity-transform.json");
const peerUserId = "ci-peer-b";
const unityUserId = "ci-unity-a";
const projectId = "ci-e2e-project";
const sessionId = "ci-e2e-session";
const target = {
  sceneId: "ci-transform-scene",
  objectId: "GlobalObjectId_V1-2-ci-transform-scene-4242-0",
};

fs.mkdirSync(outputDir, { recursive: true });
for (const candidate of [readyPath, sawUnityPath, sawUnityTransformPath]) {
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
let peerOwnsLock = false;
let releaseScheduled = false;

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function schedulePeerLockRelease() {
  if (releaseScheduled || !peerOwnsLock || shuttingDown) {
    return;
  }
  releaseScheduled = true;
  setTimeout(() => {
    if (shuttingDown || !peerOwnsLock || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(
      JSON.stringify({
        type: "lock_release",
        protocolVersion: 1,
        requestId: "ci-peer-b-release",
        userId: peerUserId,
        ...target,
      }),
    );
  }, 6_000);
}

function inspectForUnity(message) {
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
    schedulePeerLockRelease();
  }

  if (
    message?.type === "transform_applied" &&
    message?.userId === unityUserId &&
    message?.objectId === target.objectId
  ) {
    writeJson(sawUnityTransformPath, {
      observedAt: new Date().toISOString(),
      operationId: message.operationId,
      userId: message.userId,
      sceneId: message.sceneId,
      objectId: message.objectId,
      serverRevision: message.serverRevision,
      localPosition: message.localPosition,
    });
  }

  if (
    message?.type === "lock_released" &&
    message?.objectId === target.objectId &&
    message?.previousOwnerUserId === peerUserId
  ) {
    peerOwnsLock = false;
  }
}

socket.on("message", (data) => {
  const message = JSON.parse(data.toString("utf8"));
  inspectForUnity(message);
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
        if (wake === onWake) {
          wake = null;
        }
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
socket.send(
  JSON.stringify({
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
    supportsProjectTransfer: true,
  }),
);

const ack = await waitFor(
  (message) => message?.type === "hello_ack" && message?.requestId === helloRequestId,
  "hello acknowledgement",
);
if (!ack.presenceEnabled || !ack.transformSyncEnabled) {
  throw new Error("Server did not negotiate Presence and Transform Sync for CI Peer B.");
}
await waitFor((message) => message?.type === "presence_snapshot", "presence snapshot");
const transformSnapshot = await waitFor(
  (message) => message?.type === "transform_snapshot",
  "transform snapshot",
);

socket.send(
  JSON.stringify({
    type: "presence_update",
    protocolVersion: 1,
    requestId: "ci-peer-b-presence",
    userId: peerUserId,
    sceneId: "ci-scene-guid",
    sceneName: "CI Scene",
    selectedObjectId: "",
    selectedObjectName: "",
    hasSceneView: true,
    cameraPosition: { x: 1, y: 2, z: 3 },
    cameraRotation: { x: 0, y: 0, z: 0, w: 1 },
    cameraPivot: { x: 0, y: 0, z: 0 },
    cameraSize: 10,
    cameraOrthographic: false,
    activity: "CI Ready",
  }),
);

await waitFor(
  (message) => message?.type === "presence_updated" && message?.presence?.userId === peerUserId,
  "CI Peer B presence update",
);

socket.send(
  JSON.stringify({
    type: "lock_request",
    protocolVersion: 1,
    requestId: "ci-peer-b-lock",
    userId: peerUserId,
    ...target,
  }),
);
const peerLock = await waitFor(
  (message) => message?.type === "lock_granted" && message?.requestId === "ci-peer-b-lock",
  "CI Peer B lock grant",
);
if (peerLock?.lockState?.ownerUserId !== peerUserId) {
  throw new Error("CI Peer B did not become the authoritative lock owner.");
}
peerOwnsLock = true;

const peerOperationId = "ci-peer-b-transform-1";
socket.send(
  JSON.stringify({
    type: "transform_update",
    protocolVersion: 1,
    requestId: "ci-peer-b-transform-request",
    operationId: peerOperationId,
    userId: peerUserId,
    ...target,
    baseRevision: transformSnapshot.serverRevision,
    localPosition: { x: 2, y: 4, z: 6 },
    localRotation: { x: 0, y: 0, z: 0, w: 1 },
    localScale: { x: 1, y: 1, z: 1 },
  }),
);
const peerTransform = await waitFor(
  (message) => message?.type === "transform_applied" && message?.operationId === peerOperationId,
  "CI Peer B transform application",
);
if (peerTransform?.serverRevision <= transformSnapshot.serverRevision) {
  throw new Error("CI Peer B transform did not advance the authoritative revision.");
}

writeJson(readyPath, {
  readyAt: new Date().toISOString(),
  endpoint,
  userId: peerUserId,
  projectId,
  sessionId,
  target,
  peerTransformRevision: peerTransform.serverRevision,
});
console.info(`CI Peer B ready at ${endpoint} with authoritative lock and transform.`);

function stop() {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
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
  if (!shuttingDown) {
    console.error("CI Peer B WebSocket closed unexpectedly.");
    process.exitCode = 1;
  }
});

// The workflow owns this helper process and stops it in an always() cleanup step.
// Keeping it alive indefinitely avoids false failures while a fresh Unity image is downloading.
await new Promise(() => {});
