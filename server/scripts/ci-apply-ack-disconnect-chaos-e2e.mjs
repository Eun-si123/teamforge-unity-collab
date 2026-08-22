import fs from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";

const endpoint = process.env.TEAMFORGE_CI_WS_URL ?? "ws://127.0.0.1:5080/ws";
const outputDir = path.resolve(process.cwd(), "test-results", "authority-chaos-stress");
const resultPath = path.join(outputDir, "apply-ack-disconnect-chaos.json");
const projectId = "ci-apply-ack-disconnect-project";
const sessionId = "ci-apply-ack-disconnect-session";
const sceneId = "ci-apply-ack-disconnect-scene";
const userId = "ci-apply-ack-user";
const observerId = "ci-apply-ack-observer";
const delaysMs = [0, 0, 1, 1, 2, 3, 5, 8];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tf = (x) => ({
  localPosition: { x, y: x + 0.25, z: x + 0.5 },
  localRotation: { x: 0, y: 0, z: 0, w: 1 },
  localScale: { x: 1, y: 1, z: 1 },
});

class Peer {
  constructor(id, name, color) {
    this.userId = id;
    this.name = name;
    this.color = color;
    this.socket = null;
    this.inbox = [];
    this.waiters = [];
    this.connectionId = "";
    this.closed = false;
  }
  async connect() {
    this.closed = false;
    this.socket = new WebSocket(endpoint);
    this.socket.on("message", (data) => {
      this.inbox.push(JSON.parse(data.toString("utf8")));
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
      type: "hello", protocolVersion: 1, requestId,
      userName: this.name, userId: this.userId, userColor: this.color,
      projectId, sessionId,
      supportsPresence: true, supportsTransformSync: true,
      supportsHierarchySync: true, supportsProjectTransfer: false,
    });
    const ack = await this.waitFor((m) => m?.type === "hello_ack" && m.requestId === requestId, "hello_ack");
    this.connectionId = ack.connectionId;
    await this.waitFor((m) => m?.type === "presence_snapshot", "presence_snapshot");
    const hierarchy = await this.waitFor((m) => m?.type === "hierarchy_snapshot", "hierarchy_snapshot");
    const transform = await this.waitFor((m) => m?.type === "transform_snapshot", "transform_snapshot");
    return { hierarchy, transform };
  }
  send(message) {
    if (this.socket?.readyState !== WebSocket.OPEN) throw new Error(`${this.userId} socket not open`);
    this.socket.send(JSON.stringify(message));
  }
  async waitFor(predicate, label, timeoutMs = 7000, allowClosed = false) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const index = this.inbox.findIndex(predicate);
      if (index >= 0) return this.inbox.splice(index, 1)[0];
      if (this.closed && !allowClosed) throw new Error(`${this.userId} closed while waiting for ${label}`);
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 25);
        this.waiters.push(() => { clearTimeout(timer); resolve(); });
      });
    }
    return null;
  }
  terminate() { try { this.socket?.terminate(); } catch {} }
  close() { try { this.socket?.close(); } catch {} }
}

async function acquire(peer, objectId, requestId) {
  peer.send({ type: "lock_request", protocolVersion: 1, requestId, userId: peer.userId, sceneId, objectId });
  const reply = await peer.waitFor((m) => m?.requestId === requestId && ["lock_granted", "lock_denied", "error"].includes(m.type), requestId);
  if (!reply || reply.type !== "lock_granted") throw new Error(`Failed to acquire ${objectId}: ${JSON.stringify(reply)}`);
  return reply;
}

fs.mkdirSync(outputDir, { recursive: true });
fs.rmSync(resultPath, { force: true });
const checks = [];
const trials = [];
const record = (name, details = null) => {
  checks.push({ name, observedAt: new Date().toISOString(), details });
  console.info(`PASS: ${name}`);
};

const observer = new Peer(observerId, "Apply/Ack Observer", "#29B6F6");
let actor = null;
let revision = 0;

try {
  await observer.connect();
  actor = new Peer(userId, "Apply/Ack Actor", "#FF7043");
  await actor.connect();

  const objects = delaysMs.map((_, index) => ({
    objectId: `GlobalObjectId_V1-2-ci-apply-ack-${index}`,
    name: `Apply Ack ${index}`,
    parentObjectId: "",
    siblingIndex: index,
    ...tf(0),
  }));
  actor.send({
    type: "hierarchy_seed", protocolVersion: 1, requestId: "apply-ack-seed",
    userId, sceneId, baseRevision: 0, objects,
  });
  await actor.waitFor((m) => m?.type === "hierarchy_seed_accepted" && m.requestId === "apply-ack-seed", "hierarchy seed");
  record("disconnect-boundary objects seeded", { count: objects.length });

  for (let index = 0; index < delaysMs.length; index += 1) {
    const objectId = objects[index].objectId;
    const operationId = `apply-ack-op-${index}`;
    const requestId = `apply-ack-request-${index}`;
    const payload = tf(100 + index);
    const baseRevision = revision;

    await acquire(actor, objectId, `apply-ack-lock-${index}`);

    // Clear stale observer traffic for this operation ID before the boundary attempt.
    observer.inbox = observer.inbox.filter((m) => m?.operationId !== operationId);
    actor.send({
      type: "transform_update", protocolVersion: 1, requestId, operationId,
      userId, sceneId, objectId, baseRevision, ...payload,
    });
    if (delaysMs[index] > 0) await sleep(delaysMs[index]);
    actor.terminate();

    // The observer tells us whether the server committed even if the sender did not consume its ACK.
    const firstApplied = await observer.waitFor(
      (m) => m?.type === "transform_applied" && m.operationId === operationId,
      `observer first apply ${index}`,
      600,
      true,
    );
    const committedBeforeReconnect = Boolean(firstApplied);
    if (firstApplied) revision = firstApplied.serverRevision;

    // Ensure disconnect cleanup had time to release the old connection's lock.
    await observer.waitFor(
      (m) => m?.type === "lock_released" && m.objectId === objectId,
      `disconnect lock release ${index}`,
      2500,
      true,
    );

    actor = new Peer(userId, "Apply/Ack Actor", "#FF7043");
    const reconnectSnapshots = await actor.connect();
    const snapshotRevision = reconnectSnapshots.transform.serverRevision ?? reconnectSnapshots.hierarchy.serverRevision ?? revision;
    revision = Math.max(revision, snapshotRevision ?? 0);
    await acquire(actor, objectId, `apply-ack-relock-${index}`);

    // Re-submit the exact operation ID and payload. Whether the first send committed or not,
    // the end result must be exactly one authoritative revision for this logical operation.
    actor.send({
      type: "transform_update", protocolVersion: 1,
      requestId: `apply-ack-replay-${index}`, operationId,
      userId, sceneId, objectId, baseRevision, ...payload,
    });
    const replayReply = await actor.waitFor(
      (m) => m?.requestId === `apply-ack-replay-${index}` &&
        ["transform_applied", "error"].includes(m.type),
      `replay reply ${index}`,
    );
    if (!replayReply) throw new Error(`No replay reply for trial ${index}`);

    let resultingRevision = revision;
    if (replayReply.type === "transform_applied") {
      resultingRevision = Math.max(resultingRevision, replayReply.serverRevision ?? 0);
    } else {
      throw new Error(`Replay of logical operation ${index} failed: ${JSON.stringify(replayReply)}`);
    }

    // Give broadcasts a moment to arrive, then count how many authoritative applications the observer saw.
    await sleep(80);
    const observerApplications = observer.inbox.filter(
      (m) => m?.type === "transform_applied" && m.operationId === operationId,
    );
    // Remove them so later trials cannot contaminate counts.
    observer.inbox = observer.inbox.filter((m) => m?.operationId !== operationId);

    if (committedBeforeReconnect) {
      if (replayReply.serverRevision !== firstApplied.serverRevision) {
        throw new Error(`Committed operation ${index} replay advanced/changed revision: first=${firstApplied.serverRevision}, replay=${replayReply.serverRevision}`);
      }
      if (observerApplications.length !== 0) {
        throw new Error(`Committed operation ${index} was broadcast again after replay (${observerApplications.length} duplicate application(s)).`);
      }
      revision = firstApplied.serverRevision;
    } else {
      // If the first packet never committed, the replay is allowed to commit it once now.
      revision = resultingRevision;
      if (revision !== baseRevision + 1) {
        throw new Error(`Uncommitted operation ${index} did not apply exactly once: base=${baseRevision}, result=${revision}`);
      }
    }

    trials.push({
      index,
      disconnectDelayMs: delaysMs[index],
      committedBeforeReconnect,
      firstRevision: firstApplied?.serverRevision ?? null,
      replayRevision: replayReply.serverRevision ?? null,
      observerDuplicateApplications: observerApplications.length,
    });
    record(`apply/ack disconnect trial ${index} remained exactly-once`, trials.at(-1));
  }

  const committedTrials = trials.filter((trial) => trial.committedBeforeReconnect).length;
  const uncommittedTrials = trials.length - committedTrials;
  if (committedTrials === 0) {
    throw new Error("Disconnect matrix never hit the committed-before-reconnect side of the boundary; evidence is insufficient.");
  }
  record("matrix exercised lost-ack-style committed operations", { committedTrials, uncommittedTrials });

  fs.writeFileSync(resultPath, `${JSON.stringify({ passed: true, finalRevision: revision, committedTrials, uncommittedTrials, trials, checks }, null, 2)}\n`, "utf8");
} catch (error) {
  fs.writeFileSync(resultPath, `${JSON.stringify({ passed: false, finalRevision: revision, trials, error: error?.stack ?? String(error), checks }, null, 2)}\n`, "utf8");
  throw error;
} finally {
  actor?.close();
  observer.close();
}
