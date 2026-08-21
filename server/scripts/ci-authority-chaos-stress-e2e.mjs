import fs from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";

const endpoint = process.env.TEAMFORGE_CI_WS_URL ?? "ws://127.0.0.1:5080/ws";
const seed = Number.parseInt(process.env.TEAMFORGE_CHAOS_SEED ?? "12648430", 10) >>> 0;
const outputDir = path.resolve(process.cwd(), "test-results", "authority-chaos-stress");
const resultPath = path.join(outputDir, `authority-chaos-stress-${seed}.json`);
fs.mkdirSync(outputDir, { recursive: true });
fs.rmSync(resultPath, { force: true });

const projectId = `ci-authority-chaos-stress-project-${seed}`;
const sessionId = `ci-authority-chaos-stress-session-${seed}`;
const sceneId = `ci-authority-chaos-stress-scene-${seed}`;
const rootId = `GlobalObjectId_V1-2-ci-chaos-stress-root-${seed}`;
const childId = `GlobalObjectId_V1-2-ci-chaos-stress-child-${seed}`;
const siblingId = `GlobalObjectId_V1-2-ci-chaos-stress-sibling-${seed}`;
const stormRounds = 6;

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

function mulberry32(initialSeed) {
  let state = initialSeed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(items, random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
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
    if (!ack.presenceEnabled || !ack.transformSyncEnabled || !ack.hierarchySyncEnabled) {
      throw new Error(`${this.userId} did not negotiate all authority capabilities.`);
    }
    await this.waitFor((message) => message?.type === "presence_snapshot", `${this.userId} presence_snapshot`);
    this.hierarchySnapshot = await this.waitFor(
      (message) => message?.type === "hierarchy_snapshot",
      `${this.userId} hierarchy_snapshot`,
    );
    this.transformSnapshot = await this.waitFor(
      (message) => message?.type === "transform_snapshot",
      `${this.userId} transform_snapshot`,
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

  close() {
    try {
      this.socket?.close();
    } catch {
      // Best effort cleanup.
    }
  }

  terminate() {
    try {
      this.socket?.terminate();
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

async function waitForLockReply(peer, requestId, label) {
  return peer.waitFor(
    (message) =>
      (message?.type === "lock_granted" || message?.type === "lock_denied" || message?.type === "error") &&
      message.requestId === requestId,
    label,
  );
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
  const reply = await waitForLockReply(peer, requestId, `${peer.userId} lock ${objectId}`);
  if (reply.type !== "lock_granted") {
    throw new Error(`${peer.userId} failed to acquire ${objectId}: ${JSON.stringify(reply)}`);
  }
  return reply;
}

async function release(peer, objectId, requestId, observer) {
  peer.send({
    type: "lock_release",
    protocolVersion: 1,
    requestId,
    userId: peer.userId,
    sceneId,
    objectId,
  });
  return observer.waitFor(
    (message) =>
      message?.type === "lock_released" &&
      message.sceneId === sceneId &&
      message.objectId === objectId &&
      message.previousOwnerConnectionId === peer.connectionId,
    `${peer.userId} release ${objectId}`,
  );
}

const random = mulberry32(seed);
const a = new Peer(`stress-a-${seed}`, "Stress A", "#EF5350");
const b = new Peer(`stress-b-${seed}`, "Stress B", "#42A5F5");
const c = new Peer(`stress-c-${seed}`, "Stress C", "#66BB6A");
let lateJoin = null;
let currentRevision = 0;

try {
  await a.connect();
  await b.connect();
  await c.connect();

  a.send({
    type: "hierarchy_seed",
    protocolVersion: 1,
    requestId: `stress-seed-${seed}`,
    userId: a.userId,
    sceneId,
    baseRevision: 0,
    objects: [
      {
        objectId: rootId,
        name: "Stress Root",
        parentObjectId: "",
        siblingIndex: 0,
        ...transformFields(0, 0, 0),
      },
      {
        objectId: childId,
        name: "Stress Child",
        parentObjectId: rootId,
        siblingIndex: 0,
        ...transformFields(1, 2, 3),
      },
      {
        objectId: siblingId,
        name: "Stress Sibling",
        parentObjectId: "",
        siblingIndex: 1,
        ...transformFields(10, 20, 30),
      },
    ],
  });
  await a.waitFor(
    (message) => message?.type === "hierarchy_seed_accepted" && message.requestId === `stress-seed-${seed}`,
    "stress hierarchy seed",
  );
  record("clean three-object hierarchy seeded");

  c.send({
    type: "lock_request",
    protocolVersion: 1,
    requestId: "forged-lock-identity",
    userId: `forged-${seed}`,
    sceneId,
    objectId: childId,
  });
  const forgedIdentity = await c.waitFor(
    (message) => message?.type === "error" && message.requestId === "forged-lock-identity",
    "forged lock identity rejection",
  );
  if (forgedIdentity.code !== "lock_identity_mismatch") {
    throw new Error(`Expected lock_identity_mismatch, got ${forgedIdentity.code}.`);
  }
  record("forged lock identity rejected", forgedIdentity.code);

  b.send({
    type: "hierarchy_operation",
    protocolVersion: 1,
    requestId: "parent-cycle-attempt",
    operationId: `parent-cycle-op-${seed}`,
    userId: b.userId,
    kind: "reparent_object",
    sceneId,
    objectId: rootId,
    baseRevision: currentRevision,
    parentObjectId: childId,
    siblingIndex: 0,
    ...transformFields(0, 0, 0),
  });
  const cycleConflict = await b.waitFor(
    (message) => message?.type === "hierarchy_conflict" && message.requestId === "parent-cycle-attempt",
    "parent cycle conflict",
  );
  if (cycleConflict.reason !== "parent_cycle") {
    throw new Error(`Expected parent_cycle, got ${cycleConflict.reason}.`);
  }
  record("hierarchy parent cycle rejected", cycleConflict.reason);

  await acquire(a, childId, "locked-delete-owner");
  b.send({
    type: "hierarchy_operation",
    protocolVersion: 1,
    requestId: "delete-foreign-locked-object",
    operationId: `delete-foreign-locked-op-${seed}`,
    userId: b.userId,
    kind: "delete_object",
    sceneId,
    objectId: childId,
    baseRevision: currentRevision,
  });
  const lockedDeleteConflict = await b.waitFor(
    (message) => message?.type === "hierarchy_conflict" && message.requestId === "delete-foreign-locked-object",
    "foreign locked delete conflict",
  );
  if (lockedDeleteConflict.reason !== "locked_by_other_user") {
    throw new Error(`Expected locked_by_other_user delete conflict, got ${lockedDeleteConflict.reason}.`);
  }
  record("delete of foreign-locked object rejected", lockedDeleteConflict.reason);
  await release(a, childId, "locked-delete-owner-release", c);

  const peers = [a, b, c];
  for (let round = 0; round < stormRounds; round += 1) {
    const order = shuffled(peers, random);
    const requests = order.map((peer, index) => ({
      peer,
      requestId: `storm-${round}-${index}-${peer.userId}`,
    }));

    for (const request of requests) {
      request.peer.send({
        type: "lock_request",
        protocolVersion: 1,
        requestId: request.requestId,
        userId: request.peer.userId,
        sceneId,
        objectId: childId,
      });
    }

    const replies = [];
    for (const request of requests) {
      replies.push({
        ...request,
        reply: await waitForLockReply(request.peer, request.requestId, `storm round ${round} lock reply`),
      });
    }

    const granted = replies.filter(({ reply }) => reply.type === "lock_granted");
    const denied = replies.filter(({ reply }) => reply.type === "lock_denied");
    if (granted.length !== 1 || denied.length !== 2) {
      throw new Error(`Storm round ${round} expected 1 grant/2 denials, got ${granted.length}/${denied.length}.`);
    }
    if (denied.some(({ reply }) => reply.reason !== "locked_by_other_user")) {
      throw new Error(`Storm round ${round} produced a non-authoritative denial reason.`);
    }

    const winner = granted[0].peer;
    const losers = denied.map(({ peer }) => peer);
    record(`lock storm round ${round} elected exactly one owner`, {
      winner: winner.userId,
      sendOrder: order.map((peer) => peer.userId),
    });

    for (let index = 0; index < losers.length; index += 1) {
      const loser = losers[index];
      const requestId = `storm-${round}-loser-transform-${index}`;
      loser.send({
        type: "transform_update",
        protocolVersion: 1,
        requestId,
        operationId: `${requestId}-op-${seed}`,
        userId: loser.userId,
        sceneId,
        objectId: childId,
        baseRevision: currentRevision,
        ...transformFields(500 + round, 600 + index, 700 + round),
      });
      const rejected = await loser.waitFor(
        (message) => message?.type === "error" && message.requestId === requestId,
        `storm round ${round} unauthorized transform`,
      );
      if (rejected.code !== "lock_required") {
        throw new Error(`Storm round ${round} loser transform expected lock_required, got ${rejected.code}.`);
      }
    }
    record(`lock storm round ${round} rejected both losing transforms`);

    const transformRequestId = `storm-${round}-winner-transform`;
    winner.send({
      type: "transform_update",
      protocolVersion: 1,
      requestId: transformRequestId,
      operationId: `${transformRequestId}-op-${seed}`,
      userId: winner.userId,
      sceneId,
      objectId: childId,
      baseRevision: currentRevision,
      ...transformFields(round + 1, round + 2, round + 3),
    });
    const applied = await winner.waitFor(
      (message) => message?.type === "transform_applied" && message.requestId === transformRequestId,
      `storm round ${round} winner transform`,
    );
    if (applied.serverRevision !== currentRevision + 1) {
      throw new Error(`Storm round ${round} revision jumped from ${currentRevision} to ${applied.serverRevision}.`);
    }
    currentRevision = applied.serverRevision;
    record(`lock storm round ${round} applied only winner transform`, currentRevision);

    const observer = losers[0];
    await release(winner, childId, `storm-${round}-release`, observer);
    record(`lock storm round ${round} released cleanly`);
    await sleep(20);
  }

  const lockA = await acquire(a, childId, "independent-a-lock");
  const lockB = await acquire(b, siblingId, "independent-b-lock");
  if (lockA.lockState?.ownerConnectionId !== a.connectionId || lockB.lockState?.ownerConnectionId !== b.connectionId) {
    throw new Error("Independent object locks did not preserve separate owners.");
  }

  const independentBaseRevision = currentRevision;
  a.send({
    type: "transform_update",
    protocolVersion: 1,
    requestId: "independent-a-transform",
    operationId: `independent-a-transform-op-${seed}`,
    userId: a.userId,
    sceneId,
    objectId: childId,
    baseRevision: independentBaseRevision,
    ...transformFields(71, 72, 73),
  });
  b.send({
    type: "transform_update",
    protocolVersion: 1,
    requestId: "independent-b-transform",
    operationId: `independent-b-transform-op-${seed}`,
    userId: b.userId,
    sceneId,
    objectId: siblingId,
    baseRevision: independentBaseRevision,
    ...transformFields(81, 82, 83),
  });
  const independentA = await a.waitFor(
    (message) => message?.type === "transform_applied" && message.requestId === "independent-a-transform",
    "independent A transform",
  );
  const independentB = await b.waitFor(
    (message) => message?.type === "transform_applied" && message.requestId === "independent-b-transform",
    "independent B transform",
  );
  const independentRevisions = [independentA.serverRevision, independentB.serverRevision].sort((left, right) => left - right);
  if (independentRevisions[0] !== independentBaseRevision + 1 || independentRevisions[1] !== independentBaseRevision + 2) {
    throw new Error(`Independent transforms did not serialize to consecutive revisions: ${independentRevisions.join(",")}.`);
  }
  currentRevision = independentRevisions[1];
  record("independent object locks accepted concurrent transforms without cross-object interference", independentRevisions);
  await release(a, childId, "independent-a-release", c);
  await release(b, siblingId, "independent-b-release", c);

  const initialLease = await acquire(a, childId, "renewal-initial-lock");
  const initialExpiry = initialLease.lockState?.expiresAtUnixMs ?? 0;
  await sleep(650);
  a.send({
    type: "lock_request",
    protocolVersion: 1,
    requestId: "renewal-refresh-lock",
    userId: a.userId,
    sceneId,
    objectId: childId,
  });
  const renewed = await a.waitFor(
    (message) => message?.type === "lock_granted" && message.requestId === "renewal-refresh-lock",
    "lock renewal",
  );
  if (renewed.lockState?.ownerConnectionId !== a.connectionId || renewed.lockState?.expiresAtUnixMs <= initialExpiry) {
    throw new Error("Lock renewal did not extend the same owner's lease.");
  }
  record("lock renewal extended lease without changing owner", {
    before: initialExpiry,
    after: renewed.lockState.expiresAtUnixMs,
  });

  b.send({
    type: "lock_request",
    protocolVersion: 1,
    requestId: "renewal-competing-lock",
    userId: b.userId,
    sceneId,
    objectId: childId,
  });
  const renewalDenied = await b.waitFor(
    (message) => message?.type === "lock_denied" && message.requestId === "renewal-competing-lock",
    "competing lock during renewed lease",
  );
  if (renewalDenied.lockState?.ownerConnectionId !== a.connectionId) {
    throw new Error("Renewed lease did not remain authoritative against a competing requester.");
  }
  record("competing requester stayed blocked across lease renewal");
  await release(a, childId, "renewal-release", c);

  await acquire(a, childId, "handoff-a-lock");
  await release(a, childId, "handoff-a-release", c);
  await acquire(b, childId, "handoff-b-lock");
  a.send({
    type: "transform_update",
    protocolVersion: 1,
    requestId: "handoff-delayed-old-owner-transform",
    operationId: `handoff-delayed-old-owner-op-${seed}`,
    userId: a.userId,
    sceneId,
    objectId: childId,
    baseRevision: currentRevision,
    ...transformFields(999, 999, 999),
  });
  const delayedOldOwner = await a.waitFor(
    (message) => message?.type === "error" && message.requestId === "handoff-delayed-old-owner-transform",
    "delayed old owner transform rejection",
  );
  if (delayedOldOwner.code !== "lock_required") {
    throw new Error(`Delayed old owner transform expected lock_required, got ${delayedOldOwner.code}.`);
  }
  record("delayed transform from previous owner rejected after handoff");

  b.send({
    type: "transform_update",
    protocolVersion: 1,
    requestId: "handoff-current-owner-transform",
    operationId: `handoff-current-owner-op-${seed}`,
    userId: b.userId,
    sceneId,
    objectId: childId,
    baseRevision: currentRevision,
    ...transformFields(91, 92, 93),
  });
  const handoffApplied = await b.waitFor(
    (message) => message?.type === "transform_applied" && message.requestId === "handoff-current-owner-transform",
    "current owner transform after handoff",
  );
  if (handoffApplied.serverRevision !== currentRevision + 1) {
    throw new Error("Current owner transform did not advance exactly one revision after handoff.");
  }
  currentRevision = handoffApplied.serverRevision;
  record("current owner remained writable after stale previous-owner packet", currentRevision);
  await release(b, childId, "handoff-b-release", c);

  await acquire(c, childId, "disconnect-owner-lock");
  const disconnectedConnectionId = c.connectionId;
  c.terminate();
  const disconnectRelease = await a.waitFor(
    (message) =>
      message?.type === "lock_released" &&
      message.objectId === childId &&
      message.previousOwnerConnectionId === disconnectedConnectionId,
    "disconnect lock cleanup",
    8_000,
  );
  record("socket termination released held lock", disconnectRelease.reason ?? null);

  const postDisconnectLock = await acquire(a, childId, "post-disconnect-lock");
  if (postDisconnectLock.lockState?.ownerConnectionId !== a.connectionId) {
    throw new Error("A could not take ownership after disconnected owner cleanup.");
  }
  record("new owner acquired immediately after disconnected owner cleanup");

  a.send({
    type: "hierarchy_operation",
    protocolVersion: 1,
    requestId: "delete-owned-locked-child",
    operationId: `delete-owned-locked-child-op-${seed}`,
    userId: a.userId,
    kind: "delete_object",
    sceneId,
    objectId: childId,
    baseRevision: currentRevision,
  });
  const deleteApplied = await a.waitFor(
    (message) => message?.type === "hierarchy_applied" && message.requestId === "delete-owned-locked-child",
    "delete owned locked child",
  );
  if (deleteApplied.serverRevision !== currentRevision + 1 || !deleteApplied.deletedObjectIds?.includes(childId)) {
    throw new Error("Authoritative delete did not advance revision and tombstone the target identity.");
  }
  currentRevision = deleteApplied.serverRevision;
  record("lock owner deleted target and authoritative hierarchy advanced", currentRevision);

  a.send({
    type: "lock_request",
    protocolVersion: 1,
    requestId: "lock-deleted-object",
    userId: a.userId,
    sceneId,
    objectId: childId,
  });
  const deletedLock = await a.waitFor(
    (message) => message?.type === "error" && message.requestId === "lock-deleted-object",
    "deleted identity lock rejection",
  );
  if (deletedLock.code !== "hierarchy_object_deleted") {
    throw new Error(`Deleted identity lock expected hierarchy_object_deleted, got ${deletedLock.code}.`);
  }
  record("deleted identity cannot be locked again", deletedLock.code);

  a.send({
    type: "transform_update",
    protocolVersion: 1,
    requestId: "transform-deleted-object",
    operationId: `transform-deleted-object-op-${seed}`,
    userId: a.userId,
    sceneId,
    objectId: childId,
    baseRevision: currentRevision,
    ...transformFields(111, 222, 333),
  });
  const deletedTransform = await a.waitFor(
    (message) => message?.type === "error" && message.requestId === "transform-deleted-object",
    "deleted identity transform rejection",
  );
  if (deletedTransform.code !== "hierarchy_object_deleted") {
    throw new Error(`Deleted identity transform expected hierarchy_object_deleted, got ${deletedTransform.code}.`);
  }
  record("deleted identity rejects delayed transform packets", deletedTransform.code);

  lateJoin = new Peer(`stress-late-${seed}`, "Stress Late Join", "#AB47BC");
  await lateJoin.connect();
  if (lateJoin.hierarchySnapshot?.serverRevision !== currentRevision) {
    throw new Error(
      `Late join snapshot revision ${lateJoin.hierarchySnapshot?.serverRevision} did not match ${currentRevision}.`,
    );
  }
  if (lateJoin.hierarchySnapshot?.objects?.some((entry) => entry.objectId === childId)) {
    throw new Error("Late join snapshot resurrected the deleted child object.");
  }
  if (!lateJoin.hierarchySnapshot?.tombstones?.some((entry) => entry.objectId === childId)) {
    throw new Error("Late join snapshot omitted the deleted identity tombstone.");
  }
  record("late join converged on deletion and tombstone after chaos", currentRevision);

  const result = {
    passed: true,
    endpoint,
    seed,
    projectId,
    sessionId,
    stormRounds,
    finalRevision: currentRevision,
    checks: evidence,
  };
  fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.info(`Authority chaos stress PASS seed=${seed} (${evidence.length} checks, revision ${currentRevision}).`);
} finally {
  a.close();
  b.close();
  c.close();
  lateJoin?.close();
}
