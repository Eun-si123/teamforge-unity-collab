import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cliPath = fileURLToPath(new URL("../src/host-orchestrator-cli.mjs", import.meta.url));

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
    requestId: "split-unicode", operation: "unsupportedOperation", padding: "한😀",
  }));
  const emojiOffset = first.indexOf(Buffer.from("😀"));
  assert.ok(emojiOffset > 0);
  const firstResponse = once(child.stdout, "data");
  child.stdin.write(first.subarray(0, emojiOffset + 2));
  await new Promise((resolve) => setImmediate(resolve));
  child.stdin.write(first.subarray(emojiOffset + 2));
  child.stdin.write("\r");
  await firstResponse;
  assert.equal(JSON.parse(stdout.trim()).requestId, "split-unicode");

  // The LF arrives only after the first CR-terminated response, proving that
  // it must not create a phantom empty frame when the next request begins.
  child.stdin.end(`\n${JSON.stringify({ requestId: "after-split-crlf", operation: "unsupportedOperation" })}\r\n`);
  const [code] = await once(child, "close");
  assert.equal(code, 0, `Host bridge exited unexpectedly: ${stderr}`);
  const responses = stdout.trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(responses.map((response) => response.requestId), ["split-unicode", "after-split-crlf"]);
  assert.ok(responses.every((response) => response.failure.rawCode === "invalid_orchestrator_operation"));
});
