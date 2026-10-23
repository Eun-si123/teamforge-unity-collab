import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(new URL("./test-lab.mjs", import.meta.url));

function executeFixture(scenarios, command = "validate", scenarioId = "") {
  const root = mkdtempSync(path.join(os.tmpdir(), "teamforge-testlab-"));
  try {
    mkdirSync(path.join(root, "scripts"));
    copyFileSync(runner, path.join(root, "scripts", "test-lab.mjs"));
    writeFileSync(path.join(root, "test-lab.json"), JSON.stringify({ schemaVersion: 1, scenarios }));
    const result = spawnSync(process.execPath, ["scripts/test-lab.mjs", command, ...(scenarioId ? [scenarioId] : [])], {
      cwd: root, encoding: "utf8", timeout: 10000,
    });
    const resultDir = path.join(root, "test-results", "test-lab");
    const folders = existsSync(resultDir) ? readdirSync(resultDir) : [];
    const summary = folders.length === 1
      ? JSON.parse(readFileSync(path.join(resultDir, folders[0], "summary.json"), "utf8"))
      : null;
    return { ...result, summary };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const empty = { empty: { description: "No evidence", steps: [] } };

test("validate rejects a scenario with zero expanded steps", () => {
  const result = executeFixture(empty);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Scenario empty must expand to at least one step/);
});

test("run cannot report PASS for a scenario with no steps", () => {
  const result = executeFixture(empty, "run", "empty");
  assert.notEqual(result.status, 0);
  assert.equal(result.summary, null);
  assert.doesNotMatch(result.stdout, /Test Lab result: PASSED/);
});

test("includes-only scenario inherits steps and still passes", () => {
  const scenarios = {
    base: {
      description: "A real command",
      steps: [{ id: "noop", kind: "command", command: process.execPath, args: ["-e", "process.exit(0)"] }],
    },
    aggregate: { description: "Included command", includes: ["base"], steps: [] },
  };
  const result = executeFixture(scenarios, "run", "aggregate");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.summary?.status, "passed");
  assert.equal(result.summary?.steps.length, 1);
  assert.equal(result.summary?.steps[0].status, "passed");
});

test("checked-in Test Lab configuration remains valid", () => {
  const root = path.resolve(path.dirname(runner), "..");
  const result = spawnSync(process.execPath, [runner, "validate"], {
    cwd: root, encoding: "utf8", timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS Test Lab configuration/);
});

test("parallel runs with identical timestamps preserve independent evidence", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "teamforge-testlab-parallel-"));
  try {
    mkdirSync(path.join(root, "scripts"));
    copyFileSync(runner, path.join(root, "scripts", "test-lab.mjs"));
    writeFileSync(path.join(root, "test-lab.json"), JSON.stringify({
      schemaVersion: 1,
      scenarios: { race: {
        description: "Concurrent evidence",
        steps: [{ id: "noop", kind: "command", command: process.execPath, args: ["-e", "process.exit(0)"] }],
      } },
    }));
    const freeze = path.join(root, "freeze-time.cjs");
    writeFileSync(freeze, "const D=Date;globalThis.Date=class extends D {constructor(...args){super(...(args.length?args:[D.UTC(2026,0,1)]));}};\n");
    const run = () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--require", freeze, "scripts/test-lab.mjs", "run", "race"], {
        cwd: root, stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      child.stdout.resume();
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, stderr }));
    });
    const runs = await Promise.all([run(), run()]);
    assert.deepEqual(runs.map(({ code }) => code), [0, 0], JSON.stringify(runs));
    const dirs = readdirSync(path.join(root, "test-results", "test-lab"));
    assert.equal(dirs.length, 2, "each run must own a unique result directory");
    for (const dir of dirs) {
      const summary = JSON.parse(readFileSync(path.join(root, "test-results", "test-lab", dir, "summary.json"), "utf8"));
      assert.equal(summary.status, "passed");
      assert.equal(summary.steps.length, 1);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
