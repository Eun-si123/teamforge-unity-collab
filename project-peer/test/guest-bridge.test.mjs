import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough, Readable } from "node:stream";
import { runGuestBridge } from "../src/guest-orchestrator-cli.mjs";

async function bridgeFrames(lines, orchestrator = undefined) {
  const output = new PassThrough();
  let text = "";
  output.on("data", (chunk) => { text += chunk.toString("utf8"); });
  await runGuestBridge({
    input: Readable.from(lines.map((line) => `${JSON.stringify(line)}\n`)),
    output,
    ...(orchestrator ? { orchestrator } : {}),
  });
  return text.trim().split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
}

test("Guest bridge health is read-only and reports bundled-only runtime strategy", async () => {
  const frames = await bridgeFrames([
    { id: "health-1", type: "health" },
    { id: "shutdown-1", type: "shutdown" },
  ]);
  const health = frames.find((frame) => frame.id === "health-1");
  assert.equal(health.event, "complete");
  assert.deepEqual(health.result, {
    ready: true,
    bridge: "teamforge-guest-bridge-v1",
    productVersion: "0.5.1",
    backend: "project-peer",
    runtimeStrategy: "bundled-verified-only",
  });
});

test("Guest bridge never echoes the stdin-only authentication token in terminal diagnostics", async () => {
  const secret = "access-token-must-not-leak";
  class FailingOrchestrator extends EventEmitter {
    async start({ authenticationToken }) {
      const error = new Error(`Server rejected ${authenticationToken}`);
      error.code = "coordinator_error";
      throw error;
    }
    cancel() { return { accepted: true, state: "Idle" }; }
  }
  const frames = await bridgeFrames([
    {
      id: "start-1",
      type: "start",
      invite: "{}",
      managedRoot: "C:\\Projects",
      stateRoot: "C:\\State",
      authenticationToken: secret,
    },
    { id: "shutdown-1", type: "shutdown" },
  ], new FailingOrchestrator());
  const terminal = frames.find((frame) => frame.id === "start-1" && frame.event === "error");
  assert(terminal);
  assert.equal(JSON.stringify(terminal).includes(secret), false);
  assert.match(terminal.error.technicalDetail, /\[redacted\]/u);
  assert.deepEqual(Object.keys(terminal.error).sort(), [
    "code", "diagnostics", "recoveryAction", "technicalDetail", "userMessage",
  ]);
});
