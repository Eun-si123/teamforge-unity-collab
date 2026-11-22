import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { DirectTransferClient } from "../src/direct-transfer-client.mjs";

const configuration = Object.freeze({
  endpoint: "http://127.0.0.1:5091/transfer",
  transferToken: "synthetic-bounded-client-token",
  sessionId: "test",
  projectUuid: "00000000-0000-4000-8000-000000000001",
  manifestHash: "a".repeat(64),
  maxJsonBytes: 8,
  timeoutMilliseconds: 100,
});

async function within(promise, milliseconds = 800) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("bounded response waited for stalled cancellation")), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function unresponsiveCancellationStream({ byteCount, onCancel }) {
  let sent = false;
  return new ReadableStream({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(new Uint8Array(byteCount));
      }
    },
    cancel() {
      onCancel();
      // A broken or hostile peer may never acknowledge body cancellation.
      return new Promise(() => {});
    },
  }, { highWaterMark: 0 });
}

test("oversized Content-Length refuses immediately despite a stalled cancellation", async () => {
  let cancellations = 0;
  let requestSignal;
  const stream = unresponsiveCancellationStream({ byteCount: 1, onCancel: () => { cancellations += 1; } });
  const client = new DirectTransferClient({
    ...configuration,
    fetchImplementation: async (_url, { signal }) => {
      requestSignal = signal;
      return new Response(stream, {
        headers: { "content-type": "application/json", "content-length": "100" },
      });
    },
  });
  await assert.rejects(within(client.descriptor()), { code: "peer_response_too_large" });
  assert.equal(cancellations, 1);
  assert.equal(stream.locked, false);
  assert.equal(requestSignal.aborted, true, "failed oversized requests must abort the network transport");
});

test("chunked response exceeding the byte budget refuses despite stalled reader cancellation", async () => {
  let cancellations = 0;
  let requestSignal;
  const stream = unresponsiveCancellationStream({ byteCount: 32, onCancel: () => { cancellations += 1; } });
  const client = new DirectTransferClient({
    ...configuration,
    fetchImplementation: async (_url, { signal }) => {
      requestSignal = signal;
      return new Response(stream, { headers: { "content-type": "application/json" } });
    },
  });
  await assert.rejects(within(client.descriptor()), { code: "peer_response_too_large" });
  assert.equal(cancellations, 1);
  assert.equal(stream.locked, false, "reader must be released after refusal");
  assert.equal(requestSignal.aborted, true, "failed oversized requests must abort the network transport");
});

test("fully-read successful JSON releases its reader and retains the ordinary parsed payload", async () => {
  const payload = Buffer.from('{"a":1}');
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(payload.subarray(0, 2));
      controller.enqueue(payload.subarray(2));
      controller.close();
    },
    cancel() { cancelled = true; },
  });
  const client = new DirectTransferClient({
    ...configuration,
    fetchImplementation: async () => new Response(stream, {
      headers: { "content-type": "application/json" },
    }),
  });
  assert.deepEqual(await within(client.descriptor()), { a: 1 });
  assert.equal(cancelled, false);
  assert.equal(stream.locked, false);
});

test("oversized HTTP error diagnostics retain status and abort the body transport", async () => {
  let cancellations = 0;
  let requestSignal;
  const stream = unresponsiveCancellationStream({ byteCount: 1, onCancel: () => { cancellations += 1; } });
  const client = new DirectTransferClient({
    ...configuration,
    fetchImplementation: async (_url, { signal }) => {
      requestSignal = signal;
      return new Response(stream, {
        status: 503,
        headers: { "content-type": "application/json", "content-length": "65537" },
      });
    },
  });
  await assert.rejects(within(client.descriptor()), (error) =>
    error?.code === "peer_http_error" && error?.details?.status === 503);
  assert.equal(cancellations, 1);
  assert.equal(requestSignal.aborted, true);
});

test("live loopback peer stops streaming promptly after response limit is exceeded", async () => {
  let responseClosed;
  const closed = new Promise((resolve) => { responseClosed = resolve; });
  const server = createServer((_request, response) => {
    response.once("close", responseClosed);
    response.writeHead(200, { "content-type": "application/json" });
    response.write(Buffer.alloc(1_024, 0x41));
    // Deliberately never end: the client must abort on the size limit.
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const client = new DirectTransferClient({
      ...configuration,
      endpoint: `http://127.0.0.1:${server.address().port}/transfer`,
    });
    await assert.rejects(within(client.descriptor(), 1_500), { code: "peer_response_too_large" });
    await within(closed, 1_500);
    assert.equal(server.listening, true, "rejecting a broken peer must not stop the independent server");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});