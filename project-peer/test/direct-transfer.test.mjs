import assert from "node:assert/strict";
import test from "node:test";
import { connect as connectTcp } from "node:net";
import { once } from "node:events";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { DirectTransferClient, DIRECT_TRANSFER_RETRY_POLICY } from "../src/direct-transfer-client.mjs";
import { DirectTransferServer, createTransferToken } from "../src/direct-transfer-server.mjs";
import { uniqueManifestChunks } from "../src/manifest.mjs";
import { SwarmDownloader } from "../src/swarm-downloader.mjs";
import { cleanup, publicationFixture, temporaryRoot } from "./helpers.mjs";

function headers(fixture, token, sessionId = "editors") {
  return {
    authorization: `Bearer ${token}`,
    "x-teamforge-project-uuid": fixture.projectUuid,
    "x-teamforge-manifest-hash": fixture.manifest.manifestHash,
    "x-teamforge-session-id": sessionId,
  };
}

async function runningServer(fixture, overrides = {}) {
  const transferToken = createTransferToken();
  const server = new DirectTransferServer({
    projectUuid: fixture.projectUuid,
    sessionId: "editors",
    manifest: fixture.manifest,
    descriptor: fixture.descriptor,
    store: fixture.store,
    transferToken,
    ...overrides,
  });
  const bound = await server.start();
  return { server, transferToken, endpoint: bound.endpoint };
}

async function within(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitFor(predicate, milliseconds, message) {
  const deadline = Date.now() + milliseconds;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(message);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function openPausedChunkSocket(endpoint, fixture, token, hash) {
  const target = new URL(`${endpoint}/chunks/${hash}`);
  const socket = connectTcp({ host: target.hostname, port: Number(target.port) });
  socket.on("error", () => {});
  await once(socket, "connect");
  socket.pause();
  socket.write(
    `GET ${target.pathname} HTTP/1.1\r\n` +
    `Host: ${target.host}\r\n` +
    `Authorization: Bearer ${token}\r\n` +
    `X-TeamForge-Project-UUID: ${fixture.projectUuid}\r\n` +
    `X-TeamForge-Manifest-Hash: ${fixture.manifest.manifestHash}\r\n` +
    "X-TeamForge-Session-ID: editors\r\nConnection: keep-alive\r\n\r\n",
  );
  return socket;
}

async function connectionCount(server) {
  return new Promise((resolve, reject) => {
    server.httpServer.getConnections((error, count) => error ? reject(error) : resolve(count));
  });
}

test("direct HTTP serves only the authenticated Project/Manifest/Session and never needs a relay", async () => {
  const root = await temporaryRoot();
  let running;
  try {
    const fixture = await publicationFixture(root);
    running = await runningServer(fixture);
    let requestCount = 0;
    const client = new DirectTransferClient({
      endpoint: running.endpoint,
      transferToken: running.transferToken,
      sessionId: "editors",
      projectUuid: fixture.projectUuid,
      manifestHash: fixture.manifest.manifestHash,
      fetchImplementation: async (...arguments_) => {
        requestCount += 1;
        return fetch(...arguments_);
      },
    });
    assert.equal((await client.descriptor()).descriptorHash, fixture.descriptor.descriptorHash);
    assert.equal((await client.manifest()).manifestHash, fixture.manifest.manifestHash);
    const inventory = await client.inventory();
    const chunk = uniqueManifestChunks(fixture.manifest)[0];
    assert(inventory.chunks.includes(chunk.hash));
    assert.equal((await client.chunk(chunk.hash, chunk.size)).length, chunk.size);
    assert.equal(requestCount, 4);

    const descriptorUrl = `${running.endpoint}/descriptor`;
    for (const altered of [
      { authorization: "Bearer incorrect-token-value" },
      { "x-teamforge-project-uuid": "00000000-0000-4000-8000-000000000001" },
      { "x-teamforge-manifest-hash": "f".repeat(64) },
      { "x-teamforge-session-id": "other-session" },
    ]) {
      const response = await fetch(descriptorUrl, {
        headers: { ...headers(fixture, running.transferToken), ...altered },
      });
      assert.equal(response.status, 401);
    }
  } finally {
    await running?.server.stop();
    await cleanup(root);
  }
});

test("direct HTTP enforces request rate, concurrent request, and chunk size limits", async () => {
  const root = await temporaryRoot();
  let rateServer;
  let busyServer;
  let sizeServer;
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: { "Assets/Payload.bin": Buffer.alloc(131_072, 7) },
      chunkSize: 131_072,
    });
    rateServer = await runningServer(fixture, { rateLimitPerSecond: 1 });
    const first = await fetch(`${rateServer.endpoint}/descriptor`, {
      headers: headers(fixture, rateServer.transferToken),
    });
    const second = await fetch(`${rateServer.endpoint}/descriptor`, {
      headers: headers(fixture, rateServer.transferToken),
    });
    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
    assert.equal(second.headers.get("retry-after"), "1");
    assert(Number(second.headers.get("x-teamforge-retry-after-ms")) > 0);
    await rateServer.server.stop();
    rateServer = null;

    let releaseRead;
    let readStarted;
    const started = new Promise((resolve) => { readStarted = resolve; });
    const release = new Promise((resolve) => { releaseRead = resolve; });
    const delayedStore = {
      inventory: (...arguments_) => fixture.store.inventory(...arguments_),
      async read(...arguments_) {
        readStarted();
        await release;
        return fixture.store.read(...arguments_);
      },
    };
    busyServer = await runningServer(fixture, { store: delayedStore, maxConcurrentRequests: 1 });
    const chunk = uniqueManifestChunks(fixture.manifest).find((candidate) => candidate.size === 131_072);
    const firstRequest = fetch(`${busyServer.endpoint}/chunks/${chunk.hash}`, {
      headers: headers(fixture, busyServer.transferToken),
    });
    await started;
    const busy = await fetch(`${busyServer.endpoint}/descriptor`, {
      headers: headers(fixture, busyServer.transferToken),
    });
    assert.equal(busy.status, 503);
    assert.equal(busy.headers.get("retry-after"), "1");
    assert.equal(busy.headers.get("x-teamforge-retry-after-ms"), "100");
    releaseRead();
    assert.equal((await firstRequest).status, 200);
    await busyServer.server.stop();
    busyServer = null;

    sizeServer = await runningServer(fixture, { maxChunkBytes: 65_536 });
    const oversized = uniqueManifestChunks(fixture.manifest).find((candidate) => candidate.size > 65_536);
    assert(oversized);
    const response = await fetch(`${sizeServer.endpoint}/chunks/${oversized.hash}`, {
      headers: headers(fixture, sizeServer.transferToken),
    });
    assert.equal(response.status, 413);
  } finally {
    await rateServer?.server.stop();
    await busyServer?.server.stop();
    await sizeServer?.server.stop();
    await cleanup(root);
  }
});

test("direct client classifies transient HTTP/network failures and never exposes raw response bodies", async () => {
  assert.deepEqual(
    DIRECT_TRANSFER_RETRY_POLICY.transientHttpStatus,
    [408, 425, 429, 500, 502, 503, 504],
  );
  const configuration = {
    endpoint: "http://127.0.0.1:5091/teamforge-transfer/v1",
    transferToken: "safe-transfer-token-value",
    sessionId: "editors",
    projectUuid: "00000000-0000-4000-8000-000000000001",
    manifestHash: "a".repeat(64),
  };
  for (const status of DIRECT_TRANSFER_RETRY_POLICY.transientHttpStatus) {
    const client = new DirectTransferClient({
      ...configuration,
      fetchImplementation: async () => new Response(
        JSON.stringify({ error: "temporary_failure", reflected: "Bearer must-not-leak" }),
        {
          status,
          headers: {
            "content-type": "application/json",
            "retry-after": "5",
            "x-teamforge-retry-after-ms": "47",
          },
        },
      ),
    });
    await assert.rejects(async () => client.descriptor(), (error) => {
      assert.equal(error.code, "peer_http_error");
      assert.equal(error.details.status, status);
      assert.equal(error.details.retryable, true);
      assert.equal(error.details.retryAfterMilliseconds, 47);
      assert.equal(error.details.serverErrorCode, "temporary_failure");
      assert(!("body" in error.details));
      assert(!JSON.stringify(error).includes("must-not-leak"));
      return true;
    });
  }

  const permanent = new DirectTransferClient({
    ...configuration,
    fetchImplementation: async () => new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    }),
  });
  await assert.rejects(async () => permanent.descriptor(), (error) => {
    assert.equal(error.details.retryable, false);
    assert.equal(error.details.status, 401);
    return true;
  });

  const reset = new DirectTransferClient({
    ...configuration,
    fetchImplementation: async () => {
      const error = new TypeError("fetch failed");
      error.cause = { code: "ECONNRESET" };
      throw error;
    },
  });
  await assert.rejects(async () => reset.descriptor(), (error) => {
    assert.equal(error.code, "peer_network_error");
    assert.equal(error.details.retryable, true);
    assert.equal(error.details.networkCode, "ECONNRESET");
    return true;
  });

  const timeout = new DirectTransferClient({
    ...configuration,
    timeoutMilliseconds: 100,
    fetchImplementation: async (_url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }),
  });
  await assert.rejects(async () => timeout.descriptor(), (error) => {
    assert.equal(error.code, "peer_timeout");
    assert.equal(error.details.retryable, true);
    return true;
  });
});

test("WP4 external pause signal aborts an in-flight direct request as download_cancelled", async () => {
  const controller = new AbortController();
  let requestSignal;
  const client = new DirectTransferClient({
    endpoint: "http://127.0.0.1:5091/teamforge-transfer/v1",
    transferToken: "safe-transfer-token-value",
    sessionId: "editors",
    projectUuid: "00000000-0000-4000-8000-000000000001",
    manifestHash: "a".repeat(64),
    timeoutMilliseconds: 30_000,
    fetchImplementation: async (_url, options) => new Promise((_resolve, reject) => {
      requestSignal = options.signal;
      options.signal.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
        { once: true },
      );
    }),
  });
  const pending = client.descriptor(controller.signal);
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, { code: "download_cancelled" });
  assert.equal(requestSignal.aborted, true);
});

test("direct client preserves cancellation and deadlines while reading HTTP error bodies", async (t) => {
  for (const status of [401, 503]) {
    for (const mode of ["cancel", "timeout", "cancel-discovery"]) {
      await t.test(`HTTP ${status}: ${mode}`, { timeout: 5_000 }, async () => {
        let requestCount = 0;
        const server = createServer((_request, response) => {
          requestCount += 1;
          response.writeHead(status, { "content-type": "application/json" });
          response.write('{"error":"unfinished');
        });
        const controller = new AbortController();
        let receivedResponse;
        let responseReceived;
        const received = new Promise((resolve) => { responseReceived = resolve; });
        const diagnostics = [];
        try {
          server.listen(0, "127.0.0.1");
          await once(server, "listening");
          const client = new DirectTransferClient({
            endpoint: `http://127.0.0.1:${server.address().port}/teamforge-transfer/v1`,
            transferToken: "safe-transfer-token-value",
            sessionId: "editors",
            projectUuid: "00000000-0000-4000-8000-000000000001",
            manifestHash: "a".repeat(64),
            timeoutMilliseconds: mode === "timeout" ? 500 : 3_000,
            fetchImplementation: async (...args) => {
              const response = await fetch(...args);
              receivedResponse = response;
              responseReceived();
              return response;
            },
          });
          const pending = mode === "cancel-discovery"
            ? new SwarmDownloader({
              store: { put() {}, has() {} },
              onDiagnostic: (value) => diagnostics.push(value),
              minimumPeerIntervalMilliseconds: 0,
            }).discover({
              seeds: [{ id: "unfinished-seed", client }],
              projectId: "test-project",
              projectUuid: client.projectUuid,
              manifestHash: client.manifestHash,
              sessionId: "editors",
              signal: controller.signal,
            })
            : client.descriptor(controller.signal);
          const rejection = assert.rejects(pending, (error) => {
            assert.equal(error.code, mode === "timeout" ? "peer_timeout" : "download_cancelled");
            if (mode === "timeout") assert.equal(error.details.retryable, true);
            return true;
          });
          // Observe the response headers before aborting an active body read.
          if (mode !== "timeout") {
            await within(received, 2_000, "HTTP error headers were not received");
            await new Promise((resolve) => setImmediate(resolve));
            assert.equal(receivedResponse.bodyUsed, true);
            controller.abort();
          }
          await rejection;
          assert.equal(receivedResponse?.bodyUsed, true, "the deadline must interrupt an active body read");
          assert.equal(requestCount, 1);
          assert.deepEqual(diagnostics, [], "cancellation must not schedule a peer retry or record a peer failure");
        } finally {
          controller.abort();
          server.closeAllConnections();
          await new Promise((resolve) => server.close(resolve));
        }
      });
    }
  }
});

test("non-abort HTTP error body failures retain status and bounded diagnostics", async () => {
  for (const body of [
    () => "not-json-secret",
    () => "x".repeat(65_537),
    () => new ReadableStream({ start(controller) { controller.error(new TypeError("private-body-failure")); } }),
  ]) {
    const client = new DirectTransferClient({
      endpoint: "http://127.0.0.1:5091/teamforge-transfer/v1",
      transferToken: "safe-transfer-token-value",
      sessionId: "editors",
      projectUuid: "00000000-0000-4000-8000-000000000001",
      manifestHash: "a".repeat(64),
      fetchImplementation: async () => new Response(body(), {
        status: 503,
        headers: { "retry-after": "1" },
      }),
    });
    await assert.rejects(client.descriptor(), (error) => {
      assert.equal(error.code, "peer_http_error");
      assert.equal(error.details.status, 503);
      assert.equal(error.details.retryable, true);
      assert.equal(error.details.retryAfterMilliseconds, 1_000);
      assert.equal(error.details.serverErrorCode, "");
      assert(!JSON.stringify(error).includes("secret"));
      assert(!JSON.stringify(error).includes("private-body-failure"));
      return true;
    });
  }
});

test("direct client parses Retry-After deterministically and caps untrusted hints", async () => {
  const configuration = {
    endpoint: "http://127.0.0.1:5091/teamforge-transfer/v1",
    transferToken: "safe-transfer-token-value",
    sessionId: "editors",
    projectUuid: "00000000-0000-4000-8000-000000000001",
    manifestHash: "a".repeat(64),
  };
  async function parsed(headers) {
    const client = new DirectTransferClient({
      ...configuration,
      fetchImplementation: async () => new Response(JSON.stringify({ error: "rate_limited" }), {
        status: 429,
        headers: { "content-type": "application/json", ...headers },
      }),
    });
    let rejected;
    try {
      await client.descriptor();
    } catch (error) {
      rejected = error;
    }
    assert.equal(rejected?.code, "peer_http_error");
    return rejected.details.retryAfterMilliseconds;
  }

  const originalNow = Date.now;
  const fixedNow = Date.UTC(2030, 0, 2, 3, 4, 5);
  Date.now = () => fixedNow;
  try {
    assert.equal(await parsed({ "retry-after": "7" }), 7_000);
    assert.equal(await parsed({ "retry-after": new Date(fixedNow + 9_000).toUTCString() }), 9_000);
    assert.equal(await parsed({ "retry-after": new Date(fixedNow - 9_000).toUTCString() }), 0);
    assert.equal(await parsed({ "retry-after": "invalid" }), 0);
    assert.equal(await parsed({ "retry-after": "120" }), 60_000);
    assert.equal(await parsed({
      "x-teamforge-retry-after-ms": "47.2",
      "retry-after": "7",
    }), 48);
    assert.equal(await parsed({
      "x-teamforge-retry-after-ms": "70000",
      "retry-after": "1",
    }), 60_000);
    for (const malformed of ["", " ", "0x10", "1e3", "invalid", "-1"]) {
      assert.equal(await parsed({
        "x-teamforge-retry-after-ms": malformed,
        "retry-after": "7",
      }), 7_000);
    }
  } finally {
    Date.now = originalNow;
  }
});

test("maxBytesPerSecond throttles direct chunk payloads", async () => {
  const root = await temporaryRoot();
  let running;
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: { "Assets/Throttled.bin": Buffer.alloc(131_072, 3) },
      chunkSize: 131_072,
    });
    running = await runningServer(fixture, { maxBytesPerSecond: 65_536 });
    const chunk = uniqueManifestChunks(fixture.manifest).find((candidate) => candidate.size === 131_072);
    const startedAt = Date.now();
    const response = await fetch(`${running.endpoint}/chunks/${chunk.hash}`, {
      headers: headers(fixture, running.transferToken),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.arrayBuffer()).byteLength, chunk.size);
    const elapsed = Date.now() - startedAt;
    assert(elapsed >= 1_650, `Expected throttled transfer >=1650ms, received ${elapsed}ms.`);
    assert(elapsed < 6_000, `Throttled transfer unexpectedly took ${elapsed}ms.`);
  } finally {
    await running?.server.stop();
    await cleanup(root);
  }
});

test("aborted throttled clients do not leave a handler waiting forever for drain", async () => {
  const root = await temporaryRoot();
  let running;
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: { "Assets/Abort.bin": Buffer.alloc(1_048_576, 4) },
      chunkSize: 1_048_576,
    });
    running = await runningServer(fixture, { maxBytesPerSecond: 65_536 });
    const chunk = uniqueManifestChunks(fixture.manifest).find((candidate) => candidate.size === 1_048_576);
    const controller = new AbortController();
    const response = await fetch(`${running.endpoint}/chunks/${chunk.hash}`, {
      headers: headers(fixture, running.transferToken),
      signal: controller.signal,
    });
    const reader = response.body.getReader();
    const first = await reader.read();
    assert(first.value.length > 0);
    controller.abort();
    await reader.closed.catch(() => {});
    await within(
      running.server.stop(),
      1_500,
      "Direct server did not close after a throttled client abort.",
    );
    assert.equal(running.server.activeRequests, 0);
    assert.equal(running.server.handlerPromises.size, 0);
    assert.equal(await connectionCount(running.server), 0);
    running = null;
  } finally {
    running?.server.httpServer.closeAllConnections?.();
    await running?.server.stop();
    await cleanup(root);
  }
});

test("abort cancels a forced backpressure drain wait and removes its listeners", async () => {
  const root = await temporaryRoot();
  let running;
  let socket;
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: { "Assets/Drain.bin": Buffer.alloc(65_536, 5) },
      chunkSize: 65_536,
    });
    running = await runningServer(fixture, { maxBytesPerSecond: 65_536 });
    const chunk = uniqueManifestChunks(fixture.manifest).find((candidate) => candidate.size === 65_536);
    let blockedResponse;
    let reportBlocked;
    const blocked = new Promise((resolve) => { reportBlocked = resolve; });
    running.server.httpServer.prependOnceListener("request", (_request, response) => {
      blockedResponse = response;
      response.write = () => {
        reportBlocked();
        return false;
      };
    });
    socket = await openPausedChunkSocket(
      running.endpoint,
      fixture,
      running.transferToken,
      chunk.hash,
    );
    await within(blocked, 1_000, "Direct server did not enter the forced drain wait.");
    assert.equal(blockedResponse.listenerCount("drain"), 1);
    socket.destroy();
    socket = null;
    await waitFor(
      () => running.server.activeRequests === 0 && running.server.handlerPromises.size === 0,
      1_000,
      "Aborted drain handler did not settle promptly.",
    );
    assert.equal(blockedResponse.listenerCount("drain"), 0);
    await within(running.server.stop(), 1_000, "Server did not stop after a drain abort.");
    running = null;
  } finally {
    socket?.destroy();
    running?.server.httpServer.closeAllConnections?.();
    await running?.server.stop();
    await cleanup(root);
  }
});

test("20+ queued throttle aborts clean up, recover, stop idempotently, and release the port", async () => {
  const root = await temporaryRoot();
  let running;
  let rebound;
  const sockets = [];
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: { "Assets/AbortStorm.bin": Buffer.alloc(65_536, 6) },
      chunkSize: 65_536,
    });
    running = await runningServer(fixture, {
      maxBytesPerSecond: 65_536,
      maxConcurrentRequests: 32,
    });
    const chunk = uniqueManifestChunks(fixture.manifest).find((candidate) => candidate.size === 65_536);
    for (let index = 0; index < 24; index += 1) {
      sockets.push(await openPausedChunkSocket(
        running.endpoint,
        fixture,
        running.transferToken,
        chunk.hash,
      ));
    }
    await waitFor(
      () => running.server.activeRequests >= 20,
      1_500,
      "Expected at least 20 simultaneous throttled handlers.",
    );
    for (const candidate of sockets.splice(0)) {
      candidate.destroy();
    }
    await waitFor(
      () => running.server.activeRequests === 0 && running.server.handlerPromises.size === 0,
      1_000,
      "Queued throttle timers or handlers remained after 20+ aborts.",
    );

    const recovered = await fetch(`${running.endpoint}/chunks/${chunk.hash}`, {
      headers: headers(fixture, running.transferToken),
    });
    assert.equal(recovered.status, 200);
    assert.equal((await recovered.arrayBuffer()).byteLength, chunk.size);

    sockets.push(await openPausedChunkSocket(
      running.endpoint,
      fixture,
      running.transferToken,
      chunk.hash,
    ));
    await waitFor(
      () => running.server.activeRequests > 0,
      1_000,
      "Stop-race transfer handler did not start.",
    );
    const port = Number(new URL(running.endpoint).port);
    const firstStop = running.server.stop();
    const secondStop = running.server.stop();
    assert.strictEqual(secondStop, firstStop);
    await within(firstStop, 1_500, "Concurrent server.stop calls did not settle together.");
    for (const candidate of sockets.splice(0)) {
      candidate.destroy();
    }
    assert.equal(running.server.activeRequests, 0);
    assert.equal(running.server.handlerPromises.size, 0);
    assert.equal(running.server.requestContexts.size, 0);
    assert.equal(await connectionCount(running.server), 0);
    running = null;

    rebound = await runningServer(fixture, { port });
    assert.equal(Number(new URL(rebound.endpoint).port), port);
    await within(rebound.server.stop(), 1_000, "Rebound server did not stop.");
    rebound = null;
  } finally {
    for (const candidate of sockets) candidate.destroy();
    running?.server.httpServer.closeAllConnections?.();
    rebound?.server.httpServer.closeAllConnections?.();
    await running?.server.stop();
    await rebound?.server.stop();
    await cleanup(root);
  }
});

test("20+ pipelined throttled requests share one socket abort listener pair without warnings", {
  timeout: 5_000,
}, async () => {
  const root = await temporaryRoot();
  let running;
  let socket;
  let acceptedSocket;
  const maxListenerWarnings = [];
  const initialWarningListeners = process.listenerCount("warning");
  const onWarning = (warning) => {
    if (warning?.name === "MaxListenersExceededWarning") {
      maxListenerWarnings.push(warning.message);
    }
  };
  try {
    process.on("warning", onWarning);
    try {
      const fixture = await publicationFixture(root, {
        assetFiles: { "Assets/Pipeline.bin": Buffer.alloc(65_536, 7) },
        chunkSize: 65_536,
      });
      running = await runningServer(fixture, {
        maxBytesPerSecond: 65_536,
        maxConcurrentRequests: 32,
      });
      const chunk = uniqueManifestChunks(fixture.manifest).find((candidate) => candidate.size === 65_536);
      const target = new URL(running.endpoint);
      running.server.httpServer.once("connection", (candidate) => {
        acceptedSocket = candidate;
      });
      socket = connectTcp({ host: target.hostname, port: Number(target.port) });
      socket.on("error", () => {});
      await once(socket, "connect");
      socket.pause();
      let requests = "";
      for (let index = 0; index < 24; index += 1) {
        requests +=
          `GET ${target.pathname}/chunks/${chunk.hash} HTTP/1.1\r\n` +
          `Host: ${target.host}\r\n` +
          `Authorization: Bearer ${running.transferToken}\r\n` +
          `X-TeamForge-Project-UUID: ${fixture.projectUuid}\r\n` +
          `X-TeamForge-Manifest-Hash: ${fixture.manifest.manifestHash}\r\n` +
          "X-TeamForge-Session-ID: editors\r\nConnection: keep-alive\r\n\r\n";
      }
      socket.write(requests);
      await waitFor(
        () => running.server.activeRequests >= 20,
        1_500,
        "Expected at least 20 pipelined handlers on one socket.",
      );
      await new Promise((resolve) => setImmediate(resolve));
      assert(acceptedSocket, "The server-side keep-alive socket was not observed.");
      assert.equal(running.server.socketContexts.get(acceptedSocket)?.contexts.size, 24);
      assert(acceptedSocket.listenerCount("close") < 10);
      assert(acceptedSocket.listenerCount("error") < 10);
      assert.deepEqual(maxListenerWarnings, []);

      await within(running.server.stop(), 1_500, "Pipelined server shutdown did not settle.");
      assert.equal(running.server.activeRequests, 0);
      assert.equal(running.server.handlerPromises.size, 0);
      assert.equal(running.server.requestContexts.size, 0);
      assert.equal(running.server.sockets.size, 0);
      assert.equal(running.server.socketContexts.size, 0);
      assert.equal(await connectionCount(running.server), 0);
      assert.deepEqual(maxListenerWarnings, []);
      socket.destroy();
      socket = null;
      running = null;
    } finally {
      process.off("warning", onWarning);
    }
    assert.equal(process.listenerCount("warning"), initialWarningListeners);
  } finally {
    socket?.destroy();
    running?.server.httpServer.closeAllConnections?.();
    await running?.server.stop();
    await cleanup(root);
  }
});

test("inventory advertises only hash-verified chunks", async () => {
  const root = await temporaryRoot();
  let running;
  try {
    const fixture = await publicationFixture(root);
    const corrupt = uniqueManifestChunks(fixture.manifest)[0];
    await writeFile(fixture.store.pathForHash(corrupt.hash), Buffer.alloc(corrupt.size, 0xff));
    running = await runningServer(fixture);
    const client = new DirectTransferClient({
      endpoint: running.endpoint,
      transferToken: running.transferToken,
      sessionId: "editors",
      projectUuid: fixture.projectUuid,
      manifestHash: fixture.manifest.manifestHash,
    });
    const inventory = await client.inventory();
    assert.equal(inventory.chunks.includes(corrupt.hash), false);
    assert.equal(inventory.complete, false);
  } finally {
    await running?.server.stop();
    await cleanup(root);
  }
});

test("unlimited chunk responses retain the concurrency slot until finish or close", async (context) => {
  const root = await temporaryRoot();
  let running;
  let socket;
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: { "Assets/Large.bin": Buffer.alloc(4_194_304, 8) },
      chunkSize: 4_194_304,
    });
    running = await runningServer(fixture, { maxConcurrentRequests: 1 });
    const chunk = uniqueManifestChunks(fixture.manifest).find((candidate) => candidate.size === 4_194_304);
    const endpoint = new URL(running.endpoint);
    socket = connectTcp({ host: endpoint.hostname, port: Number(endpoint.port) });
    await once(socket, "connect");
    socket.pause();
    socket.write(
      `GET ${endpoint.pathname}/chunks/${chunk.hash} HTTP/1.1\r\n` +
      `Host: ${endpoint.host}\r\n` +
      `Authorization: Bearer ${running.transferToken}\r\n` +
      `X-TeamForge-Project-UUID: ${fixture.projectUuid}\r\n` +
      `X-TeamForge-Manifest-Hash: ${fixture.manifest.manifestHash}\r\n` +
      "X-TeamForge-Session-ID: editors\r\nConnection: close\r\n\r\n",
    );
    const deadline = Date.now() + 1_000;
    while (running.server.activeRequests === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    if (running.server.activeRequests === 0) {
      context.diagnostic("Loopback socket accepted the entire 4 MiB response before observation.");
      return;
    }
    const second = await fetch(`${running.endpoint}/descriptor`, {
      headers: headers(fixture, running.transferToken),
    });
    assert.equal(second.status, 503);
    socket.destroy();
    socket = null;
  } finally {
    socket?.destroy();
    running?.server.httpServer.closeAllConnections?.();
    await running?.server.stop();
    await cleanup(root);
  }
});
