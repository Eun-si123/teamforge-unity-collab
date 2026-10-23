import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { DirectTransferServer, createTransferToken } from "../src/direct-transfer-server.mjs";
import { cleanup, publicationFixture, temporaryRoot } from "./helpers.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
}

async function fixtureServer() {
  const root = await temporaryRoot();
  const fixture = await publicationFixture(root);
  const server = new DirectTransferServer({
    host: "127.0.0.1",
    port: 0,
    sessionId: "editors",
    projectUuid: fixture.projectUuid,
    manifest: fixture.manifest,
    descriptor: fixture.descriptor,
    store: fixture.store,
    transferToken: createTransferToken(),
  });
  return { root, server };
}

test("stop waits for a pending Direct Seed bind and closes its listener", { timeout: 10_000 }, async () => {
  const { root, server } = await fixtureServer();
  const originalListen = server.httpServer.listen;
  const bind = deferred();
  let bindCalled = false;
  server.httpServer.listen = function (...args) {
    bindCalled = true;
    void bind.promise.then(() => originalListen.apply(this, args));
    return this;
  };
  let started;
  let stopped;
  try {
    started = server.start();
    assert.equal(bindCalled, true);
    assert.equal(server.httpServer.listening, false);
    let stopSettled = false;
    stopped = server.stop().then(() => { stopSettled = true; });
    await nextTurn();
    assert.equal(stopSettled, false, "stop must retain ownership while the bind is pending");
    bind.resolve();
    await Promise.all([started, stopped]);
    assert.equal(server.httpServer.listening, false);
    assert.equal(server.httpServer.address(), null);
  } finally {
    bind.resolve();
    await Promise.allSettled([started, stopped].filter(Boolean));
    await server.stop();
    await cleanup(root);
  }
});

test("immediate real Direct Seed start then stop leaves no listening port", { timeout: 10_000 }, async () => {
  const { root, server } = await fixtureServer();
  try {
    const started = server.start();
    await server.stop();
    await started;
    assert.equal(server.httpServer.listening, false);
    assert.equal(server.httpServer.address(), null);
  } finally {
    await server.stop();
    await cleanup(root);
  }
});

test("concurrent Direct Seed starts share one bind and an already running start is idempotent", {
  timeout: 10_000,
}, async () => {
  const { root, server } = await fixtureServer();
  const originalListen = server.httpServer.listen;
  let binds = 0;
  server.httpServer.listen = function (...args) {
    binds += 1;
    return originalListen.apply(this, args);
  };
  try {
    const results = await Promise.allSettled([server.start(), server.start()]);
    assert.deepEqual(results.map(result => result.status), ["fulfilled", "fulfilled"]);
    assert.deepEqual(results[0].value, results[1].value);
    assert.deepEqual(await server.start(), results[0].value);
    assert.equal(binds, 1);
  } finally {
    await server.stop();
    await cleanup(root);
  }
});

test("Direct Seed rejects a new start during shutdown and permits restart after stop", {
  timeout: 10_000,
}, async () => {
  const { root, server } = await fixtureServer();
  const originalClose = server.httpServer.close;
  const closeReached = deferred();
  const finishClose = deferred();
  let stopped;
  let restart;
  try {
    await server.start();
    server.httpServer.close = function (callback) {
      return originalClose.call(this, (error) => {
        closeReached.resolve();
        void finishClose.promise.then(() => callback(error));
      });
    };
    stopped = server.stop();
    assert.equal(server.stop(), stopped, "simultaneous stops must share cleanup ownership");
    await closeReached.promise;
    restart = server.start();
    await assert.rejects(restart, { code: "transfer_stopping" });
    finishClose.resolve();
    await stopped;
    server.httpServer.close = originalClose;
    const bound = await server.start();
    assert.equal(server.httpServer.listening, true);
    assert.equal(bound.port, server.httpServer.address().port);
    await server.stop();
    assert.equal(server.httpServer.listening, false);
  } finally {
    finishClose.resolve();
    await Promise.allSettled([stopped, restart].filter(Boolean));
    server.httpServer.close = originalClose;
    await server.stop();
    await cleanup(root);
  }
});

test("failed pending Direct Seed bind settles stop and permits a clean retry", { timeout: 10_000 }, async () => {
  const { root, server } = await fixtureServer();
  const initialListening = server.httpServer.listenerCount("listening");
  const initialErrors = server.httpServer.listenerCount("error");
  const originalListen = server.httpServer.listen;
  const failBind = deferred();
  server.httpServer.listen = function () {
    void failBind.promise.then(() => this.emit("error", Object.assign(new Error("occupied"), {
      code: "EADDRINUSE",
    })));
    return this;
  };
  let started;
  let stopped;
  try {
    started = server.start();
    const rejectedStart = assert.rejects(started, {
      code: "transfer_bind_unavailable", details: { causeCode: "EADDRINUSE" },
    });
    stopped = server.stop();
    failBind.resolve();
    await Promise.all([rejectedStart, stopped]);
    assert.equal(server.httpServer.listenerCount("listening"), initialListening);
    assert.equal(server.httpServer.listenerCount("error"), initialErrors);
    server.httpServer.listen = originalListen;
    await server.start();
    assert.equal(server.httpServer.listening, true);
    await server.stop();
    assert.equal(server.httpServer.listening, false);
  } finally {
    failBind.resolve();
    await Promise.allSettled([started, stopped].filter(Boolean));
    server.httpServer.listen = originalListen;
    await server.stop();
    await cleanup(root);
  }
});

test("synchronous Direct Seed listen failure removes transient listeners before retry", {
  timeout: 10_000,
}, async () => {
  const { root, server } = await fixtureServer();
  const initialListening = server.httpServer.listenerCount("listening");
  const initialErrors = server.httpServer.listenerCount("error");
  const originalListen = server.httpServer.listen;
  const failure = Object.assign(new Error("invalid bind"), { code: "EINVAL" });
  server.httpServer.listen = () => { throw failure; };
  try {
    await assert.rejects(server.start(), error => error === failure);
    assert.equal(server.httpServer.listenerCount("listening"), initialListening);
    assert.equal(server.httpServer.listenerCount("error"), initialErrors);
    server.httpServer.listen = originalListen;
    await server.start();
    await server.stop();
    assert.equal(server.httpServer.listening, false);
  } finally {
    server.httpServer.listen = originalListen;
    await server.stop();
    await cleanup(root);
  }
});
