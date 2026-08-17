import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, test } from "node:test";
import { WebSocket } from "ws";
import { createTeamForgeServer } from "../src/teamforge-server.mjs";

const silentLogger = { info() {}, warn() {}, error() {} };
const goldenCompatibility = JSON.parse(await readFile(new URL(
  "../../unity-package/com.eunsung.teamforge/Tests/Fixtures/teamforge-compatibility-v1.json",
  import.meta.url,
), "utf8"));
let server;
let endpoint;

function openWebSocket(url, options = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, options);
    const timer = setTimeout(() => reject(new Error("Timed out opening WebSocket.")), 2_000);
    socket.once("open", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function nextJson(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for JSON message.")), 2_000);
    socket.once("message", (data, isBinary) => {
      clearTimeout(timer);
      try {
        assert.equal(isBinary, false);
        resolve(JSON.parse(data.toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function createJsonInbox(socket) {
  const queued = [];
  const waiters = [];

  const onMessage = (data, isBinary) => {
    let value;
    try {
      assert.equal(isBinary, false);
      value = JSON.parse(data.toString("utf8"));
    } catch (error) {
      value = { inboxError: error };
    }

    const waiter = waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      if (value.inboxError) {
        waiter.reject(value.inboxError);
      } else {
        waiter.resolve(value);
      }
    } else {
      queued.push(value);
    }
  };

  socket.on("message", onMessage);
  return {
    next(timeoutMilliseconds = 2_000) {
      if (queued.length > 0) {
        const value = queued.shift();
        return value.inboxError ? Promise.reject(value.inboxError) : Promise.resolve(value);
      }

      return new Promise((resolve, reject) => {
        const waiter = { resolve, reject, timer: null };
        waiter.timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) {
            waiters.splice(index, 1);
          }
          reject(new Error("Timed out waiting for queued JSON message."));
        }, timeoutMilliseconds);
        waiters.push(waiter);
      });
    },
    dispose() {
      socket.off("message", onMessage);
      for (const waiter of waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("JSON inbox disposed."));
      }
    },
  };
}

function presenceHello(overrides = {}) {
  return {
    type: "hello",
    protocolVersion: 1,
    requestId: "presence-hello",
    userName: "Editor A",
    projectId: "sample-project",
    sessionId: "phase-1",
    supportsPresence: true,
    userId: "editor-a",
    userColor: "#64B5F6",
    ...overrides,
  };
}

function presenceUpdate(overrides = {}) {
  return {
    type: "presence_update",
    protocolVersion: 1,
    requestId: "presence-update",
    userId: "editor-a",
    sceneId: "scene-guid",
    sceneName: "SampleScene",
    selectedObjectId: "GlobalObjectId_V1-2-scene-guid-123-0",
    selectedObjectName: "Shared Cube",
    hasSceneView: true,
    cameraPosition: { x: 1, y: 2, z: 3 },
    cameraRotation: { x: 0, y: 0, z: 0, w: 1 },
    cameraPivot: { x: 4, y: 5, z: 6 },
    cameraSize: 8,
    cameraOrthographic: false,
    activity: "Selecting",
    ...overrides,
  };
}

function transformHello(overrides = {}) {
  return presenceHello({
    requestId: "transform-hello",
    sessionId: "phase-2",
    supportsTransformSync: true,
    ...overrides,
  });
}

function hierarchyHello(overrides = {}) {
  return transformHello({
    requestId: "hierarchy-hello",
    sessionId: "phase-4",
    supportsHierarchySync: true,
    ...overrides,
  });
}

function hierarchyRecord(overrides = {}) {
  return {
    objectId: "GlobalObjectId_V1-2-scene-guid-100-0",
    name: "Root",
    parentObjectId: "",
    siblingIndex: 0,
    localPosition: { x: 0, y: 0, z: 0 },
    localRotation: { x: 0, y: 0, z: 0, w: 1 },
    localScale: { x: 1, y: 1, z: 1 },
    ...overrides,
  };
}

function hierarchySeed(overrides = {}) {
  return {
    type: "hierarchy_seed",
    protocolVersion: 1,
    requestId: "hierarchy-seed",
    userId: "editor-a",
    sceneId: "scene-guid",
    baseRevision: 0,
    objects: [
      hierarchyRecord(),
      hierarchyRecord({
        objectId: "GlobalObjectId_V1-2-scene-guid-200-0",
        name: "Other Root",
        siblingIndex: 1,
      }),
    ],
    ...overrides,
  };
}

function hierarchyOperation(kind, overrides = {}) {
  const base = {
    type: "hierarchy_operation",
    protocolVersion: 1,
    requestId: `hierarchy-${kind}`,
    operationId: `hierarchy-operation-${kind}`,
    userId: "editor-a",
    kind,
    sceneId: "scene-guid",
    objectId: "tf:11111111111111111111111111111111",
    baseRevision: 0,
  };
  if (kind === "create_object") {
    Object.assign(base, {
      name: "Created",
      parentObjectId: "GlobalObjectId_V1-2-scene-guid-100-0",
      siblingIndex: 0,
      localPosition: { x: 1, y: 2, z: 3 },
      localRotation: { x: 0, y: 0, z: 0, w: 1 },
      localScale: { x: 1, y: 1, z: 1 },
    });
  } else if (kind === "rename_object") {
    base.name = "Renamed";
  } else if (kind === "reparent_object") {
    Object.assign(base, {
      parentObjectId: "GlobalObjectId_V1-2-scene-guid-200-0",
      siblingIndex: 0,
      localPosition: { x: 4, y: 5, z: 6 },
      localRotation: { x: 0, y: 0, z: 0, w: 1 },
      localScale: { x: 1, y: 1, z: 1 },
    });
  } else if (kind === "reorder_sibling") {
    base.siblingIndex = 0;
  }
  return { ...base, ...overrides };
}

function lockRequest(overrides = {}) {
  return {
    type: "lock_request",
    protocolVersion: 1,
    requestId: "lock-request",
    userId: "editor-a",
    sceneId: "scene-guid",
    objectId: "GlobalObjectId_V1-2-scene-guid-123-0",
    ...overrides,
  };
}

function transformUpdate(overrides = {}) {
  return {
    type: "transform_update",
    protocolVersion: 1,
    requestId: "transform-update",
    operationId: "operation-a-1",
    userId: "editor-a",
    sceneId: "scene-guid",
    objectId: "GlobalObjectId_V1-2-scene-guid-123-0",
    baseRevision: 0,
    localPosition: { x: 1, y: 2, z: 3 },
    localRotation: { x: 0, y: 0, z: 0, w: 1 },
    localScale: { x: 1, y: 1, z: 1 },
    ...overrides,
  };
}

function closeWebSocket(socket) {
  return new Promise((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    socket.once("close", resolve);
    socket.close();
  });
}

function rejectedUpgradeStatus(url, options = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, options);
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      resolve(response.statusCode);
    });
    socket.once("open", () => reject(new Error("Rejected socket unexpectedly opened.")));
    socket.once("error", () => {});
  });
}

describe("TeamForge server", () => {
before(async () => {
  server = createTeamForgeServer({ host: "127.0.0.1", port: 0, logger: silentLogger });
  endpoint = await server.start();
});

after(async () => {
  await server.stop();
});

test("health endpoint reports protocol and connection state", async () => {
  const response = await fetch(`http://127.0.0.1:${endpoint.port}${endpoint.healthPath}`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "ok");
  assert.equal(body.protocolVersion, 1);
  assert.equal(body.connections, 0);
  assert.equal(body.sessions, 0);
  assert.equal(body.presenceMembers, 0);
  assert.equal(body.activeLocks, 0);
  assert.equal(body.retainedTransforms, 0);
});

test("hello followed by ping returns a correlated pong", async () => {
  const socket = await openWebSocket(`ws://127.0.0.1:${endpoint.port}${endpoint.wsPath}`);
  socket.send(
    JSON.stringify({
      type: "hello",
      protocolVersion: 1,
      requestId: "hello-1",
      userName: "Editor A",
      projectId: "sample-project",
      sessionId: "phase-0",
    }),
  );
  const helloAck = await nextJson(socket);
  assert.equal(helloAck.type, "hello_ack");
  assert.equal(helloAck.requestId, "hello-1");
  assert.equal(typeof helloAck.connectionId, "string");

  socket.send(
    JSON.stringify({
      type: "ping",
      protocolVersion: 1,
      requestId: "ping-1",
      clientTimestampUnixMs: 1_786_000_000_000,
    }),
  );
  const pong = await nextJson(socket);
  assert.equal(pong.type, "pong");
  assert.equal(pong.requestId, "ping-1");
  assert.equal(pong.clientTimestampUnixMs, 1_786_000_000_000);
  assert.equal(Number.isSafeInteger(pong.serverTimestampUnixMs), true);
  await closeWebSocket(socket);
});

test("ping before hello is rejected without corrupting the session host", async () => {
  const socket = await openWebSocket(`ws://127.0.0.1:${endpoint.port}${endpoint.wsPath}`);
  socket.send(
    JSON.stringify({
      type: "ping",
      protocolVersion: 1,
      requestId: "too-early",
      clientTimestampUnixMs: Date.now(),
    }),
  );
  const response = await nextJson(socket);
  assert.equal(response.type, "error");
  assert.equal(response.code, "hello_required");
  await closeWebSocket(socket);
});

test("a mismatched protocol version is reported and closed", async () => {
  const socket = await openWebSocket(`ws://127.0.0.1:${endpoint.port}${endpoint.wsPath}`);
  const closed = new Promise((resolve) => socket.once("close", resolve));
  socket.send(
    JSON.stringify({
      type: "hello",
      protocolVersion: 999,
      requestId: "bad-version",
      userName: "Editor A",
      projectId: "sample-project",
      sessionId: "phase-0",
    }),
  );
  const response = await nextJson(socket);
  assert.equal(response.type, "error");
  assert.equal(response.code, "invalid_envelope");
  await closed;
});

test("optional bearer token rejects unauthorized upgrades", async () => {
  const authenticatedServer = createTeamForgeServer({
    host: "127.0.0.1",
    port: 0,
    authToken: "test-secret",
    logger: silentLogger,
  });
  const authenticatedEndpoint = await authenticatedServer.start();
  const url = `ws://127.0.0.1:${authenticatedEndpoint.port}${authenticatedEndpoint.wsPath}`;

  try {
    const statusCode = await rejectedUpgradeStatus(url);
    assert.equal(statusCode, 401);

    const authorizedSocket = await openWebSocket(url, {
      headers: { Authorization: "Bearer test-secret" },
    });
    await closeWebSocket(authorizedSocket);
  } finally {
    await authenticatedServer.stop();
  }
});

test("health and WebSocket paths are deployment-configurable", async () => {
  const customServer = createTeamForgeServer({
    host: "127.0.0.1",
    port: 0,
    healthPath: "/custom/status",
    wsPath: "/custom/realtime",
    logger: silentLogger,
  });
  const customEndpoint = await customServer.start();

  try {
    const health = await fetch(`http://127.0.0.1:${customEndpoint.port}/custom/status`);
    assert.equal(health.status, 200);
    const socket = await openWebSocket(`ws://127.0.0.1:${customEndpoint.port}/custom/realtime`);
    await closeWebSocket(socket);
    assert.equal(await rejectedUpgradeStatus(`ws://127.0.0.1:${customEndpoint.port}/ws`), 404);
  } finally {
    await customServer.stop();
  }
});

test("per-connection rate limit reports the violation and closes", async () => {
  const limitedServer = createTeamForgeServer({
    host: "127.0.0.1",
    port: 0,
    rateLimitPerSecond: 1,
    logger: silentLogger,
  });
  const limitedEndpoint = await limitedServer.start();
  const socket = await openWebSocket(`ws://127.0.0.1:${limitedEndpoint.port}${limitedEndpoint.wsPath}`);

  try {
    socket.send(
      JSON.stringify({
        type: "hello",
        protocolVersion: 1,
        requestId: "rate-hello",
        userName: "Editor A",
        projectId: "sample-project",
        sessionId: "phase-0",
      }),
    );
    assert.equal((await nextJson(socket)).type, "hello_ack");

    const closed = new Promise((resolve) => socket.once("close", resolve));
    socket.send(
      JSON.stringify({
        type: "ping",
        protocolVersion: 1,
        requestId: "rate-ping",
        clientTimestampUnixMs: Date.now(),
      }),
    );
    const response = await nextJson(socket);
    assert.equal(response.code, "rate_limited");
    await closed;
  } finally {
    if (socket.readyState !== WebSocket.CLOSED) {
      socket.terminate();
    }
    await limitedServer.stop();
  }
});

test("presence members receive session snapshot, join, update, and leave", async () => {
  const url = `ws://127.0.0.1:${endpoint.port}${endpoint.wsPath}`;
  const editorA = await openWebSocket(url);
  const inboxA = createJsonInbox(editorA);
  let editorB;
  let inboxB;

  try {
    editorA.send(JSON.stringify(presenceHello()));
    assert.equal((await inboxA.next()).type, "hello_ack");
    const snapshotA = await inboxA.next();
    assert.equal(snapshotA.type, "presence_snapshot");
    assert.deepEqual(snapshotA.members.map((member) => member.userId), ["editor-a"]);

    editorB = await openWebSocket(url);
    inboxB = createJsonInbox(editorB);
    editorB.send(
      JSON.stringify(
        presenceHello({
          requestId: "presence-hello-b",
          userName: "Editor B",
          userId: "editor-b",
          userColor: "#81C784",
        }),
      ),
    );

    const helloAckB = await inboxB.next();
    const snapshotB = await inboxB.next();
    const joinedB = await inboxA.next();
    assert.equal(helloAckB.type, "hello_ack");
    assert.equal(snapshotB.type, "presence_snapshot");
    assert.deepEqual(
      snapshotB.members.map((member) => member.userId).sort(),
      ["editor-a", "editor-b"],
    );
    assert.equal(joinedB.type, "user_joined");
    assert.equal(joinedB.presence.userId, "editor-b");

    editorA.send(JSON.stringify(presenceUpdate()));
    const updateForA = await inboxA.next();
    const updateForB = await inboxB.next();
    assert.equal(updateForA.type, "presence_updated");
    assert.equal(updateForB.type, "presence_updated");
    assert.equal(updateForB.presence.selectedObjectName, "Shared Cube");
    assert.deepEqual(updateForB.presence.cameraPivot, { x: 4, y: 5, z: 6 });
    assert.equal(Number.isSafeInteger(updateForB.presence.lastHeartbeatUnixMs), true);

    const health = await (await fetch(`http://127.0.0.1:${endpoint.port}${endpoint.healthPath}`)).json();
    assert.equal(health.sessions, 1);
    assert.equal(health.presenceMembers, 2);

    const leftPromise = inboxA.next();
    await closeWebSocket(editorB);
    editorB = null;
    const left = await leftPromise;
    assert.equal(left.type, "user_left");
    assert.equal(left.userId, "editor-b");
  } finally {
    inboxB?.dispose();
    inboxA.dispose();
    if (editorB) {
      await closeWebSocket(editorB);
    }
    await closeWebSocket(editorA);
  }
});

test("presence state is isolated by project and session", async () => {
  const url = `ws://127.0.0.1:${endpoint.port}${endpoint.wsPath}`;
  const editorA = await openWebSocket(url);
  const editorB = await openWebSocket(url);
  const inboxA = createJsonInbox(editorA);
  const inboxB = createJsonInbox(editorB);

  try {
    editorA.send(JSON.stringify(presenceHello({ requestId: "isolated-a", sessionId: "session-a" })));
    editorB.send(
      JSON.stringify(
        presenceHello({
          requestId: "isolated-b",
          sessionId: "session-b",
          userId: "editor-b",
          userName: "Editor B",
          userColor: "#81C784",
        }),
      ),
    );

    assert.equal((await inboxA.next()).type, "hello_ack");
    assert.equal((await inboxB.next()).type, "hello_ack");
    const snapshotA = await inboxA.next();
    const snapshotB = await inboxB.next();
    assert.deepEqual(snapshotA.members.map((member) => member.userId), ["editor-a"]);
    assert.deepEqual(snapshotB.members.map((member) => member.userId), ["editor-b"]);
    assert.equal(server.presenceSessionCount, 2);
  } finally {
    inboxA.dispose();
    inboxB.dispose();
    await Promise.all([closeWebSocket(editorA), closeWebSocket(editorB)]);
  }
});

test("presence update rejects malformed camera data and another editor identity", async () => {
  const socket = await openWebSocket(`ws://127.0.0.1:${endpoint.port}${endpoint.wsPath}`);
  const inbox = createJsonInbox(socket);

  try {
    socket.send(JSON.stringify(presenceHello({ requestId: "spoof-hello" })));
    assert.equal((await inbox.next()).type, "hello_ack");
    assert.equal((await inbox.next()).type, "presence_snapshot");

    socket.send(JSON.stringify(presenceUpdate({ requestId: "bad-camera", cameraSize: 0 })));
    const malformed = await inbox.next();
    assert.equal(malformed.type, "error");
    assert.equal(malformed.code, "invalid_presence");

    socket.send(JSON.stringify(presenceUpdate({ requestId: "spoof-update", userId: "editor-b" })));
    const rejected = await inbox.next();
    assert.equal(rejected.type, "error");
    assert.equal(rejected.code, "presence_identity_mismatch");

    socket.send(
      JSON.stringify({
        type: "ping",
        protocolVersion: 1,
        requestId: "after-spoof",
        clientTimestampUnixMs: Date.now(),
      }),
    );
    assert.equal((await inbox.next()).type, "pong");
  } finally {
    inbox.dispose();
    await closeWebSocket(socket);
  }
});

test("a reconnect with the same stable user ID supersedes stale presence", async () => {
  const url = `ws://127.0.0.1:${endpoint.port}${endpoint.wsPath}`;
  const stale = await openWebSocket(url);
  const staleInbox = createJsonInbox(stale);
  let replacement;
  let replacementInbox;

  try {
    stale.send(JSON.stringify(presenceHello({ requestId: "stale-hello" })));
    assert.equal((await staleInbox.next()).type, "hello_ack");
    assert.equal((await staleInbox.next()).type, "presence_snapshot");

    const staleClosed = new Promise((resolve) => stale.once("close", resolve));
    replacement = await openWebSocket(url);
    replacementInbox = createJsonInbox(replacement);
    replacement.send(JSON.stringify(presenceHello({ requestId: "replacement-hello" })));

    assert.equal((await replacementInbox.next()).type, "hello_ack");
    const replacementSnapshot = await replacementInbox.next();
    assert.equal(replacementSnapshot.members.length, 1);
    assert.equal(replacementSnapshot.members[0].userId, "editor-a");

    const superseded = await staleInbox.next();
    assert.equal(superseded.code, "session_superseded");
    await staleClosed;
    assert.equal(server.presenceMemberCount, 1);
  } finally {
    replacementInbox?.dispose();
    staleInbox.dispose();
    if (replacement) {
      await closeWebSocket(replacement);
    }
    if (stale.readyState !== WebSocket.CLOSED) {
      await closeWebSocket(stale);
    }
  }
});

test("transform clients negotiate a snapshot while Phase 1 clients remain message-compatible", async () => {
  const url = `ws://127.0.0.1:${endpoint.port}${endpoint.wsPath}`;
  const phaseOne = await openWebSocket(url);
  const phaseTwo = await openWebSocket(url);
  const phaseOneInbox = createJsonInbox(phaseOne);
  const phaseTwoInbox = createJsonInbox(phaseTwo);

  try {
    phaseOne.send(JSON.stringify(presenceHello({ requestId: "phase-one-only", sessionId: "capabilities" })));
    assert.equal((await phaseOneInbox.next()).type, "hello_ack");
    assert.equal((await phaseOneInbox.next()).type, "presence_snapshot");

    phaseOne.send(JSON.stringify({
      type: "ping",
      protocolVersion: 1,
      requestId: "phase-one-ping",
      clientTimestampUnixMs: Date.now(),
    }));
    assert.equal((await phaseOneInbox.next()).type, "pong");

    phaseTwo.send(JSON.stringify(transformHello({
      requestId: "phase-two-capable",
      sessionId: "capabilities",
      userId: "editor-b",
      userName: "Editor B",
      userColor: "#81C784",
    })));
    assert.equal((await phaseOneInbox.next()).type, "user_joined");
    const acknowledgement = await phaseTwoInbox.next();
    assert.equal(acknowledgement.type, "hello_ack");
    assert.equal(acknowledgement.presenceEnabled, true);
    assert.equal(acknowledgement.transformSyncEnabled, true);
    assert.equal((await phaseTwoInbox.next()).type, "presence_snapshot");
    const transformSnapshot = await phaseTwoInbox.next();
    assert.equal(transformSnapshot.type, "transform_snapshot");
    assert.equal(transformSnapshot.serverRevision, 0);
    assert.deepEqual(transformSnapshot.transforms, []);
    assert.deepEqual(transformSnapshot.locks, []);

    phaseTwo.send(JSON.stringify(lockRequest({
      requestId: "capability-lock",
      userId: "editor-b",
    })));
    assert.equal((await phaseTwoInbox.next()).type, "lock_granted");
    await assert.rejects(phaseOneInbox.next(100), /Timed out waiting/);
  } finally {
    phaseOneInbox.dispose();
    phaseTwoInbox.dispose();
    await Promise.all([closeWebSocket(phaseOne), closeWebSocket(phaseTwo)]);
  }
});

test("hierarchy capability seeds clean saved state and late join receives Hierarchy before Transform", async () => {
  const url = `ws://127.0.0.1:${endpoint.port}${endpoint.wsPath}`;
  const editorA = await openWebSocket(url);
  const inboxA = createJsonInbox(editorA);
  let editorB;
  let inboxB;

  try {
    editorA.send(JSON.stringify(hierarchyHello({ requestId: "hierarchy-seed-a", sessionId: "hierarchy-seed-session" })));
    const ackA = await inboxA.next();
    assert.equal(ackA.type, "hello_ack");
    assert.equal(ackA.hierarchySyncEnabled, true);
    assert.equal((await inboxA.next()).type, "presence_snapshot");
    const initialHierarchy = await inboxA.next();
    assert.equal(initialHierarchy.type, "hierarchy_snapshot");
    assert.equal(initialHierarchy.serverRevision, 0);
    assert.deepEqual(initialHierarchy.objects, []);
    assert.deepEqual(initialHierarchy.tombstones, []);
    assert.equal((await inboxA.next()).type, "transform_snapshot");

    editorA.send(JSON.stringify(hierarchySeed({
      requestId: "seed-clean-scene",
      baseRevision: 0,
    })));
    const accepted = await inboxA.next();
    assert.equal(accepted.type, "hierarchy_seed_accepted");
    assert.equal(accepted.idempotent, false);
    assert.equal(accepted.serverRevision, 0);

    editorA.send(JSON.stringify(hierarchySeed({
      requestId: "seed-clean-scene-repeat",
      baseRevision: 0,
    })));
    const repeated = await inboxA.next();
    assert.equal(repeated.type, "hierarchy_seed_accepted");
    assert.equal(repeated.idempotent, true);

    editorB = await openWebSocket(url);
    inboxB = createJsonInbox(editorB);
    editorB.send(JSON.stringify(hierarchyHello({
      requestId: "hierarchy-seed-b",
      sessionId: "hierarchy-seed-session",
      userId: "editor-b",
      userName: "Editor B",
      userColor: "#81C784",
    })));
    assert.equal((await inboxA.next()).type, "user_joined");
    assert.equal((await inboxB.next()).type, "hello_ack");
    assert.equal((await inboxB.next()).type, "presence_snapshot");
    const lateHierarchy = await inboxB.next();
    assert.equal(lateHierarchy.type, "hierarchy_snapshot");
    assert.equal(lateHierarchy.objects.length, 2);
    assert.equal(lateHierarchy.objects[0].siblingIndex, 0);
    assert.equal(lateHierarchy.objects[1].siblingIndex, 1);
    assert.equal((await inboxB.next()).type, "transform_snapshot");
  } finally {
    inboxB?.dispose();
    inboxA.dispose();
    if (editorB) {
      await closeWebSocket(editorB);
    }
    await closeWebSocket(editorA);
  }
});

test("Phase 2-only clients cannot transform a Scene once authoritative Phase 4 Hierarchy state exists", async () => {
  const url = `ws://127.0.0.1:${endpoint.port}${endpoint.wsPath}`;
  const hierarchyEditor = await openWebSocket(url);
  const hierarchyInbox = createJsonInbox(hierarchyEditor);
  let legacyEditor;
  let legacyInbox;

  try {
    hierarchyEditor.send(JSON.stringify(hierarchyHello({
      requestId: "hierarchy-compat-owner",
      sessionId: "hierarchy-compat-session",
    })));
    assert.equal((await hierarchyInbox.next()).type, "hello_ack");
    assert.equal((await hierarchyInbox.next()).type, "presence_snapshot");
    assert.equal((await hierarchyInbox.next()).type, "hierarchy_snapshot");
    assert.equal((await hierarchyInbox.next()).type, "transform_snapshot");
    hierarchyEditor.send(JSON.stringify(hierarchySeed({ requestId: "hierarchy-compat-seed" })));
    assert.equal((await hierarchyInbox.next()).type, "hierarchy_seed_accepted");

    legacyEditor = await openWebSocket(url);
    legacyInbox = createJsonInbox(legacyEditor);
    legacyEditor.send(JSON.stringify(transformHello({
      requestId: "legacy-phase-two",
      sessionId: "hierarchy-compat-session",
      userId: "legacy-editor",
      userName: "Legacy Editor",
      userColor: "#FFB74D",
    })));
    assert.equal((await hierarchyInbox.next()).type, "user_joined");
    const legacyAck = await legacyInbox.next();
    assert.equal(legacyAck.type, "hello_ack");
    assert.equal(legacyAck.transformSyncEnabled, true);
    assert.equal(legacyAck.hierarchySyncEnabled, false);
    assert.equal((await legacyInbox.next()).type, "presence_snapshot");
    assert.equal((await legacyInbox.next()).type, "transform_snapshot");

    legacyEditor.send(JSON.stringify(lockRequest({
      requestId: "legacy-lock-on-phase4-scene",
      userId: "legacy-editor",
      objectId: "GlobalObjectId_V1-2-scene-guid-100-0",
    })));
    const rejected = await legacyInbox.next();
    assert.equal(rejected.type, "error");
    assert.equal(rejected.code, "hierarchy_sync_required");
  } finally {
    legacyInbox?.dispose();
    hierarchyInbox.dispose();
    if (legacyEditor) {
      await closeWebSocket(legacyEditor);
    }
    await closeWebSocket(hierarchyEditor);
  }
});

test("hierarchy operations are revisioned, lock-aware, canonical, cycle-safe, tombstoned, and idempotent", async () => {
  const url = `ws://127.0.0.1:${endpoint.port}${endpoint.wsPath}`;
  const socket = await openWebSocket(url);
  const inbox = createJsonInbox(socket);
  const targetId = "tf:11111111111111111111111111111111";
  const secondId = "tf:22222222222222222222222222222222";
  const parentA = "GlobalObjectId_V1-2-scene-guid-100-0";
  const parentB = "GlobalObjectId_V1-2-scene-guid-200-0";

  try {
    socket.send(JSON.stringify(hierarchyHello({ requestId: "hierarchy-ops-hello", sessionId: "hierarchy-ops-session" })));
    assert.equal((await inbox.next()).type, "hello_ack");
    assert.equal((await inbox.next()).type, "presence_snapshot");
    assert.equal((await inbox.next()).type, "hierarchy_snapshot");
    assert.equal((await inbox.next()).type, "transform_snapshot");

    socket.send(JSON.stringify(hierarchySeed({ requestId: "hierarchy-ops-seed" })));
    assert.equal((await inbox.next()).type, "hierarchy_seed_accepted");

    const create = hierarchyOperation("create_object", { requestId: "create-target" });
    socket.send(JSON.stringify(create));
    const created = await inbox.next();
    assert.equal(created.type, "hierarchy_applied");
    assert.equal(created.serverRevision, 1);
    assert.equal(created.changedObjects.some((item) => item.objectId === targetId), true);

    socket.send(JSON.stringify(lockRequest({
      requestId: "lock-created",
      objectId: targetId,
    })));
    assert.equal((await inbox.next()).type, "lock_granted");

    socket.send(JSON.stringify(hierarchyOperation("rename_object", {
      requestId: "rename-target",
      operationId: "hierarchy-rename-target",
      baseRevision: 1,
      name: "Renamed Target",
    })));
    const renamed = await inbox.next();
    assert.equal(renamed.type, "hierarchy_applied");
    assert.equal(renamed.serverRevision, 2);
    assert.equal(renamed.changedObjects.find((item) => item.objectId === targetId).name, "Renamed Target");

    socket.send(JSON.stringify(hierarchyOperation("reparent_object", {
      requestId: "reparent-target",
      operationId: "hierarchy-reparent-target",
      baseRevision: 2,
      parentObjectId: parentB,
      siblingIndex: 0,
    })));
    const reparented = await inbox.next();
    assert.equal(reparented.type, "hierarchy_applied");
    assert.equal(reparented.serverRevision, 3);
    assert.equal(reparented.changedObjects.find((item) => item.objectId === targetId).parentObjectId, parentB);

    socket.send(JSON.stringify(hierarchyOperation("create_object", {
      requestId: "create-second",
      operationId: "hierarchy-create-second",
      objectId: secondId,
      baseRevision: 3,
      parentObjectId: parentB,
      siblingIndex: 0,
      name: "Second Child",
    })));
    const secondCreated = await inbox.next();
    assert.equal(secondCreated.serverRevision, 4);
    assert.equal(secondCreated.changedObjects.find((item) => item.objectId === secondId).siblingIndex, 0);
    assert.equal(secondCreated.changedObjects.find((item) => item.objectId === targetId).siblingIndex, 1);

    socket.send(JSON.stringify(hierarchyOperation("reorder_sibling", {
      requestId: "reorder-target",
      operationId: "hierarchy-reorder-target",
      baseRevision: 4,
      siblingIndex: 0,
    })));
    const reordered = await inbox.next();
    assert.equal(reordered.serverRevision, 5);
    assert.equal(reordered.changedObjects.find((item) => item.objectId === targetId).siblingIndex, 0);
    assert.equal(reordered.changedObjects.find((item) => item.objectId === secondId).siblingIndex, 1);

    socket.send(JSON.stringify(lockRequest({ requestId: "lock-parent-b", objectId: parentB })));
    assert.equal((await inbox.next()).type, "lock_granted");
    socket.send(JSON.stringify(hierarchyOperation("reparent_object", {
      requestId: "cycle-parent",
      operationId: "hierarchy-cycle-parent",
      objectId: parentB,
      baseRevision: 5,
      parentObjectId: targetId,
      siblingIndex: 0,
    })));
    const cycle = await inbox.next();
    assert.equal(cycle.type, "hierarchy_conflict");
    assert.equal(cycle.reason, "parent_cycle");
    assert.equal(cycle.serverRevision, 5);

    socket.send(JSON.stringify(hierarchyOperation("delete_object", {
      requestId: "delete-target",
      operationId: "hierarchy-delete-target",
      baseRevision: 5,
    })));
    const lockReleased = await inbox.next();
    assert.equal(lockReleased.type, "lock_released");
    assert.equal(lockReleased.objectId, targetId);
    const deleted = await inbox.next();
    assert.equal(deleted.type, "hierarchy_applied");
    assert.equal(deleted.serverRevision, 6);
    assert.deepEqual(deleted.deletedObjectIds, [targetId]);

    socket.send(JSON.stringify(hierarchyOperation("rename_object", {
      requestId: "rename-deleted",
      operationId: "hierarchy-rename-deleted",
      baseRevision: 6,
      name: "Must Not Return",
    })));
    const deletedConflict = await inbox.next();
    assert.equal(deletedConflict.type, "hierarchy_conflict");
    assert.equal(deletedConflict.reason, "object_deleted");
    assert.equal(deletedConflict.serverRevision, 6);

    socket.send(JSON.stringify({ ...create, requestId: "create-replay" }));
    const replay = await inbox.next();
    assert.equal(replay.type, "hierarchy_applied");
    assert.equal(replay.serverRevision, 1);
    assert.equal(replay.requestId, "create-replay");

    const health = await (await fetch(
      `http://127.0.0.1:${endpoint.port}${endpoint.healthPath}`,
    )).json();
    assert.equal(health.hierarchyObjects >= 3, true);
    assert.equal(health.hierarchyTombstones >= 1, true);
  } finally {
    inbox.dispose();
    await closeWebSocket(socket);
  }
});

test("hierarchy capability fails closed for malformed seed, stale revision, and another editor lock", async () => {
  const url = `ws://127.0.0.1:${endpoint.port}${endpoint.wsPath}`;
  const socket = await openWebSocket(url);
  const inbox = createJsonInbox(socket);
  let other;
  let otherInbox;
  const rootId = "GlobalObjectId_V1-2-scene-guid-100-0";

  try {
    socket.send(JSON.stringify(hierarchyHello({ requestId: "hierarchy-invalid-hello", sessionId: "hierarchy-invalid-session" })));
    assert.equal((await inbox.next()).type, "hello_ack");
    assert.equal((await inbox.next()).type, "presence_snapshot");
    assert.equal((await inbox.next()).type, "hierarchy_snapshot");
    assert.equal((await inbox.next()).type, "transform_snapshot");

    socket.send(JSON.stringify(hierarchySeed({
      requestId: "bad-logical-seed",
      objects: [hierarchyRecord({ objectId: "tf:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" })],
    })));
    const invalidSeed = await inbox.next();
    assert.equal(invalidSeed.type, "error");
    assert.equal(invalidSeed.code, "invalid_hierarchy_seed");

    socket.send(JSON.stringify(hierarchySeed({ requestId: "valid-invalid-session-seed" })));
    assert.equal((await inbox.next()).type, "hierarchy_seed_accepted");

    other = await openWebSocket(url);
    otherInbox = createJsonInbox(other);
    other.send(JSON.stringify(hierarchyHello({
      requestId: "hierarchy-invalid-other",
      sessionId: "hierarchy-invalid-session",
      userId: "editor-b",
      userName: "Editor B",
      userColor: "#81C784",
    })));
    assert.equal((await inbox.next()).type, "user_joined");
    assert.equal((await otherInbox.next()).type, "hello_ack");
    assert.equal((await otherInbox.next()).type, "presence_snapshot");
    assert.equal((await otherInbox.next()).type, "hierarchy_snapshot");
    assert.equal((await otherInbox.next()).type, "transform_snapshot");

    other.send(JSON.stringify(lockRequest({
      requestId: "other-lock-root",
      userId: "editor-b",
      objectId: rootId,
    })));
    assert.equal((await otherInbox.next()).type, "lock_granted");
    assert.equal((await inbox.next()).type, "lock_state_changed");

    socket.send(JSON.stringify(hierarchyOperation("rename_object", {
      requestId: "rename-other-locked",
      operationId: "rename-other-locked",
      objectId: rootId,
      baseRevision: 0,
      name: "No Lock Override",
    })));
    const locked = await inbox.next();
    assert.equal(locked.type, "hierarchy_conflict");
    assert.equal(locked.reason, "locked_by_other_user");
    assert.equal(locked.serverRevision, 0);

    socket.send(JSON.stringify(hierarchyOperation("create_object", {
      requestId: "stale-create",
      operationId: "stale-create",
      baseRevision: 1,
      parentObjectId: "",
    })));
    const stale = await inbox.next();
    assert.equal(stale.type, "hierarchy_conflict");
    assert.equal(stale.reason, "stale_revision");
    assert.equal(stale.serverRevision, 0);
  } finally {
    otherInbox?.dispose();
    inbox.dispose();
    if (other) {
      await closeWebSocket(other);
    }
    await closeWebSocket(socket);
  }
});

test("server lock ownership serializes Transform updates and operation IDs are idempotent", async () => {
  const url = `ws://127.0.0.1:${endpoint.port}${endpoint.wsPath}`;
  const editorA = await openWebSocket(url);
  const editorB = await openWebSocket(url);
  const inboxA = createJsonInbox(editorA);
  const inboxB = createJsonInbox(editorB);

  try {
    editorA.send(JSON.stringify(transformHello({ requestId: "transform-a" })));
    assert.equal((await inboxA.next()).type, "hello_ack");
    assert.equal((await inboxA.next()).type, "presence_snapshot");
    assert.equal((await inboxA.next()).type, "transform_snapshot");

    editorB.send(JSON.stringify(transformHello({
      requestId: "transform-b",
      userName: "Editor B",
      userId: "editor-b",
      userColor: "#81C784",
    })));
    assert.equal((await inboxA.next()).type, "user_joined");
    assert.equal((await inboxB.next()).type, "hello_ack");
    assert.equal((await inboxB.next()).type, "presence_snapshot");
    assert.equal((await inboxB.next()).type, "transform_snapshot");

    editorA.send(JSON.stringify(lockRequest({ requestId: "lock-a" })));
    const grantedA = await inboxA.next();
    const observedByB = await inboxB.next();
    assert.equal(grantedA.type, "lock_granted");
    assert.equal(grantedA.lockState.ownerUserId, "editor-a");
    assert.equal(observedByB.type, "lock_state_changed");

    editorB.send(JSON.stringify(lockRequest({ requestId: "lock-b", userId: "editor-b" })));
    const deniedB = await inboxB.next();
    assert.equal(deniedB.type, "lock_denied");
    assert.equal(deniedB.lockState.ownerUserId, "editor-a");

    editorB.send(JSON.stringify(transformUpdate({
      requestId: "unauthorized-transform",
      operationId: "operation-b-unauthorized",
      userId: "editor-b",
    })));
    const rejectedB = await inboxB.next();
    assert.equal(rejectedB.type, "error");
    assert.equal(rejectedB.code, "lock_required");

    const firstUpdate = transformUpdate();
    editorA.send(JSON.stringify(firstUpdate));
    const appliedA = await inboxA.next();
    const appliedB = await inboxB.next();
    assert.equal(appliedA.type, "transform_applied");
    assert.equal(appliedA.serverRevision, 1);
    assert.deepEqual(appliedA.localPosition, { x: 1, y: 2, z: 3 });
    assert.equal(appliedB.serverRevision, 1);

    editorA.send(JSON.stringify({ ...firstUpdate, requestId: "duplicate-transform-request" }));
    const duplicate = await inboxA.next();
    assert.equal(duplicate.type, "transform_applied");
    assert.equal(duplicate.serverRevision, 1);
    assert.equal(duplicate.requestId, "duplicate-transform-request");

    editorA.send(JSON.stringify(transformUpdate({
      requestId: "same-target-conflict",
      operationId: firstUpdate.operationId,
      localPosition: { x: 99, y: 99, z: 99 },
    })));
    const sameTargetConflict = await inboxA.next();
    assert.equal(sameTargetConflict.type, "error");
    assert.equal(sameTargetConflict.code, "operation_id_conflict");

    editorA.send(JSON.stringify({
      ...lockRequest({ requestId: "release-a" }),
      type: "lock_release",
    }));
    const releasedA = await inboxA.next();
    const releasedB = await inboxB.next();
    assert.equal(releasedA.type, "lock_released");
    assert.equal(releasedB.type, "lock_released");

    editorB.send(JSON.stringify(lockRequest({ requestId: "lock-b-after-release", userId: "editor-b" })));
    assert.equal((await inboxB.next()).type, "lock_granted");
    const bLockForA = await inboxA.next();
    assert.equal(bLockForA.type, "lock_state_changed");
    assert.equal(bLockForA.lockState.ownerUserId, "editor-b");
  } finally {
    inboxA.dispose();
    inboxB.dispose();
    await Promise.all([closeWebSocket(editorA), closeWebSocket(editorB)]);
  }
});

test("late Transform join receives the latest revision, state, and active locks", async () => {
  const url = `ws://127.0.0.1:${endpoint.port}${endpoint.wsPath}`;
  const owner = await openWebSocket(url);
  const ownerInbox = createJsonInbox(owner);
  let late;
  let lateInbox;

  try {
    owner.send(JSON.stringify(transformHello({ requestId: "snapshot-owner", sessionId: "snapshot-session" })));
    assert.equal((await ownerInbox.next()).type, "hello_ack");
    assert.equal((await ownerInbox.next()).type, "presence_snapshot");
    assert.equal((await ownerInbox.next()).type, "transform_snapshot");

    owner.send(JSON.stringify(lockRequest({ requestId: "snapshot-lock" })));
    assert.equal((await ownerInbox.next()).type, "lock_granted");
    owner.send(JSON.stringify(transformUpdate({ requestId: "snapshot-update", operationId: "snapshot-operation" })));
    assert.equal((await ownerInbox.next()).serverRevision, 1);

    late = await openWebSocket(url);
    lateInbox = createJsonInbox(late);
    late.send(JSON.stringify(transformHello({
      requestId: "snapshot-late",
      sessionId: "snapshot-session",
      userName: "Editor B",
      userId: "editor-b",
      userColor: "#81C784",
    })));

    assert.equal((await ownerInbox.next()).type, "user_joined");
    assert.equal((await lateInbox.next()).type, "hello_ack");
    assert.equal((await lateInbox.next()).type, "presence_snapshot");
    const snapshot = await lateInbox.next();
    assert.equal(snapshot.type, "transform_snapshot");
    assert.equal(snapshot.serverRevision, 1);
    assert.equal(snapshot.transforms.length, 1);
    assert.equal(snapshot.transforms[0].operationId, "snapshot-operation");
    assert.equal(snapshot.locks.length, 1);
    assert.equal(snapshot.locks[0].ownerUserId, "editor-a");
  } finally {
    lateInbox?.dispose();
    ownerInbox.dispose();
    if (late) {
      await closeWebSocket(late);
    }
    await closeWebSocket(owner);
  }
});

test("malformed, spoofed, future-revision, and conflicting Transform operations are rejected safely", async () => {
  const socket = await openWebSocket(`ws://127.0.0.1:${endpoint.port}${endpoint.wsPath}`);
  const inbox = createJsonInbox(socket);

  try {
    socket.send(JSON.stringify(transformHello({ requestId: "validation-transform", sessionId: "validation-session" })));
    assert.equal((await inbox.next()).type, "hello_ack");
    assert.equal((await inbox.next()).type, "presence_snapshot");
    assert.equal((await inbox.next()).type, "transform_snapshot");

    socket.send(JSON.stringify(lockRequest({ requestId: "validation-lock" })));
    assert.equal((await inbox.next()).type, "lock_granted");

    socket.send(JSON.stringify(transformUpdate({
      requestId: "nan-shape",
      operationId: "bad-vector",
      localPosition: { x: "not-a-number", y: 0, z: 0 },
    })));
    assert.equal((await inbox.next()).code, "invalid_transform");

    socket.send(JSON.stringify(transformUpdate({
      requestId: "spoof-transform",
      operationId: "spoof-operation",
      userId: "editor-b",
    })));
    assert.equal((await inbox.next()).code, "transform_identity_mismatch");

    socket.send(JSON.stringify(transformUpdate({
      requestId: "future-transform",
      operationId: "future-operation",
      baseRevision: 99,
    })));
    assert.equal((await inbox.next()).code, "revision_ahead");

    socket.send(JSON.stringify(transformUpdate({
      requestId: "valid-transform",
      operationId: "shared-operation-id",
    })));
    assert.equal((await inbox.next()).serverRevision, 1);

    socket.send(JSON.stringify(transformUpdate({
      requestId: "conflicting-operation",
      operationId: "shared-operation-id",
      objectId: "GlobalObjectId_V1-2-scene-guid-999-0",
    })));
    assert.equal((await inbox.next()).code, "operation_id_conflict");

    socket.send(JSON.stringify({
      type: "ping",
      protocolVersion: 1,
      requestId: "after-invalid-transform",
      clientTimestampUnixMs: Date.now(),
    }));
    assert.equal((await inbox.next()).type, "pong");
  } finally {
    inbox.dispose();
    await closeWebSocket(socket);
  }
});

test("lock lease expiration is broadcast and permits another editor to acquire", async () => {
  const leaseServer = createTeamForgeServer({
    host: "127.0.0.1",
    port: 0,
    lockLeaseMilliseconds: 80,
    logger: silentLogger,
  });
  const leaseEndpoint = await leaseServer.start();
  const url = `ws://127.0.0.1:${leaseEndpoint.port}${leaseEndpoint.wsPath}`;
  const editorA = await openWebSocket(url);
  const editorB = await openWebSocket(url);
  const inboxA = createJsonInbox(editorA);
  const inboxB = createJsonInbox(editorB);

  try {
    editorA.send(JSON.stringify(transformHello({ requestId: "lease-a", sessionId: "lease-session" })));
    assert.equal((await inboxA.next()).type, "hello_ack");
    assert.equal((await inboxA.next()).type, "presence_snapshot");
    assert.equal((await inboxA.next()).type, "transform_snapshot");

    editorB.send(JSON.stringify(transformHello({
      requestId: "lease-b",
      sessionId: "lease-session",
      userName: "Editor B",
      userId: "editor-b",
      userColor: "#81C784",
    })));
    assert.equal((await inboxA.next()).type, "user_joined");
    assert.equal((await inboxB.next()).type, "hello_ack");
    assert.equal((await inboxB.next()).type, "presence_snapshot");
    assert.equal((await inboxB.next()).type, "transform_snapshot");

    editorA.send(JSON.stringify(lockRequest({ requestId: "short-lease" })));
    assert.equal((await inboxA.next()).type, "lock_granted");
    assert.equal((await inboxB.next()).type, "lock_state_changed");
    const expiredA = await inboxA.next();
    const expiredB = await inboxB.next();
    assert.equal(expiredA.type, "lock_released");
    assert.equal(expiredA.reason, "lease_expired");
    assert.equal(expiredB.reason, "lease_expired");

    editorB.send(JSON.stringify(lockRequest({ requestId: "after-expiry", userId: "editor-b" })));
    assert.equal((await inboxB.next()).type, "lock_granted");
  } finally {
    inboxA.dispose();
    inboxB.dispose();
    await Promise.all([closeWebSocket(editorA), closeWebSocket(editorB)]);
    await leaseServer.stop();
  }
});

test("same stable user reconnect releases locks owned by the superseded connection", async () => {
  const url = `ws://127.0.0.1:${endpoint.port}${endpoint.wsPath}`;
  const stale = await openWebSocket(url);
  const staleInbox = createJsonInbox(stale);
  let replacement;
  let replacementInbox;

  try {
    stale.send(JSON.stringify(transformHello({
      requestId: "lock-stale",
      sessionId: "lock-supersession",
    })));
    assert.equal((await staleInbox.next()).type, "hello_ack");
    assert.equal((await staleInbox.next()).type, "presence_snapshot");
    assert.equal((await staleInbox.next()).type, "transform_snapshot");
    stale.send(JSON.stringify(lockRequest({ requestId: "stale-owned-lock" })));
    assert.equal((await staleInbox.next()).type, "lock_granted");
    assert.equal(server.activeLockCount, 1);

    const staleClosed = new Promise((resolve) => stale.once("close", resolve));
    replacement = await openWebSocket(url);
    replacementInbox = createJsonInbox(replacement);
    replacement.send(JSON.stringify(transformHello({
      requestId: "lock-replacement",
      sessionId: "lock-supersession",
    })));

    assert.equal((await replacementInbox.next()).type, "hello_ack");
    assert.equal((await replacementInbox.next()).type, "presence_snapshot");
    const replacementSnapshot = await replacementInbox.next();
    assert.equal(replacementSnapshot.type, "transform_snapshot");
    assert.equal(replacementSnapshot.locks.length, 0);

    const released = await staleInbox.next();
    const superseded = await staleInbox.next();
    assert.equal(released.type, "lock_released");
    assert.equal(released.reason, "session_superseded");
    assert.equal(superseded.code, "session_superseded");
    await staleClosed;
    assert.equal(server.activeLockCount, 0);

    replacement.send(JSON.stringify(lockRequest({ requestId: "replacement-lock" })));
    assert.equal((await replacementInbox.next()).type, "lock_granted");
  } finally {
    replacementInbox?.dispose();
    staleInbox.dispose();
    if (replacement) {
      await closeWebSocket(replacement);
    }
    if (stale.readyState !== WebSocket.CLOSED) {
      await closeWebSocket(stale);
    }
  }
});

test("three-editor Presence burst delivers bounded updates without disconnecting", async () => {
  const url = `ws://127.0.0.1:${endpoint.port}${endpoint.wsPath}`;
  const sockets = [
    await openWebSocket(url),
    await openWebSocket(url),
    await openWebSocket(url),
  ];
  const inboxes = sockets.map(createJsonInbox);
  const identities = [
    { userId: "burst-a", userName: "Burst A", userColor: "#64B5F6" },
    { userId: "burst-b", userName: "Burst B", userColor: "#81C784" },
    { userId: "burst-c", userName: "Burst C", userColor: "#FFD54F" },
  ];

  try {
    for (let index = 0; index < sockets.length; index += 1) {
      sockets[index].send(JSON.stringify(presenceHello({
        requestId: `burst-hello-${index}`,
        projectId: "burst-project",
        sessionId: "burst-session",
        ...identities[index],
      })));
      for (let previous = 0; previous < index; previous += 1) {
        assert.equal((await inboxes[previous].next()).type, "user_joined");
      }
      assert.equal((await inboxes[index].next()).type, "hello_ack");
      assert.equal((await inboxes[index].next()).type, "presence_snapshot");
    }

    const updatesPerEditor = 20;
    for (let editor = 0; editor < sockets.length; editor += 1) {
      for (let sequence = 0; sequence < updatesPerEditor; sequence += 1) {
        sockets[editor].send(JSON.stringify(presenceUpdate({
          requestId: `burst-${editor}-${sequence}`,
          userId: identities[editor].userId,
          cameraPosition: { x: editor, y: sequence, z: 0 },
        })));
      }
    }

    const expectedMessages = updatesPerEditor * sockets.length;
    for (const inbox of inboxes) {
      let received = 0;
      while (received < expectedMessages) {
        const message = await inbox.next();
        assert.equal(message.type, "presence_updated");
        received += 1;
      }
    }

    const health = await (await fetch(
      `http://127.0.0.1:${endpoint.port}${endpoint.healthPath}`,
    )).json();
    assert.equal(health.presenceMembers, 3);
  } finally {
    for (const inbox of inboxes) {
      inbox.dispose();
    }
    await Promise.all(sockets.map(closeWebSocket));
  }
});

test("retained Transform and per-connection lock limits reject growth without changing revision", async () => {
  const limitedServer = createTeamForgeServer({
    host: "127.0.0.1",
    port: 0,
    maxRetainedTransforms: 1,
    maxLocksPerConnection: 1,
    maxLocksPerSession: 2,
    logger: silentLogger,
  });
  const limitedEndpoint = await limitedServer.start();
  const socket = await openWebSocket(`ws://127.0.0.1:${limitedEndpoint.port}${limitedEndpoint.wsPath}`);
  const inbox = createJsonInbox(socket);

  try {
    socket.send(JSON.stringify(transformHello({ requestId: "limit-hello", sessionId: "limit-session" })));
    assert.equal((await inbox.next()).type, "hello_ack");
    assert.equal((await inbox.next()).type, "presence_snapshot");
    assert.equal((await inbox.next()).serverRevision, 0);

    socket.send(JSON.stringify(lockRequest({ requestId: "limit-lock-a", objectId: "object-a" })));
    assert.equal((await inbox.next()).type, "lock_granted");
    socket.send(JSON.stringify(transformUpdate({
      requestId: "limit-update-a",
      operationId: "limit-operation-a",
      objectId: "object-a",
    })));
    assert.equal((await inbox.next()).serverRevision, 1);

    socket.send(JSON.stringify(lockRequest({ requestId: "limit-lock-b", objectId: "object-b" })));
    const lockLimit = await inbox.next();
    assert.equal(lockLimit.type, "error");
    assert.equal(lockLimit.code, "connection_lock_limit");

    socket.send(JSON.stringify({
      ...lockRequest({ requestId: "limit-release-a", objectId: "object-a" }),
      type: "lock_release",
    }));
    assert.equal((await inbox.next()).type, "lock_released");
    socket.send(JSON.stringify(lockRequest({ requestId: "limit-lock-b-2", objectId: "object-b" })));
    assert.equal((await inbox.next()).type, "lock_granted");
    socket.send(JSON.stringify(transformUpdate({
      requestId: "limit-update-b",
      operationId: "limit-operation-b",
      objectId: "object-b",
      baseRevision: 1,
    })));
    const objectLimit = await inbox.next();
    assert.equal(objectLimit.type, "error");
    assert.equal(objectLimit.code, "session_object_limit");

    const health = await (await fetch(
      `http://127.0.0.1:${limitedEndpoint.port}${limitedEndpoint.healthPath}`,
    )).json();
    assert.equal(health.retainedTransforms, 1);
    assert.equal(health.activeLocks, 1);
  } finally {
    inbox.dispose();
    await closeWebSocket(socket);
    await limitedServer.stop();
  }
});

test("snapshot byte limit rejects an operation before revision or retained state changes", async () => {
  const snapshotServer = createTeamForgeServer({
    host: "127.0.0.1",
    port: 0,
    maxSnapshotBytes: 600,
    logger: silentLogger,
  });
  const snapshotEndpoint = await snapshotServer.start();
  const socket = await openWebSocket(`ws://127.0.0.1:${snapshotEndpoint.port}${snapshotEndpoint.wsPath}`);
  const inbox = createJsonInbox(socket);
  let late;
  let lateInbox;

  try {
    socket.send(JSON.stringify(transformHello({ requestId: "size-hello", sessionId: "size-session" })));
    assert.equal((await inbox.next()).type, "hello_ack");
    assert.equal((await inbox.next()).type, "presence_snapshot");
    assert.equal((await inbox.next()).serverRevision, 0);
    socket.send(JSON.stringify(lockRequest({ requestId: "size-lock" })));
    assert.equal((await inbox.next()).type, "lock_granted");
    socket.send(JSON.stringify(transformUpdate({ requestId: "size-update", operationId: "size-operation" })));
    const rejected = await inbox.next();
    assert.equal(rejected.type, "error");
    assert.equal(rejected.code, "snapshot_size_limit");

    const health = await (await fetch(
      `http://127.0.0.1:${snapshotEndpoint.port}${snapshotEndpoint.healthPath}`,
    )).json();
    assert.equal(health.retainedTransforms, 0);

    late = await openWebSocket(`ws://127.0.0.1:${snapshotEndpoint.port}${snapshotEndpoint.wsPath}`);
    lateInbox = createJsonInbox(late);
    late.send(JSON.stringify(transformHello({
      requestId: "size-late",
      sessionId: "size-session",
      userId: "editor-b",
      userName: "Editor B",
      userColor: "#81C784",
    })));
    assert.equal((await inbox.next()).type, "user_joined");
    assert.equal((await lateInbox.next()).type, "hello_ack");
    assert.equal((await lateInbox.next()).type, "presence_snapshot");
    const snapshot = await lateInbox.next();
    assert.equal(snapshot.serverRevision, 0);
    assert.deepEqual(snapshot.transforms, []);
  } finally {
    lateInbox?.dispose();
    inbox.dispose();
    if (late) {
      await closeWebSocket(late);
    }
    await closeWebSocket(socket);
    await snapshotServer.stop();
  }
});

test("a current lock owner may submit a stale session base revision after handoff", async () => {
  const url = `ws://127.0.0.1:${endpoint.port}${endpoint.wsPath}`;
  const editorA = await openWebSocket(url);
  const editorB = await openWebSocket(url);
  const inboxA = createJsonInbox(editorA);
  const inboxB = createJsonInbox(editorB);

  try {
    editorA.send(JSON.stringify(transformHello({ requestId: "stale-object-a", sessionId: "stale-object" })));
    assert.equal((await inboxA.next()).type, "hello_ack");
    assert.equal((await inboxA.next()).type, "presence_snapshot");
    assert.equal((await inboxA.next()).type, "transform_snapshot");

    editorB.send(JSON.stringify(transformHello({
      requestId: "stale-object-b",
      sessionId: "stale-object",
      userId: "editor-b",
      userName: "Editor B",
      userColor: "#81C784",
    })));
    assert.equal((await inboxA.next()).type, "user_joined");
    assert.equal((await inboxB.next()).type, "hello_ack");
    assert.equal((await inboxB.next()).type, "presence_snapshot");
    assert.equal((await inboxB.next()).type, "transform_snapshot");

    editorA.send(JSON.stringify(lockRequest({ requestId: "stale-lock-a" })));
    assert.equal((await inboxA.next()).type, "lock_granted");
    assert.equal((await inboxB.next()).type, "lock_state_changed");
    editorA.send(JSON.stringify(transformUpdate({ requestId: "stale-write-a", operationId: "stale-write-a" })));
    assert.equal((await inboxA.next()).serverRevision, 1);
    assert.equal((await inboxB.next()).serverRevision, 1);
    editorA.send(JSON.stringify({ ...lockRequest({ requestId: "stale-release-a" }), type: "lock_release" }));
    assert.equal((await inboxA.next()).type, "lock_released");
    assert.equal((await inboxB.next()).type, "lock_released");

    editorB.send(JSON.stringify(lockRequest({ requestId: "stale-lock-b", userId: "editor-b" })));
    assert.equal((await inboxB.next()).type, "lock_granted");
    assert.equal((await inboxA.next()).type, "lock_state_changed");
    editorB.send(JSON.stringify(transformUpdate({
      requestId: "stale-write-b",
      operationId: "stale-write-b",
      userId: "editor-b",
      baseRevision: 0,
      localPosition: { x: 99, y: 99, z: 99 },
    })));
    const applied = await inboxB.next();
    assert.equal(applied.type, "transform_applied");
    assert.equal(applied.serverRevision, 2);
    assert.deepEqual(applied.localPosition, { x: 99, y: 99, z: 99 });
    assert.equal((await inboxA.next()).serverRevision, 2);
  } finally {
    inboxA.dispose();
    inboxB.dispose();
    await Promise.all([closeWebSocket(editorA), closeWebSocket(editorB)]);
  }
});

test("connections that omit Hello release their capacity after the configured timeout", async () => {
  const timeoutServer = createTeamForgeServer({
    host: "127.0.0.1",
    port: 0,
    maxConnections: 1,
    helloTimeoutMilliseconds: 40,
    heartbeatIntervalMilliseconds: 1_000,
    heartbeatTimeoutMilliseconds: 2_000,
    logger: silentLogger,
  });
  const timeoutEndpoint = await timeoutServer.start();
  const url = `ws://127.0.0.1:${timeoutEndpoint.port}${timeoutEndpoint.wsPath}`;
  const idle = await openWebSocket(url);

  try {
    assert.equal(await rejectedUpgradeStatus(url), 503);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Hello timeout did not close the socket.")), 500);
      idle.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    const replacement = await openWebSocket(url);
    await closeWebSocket(replacement);
  } finally {
    if (idle.readyState !== WebSocket.CLOSED) {
      idle.terminate();
    }
    await timeoutServer.stop();
  }
});

test("WebSocket heartbeat terminates a non-pong client and releases its lock", async () => {
  const heartbeatServer = createTeamForgeServer({
    host: "127.0.0.1",
    port: 0,
    helloTimeoutMilliseconds: 1_000,
    heartbeatIntervalMilliseconds: 20,
    heartbeatTimeoutMilliseconds: 70,
    logger: silentLogger,
  });
  const heartbeatEndpoint = await heartbeatServer.start();
  const socket = await openWebSocket(
    `ws://127.0.0.1:${heartbeatEndpoint.port}${heartbeatEndpoint.wsPath}`,
    { autoPong: false },
  );
  const inbox = createJsonInbox(socket);

  try {
    socket.send(JSON.stringify(transformHello({ requestId: "heartbeat-hello", sessionId: "heartbeat-session" })));
    assert.equal((await inbox.next()).type, "hello_ack");
    assert.equal((await inbox.next()).type, "presence_snapshot");
    assert.equal((await inbox.next()).type, "transform_snapshot");
    socket.send(JSON.stringify(lockRequest({ requestId: "heartbeat-lock" })));
    assert.equal((await inbox.next()).type, "lock_granted");
    assert.equal(heartbeatServer.activeLockCount, 1);

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Heartbeat timeout did not close the socket.")), 500);
      socket.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(heartbeatServer.activeLockCount, 0);
  } finally {
    inbox.dispose();
    if (socket.readyState !== WebSocket.CLOSED) {
      socket.terminate();
    }
    await heartbeatServer.stop();
  }
});
test("Hierarchy parent/subtree locks fail closed and delete clears stale Presence selection", async () => {
  const url = `ws://127.0.0.1:${endpoint.port}${endpoint.wsPath}`;
  const editorA = await openWebSocket(url);
  const editorB = await openWebSocket(url);
  const inboxA = createJsonInbox(editorA);
  const inboxB = createJsonInbox(editorB);
  const sessionId = "hierarchy-lock-selection-session";
  const rootId = "GlobalObjectId_V1-2-scene-guid-300-0";
  const childId = "GlobalObjectId_V1-2-scene-guid-301-0";

  try {
    editorA.send(JSON.stringify(hierarchyHello({ requestId: "hierarchy-lock-a", sessionId })));
    assert.equal((await inboxA.next()).type, "hello_ack");
    assert.equal((await inboxA.next()).type, "presence_snapshot");
    assert.equal((await inboxA.next()).type, "hierarchy_snapshot");
    assert.equal((await inboxA.next()).type, "transform_snapshot");

    editorA.send(JSON.stringify(hierarchySeed({
      requestId: "hierarchy-lock-seed",
      objects: [
        hierarchyRecord({ objectId: rootId, name: "Root", siblingIndex: 0 }),
        hierarchyRecord({ objectId: childId, name: "Child", parentObjectId: rootId, siblingIndex: 0 }),
      ],
    })));
    assert.equal((await inboxA.next()).type, "hierarchy_seed_accepted");

    editorB.send(JSON.stringify(hierarchyHello({
      requestId: "hierarchy-lock-b",
      sessionId,
      userId: "editor-b",
      userName: "Editor B",
      userColor: "#81C784",
    })));
    assert.equal((await inboxA.next()).type, "user_joined");
    assert.equal((await inboxB.next()).type, "hello_ack");
    assert.equal((await inboxB.next()).type, "presence_snapshot");
    assert.equal((await inboxB.next()).type, "hierarchy_snapshot");
    assert.equal((await inboxB.next()).type, "transform_snapshot");

    editorB.send(JSON.stringify(lockRequest({
      requestId: "lock-child-by-b",
      userId: "editor-b",
      objectId: childId,
    })));
    assert.equal((await inboxB.next()).type, "lock_granted");
    assert.equal((await inboxA.next()).type, "lock_state_changed");

    editorA.send(JSON.stringify(hierarchyOperation("delete_object", {
      requestId: "delete-root-subtree-locked",
      operationId: "delete-root-subtree-locked",
      objectId: rootId,
      baseRevision: 0,
    })));
    const subtreeConflict = await inboxA.next();
    assert.equal(subtreeConflict.type, "hierarchy_conflict");
    assert.equal(subtreeConflict.reason, "subtree_locked_by_other_user");
    assert.equal(subtreeConflict.serverRevision, 0);

    editorB.send(JSON.stringify({
      ...lockRequest({ requestId: "release-child-by-b", userId: "editor-b", objectId: childId }),
      type: "lock_release",
    }));
    assert.equal((await inboxB.next()).type, "lock_released");
    assert.equal((await inboxA.next()).type, "lock_released");

    editorB.send(JSON.stringify(lockRequest({
      requestId: "lock-root-parent-by-b",
      userId: "editor-b",
      objectId: rootId,
    })));
    assert.equal((await inboxB.next()).type, "lock_granted");
    assert.equal((await inboxA.next()).type, "lock_state_changed");

    editorA.send(JSON.stringify(hierarchyOperation("create_object", {
      requestId: "create-under-locked-parent",
      operationId: "create-under-locked-parent",
      objectId: "tf:cccccccccccccccccccccccccccccccc",
      baseRevision: 0,
      parentObjectId: rootId,
      siblingIndex: 1,
    })));
    const parentConflict = await inboxA.next();
    assert.equal(parentConflict.type, "hierarchy_conflict");
    assert.equal(parentConflict.reason, "parent_locked_by_other_user");
    assert.equal(parentConflict.serverRevision, 0);

    editorB.send(JSON.stringify({
      ...lockRequest({ requestId: "release-root-by-b", userId: "editor-b", objectId: rootId }),
      type: "lock_release",
    }));
    assert.equal((await inboxB.next()).type, "lock_released");
    assert.equal((await inboxA.next()).type, "lock_released");

    editorA.send(JSON.stringify(presenceUpdate({
      requestId: "select-root-before-delete",
      selectedObjectId: rootId,
      selectedObjectName: "Root",
    })));
    assert.equal((await inboxA.next()).type, "presence_updated");
    assert.equal((await inboxB.next()).type, "presence_updated");

    editorA.send(JSON.stringify(hierarchyOperation("delete_object", {
      requestId: "delete-root-after-unlock",
      operationId: "delete-root-after-unlock",
      objectId: rootId,
      baseRevision: 0,
    })));
    const appliedA = await inboxA.next();
    const appliedB = await inboxB.next();
    assert.equal(appliedA.type, "hierarchy_applied");
    assert.equal(appliedB.type, "hierarchy_applied");
    assert.deepEqual(new Set(appliedA.deletedObjectIds), new Set([rootId, childId]));

    const clearedA = await inboxA.next();
    const clearedB = await inboxB.next();
    assert.equal(clearedA.type, "presence_updated");
    assert.equal(clearedB.type, "presence_updated");
    assert.equal(clearedA.presence.userId, "editor-a");
    assert.equal(clearedA.presence.selectedObjectId, "");
    assert.equal(clearedA.presence.selectedObjectName, "");
  } finally {
    inboxA.dispose();
    inboxB.dispose();
    await Promise.all([closeWebSocket(editorA), closeWebSocket(editorB)]);
  }
});

test("Transform updates keep authoritative Hierarchy transforms current across rename and late join", async () => {
  const url = `ws://127.0.0.1:${endpoint.port}${endpoint.wsPath}`;
  const socket = await openWebSocket(url);
  const inbox = createJsonInbox(socket);
  const targetId = "GlobalObjectId_V1-2-scene-guid-100-0";
  let lateJoiner = null;
  let lateInbox = null;

  try {
    socket.send(JSON.stringify(hierarchyHello({
      requestId: "hierarchy-transform-coherence-hello",
      sessionId: "hierarchy-transform-coherence-session",
    })));
    assert.equal((await inbox.next()).type, "hello_ack");
    assert.equal((await inbox.next()).type, "presence_snapshot");
    assert.equal((await inbox.next()).type, "hierarchy_snapshot");
    assert.equal((await inbox.next()).type, "transform_snapshot");

    socket.send(JSON.stringify(hierarchySeed({ requestId: "hierarchy-transform-coherence-seed" })));
    assert.equal((await inbox.next()).type, "hierarchy_seed_accepted");

    socket.send(JSON.stringify(lockRequest({
      requestId: "hierarchy-transform-coherence-lock",
      objectId: targetId,
    })));
    assert.equal((await inbox.next()).type, "lock_granted");

    const liveTransform = { x: 7.25, y: 8.5, z: 9.75 };
    socket.send(JSON.stringify(transformUpdate({
      requestId: "hierarchy-transform-coherence-update",
      operationId: "hierarchy-transform-coherence-operation",
      objectId: targetId,
      baseRevision: 0,
      localPosition: liveTransform,
    })));
    const transformed = await inbox.next();
    assert.equal(transformed.type, "transform_applied");
    assert.equal(transformed.serverRevision, 1);

    socket.send(JSON.stringify(hierarchyOperation("rename_object", {
      requestId: "hierarchy-transform-coherence-rename",
      operationId: "hierarchy-transform-coherence-rename-operation",
      objectId: targetId,
      baseRevision: 1,
      name: "Renamed After Transform",
    })));
    const renamed = await inbox.next();
    assert.equal(renamed.type, "hierarchy_applied");
    assert.equal(renamed.serverRevision, 2);
    const renamedRecord = renamed.changedObjects.find((item) => item.objectId === targetId);
    assert.ok(renamedRecord);
    assert.deepEqual(renamedRecord.localPosition, liveTransform);

    lateJoiner = await openWebSocket(url);
    lateInbox = createJsonInbox(lateJoiner);
    lateJoiner.send(JSON.stringify(hierarchyHello({
      requestId: "hierarchy-transform-coherence-late-hello",
      userId: "editor-b",
      userName: "Editor B",
      sessionId: "hierarchy-transform-coherence-session",
    })));
    assert.equal((await lateInbox.next()).type, "hello_ack");
    assert.equal((await lateInbox.next()).type, "presence_snapshot");
    const hierarchySnapshot = await lateInbox.next();
    assert.equal(hierarchySnapshot.type, "hierarchy_snapshot");
    const snapshotRecord = hierarchySnapshot.objects.find((item) => item.objectId === targetId);
    assert.ok(snapshotRecord);
    assert.deepEqual(snapshotRecord.localPosition, liveTransform);
    const transformSnapshot = await lateInbox.next();
    assert.equal(transformSnapshot.type, "transform_snapshot");
    assert.deepEqual(
      transformSnapshot.transforms.find((item) => item.objectId === targetId).localPosition,
      liveTransform,
    );
  } finally {
    lateInbox?.dispose();
    inbox.dispose();
    if (lateJoiner) {
      await closeWebSocket(lateJoiner);
    }
    await closeWebSocket(socket);
  }
});

test("WP1 golden capability matrix freezes all sixteen Hello outcomes and snapshot orders", async () => {
  const url = `ws://127.0.0.1:${endpoint.port}${endpoint.wsPath}`;

  for (const entry of goldenCompatibility.capabilityMatrix) {
    const socket = await openWebSocket(url);
    const inbox = createJsonInbox(socket);
    try {
      socket.send(JSON.stringify({
        type: "hello",
        protocolVersion: goldenCompatibility.realtimeProtocolVersion,
        requestId: `golden-capability-${entry.id}`,
        userName: `Golden ${entry.id}`,
        userId: `golden-user-${entry.id}`,
        userColor: "#64B5F6",
        projectId: `golden-capability-project-${entry.id}`,
        sessionId: `golden-capability-session-${entry.id}`,
        supportsPresence: entry.presence,
        supportsTransformSync: entry.transform,
        supportsHierarchySync: entry.hierarchy,
        supportsProjectTransfer: entry.project,
      }));

      const messages = [];
      for (let index = 0; index < entry.expectedMessages.length; index += 1) {
        messages.push(await inbox.next());
      }
      assert.deepEqual(
        messages.map((message) => message.type === "error" ? `error:${message.code}` : message.type),
        entry.expectedMessages,
        entry.id,
      );

      if (entry.accepted) {
        const acknowledgement = messages[0];
        assert.equal(acknowledgement.presenceEnabled, entry.presence, entry.id);
        assert.equal(acknowledgement.transformSyncEnabled, entry.transform, entry.id);
        assert.equal(acknowledgement.hierarchySyncEnabled, entry.hierarchy, entry.id);
        assert.equal(acknowledgement.projectTransferEnabled, entry.project, entry.id);
        socket.send(JSON.stringify({
          type: "ping",
          protocolVersion: 1,
          requestId: `golden-capability-ping-${entry.id}`,
          clientTimestampUnixMs: 1_786_000_000_000,
        }));
        assert.equal((await inbox.next()).type, "pong", entry.id);
      } else {
        assert.equal(messages[0].message, entry.errorDetail, entry.id);
        socket.send(JSON.stringify({
          type: "hello",
          protocolVersion: 1,
          requestId: `golden-capability-recovery-${entry.id}`,
          userName: `Golden recovery ${entry.id}`,
          projectId: `golden-capability-project-${entry.id}`,
          sessionId: `golden-capability-session-${entry.id}`,
          supportsPresence: false,
          supportsTransformSync: false,
          supportsHierarchySync: false,
          supportsProjectTransfer: false,
        }));
        assert.equal((await inbox.next()).type, "hello_ack", entry.id);
      }
    } finally {
      inbox.dispose();
      await closeWebSocket(socket);
    }
  }
});

test("WP1 golden authority traces freeze stale-base, exact-base, and operation ID behavior", async () => {
  const url = `ws://127.0.0.1:${endpoint.port}${endpoint.wsPath}`;
  const transformSocket = await openWebSocket(url);
  const transformInbox = createJsonInbox(transformSocket);
  const hierarchySocket = await openWebSocket(url);
  const hierarchyInbox = createJsonInbox(hierarchySocket);

  try {
    transformSocket.send(JSON.stringify(transformHello({
      requestId: "golden-transform-hello",
      sessionId: "golden-transform-authority-session",
    })));
    assert.deepEqual([
      (await transformInbox.next()).type,
      (await transformInbox.next()).type,
      (await transformInbox.next()).type,
    ], ["hello_ack", "presence_snapshot", "transform_snapshot"]);

    const transformTrace = [];
    transformSocket.send(JSON.stringify(lockRequest({ requestId: "golden-transform-lock" })));
    transformTrace.push((await transformInbox.next()).type);

    const first = transformUpdate({
      requestId: "golden-transform-first",
      operationId: "golden-transform-operation-1",
      baseRevision: 0,
    });
    transformSocket.send(JSON.stringify(first));
    let message = await transformInbox.next();
    transformTrace.push(`${message.type}@${message.serverRevision}`);

    const stale = transformUpdate({
      requestId: "golden-transform-stale",
      operationId: "golden-transform-operation-2",
      baseRevision: 0,
      localPosition: { x: 4, y: 5, z: 6 },
    });
    transformSocket.send(JSON.stringify(stale));
    message = await transformInbox.next();
    transformTrace.push(`${message.type}@${message.serverRevision}`);

    transformSocket.send(JSON.stringify({ ...stale, requestId: "golden-transform-replay" }));
    message = await transformInbox.next();
    transformTrace.push(`${message.type}@${message.serverRevision}`);

    transformSocket.send(JSON.stringify({
      ...stale,
      requestId: "golden-transform-operation-conflict",
      localPosition: { x: 99, y: 99, z: 99 },
    }));
    message = await transformInbox.next();
    transformTrace.push(`${message.type}:${message.code}`);
    assert.deepEqual(
      transformTrace,
      goldenCompatibility.authorityTraces.transformStaleBaseAndIdempotence,
    );

    hierarchySocket.send(JSON.stringify(hierarchyHello({
      requestId: "golden-hierarchy-hello",
      sessionId: "golden-hierarchy-authority-session",
    })));
    assert.deepEqual([
      (await hierarchyInbox.next()).type,
      (await hierarchyInbox.next()).type,
      (await hierarchyInbox.next()).type,
      (await hierarchyInbox.next()).type,
    ], ["hello_ack", "presence_snapshot", "hierarchy_snapshot", "transform_snapshot"]);

    const hierarchyTrace = [];
    hierarchySocket.send(JSON.stringify(hierarchySeed({
      requestId: "golden-hierarchy-seed",
      objects: [hierarchyRecord()],
    })));
    message = await hierarchyInbox.next();
    hierarchyTrace.push(`${message.type}@${message.serverRevision}`);

    const create = hierarchyOperation("create_object", {
      requestId: "golden-hierarchy-create",
      operationId: "golden-hierarchy-operation-1",
      baseRevision: 0,
    });
    hierarchySocket.send(JSON.stringify(create));
    message = await hierarchyInbox.next();
    hierarchyTrace.push(`${message.type}@${message.serverRevision}`);

    hierarchySocket.send(JSON.stringify(hierarchyOperation("rename_object", {
      requestId: "golden-hierarchy-stale",
      operationId: "golden-hierarchy-operation-2",
      baseRevision: 0,
    })));
    message = await hierarchyInbox.next();
    hierarchyTrace.push(`${message.type}:${message.reason}@${message.serverRevision}`);

    hierarchySocket.send(JSON.stringify({ ...create, requestId: "golden-hierarchy-replay" }));
    message = await hierarchyInbox.next();
    hierarchyTrace.push(`${message.type}@${message.serverRevision}`);

    hierarchySocket.send(JSON.stringify({
      ...create,
      requestId: "golden-hierarchy-operation-conflict",
      name: "Different Create",
    }));
    message = await hierarchyInbox.next();
    hierarchyTrace.push(`${message.type}:${message.code}`);
    assert.deepEqual(
      hierarchyTrace,
      goldenCompatibility.authorityTraces.hierarchyExactBaseAndIdempotence,
    );
  } finally {
    transformInbox.dispose();
    hierarchyInbox.dispose();
    await Promise.all([closeWebSocket(transformSocket), closeWebSocket(hierarchySocket)]);
  }
});

test("WP1 golden lock lifecycle traces freeze expiry, supersede, and disconnect ordering", async (context) => {
  await context.test("lease expiry", async () => {
    const leaseServer = createTeamForgeServer({
      host: "127.0.0.1",
      port: 0,
      lockLeaseMilliseconds: 80,
      logger: silentLogger,
    });
    const leaseEndpoint = await leaseServer.start();
    const url = `ws://127.0.0.1:${leaseEndpoint.port}${leaseEndpoint.wsPath}`;
    const owner = await openWebSocket(url);
    const observer = await openWebSocket(url);
    const ownerInbox = createJsonInbox(owner);
    const observerInbox = createJsonInbox(observer);
    try {
      owner.send(JSON.stringify(transformHello({ requestId: "golden-expiry-owner", sessionId: "golden-expiry" })));
      await ownerInbox.next(); await ownerInbox.next(); await ownerInbox.next();
      observer.send(JSON.stringify(transformHello({
        requestId: "golden-expiry-observer",
        sessionId: "golden-expiry",
        userId: "golden-expiry-observer",
        userName: "Golden Observer",
      })));
      assert.equal((await ownerInbox.next()).type, "user_joined");
      await observerInbox.next(); await observerInbox.next(); await observerInbox.next();
      owner.send(JSON.stringify(lockRequest({ requestId: "golden-expiry-lock" })));
      assert.equal((await ownerInbox.next()).type, "lock_granted");
      const changed = await observerInbox.next();
      const released = await observerInbox.next();
      assert.deepEqual(
        [changed.type, `${released.type}:${released.reason}`],
        goldenCompatibility.authorityTraces.lockExpiryObserver,
      );
    } finally {
      ownerInbox.dispose(); observerInbox.dispose();
      await Promise.all([closeWebSocket(owner), closeWebSocket(observer)]);
      await leaseServer.stop();
    }
  });

  await context.test("same-user supersede", async () => {
    const url = `ws://127.0.0.1:${endpoint.port}${endpoint.wsPath}`;
    const stale = await openWebSocket(url);
    const staleInbox = createJsonInbox(stale);
    let replacement;
    let replacementInbox;
    try {
      stale.send(JSON.stringify(transformHello({
        requestId: "golden-supersede-stale",
        sessionId: "golden-supersede",
      })));
      await staleInbox.next(); await staleInbox.next(); await staleInbox.next();
      stale.send(JSON.stringify(lockRequest({ requestId: "golden-supersede-lock" })));
      assert.equal((await staleInbox.next()).type, "lock_granted");

      replacement = await openWebSocket(url);
      replacementInbox = createJsonInbox(replacement);
      replacement.send(JSON.stringify(transformHello({
        requestId: "golden-supersede-replacement",
        sessionId: "golden-supersede",
      })));
      await replacementInbox.next(); await replacementInbox.next(); await replacementInbox.next();
      const released = await staleInbox.next();
      const superseded = await staleInbox.next();
      assert.deepEqual(
        [`${released.type}:${released.reason}`, `${superseded.type}:${superseded.code}`],
        goldenCompatibility.authorityTraces.lockSupersedeOwner,
      );
    } finally {
      replacementInbox?.dispose(); staleInbox.dispose();
      if (replacement) await closeWebSocket(replacement);
      if (stale.readyState !== WebSocket.CLOSED) await closeWebSocket(stale);
    }
  });

  await context.test("connection close", async () => {
    const url = `ws://127.0.0.1:${endpoint.port}${endpoint.wsPath}`;
    const owner = await openWebSocket(url);
    const observer = await openWebSocket(url);
    const ownerInbox = createJsonInbox(owner);
    const observerInbox = createJsonInbox(observer);
    try {
      owner.send(JSON.stringify(transformHello({ requestId: "golden-close-owner", sessionId: "golden-close" })));
      await ownerInbox.next(); await ownerInbox.next(); await ownerInbox.next();
      observer.send(JSON.stringify(transformHello({
        requestId: "golden-close-observer",
        sessionId: "golden-close",
        userId: "golden-close-observer",
        userName: "Golden Observer",
      })));
      assert.equal((await ownerInbox.next()).type, "user_joined");
      await observerInbox.next(); await observerInbox.next(); await observerInbox.next();
      owner.send(JSON.stringify(lockRequest({ requestId: "golden-close-lock" })));
      assert.equal((await ownerInbox.next()).type, "lock_granted");
      const changed = await observerInbox.next();
      await closeWebSocket(owner);
      const released = await observerInbox.next();
      const left = await observerInbox.next();
      assert.deepEqual(
        [changed.type, `${released.type}:${released.reason}`, left.type],
        goldenCompatibility.authorityTraces.lockDisconnectObserver,
      );
    } finally {
      ownerInbox.dispose(); observerInbox.dispose();
      if (owner.readyState !== WebSocket.CLOSED) await closeWebSocket(owner);
      await closeWebSocket(observer);
    }
  });
});

test("WP1 golden hierarchy delete freezes lock, apply, and Presence cleanup ordering", async () => {
  const url = `ws://127.0.0.1:${endpoint.port}${endpoint.wsPath}`;
  const socket = await openWebSocket(url);
  const inbox = createJsonInbox(socket);
  const targetId = "GlobalObjectId_V1-2-scene-guid-900-0";
  try {
    socket.send(JSON.stringify(hierarchyHello({
      requestId: "golden-delete-hello",
      sessionId: "golden-delete-cleanup",
    })));
    await inbox.next(); await inbox.next(); await inbox.next(); await inbox.next();
    socket.send(JSON.stringify(hierarchySeed({
      requestId: "golden-delete-seed",
      objects: [hierarchyRecord({ objectId: targetId, name: "Golden Target" })],
    })));
    assert.equal((await inbox.next()).type, "hierarchy_seed_accepted");
    socket.send(JSON.stringify(presenceUpdate({
      requestId: "golden-delete-selection",
      selectedObjectId: targetId,
      selectedObjectName: "Golden Target",
    })));
    assert.equal((await inbox.next()).type, "presence_updated");
    socket.send(JSON.stringify(lockRequest({
      requestId: "golden-delete-lock",
      objectId: targetId,
    })));
    assert.equal((await inbox.next()).type, "lock_granted");
    socket.send(JSON.stringify(hierarchyOperation("delete_object", {
      requestId: "golden-delete-operation",
      operationId: "golden-delete-operation",
      objectId: targetId,
      baseRevision: 0,
    })));
    const released = await inbox.next();
    const applied = await inbox.next();
    const presence = await inbox.next();
    assert.equal(presence.presence.selectedObjectId, "");
    assert.deepEqual(
      [
        `${released.type}:${released.reason}`,
        `${applied.type}@${applied.serverRevision}`,
        `${presence.type}:selection-cleared`,
      ],
      goldenCompatibility.authorityTraces.deleteCleanupOwner,
    );
  } finally {
    inbox.dispose();
    await closeWebSocket(socket);
  }
});

});
