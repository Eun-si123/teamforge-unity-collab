#!/usr/bin/env node
// Bounded NDJSON bridge between the Unity Host UX and Project Peer orchestration.
// Requests are deliberately serialized through `chain`: planning/commit/stop
// operations may share one orchestrator and must not race each other. This file
// dispatches operations; trust, transfer, and activation rules live downstream.
import path from "node:path";
import process from "node:process";
import { inspectPreflight, repairDependencies } from "./unified-preflight.mjs";

const workspaceIndex = process.argv.indexOf("--workspace-root");
const workspaceRoot = workspaceIndex >= 0 ? path.resolve(process.argv[workspaceIndex + 1] ?? "") : "";
let orchestrator = null;
// The Unity Host request is metadata, never Project bytes. The 1 MiB ceiling
// leaves substantial room for long local paths; physical Unity request sizes
// must still be measured before this candidate is merged.
const MAXIMUM_FRAME_BYTES = 1_048_576;
let active = Promise.resolve();
let shuttingDown = false;
let shutdownPromise = null;

function write(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function dispatch(request) {
  const requestId = typeof request?.requestId === "string" ? request.requestId : "";
  let result;
  switch (request?.operation) {
    case "inspect":
      result = await inspectPreflight({
        workspaceRoot,
        ...(request.arguments?.launchSettingsPath
          ? { launchSettingsPath: request.arguments.launchSettingsPath }
          : {}),
        serverPort: 0,
        seedPort: 0,
      });
      break;
    case "repairDependencies":
      // Dependency repair mutates local development state. Keep an explicit
      // confirmation bit at the bridge boundary instead of inferring consent.
      if (request.arguments?.confirmed !== true) {
        throw Object.assign(new Error("Dependency repair requires explicit confirmation."), {
          code: "operation_cancelled",
        });
      }
      result = await repairDependencies({
        workspaceRoot,
        confirmRepair: true,
        serverPort: 0,
        seedPort: 0,
      });
      break;
    case "planHost":
      result = await (await host()).planHost(request.arguments ?? {});
      break;
    case "commitHost":
      result = await (await host()).commitHost(request.arguments ?? {});
      break;
    case "health":
      result = await (await host()).health();
      break;
    case "stop":
      result = orchestrator ? await orchestrator.stop() : {
        apiVersion: 1,
        operation: "stop",
        state: "idle",
        stopped: [],
      };
      break;
    default:
      result = {
        apiVersion: 1,
        operation: String(request?.operation ?? ""),
        state: "needs_action",
        failure: {
          kind: "unexpected",
          rawCode: "invalid_orchestrator_operation",
          message: "Unknown Host orchestrator operation.",
          recoverable: false,
          action: "export_diagnostics",
        },
      };
      break;
  }
  write({ requestId, ...result });
}

async function host() {
  if (!orchestrator) {
    // Lazy import keeps simple inspect/repair operations from constructing the
    // long-lived Host orchestration machinery unless it is actually needed.
    const { TeamForgeHostOrchestrator } = await import("./host-orchestrator.mjs");
    orchestrator = new TeamForgeHostOrchestrator({ workspaceRoot });
  }
  return orchestrator;
}

// Read bytes, not readline's unbounded completed lines. Discard oversized
// frames until their delimiter, then resume at the next frame. Awaiting each
// dispatch before pulling the next chunk applies stream backpressure instead
// of retaining a growing queue of captured request strings.
async function* readFrames(input) {
  // Reuse one fixed-size buffer rather than retaining many incoming chunks.
  const frameBuffer = Buffer.alloc(MAXIMUM_FRAME_BYTES);
  let bytes = 0;
  let oversized = false;
  let skipLineFeed = false;
  for await (const value of input) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    if (chunk.length === 0) continue;
    let cursor = 0;
    if (skipLineFeed) {
      if (chunk[0] === 10) cursor = 1;
      skipLineFeed = false;
    }
    while (cursor < chunk.length) {
      let end = cursor;
      while (end < chunk.length && chunk[end] !== 10 && chunk[end] !== 13) end++;
      if (!oversized) {
        const length = end - cursor;
        if (bytes + length > MAXIMUM_FRAME_BYTES) {
          bytes = 0;
          oversized = true;
        } else if (length) {
          chunk.copy(frameBuffer, bytes, cursor, end);
          bytes += length;
        }
      }
      if (end === chunk.length) break;
      const isCarriageReturn = chunk[end] === 13;
      yield oversized
        ? { oversized: true }
        : { line: frameBuffer.toString("utf8", 0, bytes) };
      bytes = 0;
      oversized = false;
      cursor = end + 1;
      if (isCarriageReturn) {
        if (cursor < chunk.length && chunk[cursor] === 10) cursor++;
        else if (cursor === chunk.length) skipLineFeed = true;
      }
    }
  }
  if (oversized) yield { oversized: true };
  else if (bytes > 0) yield { line: frameBuffer.toString("utf8", 0, bytes) };
}

async function handleFrame(frame) {
  let request = null;
  try {
    if (frame.oversized) {
      throw Object.assign(new Error("Host bridge request is too large."), {
        code: "invalid_host_request",
      });
    }
    try {
      request = JSON.parse(frame.line);
    } catch {
      // V8 SyntaxError messages can contain request bytes (including secrets).
      // Keep the existing bridge error code/shape without echoing input.
      throw new SyntaxError("Invalid Host bridge JSON.");
    }
    await dispatch(request);
  } catch (error) {
    write({
      requestId: typeof request?.requestId === "string" ? request.requestId : "",
      apiVersion: 1,
      operation: "bridge",
      state: "needs_action",
      failure: {
        kind: "unexpected",
        rawCode: error.code ?? "unexpected_error",
        message: error.message,
        recoverable: false,
        action: "export_diagnostics",
      },
    });
  }
}

function shutdown() {
  if (!shutdownPromise) {
    shuttingDown = true;
    shutdownPromise = (async () => {
      await active.catch(() => {});
      if (orchestrator) await orchestrator.stop().catch(() => {});
    })();
  }
  return shutdownPromise;
}

async function serve() {
  try {
    for await (const frame of readFrames(process.stdin)) {
      if (shuttingDown) break;
      active = handleFrame(frame);
      await active;
    }
  } catch (error) {
    if (!shuttingDown) {
      process.stderr.write(`TeamForge Host bridge stopped: ${error?.code ?? "host_bridge_failed"}\n`);
      process.exitCode = 1;
    }
  } finally {
    await shutdown();
  }
}

void serve();
process.once("SIGINT", () => { void shutdown(); process.stdin.destroy(); });
process.once("SIGTERM", () => { void shutdown(); process.stdin.destroy(); });
