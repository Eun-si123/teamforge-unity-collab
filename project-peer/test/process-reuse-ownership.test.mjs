import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { PRODUCT_VERSION, REALTIME_PROTOCOL_VERSION } from "../src/constants.mjs";
import { TeamForgeProcessLifecycleManager } from "../src/process-lifecycle.mjs";

const CHANNEL = "teamforge-lifecycle-v1";
const TIMEOUT_MILLISECONDS = 30;
const SEED_CORE = Object.freeze({
  projectId: "reuse-ownership-project",
  projectUuid: "11111111-1111-4111-8111-111111111111",
  sessionId: "reuse-ownership-session",
  baselineRevision: 1,
  manifestHash: "a".repeat(64),
});

function fixture(t, kind, port) {
  // Real child processes keep the event loop alive. These socket-free fixtures
  // retain one test-owned timer while exercising production's unref'd deadlines.
  const keepAlive = setInterval(() => {}, 1_000);
  const children = [];
  const portProbes = [];
  const health = (child) => ({
    status: "ok", service: "unity-teamforge-server", serverVersion: PRODUCT_VERSION,
    protocolVersion: REALTIME_PROTOCOL_VERSION, healthPath: "/health", wsPath: "/ws",
    authenticationRequired: false,
    lifecycleInstanceId: child.healthMode === "mismatch" ? "different-instance" : child.instanceId,
  });
  const manager = new TeamForgeProcessLifecycleManager({
    workspaceRoot: process.cwd(),
    preflight: async () => ({ failures: [], runtimeStrategy: { nodeExecutable: process.execPath } }),
    portProbe: async ({ port: requestedPort }) => {
      portProbes.push(requestedPort);
      const occupied = children.some((child) => child.boundPort === requestedPort &&
        child.exitCode === null && child.signalCode === null);
      return { state: occupied ? "occupied_unverified" : "no_listener" };
    },
    fetchImplementation: async (url) => {
      const child = children.findLast((candidate) => candidate.boundPort === Number(new URL(url).port));
      assert(child, "A health probe must name a fixture-owned listener.");
      if (child.healthMode === "exit") child.close();
      return new Response(JSON.stringify(["unverified", "exit"].includes(child.healthMode) ? {} : health(child)), {
        headers: { "content-type": "application/json" },
      });
    },
    forkProcess(_modulePath, _arguments, options) {
      const child = new EventEmitter();
      Object.assign(child, {
        connected: true, exitCode: null, signalCode: null,
        pid: 10_000 + children.length,
        instanceId: options.env.TEAMFORGE_LIFECYCLE_INSTANCE_ID,
        boundPort: port || 12_000 + children.length,
        statusMode: "healthy", healthMode: "healthy", messages: [], signals: [],
      });
      child.identity = {
        ...SEED_CORE, boundHost: "127.0.0.1", boundPort: child.boundPort,
        endpoint: `http://127.0.0.1:${child.boundPort}/peer`,
        transferTokenFingerprint: "b".repeat(64),
      };
      child.close = (code = 0, signal = null) => {
        child.connected = false;
        child.exitCode = code;
        child.signalCode = signal;
        child.emit("exit", code, signal);
        child.emit("close", code, signal);
      };
      child.send = (message, callback) => {
        assert.equal(message.channel, CHANNEL);
        assert.equal(message.instanceId, child.instanceId);
        assert.equal(message.token, options.env.TEAMFORGE_LIFECYCLE_TOKEN);
        child.messages.push(message);
        if (!child.connected) {
          callback?.(Object.assign(new Error("Fixture IPC is disconnected."), { code: "ERR_IPC_CHANNEL_CLOSED" }));
          return false;
        }
        callback?.(null);
        if (message.type === "stop") {
          queueMicrotask(() => {
            child.emit("message", {
              channel: CHANNEL, type: "stopped", instanceId: child.instanceId,
              requestId: message.requestId, graceful: true,
            });
            child.close();
          });
        } else if (message.type === "status" && child.statusMode === "exit") {
          queueMicrotask(() => child.close());
        } else if (message.type === "status" && child.statusMode !== "timeout") {
          queueMicrotask(() => child.emit("message", {
            channel: CHANNEL, type: "status", instanceId: child.instanceId,
            requestId: message.requestId, stopping: false,
            identity: child.statusMode === "mismatch"
              ? { ...child.identity, manifestHash: "c".repeat(64) }
              : child.identity,
          }));
        }
        return true;
      };
      child.kill = (signal) => {
        child.signals.push(signal);
        child.close(null, signal);
        return true;
      };
      children.push(child);
      queueMicrotask(() => child.emit("message", {
        channel: CHANNEL, type: "ready", kind, instanceId: child.instanceId,
        endpoint: { host: "127.0.0.1", port: child.boundPort, healthPath: "/health", wsPath: "/ws" },
        identity: child.identity,
      }));
      return child;
    },
  });
  const ensure = () => kind === "coordinator"
    ? manager.ensureCoordinator({ port, timeoutMilliseconds: TIMEOUT_MILLISECONDS })
    : manager.ensureSeed({
      arguments: ["seed", "--port", String(port)], expectedIdentity: SEED_CORE,
      port, timeoutMilliseconds: TIMEOUT_MILLISECONDS,
    });
  t.after(async () => {
    try {
      await manager.stopAll({ timeoutMilliseconds: TIMEOUT_MILLISECONDS, forceOwnedAfterTimeout: true });
    } finally {
      // Failed baseline assertions can expose intentionally untracked fixtures.
      // Retire their synthetic processes without hiding the ownership assertion.
      for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) child.close();
      }
      clearInterval(keepAlive);
    }
  });
  return { manager, children, ensure, portProbes, keys: kind === "coordinator" ? manager.coordinatorKeys : manager.seedKeys };
}

async function assertRefusedWithoutForgetting(setup, first) {
  const record = setup.manager.records.get(first.handleId);
  const probesBefore = setup.portProbes.length;
  let failure;
  try { await setup.ensure(); } catch (error) { failure = error; }
  assert.equal(setup.manager.records.get(first.handleId) === record, true,
    "Failed revalidation must retain responsibility for its still-running owned child.");
  assert.equal(setup.keys.get(record.key), first.handleId,
    "The original reuse key must continue protecting the live owned child.");
  assert.equal(setup.children.length, 1, "Unverified reuse must not start a duplicate child.");
  assert.equal(setup.portProbes.length, probesBefore,
    "An unverified owned listener must not be reclassified through external port discovery.");
  assert.equal(failure?.code, "lifecycle_identity_mismatch", "Live unverified reuse must fail closed.");
  assert.equal(setup.children[0].messages.some((message) => message.type === "stop"), false,
    "A reuse attempt must not automatically stop a potentially active session.");
  assert.deepEqual(setup.children[0].signals, []);
}

async function assertOwnedReplacement(setup, first) {
  const replacement = await setup.ensure();
  assert.notEqual(replacement.handleId, first.handleId);
  assert.equal(replacement.owned, true);
  assert.equal(replacement.reused, false);
  assert.equal(setup.children.length, 2);
  assert.equal(setup.manager.records.has(first.handleId), false);
  assert.equal(setup.manager.records.has(replacement.handleId), true);
  assert.equal(setup.keys.size, 1);
  assert.equal(setup.children[0].messages.some((message) => message.type === "stop"), false);
  assert.deepEqual(setup.children[0].signals, []);
  const [stopped] = await setup.manager.stopAll({ timeoutMilliseconds: TIMEOUT_MILLISECONDS });
  assert.equal(stopped.stopped, true);
  assert.equal(setup.children[1].connected, false);
  assert.equal(setup.manager.records.size, 0);
  assert.equal(setup.keys.size, 0);
}

for (const kind of ["coordinator", "seed"]) {
  for (const port of [0, kind === "coordinator" ? 5080 : 5081]) {
    test(`${kind} status timeout retains owned child at ${port ? "fixed" : "ephemeral"} port and permits recovery`, { timeout: 3_000 }, async (t) => {
      const setup = fixture(t, kind, port);
      const first = await setup.ensure();
      const child = setup.children[0];
      child.statusMode = "timeout";
      await assertRefusedWithoutForgetting(setup, first);
      child.statusMode = "healthy";
      const reused = await setup.ensure();
      assert.equal(reused.handleId, first.handleId);
      assert.equal(reused.owned, true);
      assert.equal(reused.reused, true);
      assert.equal(setup.children.length, 1);
      const [stopped] = await setup.manager.stopAll({ timeoutMilliseconds: TIMEOUT_MILLISECONDS });
      assert.equal(stopped.stopped, true);
      assert.equal(stopped.owned, true);
      assert.equal(child.connected, false);
      assert.equal(setup.manager.records.size, 0);
      assert.equal(setup.keys.size, 0);
    });

    test(`${kind} disconnected IPC retains cleanup ownership at ${port ? "fixed" : "ephemeral"} port`, { timeout: 3_000 }, async (t) => {
      const setup = fixture(t, kind, port);
      const first = await setup.ensure();
      const child = setup.children[0];
      child.connected = false;
      // Neither losing IPC nor a prior kill request proves the process exited.
      child.killed = true;
      await assertRefusedWithoutForgetting(setup, first);
      const [stopped] = await setup.manager.stopAll({
        timeoutMilliseconds: TIMEOUT_MILLISECONDS, forceOwnedAfterTimeout: true,
      });
      assert.equal(stopped.stopped, true);
      assert.equal(stopped.owned, true);
      assert.equal(stopped.forced, true);
      assert.deepEqual(child.signals, ["SIGKILL"]);
      assert.equal(setup.manager.records.size, 0);
      assert.equal(setup.keys.size, 0);
    });
  }

  for (const exit of [{ code: 0, signal: null }, { code: null, signal: "SIGTERM" }]) {
    test(`${kind} confirmed ${exit.signal ? "signal exit" : "process exit"} permits a new owned replacement`, { timeout: 3_000 }, async (t) => {
      const setup = fixture(t, kind, 0);
      const first = await setup.ensure();
      setup.children[0].close(exit.code, exit.signal);
      await assertOwnedReplacement(setup, first);
    });
  }

  test(`${kind} exit during awaited status validation permits a new owned replacement`, { timeout: 3_000 }, async (t) => {
    const setup = fixture(t, kind, kind === "coordinator" ? 5080 : 5081);
    const first = await setup.ensure();
    setup.children[0].statusMode = "exit";
    await assertOwnedReplacement(setup, first);
  });
}

for (const healthMode of ["mismatch", "unverified"]) {
  test(`Coordinator ${healthMode} health retains live ownership until it can be revalidated`, { timeout: 3_000 }, async (t) => {
    const setup = fixture(t, "coordinator", 5080);
    const first = await setup.ensure();
    setup.children[0].healthMode = healthMode;
    await assertRefusedWithoutForgetting(setup, first);
    setup.children[0].healthMode = "healthy";
    const recovered = await setup.ensure();
    assert.equal(recovered.handleId, first.handleId);
    assert.equal(recovered.owned, true);
    assert.equal(recovered.reused, true);
  });
}

test("Direct Seed status identity mismatch retains live ownership until exact identity returns", { timeout: 3_000 }, async (t) => {
  const setup = fixture(t, "seed", 5081);
  const first = await setup.ensure();
  setup.children[0].statusMode = "mismatch";
  await assertRefusedWithoutForgetting(setup, first);
  setup.children[0].statusMode = "healthy";
  const recovered = await setup.ensure();
  assert.equal(recovered.handleId, first.handleId);
  assert.equal(recovered.owned, true);
  assert.equal(recovered.reused, true);
});

test("Coordinator exit during awaited health validation permits a new owned replacement", { timeout: 3_000 }, async (t) => {
  const setup = fixture(t, "coordinator", 5080);
  const first = await setup.ensure();
  setup.children[0].healthMode = "exit";
  await assertOwnedReplacement(setup, first);
});
