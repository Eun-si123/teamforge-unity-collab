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
