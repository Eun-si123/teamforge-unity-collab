import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import { createTeamForgeServer } from "../src/teamforge-server.mjs";

const silentLogger = { info() {}, warn() {}, error() {} };
function hello(overrides = {}) {
  return {
    type: "hello", protocolVersion: 1, requestId: "hello-preview",
    projectId: "component-preview-test", sessionId: "test",
    userId: "test-editor", userName: "Editor",
    userColor: "#AABBCC", supportsPresence: true,
    supportsTransformSync: true, supportsHierarchySync: true,
    ...overrides,
  };
}
function request(overrides = {}) {
  return {
    type: "component_recovery_preview_request", protocolVersion: 1,
    requestId: "preview-1", sceneId: "scene-one",
    knownRevision: 0, knownFingerprint: "",
    ...overrides,
  };
}
async function withServer(enabled, run) {
  const server = createTeamForgeServer({
    host: "127.0.0.1", port: 0, logger: silentLogger,
    enableComponentRecoveryPreview: enabled,
  });
  const endpoint = await server.start();
  const sockets = [];
  try {
    const connect = () => new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${endpoint.port}${endpoint.wsPath}`);
      const timer = setTimeout(() => reject(new Error("Connection timeout.")), 2500);
      socket.once("open", () => {
        clearTimeout(timer);
        sockets.push(socket);
        const values = [], pending = [];
        socket.on("message", data => {
          let value;
          try { value = JSON.parse(data.toString("utf8")); }
          catch (error) { value = { parseError: error }; }
          const waiter = pending.shift();
          if (waiter) {
            clearTimeout(waiter.timer);
            waiter.resolve(value);
          } else values.push(value);
        });
        resolve({
          send: payload => socket.send(JSON.stringify(payload)),
          async next() {
            if (values.length) return values.shift();
            return new Promise((resolve, reject) => {
              const waiter = {
                resolve, timer: setTimeout(() => {
                  const idx = pending.indexOf(waiter);
                  if (idx >= 0) pending.splice(idx, 1);
                  reject(new Error("Message timeout."));
                }, 2500),
              };
              pending.push(waiter);
            });
          },
        });
      });
      socket.once("error", error => {
        clearTimeout(timer);
        reject(error);
      });
    });
    await run(connect);
  } finally {
    sockets.forEach(socket => socket.terminate());
    await server.stop();
  }
}
async function handshake(client, input) {
  client.send(input);
  const ack = await client.next();
  return ack;
}
async function consumeRegistration(client) {
  assert.equal((await client.next()).type, "presence_snapshot");
  assert.equal((await client.next()).type, "hierarchy_snapshot");
  assert.equal((await client.next()).type, "transform_snapshot");
}

test("WP6 default Server never negotiates Component previews even with a forged explicit flag", async () => {
  await withServer(false, async connect => {
    const client = await connect();
    const ack = await handshake(client, hello({
      supportsComponentRecoveryPreview: true,
      supportsComponentSync: true, supportsInspectorSync: true,
    }));
    assert.equal(ack.type, "hello_ack");
    assert.equal(ack.hierarchySyncEnabled, true);
    assert.equal(ack.componentRecoveryPreviewEnabled, false);
    assert.equal(ack.componentSyncEnabled, undefined);
    assert.equal(ack.inspectorSyncEnabled, undefined);
    await consumeRegistration(client);
    client.send(request());
    const denied = await client.next();
    assert.equal(denied.code, "unsupported_message");
    assert.equal(denied.requestId, "preview-1");
    client.send({ type: "ping", protocolVersion: 1,
      requestId: "still-alive", clientTimestampUnixMs: 42 });
    assert.equal((await client.next()).type, "pong");
  });
});

test("WP6 enabled Server still requires explicit client opt-in and preserves legacy hello shape", async () => {
  await withServer(true, async connect => {
    const client = await connect();
    const ack = await handshake(client, hello());
    assert.equal(ack.type, "hello_ack");
    assert.equal(ack.componentRecoveryPreviewEnabled, undefined);
    await consumeRegistration(client);
    client.send(request());
    assert.equal((await client.next()).code, "unsupported_message");
    client.send({ type: "component_property_update", protocolVersion: 1,
      requestId: "write-attempt" });
    assert.equal((await client.next()).code, "unsupported_message");
  });
});

test("WP6 mutually opted-in read-only request is handled but no unseeded Component data is fabricated", async () => {
  await withServer(true, async connect => {
    const client = await connect();
    const ack = await handshake(client, hello({ supportsComponentRecoveryPreview: true }));
    assert.equal(ack.type, "hello_ack");
    assert.equal(ack.componentRecoveryPreviewEnabled, true);
    assert.equal(ack.componentSyncEnabled, undefined);
    await consumeRegistration(client);
    client.send(request());
    const unseeded = await client.next();
    assert.equal(unseeded.type, "error");
    assert.equal(unseeded.code, "component_transaction_unseeded");
    assert.equal(unseeded.requestId, "preview-1");
    client.send(request({ unapprovedExtraField: "deny" }));
    const malformed = await client.next();
    assert.equal(malformed.code, "component_recovery_request_invalid");
    client.send(request({ knownRevision: -1 }));
    const negative = await client.next();
    assert.equal(negative.code, "component_recovery_request_invalid");
    client.send({ type: "component_property_operation", protocolVersion: 1,
      requestId: "forbidden-change" });
    assert.equal((await client.next()).code, "unsupported_message");
  });
});

test("WP6 preview hello rejects incorrect type or missing Hierarchy capability without bypass", async () => {
  await withServer(true, async connect => {
    const client = await connect();
    client.send(hello({ supportsComponentRecoveryPreview: "true" }));
    assert.equal((await client.next()).code, "invalid_hello");
    client.send(hello({
      supportsComponentRecoveryPreview: true,
      supportsHierarchySync: false,
    }));
    assert.equal((await client.next()).code, "invalid_hello");
    const ack = await handshake(client, hello({ supportsComponentRecoveryPreview: false }));
    assert.equal(ack.type, "hello_ack");
    assert.equal(ack.componentRecoveryPreviewEnabled, undefined);
    await consumeRegistration(client);
  });
});
