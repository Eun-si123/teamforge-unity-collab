import fs from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";

const endpoint = process.env.TEAMFORGE_CI_WS_URL ?? "ws://127.0.0.1:5080/ws";
const seed = Number.parseInt(process.env.TEAMFORGE_CHAOS_SEED ?? "12648430", 10) >>> 0;
const outputDir = path.resolve(process.cwd(), "test-results", "authority-chaos-stress");
const resultPath = path.join(outputDir, `authority-recovery-chaos-${seed}.json`);
fs.mkdirSync(outputDir, { recursive: true });
fs.rmSync(resultPath, { force: true });

const projectId = `ci-authority-recovery-project-${seed}`;
const sessionId = `ci-authority-recovery-session-${seed}`;
const sceneId = `ci-authority-recovery-scene-${seed}`;
const rootId = `GlobalObjectId_V1-2-ci-recovery-root-${seed}`;
const childId = `GlobalObjectId_V1-2-ci-recovery-child-${seed}`;
const siblingId = `GlobalObjectId_V1-2-ci-recovery-sibling-${seed}`;

function transformFields(x, y, z) {
  return {
    localPosition: { x, y, z },
    localRotation: { x: 0, y: 0, z: 0, w: 1 },
    localScale: { x: 1, y: 1, z: 1 },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    this.hierarchySnapshot = null;
    this.transformSnapshot = null;
  }

  async connect() {
    this.closed = false;
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

    const requestId = `hello-${this.userId}-${Date.now()}-${Math.random()}`;
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
    await this.waitFor((message) => message?.type === "presence_snapshot", `${this.userId} presence snapshot`);
    this.hierarchySnapshot = await this.waitFor(
      (message) => message?.type === "hierarchy_snapshot",
      `${this.userId} hierarchy snapshot`,
    );
    this.transformSnapshot = await this.waitFor(
      (message) => message?.type === "transform_snapshot",
      `${this.userId} transform snapshot`,
    );
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
        const timer = setTimeout(resolve, 80);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    throw new Error(`Timed out waiting for ${label} on ${this.userId}.`);
  }

  async waitUntilClosed(label, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    while (!this.closed && Date.now() < deadline) {
      await sleep(50);
    }
    if (!this.closed) throw new Error(`Timed out waiting for ${label} on ${this.userId}.`);
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
function record(name, details = null) {
  evidence.push({ name, observedAt: new Date().toISOString(), details });
  console.info(`PASS: ${name}`);
}

async function acquire(peer, objectId, requestId) {
  peer.send({
    type: "lock_request",
    protocolVersion: 1,
    requestId,
    userId: peer.userId,
    sceneId,
    objectId,
  });
  const reply = await peer.waitFor(
    (message) =>
      (message?.type === "lock_granted" || message?.type === "lock_denied" || message?.type === "error") &&
      message.requestId === requestId,
    `${peer.userId} lock ${objectId}`,
  );
  if (reply.type !== "lock_granted") {
    throw new Error(`${peer.userId} failed to acquire ${objectId}: ${JSON.stringify(reply)}`);
  }
  return reply;
}

async function release(peer, objectId, requestId) {
  peer.send({
    type: "lock_release",
    protocolVersion: 1,
    requestId,
    userId: peer.userId,
    sceneId,
    objectId,
  });
  return peer.waitFor(
    (message) => message?.type === "lock_released" && message.requestId === requestId,
    `${peer.userId} release ${objectId}`,
  );
}

function sendTransform(peer, { requestId, operationId, objectId, baseRevision, position }) {
  peer.send({
    type: "transform_update",
    protocolVersion: 1,
    requestId,
    operationId,
    userId: peer.userId,
    sceneId,
    objectId,
    baseRevision,
    ...transformFields(...position),
  });
}

function sendHierarchy(peer, message) {
  peer.send({
    type: "hierarchy_operation",
    protocolVersion: 1,
    userId: peer.userId,
    sceneId,
    ...message,
  });
}

const a = new Peer(`recovery-a-${seed}`, "Recovery A", "#EF5350");
const b = new Peer(`recovery-b-${seed}`, "Recovery B", "#42A5F5");
const observer = new Peer(`recovery-observer-${seed}`, "Recovery Observer", "#66BB6A");
let replacement = null;
let lateJoin = null;
let currentRevision = 0;

try {
  await a.connect();
  await b.connect();
  await observer.connect();

  a.send({
    type: "hierarchy_seed",
    protocolVersion: 1,
    requestId: `recovery-seed-${seed}`,
    userId: a.userId,
    sceneId,
    baseRevision: 0,
    objects: [
      {
        objectId: rootId,
        name: "Recovery Root",
        parentObjectId: "",
        siblingIndex: 0,
        ...transformFields(0, 0, 0),
      },
      {
        objectId: childId,
        name: "Recovery Child",
        parentObjectId: rootId,
        siblingIndex: 0,
        ...transformFields(1, 2, 3),
      },
      {
        objectId: siblingId,
        name: "Recovery Sibling",
        parentObjectId: "",
        siblingIndex: 1,
        ...transformFields(10, 20, 30),
      },
    ],
  });
  const seeded = await a.waitFor(
    (message) => message?.type === "hierarchy_seed_accepted" && message.requestId === `recovery-seed-${seed}`,
    "recovery hierarchy seed",
  );
  currentRevision = seeded.serverRevision;
  record("recovery hierarchy seeded", { revision: currentRevision });

  const expiring = await acquire(a, childId, `lease-expiry-a-${seed}`);
  const expiredOwnerConnectionId = expiring.lockState.ownerConnectionId;
  const leaseRemainingMs = Math.max(0, expiring.lockState.expiresAtUnixMs - Date.now());
  await sleep(leaseRemainingMs + 250);

  b.send({
    type: "lock_request",
    protocolVersion: 1,
    requestId: `lease-takeover-b-${seed}`,
    userId: b.userId,
    sceneId,
    objectId: childId,
  });
  const expiredRelease = await observer.waitFor(
    (message) =>
      message?.type === "lock_released" &&
      message.objectId === childId &&
      message.previousOwnerConnectionId === expiredOwnerConnectionId &&
      message.reason === "lease_expired",
    "lease expiry release",
  );
  const takeover = await b.waitFor(
    (message) => message?.type === "lock_granted" && message.requestId === `lease-takeover-b-${seed}`,
    "lease expiry takeover",
  );
  if (takeover.lockState.ownerConnectionId !== b.connectionId) {
    throw new Error("Expired lock takeover did not grant the new connection.");
  }
  record("expired lease released and competing peer took ownership", {
    releaseReason: expiredRelease.reason,
    newOwner: b.connectionId,
  });

  sendTransform(a, {
    requestId: `lease-stale-a-transform-${seed}`,
    operationId: `lease-stale-a-transform-op-${seed}`,
    objectId: childId,
    baseRevision: currentRevision,
    position: [900, 900, 900],
  });
  const staleAfterExpiry = await a.waitFor(
    (message) => message?.type === "error" && message.requestId === `lease-stale-a-transform-${seed}`,
    "expired owner transform rejection",
  );
  if (staleAfterExpiry.code !== "lock_required") {
    throw new Error(`Expired owner transform expected lock_required, got ${staleAfterExpiry.code}.`);
  }
  record("expired owner cannot write after lease takeover", staleAfterExpiry.code);

  sendTransform(b, {
    requestId: `lease-current-b-transform-${seed}`,
    operationId: `lease-current-b-transform-op-${seed}`,
    objectId: childId,
    baseRevision: currentRevision,
    position: [21, 22, 23],
  });
  const takeoverApplied = await b.waitFor(
    (message) => message?.type === "transform_applied" && message.requestId === `lease-current-b-transform-${seed}`,
    "takeover owner transform",
  );
  if (takeoverApplied.serverRevision !== currentRevision + 1) {
    throw new Error("Lease takeover transform did not advance exactly one revision.");
  }
  currentRevision = takeoverApplied.serverRevision;
  record("new lease owner writes exactly one authoritative revision", currentRevision);
  await release(b, childId, `lease-takeover-release-${seed}`);

  await acquire(a, siblingId, `idempotency-lock-${seed}`);
  const replayOperationId = `transform-replay-op-${seed}`;
  sendTransform(a, {
    requestId: `transform-replay-first-${seed}`,
    operationId: replayOperationId,
    objectId: siblingId,
    baseRevision: currentRevision,
    position: [31, 32, 33],
  });
  const replayFirst = await a.waitFor(
    (message) => message?.type === "transform_applied" && message.requestId === `transform-replay-first-${seed}`,
    "initial transform replay operation",
  );
  if (replayFirst.serverRevision !== currentRevision + 1) {
    throw new Error("Initial replay transform did not advance exactly one revision.");
  }
  currentRevision = replayFirst.serverRevision;

  sendTransform(a, {
    requestId: `transform-replay-duplicate-${seed}`,
    operationId: replayOperationId,
    objectId: siblingId,
    baseRevision: replayFirst.baseRevision,
    position: [31, 32, 33],
  });
  const replayDuplicate = await a.waitFor(
    (message) => message?.type === "transform_applied" && message.requestId === `transform-replay-duplicate-${seed}`,
    "duplicate transform replay",
  );
  if (replayDuplicate.serverRevision !== currentRevision || replayDuplicate.operationId !== replayOperationId) {
    throw new Error("Idempotent transform replay unexpectedly changed authoritative revision.");
  }
  record("identical transform operation replay is idempotent", currentRevision);

  sendTransform(a, {
    requestId: `transform-replay-conflict-${seed}`,
    operationId: replayOperationId,
    objectId: siblingId,
    baseRevision: replayFirst.baseRevision,
    position: [131, 132, 133],
  });
  const transformConflict = await a.waitFor(
    (message) => message?.type === "error" && message.requestId === `transform-replay-conflict-${seed}`,
    "conflicting transform replay",
  );
  if (transformConflict.code !== "operation_id_conflict") {
    throw new Error(`Conflicting transform replay expected operation_id_conflict, got ${transformConflict.code}.`);
  }
  record("transform operationId reuse with different payload rejected without revision", transformConflict.code);

  sendTransform(a, {
    requestId: `revision-ahead-${seed}`,
    operationId: `revision-ahead-op-${seed}`,
    objectId: siblingId,
    baseRevision: currentRevision + 100,
    position: [231, 232, 233],
  });
  const revisionAhead = await a.waitFor(
    (message) => message?.type === "error" && message.requestId === `revision-ahead-${seed}`,
    "future revision transform rejection",
  );
  if (revisionAhead.code !== "revision_ahead") {
    throw new Error(`Future revision transform expected revision_ahead, got ${revisionAhead.code}.`);
  }
  record("future base revision rejected without mutating state", revisionAhead.code);
  await release(a, siblingId, `idempotency-release-${seed}`);

  await acquire(b, childId, `subtree-child-lock-${seed}`);
  sendHierarchy(a, {
    requestId: `subtree-delete-conflict-${seed}`,
    operationId: `subtree-delete-conflict-op-${seed}`,
    kind: "delete_object",
    objectId: rootId,
    baseRevision: currentRevision,
  });
  const subtreeConflict = await a.waitFor(
    (message) => message?.type === "hierarchy_conflict" && message.requestId === `subtree-delete-conflict-${seed}`,
    "subtree lock delete conflict",
  );
  if (subtreeConflict.reason !== "subtree_locked_by_other_user" || subtreeConflict.serverRevision !== currentRevision) {
    throw new Error(`Subtree delete expected subtree_locked_by_other_user at revision ${currentRevision}.`);
  }
  record("foreign child lock blocks destructive parent subtree delete", subtreeConflict.reason);
  await release(b, childId, `subtree-child-release-${seed}`);

  await acquire(a, rootId, `parent-root-lock-${seed}`);
  sendHierarchy(b, {
    requestId: `parent-reparent-conflict-${seed}`,
    operationId: `parent-reparent-conflict-op-${seed}`,
    kind: "reparent_object",
    objectId: siblingId,
    baseRevision: currentRevision,
    parentObjectId: rootId,
    siblingIndex: 1,
    ...transformFields(31, 32, 33),
  });
  const parentConflict = await b.waitFor(
    (message) => message?.type === "hierarchy_conflict" && message.requestId === `parent-reparent-conflict-${seed}`,
    "parent lock reparent conflict",
  );
  if (parentConflict.reason !== "parent_locked_by_other_user" || parentConflict.serverRevision !== currentRevision) {
    throw new Error(`Reparent expected parent_locked_by_other_user at revision ${currentRevision}.`);
  }
  record("foreign parent lock blocks child-list reparent mutation", parentConflict.reason);
  await release(a, rootId, `parent-root-release-${seed}`);

  const hierarchyReplayOperationId = `hierarchy-replay-op-${seed}`;
  const hierarchyBaseRevision = currentRevision;
  sendHierarchy(a, {
    requestId: `hierarchy-replay-first-${seed}`,
    operationId: hierarchyReplayOperationId,
    kind: "reparent_object",
    objectId: siblingId,
    baseRevision: hierarchyBaseRevision,
    parentObjectId: rootId,
    siblingIndex: 1,
    ...transformFields(31, 32, 33),
  });
  const hierarchyFirst = await a.waitFor(
    (message) => message?.type === "hierarchy_applied" && message.requestId === `hierarchy-replay-first-${seed}`,
    "initial hierarchy replay operation",
  );
  if (hierarchyFirst.serverRevision !== currentRevision + 1) {
    throw new Error("Initial hierarchy replay operation did not advance exactly one revision.");
  }
  currentRevision = hierarchyFirst.serverRevision;

  sendHierarchy(a, {
    requestId: `hierarchy-replay-duplicate-${seed}`,
    operationId: hierarchyReplayOperationId,
    kind: "reparent_object",
    objectId: siblingId,
    baseRevision: hierarchyBaseRevision,
    parentObjectId: rootId,
    siblingIndex: 1,
    ...transformFields(31, 32, 33),
  });
  const hierarchyDuplicate = await a.waitFor(
    (message) => message?.type === "hierarchy_applied" && message.requestId === `hierarchy-replay-duplicate-${seed}`,
    "duplicate hierarchy replay",
  );
  if (hierarchyDuplicate.serverRevision !== currentRevision) {
    throw new Error("Idempotent hierarchy replay unexpectedly changed authoritative revision.");
  }
  record("identical hierarchy operation replay is idempotent", currentRevision);

  sendHierarchy(a, {
    requestId: `hierarchy-replay-conflict-${seed}`,
    operationId: hierarchyReplayOperationId,
    kind: "reparent_object",
    objectId: siblingId,
    baseRevision: hierarchyBaseRevision,
    parentObjectId: "",
    siblingIndex: 1,
    ...transformFields(31, 32, 33),
  });
  const hierarchyConflict = await a.waitFor(
    (message) => message?.type === "error" && message.requestId === `hierarchy-replay-conflict-${seed}`,
    "conflicting hierarchy replay",
  );
  if (hierarchyConflict.code !== "operation_id_conflict") {
    throw new Error(`Conflicting hierarchy replay expected operation_id_conflict, got ${hierarchyConflict.code}.`);
  }
  record("hierarchy operationId reuse with different payload rejected without revision", hierarchyConflict.code);

  const supersededLock = await acquire(a, rootId, `supersede-old-lock-${seed}`);
  replacement = new Peer(a.userId, "Recovery A Replacement", "#FF7043");
  await replacement.connect();
  await a.waitUntilClosed("superseded connection close");
  const supersededRelease = await observer.waitFor(
    (message) =>
      message?.type === "lock_released" &&
      message.objectId === rootId &&
      message.previousOwnerConnectionId === supersededLock.lockState.ownerConnectionId &&
      message.reason === "session_superseded",
    "superseded session lock cleanup",
  );
  record("same-user replacement closes older connection and releases its locks", supersededRelease.reason);

  const replacementLock = await acquire(replacement, rootId, `supersede-new-lock-${seed}`);
  if (replacementLock.lockState.ownerConnectionId !== replacement.connectionId) {
    throw new Error("Replacement connection could not acquire lock after supersession cleanup.");
  }
  record("replacement connection can acquire immediately after same-user supersession");
  await release(replacement, rootId, `supersede-new-release-${seed}`);

  lateJoin = new Peer(`recovery-late-${seed}`, "Recovery Late Join", "#AB47BC");
  await lateJoin.connect();
  if (lateJoin.hierarchySnapshot?.serverRevision !== currentRevision) {
    throw new Error(`Late hierarchy revision ${lateJoin.hierarchySnapshot?.serverRevision} != ${currentRevision}.`);
  }
  const root = lateJoin.hierarchySnapshot?.objects?.find((entry) => entry.objectId === rootId);
  const child = lateJoin.hierarchySnapshot?.objects?.find((entry) => entry.objectId === childId);
  const sibling = lateJoin.hierarchySnapshot?.objects?.find((entry) => entry.objectId === siblingId);
  if (!root || !child || !sibling) {
    throw new Error("Late join snapshot lost an object after rejected recovery chaos operations.");
  }
  if (child.parentObjectId !== rootId || sibling.parentObjectId !== rootId) {
    throw new Error("Late join hierarchy did not converge on the authoritative parent relationships.");
  }
  if (Array.isArray(lateJoin.transformSnapshot?.locks) && lateJoin.transformSnapshot.locks.length !== 0) {
    throw new Error(`Late join observed stale locks: ${JSON.stringify(lateJoin.transformSnapshot.locks)}.`);
  }
  record("late join converged after expiry, replay, hierarchy conflict, and session supersession", currentRevision);

  const result = {
    passed: true,
    endpoint,
    seed,
    projectId,
    sessionId,
    finalRevision: currentRevision,
    checks: evidence,
  };
  fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.info(`Authority recovery chaos PASS seed=${seed} (${evidence.length} checks, revision ${currentRevision}).`);
} finally {
  a.close();
  b.close();
  observer.close();
  replacement?.close();
  lateJoin?.close();
}
