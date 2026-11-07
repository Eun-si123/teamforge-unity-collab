import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { fork as nodeFork } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TeamForgeProcessLifecycleManager } from "../src/process-lifecycle.mjs";

const CHANNEL = "teamforge-lifecycle-v1";
const TIMEOUT = 25;
const CORE = {
  projectId: "seed-cleanup-project",
  projectUuid: "11111111-1111-4111-8111-111111111111",
  sessionId: "seed-cleanup-session",
  baselineRevision: 1,
  manifestHash: "a".repeat(64),
};
const REVIEW = "c".repeat(64);

function fixture(t, { mode = "silent", stop = "graceful", kill = "close", onStop, onConfirm } = {}) {
  const alive = setInterval(() => {}, 1_000);
  t.after(() => clearInterval(alive));
  let spawned;
  const spawnedPromise = new Promise((resolve) => { spawned = resolve; });
  const children = [];
  const manager = new TeamForgeProcessLifecycleManager({
    workspaceRoot: process.cwd(),
    preflight: async () => ({ failures: [], runtimeStrategy: { nodeExecutable: process.execPath } }),
    portProbe: async () => ({ state: "no_listener" }),
    forkProcess(_module, _args, options) {
      const child = new EventEmitter();
      Object.assign(child, {
        connected: true, exitCode: null, signalCode: null, pid: 12_345,
        instanceId: options.env.TEAMFORGE_LIFECYCLE_INSTANCE_ID,
        token: options.env.TEAMFORGE_LIFECYCLE_TOKEN,
        messages: [], signals: [],
      });
      child.identity = {
        ...CORE, boundHost: "127.0.0.1", boundPort: 12_345,
        endpoint: "http://127.0.0.1:12345/peer", transferTokenFingerprint: "b".repeat(64),
      };
      child.close = (code = 0, signal = null) => {
        if (!child.connected) return;
        child.connected = false;
        child.exitCode = code;
        child.signalCode = signal;
        child.emit("exit", code, signal);
        child.emit("close", code, signal);
      };
      if (mode === "wrong-ready") child.identity.manifestHash = "d".repeat(64);
      child.emitReady = () => child.emit("message", {
        channel: CHANNEL, type: "ready", kind: "seed", instanceId: child.instanceId,
        identity: child.identity, published: true,
      });
      child.send = (message, callback) => {
        assert.equal(message.channel, CHANNEL);
        assert.equal(message.instanceId, child.instanceId);
        assert.equal(message.token, child.token);
        child.messages.push(message);
        callback?.(null);
        if (message.type === "stop") {
          if (onStop) onStop(child, message);
          else if (stop === "graceful") queueMicrotask(() => {
            child.emit("message", {
              channel: CHANNEL, type: "stopped", instanceId: child.instanceId,
              requestId: message.requestId, graceful: true,
            });
            child.close();
          });
        }
        if (message.type === "confirm_publish") {
          onConfirm?.(child, message);
          if (mode !== "confirm-silent") queueMicrotask(() => child.emitReady());
        }
        if (message.type === "cancel_publish" && mode !== "review-mismatch-ignored") queueMicrotask(() => child.close());
        return true;
      };
      child.kill = (signal) => {
        child.signals.push(signal);
        if (kill === "throw") throw Object.assign(new Error("test kill refusal"), { code: "EPERM" });
        if (kill === "close") child.close(null, signal);
        return kill === "close";
      };
      children.push(child);
      spawned(child);
      if (mode === "ready" || mode === "wrong-ready") queueMicrotask(() => child.emitReady());
      if (mode.startsWith("review") || mode === "confirm-silent") queueMicrotask(() => child.emit("message", {
        channel: CHANNEL, type: "publish_review", kind: "seed",
        instanceId: child.instanceId, fingerprint: mode.startsWith("review-mismatch") ? "d".repeat(64) : REVIEW,
      }));
      return child;
    },
  });
  const seed = (port = 0) => manager.ensureSeed({
    arguments: ["seed", "--port", String(port)], port, expectedIdentity: CORE, timeoutMilliseconds: TIMEOUT,
  });
  const publish = () => manager.ensurePublishingSeed({
    arguments: ["publish", "--port", "0", "--launch-settings", path.resolve(os.tmpdir(), "seed-fixture.json")],
    expectedIdentity: CORE, publishReviewFingerprint: REVIEW, timeoutMilliseconds: TIMEOUT,
  });
  return { manager, children, spawned: spawnedPromise, seed, publish };
}

test("silent Seed readiness timeout stops the owned child and forgets it", { timeout: 3_000 }, async (t) => {
  const f = fixture(t);
  await assert.rejects(f.seed(), { code: "seed_start_timeout" });
  assert.equal(f.children[0].connected, false);
  assert.equal(f.children[0].messages.filter((m) => m.type === "stop").length, 1);
  assert.equal(f.manager.records.size, 0);
  assert.deepEqual(await f.manager.stopAll(), []);
});

test("Seed startup failure force-stops only its newly owned unresponsive child", { timeout: 3_000 }, async (t) => {
  const f = fixture(t, { stop: "silent" });
  await assert.rejects(f.seed(), { code: "seed_start_timeout" });
  assert.deepEqual(f.children[0].signals, ["SIGKILL"]);
  assert.equal(f.manager.records.size, 0);
});

test("Seed failed force cleanup retains a retryable ownership record", { timeout: 3_000 }, async (t) => {
  const f = fixture(t, { stop: "silent", kill: "throw" });
  await assert.rejects(f.seed(), (error) => {
    assert.equal(error.code, "seed_start_timeout");
    assert.equal(error.details?.cleanupFailed, true);
    return true;
  });
  assert.equal(f.manager.records.size, 1);
  assert.equal(f.manager.seedKeys.size, 0);
  f.children[0].kill = (signal) => { f.children[0].signals.push(signal); f.children[0].close(null, signal); return true; };
  const result = await f.manager.stopAll({ timeoutMilliseconds: TIMEOUT, forceOwnedAfterTimeout: true });
  assert.equal(result[0].stopped, true);
  assert.equal(f.manager.records.size, 0);
});

test("stopAll during Seed startup prevents a late ready handle", { timeout: 3_000 }, async (t) => {
  let stopSeen;
  const stopped = new Promise((resolve) => { stopSeen = resolve; });
  const f = fixture(t, { onStop(child, message) {
    child.emit("message", {
      channel: CHANNEL, type: "stopped", instanceId: child.instanceId,
      requestId: message.requestId, graceful: true,
    });
    stopSeen(child);
  } });
  const starting = f.seed();
  const rejected = assert.rejects(starting, { code: "operation_cancelled" });
  await f.spawned;
  const stopping = f.manager.stopAll({ timeoutMilliseconds: TIMEOUT });
  const child = await stopped;
  child.emitReady();
  child.close();
  await Promise.all([rejected, stopping]);
  assert.equal(f.manager.records.size, 0);
  assert.equal(f.manager.seedKeys.size, 0);
});

test("post-ready Seed that already exited is forgotten without further IPC or force kill", { timeout: 3_000 }, async (t) => {
  const f = fixture(t, { mode: "ready" });
  const handle = await f.seed();
  const child = f.children[0];
  assert.equal(handle.owned, true);
  child.close(1);
  const stopped = await f.manager.stopSeed(handle, { timeoutMilliseconds: TIMEOUT });
  assert.equal(stopped.state, "idle");
  assert.equal(stopped.method, "already_exited");
  assert.equal(stopped.graceful, false);
  assert.equal(stopped.forced, false);
  assert.equal(stopped.exitCode, 1);
  assert.equal(child.messages.filter((m) => m.type === "stop").length, 0);
  assert.deepEqual(child.signals, []);
  assert.equal(f.manager.records.size, 0);
  assert.equal(f.manager.seedKeys.size, 0);
});

test("post-ready Seed exit during stop IPC is retired only after confirmed exit", { timeout: 3_000 }, async (t) => {
  const f = fixture(t, { mode: "ready", onStop: (child) => child.close(1) });
  const handle = await f.seed();
  const stopped = await f.manager.stopSeed(handle, { timeoutMilliseconds: TIMEOUT });
  assert.equal(stopped.method, "already_exited");
  assert.equal(stopped.graceful, false);
  assert.equal(stopped.forced, false);
  assert.equal(stopped.exitCode, 1);
  assert.equal(f.children[0].messages.filter((m) => m.type === "stop").length, 1);
  assert.deepEqual(f.children[0].signals, []);
  assert.equal(f.manager.records.size, 0);
  assert.equal(f.manager.seedKeys.size, 0);
});

test("post-ready unresponsive but live Seed retains ownership after stop timeout", { timeout: 3_000 }, async (t) => {
  const f = fixture(t, { mode: "ready", stop: "silent" });
  const handle = await f.seed();
  await assert.rejects(f.manager.stopSeed(handle, { timeoutMilliseconds: TIMEOUT }),
    { code: "graceful_stop_timeout" });
  assert.equal(f.manager.records.size, 1);
  assert.equal(f.manager.seedKeys.size, 1);
  const stopped = await f.manager.stopSeed(handle, {
    timeoutMilliseconds: TIMEOUT, forceOwnedAfterTimeout: true,
  });
  assert.equal(stopped.forced, true);
  assert.equal(stopped.method, "owned_child_force_fallback");
  assert.deepEqual(f.children[0].signals, ["SIGKILL"]);
  assert.equal(f.manager.records.size, 0);
});

test("Publishing Seed review timeout cleans up without confirmation", { timeout: 3_000 }, async (t) => {
  const f = fixture(t);
  await assert.rejects(f.publish(), { code: "publish_review_timeout" });
  assert.equal(f.children[0].connected, false);
  assert.equal(f.children[0].messages.some((m) => m.type === "confirm_publish"), false);
  assert.equal(f.manager.records.size, 0);
});

test("Publishing Seed fingerprint mismatch cancels without confirmation and leaves no child", { timeout: 3_000 }, async (t) => {
  const f = fixture(t, { mode: "review-mismatch" });
  await assert.rejects(f.publish(), { code: "source_changed" });
  assert.equal(f.children[0].connected, false);
  assert.equal(f.children[0].messages.some((m) => m.type === "confirm_publish"), false);
  assert.equal(f.manager.records.size, 0);
});

test("Publishing Seed confirmation timeout cleans up the child", { timeout: 3_000 }, async (t) => {
  const f = fixture(t, { mode: "confirm-silent" });
  await assert.rejects(f.publish(), { code: "seed_start_timeout" });
  assert.equal(f.children[0].connected, false);
  assert.equal(f.children[0].messages.filter((m) => m.type === "confirm_publish").length, 1);
  assert.equal(f.manager.records.size, 0);
});

test("Publishing Seed success remains managed and can be stopped", { timeout: 3_000 }, async (t) => {
  const f = fixture(t, { mode: "review-match" });
  const handle = await f.publish();
  assert.equal(handle.owned, true);
  assert.equal(f.manager.records.size, 1);
  assert.equal(f.manager.seedKeys.size, 1);
  const stopped = await f.manager.stopSeed(handle, { timeoutMilliseconds: TIMEOUT });
  assert.equal(stopped.stopped, true);
  assert.equal(f.manager.records.size, 0);
});

test("Publishing Seed ignored review cancellation falls back to owned-child force cleanup", { timeout: 3_000 }, async (t) => {
  const f = fixture(t, { mode: "review-mismatch-ignored", stop: "silent" });
  await assert.rejects(f.publish(), { code: "source_changed" });
  assert.equal(f.children[0].messages.some((m) => m.type === "confirm_publish"), false);
  assert.deepEqual(f.children[0].signals, ["SIGKILL"]);
  assert.equal(f.manager.records.size, 0);
});

test("stopAll during Publish review prevents later confirmation", { timeout: 3_000 }, async (t) => {
  const f = fixture(t);
  const starting = f.publish();
  const rejected = assert.rejects(starting, { code: "operation_cancelled" });
  await f.spawned;
  const stopped = await f.manager.stopAll({ timeoutMilliseconds: TIMEOUT });
  await rejected;
  assert.equal(stopped.length, 1);
  assert.equal(f.children[0].messages.some((m) => m.type === "confirm_publish"), false);
  assert.equal(f.manager.records.size, 0);
});

test("stopAll during Publish readiness reports cancellation after confirmation", { timeout: 3_000 }, async (t) => {
  let confirmSeen;
  const confirmed = new Promise((resolve) => { confirmSeen = resolve; });
  const f = fixture(t, { mode: "confirm-silent", onConfirm: () => confirmSeen() });
  const starting = f.publish();
  const rejected = assert.rejects(starting, { code: "operation_cancelled" });
  await confirmed;
  const stopped = await f.manager.stopAll({ timeoutMilliseconds: TIMEOUT });
  await rejected;
  assert.equal(stopped.length, 1);
  assert.equal(f.children[0].messages.filter((m) => m.type === "confirm_publish").length, 1);
  assert.equal(f.manager.records.size, 0);
  assert.equal(f.manager.seedKeys.size, 0);
});

test("Publishing Seed unexpected child exit without cancellation keeps its failure code", { timeout: 3_000 }, async (t) => {
  const f = fixture(t);
  const starting = f.publish();
  const rejected = assert.rejects(starting, { code: "lifecycle_child_exited" });
  const child = await f.spawned;
  child.close(1);
  await rejected;
  assert.equal(f.manager.records.size, 0);
  assert.equal(f.manager.seedKeys.size, 0);
});

async function checkRealSeedCleanup(t, publishing) {
  const root = await mkdtemp(path.join(os.tmpdir(), "teamforge-seed-startup-"));
  const modulePath = path.join(root, "silent-seed.mjs");
  await writeFile(modulePath, `
const channel = "teamforge-lifecycle-v1";
const instanceId = process.env.TEAMFORGE_LIFECYCLE_INSTANCE_ID;
const token = process.env.TEAMFORGE_LIFECYCLE_TOKEN;
process.on("message", (message) => {
  if (message?.channel !== channel || message.type !== "stop" ||
      message.instanceId !== instanceId || message.token !== token) return;
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
      forkProcess(_module, args, options) {
        child = nodeFork(modulePath, args, { ...options, execArgv: [] });
        closed = once(child, "close", { signal: t.signal });
        closed.catch(() => {});
        return child;
      },
    });
    const request = publishing ? manager.ensurePublishingSeed({
      arguments: ["publish", "--port", "0", "--launch-settings", modulePath],
      expectedIdentity: CORE, publishReviewFingerprint: REVIEW, timeoutMilliseconds: 1_000,
    }) : manager.ensureSeed({
      arguments: ["seed", "--port", "0"],
      expectedIdentity: CORE, timeoutMilliseconds: 1_000,
    });
    await assert.rejects(request, { code: publishing ? "publish_review_timeout" : "seed_start_timeout" });
    await closed;
    assert(child.exitCode !== null || child.signalCode !== null);
    assert.equal(child.connected, false);
    assert.equal(child.killed, false, "authenticated stop should reap the real child without SIGKILL");
    assert.equal(manager.records.size, 0);
    assert.deepEqual(await manager.stopAll(), []);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "close");
      child.kill("SIGKILL");
      await exited;
    }
    await rm(root, { recursive: true, force: true });
  }
}

test("real silent Seed child is reaped after readiness timeout", { timeout: 15_000 }, async (t) => {
  await checkRealSeedCleanup(t, false);
});

test("real silent Publishing Seed child is reaped after review timeout", { timeout: 15_000 }, async (t) => {
  await checkRealSeedCleanup(t, true);
});

test("fixed-port Seed readiness timeout preserves port_conflict and cleans up", { timeout: 3_000 }, async (t) => {
  const f = fixture(t);
  await assert.rejects(f.seed(12_345), (error) => {
    assert.equal(error.code, "port_conflict");
    assert.equal(error.details?.causeCode, "seed_start_timeout");
    return true;
  });
  assert.equal(f.children[0].connected, false);
  assert.equal(f.manager.records.size, 0);
});

test("Seed identity mismatch cleans up without publishing a reuse key", { timeout: 3_000 }, async (t) => {
  const f = fixture(t, { mode: "wrong-ready" });
  await assert.rejects(f.seed(), { code: "lifecycle_identity_mismatch" });
  assert.equal(f.children[0].connected, false);
  assert.equal(f.manager.records.size, 0);
  assert.equal(f.manager.seedKeys.size, 0);
});

test("real unresponsive Seed child is force-reaped after startup timeout", { timeout: 15_000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "teamforge-seed-force-"));
  const modulePath = path.join(root, "unresponsive-seed.mjs");
  // Keep the child alive and deliberately ignore authenticated stop messages.
  await writeFile(modulePath, "setInterval(() => {}, 1000);\n");
  let child;
  let closed;
  try {
    const manager = new TeamForgeProcessLifecycleManager({
      workspaceRoot: root,
      preflight: async () => ({ failures: [], runtimeStrategy: { nodeExecutable: process.execPath } }),
      forkProcess(_module, args, options) {
        child = nodeFork(modulePath, args, { ...options, execArgv: [] });
        closed = once(child, "close", { signal: t.signal });
        closed.catch(() => {});
        return child;
      },
    });
    await assert.rejects(manager.ensureSeed({
      arguments: ["seed", "--port", "0"], expectedIdentity: CORE, timeoutMilliseconds: 500,
    }), { code: "seed_start_timeout" });
    await closed;
    assert.equal(child.killed, true, "only the freshly forked child receives force fallback");
    assert(child.exitCode !== null || child.signalCode !== null);
    assert.equal(manager.records.size, 0);
    assert.deepEqual(await manager.stopAll(), []);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "close");
      child.kill("SIGKILL");
      await exited;
    }
    await rm(root, { recursive: true, force: true });
  }
});
