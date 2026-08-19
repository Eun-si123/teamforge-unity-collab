import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  WINDOWS_PATH_HIGH_RISK_LENGTH,
  WINDOWS_UNITY_PACKAGE_CACHE_HEADROOM,
  assessWindowsUnityActivePath,
} from "../src/cli-policy.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("WP5.1 shared path contract preserves the conservative field boundary", async () => {
  const contract = JSON.parse(await readFile(path.join(repositoryRoot, "project-peer/src/path-resilience-contract.json"), "utf8"));
  assert.equal(contract.schemaVersion, 1);
  assert.equal(WINDOWS_PATH_HIGH_RISK_LENGTH, 260);
  assert.equal(WINDOWS_UNITY_PACKAGE_CACHE_HEADROOM, 162);
  const field = assessWindowsUnityActivePath({
    managedRoot: "C:\\Users\\Dev\\Documents\\TeamForge Projects",
    projectUuid: "123e4567-e89b-42d3-a456-426614174000",
    baselineRevision: 3,
    manifestHash: "a".repeat(64),
    platform: "win32",
    packageCacheHeadroom: 180,
  });
  assert(field.highRisk);
  assert.match(field.recommendation, /select and verify a shorter Unity execution path/u);
});

test("WP5.1 Launcher manifest and router replace receive-time path rejection", async () => {
  const manifest = await readFile(path.join(repositoryRoot, "launcher/src/TeamForge.Launcher/app.manifest"), "utf8");
  assert.match(manifest, /<ws2:longPathAware>true<\/ws2:longPathAware>/u);
  const project = await readFile(path.join(repositoryRoot, "launcher/src/TeamForge.Launcher/TeamForge.Launcher.csproj"), "utf8");
  assert.match(project, /<ApplicationManifest>app\.manifest<\/ApplicationManifest>/u);
  const window = await readFile(path.join(repositoryRoot, "launcher/src/TeamForge.Launcher/MainWindow.xaml.cs"), "utf8");
  const inspection = window.slice(window.indexOf("private async Task CaptureInspectionStateAsync"), window.indexOf("private async void Receive_Click"));
  assert.doesNotMatch(inspection, /throw new BridgeException\(\s*"path_length_risk"/u);
  assert.match(window, /UnityPathStrategy\.PrepareAsync\(launchProject\)/u);
  assert.match(window, /CreateUnityOpenStartInfo\(editor, launchProject, _pendingAccessCode, preparedPath\)/u);
});

test("WP5.1 execution aliases remain separate from external reparse rejection", async () => {
  const safety = await readFile(path.join(repositoryRoot, "launcher/src/TeamForge.Launcher.Core/PathSafety.cs"), "utf8");
  assert.match(safety, /RequireNoReparsePointsOnExistingPath/u);
  assert.match(safety, /A symbolic link or reparse point is not allowed/u);
  const manager = await readFile(path.join(repositoryRoot, "launcher/src/TeamForge.Launcher.Core/ExecutionAliasManager.cs"), "utf8");
  assert.match(manager, /FsctlGetReparsePoint/u);
  assert.match(manager, /MountPointReparseTag/u);
  assert.match(manager, /VerifyImmediatelyBeforeLaunch/u);
  assert.match(manager, /An unrelated directory occupies the execution alias root/u);
  assert.doesNotMatch(manager, /\bsubst(?:\.exe)?\b|DefineDosDevice/iu);
});
