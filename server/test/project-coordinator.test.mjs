import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { WebSocket } from "ws";
import {
  baselineCanonicalPayload,
  descriptorFields,
  ownerProofPayload,
  publisherAuthorizationPayload,
} from "../src/project-coordinator.mjs";
import { createTeamForgeServer } from "../src/teamforge-server.mjs";

const silentLogger = { info() {}, warn() {}, error() {} };
const DEFAULT_UUID = "b3b67aa1-524b-4d69-b7f3-82448f45770c";
const goldenCompatibility = JSON.parse(await readFile(new URL(
  "../../unity-package/com.eunsung.teamforge/Tests/Fixtures/teamforge-compatibility-v1.json",
  import.meta.url,
), "utf8"));

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

function closeWebSocket(socket) {
  return new Promise((resolve) => {
    if (!socket || socket.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    socket.once("close", resolve);
    socket.close();
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
      value.inboxError ? waiter.reject(value.inboxError) : waiter.resolve(value);
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
          reject(new Error("Timed out waiting for JSON message."));
        }, timeoutMilliseconds);
        waiters.push(waiter);
      });
    },
    async nextType(type, timeoutMilliseconds = 2_000) {
      const deadline = Date.now() + timeoutMilliseconds;
      while (Date.now() < deadline) {
        const message = await this.next(Math.max(1, deadline - Date.now()));
        if (message.type === type) {
          return message;
        }
      }
      throw new Error(`Timed out waiting for ${type}.`);
    },
    async nextRequest(requestId, timeoutMilliseconds = 2_000) {
      const deadline = Date.now() + timeoutMilliseconds;
      while (Date.now() < deadline) {
        const message = await this.next(Math.max(1, deadline - Date.now()));
        if (message.requestId === requestId) {
          return message;
        }
      }
      throw new Error(`Timed out waiting for request ${requestId}.`);
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

async function startServer(options = {}) {
  const server = createTeamForgeServer({
    host: "127.0.0.1",
    port: 0,
    logger: silentLogger,
    ...options,
  });
  const endpoint = await server.start();
  return {
    server,
    endpoint,
    url: `ws://127.0.0.1:${endpoint.port}${endpoint.wsPath}`,
  };
}

function projectHello(overrides = {}) {
  return {
    type: "hello",
    protocolVersion: 1,
    requestId: "project-hello",
    userName: "Project Peer",
    userId: "project-user",
    projectId: "project-coordinator-test",
    sessionId: "project-session",
    supportsProjectTransfer: true,
    ...overrides,
  };
}

async function connectProject(url, overrides = {}) {
  const socket = await openWebSocket(url);
  const inbox = createJsonInbox(socket);
  socket.send(JSON.stringify(projectHello(overrides)));
  const acknowledgement = await inbox.next();
  assert.equal(acknowledgement.type, "hello_ack");
  assert.equal(acknowledgement.projectTransferEnabled, true);
  const snapshot = await inbox.next();
  assert.equal(snapshot.type, "project_registry_snapshot");
  return { socket, inbox, acknowledgement, snapshot };
}

function keyMaterial() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" });
  return {
    publicKey,
    privateKey,
    publicKeyBase64: der.toString("base64"),
    keyId: createHash("sha256").update(der).digest("hex"),
  };
}

function sha256Text(value) {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}

function signedDescriptor({
  projectId = "project-coordinator-test",
  projectUuid = DEFAULT_UUID,
  userId = "project-user",
  baselineRevision = 1,
  manifestHash = "a".repeat(64),
  owner,
  publisher = owner,
  unityVersion = "6000.3.21f1",
  teamForgePackageVersion = "0.5.1",
} = {}) {
  const descriptor = {
    userId,
    projectUuid,
    baselineRevision,
    manifestHash,
    descriptorHash: "",
    unityVersion,
    teamForgePackageVersion,
    realtimeProtocolVersion: 1,
    transferProtocolVersion: 1,
    manifestSchemaVersion: 1,
    ownerKeyId: owner.keyId,
    ownerPublicKey: owner.publicKeyBase64,
    publisherKeyId: publisher.keyId,
    publisherPublicKey: publisher.publicKeyBase64,
    publisherAuthorization: "",
    baselineSignature: "",
  };
  if (publisher.keyId !== owner.keyId) {
    descriptor.publisherAuthorization = sign(
      null,
      Buffer.from(publisherAuthorizationPayload(projectUuid, publisher.keyId), "utf8"),
      owner.privateKey,
    ).toString("base64");
  }
  const canonical = baselineCanonicalPayload(projectId, descriptor);
  descriptor.descriptorHash = sha256Text(canonical);
  descriptor.baselineSignature = sign(
    null,
    Buffer.from(canonical, "utf8"),
    publisher.privateKey,
  ).toString("base64");
  return descriptor;
}

function publishMessage(descriptor, overrides = {}) {
  return {
    type: "project_baseline_publish",
    protocolVersion: 1,
    requestId: "baseline-publish",
    ...descriptor,
    ...overrides,
  };
}

function announceMessage(descriptor, {
  projectId = "project-coordinator-test",
  connectionId,
  owner,
  ownerProof = false,
  requestId = "peer-announce",
  completeBaseline = true,
  availableChunkCount = 10,
  totalChunkCount = 10,
  endpoint = "http://127.0.0.1:5091/teamforge-transfer/v1",
  transferToken = "0123456789abcdef0123456789abcdef",
  ...overrides
} = {}) {
  const message = {
    type: "project_peer_announce",
    protocolVersion: 1,
    requestId,
    ...descriptor,
    completeBaseline,
    availableChunkCount,
    totalChunkCount,
    endpoint,
    transferToken,
    ownerProofSignature: "",
    ...overrides,
  };
  if (ownerProof) {
    message.ownerProofSignature = sign(
      null,
      Buffer.from(ownerProofPayload(projectId, connectionId, message), "utf8"),
      owner.privateKey,
    ).toString("base64");
  }
  return message;
}

async function disposeConnections(connections) {
  for (const connection of connections) {
    connection?.inbox?.dispose();
  }
  await Promise.all(connections.map((connection) => closeWebSocket(connection?.socket)));
}

test("canonical Baseline Descriptor fixture has the cross-implementation SHA-256 value", () => {
  const descriptor = {
    projectUuid: DEFAULT_UUID,
    baselineRevision: 7,
    manifestHash: "0123456789abcdef".repeat(4),
    unityVersion: "6000.3.21f1",
    teamForgePackageVersion: "0.5.1",
    realtimeProtocolVersion: 1,
    transferProtocolVersion: 1,
    manifestSchemaVersion: 1,
    ownerKeyId: "1".repeat(64),
    publisherKeyId: "2".repeat(64),
  };
  const canonical = baselineCanonicalPayload("fixture-project", descriptor);
  assert.equal(
    canonical,
    [
      "teamforge-baseline-v1",
      "fixture-project",
      DEFAULT_UUID,
      "7",
      "0123456789abcdef".repeat(4),
      "6000.3.21f1",
      "0.5.1",
      "1",
      "1",
      "1",
      "1".repeat(64),
      "2".repeat(64),
    ].join("\n"),
  );
  assert.equal(sha256Text(canonical), "f8efc28dbccaf5fe4ac3e9fdc61d82654f66436f642c756abe2dd3435202b8ce");
});

test("project-only capability registers safely and a duplicate stable user supersedes the stale peer", async () => {
  const runtime = await startServer();
  const owner = keyMaterial();
  let first;
  let replacement;
  try {
    first = await connectProject(runtime.url, {
      requestId: "project-only-first",
      userId: "stable-project-user",
    });
    const descriptor = signedDescriptor({ owner, userId: "stable-project-user" });
    first.socket.send(JSON.stringify(announceMessage(descriptor, {
      connectionId: first.acknowledgement.connectionId,
      owner,
      ownerProof: true,
      requestId: "first-peer",
    })));
    assert.equal((await first.inbox.nextType("project_baseline_changed")).baseline.baselineRevision, 1);
    assert.equal((await first.inbox.nextType("project_peer_joined")).peer.seedRank, 0);

    const firstClosed = new Promise((resolve) => first.socket.once("close", resolve));
    replacement = await connectProject(runtime.url, {
      requestId: "project-only-replacement",
      userId: "stable-project-user",
    });
    const superseded = await first.inbox.nextType("error");
    assert.equal(superseded.code, "session_superseded");
    await firstClosed;
    assert.deepEqual(replacement.snapshot.peers, []);

    const health = await (await fetch(
      `http://127.0.0.1:${runtime.endpoint.port}${runtime.endpoint.healthPath}`,
    )).json();
    assert.equal(health.projectClients, 1);
    assert.equal(health.projectPeers, 0);
  } finally {
    await disposeConnections([first, replacement]);
    await runtime.server.stop();
  }
});

test("combined Presence and Project capability supersedes both registries without duplicate users", async () => {
  const runtime = await startServer();
  const owner = keyMaterial();
  let first;
  let replacement;
  try {
    const firstSocket = await openWebSocket(runtime.url);
    const firstInbox = createJsonInbox(firstSocket);
    first = { socket: firstSocket, inbox: firstInbox };
    firstSocket.send(JSON.stringify(projectHello({
      requestId: "combined-first",
      userId: "combined-user",
      supportsPresence: true,
      userColor: "#64B5F6",
    })));
    first.acknowledgement = await firstInbox.next();
    assert.equal(first.acknowledgement.presenceEnabled, true);
    assert.equal(first.acknowledgement.projectTransferEnabled, true);
    assert.equal((await firstInbox.next()).type, "presence_snapshot");
    assert.equal((await firstInbox.next()).type, "project_registry_snapshot");

    const descriptor = signedDescriptor({ owner, userId: "combined-user" });
    firstSocket.send(JSON.stringify(announceMessage(descriptor, {
      connectionId: first.acknowledgement.connectionId,
      owner,
      ownerProof: true,
      requestId: "combined-first-peer",
    })));
    await firstInbox.nextType("project_baseline_changed");
    await firstInbox.nextType("project_peer_joined");

    const firstClosed = new Promise((resolve) => firstSocket.once("close", resolve));
    const replacementSocket = await openWebSocket(runtime.url);
    const replacementInbox = createJsonInbox(replacementSocket);
    replacement = { socket: replacementSocket, inbox: replacementInbox };
    replacementSocket.send(JSON.stringify(projectHello({
      requestId: "combined-replacement",
      userId: "combined-user",
      supportsPresence: true,
      userColor: "#64B5F6",
    })));
    const replacementAck = await replacementInbox.next();
    assert.equal(replacementAck.type, "hello_ack");
    const presenceSnapshot = await replacementInbox.next();
    const projectSnapshot = await replacementInbox.next();
    assert.equal(presenceSnapshot.type, "presence_snapshot");
    assert.deepEqual(presenceSnapshot.members.map((member) => member.userId), ["combined-user"]);
    assert.equal(projectSnapshot.type, "project_registry_snapshot");
    assert.deepEqual(projectSnapshot.peers, []);
    assert.equal((await firstInbox.nextType("error")).code, "session_superseded");
    await firstClosed;
  } finally {
    await disposeConnections([first, replacement]);
    await runtime.server.stop();
  }
});

test("a global projectId rejects a different projectUuid across sessions", async () => {
  const runtime = await startServer();
  const ownerA = keyMaterial();
  const ownerB = keyMaterial();
  let first;
  let conflicting;
  try {
    first = await connectProject(runtime.url, { requestId: "uuid-a", sessionId: "session-a" });
    const descriptorA = signedDescriptor({ owner: ownerA });
    first.socket.send(JSON.stringify(announceMessage(descriptorA, {
      connectionId: first.acknowledgement.connectionId,
      owner: ownerA,
      ownerProof: true,
      requestId: "uuid-a-announce",
    })));
    await first.inbox.nextType("project_baseline_changed");
    await first.inbox.nextType("project_peer_joined");

    conflicting = await connectProject(runtime.url, {
      requestId: "uuid-b",
      sessionId: "session-b",
      userId: "project-user-b",
    });
    assert.equal(conflicting.snapshot.projectUuid, DEFAULT_UUID);
    const descriptorB = signedDescriptor({
      owner: ownerB,
      userId: "project-user-b",
      projectUuid: "fc3ae152-8817-4eb2-ac99-3033b9b51ac2",
    });
    conflicting.socket.send(JSON.stringify(announceMessage(descriptorB, {
      connectionId: conflicting.acknowledgement.connectionId,
      owner: ownerB,
      ownerProof: true,
      requestId: "uuid-conflict",
      endpoint: "http://127.0.0.1:5092/teamforge-transfer/v1",
    })));
    const rejected = await conflicting.inbox.nextRequest("uuid-conflict");
    assert.equal(rejected.type, "error");
    assert.equal(rejected.code, "project_uuid_conflict");
    assert.equal(runtime.server.projectRegistryCount, 1);
    assert.equal(runtime.server.projectPeerCount, 1);
  } finally {
    await disposeConnections([first, conflicting]);
    await runtime.server.stop();
  }
});

test("Baseline metadata is project-global while peer endpoints and tokens stay session-isolated", async () => {
  const runtime = await startServer();
  const owner = keyMaterial();
  let sessionA;
  let sessionB;
  try {
    sessionA = await connectProject(runtime.url, { requestId: "isolation-a", sessionId: "session-a" });
    sessionB = await connectProject(runtime.url, {
      requestId: "isolation-b",
      sessionId: "session-b",
      userId: "project-user-b",
    });
    const descriptor = signedDescriptor({ owner });
    sessionA.socket.send(JSON.stringify(publishMessage(descriptor, { requestId: "global-publish" })));
    const changedA = await sessionA.inbox.nextRequest("global-publish");
    const changedB = await sessionB.inbox.nextRequest("global-publish");
    assert.equal(changedA.type, "project_baseline_changed");
    assert.equal(changedB.baseline.manifestHash, descriptor.manifestHash);
    assert.equal("endpoint" in changedB.baseline, false);
    assert.equal("transferToken" in changedB.baseline, false);

    sessionA.socket.send(JSON.stringify(announceMessage(descriptor, {
      connectionId: sessionA.acknowledgement.connectionId,
      owner,
      ownerProof: true,
      requestId: "isolated-peer",
      transferToken: "session-a-private-token-0001",
    })));
    const joinedA = await sessionA.inbox.nextRequest("isolated-peer");
    assert.equal(joinedA.type, "project_peer_joined");
    assert.equal(joinedA.peer.transferToken, "session-a-private-token-0001");

    sessionB.socket.send(JSON.stringify({
      type: "ping",
      protocolVersion: 1,
      requestId: "isolation-ping",
      clientTimestampUnixMs: Date.now(),
    }));
    const nextForB = await sessionB.inbox.next();
    assert.equal(nextForB.type, "pong");
    assert.equal(nextForB.requestId, "isolation-ping");

    const observerB = await connectProject(runtime.url, {
      requestId: "isolation-observer-b",
      sessionId: "session-b",
      userId: "project-user-c",
    });
    try {
      assert.equal(observerB.snapshot.baseline.baselineRevision, 1);
      assert.deepEqual(observerB.snapshot.peers, []);
    } finally {
      await disposeConnections([observerB]);
    }
  } finally {
    await disposeConnections([sessionA, sessionB]);
    await runtime.server.stop();
  }
});

test("peer announce, endpoint update, and disconnect emit joined, updated, and left events", async () => {
  const runtime = await startServer();
  const owner = keyMaterial();
  let observer;
  let peer;
  try {
    observer = await connectProject(runtime.url, { requestId: "events-observer", userId: "events-observer" });
    peer = await connectProject(runtime.url, { requestId: "events-peer", userId: "events-peer" });
    const descriptor = signedDescriptor({ owner, userId: "events-peer" });
    peer.socket.send(JSON.stringify(announceMessage(descriptor, {
      connectionId: peer.acknowledgement.connectionId,
      owner,
      ownerProof: true,
      requestId: "events-joined",
      transferToken: "events-transfer-token-0000001",
    })));
    await observer.inbox.nextType("project_baseline_changed");
    const joined = await observer.inbox.nextType("project_peer_joined");
    assert.equal(joined.peer.userId, "events-peer");
    assert.equal(joined.peer.transferToken, "events-transfer-token-0000001");

    peer.socket.send(JSON.stringify(announceMessage(descriptor, {
      connectionId: peer.acknowledgement.connectionId,
      owner,
      ownerProof: true,
      requestId: "events-updated",
      endpoint: "http://127.0.0.1:5098/teamforge-transfer/v1",
      transferToken: "events-transfer-token-0000002",
    })));
    const updated = await observer.inbox.nextType("project_peer_updated");
    assert.equal(updated.peer.endpoint, "http://127.0.0.1:5098/teamforge-transfer/v1");
    assert.equal(updated.peer.transferToken, "events-transfer-token-0000002");

    await closeWebSocket(peer.socket);
    const left = await observer.inbox.nextType("project_peer_left");
    assert.equal(left.peer.connectionId, peer.acknowledgement.connectionId);
    assert.equal(left.peer.leaveReason, "connection_closed");
    peer.inbox.dispose();
    peer = null;
  } finally {
    await disposeConnections([observer, peer]);
    await runtime.server.stop();
  }
});

test("verified Owner, complete Replica, and partial Peer are deterministically ranked 0, 1, and 2", async () => {
  const runtime = await startServer();
  const owner = keyMaterial();
  const connections = [];
  try {
    const ownerPeer = await connectProject(runtime.url, { requestId: "rank-owner", userId: "owner-user" });
    connections.push(ownerPeer);
    const descriptorOwner = signedDescriptor({ owner, userId: "owner-user" });
    ownerPeer.socket.send(JSON.stringify(announceMessage(descriptorOwner, {
      connectionId: ownerPeer.acknowledgement.connectionId,
      owner,
      ownerProof: true,
      requestId: "rank-owner-announce",
    })));
    await ownerPeer.inbox.nextType("project_baseline_changed");
    assert.equal((await ownerPeer.inbox.nextType("project_peer_joined")).peer.seedRank, 0);

    const replica = await connectProject(runtime.url, { requestId: "rank-replica", userId: "replica-user" });
    connections.push(replica);
    const descriptorReplica = signedDescriptor({ owner, userId: "replica-user" });
    replica.socket.send(JSON.stringify(announceMessage(descriptorReplica, {
      connectionId: replica.acknowledgement.connectionId,
      owner,
      requestId: "rank-replica-announce",
      endpoint: "http://127.0.0.1:5092/teamforge-transfer/v1",
      transferToken: "replica-transfer-token-000001",
    })));
    assert.equal((await replica.inbox.nextType("project_peer_joined")).peer.seedRank, 1);

    const partial = await connectProject(runtime.url, { requestId: "rank-partial", userId: "partial-user" });
    connections.push(partial);
    const descriptorPartial = signedDescriptor({ owner, userId: "partial-user" });
    partial.socket.send(JSON.stringify(announceMessage(descriptorPartial, {
      connectionId: partial.acknowledgement.connectionId,
      owner,
      requestId: "rank-partial-announce",
      completeBaseline: false,
      availableChunkCount: 4,
      totalChunkCount: 10,
      endpoint: "http://127.0.0.1:5093/teamforge-transfer/v1",
      transferToken: "partial-transfer-token-000001",
    })));
    assert.equal((await partial.inbox.nextType("project_peer_joined")).peer.seedRank, 2);

    const observer = await connectProject(runtime.url, { requestId: "rank-observer", userId: "observer-user" });
    connections.push(observer);
    assert.deepEqual(observer.snapshot.peers.map((peer) => peer.seedRank), [0, 1, 2]);
    assert.deepEqual(observer.snapshot.peers.map((peer) => peer.userId), ["owner-user", "replica-user", "partial-user"]);
  } finally {
    await disposeConnections(connections);
    await runtime.server.stop();
  }
});

test("an explicit bootstrap publisher without chunks ranks 3 and incompatible peers rank 99", async () => {
  const runtime = await startServer();
  const owner = keyMaterial();
  const connections = [];
  try {
    const bootstrap = await connectProject(runtime.url, { requestId: "bootstrap", userId: "bootstrap-user" });
    connections.push(bootstrap);
    const descriptor = signedDescriptor({ owner, userId: "bootstrap-user" });
    bootstrap.socket.send(JSON.stringify(publishMessage(descriptor, { requestId: "bootstrap-publish" })));
    await bootstrap.inbox.nextRequest("bootstrap-publish");
    bootstrap.socket.send(JSON.stringify(announceMessage(descriptor, {
      connectionId: bootstrap.acknowledgement.connectionId,
      owner,
      requestId: "bootstrap-empty-peer",
      completeBaseline: false,
      availableChunkCount: 0,
      totalChunkCount: 10,
    })));
    assert.equal((await bootstrap.inbox.nextRequest("bootstrap-empty-peer")).peer.seedRank, 3);

    const incompatible = await connectProject(runtime.url, {
      requestId: "incompatible",
      userId: "incompatible-user",
    });
    connections.push(incompatible);
    const incompatibleDescriptor = signedDescriptor({
      owner,
      userId: "incompatible-user",
      teamForgePackageVersion: "9.9.9",
    });
    incompatible.socket.send(JSON.stringify(announceMessage(incompatibleDescriptor, {
      connectionId: incompatible.acknowledgement.connectionId,
      owner,
      requestId: "incompatible-peer",
      endpoint: "http://127.0.0.1:5094/teamforge-transfer/v1",
      transferToken: "incompatible-token-00000001",
    })));
    assert.equal((await incompatible.inbox.nextRequest("incompatible-peer")).peer.seedRank, 99);
    assert.equal((await incompatible.inbox.nextType("project_sync_required")).reason, "incompatible_descriptor");
  } finally {
    await disposeConnections(connections);
    await runtime.server.stop();
  }
});

test("Baseline publish is serial, idempotent, and admits only one conflicting next revision", async () => {
  const runtime = await startServer();
  const owner = keyMaterial();
  const connections = [];
  try {
    const publisherA = await connectProject(runtime.url, { requestId: "publish-a", userId: "publisher-a" });
    const publisherB = await connectProject(runtime.url, { requestId: "publish-b", userId: "publisher-b" });
    connections.push(publisherA, publisherB);
    const revisionOne = signedDescriptor({ owner, userId: "publisher-a" });
    publisherA.socket.send(JSON.stringify(publishMessage(revisionOne, { requestId: "publish-revision-1" })));
    assert.equal((await publisherA.inbox.nextRequest("publish-revision-1")).type, "project_baseline_changed");
    await publisherB.inbox.nextRequest("publish-revision-1");

    publisherA.socket.send(JSON.stringify(publishMessage(revisionOne, { requestId: "publish-revision-1-retry" })));
    const retry = await publisherA.inbox.nextRequest("publish-revision-1-retry");
    assert.equal(retry.type, "project_baseline_changed");
    assert.equal(retry.idempotent, true);

    const revisionTwoA = signedDescriptor({
      owner,
      userId: "publisher-a",
      baselineRevision: 2,
      manifestHash: "b".repeat(64),
    });
    const revisionTwoB = signedDescriptor({
      owner,
      userId: "publisher-b",
      baselineRevision: 2,
      manifestHash: "c".repeat(64),
    });
    publisherA.socket.send(JSON.stringify(publishMessage(revisionTwoA, { requestId: "publish-race-a" })));
    publisherB.socket.send(JSON.stringify(publishMessage(revisionTwoB, { requestId: "publish-race-b" })));

    const resultA = await publisherA.inbox.nextRequest("publish-race-a");
    const resultB = await publisherB.inbox.nextRequest("publish-race-b");
    const results = [resultA, resultB];
    assert.equal(results.filter((message) => message.type === "project_baseline_changed").length, 1);
    assert.equal(results.filter((message) => message.code === "baseline_revision_conflict").length, 1);

    const observer = await connectProject(runtime.url, { requestId: "publish-race-observer", userId: "observer" });
    connections.push(observer);
    assert.equal(observer.snapshot.baseline.baselineRevision, 2);
    assert.equal(
      [revisionTwoA.manifestHash, revisionTwoB.manifestHash].includes(observer.snapshot.baseline.manifestHash),
      true,
    );
  } finally {
    await disposeConnections(connections);
    await runtime.server.stop();
  }
});

test("an old Owner cannot downgrade, while a latest Owner proof outranks an approved Publisher replica", async () => {
  const runtime = await startServer();
  const owner = keyMaterial();
  const publisher = keyMaterial();
  const connections = [];
  try {
    const ownerPeer = await connectProject(runtime.url, { requestId: "owner-old", userId: "owner-user" });
    const publisherPeer = await connectProject(runtime.url, { requestId: "publisher-new", userId: "publisher-user" });
    connections.push(ownerPeer, publisherPeer);
    const revisionOne = signedDescriptor({ owner, userId: "owner-user" });
    ownerPeer.socket.send(JSON.stringify(announceMessage(revisionOne, {
      connectionId: ownerPeer.acknowledgement.connectionId,
      owner,
      ownerProof: true,
      requestId: "owner-revision-one",
    })));
    await ownerPeer.inbox.nextType("project_baseline_changed");
    assert.equal((await ownerPeer.inbox.nextType("project_peer_joined")).peer.seedRank, 0);

    const revisionTwo = signedDescriptor({
      owner,
      publisher,
      userId: "publisher-user",
      baselineRevision: 2,
      manifestHash: "d".repeat(64),
    });
    publisherPeer.socket.send(JSON.stringify(publishMessage(revisionTwo, { requestId: "publisher-revision-two" })));
    assert.equal((await publisherPeer.inbox.nextRequest("publisher-revision-two")).type, "project_baseline_changed");

    publisherPeer.socket.send(JSON.stringify(announceMessage(revisionTwo, {
      connectionId: publisherPeer.acknowledgement.connectionId,
      owner,
      requestId: "publisher-replica",
      endpoint: "http://127.0.0.1:5092/teamforge-transfer/v1",
      transferToken: "publisher-transfer-token-00001",
    })));
    assert.equal((await publisherPeer.inbox.nextRequest("publisher-replica")).peer.seedRank, 1);

    const oldOwnerDescriptor = signedDescriptor({ owner, userId: "owner-user" });
    ownerPeer.socket.send(JSON.stringify(announceMessage(oldOwnerDescriptor, {
      connectionId: ownerPeer.acknowledgement.connectionId,
      owner,
      ownerProof: true,
      requestId: "old-owner-readvertise",
    })));
    assert.equal((await ownerPeer.inbox.nextRequest("old-owner-readvertise")).peer.seedRank, 99);
    const syncRequired = await ownerPeer.inbox.nextType("project_sync_required");
    assert.equal(syncRequired.reason, "baseline_outdated");

    ownerPeer.socket.send(JSON.stringify(publishMessage(oldOwnerDescriptor, { requestId: "owner-downgrade" })));
    const downgrade = await ownerPeer.inbox.nextRequest("owner-downgrade");
    assert.equal(downgrade.type, "error");
    assert.equal(downgrade.code, "baseline_downgrade");

    const latestOwnerDescriptor = signedDescriptor({
      owner,
      publisher,
      userId: "owner-user",
      baselineRevision: 2,
      manifestHash: revisionTwo.manifestHash,
    });
    ownerPeer.socket.send(JSON.stringify(announceMessage(latestOwnerDescriptor, {
      connectionId: ownerPeer.acknowledgement.connectionId,
      owner,
      ownerProof: true,
      requestId: "latest-owner",
    })));
    assert.equal((await ownerPeer.inbox.nextRequest("latest-owner")).peer.seedRank, 0);

    const observer = await connectProject(runtime.url, { requestId: "latest-owner-observer", userId: "observer-user" });
    connections.push(observer);
    assert.deepEqual(observer.snapshot.peers.slice(0, 2).map((peer) => peer.seedRank), [0, 1]);
    assert.equal(observer.snapshot.peers[0].userId, "owner-user");
  } finally {
    await disposeConnections(connections);
    await runtime.server.stop();
  }
});

test("a signed peer advertisement reconstructs the in-memory Baseline after server restart", async () => {
  const owner = keyMaterial();
  const descriptor = signedDescriptor({
    owner,
    baselineRevision: 3,
    manifestHash: "e".repeat(64),
  });
  let firstRuntime;
  let secondRuntime;
  let first;
  let second;
  try {
    firstRuntime = await startServer();
    first = await connectProject(firstRuntime.url, { requestId: "restart-first" });
    assert.equal(first.snapshot.baseline, null);
    first.socket.send(JSON.stringify(announceMessage(descriptor, {
      connectionId: first.acknowledgement.connectionId,
      owner,
      ownerProof: true,
      requestId: "restart-first-announce",
    })));
    const firstChanged = await first.inbox.nextType("project_baseline_changed");
    assert.equal(firstChanged.baseline.baselineRevision, 3);
    await first.inbox.nextType("project_peer_joined");
    await disposeConnections([first]);
    first = null;
    await firstRuntime.server.stop();
    firstRuntime = null;

    secondRuntime = await startServer();
    second = await connectProject(secondRuntime.url, { requestId: "restart-second" });
    assert.equal(second.snapshot.baseline, null);
    second.socket.send(JSON.stringify(announceMessage(descriptor, {
      connectionId: second.acknowledgement.connectionId,
      owner,
      ownerProof: true,
      requestId: "restart-readvertise",
    })));
    const recovered = await second.inbox.nextType("project_baseline_changed");
    assert.equal(recovered.baseline.baselineRevision, 3);
    assert.equal(recovered.baseline.descriptorHash, descriptor.descriptorHash);
    assert.equal((await second.inbox.nextType("project_peer_joined")).peer.seedRank, 0);
    assert.equal(secondRuntime.server.projectRegistryCount, 1);
  } finally {
    await disposeConnections([first, second]);
    if (firstRuntime) {
      await firstRuntime.server.stop();
    }
    if (secondRuntime) {
      await secondRuntime.server.stop();
    }
  }
});

test("TOFU reconstruction accepts a verified partial replica without pretending a complete Seed exists", async () => {
  const runtime = await startServer();
  const owner = keyMaterial();
  const connections = [];
  try {
    const partial = await connectProject(runtime.url, { requestId: "tofu-partial", userId: "partial-replica" });
    connections.push(partial);
    const descriptor = signedDescriptor({
      owner,
      userId: "partial-replica",
      baselineRevision: 4,
      manifestHash: "f".repeat(64),
    });
    partial.socket.send(JSON.stringify(announceMessage(descriptor, {
      connectionId: partial.acknowledgement.connectionId,
      owner,
      requestId: "tofu-partial-announce",
      completeBaseline: false,
      availableChunkCount: 3,
      totalChunkCount: 12,
    })));
    assert.equal((await partial.inbox.nextType("project_baseline_changed")).baseline.baselineRevision, 4);
    const joined = await partial.inbox.nextType("project_peer_joined");
    assert.equal(joined.peer.descriptorVerified, true);
    assert.equal(joined.peer.ownerProofVerified, false);
    assert.equal(joined.peer.seedRank, 2);

    const observer = await connectProject(runtime.url, { requestId: "tofu-observer", userId: "tofu-observer" });
    connections.push(observer);
    assert.equal(observer.snapshot.baseline.baselineRevision, 4);
    assert.deepEqual(observer.snapshot.peers.map((peer) => peer.seedRank), [2]);
    assert.equal(observer.snapshot.peers.some((peer) => peer.completeBaseline), false);
  } finally {
    await disposeConnections(connections);
    await runtime.server.stop();
  }
});

test("Project payload fields and invalid Ed25519 proof are rejected without creating registry state", async () => {
  const runtime = await startServer();
  const owner = keyMaterial();
  let client;
  try {
    client = await connectProject(runtime.url, { requestId: "payload-client" });
    const descriptor = signedDescriptor({ owner });
    const payloadAnnouncement = announceMessage(descriptor, {
      connectionId: client.acknowledgement.connectionId,
      owner,
      requestId: "payload-announcement",
    });
    payloadAnnouncement.manifest = { files: [{ path: "Assets/secret.txt" }] };
    client.socket.send(JSON.stringify(payloadAnnouncement));
    const rejectedAnnouncement = await client.inbox.nextRequest("payload-announcement");
    assert.equal(rejectedAnnouncement.type, "error");
    assert.equal(rejectedAnnouncement.code, "invalid_project_message");

    const payloadPublish = publishMessage(descriptor, { requestId: "payload-publish" });
    payloadPublish.chunkBytes = "forbidden";
    client.socket.send(JSON.stringify(payloadPublish));
    const rejectedPublish = await client.inbox.nextRequest("payload-publish");
    assert.equal(rejectedPublish.code, "invalid_project_message");

    const invalidProof = announceMessage(descriptor, {
      connectionId: client.acknowledgement.connectionId,
      owner,
      requestId: "invalid-proof",
      ownerProofSignature: Buffer.alloc(64, 7).toString("base64"),
    });
    client.socket.send(JSON.stringify(invalidProof));
    const rejectedProof = await client.inbox.nextRequest("invalid-proof");
    assert.equal(rejectedProof.code, "invalid_owner_proof");

    const invalidBaselineSignature = publishMessage({
      ...descriptor,
      baselineSignature: Buffer.alloc(64, 9).toString("base64"),
    }, { requestId: "invalid-baseline-signature" });
    client.socket.send(JSON.stringify(invalidBaselineSignature));
    assert.equal((await client.inbox.nextRequest("invalid-baseline-signature")).code, "invalid_project_signature");

    const approvedPublisher = keyMaterial();
    const invalidAuthorizationDescriptor = signedDescriptor({ owner, publisher: approvedPublisher });
    invalidAuthorizationDescriptor.publisherAuthorization = Buffer.alloc(64, 11).toString("base64");
    const invalidAuthorization = publishMessage(
      invalidAuthorizationDescriptor,
      { requestId: "invalid-publisher-authorization" },
    );
    client.socket.send(JSON.stringify(invalidAuthorization));
    assert.equal((await client.inbox.nextRequest("invalid-publisher-authorization")).code, "invalid_project_signature");
    assert.equal(runtime.server.projectRegistryCount, 0);
    assert.equal(runtime.server.projectPeerCount, 0);

    client.socket.send(JSON.stringify({
      type: "ping",
      protocolVersion: 1,
      requestId: "after-project-rejections",
      clientTimestampUnixMs: Date.now(),
    }));
    assert.equal((await client.inbox.nextRequest("after-project-rejections")).type, "pong");
  } finally {
    await disposeConnections([client]);
    await runtime.server.stop();
  }
});

test("Project registry and peer limits fail closed", async () => {
  const runtime = await startServer({ maxProjectRegistries: 1, maxProjectPeersPerSession: 1 });
  const owner = keyMaterial();
  let first;
  let secondSession;
  let sameSession;
  try {
    first = await connectProject(runtime.url, { requestId: "limit-first", projectId: "limit-project-a" });
    const descriptorA = signedDescriptor({ projectId: "limit-project-a", owner });
    first.socket.send(JSON.stringify(announceMessage(descriptorA, {
      projectId: "limit-project-a",
      connectionId: first.acknowledgement.connectionId,
      owner,
      requestId: "limit-first-announce",
    })));
    await first.inbox.nextType("project_baseline_changed");
    await first.inbox.nextType("project_peer_joined");

    secondSession = await connectProject(runtime.url, {
      requestId: "limit-second-session",
      projectId: "limit-project-b",
      sessionId: "other-session",
      userId: "other-user",
    });
    const descriptorB = signedDescriptor({
      projectId: "limit-project-b",
      projectUuid: "bd4a38e0-1c28-43d0-8c6e-33ad46ba51cd",
      owner,
      userId: "other-user",
    });
    secondSession.socket.send(JSON.stringify(announceMessage(descriptorB, {
      projectId: "limit-project-b",
      connectionId: secondSession.acknowledgement.connectionId,
      owner,
      requestId: "limit-registry-overflow",
    })));
    assert.equal((await secondSession.inbox.nextRequest("limit-registry-overflow")).code, "project_registry_limit");

    const sameSessionSocket = await openWebSocket(runtime.url);
    const sameSessionInbox = createJsonInbox(sameSessionSocket);
    sameSession = { socket: sameSessionSocket, inbox: sameSessionInbox };
    sameSessionSocket.send(JSON.stringify(projectHello({
      requestId: "limit-same-session",
      projectId: "limit-project-a",
      userId: "second-user",
    })));
    const acknowledgement = await sameSessionInbox.next();
    assert.equal(acknowledgement.type, "hello_ack");
    assert.equal(acknowledgement.projectTransferEnabled, false);
    assert.equal((await sameSessionInbox.next()).code, "project_session_limit");
  } finally {
    await disposeConnections([first, secondSession, sameSession]);
    await runtime.server.stop();
  }
});

test("WP1 golden Project Coordinator freezes publish, retry, announce, and late snapshot events", async () => {
  const runtime = await startServer();
  const descriptor = goldenCompatibility.descriptor;
  const projectId = descriptor.projectId;
  const sessionId = "golden-coordinator-session";
  const userId = "golden-coordinator-publisher";
  let publisher;
  let late;
  try {
    publisher = await connectProject(runtime.url, {
      requestId: "golden-coordinator-hello",
      projectId,
      sessionId,
      userId,
    });
    const trace = [
      publisher.acknowledgement.type,
      `${publisher.snapshot.type}:empty`,
    ];
    assert.equal(publisher.snapshot.baseline, null);
    assert.deepEqual(publisher.snapshot.peers, []);

    const coordinatorDescriptor = {};
    for (const field of descriptorFields()) {
      coordinatorDescriptor[field] = field === "userId" ? userId : descriptor[field];
    }
    const publish = {
      type: "project_baseline_publish",
      protocolVersion: 1,
      requestId: "golden-coordinator-publish",
      ...coordinatorDescriptor,
    };
    publisher.socket.send(JSON.stringify(publish));
    let message = await publisher.inbox.next();
    trace.push(`${message.type}@${message.baseline.baselineRevision}:idempotent=${message.idempotent}`);

    publisher.socket.send(JSON.stringify({
      ...publish,
      requestId: "golden-coordinator-publish-retry",
    }));
    message = await publisher.inbox.next();
    trace.push(`${message.type}@${message.baseline.baselineRevision}:idempotent=${message.idempotent}`);

    publisher.socket.send(JSON.stringify({
      type: "project_peer_announce",
      protocolVersion: 1,
      requestId: "golden-coordinator-announce",
      ...coordinatorDescriptor,
      completeBaseline: true,
      availableChunkCount: 4,
      totalChunkCount: 4,
      endpoint: "http://127.0.0.1:5091/teamforge-transfer/v1",
      transferToken: "golden-transfer-token-0000000000000001",
      ownerProofSignature: "",
    }));
    message = await publisher.inbox.next();
    trace.push(`${message.type}:seedRank=${message.peer.seedRank}`);

    late = await connectProject(runtime.url, {
      requestId: "golden-coordinator-late-hello",
      projectId,
      sessionId,
      userId: "golden-coordinator-late",
      userName: "Golden Late Peer",
    });
    trace.push(late.acknowledgement.type);
    trace.push(
      `${late.snapshot.type}@${late.snapshot.baseline.baselineRevision}:peers=${late.snapshot.peers.length}`,
    );
    assert.equal(late.snapshot.peers[0].seedRank, 1);
    assert.equal(late.snapshot.peers[0].transferToken, "golden-transfer-token-0000000000000001");
    assert.deepEqual(trace, goldenCompatibility.coordinatorTrace);
  } finally {
    await disposeConnections([publisher, late]);
    await runtime.server.stop();
  }
});
