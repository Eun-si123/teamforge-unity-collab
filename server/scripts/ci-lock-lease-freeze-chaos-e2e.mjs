import fs from "node:fs";
import path from "node:path";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const endpoint = process.env.TEAMFORGE_CI_WS_URL ?? "ws://127.0.0.1:5080/ws";
const leaseMs = Number.parseInt(process.env.TEAMFORGE_CHAOS_LOCK_LEASE_MS ?? "3000", 10);
const outputDir = path.resolve(process.cwd(), "test-results", "authority-chaos-stress");
const resultPath = path.join(outputDir, "lock-lease-freeze-chaos.json");
const projectId = "ci-lock-lease-freeze-project";
const sessionId = "ci-lock-lease-freeze-session";
const sceneId = "ci-lock-lease-freeze-scene";
const objectId = "GlobalObjectId_V1-2-ci-lock-lease-freeze-target";

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
    await this.waitFor((message) => message?.type === "presence_snapshot", `${this.userId} presence_snapshot`);
    await this.waitFor((message) => message?.type === "hierarchy_snapshot", `${this.userId} hierarchy_snapshot`);
    await this.waitFor((message) => message?.type === "transform_snapshot", `${this.userId} transform_snapshot`);
  }

  send(message) {
    if (this.socket?.readyState !== WebSocket.OPEN) throw new Error(`${this.userId} socket is not open.`);
    this.socket.send(JSON.stringify(message));
  }

  async waitFor(predicate, label, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const index = this.inbox.findIndex(predicate);
      if (index >= 0) return this.inbox.splice(index, 1)[0];
      if (this.closed) throw new Error(`${this.userId} closed while waiting for ${label}.`);
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 50);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    throw new Error(`Timed out waiting for ${label} on ${this.userId}.`);
  }

  close() {
    try { this.socket?.close(); } catch { /* best effort */ }
  }
}

async function childMain() {
  const owner = new Peer("freeze-owner", "Freeze Owner", "#AB47BC");
  await owner.connect();
  const requestId = "freeze-owner-lock";
  owner.send({
    type: "lock_request",
    protocolVersion: 1,
    requestId,
    userId: owner.userId,
    sceneId,
    objectId,
  });
  const granted = await owner.waitFor(
    (message) => message?.type === "lock_granted" && message.requestId === requestId,
    "initial lock grant",
  );
  process.send?.({ type: "owned", connectionId: granted.lockState?.ownerConnectionId ?? owner.connectionId });

  let sequence = 0;
  const renewTimer = setInterval(() => {
    if (owner.closed || owner.socket?.readyState !== WebSocket.OPEN) return;
    sequence += 1;
    owner.send({
      type: "lock_request",
      protocolVersion: 1,
      requestId: `freeze-renew-${sequence}`,
      userId: owner.userId,
      sceneId,
      objectId,
    });
  }, Math.max(250, Math.floor(leaseMs / 3)));

  owner.socket.on("message", (data) => {
    const message = JSON.parse(data.toString("utf8"));
    if (message?.requestId?.startsWith("freeze-renew-") &&
        (message.type === "lock_denied" || message.type === "error")) {
      process.send?.({ type: "stale-renew-rejected", responseType: message.type, reason: message.reason ?? message.code ?? "" });
    }
  });

  process.on("message", async (message) => {
    if (message?.type !== "probe-transform") return;
    const requestId2 = "freeze-owner-stale-transform";
    owner.send({
      type: "transform_update",
      protocolVersion: 1,
      requestId: requestId2,
      operationId: "freeze-owner-stale-transform-op",
      userId: owner.userId,
      sceneId,
      objectId,
      baseRevision: message.baseRevision ?? 0,
      localPosition: { x: 900, y: 901, z: 902 },
      localRotation: { x: 0, y: 0, z: 0, w: 1 },
      localScale: { x: 1, y: 1, z: 1 },
    });
    const response = await owner.waitFor(
      (candidate) => candidate?.requestId === requestId2 &&
        (candidate.type === "error" || candidate.type === "transform_applied"),
      "stale owner transform response",
    );
    process.send?.({ type: "stale-transform-response", responseType: response.type, code: response.code ?? "" });
  });

  process.on("SIGTERM", () => {
    clearInterval(renewTimer);
    owner.close();
    setTimeout(() => process.exit(0), 50).unref();
  });
  setInterval(() => {}, 60_000);
}

if (process.argv[2] === "child") {
  await childMain();
} else {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.rmSync(resultPath, { force: true });
  const checks = [];
  const record = (name, details = null) => {
    checks.push({ name, observedAt: new Date().toISOString(), details });
    console.info(`PASS: ${name}`);
  };

  const seeder = new Peer("freeze-seeder", "Freeze Seeder", "#26A69A");
  const contender = new Peer("freeze-contender", "Freeze Contender", "#FFA726");
  let ownerProcess = null;

  try {
    await seeder.connect();
    await contender.connect();

    seeder.send({
      type: "hierarchy_seed",
      protocolVersion: 1,
      requestId: "freeze-seed",
      userId: seeder.userId,
      sceneId,
      baseRevision: 0,
      objects: [{
        objectId,
        name: "Lease Freeze Target",
        parentObjectId: "",
        siblingIndex: 0,
        localPosition: { x: 0, y: 0, z: 0 },
        localRotation: { x: 0, y: 0, z: 0, w: 1 },
        localScale: { x: 1, y: 1, z: 1 },
      }],
    });
    await seeder.waitFor(
      (message) => message?.type === "hierarchy_seed_accepted" && message.requestId === "freeze-seed",
      "hierarchy seed",
    );
    record("target hierarchy seeded");

    ownerProcess = fork(fileURLToPath(import.meta.url), ["child"], {
      env: { ...process.env, TEAMFORGE_CHAOS_LOCK_LEASE_MS: String(leaseMs) },
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });

    const childMessages = [];
    ownerProcess.on("message", (message) => childMessages.push(message));
    const waitChild = async (predicate, label, timeoutMs = 10_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const index = childMessages.findIndex(predicate);
        if (index >= 0) return childMessages.splice(index, 1)[0];
        await sleep(40);
      }
      throw new Error(`Timed out waiting for child ${label}.`);
    };

    const owned = await waitChild((message) => message?.type === "owned", "lock ownership");
    record("child peer acquired authoritative lock", owned);

    // Let at least one normal renewal happen, then suspend the entire peer process.
    await sleep(Math.max(700, Math.floor(leaseMs * 0.45)));
    process.kill(ownerProcess.pid, "SIGSTOP");
    const freezeStartedAt = Date.now();
    record("lock owner process SIGSTOP suspended", { pid: ownerProcess.pid, leaseMs });

    // Before the lease boundary, a foreign Transform must still be rejected.
    const earlyTransformId = "freeze-contender-early-transform";
    contender.send({
      type: "transform_update",
      protocolVersion: 1,
      requestId: earlyTransformId,
      operationId: `${earlyTransformId}-op`,
      userId: contender.userId,
      sceneId,
      objectId,
      baseRevision: 0,
      localPosition: { x: 10, y: 11, z: 12 },
      localRotation: { x: 0, y: 0, z: 0, w: 1 },
      localScale: { x: 1, y: 1, z: 1 },
    });
    const earlyRejected = await contender.waitFor(
      (message) => message?.type === "error" && message.requestId === earlyTransformId,
      "pre-expiry transform rejection",
    );
    if (earlyRejected.code !== "lock_required") {
      throw new Error(`Expected lock_required before expiry, got ${earlyRejected.code}.`);
    }
    record("foreign Transform rejected while suspended owner's lease remained valid");

    // Probe lock ownership repeatedly across the expiry edge. Exactly one contender must eventually win.
    let takeover = null;
    let attempt = 0;
    const takeoverDeadline = freezeStartedAt + leaseMs + 2500;
    while (!takeover && Date.now() < takeoverDeadline) {
      attempt += 1;
      const requestId = `freeze-contender-lock-${attempt}`;
      contender.send({
        type: "lock_request",
        protocolVersion: 1,
        requestId,
        userId: contender.userId,
        sceneId,
        objectId,
      });
      const reply = await contender.waitFor(
        (message) => message?.requestId === requestId &&
          (message.type === "lock_granted" || message.type === "lock_denied" || message.type === "error"),
        `takeover attempt ${attempt}`,
      );
      if (reply.type === "lock_granted") takeover = reply;
      else await sleep(125);
    }
    if (!takeover) throw new Error("Contender never acquired the expired lock while owner was suspended.");
    const grantedAfterMs = Date.now() - freezeStartedAt;
    if (grantedAfterMs < Math.floor(leaseMs * 0.65)) {
      throw new Error(`Lock was taken suspiciously early after ${grantedAfterMs}ms for lease ${leaseMs}ms.`);
    }
    record("contender acquired lock across lease-expiry edge", { attempts: attempt, grantedAfterMs });

    const contenderTransformId = "freeze-contender-authoritative-transform";
    contender.send({
      type: "transform_update",
      protocolVersion: 1,
      requestId: contenderTransformId,
      operationId: `${contenderTransformId}-op`,
      userId: contender.userId,
      sceneId,
      objectId,
      baseRevision: 0,
      localPosition: { x: 20, y: 21, z: 22 },
      localRotation: { x: 0, y: 0, z: 0, w: 1 },
      localScale: { x: 1, y: 1, z: 1 },
    });
    const applied = await contender.waitFor(
      (message) => message?.type === "transform_applied" && message.requestId === contenderTransformId,
      "contender authoritative transform",
    );
    record("new owner published authoritative Transform", { revision: applied.serverRevision });

    process.kill(ownerProcess.pid, "SIGCONT");
    record("suspended owner process resumed");

    const staleRenew = await waitChild(
      (message) => message?.type === "stale-renew-rejected",
      "stale renewal rejection",
      Math.max(5000, leaseMs * 2),
    );
    record("resumed stale owner renewal was rejected", staleRenew);

    ownerProcess.send({ type: "probe-transform", baseRevision: applied.serverRevision });
    const staleTransform = await waitChild(
      (message) => message?.type === "stale-transform-response",
      "stale transform rejection",
    );
    if (staleTransform.responseType !== "error" || staleTransform.code !== "lock_required") {
      throw new Error(`Stale owner Transform was not rejected: ${JSON.stringify(staleTransform)}.`);
    }
    record("resumed stale owner could not publish Transform", staleTransform);

    const verifyRequestId = "freeze-contender-renew-after-resume";
    contender.send({
      type: "lock_request",
      protocolVersion: 1,
      requestId: verifyRequestId,
      userId: contender.userId,
      sceneId,
      objectId,
    });
    const verifyGrant = await contender.waitFor(
      (message) => message?.type === "lock_granted" && message.requestId === verifyRequestId,
      "contender ownership verification",
    );
    if (verifyGrant.lockState?.ownerConnectionId !== contender.connectionId) {
      throw new Error("Contender lost ownership after stale owner resumed.");
    }
    record("new owner remained authoritative after old process resumed");

    fs.writeFileSync(resultPath, `${JSON.stringify({
      passed: true,
      leaseMs,
      grantedAfterMs,
      finalRevision: applied.serverRevision,
      checks,
    }, null, 2)}\n`, "utf8");
  } catch (error) {
    fs.writeFileSync(resultPath, `${JSON.stringify({
      passed: false,
      leaseMs,
      error: error?.stack ?? String(error),
      checks,
    }, null, 2)}\n`, "utf8");
    throw error;
  } finally {
    if (ownerProcess && ownerProcess.exitCode == null) {
      try { process.kill(ownerProcess.pid, "SIGCONT"); } catch { /* already running/dead */ }
      try { ownerProcess.kill("SIGTERM"); } catch { /* best effort */ }
    }
    seeder.close();
    contender.close();
  }
}
