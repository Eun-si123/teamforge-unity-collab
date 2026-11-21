import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { previewHostCheckpoint } from "../src/host-checkpoint-preview.mjs";
import { loadLaunchSettings } from "../src/launch-settings.mjs";
import { buildManifest } from "../src/manifest.mjs";
import { ProjectPeerEngine } from "../src/project-peer.mjs";
import { sha256 } from "../src/hash.mjs";
import { unityProjectDescriptorFromBaseline } from "../src/unity-project-descriptor.mjs";
import { cleanup, createUnityProject, temporaryRoot } from "./helpers.mjs";

const cliPath = fileURLToPath(new URL("../src/host-checkpoint-preview-cli.mjs", import.meta.url));
const runProcess = promisify(execFile);

async function fixture(t) {
  const root = await temporaryRoot("teamforge-host-preview-");
  t.after(() => cleanup(root));
  const source = path.join(root, "Source");
  const managedRoot = path.join(root, "Managed");
  const projectUuid = randomUUID();
  const projectId = "fixture-host-preview";
  await createUnityProject(source, {
    assetFiles: { "Assets/Change.txt": "before", "Assets/Remove.txt": "old", "Assets/Stable.txt": "keep" },
  });
  const engine = new ProjectPeerEngine({ managedRoot });
  const initial = await engine.preparePublication({ projectRoot: source, projectId, projectUuid, baselineRevision: 1 });
  const sourcePath = path.join(source, "ProjectSettings", "TeamForgeProject.json");
  const approvedPath = engine.publishedPointerPath(projectUuid);
  const sourceDescriptor = unityProjectDescriptorFromBaseline(initial.descriptor);
  const approved = {
    schemaVersion: 1,
    projectUuid,
    baselineRevision: 1,
    manifestHash: initial.manifest.manifestHash,
    descriptorHash: initial.descriptor.descriptorHash,
    ownerKeyId: initial.descriptor.ownerKeyId,
    approvedAtUnixMs: 1000,
  };
  await writeFile(sourcePath, JSON.stringify(sourceDescriptor));
  await writeFile(approvedPath, JSON.stringify(approved));
  const launchSettingsPath = path.join(root, "launch-PRIVATE_LOCAL_FIXTURE.json");
  const launch = {
    schemaVersion: 1,
    serverAddress: "http://127.0.0.1:1",
    realtimePath: "ws",
    projectId,
    sessionId: "preview-only",
    projectUuid,
    sourceProjectRelativePath: "Source",
    projectDescriptorRelativePath: "Source/ProjectSettings/TeamForgeProject.json",
    managedProjectsRelativePath: "Managed",
    realtimeProtocolVersion: 1,
    transferProtocolVersion: 1,
    manifestSchemaVersion: 1,
    authenticationTokenEnvironmentVariable: "PRIVATE_TEST_CODE",
    ownerKeyEnvironmentVariable: "PRIVATE_TEST_KEY",
    allowCurrentProjectAsSeedSource: true,
  };
  const launchBytes = JSON.stringify(launch);
  await writeFile(launchSettingsPath, launchBytes);
  const baseline = { projectUuid, revision: 1, manifestHash: approved.manifestHash, descriptorHash: approved.descriptorHash };
  return { root, source, managedRoot, sourcePath, sourceDescriptor, approvedPath, approved, launch, baseline,
    ownerPath: engine.ownerKeyPath(projectUuid), input: { launchSettingsPath, launchSettingsDigest: sha256(launchBytes), ...baseline } };
}

async function treeSnapshot(root) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return (await Promise.all(entries.map(async entry => {
    const filename = path.join(entry.parentPath, entry.name);
    return [path.relative(root, filename), entry.isDirectory() ? "directory" : sha256(await readFile(filename))];
  }))).sort(([left], [right]) => left.localeCompare(right));
}

function cliOptions({ launchSettingsPath, launchSettingsDigest, projectUuid, revision, manifestHash, descriptorHash }) {
  return ["--launch-settings", launchSettingsPath, "--launch-digest", launchSettingsDigest, "--project-uuid", projectUuid, "--baseline-revision", String(revision),
    "--manifest-hash", manifestHash, "--descriptor-hash", descriptorHash];
}

async function runCli(options) {
  const { stdout, stderr } = await runProcess(process.execPath, [cliPath, ...options], {
    env: { ...process.env, PRIVATE_TEST_CODE: "SYNTHETIC_PRIVATE_TEST_CODE", PRIVATE_TEST_KEY: "missing-private-fixture-key" },
    maxBuffer: 131_072,
    timeout: 20_000,
  });
  assert.equal(stderr, "");
  assert.equal(stdout.trim().split("\n").length, 1);
  assert.ok(Buffer.byteLength(stdout, "utf8") <= 65_536);
  assert.doesNotMatch(stdout, /PRIVATE_LOCAL_FIXTURE|SYNTHETIC_PRIVATE_TEST_CODE|missing-private-fixture-key|PRIVATE_TEST_KEY/u);
  return JSON.parse(stdout);
}

test("Host previews saved changes and exact no-op without credentials, listeners or writes", async t => {
  const d = await fixture(t);
  await unlink(d.ownerPath);
  const start = await treeSnapshot(d.root);
  const noOp = await runCli(cliOptions(d.input));
  assert.equal(noOp.state, "preview_ready");
  assert.deepEqual(noOp.baseline, d.baseline);
  assert.equal(noOp.review.reuseExistingBaseline, true);
  assert.deepEqual([noOp.review.added, noOp.review.changed, noOp.review.deleted], [0, 0, 0]);
  assert.deepEqual(await treeSnapshot(d.root), start);

  await writeFile(path.join(d.source, "Assets", "Change.txt"), "new saved content");
  await writeFile(path.join(d.source, "Assets", "Extra.txt"), "new");
  await unlink(path.join(d.source, "Assets", "Remove.txt"));
  const saved = await treeSnapshot(d.root);
  const changed = await runCli(cliOptions(d.input));
  assert.equal(changed.state, "preview_ready");
  assert.deepEqual(changed.baseline, d.baseline);
  assert.equal(changed.review.firstPublish, false);
  assert.equal(changed.review.reuseExistingBaseline, false);
  assert.deepEqual([changed.review.added, changed.review.changed, changed.review.deleted], [1, 1, 1]);
  assert.deepEqual(changed.review.addedPreview, ["Assets/Extra.txt"]);
  assert.deepEqual(changed.review.changedPreview, ["Assets/Change.txt"]);
  assert.deepEqual(changed.review.deletedPreview, ["Assets/Remove.txt"]);
  assert.deepEqual(await treeSnapshot(d.root), saved);
});

test("Host preview rejects wrong pins and requires the approved Host pointer", async t => {
  const d = await fixture(t);
  for (const mismatch of [{ projectUuid: randomUUID() }, { revision: 2 }, { manifestHash: "a".repeat(64) }, { descriptorHash: "b".repeat(64) }]) {
    await assert.rejects(previewHostCheckpoint({ ...d.input, ...mismatch }), { code: "host_preview_baseline_changed" });
  }
  const wrong = await runCli([...cliOptions(d.input), "--auth-token", "SYNTHETIC_PRIVATE_TEST_CODE"]);
  assert.equal(wrong.failure.rawCode, "invalid_host_preview_request");
  await unlink(d.approvedPath);
  await assert.rejects(previewHostCheckpoint(d.input), { code: "host_preview_baseline_changed" });
});

test("Host rechecks the same bytes and approved pointer once the source scan finishes", async t => {
  const d = await fixture(t);
  const launch = await loadLaunchSettings(d.input.launchSettingsPath);
  assert.equal(launch.digest, sha256(await readFile(launch.filePath)));
  const mutations = [
    [d.input.launchSettingsPath, JSON.stringify(d.launch, null, 2)],
    [d.sourcePath, JSON.stringify(d.sourceDescriptor, null, 2)],
    [d.approvedPath, JSON.stringify({ ...d.approved, baselineRevision: 2 })],
  ];
  for (const [file, next] of mutations) {
    const before = await readFile(file);
    await assert.rejects(previewHostCheckpoint(d.input, async options => {
      const observed = await buildManifest(options);
      await writeFile(file, next);
      return observed;
    }), { code: "host_preview_baseline_changed" });
    await writeFile(file, before);
  }
});

test("Host preview refuses a replacement launch file even if a clone has the same signed identity", async t => {
  const d = await fixture(t);
  await cp(d.source, path.join(d.root, "Clone"), { recursive: true });
  await writeFile(d.input.launchSettingsPath, JSON.stringify({ ...d.launch,
    sourceProjectRelativePath: "Clone", projectDescriptorRelativePath: "Clone/ProjectSettings/TeamForgeProject.json",
  }));
  let started = false;
  await assert.rejects(previewHostCheckpoint(d.input, async () => { started = true; }), { code: "host_preview_baseline_changed" });
  assert.equal(started, false);
});

test("Host review bounds previews without hiding the exact number of changed files", async t => {
  const d = await fixture(t);
  const deep = path.join(d.source, "Assets", ...Array(5).fill("d".repeat(140)));
  // Windows without a long-path test runner can still verify the count and
  // list boundary using regular-length filenames.
  const includeLongPath = process.platform !== "win32";
  if (includeLongPath) {
    await mkdir(deep, { recursive: true });
    await writeFile(path.join(deep, "too-long-to-display.txt"), "new");
  }
  for (let index = 0; index < 25; index++) {
    await writeFile(path.join(d.source, "Assets", `file-${index}.txt`), "new");
  }
  const { state, review } = await runCli(cliOptions(d.input));
  assert.equal(state, "preview_ready");
  assert.equal(review.added, includeLongPath ? 26 : 25);
  assert.ok(review.addedPreview.length <= 20);
  assert.equal(review.previewTruncated, true);
  assert.ok(review.addedPreview.every(value => Buffer.byteLength(value, "utf8") <= 640));
  assert.ok(!review.addedPreview.some(value => value.includes("too-long-to-display")));
});
