import fs from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";

const endpoint = process.env.TEAMFORGE_CI_WS_URL ?? "ws://127.0.0.1:5080/ws";
const outputDir = path.resolve(process.cwd(), "test-results", "lock-herd-chaos");
const resultPath = path.join(outputDir, "lock-herd-chaos.json");
const projectId = "ci-lock-herd-project";
const sessionId = "ci-lock-herd-session";
const sceneId = "ci-lock-herd-scene";
const objectId = "GlobalObjectId_V1-2-ci-lock-herd-target";
const peerCount = 12;
const rounds = 18;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tf = (x) => ({
  localPosition: { x, y: x + 0.5, z: x + 1 },
  localRotation: { x: 0, y: 0, z: 0, w: 1 },
  localScale: { x: 1, y: 1, z: 1 },
});

class Peer {
  constructor(index, observer = false) {
    this.index = index;
    this.userId = observer ? "herd-observer" : `herd-peer-${index}`;
    this.name = observer ? "Herd Observer" : `Herd Peer ${index}`;
    this.color = observer ? "#90A4AE" : `#${((index + 2) * 0x12345).toString(16).padStart(6, "0").slice(-6)}`;
    this.socket = null;
    this.inbox = [];
    this.waiters = [];
    this.connectionId = "";
    this.closed = false;
  }

  async connect() {
    this.closed = false;
    this.inbox = [];
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

    const requestId = `herd-hello-${this.userId}-${Date.now()}-${Math.random()}`;
    this.send({
      type: "hello",
      protocolVersion: 1,
      requestId,
      userName: this.name,
      userId: this.userId,
      userColor: this.color,
      projectId,
      sessionId,
      supportsPresence: true,
      supportsTransformSync: true,
      supportsHierarchySync: true,
      supportsProjectTransfer: false,
    });
    const ack = await this.waitFor((m) => m?.type === "hello_ack" && m.requestId === requestId, "hello_ack");
    this.connectionId = ack.connectionId;
    await this.waitFor((m) => m?.type === "presence_snapshot", "presence_snapshot");
    await this.waitFor((m) => m?.type === "hierarchy_snapshot", "hierarchy_snapshot");
    const transform = await this.waitFor((m) => m?.type === "transform_snapshot", "transform_snapshot");
    return transform;
  }

  send(message) {
    if (this.socket?.readyState !== WebSocket.OPEN) throw new Error(`${this.userId} socket is not open`);
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
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    return null;
  }

  terminate() {
    try { this.socket?.terminate(); } catch {}
  }

  close() {
    try { this.socket?.close(); } catch {}
  }
}

function deterministicOrder(round, count) {
  const order = Array.from({ length: count }, (_, index) => index);
  let state = (0x9E3779B9 ^ (round * 0x45D9F3B)) >>> 0;
  for (let i = order.length - 1; i > 0; i -= 1) {
    state = (Math.imul(state ^ (state >>> 16), 0x7FEB352D) + 0x846CA68B) >>> 0;
    const j = state % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

fs.mkdirSync(outputDir, { recursive: true });
fs.rmSync(resultPath, { force: true });
const checks = [];
const roundEvidence = [];
const record = (name, details = null) => {
  checks.push({ name, observedAt: new Date().toISOString(), details });
  console.info(`PASS: ${name}`);
};

const observer = new Peer(-1, true);
const peers = Array.from({ length: peerCount }, (_, index) => new Peer(index));
let late = null;
let revision = 0;

async function reconnectPeer(index) {
  const replacement = new Peer(index);
  await replacement.connect();
  peers[index] = replacement;
  return replacement;
}

async function waitForRelease(label, timeoutMs = 4000) {
  const released = await observer.waitFor(
    (m) => m?.type === "lock_released" && m.sceneId === sceneId && m.objectId === objectId,
    label,
    timeoutMs,
    true,
  );
  if (!released) throw new Error(`Timed out waiting for ${label}`);
  return released;
}

try {
  await observer.connect();
  for (const peer of peers) await peer.connect();

  peers[0].send({
    type: "hierarchy_seed",
    protocolVersion: 1,
    requestId: "herd-seed",
    userId: peers[0].userId,
    sceneId,
    baseRevision: 0,
    objects: [{
      objectId,
      name: "Thundering Herd Target",
      parentObjectId: "",
      siblingIndex: 0,
      ...tf(0),
    }],
  });
  await peers[0].waitFor((m) => m?.type === "hierarchy_seed_accepted" && m.requestId === "herd-seed", "hierarchy seed");
  record("herd target seeded", { peerCount, rounds });

  for (let round = 0; round < rounds; round += 1) {
    const order = deterministicOrder(round, peerCount);
    const requests = [];

    // Queue all requests in one event-loop turn. TCP still preserves each connection's ordering,
    // but the server receives a dense cross-connection burst with no client-side serialization.
    for (const index of order) {
      const peer = peers[index];
      const requestId = `herd-round-${round}-peer-${index}`;
      peer.send({
        type: "lock_request",
        protocolVersion: 1,
        requestId,
        userId: peer.userId,
        sceneId,
        objectId,
      });
      requests.push({ index, peer, requestId });
    }

    const replies = await Promise.all(requests.map(async ({ index, peer, requestId }) => ({
      index,
      reply: await peer.waitFor(
        (m) => m?.requestId === requestId && ["lock_granted", "lock_denied", "error"].includes(m.type),
        requestId,
      ),
    })));

    const grants = replies.filter((entry) => entry.reply?.type === "lock_granted");
    const denials = replies.filter((entry) => entry.reply?.type === "lock_denied");
    if (grants.length !== 1) {
      throw new Error(`Round ${round} expected exactly one grant, got ${grants.length}: ${JSON.stringify(replies)}`);
    }
    if (denials.length !== peerCount - 1) {
      throw new Error(`Round ${round} expected ${peerCount - 1} denials, got ${denials.length}.`);
    }

    const winnerIndex = grants[0].index;
    const winner = peers[winnerIndex];
    const winnerConnectionId = grants[0].reply.lockState?.ownerConnectionId;
    if (winnerConnectionId !== winner.connectionId) {
      throw new Error(`Round ${round} grant owner mismatch: expected ${winner.connectionId}, got ${winnerConnectionId}`);
    }
    for (const denial of denials) {
      if (denial.reply.lockState?.ownerConnectionId !== winner.connectionId) {
        throw new Error(`Round ${round} denial disagreed on owner: ${JSON.stringify(denial.reply)}`);
      }
    }
    record(`round ${round} elected exactly one authoritative owner`, { winnerIndex, order });

    const operationId = `herd-transform-op-${round}`;
    const requestId = `herd-transform-request-${round}`;
    winner.send({
      type: "transform_update",
      protocolVersion: 1,
      requestId,
      operationId,
      userId: winner.userId,
      sceneId,
      objectId,
      baseRevision: revision,
      ...tf(100 + round),
    });
    const applied = await winner.waitFor(
      (m) => m?.type === "transform_applied" && m.requestId === requestId,
      `round ${round} transform apply`,
    );
    if (!applied || applied.serverRevision !== revision + 1) {
      throw new Error(`Round ${round} transform revision mismatch: base=${revision}, reply=${JSON.stringify(applied)}`);
    }
    const observed = await observer.waitFor(
      (m) => m?.type === "transform_applied" && m.operationId === operationId,
      `round ${round} observer transform`,
    );
    if (!observed || observed.serverRevision !== applied.serverRevision) {
      throw new Error(`Round ${round} observer disagreed with authoritative apply.`);
    }
    revision = applied.serverRevision;
    record(`round ${round} winner alone advanced Transform authority`, { winnerIndex, revision });

    let releaseMode;
    if (round % 3 === 0) {
      releaseMode = "explicit";
      winner.send({
        type: "lock_release",
        protocolVersion: 1,
        requestId: `herd-release-${round}`,
        userId: winner.userId,
        sceneId,
        objectId,
      });
      await waitForRelease(`round ${round} explicit release`);
    } else if (round % 3 === 1) {
      releaseMode = "abrupt-disconnect";
      winner.terminate();
      await waitForRelease(`round ${round} disconnect cleanup`);
      await reconnectPeer(winnerIndex);
    } else {
      releaseMode = "renew-then-disconnect-before-ack";
      winner.send({
        type: "lock_request",
        protocolVersion: 1,
        requestId: `herd-zombie-renew-${round}`,
        userId: winner.userId,
        sceneId,
        objectId,
      });
      winner.terminate();
      await waitForRelease(`round ${round} zombie renewal cleanup`);
      await reconnectPeer(winnerIndex);
    }
    record(`round ${round} released authority without ghost lock`, { winnerIndex, releaseMode });

    // Immediately probe with a rotated peer. A stale lock surviving cleanup would make this fail.
    const probeIndex = order.find((index) => index !== winnerIndex);
    const probe = peers[probeIndex];
    const probeRequestId = `herd-probe-${round}`;
    probe.send({
      type: "lock_request",
      protocolVersion: 1,
      requestId: probeRequestId,
      userId: probe.userId,
      sceneId,
      objectId,
    });
    const probeGrant = await probe.waitFor(
      (m) => m?.requestId === probeRequestId && ["lock_granted", "lock_denied", "error"].includes(m.type),
      `round ${round} post-cleanup probe`,
    );
    if (!probeGrant || probeGrant.type !== "lock_granted") {
      throw new Error(`Round ${round} left a ghost lock after ${releaseMode}: ${JSON.stringify(probeGrant)}`);
    }
    probe.send({
      type: "lock_release",
      protocolVersion: 1,
      requestId: `herd-probe-release-${round}`,
      userId: probe.userId,
      sceneId,
      objectId,
    });
    await waitForRelease(`round ${round} probe release`);
    record(`round ${round} immediate post-cleanup takeover succeeded`, { probeIndex });

    roundEvidence.push({ round, order, winnerIndex, releaseMode, revision, probeIndex });
    await sleep(round % 2 === 0 ? 5 : 15);
  }

  late = new Peer(999, true);
  late.userId = "herd-late-observer";
  late.name = "Herd Late Observer";
  const finalSnapshot = await late.connect();
  const finalState = (finalSnapshot.transforms ?? []).find((entry) => entry.objectId === objectId);
  if (!finalState || finalState.serverRevision !== revision || finalState.localPosition?.x !== 100 + rounds - 1) {
    throw new Error(`Late snapshot did not converge on final herd state: ${JSON.stringify(finalState)}`);
  }
  if ((finalSnapshot.locks ?? []).some((entry) => entry.objectId === objectId)) {
    throw new Error("Late snapshot observed a ghost lock after all herd rounds.");
  }
  record("late join converged with final Transform and no ghost lock", { revision, finalX: finalState.localPosition?.x });

  fs.writeFileSync(resultPath, `${JSON.stringify({
    passed: true,
    peerCount,
    rounds,
    finalRevision: revision,
    checks,
    roundEvidence,
  }, null, 2)}\n`, "utf8");
} catch (error) {
  fs.writeFileSync(resultPath, `${JSON.stringify({
    passed: false,
    peerCount,
    rounds,
    finalRevision: revision,
    error: error?.stack ?? String(error),
    checks,
    roundEvidence,
  }, null, 2)}\n`, "utf8");
  throw error;
} finally {
  observer.close();
  for (const peer of peers) peer?.close();
  late?.close();
}
