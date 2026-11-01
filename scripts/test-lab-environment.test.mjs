import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { discoverUnityEditors, inspectEnvironment } from "./test-lab-environment.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contract = JSON.parse(fs.readFileSync(path.join(root, "release-contract.json"), "utf8"));

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "teamforge-doctor-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, "release-contract.json"), JSON.stringify(contract));
  return directory;
}

function fakeExecutable(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "This fixture must never be executed by Editor discovery.");
  fs.chmodSync(file, 0o755);
  return file;
}

function inspect(directory, overrides = {}) {
  return inspectEnvironment({ repoRoot: directory, scenario: "fixture", steps: [], requirements: [],
    env: { PATH: "" }, platform: "linux", nodeVersion: contract.node.version, unityRoots: [], ...overrides });
}

test("Hub discovery covers Windows, macOS and Linux layouts without starting Editors", (t) => {
  const directory = fixture(t);
  for (const [platform, relative] of [
    ["win32", ["Editor", "Unity.exe"]],
    ["darwin", ["Unity.app", "Contents", "MacOS", "Unity"]],
    ["linux", ["Editor", "Unity"]],
  ]) {
    const hub = path.join(directory, platform, "Hub Editors with spaces");
    const file = fakeExecutable(path.join(hub, contract.unity.testedEditor, ...relative));
    fakeExecutable(path.join(hub, "not-a-version", ...relative));
    const result = discoverUnityEditors({ roots: [hub, hub, path.join(hub, "missing")], env: {}, platform });
    assert.equal(result.editors.length, 1);
    assert.equal(result.editors[0].path, file);
    assert.equal(result.editors[0].versionHint, contract.unity.testedEditor);
    assert.equal(result.editors[0].versionVerified, false);
    assert.deepEqual(result.issues, []);
  }
});

test("explicit invalid or different Editor never falls back to a discovered baseline", (t) => {
  const directory = fixture(t);
  const hub = path.join(directory, "hub");
  fakeExecutable(path.join(hub, contract.unity.testedEditor, "Editor", "Unity"));
  const other = fakeExecutable(path.join(hub, "6000.6.7f1", "Editor", "Unity"));
  for (const editor of [path.join(directory, "missing"), "relative-editor", other]) {
    const report = inspect(directory, { unityRoots: [hub], editor, requirements: ["unity-editor"] });
    assert.equal(report.status, "blocked");
    assert.equal(report.checks.find((entry) => entry.id === "unity-editor").status, "blocked");
    assert.equal(report.testsExecuted, false);
    assert.equal(report.unity.editors.length >= 1, true);
  }
});

test("an installed baseline folder and an external lane stay INCOMPLETE, never test PASS", (t) => {
  const directory = fixture(t);
  const hub = path.join(directory, "hub");
  const editor = fakeExecutable(path.join(hub, contract.unity.testedEditor, "Editor", "Unity"));
  const report = inspect(directory, { unityRoots: [hub], editor, requirements: ["unity-editor"],
    steps: [{ id: "unity-ci", kind: "external", reference: ".github/workflows/unity-tests.yml", reason: "Needs Unity execution." }] });
  assert.equal(report.status, "incomplete");
  assert.equal(report.external[0].status, "not-run");
  assert.equal(report.unity.editors[0].source, "explicit");
  assert.equal(report.testsExecuted, false);
  assert.equal(report.checks.some((entry) => entry.status === "passed"), false);
});

test("explicit standalone Editor with unknown version remains unverified", (t) => {
  const directory = fixture(t);
  const editor = fakeExecutable(path.join(directory, "standalone", "Editor", "Unity"));
  const report = inspect(directory, { editor, requirements: ["unity-editor"] });
  assert.equal(report.status, "incomplete");
  assert.equal(report.unity.editors[0].versionHint, null);
  assert.equal(report.checks.find((entry) => entry.id === "unity-editor").status, "unverified");
});

test("unreadable roots and non-executable Editor candidates do not establish readiness", (t) => {
  const directory = fixture(t);
  const file = path.join(directory, "not-a-directory");
  fs.writeFileSync(file, "file");
  const hub = path.join(directory, "hub");
  const editor = fakeExecutable(path.join(hub, contract.unity.testedEditor, "Editor", "Unity"));
  // Unix execution permissions are checked; Windows uses file presence.
  if (process.platform !== "win32") fs.chmodSync(editor, 0o644);
  const report = inspect(directory, { unityRoots: [file, hub], requirements: ["unity-editor"] });
  assert.equal(report.unity.issues[0].code, "unity_root_unreadable");
  if (process.platform !== "win32") assert.equal(report.status, "blocked");
});

test("runtime minimums and missing tools block preflight without running scenario commands", (t) => {
  const directory = fixture(t);
  const steps = [{ id: "no-start", kind: "command", command: "missing-test-command", args: ["never-run"] }];
  assert.equal(inspect(directory, { steps }).status, "blocked");
  for (const nodeVersion of ["22.23.1", "24.18.0", "25.0.0"]) {
    assert.equal(inspect(directory, { nodeVersion }).checks[0].status, "blocked");
  }
  for (const nodeVersion of ["22.23.2", "24.18.1", "24.19.0"]) {
    assert.equal(inspect(directory, { nodeVersion }).checks[0].status, "available");
  }
});

test("core requires installed pinned dependencies in both workspaces", (t) => {
  const directory = fixture(t);
  const options = { requirements: ["locked-dependencies"] };
  assert.equal(inspect(directory, options).status, "blocked");
  for (const workspace of ["server", "project-peer"]) {
    const module = path.join(directory, workspace, "node_modules", "ws");
    fs.mkdirSync(module, { recursive: true });
    fs.writeFileSync(path.join(module, "package.json"), JSON.stringify({ name: "ws", version: contract.ws.version }));
  }
  assert.equal(inspect(directory, options).status, "ready");
  fs.writeFileSync(path.join(directory, "server", "node_modules", "ws", "package.json"), JSON.stringify({ name: "ws", version: "0.0.0" }));
  assert.equal(inspect(directory, options).status, "blocked");
});

test(".NET SDK inventory is bounded and a missing, wrong, failed or timed-out probe stays blocked", (t) => {
  const directory = fixture(t);
  const bin = path.join(directory, "bin");
  fakeExecutable(path.join(bin, process.platform === "win32" ? "dotnet.exe" : "dotnet"));
  const options = { platform: process.platform, env: { PATH: bin }, requirements: ["dotnet-sdk"], probe: (file, args, config) => {
    assert.deepEqual(args, ["--list-sdks"]);
    assert.equal(config.shell, false);
    assert.equal(config.timeout, 5000);
    assert.equal(config.maxBuffer, 64 * 1024);
    return { status: 0, stdout: "10.0.303 [/sdk]\n" };
  } };
  assert.equal(inspect(directory, options).status, "ready");
  for (const result of [{ status: 0, stdout: "9.0.300 [/sdk]\n" }, { status: 1, stdout: "10.0.303 [/sdk]\n" },
    { status: null, stdout: "10.0.303 [/sdk]\n", error: new Error("ETIMEDOUT") }]) {
    assert.equal(inspect(directory, { ...options, probe: () => result }).status, "blocked");
  }
  assert.equal(inspect(directory, { requirements: ["dotnet-sdk"] }).status, "blocked");
});

test("physical setup cannot be READY from tool discovery or disclose field configuration", (t) => {
  const directory = fixture(t);
  const bin = path.join(directory, "bin");
  for (const name of ["git.exe", "ssh.exe"]) fakeExecutable(path.join(bin, name));
  const report = inspect(directory, { platform: "win32", env: { PATH: bin, TEAMFORGE_FIELD_ACCESS_CODE: "private-fixture-never-print" },
    requirements: ["windows", "physical-field"] });
  assert.equal(report.status, "incomplete");
  assert.equal(report.checks.find((entry) => entry.id === "physical-field-setup").status, "unverified");
  assert.equal(JSON.stringify(report).includes("private-fixture-never-print"), false);
  assert.equal(inspect(directory, { requirements: ["physical-field"] }).status, "blocked");
});

test("CLI doctor inherits aggregate requirements, rejects invalid options and never writes test evidence", (t) => {
  const directory = fixture(t);
  fs.mkdirSync(path.join(directory, "scripts"));
  for (const file of ["test-lab.mjs", "test-lab-environment.mjs", "test-lab-command.mjs"]) fs.copyFileSync(path.join(root, "scripts", file), path.join(directory, "scripts", file));
  const config = { schemaVersion: 1, scenarios: {
    base: { description: "Cannot run", requires: ["windows"], steps: [{ id: "noop", kind: "command", command: "node", args: ["-e", "process.exit(99)"] }] },
    aggregate: { description: "Inherited requirements", includes: ["base"], steps: [] },
  } };
  fs.writeFileSync(path.join(directory, "test-lab.json"), JSON.stringify(config));
  const run = (...args) => spawnSync(process.execPath, ["scripts/test-lab.mjs", "doctor", ...args], { cwd: directory, encoding: "utf8", timeout: 10000 });
  const result = run("aggregate", "--json");
  const report = JSON.parse(result.stdout);
  assert.equal(report.checks.some((entry) => entry.id === "windows"), true);
  assert.equal(report.testsExecuted, false);
  assert.equal(result.status, process.platform === "win32" ? 0 : 2);
  assert.equal(fs.existsSync(path.join(directory, "test-results")), false);
  for (const args of [["aggregate", "--editor"], ["aggregate", "--unknown"], ["missing"], []]) assert.notEqual(run(...args).status, 0);
  config.scenarios.base.requires = ["imaginary-requirement"];
  fs.writeFileSync(path.join(directory, "test-lab.json"), JSON.stringify(config));
  assert.match(run("aggregate").stderr, /unsupported environment requirement/);
});
