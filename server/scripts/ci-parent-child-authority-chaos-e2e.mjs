import fs from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";

const endpoint = process.env.TEAMFORGE_CI_WS_URL ?? "ws://127.0.0.1:5080/ws";
const outputDir = path.resolve(process.cwd(), "test-results", "authority-chaos-stress");
const resultPath = path.join(outputDir, "parent-child-authority-chaos.json");
const projectId = "ci-parent-child-chaos-project";
const sessionId = "ci-parent-child-chaos-session";
const sceneId = "ci-parent-child-chaos-scene";
const rootId = "GlobalObjectId_V1-2-ci-parent-child-root";
const parentId = "GlobalObjectId_V1-2-ci-parent-child-parent";
const childId = "GlobalObjectId_V1-2-ci-parent-child-child";
const siblingId = "GlobalObjectId_V1-2-ci-parent-child-sibling";

function tf(x, y, z) {
  return {
    localPosition: { x, y, z },
    localRotation: { x: 0, y: 0, z: 0, w: 1 },
    localScale: { x: 1, y: 1, z: 1 },
  };
}

class Peer {
  constructor(userId, name, color) {
    this.userId = userId;
    this.name = name;
    this.color = color;
    this.socket = null;
    this.inbox = [];
    this.waiters = [];
    this.connectionId = "";
    this.closed = false;
  }
  async connect() {
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
    const requestId = `hello-${this.userId}-${Date.now()}`;
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
  async waitFor(predicate, label, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const index = this.inbox.findIndex(predicate);
      if (index >= 0) return this.inbox.splice(index, 1)[0];
      if (this.closed) throw new Error(`${this.userId} closed while waiting for ${label}`);
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 50);
        this.waiters.push(() => { clearTimeout(timer); resolve(); });
      });
    }
    throw new Error(`Timed out waiting for ${label} on ${this.userId}`);
  }
  close() { try { this.socket?.close(); } catch {} }
}

async function acquire(peer, objectId, requestId) {
  peer.send({ type: "lock_request", protocolVersion: 1, requestId, userId: peer.userId, sceneId, objectId });
  const reply = await peer.waitFor((m) => m?.requestId === requestId && ["lock_granted", "lock_denied", "error"].includes(m.type), requestId);
  if (reply.type !== "lock_granted") throw new Error(`Lock ${objectId} failed: ${JSON.stringify(reply)}`);
  return reply;
}

async function release(peer, objectId, requestId) {
  peer.send({ type: "lock_release", protocolVersion: 1, requestId, userId: peer.userId, sceneId, objectId });
  return peer.waitFor((m) => m?.type === "lock_released" && m.objectId === objectId, requestId);
}

fs.mkdirSync(outputDir, { recursive: true });
fs.rmSync(resultPath, { force: true });
const checks = [];
const record = (name, details = null) => {
  checks.push({ name, observedAt: new Date().toISOString(), details });
  console.info(`PASS: ${name}`);
};

const a = new Peer("pc-a", "Parent Chaos A", "#EF5350");
const b = new Peer("pc-b", "Parent Chaos B", "#42A5F5");
let late = null;
let revision = 0;

try {
  await a.connect();
  await b.connect();

  a.send({
    type: "hierarchy_seed", protocolVersion: 1, requestId: "pc-seed", userId: a.userId,
    sceneId, baseRevision: 0,
    objects: [
      { objectId: rootId, name: "Root", parentObjectId: "", siblingIndex: 0, ...tf(0, 0, 0) },
      { objectId: parentId, name: "Parent", parentObjectId: rootId, siblingIndex: 0, ...tf(10, 0, 0) },
      { objectId: childId, name: "Child", parentObjectId: parentId, siblingIndex: 0, ...tf(1, 2, 3) },
      { objectId: siblingId, name: "Sibling", parentObjectId: rootId, siblingIndex: 1, ...tf(-10, 0, 0) },
    ],
  });
  await a.waitFor((m) => m?.type === "hierarchy_seed_accepted" && m.requestId === "pc-seed", "seed accepted");
  record("nested hierarchy seeded");

  await acquire(b, childId, "pc-b-child-lock");
  await acquire(a, parentId, "pc-a-parent-lock");
  record("different peers concurrently locked ancestor and descendant");

  a.send({
    type: "transform_update", protocolVersion: 1, requestId: "pc-parent-transform",
    operationId: "pc-parent-transform-op", userId: a.userId, sceneId, objectId: parentId,
    baseRevision: revision, ...tf(100, 0, 0),
  });
  const parentApplied = await a.waitFor((m) => m?.type === "transform_applied" && m.requestId === "pc-parent-transform", "parent transform");
  revision = parentApplied.serverRevision;
  await b.waitFor((m) => m?.type === "transform_applied" && m.operationId === "pc-parent-transform-op", "peer saw parent transform");
  record("ancestor Transform applied while another peer owned child lock", { revision });

  b.send({
    type: "transform_update", protocolVersion: 1, requestId: "pc-child-transform",
    operationId: "pc-child-transform-op", userId: b.userId, sceneId, objectId: childId,
    baseRevision: revision, ...tf(7, 8, 9),
  });
  const childApplied = await b.waitFor((m) => m?.type === "transform_applied" && m.requestId === "pc-child-transform", "child transform");
  revision = childApplied.serverRevision;
  await a.waitFor((m) => m?.type === "transform_applied" && m.operationId === "pc-child-transform-op", "peer saw child transform");
  record("child owner remained writable after ancestor Transform", { revision });

  // A destructive ancestor operation must not bypass a foreign descendant lock.
  a.send({
    type: "hierarchy_operation", protocolVersion: 1, requestId: "pc-delete-parent",
    operationId: "pc-delete-parent-op", userId: a.userId, kind: "delete_object",
    sceneId, objectId: parentId, baseRevision: revision,
  });
  const deleteConflict = await a.waitFor((m) => m?.type === "hierarchy_conflict" && m.requestId === "pc-delete-parent", "locked descendant delete conflict");
  if (deleteConflict.reason !== "locked_by_other_user") throw new Error(`Unexpected parent delete result: ${JSON.stringify(deleteConflict)}`);
  record("foreign child lock blocked destructive ancestor delete");

  // Direct structural mutation of the foreign-locked child must also fail.
  a.send({
    type: "hierarchy_operation", protocolVersion: 1, requestId: "pc-reparent-foreign-child",
    operationId: "pc-reparent-foreign-child-op", userId: a.userId, kind: "reparent_object",
    sceneId, objectId: childId, baseRevision: revision,
    parentObjectId: siblingId, siblingIndex: 0, ...tf(7, 8, 9),
  });
  const reparentConflict = await a.waitFor((m) => m?.type === "hierarchy_conflict" && m.requestId === "pc-reparent-foreign-child", "foreign child reparent conflict");
  if (reparentConflict.reason !== "locked_by_other_user") throw new Error(`Unexpected child reparent result: ${JSON.stringify(reparentConflict)}`);
  record("foreign child lock blocked direct reparent");

  await release(b, childId, "pc-b-child-release");
  await acquire(a, childId, "pc-a-child-lock");
  await acquire(a, siblingId, "pc-a-sibling-lock");

  a.send({
    type: "hierarchy_operation", protocolVersion: 1, requestId: "pc-reparent-after-handoff",
    operationId: "pc-reparent-after-handoff-op", userId: a.userId, kind: "reparent_object",
    sceneId, objectId: childId, baseRevision: revision,
    parentObjectId: siblingId, siblingIndex: 0, ...tf(7, 8, 9),
  });
  const reparentApplied = await a.waitFor(
    (m) => (m?.type === "hierarchy_operation_applied" || m?.type === "hierarchy_applied") && m.requestId === "pc-reparent-after-handoff",
    "authorized reparent",
  );
  revision = reparentApplied.serverRevision ?? revision + 1;
  record("authorized reparent succeeded after lock handoff", { revision, messageType: reparentApplied.type });

  late = new Peer("pc-late", "Parent Chaos Late", "#66BB6A");
  const snapshots = await late.connect();
  const hierarchyObjects = snapshots.hierarchy.objects ?? [];
  const transformStates = snapshots.transform.objects ?? snapshots.transform.transforms ?? [];
  const lateChild = hierarchyObjects.find((entry) => entry.objectId === childId);
  if (!lateChild || lateChild.parentObjectId !== siblingId) {
    throw new Error(`Late join did not observe child under sibling: ${JSON.stringify(lateChild)}`);
  }
  const childTransform = transformStates.find((entry) => entry.objectId === childId);
  const parentTransform = transformStates.find((entry) => entry.objectId === parentId);
  if (childTransform && childTransform.localPosition?.x !== 7) {
    throw new Error(`Child local Transform was corrupted by ancestor edit: ${JSON.stringify(childTransform)}`);
  }
  if (parentTransform && parentTransform.localPosition?.x !== 100) {
    throw new Error(`Parent authoritative Transform missing in late snapshot: ${JSON.stringify(parentTransform)}`);
  }
  record("late join converged on topology plus independent local Transforms", {
    childParent: lateChild.parentObjectId,
    childLocalX: childTransform?.localPosition?.x ?? null,
    parentLocalX: parentTransform?.localPosition?.x ?? null,
  });

  fs.writeFileSync(resultPath, `${JSON.stringify({ passed: true, finalRevision: revision, checks }, null, 2)}\n`, "utf8");
} catch (error) {
  fs.writeFileSync(resultPath, `${JSON.stringify({ passed: false, finalRevision: revision, error: error?.stack ?? String(error), checks }, null, 2)}\n`, "utf8");
  throw error;
} finally {
  a.close();
  b.close();
  late?.close();
}
