import assert from "node:assert/strict";
import test from "node:test";
import { DirectTransferClient } from "../src/direct-transfer-client.mjs";

const fixture = Object.freeze({
  endpoint: "http://127.0.0.1:5081/transfer",
  transferToken: "synthetic-direct-deadline-token",
  sessionId: "bounded",
  projectUuid: "00000000-0000-4000-8000-000000000009",
  manifestHash: "a".repeat(64),
  maxJsonBytes: 128,
  timeoutMilliseconds: 100,
});

function client(fetchImplementation) {
  return new DirectTransferClient({ ...fixture, fetchImplementation });
}

async function bounded(promise, limit = 1200) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("direct transfer did not settle within deadline")), limit);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function stalledResponse(status = 200) {
  return new Response(new ReadableStream({
    pull() { return new Promise(() => {}); },
  }), { status, headers: { "content-type": "application/json" } });
}

test("already-cancelled transfers never dispatch an outbound fetch", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(bounded(client(async () => {
    calls += 1;
    return new Promise(() => {});
  }).descriptor(controller.signal)), { code: "download_cancelled" });
  assert.equal(calls, 0, "a pre-cancelled request must not start a network operation");
});

test("hard deadline bounds a fetch adapter that ignores AbortSignal entirely", async () => {
  let requestSignal;
  const start = performance.now();
  await assert.rejects(bounded(client(async (_, { signal }) => {
    requestSignal = signal;
    return new Promise(() => {});
  }).descriptor()), { code: "peer_timeout" });
  assert.equal(requestSignal?.aborted, true, "transport must still receive cancellation");
  assert.ok(performance.now() - start < 1100, "request did not settle within the outer deadline");
});

test("hard deadline also bounds a successful response with an unresponsive streaming body", async () => {
  let requestSignal;
  await assert.rejects(bounded(client(async (_, { signal }) => {
    requestSignal = signal;
    return stalledResponse();
  }).descriptor()), { code: "peer_timeout" });
  assert.equal(requestSignal?.aborted, true);
});

test("hard deadline also bounds a stalled HTTP error body without losing timeout classification", async () => {
  let requestSignal;
  await assert.rejects(bounded(client(async (_, { signal }) => {
    requestSignal = signal;
    return stalledResponse(503);
  }).descriptor()), { code: "peer_timeout" });
  assert.equal(requestSignal?.aborted, true);
});

test("external cancellation settles even when the adapter ignores abort and never returns", async () => {
  const controller = new AbortController();
  let started;
  const dispatched = new Promise(resolve => { started = resolve; });
  let requestSignal;
  const pending = client(async (_, { signal }) => {
    requestSignal = signal;
    started();
    return new Promise(() => {});
  }).descriptor(controller.signal);
  await bounded(dispatched);
  controller.abort();
  await assert.rejects(bounded(pending), { code: "download_cancelled" });
  assert.equal(requestSignal?.aborted, true);
});
