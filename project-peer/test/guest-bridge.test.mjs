import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough, Readable } from "node:stream";
import { TeamForgePeerError } from "../src/errors.mjs";
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

const tick = () => new Promise((resolve) => setImmediate(resolve));
const startFrame = (id) => ({
  id,
  type: "start",
  invite: "{}",
  managedRoot: "synthetic-managed-root",
  stateRoot: "synthetic-state-root",
});

class ControlledGuest extends EventEmitter {
  active = false;
  calls = 0;
  async start() {
    this.calls++;
    if (this.active) {
      throw new TeamForgePeerError("guest_operation_busy", "Another Guest receive operation is already running.");
    }
    this.active = { operationId: `controlled-${this.calls}` };
    if (this.calls === 1) {
      return new Promise((resolve) => {
        this.finishFirst = () => { this.active = false; resolve({ run: 1 }); };
      });
    }
    this.active = false;
    return { run: this.calls };
  }
  cancel() { return { accepted: true, state: "Idle" }; }
}

test("Guest bridge preserves first start event ownership when another start is rejected", async () => {
  const orchestrator = new ControlledGuest();
  const input = new PassThrough();
  const output = new PassThrough();
  let stdout = "";
  output.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  const running = runGuestBridge({ input, output, orchestrator });
  const send = (frame) => input.write(`${JSON.stringify(frame)}\n`);

  send(startFrame("first"));
  await tick();
  send(startFrame("second"));
  await tick();
  // Event from the first transfer after the second request was rejected.
  orchestrator.emit("guestEvent", { operationId: "controlled-1", event: "progress", state: "Receiving" });
  orchestrator.finishFirst();
  await tick();
  send(startFrame("third"));
  input.end();
  await running;

  const frames = stdout.trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(frames.filter((frame) => frame.event === "progress").map((frame) => frame.id), ["first"]);
  assert.equal(frames.find((frame) => frame.id === "second")?.error?.code, "guest_operation_busy");
  assert.equal(frames.find((frame) => frame.id === "first" && frame.event === "complete")?.result?.run, 1);
  assert.equal(frames.find((frame) => frame.id === "third" && frame.event === "complete")?.result?.run, 2);
  assert.equal(orchestrator.calls, 2, "Rejected second start must not reach the shared orchestrator");
});

test("Guest bridge drops late events from a finished receive when a new receive is active", async () => {
  class SequentialGuest extends EventEmitter {
    active = null;
    starts = 0;
    start() {
      const run = ++this.starts;
      this.active = { operationId: `controlled-${run}` };
      return new Promise((resolve) => {
        this.finish = () => { this.active = null; resolve({ run }); };
      });
    }
    cancel() { return { accepted: true, state: "Idle" }; }
  }
  const orchestrator = new SequentialGuest();
  const input = new PassThrough();
  const output = new PassThrough();
  let stdout = "";
  output.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  const running = runGuestBridge({ input, output, orchestrator });
  const send = (frame) => input.write(`${JSON.stringify(frame)}\n`);

  send(startFrame("first"));
  await tick();
  orchestrator.finish();
  await tick();

  send(startFrame("second"));
  await tick();
  orchestrator.emit("guestEvent", { operationId: "controlled-1", event: "progress", state: "Stale" });
  orchestrator.emit("guestEvent", { event: "progress", state: "MissingOwner" });
  orchestrator.emit("guestEvent", { operationId: "controlled-2", event: "progress", state: "Receiving" });
  orchestrator.finish();
  await tick();
  input.end();
  await running;

  const frames = stdout.trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(
    frames.filter((frame) => frame.event === "progress").map(({ id, state }) => ({ id, state })),
    [{ id: "second", state: "Receiving" }],
  );
  assert.equal(frames.find((frame) => frame.id === "first" && frame.event === "complete")?.result?.run, 1);
  assert.equal(frames.find((frame) => frame.id === "second" && frame.event === "complete")?.result?.run, 2);
});

test("Guest bridge keeps raw Unicode line separators inside one valid JSON request", async () => {
  class InspectGuest extends EventEmitter {
    async inspect({ invite }) { return { invite }; }
    cancel() { return { accepted: true }; }
  }
  const invite = "before\u2028middle\u2029after";
  const request = JSON.stringify({ id: "unicode", type: "inspect", invite, managedRoot: "m", stateRoot: "s" });
  const input = Readable.from([`${request}\n`, '{"id":"shutdown","type":"shutdown"}\n']);
  const output = new PassThrough();
  let stdout = "";
  output.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  await runGuestBridge({ input, output, orchestrator: new InspectGuest() });
  const frames = stdout.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(frames.filter((frame) => frame.id === "unicode").length, 1);
  assert.equal(frames.find((frame) => frame.id === "unicode")?.result?.invite, invite);
  assert.equal(frames.filter((frame) => frame.event === "error").length, 0);
});

test("Guest bridge discards oversized split UTF-8 input and accepts the next request at EOF", async () => {
  class IdleGuest extends EventEmitter {
    cancel() { return { accepted: true }; }
  }
  const output = new PassThrough();
  let stdout = "";
  output.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  const input = Readable.from([
    '{"id":"oversized","type":"health","synthetic":"',
    "가".repeat(400_000),
    '"}\r', '\n',
    '{"id":"next","type":"health"}',
  ]);
  await runGuestBridge({ input, output, orchestrator: new IdleGuest() });
  const frames = stdout.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(frames.length, 2);
  assert.equal(frames[0].id, "");
  assert.equal(frames[0].error.code, "invalid_guest_request");
  assert.equal(frames[1].id, "next");
  assert.equal(frames[1].result.ready, true);
});

test("Guest bridge shutdown completes without waiting for an open stdin to end", async () => {
  class IdleGuest extends EventEmitter {
    cancel() { return { accepted: true }; }
  }
  const input = new PassThrough();
  const output = new PassThrough();
  let stdout = "";
  output.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  const running = runGuestBridge({ input, output, orchestrator: new IdleGuest() });
  input.write('{"id":"shutdown-now","type":"shutdown"}\n');
  let timer;
  try {
    await Promise.race([
      running,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("shutdown waited for EOF")), 1500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    input.destroy();
  }
  assert.equal(JSON.parse(stdout.trim()).id, "shutdown-now");
});

test("Guest bridge processes cancel while an earlier receive is still pending", async () => {
  const orchestrator = new ControlledGuest();
  const input = new PassThrough();
  const output = new PassThrough();
  let stdout = "";
  output.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  const running = runGuestBridge({ input, output, orchestrator });
  input.write(JSON.stringify(startFrame("receive")) + "\n");
  await tick();
  input.write('{"id":"cancel-now","type":"cancel"}\n');
  await tick();
  assert.equal(stdout.includes('"id":"cancel-now"'), true);
  orchestrator.finishFirst();
  input.end();
  await running;
  const frames = stdout.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(frames.find((frame) => frame.id === "cancel-now")?.event, "complete");
  assert.equal(frames.find((frame) => frame.id === "receive")?.event, "complete");
});

test("Guest bridge accepts exactly 1 MiB and rejects one byte beyond the frame budget", async () => {
  class InspectGuest extends EventEmitter {
    async inspect({ invite }) { return { length: invite.length }; }
    cancel() { return { accepted: true }; }
  }
  const base = { id: "boundary", type: "inspect", invite: "", managedRoot: "m", stateRoot: "s" };
  const remaining = 1_048_576 - Buffer.byteLength(JSON.stringify(base), "utf8");
  const exact = JSON.stringify({ ...base, invite: "x".repeat(remaining) });
  assert.equal(Buffer.byteLength(exact, "utf8"), 1_048_576);
  const over = JSON.stringify({ ...base, invite: "x".repeat(remaining + 1) });
  const output = new PassThrough();
  let stdout = "";
  output.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  await runGuestBridge({
    input: Readable.from([exact + "\n", over + "\n", '{"id":"after","type":"health"}\n']),
    output,
    orchestrator: new InspectGuest(),
  });
  const frames = stdout.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(frames.length, 3);
  assert.equal(frames[0].id, "boundary");
  assert.equal(frames[0].result.length, remaining);
  assert.equal(frames[1].id, "");
  assert.equal(frames[1].error.code, "invalid_guest_request");
  assert.equal(frames[2].id, "after");
  assert.equal(frames[2].result.ready, true);
});
