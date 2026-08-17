#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";
import { inspectPreflight, repairDependencies } from "./unified-preflight.mjs";

const workspaceIndex = process.argv.indexOf("--workspace-root");
const workspaceRoot = workspaceIndex >= 0 ? path.resolve(process.argv[workspaceIndex + 1] ?? "") : "";
let orchestrator = null;
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let chain = Promise.resolve();
let shuttingDown = false;

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
    const { TeamForgeHostOrchestrator } = await import("./host-orchestrator.mjs");
    orchestrator = new TeamForgeHostOrchestrator({ workspaceRoot });
  }
  return orchestrator;
}

input.on("line", (line) => {
  chain = chain.then(async () => {
    let request = null;
    try {
      request = JSON.parse(line);
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
  });
});

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await chain.catch(() => {});
  if (orchestrator) await orchestrator.stop().catch(() => {});
}

input.once("close", () => void shutdown().finally(() => { process.exitCode = 0; }));
process.once("SIGINT", () => void shutdown().finally(() => { process.exitCode = 0; }));
process.once("SIGTERM", () => void shutdown().finally(() => { process.exitCode = 0; }));
