#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeOrchestratorFailure } from "./orchestrator-contract.mjs";
import { inspectPreflight, repairDependencies } from "./unified-preflight.mjs";

const VALUE_OPTIONS = new Set([
  "workspace-root",
  "launch-settings",
  "project-root",
  "managed-root",
  "server-host",
  "server-port",
  "seed-host",
  "seed-port",
  "timeout-ms",
]);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function integer(value, name, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    fail("invalid_preflight_option", `${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

export function parsePreflightArguments(argv) {
  const command = argv[0];
  if (command !== "inspect" && command !== "repair-dependencies") {
    fail("invalid_preflight_command", "Use inspect or repair-dependencies.");
  }
  const raw = {};
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--confirm-repair") {
      raw.confirmRepair = true;
      continue;
    }
    if (!token.startsWith("--") || !VALUE_OPTIONS.has(token.slice(2))) {
      fail("invalid_preflight_option", `Unknown preflight option: ${token}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail("invalid_preflight_option", `${token} requires a value.`);
    }
    raw[token.slice(2)] = value;
    index += 1;
  }
  if (command === "inspect" && raw.confirmRepair) {
    fail("invalid_preflight_option", "--confirm-repair is valid only for repair-dependencies.");
  }
  const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  return {
    command,
    options: {
      workspaceRoot: path.resolve(raw["workspace-root"] ?? moduleRoot),
      launchSettingsPath: raw["launch-settings"] ? path.resolve(raw["launch-settings"]) : undefined,
      projectRoot: raw["project-root"] ? path.resolve(raw["project-root"]) : undefined,
      managedRoot: raw["managed-root"] ? path.resolve(raw["managed-root"]) : undefined,
      serverHost: raw["server-host"],
      serverPort: raw["server-port"] === undefined
        ? undefined
        : integer(raw["server-port"], "--server-port", 1, 65_535),
      seedHost: raw["seed-host"],
      seedPort: raw["seed-port"] === undefined
        ? undefined
        : integer(raw["seed-port"], "--seed-port", 0, 65_535),
      timeoutMilliseconds: raw["timeout-ms"] === undefined
        ? undefined
        : integer(raw["timeout-ms"], "--timeout-ms", 50, 10_000),
      confirmRepair: raw.confirmRepair === true,
    },
  };
}

async function main() {
  try {
    const parsed = parsePreflightArguments(process.argv.slice(2));
    const result = parsed.command === "inspect"
      ? await inspectPreflight(parsed.options)
      : await repairDependencies(parsed.options);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.state === "idle" ? 0 : 2;
  } catch (error) {
    console.log(JSON.stringify({
      apiVersion: 1,
      operation: "preflight",
      state: "failed",
      failure: normalizeOrchestratorFailure(error),
    }, null, 2));
    process.exitCode = 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
