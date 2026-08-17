import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { createTeamForgeServer } from "../src/teamforge-server.mjs";

function openSocket(url) {
  return new Promise((resolve, reject) => {
    const candidate = new WebSocket(url);
    candidate.once("open", () => resolve(candidate));
    candidate.once("error", reject);
  });
}

function createInbox(socket) {
  const queued = [];
  const waiters = [];
  socket.on("message", (data) => {
    const message = JSON.parse(data.toString("utf8"));
    const waiter = waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    } else {
      queued.push(message);
    }
  });

  return {
    next() {
      if (queued.length > 0) {
        return Promise.resolve(queued.shift());
      }
      return new Promise((resolve, reject) => {
        const waiter = { resolve, reject, timer: null };
        waiter.timer = setTimeout(() => reject(new Error("Smoke test receive timeout.")), 2_000);
        waiters.push(waiter);
      });
    },
  };
}

const server = createTeamForgeServer({ host: "127.0.0.1", port: 0, logger: console });
const endpoint = await server.start();
const url = `ws://127.0.0.1:${endpoint.port}${endpoint.wsPath}`;
const result = {
  health: false,
  legacyHello: false,
  pong: false,
  presenceSnapshot: false,
  presenceUpdate: false,
  transformSnapshot: false,
  lockGranted: false,
  transformApplied: false,
  lockReleased: false,
  projectSnapshot: false,
  revision: null,
  rttMs: null,
};

try {
  const health = await fetch(`http://127.0.0.1:${endpoint.port}${endpoint.healthPath}`);
  result.health = health.ok && (await health.json()).protocolVersion === 1;

  const legacySocket = await openSocket(url);
  const legacyInbox = createInbox(legacySocket);
  legacySocket.send(
    JSON.stringify({
      type: "hello",
      protocolVersion: 1,
      requestId: "smoke-hello",
      userName: "Smoke Test",
      projectId: "teamforge",
      sessionId: "phase-0",
    }),
  );
  result.legacyHello = (await legacyInbox.next()).type === "hello_ack";

  const pingStarted = performance.now();
  legacySocket.send(
    JSON.stringify({
      type: "ping",
      protocolVersion: 1,
      requestId: "smoke-ping",
      clientTimestampUnixMs: Date.now(),
    }),
  );
  result.pong = (await legacyInbox.next()).type === "pong";
  result.rttMs = Math.round((performance.now() - pingStarted) * 100) / 100;
  legacySocket.close();

  const presenceSocket = await openSocket(url);
  const presenceInbox = createInbox(presenceSocket);
  presenceSocket.send(
    JSON.stringify({
      type: "hello",
      protocolVersion: 1,
      requestId: "presence-hello",
      userName: "Presence Smoke",
      projectId: "teamforge",
      sessionId: "phase-1",
      supportsPresence: true,
      userId: "presence-smoke",
      userColor: "#64B5F6",
    }),
  );
  assert.equal((await presenceInbox.next()).type, "hello_ack");
  const snapshot = await presenceInbox.next();
  result.presenceSnapshot = snapshot.type === "presence_snapshot" && snapshot.members.length === 1;

  presenceSocket.send(
    JSON.stringify({
      type: "presence_update",
      protocolVersion: 1,
      requestId: "presence-update",
      userId: "presence-smoke",
      sceneId: "scene-guid",
      sceneName: "SampleScene",
      selectedObjectId: "",
      selectedObjectName: "Cube",
      hasSceneView: true,
      cameraPosition: { x: 1, y: 2, z: 3 },
      cameraRotation: { x: 0, y: 0, z: 0, w: 1 },
      cameraPivot: { x: 0, y: 0, z: 0 },
      cameraSize: 10,
      cameraOrthographic: false,
      activity: "Selecting",
    }),
  );
  const update = await presenceInbox.next();
  result.presenceUpdate = update.type === "presence_updated" && update.presence.selectedObjectName === "Cube";
  presenceSocket.close();

  const transformSocket = await openSocket(url);
  const transformInbox = createInbox(transformSocket);
  transformSocket.send(
    JSON.stringify({
      type: "hello",
      protocolVersion: 1,
      requestId: "transform-hello",
      userName: "Transform Smoke",
      projectId: "teamforge",
      sessionId: "phase-2",
      supportsPresence: true,
      supportsTransformSync: true,
      userId: "transform-smoke",
      userColor: "#81C784",
    }),
  );
  const transformAck = await transformInbox.next();
  assert.equal(transformAck.transformSyncEnabled, true);
  assert.equal((await transformInbox.next()).type, "presence_snapshot");
  const transformSnapshot = await transformInbox.next();
  result.transformSnapshot =
    transformSnapshot.type === "transform_snapshot" && transformSnapshot.serverRevision === 0;

  const target = {
    sceneId: "scene-guid",
    objectId: "GlobalObjectId_V1-2-scene-guid-123-0",
  };
  transformSocket.send(
    JSON.stringify({
      type: "lock_request",
      protocolVersion: 1,
      requestId: "smoke-lock",
      userId: "transform-smoke",
      ...target,
    }),
  );
  const lock = await transformInbox.next();
  result.lockGranted = lock.type === "lock_granted" && lock.lockState.ownerUserId === "transform-smoke";

  transformSocket.send(
    JSON.stringify({
      type: "transform_update",
      protocolVersion: 1,
      requestId: "smoke-transform-update",
      operationId: "smoke-operation-1",
      userId: "transform-smoke",
      ...target,
      baseRevision: 0,
      localPosition: { x: 1, y: 2, z: 3 },
      localRotation: { x: 0, y: 0, z: 0, w: 1 },
      localScale: { x: 1, y: 1, z: 1 },
    }),
  );
  const applied = await transformInbox.next();
  result.transformApplied = applied.type === "transform_applied" && applied.serverRevision === 1;
  result.revision = applied.serverRevision;

  transformSocket.send(
    JSON.stringify({
      type: "lock_release",
      protocolVersion: 1,
      requestId: "smoke-release",
      userId: "transform-smoke",
      ...target,
    }),
  );
  result.lockReleased = (await transformInbox.next()).type === "lock_released";
  transformSocket.close();

  const projectSocket = await openSocket(url);
  const projectInbox = createInbox(projectSocket);
  projectSocket.send(
    JSON.stringify({
      type: "hello",
      protocolVersion: 1,
      requestId: "project-smoke-hello",
      userName: "Project Smoke",
      userId: "project-smoke",
      projectId: "teamforge-project-smoke",
      sessionId: "phase-3",
      supportsProjectTransfer: true,
    }),
  );
  const projectAck = await projectInbox.next();
  assert.equal(projectAck.projectTransferEnabled, true);
  const projectSnapshot = await projectInbox.next();
  result.projectSnapshot =
    projectSnapshot.type === "project_registry_snapshot" &&
    projectSnapshot.baseline === null &&
    projectSnapshot.peers.length === 0;
  projectSocket.close();

  for (const [name, passed] of Object.entries(result)) {
    if (name !== "rttMs" && name !== "revision") {
      assert.equal(passed, true, `${name} failed`);
    }
  }
  assert.equal(result.revision, 1);
  console.info(JSON.stringify(result, null, 2));
} finally {
  await server.stop();
}
