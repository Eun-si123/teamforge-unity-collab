import assert from "node:assert/strict";
import { fork as nodeFork } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PRODUCT_VERSION, REALTIME_PROTOCOL_VERSION } from "../src/constants.mjs";
import { TeamForgeProcessLifecycleManager } from "../src/process-lifecycle.mjs";

const CHANNEL = "teamforge-lifecycle-v1";

function deferred() {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
}

function fixture(t, { onSpawn, onStop, onKill, fetchImplementation, occupied = false } = {}) {
  // The production deadlines are unref'd because real children keep Node alive.
  // These children are socket-free EventEmitters, so retain only this test timer.
  const keepAlive = setInterval(() => {}, 1_000);
  t.after(() => clearInterval(keepAlive));
  const spawned = deferred();
  const children = [];
  const identity = (instanceId) => ({
    status: "ok", service: "unity-teamforge-server", serverVersion: PRODUCT_VERSION,
    protocolVersion: REALTIME_PROTOCOL_VERSION, healthPath: "/health", wsPath: "/ws",
    authenticationRequired: false, lifecycleInstanceId: instanceId,
  });
  const reply = (child, message) => child.emit("message", {
    channel: CHANNEL, type: "stopped", instanceId: child.instanceId,
    requestId: message.requestId, graceful: true,
  });
  const manager = new TeamForgeProcessLifecycleManager({
    workspaceRoot: process.cwd(),
    preflight: async () => ({ failures: [], runtimeStrategy: { nodeExecutable: process.execPath } }),
    portProbe: async () => ({ state: occupied ? "occupied_unverified" : "no_listener" }),
    fetchImplementation: fetchImplementation ?? (async () => new Response(JSON.stringify(
      identity(children.at(-1)?.instanceId ?? null),
    ), { headers: { "content-type": "application/json" } })),
    forkProcess(_modulePath, _arguments, options) {
      const child = new EventEmitter();
      child.connected = true;
      child.exitCode = null;
      child.signalCode = null;
      child.pid = 10_000 + children.length;
      child.instanceId = options.env.TEAMFORGE_LIFECYCLE_INSTANCE_ID;
      child.messages = [];
      child.signals = [];
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
        callback?.(null);
        if (message.type === "stop") {
          if (onStop) onStop(child, message, reply);
          else queueMicrotask(() => { reply(child, message); child.close(); });
        } else if (message.type === "status") {
          queueMicrotask(() => child.emit("message", {
            channel: CHANNEL, type: "status", instanceId: child.instanceId,
            requestId: message.requestId, stopping: false,
          }));
        }
        return true;
      };
      child.kill = (signal) => {
        child.signals.push(signal);
        if (onKill) return onKill(child, signal);
        child.close(null, signal);
        return true;
      };
      children.push(child);
      spawned.resolve(child);
      queueMicrotask(() => onSpawn?.(child));
      return child;
    },
  });
  const ready = (child) => child.emit("message", {
    channel: CHANNEL, type: "ready", kind: "coordinator", instanceId: child.instanceId,
    endpoint: { host: "127.0.0.1", port: 5080, healthPath: "/health", wsPath: "/ws" },
  });
  return { manager, children, spawned: spawned.promise, ready, identity };
}

function ensure(manager) {
  return manager.ensureCoordinator({ port: 0, timeoutMilliseconds: 25 });
}

test("Coordinator readiness timeout stops and forgets its newly owned child", { timeout: 3_000 }, async (t) => {
  const { manager, children } = fixture(t);
  await assert.rejects(ensure(manager), { code: "coordinator_start_timeout" });
  assert.equal(children[0].messages.filter((message) => message.type === "stop").length, 1);
  assert.equal(children[0].connected, false);
  assert.deepEqual(children[0].signals, []);
  assert.equal(manager.records.size, 0);
  assert.equal(manager.coordinatorKeys.size, 0);
  assert.deepEqual(await manager.stopAll(), []);
});

test("Coordinator failed startup forces only its fresh unresponsive child", { timeout: 3_000 }, async (t) => {
  const { manager, children } = fixture(t, { onStop() {} });
  await assert.rejects(ensure(manager), { code: "coordinator_start_timeout" });
  assert.deepEqual(children[0].signals, ["SIGKILL"]);
  assert.equal(manager.records.size, 0);
  assert.equal(children[0].listenerCount("message"), 0);
  assert.equal(children[0].listenerCount("close"), 0);
});

test("Coordinator exit during startup is preserved without sending or killing", { timeout: 3_000 }, async (t) => {
  const { manager, children } = fixture(t, { onSpawn: (child) => child.close(7) });
  await assert.rejects(ensure(manager), { code: "lifecycle_child_exited", details: { exitCode: 7, signal: null } });
  assert.deepEqual(children[0].messages, []);
  assert.deepEqual(children[0].signals, []);
  assert.equal(manager.records.size, 0);
});

test("Coordinator process errors preserve their failure code while cleaning up ownership", { timeout: 3_000 }, async (t) => {
  const { manager, children } = fixture(t, {
    onSpawn: (child) => child.emit("error", new Error("test startup process error")),
  });
  await assert.rejects(ensure(manager), { code: "lifecycle_child_failed" });
  assert.equal(children[0].connected, false);
  assert.equal(manager.records.size, 0);
});

test("malformed Coordinator ready data is cleaned up without masking the original error", { timeout: 3_000 }, async (t) => {
  const { manager, children } = fixture(t, {
    onSpawn: (child) => child.emit("message", {
      channel: CHANNEL, type: "ready", kind: "coordinator", instanceId: child.instanceId,
    }),
  });
  await assert.rejects(ensure(manager), TypeError);
  assert.equal(children[0].messages.length, 1);
  assert.equal(children[0].connected, false);
  assert.equal(manager.records.size, 0);
});

test("mismatched Coordinator health identity closes the actual child without claiming the listener", { timeout: 3_000 }, async (t) => {
  let ready;
  const { manager, children } = fixture(t, {
    onSpawn: (child) => ready(child),
    fetchImplementation: async () => new Response("{}", { headers: { "content-type": "application/json" } }),
  });
  ready = (child) => child.emit("message", {
    channel: CHANNEL, type: "ready", kind: "coordinator", instanceId: child.instanceId,
    endpoint: { host: "127.0.0.1", port: 5080, healthPath: "/health", wsPath: "/ws" },
  });
  await assert.rejects(ensure(manager), { code: "lifecycle_identity_mismatch" });
  assert.equal(children[0].connected, false);
  assert.equal(manager.records.size, 0);
  assert.equal(manager.coordinatorKeys.size, 0);
});

test("stopAll during health verification cannot publish a late Coordinator handle", { timeout: 3_000 }, async (t) => {
  const fetched = deferred();
  const response = deferred();
  let ready;
  const setup = fixture(t, {
    onSpawn: (child) => ready(child),
    fetchImplementation: () => { fetched.resolve(); return response.promise; },
  });
  ready = setup.ready;
  const starting = ensure(setup.manager);
  const rejected = assert.rejects(starting, { code: "operation_cancelled" });
  await fetched.promise;
  const stopped = await setup.manager.stopAll();
  response.resolve(new Response(JSON.stringify(setup.identity(setup.children[0].instanceId)), {
    headers: { "content-type": "application/json" },
  }));
  await rejected;
  assert.equal(stopped.length, 1);
  assert.equal(stopped[0].stopped, true);
  assert.equal(setup.manager.records.size, 0);
  assert.equal(setup.manager.coordinatorKeys.size, 0);
  assert.equal(setup.children[0].messages.length, 1);
});

test("concurrent stopAll calls during readiness share cleanup and reject a late ready handle", { timeout: 3_000 }, async (t) => {
  const stopping = deferred();
  const setup = fixture(t, {
    onStop(child, message, reply) { reply(child, message); stopping.resolve(child); },
  });
  const starting = ensure(setup.manager);
  const rejected = assert.rejects(starting, { code: "operation_cancelled" });
  await setup.spawned;
  const first = setup.manager.stopAll({ timeoutMilliseconds: 25 });
  const second = setup.manager.stopAll({ timeoutMilliseconds: 25 });
  const child = await stopping.promise;
  setup.ready(child);
  child.close();
  await Promise.all([rejected, first, second]);
  assert.equal(child.messages.length, 1);
  assert.equal(setup.manager.records.size, 0);
  assert.equal(setup.manager.coordinatorKeys.size, 0);
});

test("failed cleanup retains ownership and the startup error for a later stopAll retry", { timeout: 3_000 }, async (t) => {
  let refuseKill = true;
  const { manager, children } = fixture(t, {
    onStop() {},
    onKill(child, signal) {
      if (refuseKill) throw Object.assign(new Error("test refusal"), { code: "EPERM" });
      child.close(null, signal);
      return true;
    },
  });
  await assert.rejects(ensure(manager), (error) => {
    assert.equal(error.code, "coordinator_start_timeout");
    assert.equal(error.details.cleanupFailed, true);
    return true;
  });
  assert.equal(manager.records.size, 1);
  assert.equal(manager.coordinatorKeys.size, 0);
  refuseKill = false;
  const stopped = await manager.stopAll({ timeoutMilliseconds: 25, forceOwnedAfterTimeout: true });
  assert.equal(stopped[0].stopped, true);
  assert.equal(manager.records.size, 0);
  assert.equal(children[0].listenerCount("close"), 0);
});

test("timed-out close waits release listeners and keep failed cleanup retryable", { timeout: 3_000 }, async (t) => {
  let permitClose = false;
  const { manager, children } = fixture(t, {
    onStop(child, message, reply) { reply(child, message); },
    onKill(child, signal) {
      if (permitClose) child.close(null, signal);
      return permitClose;
    },
  });
  await assert.rejects(ensure(manager), (error) => {
    assert.equal(error.code, "coordinator_start_timeout");
    assert.equal(error.details.cleanupFailed, true);
    return true;
  });
  assert.equal(manager.records.size, 1);
  assert.equal(children[0].listenerCount("close"), 0);
  permitClose = true;
  await manager.stopAll({ timeoutMilliseconds: 25, forceOwnedAfterTimeout: true });
  assert.equal(manager.records.size, 0);
  assert.equal(children[0].listenerCount("close"), 0);
});

test("wrong Coordinator readiness kind and instance do not bypass cleanup or ownership", { timeout: 3_000 }, async (t) => {
  const { manager, children } = fixture(t, {
    onSpawn: (child) => {
      child.emit("message", { channel: CHANNEL, type: "ready", kind: "seed", instanceId: child.instanceId });
      child.emit("message", { channel: CHANNEL, type: "ready", kind: "coordinator", instanceId: "other-instance" });
    },
  });
  await assert.rejects(ensure(manager), { code: "coordinator_start_timeout" });
  assert.equal(children[0].connected, false);
  assert.equal(manager.records.size, 0);
});

test("wrong stop reply identity cannot falsely confirm failed-startup cleanup", { timeout: 3_000 }, async (t) => {
  const { manager, children } = fixture(t, {
    onStop(child, message) {
      child.emit("message", {
        channel: CHANNEL, type: "stopped", instanceId: "other-instance",
        requestId: message.requestId, graceful: true,
      });
      child.emit("message", {
        channel: CHANNEL, type: "stopped", instanceId: child.instanceId,
        requestId: "other-request", graceful: true,
      });
    },
  });
  await assert.rejects(ensure(manager), { code: "coordinator_start_timeout" });
  assert.deepEqual(children[0].signals, ["SIGKILL"]);
  assert.equal(manager.records.size, 0);
});

test("a fully verified Coordinator still reuses its handle and stops normally", { timeout: 3_000 }, async (t) => {
  let ready;
  const setup = fixture(t, { onSpawn: (child) => ready(child) });
  ready = setup.ready;
  const first = await ensure(setup.manager);
  const second = await ensure(setup.manager);
  assert.equal(first.owned, true);
  assert.equal(second.reused, true);
  assert.equal(first.handleId, second.handleId);
  assert.equal(setup.children.length, 1);
  assert.equal(setup.manager.coordinatorKeys.size, 1);
  assert.equal((await setup.manager.stopCoordinator(first)).graceful, true);
  assert.equal(setup.manager.records.size, 0);
});

test("an external compatible Coordinator never enters owned startup cleanup", { timeout: 3_000 }, async (t) => {
  const { manager, children } = fixture(t, { occupied: true });
  const handle = await manager.ensureCoordinator({ port: 5080, timeoutMilliseconds: 25 });
  assert.equal(handle.owned, false);
  assert.equal((await manager.stopCoordinator(handle, { forceOwnedAfterTimeout: true })).owned, false);
  assert.deepEqual(children, []);
  assert.deepEqual(await manager.stopAll({ forceOwnedAfterTimeout: true }), []);
});

async function checkForkedStartupCleanup(t, { ignoreStop }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "teamforge-startup-cleanup-"));
  const modulePath = path.join(root, "pending-coordinator.mjs");
  // Exercise a real owned process and authenticated IPC without opening a port.
  // Credentials come only from this manager's fresh, ephemeral child environment.
  await writeFile(modulePath, `
const channel = "teamforge-lifecycle-v1";
const instanceId = process.env.TEAMFORGE_LIFECYCLE_INSTANCE_ID;
const token = process.env.TEAMFORGE_LIFECYCLE_TOKEN;
process.on("message", (message) => {
  if (message?.channel !== channel || message.type !== "stop" ||
      message.instanceId !== instanceId || message.token !== token ||
      process.env.TEAMFORGE_TEST_IGNORE_STOP === "1") return;
  process.send({ channel, type: "stopped", instanceId,
    requestId: message.requestId, graceful: true }, () => {
    if (process.connected) process.disconnect();
  });
});
`);
  let child;
  let closed;
  try {
    const manager = new TeamForgeProcessLifecycleManager({
      workspaceRoot: root,
      preflight: async () => ({ failures: [], runtimeStrategy: { nodeExecutable: process.execPath } }),
      forkProcess(_modulePath, arguments_, options) {
        child = nodeFork(modulePath, arguments_, { ...options, execArgv: [] });
        closed = once(child, "close", { signal: t.signal });
        closed.catch(() => {});
        return child;
      },
    });
    await assert.rejects(manager.ensureCoordinator({
      port: 0,
      timeoutMilliseconds: 1_000,
      environment: { TEAMFORGE_TEST_IGNORE_STOP: ignoreStop ? "1" : "0" },
    }), { code: "coordinator_start_timeout" });
    assert(child.exitCode !== null || child.signalCode !== null, "the actual child must have exited before startup cleanup rejects");
    await closed;
    assert.equal(child.connected, false);
    assert.equal(child.killed, ignoreStop, "only an unresponsive owned child requires force");
    if (!ignoreStop) assert.equal(child.exitCode, 0);
    assert.equal(manager.records.size, 0);
    assert.equal(manager.coordinatorKeys.size, 0);
    assert.deepEqual(await manager.stopAll(), []);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "close");
      try { child.kill("SIGKILL"); }
      catch { if (child.connected) child.disconnect(); }
      await exited;
    }
    await rm(root, { recursive: true, force: true });
  }
}

test("a real Coordinator child with no readiness exits through authenticated startup cleanup", { timeout: 15_000 }, async (t) => {
  await checkForkedStartupCleanup(t, { ignoreStop: false });
});

test("a real unresponsive Coordinator child is reaped by the owned force fallback", { timeout: 15_000 }, async (t) => {
  await checkForkedStartupCleanup(t, { ignoreStop: true });
});
