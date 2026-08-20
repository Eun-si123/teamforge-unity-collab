import fs from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";

const endpoint = process.env.TEAMFORGE_CI_WS_URL ?? "ws://127.0.0.1:5080/ws";
const outputDir = path.resolve(process.cwd(), "test-results", "e2e");
const readyPath = path.join(outputDir, "peer-ready.json");
const sawUnityPath = path.join(outputDir, "peer-saw-unity.json");
const peerUserId = "ci-peer-b";
const unityUserId = "ci-unity-a";
const projectId = "ci-e2e-project";
const sessionId = "ci-e2e-session";

fs.mkdirSync(outputDir, { recursive: true });
for (const candidate of [readyPath, sawUnityPath]) {
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

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
if (!ack.presenceEnabled) {
  throw new Error("Server did not negotiate Presence for CI Peer B.");
}
await waitFor((message) => message?.type === "presence_snapshot", "presence snapshot");

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

writeJson(readyPath, {
  readyAt: new Date().toISOString(),
  endpoint,
  userId: peerUserId,
  projectId,
  sessionId,
});
console.info(`CI Peer B ready at ${endpoint}`);

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
