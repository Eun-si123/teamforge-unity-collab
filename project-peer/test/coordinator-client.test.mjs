import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { CoordinatorClient, descriptorCoordinatorFields } from "../src/coordinator-client.mjs";
import { cleanup, publicationFixture, temporaryRoot } from "./helpers.mjs";

async function coordinatorHarness(onMessage) {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  server.on("connection", (socket) => {
    socket.on("message", (bytes) => onMessage(socket, JSON.parse(bytes.toString("utf8"))));
  });
  const address = server.address();
  return {
    server,
    address: `ws://127.0.0.1:${address.port}`,
    async stop() {
      for (const client of server.clients) client.terminate();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function options(address) {
  return {
    serverAddress: address,
    realtimePath: "ws",
    userId: "peer-user",
    userName: "Peer User",
    projectId: "test-project",
    sessionId: "editors",
    timeoutMilliseconds: 500,
  };
}

function handshake(socket, message, snapshot) {
  assert.equal(message.type, "hello");
  assert.equal(message.supportsPresence, false);
  assert.equal(message.supportsTransformSync, false);
  assert.equal(message.supportsProjectTransfer, true);
  socket.send(JSON.stringify({
    type: "hello_ack",
    protocolVersion: 1,
    requestId: message.requestId,
    connectionId: "connection-one",
    projectTransferEnabled: true,
  }));
  socket.send(JSON.stringify(snapshot));
}

test("Coordinator rejected upgrades release the connection and preserve the HTTP error", async (t) => {
  for (const status of [401, 403, 503]) {
    for (const unfinishedBody of [false, true]) {
      await t.test(`HTTP ${status}, ${unfinishedBody ? "unfinished" : "complete"} body`, {
        timeout: 5_000,
      }, async (t) => {
        const server = createServer();
        const sockets = new Set();
        let resolveTransportClosed;
        const transportClosed = new Promise((resolve) => { resolveTransportClosed = resolve; });
        server.on("connection", (socket) => {
          sockets.add(socket);
          socket.on("error", () => {});
          socket.on("end", () => socket.end());
          socket.once("close", () => {
            sockets.delete(socket);
            resolveTransportClosed();
          });
        });
        server.on("upgrade", (_request, socket) => {
          socket.write(`HTTP/1.1 ${status} Rejected\r\nContent-Length: ${unfinishedBody ? 100 : 1}\r\nConnection: keep-alive\r\n\r\nx`);
        });
        let client;
        try {
          await new Promise((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", resolve);
          });
          client = new CoordinatorClient(options(`ws://127.0.0.1:${server.address().port}`));
          const connection = client.connect();
          const socket = client.socket;
          const closed = new Promise((resolve) => socket.once("close", resolve));
          await assert.rejects(connection, {
            code: status === 401 || status === 403 ? "access_code_incorrect" : "coordinator_error",
            details: { httpStatus: status },
          });
          assert.notEqual(socket.readyState, WebSocket.CONNECTING,
            "a rejected upgrade must abort the opening handshake");
          await Promise.race([
            Promise.all([closed, transportClosed]),
            new Promise((_, reject) => {
              const timer = setTimeout(() => reject(new Error("rejected connection did not close")), 2_000);
              t.after(() => clearTimeout(timer));
            }),
          ]);
          assert.equal(socket.readyState, WebSocket.CLOSED);
          assert.equal(client.projectTransferEnabled, false);
          assert.equal(client.pendingConnect, null);
        } finally {
          client?.close();
          for (const socket of sockets) socket.destroy();
          await new Promise((resolve) => server.close(resolve));
        }
      });
    }
  }
});

test("Coordinator Sidecar opts out of Presence/Transform and Publish resolves only on matching ack", async () => {
  const root = await temporaryRoot();
  let harness;
  let client;
  try {
    const fixture = await publicationFixture(root);
    const snapshot = {
      type: "project_registry_snapshot",
      protocolVersion: 1,
      projectId: fixture.projectId,
      projectUuid: fixture.projectUuid,
      baseline: null,
      peers: [],
      serverTimestampUnixMs: Date.now(),
    };
    const received = [];
    harness = await coordinatorHarness((socket, message) => {
      received.push(message);
      if (message.type === "hello") {
        handshake(socket, message, snapshot);
      } else if (message.type === "project_baseline_publish") {
        setTimeout(() => socket.send(JSON.stringify({
          type: "project_baseline_changed",
          protocolVersion: 1,
          requestId: message.requestId,
          baseline: { ...descriptorCoordinatorFields(fixture.descriptor), projectId: fixture.projectId },
          idempotent: false,
          serverTimestampUnixMs: Date.now(),
        })), 25);
      } else if (message.type === "project_peer_announce") {
        socket.send(JSON.stringify({
          type: "project_peer_joined", protocolVersion: 1, requestId: message.requestId,
          peer: {
            connectionId: "announced-peer",
            projectUuid: message.projectUuid,
            baselineRevision: message.baselineRevision,
            manifestHash: message.manifestHash,
            endpoint: message.endpoint,
            transferToken: message.transferToken,
          },
          serverTimestampUnixMs: Date.now(),
        }));
      }
    });
    client = new CoordinatorClient(options(harness.address));
    assert.deepEqual(await client.connect(), snapshot);
    let settled = false;
    const publication = client.publishBaseline(fixture.descriptor).then((value) => {
      settled = true;
      return value;
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(settled, false);
    const acknowledgement = await publication;
    assert.equal(acknowledgement.baseline.baselineRevision, fixture.descriptor.baselineRevision);
    const sent = received.find((message) => message.type === "project_baseline_publish");
    assert(sent);
    assert.equal(sent.baselineRevision, 1);
    for (const forbidden of ["descriptorSchemaVersion", "files", "chunks", "payload", "bytes"]) {
      assert.equal(Object.hasOwn(sent, forbidden), false);
    }
    await client.announce({
      descriptor: fixture.descriptor,
      completeBaseline: true,
      availableChunkCount: 4,
      totalChunkCount: 4,
      endpoint: "http://127.0.0.1:5091/teamforge-transfer/v1",
      transferToken: "ephemeral-transfer-token-value",
      ownerProofSignature: "proof-signature",
    });
    const announce = received.find((message) => message.type === "project_peer_announce");
    assert(announce);
    assert.equal(announce.baselineRevision, fixture.descriptor.baselineRevision);
    assert.equal(announce.availableChunkCount, 4);
    for (const forbidden of ["descriptorSchemaVersion", "files", "chunks", "payload", "bytes"]) {
      assert.equal(Object.hasOwn(announce, forbidden), false);
    }

    const peerEvent = new Promise((resolve) => client.once("project_peer_joined", resolve));
    const socket = [...harness.server.clients][0];
    socket.send(JSON.stringify({
      type: "project_peer_joined", protocolVersion: 1, peer: { connectionId: "seed" },
    }));
    assert.equal((await peerEvent).peer.connectionId, "seed");
  } finally {
    client?.close();
    await harness?.stop();
    await cleanup(root);
  }
});

test("Coordinator Publish rejects server conflict/error and timeout instead of reporting success", async () => {
  const root = await temporaryRoot();
  let rejecting;
  let timingOut;
  let client;
  let timeoutClient;
  try {
    const fixture = await publicationFixture(root);
    const snapshot = {
      type: "project_registry_snapshot", protocolVersion: 1, projectId: fixture.projectId,
      projectUuid: fixture.projectUuid, baseline: null, peers: [], serverTimestampUnixMs: Date.now(),
    };
    rejecting = await coordinatorHarness((socket, message) => {
      if (message.type === "hello") handshake(socket, message, snapshot);
      if (message.type === "project_baseline_publish") {
        socket.send(JSON.stringify({
          type: "error", protocolVersion: 1, requestId: message.requestId,
          code: "baseline_revision_conflict", message: "conflict",
        }));
      } else if (message.type === "project_peer_announce") {
        socket.send(JSON.stringify({
          type: "error", protocolVersion: 1, requestId: message.requestId,
          code: "invalid_project_message", message: "invalid endpoint",
        }));
      }
    });
    client = new CoordinatorClient(options(rejecting.address));
    await client.connect();
    await assert.rejects(() => client.publishBaseline(fixture.descriptor), {
      code: "baseline_revision_conflict",
    });
    await assert.rejects(() => client.announce({
      descriptor: fixture.descriptor,
      completeBaseline: true,
      availableChunkCount: 1,
      totalChunkCount: 1,
      endpoint: "not-a-direct-endpoint",
      transferToken: "ephemeral-transfer-token-value",
    }), { code: "invalid_project_message" });

    timingOut = await coordinatorHarness((socket, message) => {
      if (message.type === "hello") handshake(socket, message, snapshot);
    });
    timeoutClient = new CoordinatorClient({ ...options(timingOut.address), timeoutMilliseconds: 100 });
    await timeoutClient.connect();
    await assert.rejects(() => timeoutClient.publishBaseline(fixture.descriptor), {
      code: "coordinator_timeout",
    });
  } finally {
    client?.close();
    timeoutClient?.close();
    await rejecting?.stop();
    await timingOut?.stop();
    await cleanup(root);
  }
});
