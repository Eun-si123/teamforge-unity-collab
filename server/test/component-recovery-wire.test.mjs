import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { baselineCanonicalPayload } from "../src/project-coordinator.mjs";
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
function signedOwnerBaseline() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  const keyId = createHash("sha256").update(spki).digest("hex");
  const descriptor = {
    userId: "test-editor",
    projectUuid: "e83a181c-f870-4f26-acdb-0a3f9e157561",
    baselineRevision: 1, manifestHash: "a".repeat(64),
    descriptorHash: "", unityVersion: "6000.3.21f1",
    teamForgePackageVersion: "0.5.1",
    realtimeProtocolVersion: 1, transferProtocolVersion: 1,
    manifestSchemaVersion: 1, ownerKeyId: keyId,
    ownerPublicKey: spki.toString("base64"),
    publisherKeyId: keyId, publisherPublicKey: spki.toString("base64"),
    publisherAuthorization: "", baselineSignature: "",
  };
  const payload = baselineCanonicalPayload("component-preview-test", descriptor);
  descriptor.descriptorHash = createHash("sha256")
    .update(Buffer.from(payload)).digest("hex");
  descriptor.baselineSignature = sign(null, Buffer.from(payload), privateKey)
    .toString("base64");
  return {
    type: "project_baseline_publish", protocolVersion: 1,
    requestId: "valid-signed-baseline", ...descriptor,
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

test("WP6 real WebSocket challenge is one-time same-connection only; not Inspector authority", async () => {
  await withServer(true, async connect => {
    const client = await connect();
    const ack = await handshake(client, hello({
      supportsComponentRecoveryPreview: true, supportsProjectTransfer: true,
    }));
    assert.equal(ack.componentRecoveryPreviewEnabled, true);
    await consumeRegistration(client);
    assert.equal((await client.next()).type, "project_registry_snapshot");
    const probe = (overrides = {}) => ({
      type: "component_source_challenge_request", protocolVersion: 1,
      requestId: "challenge-issue", sceneId: "a".repeat(32), ...overrides,
    });
    client.send(probe());
    const missing = await client.next();
    assert.equal(missing.code, "component_recovery_signed_baseline_required");
    client.send(signedOwnerBaseline());
    assert.equal((await client.next()).type, "project_baseline_changed");

    client.send(probe());
    const issued = await client.next();
    assert.equal(issued.type, "component_source_challenge");
    assert.equal(issued.status, "server_source_freshness_probe_unverified");
    assert.match(issued.nonce, /^[a-f0-9]{64}$/);
    assert.equal(issued.networkWriteAuthorized, false);
    assert.equal(issued.sceneBytesAttested, false);
    client.send(probe());
    assert.equal((await client.next()).code, "component_source_challenge_outstanding");
    client.send({
      type: "component_source_challenge_echo", protocolVersion: 1,
      requestId: "challenge-echo", sceneId: "a".repeat(32), nonce: issued.nonce,
    });
    const echoed = await client.next();
    assert.equal(echoed.type, "component_source_challenge_echo_result");
    assert.equal(echoed.requestId, "challenge-echo");
    assert.equal(echoed.status, "same_connection_challenge_echo_unverified");
    assert.equal(echoed.networkWriteAuthorized, false);
    client.send({
      type: "component_source_challenge_echo", protocolVersion: 1,
      requestId: "challenge-replay", sceneId: "a".repeat(32), nonce: issued.nonce,
    });
    assert.equal((await client.next()).code, "component_source_challenge_absent");
    client.send(probe({ unapprovedExtra: true }));
    assert.equal((await client.next()).code, "component_source_challenge_invalid");
    client.send({
      type: "component_property_update", protocolVersion: 1, requestId: "unsafe",
    });
    assert.equal((await client.next()).code, "unsupported_message");
    client.send({
      type: "ping", protocolVersion: 1, requestId: "alive",
      clientTimestampUnixMs: 123,
    });
    assert.equal((await client.next()).type, "pong");
  });
});

test("WP6 real WebSocket nonce cannot be echoed by another authenticated Editor", async () => {
  await withServer(true, async connect => {
    const owner = await connect();
    await handshake(owner, hello({
      supportsComponentRecoveryPreview: true, supportsProjectTransfer: true,
    }));
    await consumeRegistration(owner);
    assert.equal((await owner.next()).type, "project_registry_snapshot");
    owner.send(signedOwnerBaseline());
    assert.equal((await owner.next()).type, "project_baseline_changed");
    owner.send({
      type: "component_source_challenge_request", protocolVersion: 1,
      requestId: "issue-owner", sceneId: "a".repeat(32),
    });
    const issued = await owner.next();
    assert.equal(issued.type, "component_source_challenge");

    const guest = await connect();
    await handshake(guest, hello({
      requestId: "guest-hello",
      userId: "guest-editor", userName: "Guest",
      supportsComponentRecoveryPreview: true, supportsProjectTransfer: true,
    }));
    await consumeRegistration(guest);
    assert.equal((await guest.next()).type, "project_registry_snapshot");
    assert.equal((await owner.next()).type, "user_joined");
    guest.send({
      type: "component_source_challenge_echo", protocolVersion: 1,
      requestId: "echo-guest", sceneId: "a".repeat(32), nonce: issued.nonce,
    });
    const noGrant = await guest.next();
    assert.equal(noGrant.code, "component_source_challenge_absent");
    assert.equal(noGrant.requestId, "echo-guest");

    owner.send({
      type: "component_source_challenge_echo", protocolVersion: 1,
      requestId: "echo-owner", sceneId: "a".repeat(32), nonce: issued.nonce,
    });
    assert.equal((await owner.next()).type, "component_source_challenge_echo_result");
  });
});

test("WP6 live source challenge is never available without both-sided opt-in", async () => {
  for (const enabled of [false, true]) {
    await withServer(enabled, async connect => {
      const client = await connect();
      await handshake(client, hello({
        supportsComponentRecoveryPreview: !enabled,
        supportsProjectTransfer: true,
      }));
      await consumeRegistration(client);
      assert.equal((await client.next()).type, "project_registry_snapshot");
      client.send({
        type: "component_source_challenge_request", protocolVersion: 1,
        requestId: "denied-probe", sceneId: "a".repeat(32),
      });
      assert.equal((await client.next()).code, "unsupported_message");
    });
  }
});

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
    const ack = await handshake(client, hello({
      supportsComponentRecoveryPreview: true, supportsProjectTransfer: true,
    }));
    assert.equal(ack.type, "hello_ack");
    assert.equal(ack.componentRecoveryPreviewEnabled, true);
    assert.equal(ack.projectTransferEnabled, true);
    assert.equal(ack.componentSyncEnabled, undefined);
    await consumeRegistration(client);
    assert.equal((await client.next()).type, "project_registry_snapshot");
    client.send(request());
    const untrusted = await client.next();
    assert.equal(untrusted.code, "component_recovery_signed_baseline_required");
    assert.equal(untrusted.requestId, "preview-1");

    client.send(signedOwnerBaseline());
    const published = await client.next();
    assert.equal(published.type, "project_baseline_changed");
    assert.equal(published.baseline.baselineRevision, 1);
    // A Hierarchy-unseeded Scene must fail after checking Project authority.
    client.send(request());
    const sceneMissing = await client.next();
    assert.equal(sceneMissing.code, "component_recovery_scene_unseeded");
    assert.equal(sceneMissing.requestId, "preview-1");
    // Establish a legitimate authoritative Scene using the existing protocol.
    client.send({
      type: "hierarchy_seed", protocolVersion: 1, requestId: "hierarchy-ready",
      userId: "test-editor", sceneId: "scene-one", baseRevision: 0, objects: [],
    });
    const seeded = await client.next();
    assert.equal(seeded.type, "hierarchy_seed_accepted");
    assert.equal(seeded.sceneId, "scene-one");
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

test("WP6 direct WebSocket preview cannot bypass Project Transfer registration even with Hierarchy and opt-in", async () => {
  await withServer(true, async connect => {
    const client = await connect();
    const ack = await handshake(client, hello({ supportsComponentRecoveryPreview: true }));
    assert.equal(ack.type, "hello_ack");
    assert.equal(ack.componentRecoveryPreviewEnabled, true);
    await consumeRegistration(client);
    client.send(request());
    const denied = await client.next();
    assert.equal(denied.code, "component_recovery_project_membership_required");
    assert.equal(denied.requestId, "preview-1");
    // A denied diagnostics request must never kill normal realtime Presence.
    client.send({ type: "ping", protocolVersion: 1,
      requestId: "alive-after-project-denial", clientTimestampUnixMs: 10 });
    assert.equal((await client.next()).type, "pong");
  });
});

test("WP6 invalid Publisher signatures cannot authorize the direct read-only route", async () => {
  await withServer(true, async connect => {
    const client = await connect();
    const ack = await handshake(client, hello({
      supportsComponentRecoveryPreview: true, supportsProjectTransfer: true,
    }));
    assert.equal(ack.projectTransferEnabled, true);
    await consumeRegistration(client);
    assert.equal((await client.next()).type, "project_registry_snapshot");
    const tampered = signedOwnerBaseline();
    tampered.baselineSignature = Buffer.alloc(64, 0).toString("base64");
    client.send(tampered);
    assert.equal((await client.next()).code, "invalid_project_signature");
    client.send(request());
    assert.equal((await client.next()).code, "component_recovery_signed_baseline_required");
    client.send({ type: "ping", protocolVersion: 1,
      requestId: "alive-after-signature-denial", clientTimestampUnixMs: 10 });
    assert.equal((await client.next()).type, "pong");
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
