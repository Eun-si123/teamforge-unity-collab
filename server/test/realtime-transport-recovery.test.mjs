import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { WebSocket } from "ws";
import { createTeamForgeServer } from "../src/teamforge-server.mjs";

// Real loopback transport evidence only: these peers explicitly rejoin. This
// does not exercise Unity's retry/UI policy, a physical NIC, or a packaged app.
const WAIT_MS = 8_000;
const sceneId = "transport-recovery-scene";
const objectId = "GlobalObjectId_V1-2-transport-recovery-scene-100-0";
const pose = (x) => ({
  localPosition: { x, y: 2, z: 3 },
  localRotation: { x: 0, y: 0, z: 0, w: 1 },
  localScale: { x: 1, y: 1, z: 1 },
});
const packet = (type, requestId, fields = {}) => ({
  type, protocolVersion: 1, requestId, userId: "guest", sceneId, objectId, ...fields,
});

async function bounded(promise, label, milliseconds = WAIT_MS) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function until(predicate, label, signal) {
  const deadline = performance.now() + WAIT_MS;
  while (performance.now() < deadline) {
    signal?.throwIfAborted();
    const value = predicate();
    if (value) return value;
    await delay(5, undefined, { signal });
  }
  throw new Error(`Timed out: ${label}`);
}

function createProxy(targetPort) {
  const sockets = new Set();
  const proxy = {
    mode: "pass", droppedText: "", blackholeToGuest: 0, blackholeToServer: 0,
    cut() { for (const socket of sockets) socket.destroy(); },
  };
  const listener = net.createServer((downstream) => {
    const upstream = net.connect({ host: "127.0.0.1", port: targetPort });
    for (const socket of [downstream, upstream]) {
      sockets.add(socket);
      socket.on("error", () => socket.destroy());
      socket.on("close", () => sockets.delete(socket));
    }
    downstream.on("close", () => upstream.destroy());
    upstream.on("close", () => downstream.destroy());
    downstream.on("data", (bytes) => {
      if (proxy.mode === "blackhole") proxy.blackholeToServer += bytes.length;
      else upstream.write(bytes);
    });
    upstream.on("data", (bytes) => {
      if (proxy.mode === "blackhole") proxy.blackholeToGuest += bytes.length;
      else if (proxy.mode === "drop-server") {
        // Keep enough raw text across TCP chunk boundaries to observe the
        // specific discarded ACK, rather than counting unrelated ping bytes.
        proxy.droppedText = (proxy.droppedText + bytes.toString("latin1")).slice(-4096);
      }
      else downstream.write(bytes);
    });
  });
  proxy.start = () => bounded(new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      listener.off("error", reject);
      resolve(listener.address().port);
    });
  }), "owned proxy listen");
  proxy.stop = async () => {
    proxy.cut();
    await bounded(new Promise((resolve, reject) => {
      listener.close((error) => error && error.code !== "ERR_SERVER_NOT_RUNNING"
        ? reject(error) : resolve());
    }), "owned proxy close");
    await until(() => sockets.size === 0, "both owned proxy halves close");
  };
  return proxy;
}

function peer(url, token, owned, signal) {
  const socket = new WebSocket(url, {
    headers: { authorization: `Bearer ${token}` },
    handshakeTimeout: WAIT_MS,
    perMessageDeflate: false,
  });
  const inbox = [];
  const received = [];
  let failure;
  const value = {
    socket, received,
    send(message) { socket.send(JSON.stringify(message)); },
    next(predicate, label) {
      return until(() => {
        if (failure) throw failure;
        const index = inbox.findIndex(predicate);
        if (index >= 0) return inbox.splice(index, 1)[0];
        assert.notEqual(socket.readyState, WebSocket.CLOSED, `Closed before ${label}`);
      }, label, signal);
    },
    reply(requestId) { return this.next((m) => m.requestId === requestId, requestId); },
  };
  owned.add(value);
  socket.on("error", (error) => { failure = error; });
  socket.on("message", (bytes, isBinary) => {
    try {
      assert.equal(isBinary, false);
      assert(received.length < 256, "bounded fixture inbox");
      const message = JSON.parse(bytes.toString("utf8"));
      received.push(message);
      inbox.push(message);
    } catch (error) { failure = error; }
  });
  value.open = () => until(() => {
    if (failure) throw failure;
    return socket.readyState === WebSocket.OPEN;
  }, "owned WebSocket open", signal);
  return value;
}

async function join(client, userId, sessionId) {
  await client.open();
  client.send({
    type: "hello", protocolVersion: 1, requestId: `hello-${userId}`,
    userId, userName: userId, userColor: "#42A5F5",
    projectId: "transport-recovery-project", sessionId,
    supportsPresence: true, supportsTransformSync: true, supportsHierarchySync: true,
  });
  const ack = await client.reply(`hello-${userId}`);
  assert.equal(ack.type, "hello_ack");
  const presence = await client.next((m) => m.type === "presence_snapshot", "presence snapshot");
  const hierarchy = await client.next((m) => m.type === "hierarchy_snapshot", "hierarchy snapshot");
  const transform = await client.next((m) => m.type === "transform_snapshot", "transform snapshot");
  return { connectionId: ack.connectionId, presence, hierarchy, transform };
}

for (const fault of ["abrupt-drop", "blackhole"]) {
  test(`real realtime transport recovery after ${fault}`, { timeout: 30_000 }, async (t) => {
    const token = randomBytes(32).toString("hex");
    const server = createTeamForgeServer({
      host: "127.0.0.1", port: 0, authToken: token,
      // Leave scheduling headroom for shared CI runners while keeping failure
      // detection shorter than every wait and the lease longer than the case.
      heartbeatIntervalMilliseconds: 250, heartbeatTimeoutMilliseconds: 3_000,
      lockLeaseMilliseconds: 60_000,
    });
    const owned = new Set();
    let proxy;
    t.after(async () => {
      for (const client of owned) client.socket.terminate();
      await Promise.all([
        proxy?.stop(), bounded(server.stop(), "owned server stop"),
      ]);
      await until(() => [...owned].every((p) => p.socket.readyState === WebSocket.CLOSED),
        "owned client cleanup");
    });
    const endpoint = await bounded(server.start(), "owned server listen");
    assert.equal(endpoint.host, "127.0.0.1");
    const url = `ws://127.0.0.1:${endpoint.port}${endpoint.wsPath}`;
    proxy = createProxy(endpoint.port);
    const port = await proxy.start();
    const proxyUrl = `ws://127.0.0.1:${port}${endpoint.wsPath}`;
    const observer = peer(url, token, owned, t.signal);
    const sessionId = `transport-${fault}`;
    await join(observer, "observer", sessionId); // Keeps Session/operation history alive.
    const guest = peer(proxyUrl, token, owned, t.signal);
    const original = await join(guest, "guest", sessionId);
    observer.send(packet("hierarchy_seed", "seed", {
      userId: "observer", baseRevision: 0,
      objects: [{ objectId, name: "Before fault", parentObjectId: "", siblingIndex: 0, ...pose(0) }],
    }));
    assert.equal((await observer.reply("seed")).type, "hierarchy_seed_accepted");
    guest.send(packet("lock_request", "first-lock"));
    const firstLock = await guest.reply("first-lock");
    assert.equal(firstLock.type, "lock_granted");
    assert.equal(firstLock.lockState.ownerConnectionId, original.connectionId);

    // Commit reaches the real Server and observer; only its ACK path is lost.
    proxy.mode = "drop-server";
    const unacknowledged = packet("transform_update", "lost-ack", {
      operationId: "committed-before-fault", baseRevision: 0, ...pose(1),
    });
    guest.send(unacknowledged);
    const committed = await observer.reply("lost-ack");
    assert.equal(committed.type, "transform_applied");
    assert.equal(committed.serverRevision, 1);
    await until(() => proxy.droppedText.includes('"requestId":"lost-ack"'),
      "discarded Server ACK bytes", t.signal);
    assert(!guest.received.some((m) => m.requestId === "lost-ack"));

    if (fault === "abrupt-drop") proxy.cut();
    else {
      // Discard, never queue, both TCP directions while leaving sockets alive.
      proxy.mode = "blackhole";
      guest.send({ type: "ping", protocolVersion: 1, requestId: "blocked-ping" });
      await until(() => proxy.blackholeToServer > 0 && proxy.blackholeToGuest > 0,
        "bidirectional live TCP blackhole", t.signal);
    }
    const released = await observer.next((m) => m.type === "lock_released", "old lock release");
    assert.equal(released.reason, "connection_closed");
    assert.equal(released.previousOwnerConnectionId, original.connectionId);
    assert.equal(released.previousOwnerUserId, "guest");
    assert.equal(released.sceneId, sceneId);
    assert.equal(released.objectId, objectId);
    const left = await observer.next((m) => m.type === "user_left", "old Guest departure");
    assert.equal(left.connectionId, original.connectionId);
    assert.equal(left.userId, "guest");
    await until(() => guest.socket.readyState === WebSocket.CLOSED, "old Guest close", t.signal);
    assert.equal(server.activeLockCount, 0);
    assert.equal(observer.socket.readyState, WebSocket.OPEN);
    assert.equal(server.connectionCount, 1);
    assert(Date.now() < firstLock.lockState.expiresAtUnixMs, "disconnect, not lease expiry, released the lock");

    proxy.mode = "pass";
    const replacement = peer(proxyUrl, token, owned, t.signal);
    const rejoined = await join(replacement, "guest", sessionId);
    assert.notEqual(rejoined.connectionId, original.connectionId);
    assert.equal(rejoined.presence.members.length, 2);
    assert(!rejoined.presence.members.some((m) => m.connectionId === original.connectionId));
    assert.equal(rejoined.hierarchy.serverRevision, 1);
    assert.equal(rejoined.transform.serverRevision, 1);
    assert.deepEqual(rejoined.transform.locks, []);
    assert.deepEqual(rejoined.hierarchy.objects.find((o) => o.objectId === objectId).localPosition,
      unacknowledged.localPosition);
    assert.deepEqual(rejoined.transform.transforms.find((o) => o.objectId === objectId), committed);

    replacement.send({ ...unacknowledged, requestId: "replay" });
    assert.deepEqual(await replacement.reply("replay"), { ...committed, requestId: "replay" });
    replacement.send({ ...unacknowledged, requestId: "conflicting-replay", ...pose(99) });
    assert.equal((await replacement.reply("conflicting-replay")).code, "operation_id_conflict");
    const nextWrite = packet("transform_update", "no-inherited-lock", {
      operationId: "new-after-rejoin", baseRevision: 1, ...pose(7),
    });
    replacement.send(nextWrite);
    assert.equal((await replacement.reply("no-inherited-lock")).code, "lock_required");
    replacement.send(packet("lock_request", "new-lock"));
    const newLock = await replacement.reply("new-lock");
    assert.equal(newLock.type, "lock_granted");
    assert.equal(newLock.lockState.ownerConnectionId, rejoined.connectionId);
    replacement.send({ ...nextWrite, requestId: "new-transform" });
    const transformed = await replacement.reply("new-transform");
    assert.equal(transformed.type, "transform_applied");
    assert.equal(transformed.serverRevision, 2);
    assert.deepEqual(transformed.localPosition, nextWrite.localPosition);
    assert.deepEqual(await observer.reply("new-transform"), transformed);
    replacement.send(packet("hierarchy_operation", "new-hierarchy", {
      operationId: "rename-after-rejoin", baseRevision: 2,
      kind: "rename_object", name: "Recovered",
    }));
    const renamed = await replacement.reply("new-hierarchy");
    assert.equal(renamed.type, "hierarchy_applied");
    assert.equal(renamed.serverRevision, 3);
    assert.equal(renamed.changedObjects.find((o) => o.objectId === objectId).name, "Recovered");
    assert.deepEqual(await observer.reply("new-hierarchy"), renamed);
    assert.equal(observer.received.filter((m) => m.operationId === unacknowledged.operationId).length, 1,
      "replay/conflict must not broadcast another committed operation");
    assert.equal(observer.received.filter((m) => m.operationId === nextWrite.operationId).length, 1);
    replacement.send(packet("lock_release", "release-new-lock"));
    const finalRelease = await observer.reply("release-new-lock");
    assert.equal(finalRelease.reason, "client_release");
    assert.equal(finalRelease.previousOwnerConnectionId, rejoined.connectionId);
    assert.equal(server.activeLockCount, 0);
    t.diagnostic(JSON.stringify({
      evidenceClass: "same-PC-real-Node-transport-fault-injection", fault,
      committedBeforeLostAck: 1, replayRevision: 1, recoveredFinalRevision: 3,
      unityAutomaticReconnect: "NOT RUN", physicalTwoPcNicLoss: "NOT RUN",
    }));
  });
}
