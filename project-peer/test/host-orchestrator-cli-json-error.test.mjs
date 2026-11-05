import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cliPath = fileURLToPath(new URL("../src/host-orchestrator-cli.mjs", import.meta.url));
import { readFrames, drainBufferedHostFrames, cancelledHostFrame } from "../src/host-orchestrator-cli.mjs";

async function runBridge(lines) {
  const child = spawn(process.execPath, [cliPath, "--workspace-root", path.resolve(os.tmpdir())], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  child.stdin.end(`${lines.join("\n")}\n`);
  const [code] = await once(child, "close");
  assert.equal(code, 0, `Host bridge exited unexpectedly: ${stderr}`);
  return stdout.trim().split("\n").map((line) => JSON.parse(line));
}

test("Host bridge malformed JSON cannot echo input, and following valid requests retain behavior", async () => {
  const marker = "SYNTHETIC_BRIDGE_MARKER_123456789";
  const responses = await runBridge([
    marker,
    `{"token":${marker}}`,
    JSON.stringify({ requestId: "valid-after-malformed", operation: "unsupportedOperation" }),
    JSON.stringify({ requestId: "post-parse-error", operation: "repairDependencies" }),
  ]);
  assert.equal(responses.length, 4);
  for (const response of responses.slice(0, 2)) {
    assert.equal(response.requestId, "");
    assert.equal(response.operation, "bridge");
    assert.equal(response.failure.rawCode, "unexpected_error");
    assert.equal(response.failure.message.includes("SYNTHETIC_"), false);
    assert.equal(response.failure.message.includes(marker), false);
  }
  assert.equal(responses[2].requestId, "valid-after-malformed");
  assert.equal(responses[2].failure.rawCode, "invalid_orchestrator_operation");
  assert.equal(responses[3].requestId, "post-parse-error");
  assert.equal(responses[3].failure.rawCode, "operation_cancelled");
  assert.equal(responses[3].failure.message, "Dependency repair requires explicit confirmation.");
});

test("Host bridge rejects an oversized unterminated frame without dispatching it, then recovers", async () => {
  const marker = "SYNTHETIC_OVERSIZED_HOST_REQUEST";
  const child = spawn(process.execPath, [cliPath, "--workspace-root", path.resolve(os.tmpdir())], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  // This request must be rejected by byte receipt, not after JSON parsing.
  child.stdin.write(`{"requestId":"oversized","operation":"unsupportedOperation","padding":"${marker}${"x".repeat(1_100_000)}"}`);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(stdout, "", "No response until the oversized frame's delimiter");
  child.stdin.end(`\r\n${JSON.stringify({ requestId: "safe-next", operation: "unsupportedOperation" })}\r\n`);
  const [code] = await once(child, "close");
  assert.equal(code, 0, `Host bridge exited unexpectedly: ${stderr}`);
  const responses = stdout.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(responses.length, 2);
  assert.equal(responses[0].requestId, "");
  assert.equal(responses[0].operation, "bridge");
  assert.equal(responses[0].failure.rawCode, "invalid_host_request");
  assert.equal(responses[0].failure.message, "Host bridge request is too large.");
  assert.equal(stdout.includes(marker), false);
  assert.equal(responses[1].requestId, "safe-next");
  assert.equal(responses[1].failure.rawCode, "invalid_orchestrator_operation");
});

test("Host bridge measures UTF-8 bytes, handles CRLF and EOF without newline", async () => {
  const multibyte = "가".repeat(400_000); // >1 MiB of UTF-8 but <1 MiB characters.
  const responses = await runBridge([
    JSON.stringify({ requestId: "utf8-large", operation: "unsupportedOperation", padding: multibyte }),
    JSON.stringify({ requestId: "after-large", operation: "unsupportedOperation" }),
  ]);
  assert.equal(responses.length, 2);
  assert.equal(responses[0].failure.rawCode, "invalid_host_request");
  assert.equal(responses[1].requestId, "after-large");
  const child = spawn(process.execPath, [cliPath, "--workspace-root", path.resolve(os.tmpdir())], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stdin.end(`${JSON.stringify({ requestId: "crlf", operation: "unsupportedOperation" })}\r\n${JSON.stringify({ requestId: "eof", operation: "unsupportedOperation" })}`);
  const [code] = await once(child, "close");
  assert.equal(code, 0);
  assert.deepEqual(stdout.trim().split("\n").map((line) => JSON.parse(line).requestId), ["crlf", "eof"]);
});

test("Host bridge accepts exactly 1 MiB of request bytes, rejects one extra byte, and preserves burst order", async () => {
  const prefix = '{"requestId":"boundary","operation":"unsupportedOperation","padding":"';
  const suffix = '"}';
  const exact = `${prefix}${"x".repeat(1_048_576 - Buffer.byteLength(prefix + suffix))}${suffix}`;
  assert.equal(Buffer.byteLength(exact), 1_048_576);
  const requests = [exact, `${exact.slice(0, -2)}x"}`];
  for (let index = 0; index < 100; index++) {
    requests.push(JSON.stringify({ requestId: `burst-${index}`, operation: "unsupportedOperation" }));
  }
  const responses = await runBridge(requests);
  assert.equal(responses.length, 102);
  assert.equal(responses[0].requestId, "boundary");
  assert.equal(responses[0].failure.rawCode, "invalid_orchestrator_operation");
  assert.equal(responses[1].requestId, "");
  assert.equal(responses[1].failure.rawCode, "invalid_host_request");
  assert.deepEqual(responses.slice(2).map((response) => response.requestId),
    Array.from({ length: 100 }, (_, index) => `burst-${index}`));
});

test("Host bridge preserves literal Unicode line separators inside a JSON string", async () => {
  // JSON permits U+2028/U+2029 in strings. They are not NDJSON frame delimiters;
  // readline used to split at these characters and corrupt an otherwise valid request.
  const requestId = "synthetic\u2028line\u2029separator";
  const first = JSON.stringify({
    requestId,
    operation: "unsupportedOperation",
    arguments: { launchSettingsPath: "synthetic\u2028folder\u2029scene" },
  });
  assert.ok(first.includes("\u2028") && first.includes("\u2029"));
  const responses = await runBridge([
    first,
    JSON.stringify({ requestId: "after-unicode", operation: "unsupportedOperation" }),
  ]);
  assert.deepEqual(responses.map((response) => response.requestId), [requestId, "after-unicode"]);
  assert.ok(responses.every((response) => response.failure.rawCode === "invalid_orchestrator_operation"));
});

test("Host bridge terminates cleanly on SIGTERM while stdin remains open", { skip: process.platform === "win32" }, async () => {
  const child = spawn(process.execPath, [cliPath, "--workspace-root", path.resolve(os.tmpdir())], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const response = once(child.stdout, "data");
  child.stdin.write(`${JSON.stringify({ requestId: "before-signal", operation: "unsupportedOperation" })}\n`);
  assert.equal(JSON.parse(String((await response)[0])).requestId, "before-signal");
  child.kill("SIGTERM");
  const [code, signal] = await once(child, "close");
  assert.equal(code, 0);
  assert.equal(signal, null);
});

test("Host bridge preserves split UTF-8 bytes and CRLF across separate writes", async () => {
  const child = spawn(process.execPath, [cliPath, "--workspace-root", path.resolve(os.tmpdir())], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });

  const first = Buffer.from(JSON.stringify({
    requestId: "split-unicode-😀", operation: "unsupportedOperation", padding: "한😀",
  }));
  const emojiOffset = first.indexOf(Buffer.from("😀"));
  assert.ok(emojiOffset > 0);
  const firstResponse = once(child.stdout, "data");
  child.stdin.write(first.subarray(0, emojiOffset + 2));
  await new Promise((resolve) => setImmediate(resolve));
  child.stdin.write(first.subarray(emojiOffset + 2));
  child.stdin.write("\r");
  await firstResponse;
  assert.equal(JSON.parse(stdout.trim()).requestId, "split-unicode-😀");

  // The LF arrives only after the first CR-terminated response, proving that
  // it must not create a phantom empty frame when the next request begins.
  child.stdin.end(`\n${JSON.stringify({ requestId: "after-split-crlf", operation: "unsupportedOperation" })}\r\n`);
  const [code] = await once(child, "close");
  assert.equal(code, 0, `Host bridge exited unexpectedly: ${stderr}`);
  const responses = stdout.trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(responses.map((response) => response.requestId), ["split-unicode-😀", "after-split-crlf"]);
  assert.ok(responses.every((response) => response.failure.rawCode === "invalid_orchestrator_operation"));
});

// The raw async iterable yields exact byte boundaries; unlike subprocess
// writes, they cannot be merged into one read by the OS pipe scheduler.
test("Host byte decoder reconstructs an emoji split inside UTF-8 requestId", async () => {
  const requestId = "synthetic-😀-id";
  const bytes = Buffer.from(JSON.stringify({
    requestId, operation: "unsupportedOperation", padding: "한글",
  }) + "\r\n");
  const emojiStart = bytes.indexOf(Buffer.from("😀"));
  assert(emojiStart > 0);
  async function* exactChunks() {
    yield bytes.subarray(0, emojiStart + 1);
    yield bytes.subarray(emojiStart + 1, emojiStart + 3);
    yield bytes.subarray(emojiStart + 3, bytes.length - 1);
    yield bytes.subarray(bytes.length - 1);
  }
  const frames = [];
  for await (const frame of readFrames(exactChunks())) frames.push(frame);
  assert.equal(frames.length, 1);
  assert.equal(JSON.parse(frames[0].line).requestId, requestId);
  assert.equal(JSON.parse(frames[0].line).padding, "한글");
});

test("Host shutdown cancels already-buffered follow-up commands without starting them", async () => {
  const input = new PassThrough();
  let shuttingDown = false;
  let releaseFirst;
  let startedFirst;
  const firstStarted = new Promise(resolve => { startedFirst = resolve; });
  const firstFinished = new Promise(resolve => { releaseFirst = resolve; });
  const executed = [], cancelled = [];
  const running = drainBufferedHostFrames(input, {
    isShuttingDown: () => shuttingDown,
    dispatchFrame: async frame => {
      executed.push(JSON.parse(frame.line).requestId);
      startedFirst();
      await firstFinished;
    },
    cancelFrame: frame => cancelled.push(cancelledHostFrame(frame)),
  });
  // Both follow-up commands have been received in the same exact chunk;
  // the input stays open like an interactive Unity Host pipe.
  input.write([
    JSON.stringify({requestId:"first",operation:"planHost"}),
    JSON.stringify({requestId:"followup",operation:"health"}),
    JSON.stringify({requestId:"third",operation:"stop"}),
    "",
  ].join("\n"));
  try {
    await firstStarted;
    shuttingDown = true; // Equivalent to SIGTERM while the first request is active.
    releaseFirst();
    let timer;
    try {
      await Promise.race([
        running,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Host awaited stdin EOF after shutdown")), 1500);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    assert.deepEqual(executed, ["first"], "No new Host operations after shutdown");
    assert.deepEqual(cancelled.map(frame=>frame.requestId), ["followup","third"]);
    assert(cancelled.every(frame => frame.failure.rawCode === "operation_cancelled"));
    assert(cancelled.every(frame => frame.failure.message === "Host bridge is stopping."));
  } finally {
    shuttingDown = true;
    releaseFirst();
    input.destroy();
  }
});

// A second physical stdin chunk can be buffered while the first request runs.
// Capture the readable byte count at shutdown: late bytes must not enter the
// cancellation response set or prolong termination.
test("Host shutdown drains separate pre-signal stdin chunks and preserves long request IDs", async () => {
  const input = new PassThrough();
  let stop = false, snapshotBytes = 0;
  let startedFirst, finishFirst;
  const started = new Promise(resolve => { startedFirst = resolve; });
  const pending = new Promise(resolve => { finishFirst = resolve; });
  const processed = [], cancelled = [];
  const running = drainBufferedHostFrames(input, {
    isShuttingDown: () => stop,
    bufferedBytesAtShutdown: () => snapshotBytes,
    dispatchFrame: async frame => {
      processed.push(JSON.parse(frame.line).requestId);
      startedFirst();
      await pending;
    },
    cancelFrame: frame => cancelled.push(cancelledHostFrame(frame)),
  });
  const longId = "r".repeat(129);
  input.write(JSON.stringify({requestId:"slow",operation:"planHost"}) + "\n");
  try {
    await started;
    input.write(JSON.stringify({requestId:longId,operation:"health"}) + "\n");
    snapshotBytes = input.readableLength;
    assert(snapshotBytes > 0, "follow-up must actually be buffered");
    stop = true;
    input.write(JSON.stringify({requestId:"too-late",operation:"stop"}) + "\n");
    finishFirst();
    let timer;
    try {
      await Promise.race([
        running,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Host waited for stdin EOF after shutdown")), 1500);
        }),
      ]);
    } finally { clearTimeout(timer); }
    assert.deepEqual(processed, ["slow"]);
    assert.deepEqual(cancelled.map(frame => frame.requestId), [longId]);
    assert.equal(cancelled[0].failure.rawCode, "operation_cancelled");
  } finally {
    stop = true;
    finishFirst();
    input.destroy();
  }
});
