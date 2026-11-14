import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const runner = fileURLToPath(new URL("./test-lab.mjs", import.meta.url));

function executeFixture(scenarios, command = "validate", scenarioId = "", { preload, keepLogs = false, onResult } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "teamforge-testlab-"));
  try {
    mkdirSync(path.join(root, "scripts"));
    copyFileSync(runner, path.join(root, "scripts", "test-lab.mjs"));
    copyFileSync(new URL("./test-lab-environment.mjs", import.meta.url), path.join(root, "scripts", "test-lab-environment.mjs"));
    copyFileSync(new URL("./test-lab-command.mjs", import.meta.url), path.join(root, "scripts", "test-lab-command.mjs"));
    writeFileSync(path.join(root, "test-lab.json"), JSON.stringify({ schemaVersion: 1, scenarios }));
    const nodeArgs = [];
    if (preload) {
      writeFileSync(path.join(root, "preload.mjs"), preload);
      nodeArgs.push("--import", pathToFileURL(path.join(root, "preload.mjs")).href);
    }
    const result = spawnSync(process.execPath, [...nodeArgs, "scripts/test-lab.mjs", command, ...(scenarioId ? [scenarioId] : []), ...(keepLogs ? ["--keep-logs"] : [])], {
      cwd: root, encoding: "utf8", timeout: 10000, maxBuffer: 8 * 1024 * 1024,
    });
    const resultDir = path.join(root, "test-results", "test-lab");
    const folders = existsSync(resultDir) ? readdirSync(resultDir) : [];
    const summary = folders.length === 1
      ? JSON.parse(readFileSync(path.join(resultDir, folders[0], "summary.json"), "utf8"))
      : null;
    const logs = summary ? summary.steps.filter((step) => step.logFile).map((step) =>
      readFileSync(path.join(resultDir, folders[0], step.logFile), "utf8")) : [];
    const fixtureResult = { ...result, summary, logs };
    onResult?.(fixtureResult);
    return fixtureResult;
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
    copyFileSync(new URL("./test-lab-environment.mjs", import.meta.url), path.join(root, "scripts", "test-lab-environment.mjs"));
    copyFileSync(new URL("./test-lab-command.mjs", import.meta.url), path.join(root, "scripts", "test-lab-command.mjs"));
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

test("Test Lab caps streamed console output when command floods logs", () => {
  const scenarios = { flood: {
    description: "Bounded noisy output",
    steps: [{ id: "flood", kind: "command", command: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(3 * 1024 * 1024))"] }],
  } };
  const result = executeFixture(scenarios, "run", "flood");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.summary?.status, "passed");
  assert.ok(Buffer.byteLength(result.stdout) < 2 * 1024 * 1024 + 4096,
    "command output must not bypass the Test Lab's 2 MiB budget");
  assert.match(result.stdout, /log truncated at 2 MiB/);
});

test("Test Lab shares one output budget across stdout and stderr", () => {
  const scenarios = { mixed: {
    description: "Two noisy streams",
    steps: [{ id: "mixed", kind: "command", command: process.execPath,
      args: ["-e", "process.stdout.write('a'.repeat(1536 * 1024)); process.stderr.write('b'.repeat(1536 * 1024))"] }],
  } };
  const result = executeFixture(scenarios, "run", "mixed");
  assert.equal(result.status, 0, result.stderr.slice(-500));
  assert.equal(result.summary?.status, "passed");
  assert.ok(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) < 2 * 1024 * 1024 + 4096,
    "stdout and stderr must not each get an independent 2 MiB allowance");
  assert.match(result.stdout + result.stderr, /log truncated at 2 MiB/);
});

test("Test Lab runs the installed npm CLI without a shell, including on Windows", () => {
  const commands = process.platform === "win32" ? ["npm", "npm.cmd"] : ["npm"];
  // npm run sets npm_execpath. Also exercise the real Windows installation
  // fallback used when contributors start the runner directly with Node.
  const modes = process.platform === "win32" ? [{}, { preload: "delete process.env.npm_execpath;" }] : [{}];
  for (const options of modes) {
    const result = executeFixture({ npm: {
      description: "Installed npm version",
      steps: commands.map((command, index) => ({ id: `npm-version-${index}`, kind: "command", command, args: ["--version"] })),
    } }, "run", "npm", options);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.summary?.status, "passed");
    assert.equal(result.summary.steps.length, commands.length);
    assert.equal(result.summary.steps.every((step) => step.exitCode === 0), true);
    assert.match(result.stdout, /\r?\n\d+\.\d+\.\d+\r?\n/);
  }
});

test("unavailable Windows npm CLI leaves failed evidence instead of terminating before the summary", () => {
  const result = executeFixture({ npm: {
    description: "Missing npm installation fixture",
    steps: [{ id: "npm-version", kind: "command", command: "npm", args: ["--version"] }],
  } }, "run", "npm", { preload: `
    import { fileURLToPath } from "node:url";
    Object.defineProperty(process, "platform", { value: "win32" });
    Object.defineProperty(process, "execPath", { value: fileURLToPath(new URL("./uninstalled/node.exe", import.meta.url)) });
    process.env.PATH = "";
    process.env.Path = "";
    delete process.env.npm_execpath;
  ` });
  assert.notEqual(result.status, 0);
  assert.equal(result.summary?.status, "failed", result.stderr);
  assert.equal(result.summary.steps[0].exitCode, null);
  assert.equal(result.summary.steps[0].logRetained, true);
  assert.match(result.summary.steps[0].spawnError, /npm-cli\.js was not found/);
  assert.match(result.logs[0], /could not start command/);
});

test("missing executable leaves a failed summary and retained start diagnostic", () => {
  const result = executeFixture({ missing: {
    description: "Missing command",
    steps: [{ id: "missing-command", kind: "command", command: "teamforge-nonexistent-command-fixture", args: [] }],
  } }, "run", "missing");
  assert.notEqual(result.status, 0);
  assert.equal(result.summary?.status, "failed");
  assert.equal(result.summary.steps[0].status, "failed");
  assert.equal(result.summary.steps[0].logRetained, true);
  assert.match(result.summary.steps[0].spawnError, /ENOENT/);
  assert.match(result.logs[0], /could not start command/);
});

test("synchronous spawn rejection still writes failed evidence and retains its diagnostic", () => {
  const result = executeFixture({ invalid: {
    description: "Invalid spawn argument",
    steps: [{ id: "invalid-argument", kind: "command", command: process.execPath, args: ["invalid\0argument"] }],
  } }, "run", "invalid");
  assert.notEqual(result.status, 0);
  assert.equal(result.summary?.status, "failed");
  assert.equal(result.summary.steps[0].status, "failed");
  assert.equal(result.summary.steps[0].exitCode, null);
  assert.equal(result.summary.steps[0].logRetained, true);
  assert.match(result.summary.steps[0].spawnError, /null bytes/);
  assert.match(result.logs[0], /could not start command/);
});

test("timed-out command records failed evidence and skips later steps", () => {
  const scenarios = { timeout: {
    description: "Bounded hanging command",
    steps: [
      { id: "hang", kind: "command", command: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"], timeoutMs: 120 },
      { id: "after", kind: "command", command: process.execPath, args: ["-e", "process.exit(0)"] },
    ],
  } };
  const result = executeFixture(scenarios, "run", "timeout");
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.summary?.status, "failed");
  assert.equal(result.summary?.steps[0].timedOut, true);
  assert.equal(result.summary?.steps[0].status, "failed");
  assert.equal(result.summary?.steps[1].status, "not-run");
  assert.match(result.logs[0], /timed out/);
});

test("invalid command timeout is rejected during configuration validation", () => {
  const result = executeFixture({ bad: {
    description: "Invalid deadline",
    steps: [{ id: "command", kind: "command", command: process.execPath, args: [], timeoutMs: -1 }],
  } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /timeoutMs must be an integer/);
});

test("timeout also terminates a descendant retaining command output pipes", { skip: process.platform === "win32" }, async () => {
  const code = "const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore','inherit','inherit']});console.log('descendant-pid='+child.pid);";
  const result = executeFixture({ descendants: {
    description: "Descendant holds stdout",
    steps: [{ id: "descendant", kind: "command", command: process.execPath,
      args: ["-e", code], timeoutMs: 1000 }],
  } }, "run", "descendants");
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.summary?.steps[0].timedOut, true);
  const pid = Number(result.logs[0].match(/descendant-pid=(\d+)/)?.[1]);
  assert.ok(Number.isSafeInteger(pid) && pid > 0, "descendant PID must appear in the log");
  const isRunning = () => {
    const probe = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" });
    assert.equal(probe.error, undefined, "ps must be available for this POSIX test");
    assert.equal(probe.stderr.trim(), "", "ps must not report an inspection error");
    assert.ok(probe.status === 0 || probe.status === 1, `unexpected ps exit status: ${probe.status}`);
    if (probe.status === 1) {
      assert.equal(probe.stdout.trim(), "", "missing PID must not produce process state");
      return false;
    }
    const state = probe.stdout.trim();
    assert.notEqual(state, "", "ps must report state for an existing PID");
    return !state.startsWith("Z");
  };
  const deadline = Date.now() + 2000;
  while (isRunning() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const leaked = isRunning();
  if (leaked) process.kill(pid, "SIGKILL");
  assert.equal(leaked, false, "timed-out descendant must not remain running");
});


test("Windows timeout cleans an orphan whose parent exited with inherited output pipes", { skip: process.platform !== "win32" }, async () => {
  const code = "const {spawn}=require('node:child_process');const kid=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore','inherit','inherit'],windowsHide:true,detached:true});console.log('orphan-pid='+kid.pid);kid.unref();";
  let orphanPid = null;
  try {
    const result = executeFixture({ orphan: {
      description: "Orphan inherited stdout after parent exit",
      steps: [{ id: "orphan", kind: "command", command: process.execPath,
        args: ["-e", code], timeoutMs: 1800 }],
    } }, "run", "orphan", { keepLogs: true, onResult: (fixture) => {
      const observed = Number(fixture.logs[0]?.match(/orphan-pid=(\d+)/)?.[1]);
      if (Number.isSafeInteger(observed) && observed > 0) orphanPid = observed;
    } });
    assert.ok(result.summary, "No Test Lab fixture summary; exit=" + result.status +
      " stdout=" + result.stdout + " stderr=" + result.stderr);
    const pid = Number(result.logs[0]?.match(/orphan-pid=(\d+)/)?.[1]);
    assert.ok(Number.isSafeInteger(pid) && pid > 0,
      "Orphan PID missing; status=" + result.status + " summary=" + JSON.stringify(result.summary) +
      " stdout=" + result.stdout + " stderr=" + result.stderr + " logs=" + JSON.stringify(result.logs));
    const isAlive = () => {
      const observed = spawnSync("tasklist", ["/FI", "PID eq " + pid, "/FO", "CSV", "/NH"], {
        encoding: "utf8", timeout: 5000,
      });
      assert.equal(observed.error, undefined, "Windows tasklist must be executable");
      assert.equal(observed.status, 0, "Tasklist failure must not be mistaken for process exit");
      return observed.stdout.split(/\r?\n/).some((line) => {
        const match = /^"[^"]+","(\d+)"/.exec(line);
        return match !== null && Number(match[1]) === pid;
      });
    };
    const deadline = Date.now() + 2500;
    while (isAlive() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const leaked = isAlive();
    if (leaked) spawnSync("taskkill", ["/PID", String(pid), "/F"], { timeout: 5000 });
    assert.equal(leaked, false, "Windows orphan survived parent exit; status=" + result.status +
      " summary=" + JSON.stringify(result.summary) + " logs=" + JSON.stringify(result.logs));
    assert.equal(result.status, 1, "Test Lab must not mark an abandoned descendant successful; " +
      JSON.stringify(result.summary));
    assert.equal(result.summary?.steps[0].timedOut, true);
    assert.doesNotMatch(result.logs[0], /cleanup could not be verified/);
  } finally {
    // A fixture teardown exception must not bypass PID-scoped emergency cleanup.
    if (orphanPid !== null) {
      const probe = spawnSync("tasklist", ["/FI", "PID eq " + orphanPid, "/FO", "CSV", "/NH"], { encoding: "utf8", timeout: 5000 });
      if (probe.error || probe.status !== 0) {
        console.error("orphan PID " + orphanPid + " tasklist failed: " + (probe.error?.message ?? "status " + probe.status));
      } else if (probe.stdout.split(/\r?\n/).some((line) =>
        /^"node(?:\.exe)?","(\d+)"/i.exec(line)?.[1] === String(orphanPid))) {
        const kill = spawnSync("taskkill", ["/PID", String(orphanPid), "/F"], { timeout: 5000 });
        if (kill.error || kill.status !== 0) {
          console.error("orphan PID " + orphanPid + " taskkill failed: " + (kill.error?.message ?? "status " + kill.status));
        }
      }
    }
  }
});

test("Windows hung CIM helper is bounded and taskkill fallback marks timeout evidence", { skip: process.platform !== "win32" }, () => {
  // Only the isolated runner fixture intercepts PowerShell; the real host is
  // untouched. Simulate a CIM helper that never exits and verify the CLI
  // still completes with failed evidence rather than waiting indefinitely.
  const preload = [
    "import childProcess from 'node:child_process';",
    "import { syncBuiltinESMExports } from 'node:module';",
    "const realSpawn = childProcess.spawn;",
    "childProcess.spawn = (command, args, options) =>",
    "  command === 'powershell.exe' ? realSpawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], options) :",
    "  realSpawn(command, args, options);",
    "syncBuiltinESMExports();",
  ].join("\n");
  const scenarios = { hung: {
    description: "Hung Windows cleanup helper",
    steps: [{ id: "hang", kind: "command", command: process.execPath,
      args: ["-e", "console.log('bounded-helper-test');setInterval(()=>{},1000)"], timeoutMs: 240 }],
  } };
  const started = Date.now();
  const result = executeFixture(scenarios, "run", "hung", { preload, keepLogs: true });
  const elapsed = Date.now() - started;
  assert.equal(result.status, 1, "Test Lab must record a failing timeout; " + result.stderr + result.stdout);
  assert.equal(result.summary?.status, "failed");
  assert.equal(result.summary?.steps[0].timedOut, true);
  assert.match(result.logs[0], /Windows process-tree cleanup could not be verified/);
  assert.ok(elapsed < 9600, "Hung Windows CIM helper must not prevent runner shutdown");
});

test("POSIX runner interruption kills its detached command group and skips later steps", { skip: process.platform === "win32" }, async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "teamforge-testlab-interrupt-"));
  let runnerProcess;
  let childPid;
  let childGone = false;
  try {
    mkdirSync(path.join(root, "scripts"));
    for (const name of ["test-lab.mjs", "test-lab-command.mjs", "test-lab-environment.mjs"]) {
      copyFileSync(new URL("./" + name, import.meta.url), path.join(root, "scripts", name));
    }
    writeFileSync(path.join(root, "test-lab.json"), JSON.stringify({
      schemaVersion: 1,
      scenarios: { interrupt: {
        description: "Control signal to runner",
        steps: [
          { id: "alive", kind: "command", command: process.execPath,
            args: ["-e", "console.log('running-pid='+process.pid);setInterval(()=>{},1000)"] },
          { id: "after", kind: "command", command: process.execPath, args: ["-e", "process.exit(0)"] },
        ],
      } },
    }));
    runnerProcess = spawn(process.execPath, ["scripts/test-lab.mjs", "run", "interrupt"], {
      cwd: root, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let stderr = "";
    let sent = false;
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (runnerProcess && runnerProcess.exitCode === null) runnerProcess.kill("SIGKILL");
        reject(new Error("Test Lab runner did not settle after SIGINT"));
      }, 8000);
      runnerProcess.stdout.on("data", (chunk) => {
        output += chunk;
        const match = /running-pid=(\d+)/.exec(output);
        if (!sent && match) {
          childPid = Number(match[1]);
          sent = true;
          runnerProcess.kill("SIGINT");
        }
      });
      runnerProcess.stderr.on("data", (chunk) => { stderr += chunk; });
      runnerProcess.on("error", (error) => { clearTimeout(timer); reject(error); });
      runnerProcess.on("close", (code) => { clearTimeout(timer); resolve({ code }); });
    });
    assert.ok(Number.isSafeInteger(childPid) && childPid > 0, "Interrupted child must be identified");
    assert.equal(result.code, 1, stderr + output);
    const evidenceRoot = path.join(root, "test-results", "test-lab");
    const sessions = readdirSync(evidenceRoot);
    assert.equal(sessions.length, 1);
    const summary = JSON.parse(readFileSync(path.join(evidenceRoot, sessions[0], "summary.json"), "utf8"));
    assert.equal(summary.status, "failed");
    assert.equal(summary.steps[0].interruptedSignal, "SIGINT");
    assert.equal(summary.steps[0].timedOut, false);
    assert.equal(summary.steps[1].status, "not-run");
    const noLongerRunning = () => {
      const probe = spawnSync("ps", ["-o", "stat=", "-p", String(childPid)], { encoding: "utf8" });
      assert.equal(probe.error, undefined, "ps must be available for signal verification");
      assert.ok(probe.status === 0 || probe.status === 1, "ps inspection failed unexpectedly");
      return probe.status === 1 || probe.stdout.trim().startsWith("Z");
    };
    const deadline = Date.now() + 2000;
    while (!noLongerRunning() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    childGone = noLongerRunning();
    assert.ok(childGone, "The interrupted Test Lab command must no longer be running");
  } finally {
    // A successful reaping check must never send another signal to a recycled PID.
    if (!childGone && childPid && process.platform !== "win32") {
      const probe = spawnSync("ps", ["-o", "pgid=,args=", "-p", String(childPid)], { encoding: "utf8" });
      const match = /^\s*(\d+)\s+(.*)$/.exec(probe.stdout);
      if (probe.status === 0 && match && Number(match[1]) === childPid &&
          match[2].includes("running-pid=")) {
        try { process.kill(-childPid, "SIGKILL"); } catch {}
      }
    }
    if (runnerProcess?.exitCode === null) {
      runnerProcess.kill("SIGKILL");
    }
    rmSync(root, { recursive: true, force: true });
  }
});
