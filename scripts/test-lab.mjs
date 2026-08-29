import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const configPath = path.join(repoRoot, "test-lab.json");
const maxLogBytes = 2 * 1024 * 1024;

function fail(message) {
  throw new Error(message);
}

function loadConfig() {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (config.schemaVersion !== 1) fail(`Unsupported test-lab schemaVersion: ${config.schemaVersion}`);
  if (!config.scenarios || typeof config.scenarios !== "object" || Array.isArray(config.scenarios)) {
    fail("test-lab.json must contain a scenarios object.");
  }
  return config;
}

function validateConfig(config) {
  const ids = Object.keys(config.scenarios);
  if (ids.length === 0) fail("Test Lab must define at least one scenario.");

  for (const [scenarioId, scenario] of Object.entries(config.scenarios)) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(scenarioId)) fail(`Invalid scenario id: ${scenarioId}`);
    if (!scenario || typeof scenario !== "object") fail(`Scenario ${scenarioId} must be an object.`);
    if (typeof scenario.description !== "string" || scenario.description.trim().length === 0) {
      fail(`Scenario ${scenarioId} requires a description.`);
    }
    if (scenario.includes !== undefined && (!Array.isArray(scenario.includes) || scenario.includes.some((id) => typeof id !== "string"))) {
      fail(`Scenario ${scenarioId}.includes must be a string array.`);
    }
    if (!Array.isArray(scenario.steps)) fail(`Scenario ${scenarioId}.steps must be an array.`);

    const localStepIds = new Set();
    for (const step of scenario.steps) {
      if (!step || typeof step !== "object") fail(`Scenario ${scenarioId} contains an invalid step.`);
      if (typeof step.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(step.id)) {
        fail(`Scenario ${scenarioId} contains an invalid step id.`);
      }
      if (localStepIds.has(step.id)) fail(`Scenario ${scenarioId} duplicates step id ${step.id}.`);
      localStepIds.add(step.id);

      if (step.kind === "command") {
        if (typeof step.command !== "string" || step.command.length === 0) fail(`Command step ${scenarioId}/${step.id} requires command.`);
        if (!Array.isArray(step.args) || step.args.some((arg) => typeof arg !== "string")) {
          fail(`Command step ${scenarioId}/${step.id} requires a string args array.`);
        }
      } else if (step.kind === "external" || step.kind === "manual") {
        if (typeof step.reference !== "string" || step.reference.length === 0) fail(`${step.kind} step ${scenarioId}/${step.id} requires reference.`);
        if (typeof step.reason !== "string" || step.reason.length === 0) fail(`${step.kind} step ${scenarioId}/${step.id} requires reason.`);
        const referencePath = path.resolve(repoRoot, step.reference);
        if (!fs.existsSync(referencePath)) fail(`${step.kind} step ${scenarioId}/${step.id} references missing path: ${step.reference}`);
      } else {
        fail(`Scenario ${scenarioId}/${step.id} has unsupported kind: ${step.kind}`);
      }
    }
  }

  for (const scenarioId of ids) {
    expandScenario(config, scenarioId, []);
  }
}

function expandScenario(config, scenarioId, stack) {
  const scenario = config.scenarios[scenarioId];
  if (!scenario) fail(`Unknown Test Lab scenario: ${scenarioId}`);
  if (stack.includes(scenarioId)) fail(`Test Lab include cycle: ${[...stack, scenarioId].join(" -> ")}`);

  const expanded = [];
  for (const includeId of scenario.includes ?? []) {
    if (!config.scenarios[includeId]) fail(`Scenario ${scenarioId} includes unknown scenario ${includeId}.`);
    expanded.push(...expandScenario(config, includeId, [...stack, scenarioId]));
  }
  expanded.push(...scenario.steps.map((step) => ({ ...step, ownerScenario: scenarioId })));

  const seen = new Set();
  for (const step of expanded) {
    if (seen.has(step.id)) fail(`Expanded scenario ${scenarioId} duplicates step id ${step.id}.`);
    seen.add(step.id);
  }
  return expanded;
}

function resolveExecutable(command) {
  if (process.platform === "win32" && command.toLowerCase() === "npm") return "npm.cmd";
  return command;
}

function compactTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function displayCommand(step) {
  return [step.command, ...step.args].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" ");
}

function printPlan(config, scenarioId) {
  const scenario = config.scenarios[scenarioId];
  if (!scenario) fail(`Unknown Test Lab scenario: ${scenarioId}`);
  const steps = expandScenario(config, scenarioId, []);
  console.log(`Test Lab scenario: ${scenarioId}`);
  console.log(scenario.description);
  console.log("");
  for (const [index, step] of steps.entries()) {
    if (step.kind === "command") {
      console.log(`${index + 1}. [command] ${step.id}: ${displayCommand(step)}`);
    } else {
      console.log(`${index + 1}. [${step.kind}] ${step.id}: ${step.reference}`);
      console.log(`   ${step.reason}`);
    }
  }
  if (steps.length === 0) console.log("(no steps)");
}

async function runCommandStep(step, directory, keepLogs) {
  const startedAt = new Date();
  const logPath = path.join(directory, `${step.id}.log`);
  const writer = fs.createWriteStream(logPath, { encoding: "utf8", flags: "wx" });
  let writtenBytes = 0;
  let truncated = false;

  function record(chunk, target) {
    target.write(chunk);
    if (truncated) return;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = maxLogBytes - writtenBytes;
    if (remaining <= 0) {
      truncated = true;
      writer.write("\n[TeamForge Test Lab: log truncated at 2 MiB]\n");
      return;
    }
    const slice = buffer.length <= remaining ? buffer : buffer.subarray(0, remaining);
    writer.write(slice);
    writtenBytes += slice.length;
    if (slice.length < buffer.length) {
      truncated = true;
      writer.write("\n[TeamForge Test Lab: log truncated at 2 MiB]\n");
    }
  }

  console.log(`\n=== ${step.id} ===`);
  console.log(`$ ${displayCommand(step)}`);

  const result = await new Promise((resolve) => {
    let spawnError = null;
    const child = spawn(resolveExecutable(step.command), step.args, {
      cwd: repoRoot,
      env: process.env,
      shell: false,
      windowsHide: true,
      stdio: ["inherit", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => record(chunk, process.stdout));
    child.stderr.on("data", (chunk) => record(chunk, process.stderr));
    child.on("error", (error) => {
      spawnError = error;
      const message = `\n[Test Lab could not start command: ${error.message}]\n`;
      record(Buffer.from(message), process.stderr);
    });
    child.on("close", (code, signal) => {
      writer.end(() => resolve({ code, signal, spawnError }));
    });
  });

  const endedAt = new Date();
  const passed = !result.spawnError && result.code === 0;
  if (passed && !keepLogs) {
    fs.rmSync(logPath, { force: true });
  }

  return {
    id: step.id,
    ownerScenario: step.ownerScenario,
    kind: step.kind,
    command: step.command,
    args: step.args,
    status: passed ? "passed" : "failed",
    exitCode: result.code,
    signal: result.signal,
    spawnError: result.spawnError?.message ?? null,
    startedAtUtc: startedAt.toISOString(),
    endedAtUtc: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    logRetained: !passed || keepLogs,
    logFile: !passed || keepLogs ? path.basename(logPath) : null,
    logTruncated: truncated,
  };
}

async function runScenario(config, scenarioId, keepLogs) {
  const scenario = config.scenarios[scenarioId];
  if (!scenario) fail(`Unknown Test Lab scenario: ${scenarioId}`);
  const steps = expandScenario(config, scenarioId, []);
  const directory = path.join(repoRoot, "test-results", "test-lab", `${compactTimestamp()}-${scenarioId}`);
  fs.mkdirSync(directory, { recursive: true });

  const startedAt = new Date();
  const results = [];
  let commandFailed = false;
  let incomplete = false;

  for (const step of steps) {
    if (commandFailed) {
      results.push({
        id: step.id,
        ownerScenario: step.ownerScenario,
        kind: step.kind,
        status: "not-run",
        reason: "A previous command step failed.",
      });
      continue;
    }

    if (step.kind === "command") {
      const result = await runCommandStep(step, directory, keepLogs);
      results.push(result);
      if (result.status !== "passed") commandFailed = true;
      continue;
    }

    incomplete = true;
    results.push({
      id: step.id,
      ownerScenario: step.ownerScenario,
      kind: step.kind,
      status: "not-run",
      reference: step.reference,
      reason: step.reason,
    });
    console.log(`\n=== ${step.id} ===`);
    console.log(`[${step.kind}] NOT RUN: ${step.reference}`);
    console.log(step.reason);
  }

  const endedAt = new Date();
  const status = commandFailed ? "failed" : incomplete ? "incomplete" : "passed";
  const summary = {
    schemaVersion: 1,
    scenario: scenarioId,
    description: scenario.description,
    status,
    startedAtUtc: startedAt.toISOString(),
    endedAtUtc: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    keepLogs,
    policy: {
      automaticRetries: false,
      passedCommandLogsRetainedByDefault: false,
      maximumRetainedLogBytesPerStep: maxLogBytes,
      externalOrManualStepsNeverCountAsPassed: true,
    },
    steps: results,
  };
  fs.writeFileSync(path.join(directory, "summary.json"), JSON.stringify(summary, null, 2) + "\n");

  console.log(`\nTest Lab result: ${status.toUpperCase()}`);
  console.log(`Evidence: ${path.relative(repoRoot, directory)}`);
  if (status === "incomplete") {
    console.log("External/manual evidence is still required. Test Lab intentionally does not convert those lanes into a PASS.");
  }

  process.exitCode = status === "passed" ? 0 : status === "failed" ? 1 : 2;
}

function usage() {
  console.log("TeamForge Test Lab");
  console.log("");
  console.log("Usage:");
  console.log("  node scripts/test-lab.mjs list");
  console.log("  node scripts/test-lab.mjs plan <scenario>");
  console.log("  node scripts/test-lab.mjs run <scenario> [--keep-logs]");
  console.log("  node scripts/test-lab.mjs validate");
}

const config = loadConfig();
validateConfig(config);

const [command = "", scenarioId = "", ...rest] = process.argv.slice(2);
if (command === "validate") {
  console.log(`PASS Test Lab configuration (${Object.keys(config.scenarios).length} scenarios)`);
} else if (command === "list") {
  for (const [id, scenario] of Object.entries(config.scenarios)) {
    console.log(`${id.padEnd(18)} ${scenario.description}`);
  }
} else if (command === "plan") {
  if (!scenarioId) fail("plan requires a scenario id.");
  printPlan(config, scenarioId);
} else if (command === "run") {
  if (!scenarioId) fail("run requires a scenario id.");
  const unknown = rest.filter((arg) => arg !== "--keep-logs");
  if (unknown.length > 0) fail(`Unknown Test Lab option(s): ${unknown.join(", ")}`);
  await runScenario(config, scenarioId, rest.includes("--keep-logs"));
} else {
  usage();
  process.exitCode = command ? 1 : 0;
}
