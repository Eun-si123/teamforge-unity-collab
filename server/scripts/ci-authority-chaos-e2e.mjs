import fs from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";

const endpoint = process.env.TEAMFORGE_CI_WS_URL ?? "ws://127.0.0.1:5080/ws";
const outputDir = path.resolve(process.cwd(), "test-results", "authority-chaos-e2e");
const resultPath = path.join(outputDir, "authority-chaos-result.json");
fs.mkdirSync(outputDir, { recursive: true });
fs.rmSync(resultPath, { force: true });

const projectId = "ci-authority-chaos-project";
const sessionId = "ci-authority-chaos-session";
const sceneId = "ci-authority-chaos-scene";
const rootId = "GlobalObjectId_V1-2-ci-authority-chaos-root";
const childId = "GlobalObjectId_V1-2-ci-authority-chaos-child";

function transformFields(x, y, z) {
  return {
    localPosition: { x, y, z },
    localRotation: { x: 0, y: 0, z: 0, w: 1 },
    localScale: { x: 1, y: 1, z: 1 },
  };
}

class Peer {
  constructor(userId, userName, userColor) {
    this.userId = userId;
    this.userName = userName;
    this.userColor = userColor;
    this.socket = null;
    this.inbox = [];
    this.waiters = [];
    this.connectionId = "";
    this.closed = false;
  }

  async connect() {
    this.socket = new WebSocket(endpoint);
    this.socket.on("message", (data) => {
      const message = JSON.parse(data.toString("utf8"));
      this.inbox.push(message);
      const waiters = this.waiters.splice(0);
      for (const wake of waiters) wake();
    });
    this.socket.on("close", () => {
      this.closed = true;
      const waiters = this.waiters.splice(0);
      for (const wake of waiters) wake();
    });
    await new Promise((resolve, reject) => {
      this.socket.once("open", resolve);
      this.socket.once("error", reject);
    });

    const requestId = `hello-${this.userId}-${Date.now()}`;
    this.send({
      type: "hello",
      protocolVersion: 1,
      requestId,
      userName: this.userName,
      userId: this.userId,
      userColor: this.userColor,
      projectId,
      sessionId,
      supportsPresence: true,
      supportsTransformSync: true,
      supportsHierarchySync: true,
      supportsProjectTransfer: false,
    });
    const ack = await this.waitFor(
      (message) => message?.type === "hello_ack" && message.requestId === requestId,
      `${this.userId} hello_ack`,
    );
    this.connectionId = ack.connectionId;
    if (!ack.presenceEnabled || !ack.transformSyncEnabled || !ack.hierarchySyncEnabled) {
      throw new Error(`${this.userId} did not negotiate all authority capabilities.`);
    }
    await this.waitFor((message) => message?.type === "presence_snapshot", `${this.userId} presence_snapshot`);
    await this.waitFor((message) => message?.type === "hierarchy_snapshot", `${this.userId} hierarchy_snapshot`);
    await this.waitFor((message) => message?.type === "transform_snapshot", `${this.userId} transform_snapshot`);
    return ack;
  }

  send(message) {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error(`${this.userId} socket is not open.`);
    }
    this.socket.send(JSON.stringify(message));
  }

  async waitFor(predicate, label, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const index = this.inbox.findIndex(predicate);
      if (index >= 0) return this.inbox.splice(index, 1)[0];
      if (this.closed) throw new Error(`${this.userId} closed while waiting for ${label}.`);
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 100);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    throw new Error(`Timed out waiting for ${label} on ${this.userId}.`);
  }

  close() {
    try {
      this.socket?.close();
    } catch {
      // Best effort cleanup.
    }
  }
}

const evidence = [];
function record(name, message = null) {
  evidence.push({ name, observedAt: new Date().toISOString(), message });
  console.info(`PASS: ${name}`);
}

const a = new Peer("chaos-a", "Chaos A", "#EF5350");
const b = new Peer("chaos-b", "Chaos B", "#42A5F5");
const c = new Peer("chaos-c", "Chaos C", "#66BB6A");
let b2 = null;

try {
  await a.connect();
  await b.connect();
  await c.connect();

  a.send({
    type: "hierarchy_seed",
    protocolVersion: 1,
    requestId: "chaos-seed",
    userId: a.userId,
    sceneId,
    baseRevision: 0,
    objects: [
      {
        objectId: rootId,
        name: "Chaos Root",
        parentObjectId: "",
        siblingIndex: 0,
        ...transformFields(0, 0, 0),
      },
      {
        objectId: childId,
        name: "Chaos Child",
        parentObjectId: rootId,
        siblingIndex: 0,
        ...transformFields(1, 2, 3),
      },
    ],
  });
  const seedAccepted = await a.waitFor(
    (message) => message?.type === "hierarchy_seed_accepted" && message.requestId === "chaos-seed",
    "hierarchy seed acceptance",
  );
  record("clean hierarchy seed accepted", seedAccepted);

  a.send({
    type: "lock_request",
    protocolVersion: 1,
    requestId: "chaos-a-lock",
    userId: a.userId,
    sceneId,
    objectId: childId,
  });
  const aLock = await a.waitFor(
    (message) => message?.type === "lock_granted" && message.requestId === "chaos-a-lock",
    "A lock grant",
  );
  record("A acquired object lock", aLock);

  b.send({
    type: "lock_request",
    protocolVersion: 1,
    requestId: "chaos-b-lock-denied",
    userId: b.userId,
    sceneId,
    objectId: childId,
  });
  const bDenied = await b.waitFor(
    (message) => message?.type === "lock_denied" && message.requestId === "chaos-b-lock-denied",
    "B lock denial",
  );
  if (bDenied.reason !== "locked_by_other_user" || bDenied.lockState?.ownerUserId !== a.userId) {
    throw new Error("B lock denial did not preserve A authority.");
  }
  record("competing lock denied", bDenied);

  b.send({
    type: "transform_update",
    protocolVersion: 1,
    requestId: "chaos-b-transform-without-lock",
    operationId: "chaos-b-transform-without-lock-op",
    userId: b.userId,
    sceneId,
    objectId: childId,
    baseRevision: 0,
    ...transformFields(9, 9, 9),
  });
  const bNoLock = await b.waitFor(
    (message) => message?.type === "error" && message.requestId === "chaos-b-transform-without-lock",
    "lock_required error",
  );
  if (bNoLock.code !== "lock_required") throw new Error(`Expected lock_required, received ${bNoLock.code}.`);
  record("transform without lock rejected", bNoLock);

  b.send({
    type: "hierarchy_operation",
    protocolVersion: 1,
    requestId: "chaos-b-rename-locked",
    operationId: "chaos-b-rename-locked-op",
    userId: b.userId,
    kind: "rename_object",
    sceneId,
    objectId: childId,
    baseRevision: 0,
    name: "Unauthorized Rename",
  });
  const bHierarchyDenied = await b.waitFor(
    (message) => message?.type === "hierarchy_conflict" && message.requestId === "chaos-b-rename-locked",
    "locked hierarchy conflict",
  );
  if (bHierarchyDenied.reason !== "locked_by_other_user") {
    throw new Error(`Expected locked_by_other_user hierarchy conflict, received ${bHierarchyDenied.reason}.`);
  }
  record("locked hierarchy edit rejected", bHierarchyDenied);

  a.send({
    type: "transform_update",
    protocolVersion: 1,
    requestId: "chaos-a-transform-1",
    operationId: "chaos-transform-op-1",
    userId: a.userId,
    sceneId,
    objectId: childId,
    baseRevision: 0,
    ...transformFields(4, 5, 6),
  });
  const firstApplied = await a.waitFor(
    (message) => message?.type === "transform_applied" && message.requestId === "chaos-a-transform-1",
    "A transform apply",
  );
  if (firstApplied.serverRevision !== 1) throw new Error(`Expected revision 1, received ${firstApplied.serverRevision}.`);
  record("authorized transform applied", firstApplied);

  a.send({
    type: "transform_update",
    protocolVersion: 1,
    requestId: "chaos-a-replay-same",
    operationId: "chaos-transform-op-1",
    userId: a.userId,
    sceneId,
    objectId: childId,
    baseRevision: 0,
    ...transformFields(4, 5, 6),
  });
  const replayed = await a.waitFor(
    (message) => message?.type === "transform_applied" && message.requestId === "chaos-a-replay-same",
    "idempotent transform replay",
  );
  if (replayed.serverRevision !== 1) throw new Error("Idempotent replay advanced revision unexpectedly.");
  record("identical operation replay remained idempotent", replayed);

  a.send({
    type: "transform_update",
    protocolVersion: 1,
    requestId: "chaos-a-replay-conflict",
    operationId: "chaos-transform-op-1",
    userId: a.userId,
    sceneId,
    objectId: childId,
    baseRevision: 0,
    ...transformFields(44, 55, 66),
  });
  const operationConflict = await a.waitFor(
    (message) => message?.type === "error" && message.requestId === "chaos-a-replay-conflict",
    "operation ID conflict",
  );
  if (operationConflict.code !== "operation_id_conflict") {
    throw new Error(`Expected operation_id_conflict, received ${operationConflict.code}.`);
  }
  record("operation ID payload conflict rejected", operationConflict);

  a.send({
    type: "transform_update",
    protocolVersion: 1,
    requestId: "chaos-a-revision-ahead",
    operationId: "chaos-revision-ahead-op",
    userId: a.userId,
    sceneId,
    objectId: childId,
    baseRevision: 999,
    ...transformFields(7, 8, 9),
  });
  const revisionAhead = await a.waitFor(
    (message) => message?.type === "error" && message.requestId === "chaos-a-revision-ahead",
    "revision_ahead error",
  );
  if (revisionAhead.code !== "revision_ahead") throw new Error(`Expected revision_ahead, received ${revisionAhead.code}.`);
  record("future revision rejected", revisionAhead);

  c.send({
    type: "hierarchy_operation",
    protocolVersion: 1,
    requestId: "chaos-c-reparent-locked",
    operationId: "chaos-c-reparent-locked-op",
    userId: c.userId,
    kind: "reparent_object",
    sceneId,
    objectId: childId,
    baseRevision: 1,
    parentObjectId: "",
    siblingIndex: 1,
    ...transformFields(4, 5, 6),
  });
  const cReparentDenied = await c.waitFor(
    (message) => message?.type === "hierarchy_conflict" && message.requestId === "chaos-c-reparent-locked",
    "locked reparent conflict",
  );
  if (cReparentDenied.reason !== "locked_by_other_user") {
    throw new Error(`Expected locked_by_other_user reparent conflict, received ${cReparentDenied.reason}.`);
  }
  record("locked reparent rejected", cReparentDenied);

  b.send({
    type: "lock_release",
    protocolVersion: 1,
    requestId: "chaos-b-release-not-owned",
    userId: b.userId,
    sceneId,
    objectId: childId,
  });
  const notOwned = await b.waitFor(
    (message) => message?.type === "error" && message.requestId === "chaos-b-release-not-owned",
    "lock_not_owned error",
  );
  if (notOwned.code !== "lock_not_owned") throw new Error(`Expected lock_not_owned, received ${notOwned.code}.`);
  record("non-owner release rejected", notOwned);

  const expired = await b.waitFor(
    (message) => message?.type === "lock_released" &&
      message.previousOwnerUserId === a.userId &&
      message.reason === "lease_expired",
    "A lease expiry",
    8_000,
  );
  record("expired lock released authoritatively", expired);

  b.send({
    type: "lock_request",
    protocolVersion: 1,
    requestId: "chaos-b-lock-after-expiry",
    userId: b.userId,
    sceneId,
    objectId: childId,
  });
  const bLock = await b.waitFor(
    (message) => message?.type === "lock_granted" && message.requestId === "chaos-b-lock-after-expiry",
    "B lock after expiry",
  );
  record("B acquired lock after expiry", bLock);

  b.send({
    type: "transform_update",
    protocolVersion: 1,
    requestId: "chaos-b-transform-2",
    operationId: "chaos-transform-op-2",
    userId: b.userId,
    sceneId,
    objectId: childId,
    baseRevision: 1,
    ...transformFields(10, 11, 12),
  });
  const secondApplied = await b.waitFor(
    (message) => message?.type === "transform_applied" && message.requestId === "chaos-b-transform-2",
    "B transform apply",
  );
  if (secondApplied.serverRevision !== 2) throw new Error(`Expected revision 2, received ${secondApplied.serverRevision}.`);
  record("post-expiry owner transform applied", secondApplied);

  c.send({
    type: "hierarchy_operation",
    protocolVersion: 1,
    requestId: "chaos-c-stale-hierarchy",
    operationId: "chaos-c-stale-hierarchy-op",
    userId: c.userId,
    kind: "rename_object",
    sceneId,
    objectId: rootId,
    baseRevision: 1,
    name: "Stale Rename",
  });
  const staleHierarchy = await c.waitFor(
    (message) => message?.type === "hierarchy_conflict" && message.requestId === "chaos-c-stale-hierarchy",
    "stale hierarchy conflict",
  );
  if (staleHierarchy.reason !== "stale_revision") {
    throw new Error(`Expected stale_revision, received ${staleHierarchy.reason}.`);
  }
  record("stale hierarchy revision rejected", staleHierarchy);

  b2 = new Peer("chaos-b", "Chaos B Replacement", "#AB47BC");
  await b2.connect();
  const supersededRelease = await c.waitFor(
    (message) => message?.type === "lock_released" &&
      message.previousOwnerUserId === b.userId &&
      message.reason === "session_superseded",
    "session supersede lock release",
  );
  record("same-user replacement released old connection lock", supersededRelease);

  b2.send({
    type: "lock_request",
    protocolVersion: 1,
    requestId: "chaos-b2-lock",
    userId: b2.userId,
    sceneId,
    objectId: childId,
  });
  const b2Lock = await b2.waitFor(
    (message) => message?.type === "lock_granted" && message.requestId === "chaos-b2-lock",
    "replacement connection lock",
  );
  if (b2Lock.lockState?.ownerConnectionId !== b2.connectionId) {
    throw new Error("Replacement connection did not become the authoritative lock owner.");
  }
  record("replacement connection acquired clean lock", b2Lock);

  b2.send({
    type: "lock_release",
    protocolVersion: 1,
    requestId: "chaos-b2-release",
    userId: b2.userId,
    sceneId,
    objectId: childId,
  });
  const finalRelease = await c.waitFor(
    (message) => message?.type === "lock_released" && message.previousOwnerConnectionId === b2.connectionId,
    "final replacement release",
  );
  record("replacement lock released cleanly", finalRelease);

  const result = {
    passed: true,
    endpoint,
    projectId,
    sessionId,
    finalRevision: 2,
    checks: evidence,
  };
  fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.info(`Authority chaos E2E PASS (${evidence.length} checks).`);
} finally {
  a.close();
  b.close();
  c.close();
  b2?.close();
}
