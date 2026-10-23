import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { createTeamForgeServer } from "../src/teamforge-server.mjs";

function controlledServer(t) {
  const timers = new Set();
  const messages = [];
  t.mock.method(globalThis, "setInterval", () => {
    const timer = { unref() {} };
    timers.add(timer);
    return timer;
  });
  t.mock.method(globalThis, "clearInterval", (timer) => timers.delete(timer));
  const server = createTeamForgeServer({
    host: "127.0.0.1",
    port: 0,
    logger: { info(message) { messages.push(message); }, warn() {}, error() {} },
  });
  const initialListeningListeners = server.httpServer.listenerCount("listening");
  const initialErrorListeners = server.httpServer.listenerCount("error");
  let listening = false;
  let listenCalls = 0;
  let closeCalls = 0;
  server.httpServer.listen = () => {
    listenCalls += 1;
    return server.httpServer;
  };
  Object.defineProperty(server.httpServer, "listening", { get: () => listening });
  server.httpServer.address = () => listening ? { port: 5080 } : null;
  server.httpServer.close = (callback) => {
    closeCalls += 1;
    listening = false;
    queueMicrotask(() => callback());
    return server.httpServer;
  };
  return {
    server, timers, messages,
    get listening() { return listening; },
    get listenCalls() { return listenCalls; },
    get closeCalls() { return closeCalls; },
    releaseListen() {
      listening = true;
      server.httpServer.emit("listening");
    },
    failListen(error) { server.httpServer.emit("error", error); },
    assertReleased() {
      assert.equal(listening, false);
      assert.equal(timers.size, 0);
      assert.equal(server.httpServer.listenerCount("listening"), initialListeningListeners);
      assert.equal(server.httpServer.listenerCount("error"), initialErrorListeners);
    },
  };
}

test("stop owns a pending listen and prevents late startup readiness or timers", async (t) => {
  const controlled = controlledServer(t);
  const { server } = controlled;
  const starting = server.start();
  const rejectedStart = assert.rejects(starting, { code: "server_stopping" });
  const stopping = server.stop();
  let stopped = false;
  stopping.then(() => { stopped = true; });
  try {
    await nextTurn();
    assert.equal(stopped, false, "shutdown must still own the pending listener");
    assert.equal(controlled.timers.size, 0);
  } finally {
    controlled.releaseListen();
    await starting.catch(() => {});
    await stopping;
  }
  await rejectedStart;
  controlled.assertReleased();
  assert.equal(controlled.closeCalls, 1);
  assert.deepEqual(controlled.messages, [], "cancelled startup must not advertise readiness");
});

test("concurrent start and stop calls share their operations and retire timers once", async (t) => {
  const controlled = controlledServer(t);
  const { server } = controlled;
  const starting = server.start();
  assert.strictEqual(server.start(), starting);
  assert.equal(controlled.listenCalls, 1);
  controlled.releaseListen();
  assert.deepEqual(await starting, { host: "127.0.0.1", port: 5080, healthPath: "/health", wsPath: "/ws" });
  assert.equal(controlled.timers.size, 2);
  const stopping = server.stop();
  assert.strictEqual(server.stop(), stopping);
  await stopping;
  controlled.assertReleased();
  assert.equal(controlled.closeCalls, 1);
  await assert.rejects(server.start(), { code: "server_stopping" });
  assert.equal(controlled.listenCalls, 1);
});

test("stop before start never opens a transport", async (t) => {
  const controlled = controlledServer(t);
  const stopping = controlled.server.stop();
  await assert.rejects(controlled.server.start(), { code: "server_stopping" });
  await stopping;
  assert.strictEqual(controlled.server.stop(), stopping);
  controlled.assertReleased();
  assert.equal(controlled.listenCalls, 0);
  assert.equal(controlled.closeCalls, 0);
});

test("listen failure during stop releases listeners without masking the startup error", async (t) => {
  const controlled = controlledServer(t);
  const failure = Object.assign(new Error("test bind failure"), { code: "EADDRINUSE" });
  const starting = controlled.server.start();
  const rejectedStart = assert.rejects(starting, (error) => error === failure);
  const stopping = controlled.server.stop();
  controlled.failListen(failure);
  await Promise.all([rejectedStart, stopping]);
  controlled.assertReleased();
  assert.equal(controlled.closeCalls, 0);
});

test("a failed bind can be retried before shutdown", async (t) => {
  const controlled = controlledServer(t);
  const failed = controlled.server.start();
  const failure = Object.assign(new Error("test bind failure"), { code: "EADDRINUSE" });
  const rejectedStart = assert.rejects(failed, (error) => error === failure);
  controlled.failListen(failure);
  await rejectedStart;
  const retry = controlled.server.start();
  controlled.releaseListen();
  await retry;
  assert.equal(controlled.listenCalls, 2);
  await controlled.server.stop();
  controlled.assertReleased();
});

test("synchronous listen errors release startup listeners", async (t) => {
  const controlled = controlledServer(t);
  const failure = Object.assign(new Error("test invalid listen"), { code: "ERR_INVALID_ARG_VALUE" });
  controlled.server.httpServer.listen = () => { throw failure; };
  await assert.rejects(controlled.server.start(), (error) => error === failure);
  await controlled.server.stop();
  controlled.assertReleased();
});

async function controlledLifecycleChild(t, { failListen = false } = {}) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "teamforge-late-listen-"));
  const loader = path.join(temporary, "controlled-http.mjs");
  // Keep the actual lifecycle child, HTTP server and IPC boundary. Only delay
  // the OS listen effect, so no real socket/DNS race or arbitrary sleep is used.
  await writeFile(loader, `
import { createRequire, syncBuiltinESMExports } from "node:module";
const require = createRequire(import.meta.url);
const http = require("node:http");
const createServer = http.createServer;
http.createServer = (...args) => {
  const server = createServer(...args);
  let listening = false;
  server.listen = () => {
    process.send({ transport: "listen_pending" });
    return server;
  };
  Object.defineProperty(server, "listening", { get: () => listening });
  server.address = () => listening ? { port: 5080 } : null;
  const release = (message) => {
    if (message?.transport === "fail_listen") {
      server.emit("error", Object.assign(new Error("test bind failure"), { code: "EADDRINUSE" }));
      return;
    }
    if (message?.transport !== "release_listen") return;
    listening = true;
    server.emit("listening");
  };
  process.on("message", release);
  server.close = (callback) => {
    listening = false;
    process.off("message", release);
    process.send({ transport: "closed" });
    queueMicrotask(() => callback());
    return server;
  };
  return server;
};
syncBuiltinESMExports();
`);
  const instanceId = "test-coordinator-startup";
  const token = "test-lifecycle-token-00000000000000000000";
  let child;
  try {
    child = fork(fileURLToPath(new URL("../src/lifecycle-child.mjs", import.meta.url)), [], {
      execArgv: ["--import", pathToFileURL(loader).href],
      env: {
        ...process.env,
        TEAMFORGE_HOST: "127.0.0.1",
        TEAMFORGE_PORT: "0",
        TEAMFORGE_LIFECYCLE_INSTANCE_ID: instanceId,
        TEAMFORGE_LIFECYCLE_TOKEN: token,
      },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    const messages = [];
    child.on("message", (message) => messages.push(message));
    const closed = once(child, "close", { signal: t.signal });
    closed.catch(() => {});
    const nextMessage = once(child, "message", { signal: t.signal });
    assert.equal((await nextMessage)[0].transport, "listen_pending");
    if (!failListen) {
      child.send({ channel: "teamforge-lifecycle-v1", type: "stop", instanceId, token, requestId: "test-stop" });
    }
    child.send({ transport: failListen ? "fail_listen" : "release_listen" });
    return { messages, instanceId, exit: await closed };
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "close");
      child.kill("SIGKILL");
      await exited;
    }
    await rm(temporary, { recursive: true, force: true });
  }
}

test("lifecycle child stopped during startup reports stopped without late ready or failure", { timeout: 5_000 }, async (t) => {
  const { messages, instanceId, exit } = await controlledLifecycleChild(t);
  assert.deepEqual(exit, [0, null]);
  assert.deepEqual(messages.filter((message) => message.channel === "teamforge-lifecycle-v1"), [{
    channel: "teamforge-lifecycle-v1", type: "stopped", kind: "coordinator", instanceId,
    reason: "ipc", requestId: "test-stop", graceful: true,
  }]);
  assert.equal(messages.filter((message) => message.transport === "closed").length, 1);
});

test("lifecycle child bind failure keeps its failure exit status through disconnect cleanup", { timeout: 5_000 }, async (t) => {
  const { messages, instanceId, exit } = await controlledLifecycleChild(t, { failListen: true });
  assert.deepEqual(exit, [1, null]);
  assert.deepEqual(messages.filter((message) => message.channel === "teamforge-lifecycle-v1"), [{
    channel: "teamforge-lifecycle-v1", type: "failure", kind: "coordinator", instanceId,
    code: "EADDRINUSE",
  }]);
});
