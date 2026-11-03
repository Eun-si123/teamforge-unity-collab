import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertCacheAccessPolicy } from "./validate-workflows.mjs";

const path = ".github/workflows/authority-chaos-stress.yml";
const fixture = (mode = "cache-mode: read", job = "") =>
  "on:\n  push:\n    branches: [main]\n  pull_request:\n" + mode +
  "\npermissions:\n  contents: read\njobs:\n  stress:\n" + job +
  "    steps:\n      - with:\n          cache: npm\n";

test("chaos stress is explicitly read-only even on trusted pushes", () => {
  assert.doesNotThrow(() => assertCacheAccessPolicy(fixture(), path));
  assert.throws(() => assertCacheAccessPolicy(fixture(""), path), /must prevent cache saves/u);
  assert.throws(() => assertCacheAccessPolicy(fixture("cache-mode: none"), path),
    /must prevent cache saves/u);
});

test("a cache-mode override must not bypass the low-trust default", () => {
  for (const mode of ["write", "write-only", "${{ github.event_name == 'push' && 'write' || 'read' }}"]) {
    assert.throws(() => assertCacheAccessPolicy(fixture("cache-mode: " + mode), "unsafe.yml"),
      /must not explicitly bypass/u);
    assert.throws(() => assertCacheAccessPolicy(fixture("cache-mode: read",
      "    cache-mode: " + mode + "\n"), "unsafe.yml"), /must not explicitly bypass/u);
  }
});

test("omitted cache-mode retains GitHub trigger-derived secure defaults", () => {
  assert.doesNotThrow(() => assertCacheAccessPolicy(fixture(""), "ordinary.yml"));
  assert.doesNotThrow(() => assertCacheAccessPolicy(fixture("cache-mode: read"), "ordinary.yml"));
  assert.doesNotThrow(() => assertCacheAccessPolicy(fixture("cache-mode: none"), "ordinary.yml"));
  assert.doesNotThrow(() => assertCacheAccessPolicy(fixture("cache-mode: read",
    "    cache-mode: none\n"), "ordinary.yml"));
});

test("commented-out or malformed overrides cannot satisfy explicit read-only policy", () => {
  assert.throws(() => assertCacheAccessPolicy(fixture("# cache-mode: read"), path),
    /must prevent cache saves/u);
  assert.throws(() => assertCacheAccessPolicy(fixture("cache-mode: write\ncache-mode: read"), path),
    /must not explicitly bypass/u);
});

const unityWorkflow = await readFile(new URL("../.github/workflows/unity-tests.yml", import.meta.url), "utf8");
const releaseContract = JSON.parse(await readFile(new URL("../release-contract.json", import.meta.url), "utf8"));
const unityEditors = [releaseContract.unity.testedEditor, "6000.3.27f2", "6000.6.7f1"];
const unityFlows = [
  { id: "editmode", name: "Unity Realtime Authority E2E", artifact: "unity-realtime-e2e-results", parameter: "-teamforgeCiE2E",
    setup: "Start real TeamForge server and CI peer", verify: "Verify CI peer observed full Unity lock handoff", cleanup: "Stop E2E processes" },
  { id: "lock-contention-e2e", name: "Unity Lock Contention E2E", artifact: "unity-lock-contention-e2e-results", parameter: "-teamforgeCiLockContentionE2E",
    setup: "Start real server and remote lock owner", verify: "Verify contention evidence", cleanup: "Stop contention processes" },
];

// Inspect only the two owned jobs and their literal matrix fields. This is a
// focused workflow contract, not a general YAML parser or a test of Unity itself.
function assertUnityWorkflowMatrix(source) {
  const lines = source.split(/\r?\n/u).filter(line => !/^\s*#/u.test(line));
  const permissions = /^permissions:\n((?:  [^\n]+\n)+)/mu.exec(lines.join("\n"))?.[1];
  assert.equal(permissions, "  contents: read\n  checks: write\n", "Unity CI must retain its reviewed permissions");
  const artifacts = [];
  const checks = [];
  for (const flow of unityFlows) {
    const start = lines.indexOf(`  ${flow.id}:`);
    assert(start >= 0, `Missing Unity flow ${flow.id}`);
    let end = start + 1;
    while (end < lines.length && !/^  [\w-]+:\s*$/u.test(lines[end])) end += 1;
    const job = lines.slice(start + 1, end);
    const scalar = (indent, key, scope = job) => {
      const prefix = " ".repeat(indent) + key + ": ";
      const matches = scope.filter(line => line.startsWith(prefix));
      assert.equal(matches.length, 1, `${flow.id} must declare exactly one ${key} at its owned level`);
      return matches[0].slice(prefix.length);
    };
    assert.equal(scalar(6, "max-parallel"), "1", `${flow.id} must not increase concurrent Editors`);
    assert.equal(scalar(6, "fail-fast"), "false", `${flow.id} must preserve the other version's evidence after failure`);
    assert.equal(scalar(4, "runs-on"), "ubuntu-latest", `${flow.id} must retain isolated GitHub-managed runners`);

    const rows = [];
    const literal = value => {
      assert.match(value, /^'[^']*'$/u, "Unity matrix fields must be unambiguous quoted literals");
      return value.slice(1, -1);
    };
    for (const line of job) {
      const editor = /^          - editor: (.+)$/u.exec(line);
      if (editor) rows.push({ editor: literal(editor[1]) });
      const field = /^            (nameSuffix|artifactSuffix): (.+)$/u.exec(line);
      if (field) {
        assert(rows.length > 0, `${flow.id} has a suffix without an Editor`);
        assert.equal(rows.at(-1)[field[1]], undefined, `${flow.id} duplicates a matrix field`);
        rows.at(-1)[field[1]] = literal(field[2]);
      }
    }
    assert.deepEqual(rows.map(row => row.editor), unityEditors, `${flow.id} must exercise the baseline, selected LTS patch and experimental Editor`);
    const primaryName = flow.id === "editmode" ? "Run Unity EditMode tests" : "Run Unity lock contention tests";
    const primaryStart = job.indexOf(`      - name: ${primaryName}`);
    assert(primaryStart >= 0, `Missing primary Unity step ${primaryName}`);
    let primaryEnd = primaryStart + 1;
    while (primaryEnd < job.length && !job[primaryEnd].startsWith("      - name:")) primaryEnd += 1;
    const primary = job.slice(primaryStart, primaryEnd);
    assert.equal(scalar(10, "unityVersion", primary), "${{ matrix.editor }}", `${flow.id} must route the selected Editor to GameCI`);
    assert.equal(scalar(4, "name"), flow.name + "${{ matrix.nameSuffix }}", `${flow.id} must preserve baseline job identity`);
    assert.equal(scalar(10, "checkName", primary), "TeamForge " + flow.name + "${{ matrix.nameSuffix }}", `${flow.id} must preserve baseline check identity`);
    const artifactStep = job.slice(job.indexOf(`      - name: ${flow.id === "editmode" ? "Upload Unity and realtime E2E results" : "Upload contention evidence"}`));
    assert.equal(scalar(10, "name", artifactStep), flow.artifact + "${{ matrix.artifactSuffix }}", `${flow.id} must isolate matrix artifacts`);
    for (const [index, row] of rows.entries()) {
      const experimental = row.editor === "6000.6.7f1";
      assert.equal(row.nameSuffix, index === 0 ? "" : ` (${row.editor}${experimental ? " experimental" : ""})`, `${flow.id} has a wrong check suffix`);
      assert.equal(row.artifactSuffix, index === 0 ? "" : `-${row.editor}${experimental ? "-experimental" : ""}`, `${flow.id} has a wrong artifact suffix`);
      checks.push("TeamForge " + flow.name + row.nameSuffix);
      artifacts.push(flow.artifact + row.artifactSuffix);
    }

    const body = job.join("\n");
    assert.match(primary.join("\n"), /uses: game-ci\/unity-test-runner@32e57712352b500e17974b245a6dce9e11a73213/u);
    assert.equal(scalar(10, "cliVersion", primary), "v0.1.69");
    assert.equal(scalar(10, "node-version"), `'${releaseContract.node.version}'`);
    assert.equal(scalar(10, "customParameters", primary), flow.parameter +
      (flow.id === "editmode" ? " ${{ steps.clone-init.outputs.exportParameters }}" : ""));
    assert.equal(scalar(10, "projectPath", primary), "unity-project");
    assert.equal(scalar(10, "UNITY_EMAIL", primary), "${{ secrets.UNITY_EMAIL }}");
    assert.equal(scalar(10, "UNITY_PASSWORD", primary), "${{ secrets.UNITY_PASSWORD }}");
    for (const step of ["Checkout", "Prepare disposable Unity runner disk", "Install locked server dependencies", flow.setup, flow.verify, flow.cleanup]) {
      assert(body.includes(`- name: ${step}\n`), `${flow.id} must retain ${step}`);
    }
    const diskStart = job.indexOf("      - name: Prepare disposable Unity runner disk");
    assert(diskStart < primaryStart, "Unity disk preparation must precede image extraction");
    assert.equal(job[diskStart + 1], "        run: bash scripts/prepare-unity-runner.sh");
    const cleanup = body.slice(body.indexOf(`- name: ${flow.cleanup}\n`)).split("\n      - name:", 1)[0];
    assert.match(cleanup, /if: always\(\)/u, `${flow.id} must clean up after failures`);
  }
  assert.equal(new Set(checks).size, checks.length, "Unity versions must have separate check identities");
  assert.equal(new Set(artifacts).size, artifacts.length, "Unity versions must never overwrite evidence artifacts");
}

test("Unity Authority and Lock matrices retain baseline identities and route all three isolated Editor versions", () => {
  assert.doesNotThrow(() => assertUnityWorkflowMatrix(unityWorkflow));
});

test("Unity matrices cannot silently drop the baseline or hardcode the selected Editor", () => {
  assert.throws(() => assertUnityWorkflowMatrix(unityWorkflow.replace("- editor: '6000.3.21f1'", "- editor: '6000.3.27f2'")),
    /baseline, selected LTS patch and experimental Editor/u);
  assert.throws(() => assertUnityWorkflowMatrix(unityWorkflow.replace("unityVersion: ${{ matrix.editor }}", "unityVersion: 6000.3.21f1")),
    /route the selected Editor/u);
});

for (const [label, newline] of [["LF", "\n"], ["CRLF", "\r\n"]]) {
  test(`experimental Editor coverage and its evidence label cannot silently disappear (${label})`, () => {
    const source = unityWorkflow.replace(/\r?\n/gu, newline);
    assert.doesNotThrow(() => assertUnityWorkflowMatrix(source));
    const experimentalRow = [
      "          - editor: '6000.6.7f1'",
      "            nameSuffix: ' (6000.6.7f1 experimental)'",
      "            artifactSuffix: '-6000.6.7f1-experimental'",
      "",
    ].join(newline);
    const withoutExperimental = source.replace(experimentalRow, "");
    assert.notEqual(withoutExperimental, source, "The negative fixture must remove the experimental row");
    assert.throws(() => assertUnityWorkflowMatrix(withoutExperimental),
      /baseline, selected LTS patch and experimental Editor/u);
    assert.throws(() => assertUnityWorkflowMatrix(source.replace("nameSuffix: ' (6000.6.7f1 experimental)'", "nameSuffix: ' (6000.6.7f1)'")),
      /wrong check suffix/u);
  });
}

test("Unity matrix failures cannot cancel sibling evidence or increase per-flow concurrency", () => {
  assert.throws(() => assertUnityWorkflowMatrix(unityWorkflow.replace("fail-fast: false", "fail-fast: true")),
    /other version's evidence/u);
  assert.throws(() => assertUnityWorkflowMatrix(unityWorkflow.replace("max-parallel: 1", "max-parallel: 2")),
    /concurrent Editors/u);
});

test("Unity matrices cannot collide artifact names or change baseline check names", () => {
  assert.throws(() => assertUnityWorkflowMatrix(unityWorkflow.replace("unity-realtime-e2e-results${{ matrix.artifactSuffix }}", "unity-realtime-e2e-results")),
    /isolate matrix artifacts/u);
  assert.throws(() => assertUnityWorkflowMatrix(unityWorkflow.replace("checkName: TeamForge Unity Realtime Authority E2E", "checkName: Renamed Unity Authority")),
    /baseline check identity/u);
});

test("Unity matrices keep reviewed permissions, managed runners and transient secret routing", () => {
  assert.throws(() => assertUnityWorkflowMatrix(unityWorkflow.replace("contents: read", "contents: write")),
    /reviewed permissions/u);
  assert.throws(() => assertUnityWorkflowMatrix(unityWorkflow.replace("runs-on: ubuntu-latest", "runs-on: self-hosted")),
    /isolated GitHub-managed runners/u);
  assert.throws(() => assertUnityWorkflowMatrix(unityWorkflow.replace("UNITY_PASSWORD: ${{ secrets.UNITY_PASSWORD }}", "UNITY_PASSWORD: ${{ vars.UNITY_PASSWORD }}")));
});

test("both Unity flows retain disk preparation before their Editor action", () => {
  assert.throws(() => assertUnityWorkflowMatrix(unityWorkflow.replace("- name: Prepare disposable Unity runner disk", "- name: Omitted disk check")),
    /must retain Prepare disposable Unity runner disk/u);
  assert.throws(() => assertUnityWorkflowMatrix(unityWorkflow.replace("run: bash scripts/prepare-unity-runner.sh", "run: true")));
});

function assertSequentialCloneProbe(source) {
  const normalized = source.replace(/\r\n/gu, "\n");
  const authority = normalized.split("  editmode:\n")[1]?.split("  lock-contention-e2e:\n")[0];
  assert(authority, "The existing Authority job must own the sequential clone probe");
  const steps = [...authority.matchAll(/^      - name: ([^\n]+)\n/gmu)];
  const step = name => {
    const found = steps.filter(match => match[1] === name);
    assert.equal(found.length, 1, `Expected exactly one ${name} step`);
    const index = steps.indexOf(found[0]);
    return authority.slice(found[0].index, steps[index + 1]?.index ?? authority.length);
  };
  const ordered = ["Initialize owned clone Editor probe", "Test clone evidence boundaries before any Editor", "Run Unity EditMode tests",
    "Verify CI peer observed full Unity lock handoff", "Verify owned clone export", "Stop E2E processes", "Open clone in a separate sequential Editor",
    "Verify separate clone Editor evidence", "Upload clone Editor evidence", "Remove this run's owned clone"];
  const positions = ordered.map(name => authority.indexOf(`      - name: ${name}\n`));
  assert(positions.every((position, index) => position >= 0 && (!index || position > positions[index - 1])),
    "Export, E2E shutdown, probe, evidence upload and owned cleanup must remain sequential");
  for (const name of ordered.filter(name => !["Run Unity EditMode tests", "Stop E2E processes", "Verify CI peer observed full Unity lock handoff"].includes(name))) {
    assert.match(step(name), /        if: (?:success\(\) && |always\(\) && )?matrix\.editor == '6000\.3\.21f1'/u,
      "Only the baseline Authority cell may run clone stages");
  }
  const open = step("Open clone in a separate sequential Editor");
  const checked = "success() && matrix.editor == '6000.3.21f1' && steps.clone-export.outputs.ready == 'true'";
  assert(open.includes(`        if: ${checked}\n`), "A failed/unverified export cannot launch another Editor");
  assert(step("Verify separate clone Editor evidence").includes(`        if: ${checked}\n`));
  assert.match(open, /uses: game-ci\/unity-test-runner@32e57712352b500e17974b245a6dce9e11a73213/u);
  assert.match(open, /          unityVersion: \$\{\{ matrix\.editor \}\}\n/u);
  assert.match(open, /          cliVersion: v0\.1\.69\n/u);
  assert.match(open, /          projectPath: \$\{\{ steps\.clone-export\.outputs\.clonePath \}\}\n/u);
  assert.match(open, /          artifactsPath: \$\{\{ steps\.clone-init\.outputs\.probeResultsPath \}\}\n/u);
  assert.match(open, /          coverageEnabled: false\n/u);
  assert.match(open, /          checkName: TeamForge Unity Clone Editor Probe\n/u);
  assert.match(open, /          UNITY_EMAIL: \$\{\{ secrets\.UNITY_EMAIL \}\}\n/u);
  assert.match(open, /          UNITY_PASSWORD: \$\{\{ secrets\.UNITY_PASSWORD \}\}\n/u);
  const parameters = open.match(/^          customParameters: (.+)$/mu)?.[1];
  assert.equal(parameters, "-testFilter EunSung.TeamForge.Tests.TeamForgeCloneEditorProbeTests.CloneEditorResolvesItsOwnEmbeddedPackage " +
    "-teamforgeCiCloneProbe -teamforgeCiCloneRun ${{ steps.clone-init.outputs.token }}",
  "Probe must run exactly its own test without export, bootstrap or collaboration flags");
  assert(!open.includes("continue-on-error:"), "Probe failure must remain visible");
  assert.match(step("Run Unity EditMode tests"), /artifactsPath: \$\{\{ steps\.clone-init\.outputs\.sourceResultsPath \|\| 'unity-test-results' \}\}/u);
  assert.match(step("Test clone evidence boundaries before any Editor"), /python3 -m unittest discover -s scripts -p test_unity_clone_probe\.py/u);
  for (const path of ["scripts/unity-clone-probe.py", "scripts/test_unity_clone_probe.py", "scripts/validate-workflows.test.mjs", "scripts/prepare-unity-runner.sh"])
    assert.equal(normalized.split(`      - '${path}'`).length - 1, 2, "Helper-only changes must trigger push and PR Unity checks");
  assert.match(step("Verify owned clone export"), /unity-clone-probe\.py verify-export/u);
  assert.match(step("Verify separate clone Editor evidence"), /unity-clone-probe\.py verify-probe/u);
  assert.match(step("Upload clone Editor evidence"), /if: always\(\)/u);
  assert.match(step("Remove this run's owned clone"), /if: always\(\)/u);
  assert.match(step("Remove this run's owned clone"), /unity-clone-probe\.py cleanup/u);
  assert.match(step("Remove this run's owned clone"), /sudo -- python3 scripts\/unity-clone-probe\.py cleanup/u,
    "Root-owned container output requires bounded privileged cleanup of the validated run only");
  assert.equal((authority.match(/uses: game-ci\/unity-test-runner@/gu) ?? []).length, 2,
    "Exactly one sequential clone Editor is added");
  const rest = normalized.split("  lock-contention-e2e:\n")[1];
  assert(!rest.includes("unity-clone-probe.py") && !rest.includes("-teamforgeCiCloneProbe"),
    "Clone validation must not expand Lock or other jobs");
}

test("baseline Authority alone exports and reopens a clone sequentially with strict evidence and owned cleanup", () => {
  for (const newline of ["\n", "\r\n"])
    assert.doesNotThrow(() => assertSequentialCloneProbe(unityWorkflow.replace(/\r?\n/gu, newline)));
});

test("the sequential probe cannot mask a changed primary GameCI action pin", () => {
  const changed = unityWorkflow.replace("uses: game-ci/unity-test-runner@32e57712352b500e17974b245a6dce9e11a73213",
    "uses: game-ci/unity-test-runner@0000000000000000000000000000000000000000");
  assert.throws(() => assertUnityWorkflowMatrix(changed));
});

for (const [label, before, after] of [
  ["wrong project", "projectPath: ${{ steps.clone-export.outputs.clonePath }}", "projectPath: unity-project"],
  ["unverified export", "if: success() && matrix.editor == '6000.3.21f1' && steps.clone-export.outputs.ready == 'true'", "if: matrix.editor == '6000.3.21f1'"],
  ["all-version export", "if: matrix.editor == '6000.3.21f1'", "if: success()"],
  ["wrong probe filter", "-testFilter EunSung.TeamForge.Tests.TeamForgeCloneEditorProbeTests.CloneEditorResolvesItsOwnEmbeddedPackage", "-testFilter TeamForgeRealServerE2ETests"],
  ["recursive export", "-teamforgeCiCloneProbe -teamforgeCiCloneRun", "-teamforgeCiCloneProbe -teamforgeCiExportClone -teamforgeCiCloneRun"],
  ["shared coverage", "coverageEnabled: false", "coverageEnabled: true"],
  ["stale artifact location", "artifactsPath: ${{ steps.clone-init.outputs.probeResultsPath }}", "artifactsPath: unity-test-results"],
  ["lost failure cleanup", "if: always() && matrix.editor == '6000.3.21f1'", "if: success() && matrix.editor == '6000.3.21f1'"],
]) {
  test(`clone Editor workflow rejects ${label}`, () => {
    const changed = unityWorkflow.replace(before, after);
    assert.notEqual(changed, unityWorkflow, "The mutation must exercise the live workflow");
    assert.throws(() => assertSequentialCloneProbe(changed));
  });
}
