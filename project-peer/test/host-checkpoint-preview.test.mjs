import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { missingChangedAssetMetadata, previewHostCheckpoint, previewRetainedM4SourceChanges } from "../src/host-checkpoint-preview.mjs";
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
    assetFiles: { "Assets/Change.txt": "before", "Assets/Remove.txt": "old", "Assets/Stable.txt": "keep",
      "Assets/Scenes/Main.unity": "%YAML 1.1\n--- !u!1 &1\nGameObject: {}\n",
      "Assets/Scenes/Main.unity.meta": "fileFormatVersion: 2\nguid: abcdefabcdefabcdefabcdefabcdefab\n",
      "Assets/Enemy.prefab": "Original Prefab content",
      "Assets/Enemy.prefab.meta": "fileFormatVersion: 2\nguid: 99999999999999999999999999999999\n" },
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
  assert.equal(noOp.transition.status, "no_saved_changes");
  assert.equal(noOp.transition.retainedSceneCount, 1);
  assert.equal(noOp.transition.blockerCount, 0);
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
  assert.equal(changed.transition.status, "source_reconciliation_required",
    "The synthetic added Assets/Extra.txt deliberately has no Unity .meta companion.");
  assert.ok(changed.transition.blockersPreview.includes("Assets/Extra.txt"));
  assert.equal(changed.transition.priorAssetChangeCount, 2,
    "Previously shared non-Prefab Assets are not automatically safe to modify or delete.");
  assert.equal(changed.transition.retainedSceneCount, 1);
  assert.deepEqual(await treeSnapshot(d.root), saved);
});

test("M5 signed preview warns for newly imported Unity Asset missing .meta without approving or mutating files", async t => {
  const d = await fixture(t);
  const base = path.join(d.source, "Assets");
  await writeFile(path.join(base, "ExternalCharacter.fbx"), "synthetic FBX bytes");
  await writeFile(path.join(base, "Imported.prefab"), "synthetic Prefab bytes");
  await writeFile(path.join(base, "Imported.prefab.meta"), "fileFormatVersion: 2\nguid: 12345678901234567890123456789012\n");
  const saved = await treeSnapshot(d.root);
  const result = await runCli(cliOptions(d.input));
  assert.equal(result.state, "preview_ready");
  assert.equal(result.review.reuseExistingBaseline, false);
  assert.equal(result.review.missingAssetMetaCount, 1);
  assert.deepEqual(result.review.missingAssetMetaPreview, ["Assets/ExternalCharacter.fbx"]);
  assert.equal(result.review.missingAssetMetaTruncated, false);
  assert.deepEqual(await treeSnapshot(d.root), saved, "Read-only preview must never generate a new .meta or publish.");
  await writeFile(path.join(base, "ExternalCharacter.fbx.meta"),
    "fileFormatVersion: 2\nguid: abcdefabcdefabcdefabcdefabcdefab\n");
  const repaired = await runCli(cliOptions(d.input));
  assert.equal(repaired.state, "preview_ready");
  assert.equal(repaired.review.missingAssetMetaCount, 0);
  assert.deepEqual(repaired.review.missingAssetMetaPreview, []);
  assert.equal(repaired.review.missingAssetMetaTruncated, false);
});

test("M5 missing .meta report handles deleted companions, legacy no-meta, bounded previews and non-Assets packages", () => {
  const manifest = { files: [
    { path: "Assets/Existing.prefab" },
    { path: "Assets/NewMaterial.mat" },
    { path: "Assets/Complete.fbx" },
    { path: "Assets/Complete.fbx.meta" },
    { path: "Packages/com.example.embedded/Runtime/Tool.cs" },
  ] };
  const review = {
    added: ["Assets/NewMaterial.mat", "Assets/Complete.fbx", "Packages/com.example.embedded/Runtime/Tool.cs"],
    changed: [],
    deleted: ["Assets/Existing.prefab.meta"],
  };
  assert.deepEqual(missingChangedAssetMetadata(manifest, review),
    ["Assets/Existing.prefab", "Assets/NewMaterial.mat"]);
  assert.deepEqual(missingChangedAssetMetadata(manifest, {
    added: [], changed: [], deleted: [],
  }), [], "An unchanged pre-existing no-meta fixture must not cause unrelated new warnings.");
  assert.equal(missingChangedAssetMetadata(manifest, {
    added: [], changed: [], deleted: ["Assets/Orphan.prefab.meta"],
  }).length, 0, "An absent owner must not be mistaken for a live asset missing its companion.");
});

test("M4->M5 signed source preflight flags Scene, prior meta, Prefab, C# and Package drift without writes", async t => {
  const d = await fixture(t);
  const source = d.source;
  const originalScene = path.join(source, "Assets/Scenes/Main.unity");
  const originalMeta = `${originalScene}.meta`;
  const script = path.join(source, "Assets/Character.cs");
  const prefab = path.join(source, "Assets/Enemy.prefab");
  const imported = path.join(source, "Assets/ExternalCharacter.fbx");
  const importedMeta = `${imported}.meta`;
  // New marketplace Assets with original metadata can pass the *source-side*
  // unchanged Scene check; this is still NOT permission to commit a live M4
  // checkpoint or update another participant's Active Project.
  await writeFile(imported, "synthetic FBX");
  await writeFile(importedMeta, "fileFormatVersion: 2\nguid: 12345678901234567890123456789012\n");
  const initial = await runCli(cliOptions(d.input));
  assert.equal(initial.transition.status, "source_inputs_unchanged");
  assert.equal(initial.transition.blockerCount, 0);

  const cases = [
    { file: originalScene, action: async () => writeFile(originalScene, "modified Scene source"), label: "Scene" },
    { file: originalMeta, action: async () => unlink(originalMeta), label: "Scene metadata" },
    { file: script, action: async () => writeFile(script, "public class Character {}"), label: "C#" },
    { file: prefab, action: async () => writeFile(prefab, "Prefab: {}"), label: "Prefab" },
    { file: path.join(source, "Packages/manifest.json"),
      action: async () => writeFile(path.join(source, "Packages/manifest.json"), '{"dependencies":{"com.example.m4":"1.0.0"}}'), label: "Package" },
  ];
  for (const { file, action, label } of cases) {
    const previous = await readFile(file).catch(error => error.code === "ENOENT" ? null : Promise.reject(error));
    await action();
    const snapshot = await treeSnapshot(d.root);
    const result = await runCli(cliOptions(d.input));
    assert.equal(result.state, "preview_ready", label);
    assert.equal(result.transition.status, "source_reconciliation_required", label);
    assert.ok(result.transition.blockerCount > 0, label);
    assert.ok(result.transition.blockersPreview.length > 0, label);
    assert.deepEqual(await treeSnapshot(d.root), snapshot, `${label} preflight must be read-only`);
    if (previous !== null) await writeFile(file, previous);
    else await unlink(file);
  }
});

test("M4 signed source preview is conservative for missing old Scene .meta and bounds large conflict lists", () => {
  const before = { files: [
    { path: "Assets/Scenes/Main.unity" },
    { path: "Assets/Old.prefab" },
    { path: "Assets/Old.prefab.meta" },
  ] };
  const after = { files: [
    ...before.files,
    ...Array.from({ length: 30 }, (_, index) => ({ path: `Assets/Script${index}.cs` })),
  ] };
  const changed = {
    added: Array.from({ length: 30 }, (_, index) => `Assets/Script${index}.cs`),
    changed: [], deleted: [],
  };
  const readOnly = previewRetainedM4SourceChanges(before, after, changed);
  assert.equal(readOnly.status, "source_reconciliation_required");
  assert.equal(readOnly.retainedSceneCount, 1);
  assert.equal(readOnly.sceneSourceChangeCount, 1, "Missing original Scene metadata forbids silent future M4 rebind.");
  assert.equal(readOnly.runtimeSourceChangeCount, 30);
  assert.equal(readOnly.blockerCount, 31);
  assert.ok(readOnly.blockersPreview.length <= 12);
  assert.equal(readOnly.blockersTruncated, true);
  assert.equal(readOnly.blockersPreview.length, 12);
});

test("M5 source preflight refuses silent replacement of prior FBX, material or texture references", () => {
  const original = { files: [
    "Assets/Scenes/Main.unity", "Assets/Scenes/Main.unity.meta",
    "Assets/Imported/Hero.fbx", "Assets/Imported/Hero.fbx.meta",
    "Assets/Imported/Hero.mat", "Assets/Imported/Hero.mat.meta",
    "Assets/Imported/Color.png", "Assets/Imported/Color.png.meta",
  ].map(path => ({path})) };
  const result = previewRetainedM4SourceChanges(original, original, {
    added:[], changed:["Assets/Imported/Hero.fbx", "Assets/Imported/Hero.mat", "Assets/Imported/Color.png"], deleted:[],
  });
  assert.equal(result.status, "source_reconciliation_required");
  assert.equal(result.sceneSourceChangeCount, 0);
  assert.equal(result.priorAssetChangeCount, 3);
  assert.equal(result.blockerCount, 3);
  assert.deepEqual(result.blockersPreview, [
    "Assets/Imported/Color.png", "Assets/Imported/Hero.fbx", "Assets/Imported/Hero.mat",
  ]);
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
