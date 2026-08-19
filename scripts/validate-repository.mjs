import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ignoredDirectories = new Set([
  "node_modules",
  "Library",
  "Temp",
  "Logs",
  "UserSettings",
  "obj",
  "bin",
  "work",
  ".tmp-npm-server",
  ".tmp-npm-peer",
  ".git",
  ".agents",
  ".codex",
]);

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }

    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path)));
    } else if (entry.isFile() && !entry.name.endsWith(".zip") && !entry.name.endsWith(".zip.sha256")) {
      files.push(path);
    }
  }
  return files;
}

function removeCSharpStringsAndComments(source) {
  let output = "";
  let mode = "code";
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1] ?? "";

    if (mode === "line-comment") {
      if (character === "\n") {
        mode = "code";
        output += "\n";
      } else {
        output += " ";
      }
      continue;
    }

    if (mode === "block-comment") {
      if (character === "*" && next === "/") {
        output += "  ";
        index += 1;
        mode = "code";
      } else {
        output += character === "\n" ? "\n" : " ";
      }
      continue;
    }

    if (mode === "string" || mode === "character") {
      output += character === "\n" ? "\n" : " ";
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if ((mode === "string" && character === '"') || (mode === "character" && character === "'")) {
        mode = "code";
      }
      continue;
    }

    if (mode === "verbatim-string") {
      output += character === "\n" ? "\n" : " ";
      if (character === '"' && next === '"') {
        output += " ";
        index += 1;
      } else if (character === '"') {
        mode = "code";
      }
      continue;
    }

    if (character === "/" && next === "/") {
      output += "  ";
      index += 1;
      mode = "line-comment";
    } else if (character === "/" && next === "*") {
      output += "  ";
      index += 1;
      mode = "block-comment";
    } else if ((character === "@" && next === '"') ||
               (character === "$" && next === "@" && source[index + 2] === '"') ||
               (character === "@" && next === "$" && source[index + 2] === '"')) {
      const consumed = next === '"' ? 2 : 3;
      output += " ".repeat(consumed);
      index += consumed - 1;
      mode = "verbatim-string";
    } else if ((character === "$" && next === '"') || character === '"') {
      const consumed = character === "$" ? 2 : 1;
      output += " ".repeat(consumed);
      index += consumed - 1;
      mode = "string";
    } else if (character === "'") {
      output += " ";
      mode = "character";
    } else {
      output += character;
    }
  }

  assert.equal(mode, "code", `Unterminated C# lexical construct (${mode}).`);
  return output;
}

function assertBalancedCSharp(source, file) {
  const stripped = removeCSharpStringsAndComments(source);
  const pairs = { "{": "}", "(": ")", "[": "]" };
  const closing = new Set(Object.values(pairs));
  const stack = [];

  for (const character of stripped) {
    if (pairs[character]) {
      stack.push(pairs[character]);
    } else if (closing.has(character)) {
      assert.equal(stack.pop(), character, `Unbalanced delimiter in ${relative(root, file)}.`);
    }
  }

  assert.equal(stack.length, 0, `Unclosed delimiter in ${relative(root, file)}.`);
}

function assertNoDuplicateCSharpFields(source, file) {
  const stripped = removeCSharpStringsAndComments(source);
  const classPattern = /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)[^\{]*\{/g;
  for (const match of stripped.matchAll(classPattern)) {
    const className = match[1];
    const openingBrace = match.index + match[0].lastIndexOf("{");
    let depth = 1;
    let cursor = openingBrace + 1;
    while (cursor < stripped.length && depth > 0) {
      if (stripped[cursor] === "{") depth += 1;
      if (stripped[cursor] === "}") depth -= 1;
      cursor += 1;
    }
    assert.equal(depth, 0, `Could not bound class ${className} in ${relative(root, file)}.`);
    const body = stripped.slice(openingBrace + 1, cursor - 1);
    let memberDepth = 0;
    let directMembers = "";
    for (const character of body) {
      if (character === "{") {
        memberDepth += 1;
        directMembers += " ";
      } else if (character === "}") {
        memberDepth -= 1;
        directMembers += " ";
      } else {
        directMembers += memberDepth === 0 ? character : " ";
      }
    }
    const fields = new Set();
    const fieldPattern = /\bpublic\s+(?:static\s+)?(?:readonly\s+)?[A-Za-z_][A-Za-z0-9_<>.,\[\]?]*\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:=[^;]*)?;/g;
    for (const field of directMembers.matchAll(fieldPattern)) {
      assert(!fields.has(field[1]), `Duplicate public field ${className}.${field[1]} in ${relative(root, file)}.`);
      fields.add(field[1]);
    }
  }
}

const files = await collectFiles(root);
assert(files.length > 0, "Repository validation requires a non-empty source or staged candidate tree.");
const requiredFiles = [
  "README.md",
  "release-contract.json",
  "global.json",
  "docs/ux-bootstrap-wp0-current-flow-audit.md",
  "docs/changed-files-ux-bootstrap-wp0.md",
  "docs/ux-bootstrap-wp1-unified-preflight-report.md",
  "docs/changed-files-ux-bootstrap-wp1.md",
  "docs/ux-bootstrap-wp2-lifecycle-manager-report.md",
  "docs/changed-files-ux-bootstrap-wp2.md",
  "docs/ux-bootstrap-wp3-one-click-host-report.md",
  "docs/changed-files-ux-bootstrap-wp3.md",
  "docs/ux-bootstrap-wp35-runtime-packaging-security-report.md",
  "docs/changed-files-ux-bootstrap-wp35.md",
  "server/package.json",
  "server/package-lock.json",
  "server/src/lifecycle-child.mjs",
  "server/src/teamforge-server.mjs",
  "server/src/policy-profile.mjs",
  "server/src/project-coordinator.mjs",
  "server/src/project-coordinator-core.mjs",
  "server/src/hierarchy-model.mjs",
  "server/src/session-authority.mjs",
  "server/test/hierarchy-model.test.mjs",
  "server/test/session-authority.test.mjs",
  "server/test/server.test.mjs",
  "server/test/project-coordinator.test.mjs",
  "server/test/project-coordinator-core.test.mjs",
  "server/test/policy-profile.test.mjs",
  "project-peer/package.json",
  "project-peer/package-lock.json",
  "project-peer/README.md",
  "project-peer/src/cli.mjs",
  "project-peer/src/cli-policy.mjs",
  "project-peer/src/orchestrator-contract.mjs",
  "project-peer/src/process-lifecycle.mjs",
  "project-peer/src/publication-plan.mjs",
  "project-peer/src/host-orchestrator.mjs",
  "project-peer/src/host-orchestrator-cli.mjs",
  "project-peer/src/url-policy.mjs",
  "project-peer/src/unified-preflight.mjs",
  "project-peer/src/preflight-cli.mjs",
  "project-peer/src/policy-profile.mjs",
  "project-peer/src/project-peer.mjs",
  "project-peer/src/manifest.mjs",
  "project-peer/src/transfer-source.mjs",
  "project-peer/src/direct-transfer-client.mjs",
  "project-peer/src/direct-transfer-server.mjs",
  "project-peer/src/swarm-downloader.mjs",
  "project-peer/support/download-child.mjs",
  "project-peer/test/transport-e2e.test.mjs",
  "project-peer/test/cli-policy.test.mjs",
  "project-peer/test/orchestrator-contract.test.mjs",
  "project-peer/test/process-lifecycle.test.mjs",
  "project-peer/test/host-orchestrator.test.mjs",
  "project-peer/test/unified-preflight.test.mjs",
  "scripts/build-runtime-bundle.mjs",
  "scripts/verify-runtime-bundle.mjs",
  "project-peer/test/identity-descriptor.test.mjs",
  "project-peer/test/transfer-source-contract.test.mjs",
  "project-peer/test/policy-profile.test.mjs",
  "unity-package/com.eunsung.teamforge/package.json",
  "unity-package/com.eunsung.teamforge/Editor/AssemblyInfo.cs",
  "unity-package/com.eunsung.teamforge/Editor/Connection/TeamForgeConnectionService.cs",
  "unity-package/com.eunsung.teamforge/Editor/Connection/ConnectionStrategy.cs",
  "unity-package/com.eunsung.teamforge/Editor/Settings/TeamForgeProfile.cs",
  "unity-package/com.eunsung.teamforge/Editor/Transport/IRealtimeTransport.cs",
  "unity-package/com.eunsung.teamforge/Editor/Transport/ClientWebSocketTransport.cs",
  "unity-package/com.eunsung.teamforge/Editor/Transport/RealtimeTransportFactory.cs",
  "unity-package/com.eunsung.teamforge/Editor/Authority/TeamForgeAuthorityView.cs",
  "unity-package/com.eunsung.teamforge/Editor/Presence/TeamForgeObjectIdentity.cs",
  "unity-package/com.eunsung.teamforge/Editor/Presence/TeamForgePresenceService.cs",
  "unity-package/com.eunsung.teamforge/Editor/TransformSync/TeamForgeTransformModel.cs",
  "unity-package/com.eunsung.teamforge/Editor/TransformSync/TeamForgeTransformSyncService.cs",
  "unity-package/com.eunsung.teamforge/Editor/HierarchySync/TeamForgeHierarchyIdentityRegistry.cs",
  "unity-package/com.eunsung.teamforge/Editor/HierarchySync/TeamForgeHierarchyModel.cs",
  "unity-package/com.eunsung.teamforge/Editor/HierarchySync/TeamForgeHierarchySyncService.cs",
  "unity-package/com.eunsung.teamforge/Editor/ProjectTransfer/TeamForgeProjectModel.cs",
  "unity-package/com.eunsung.teamforge/Editor/ProjectTransfer/TeamForgeProjectService.cs",
  "unity-package/com.eunsung.teamforge/Editor/ProjectTransfer/TeamForgeProjectValidation.cs",
  "unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeHomeWindow.cs",
  "unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeHostFlow.cs",
  "unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeRuntimeDiscovery.cs",
  "unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeRuntimeManifest.g.cs",
  "unity-package/com.eunsung.teamforge/Runtime~/runtime-manifest.json",
  "unity-package/com.eunsung.teamforge/Runtime~/platforms/win-x64/node.exe",
  "unity-package/com.eunsung.teamforge/Runtime~/platforms/win-x64/LICENSE",
  "unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeJoinCode.cs",
  "unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeDoctor.cs",
  "unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeBaselineFingerprint.cs",
  "unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeInviteCache.cs",
  "unity-package/com.eunsung.teamforge/Editor/Testing/TeamForgeTestLab.cs",
  "unity-package/com.eunsung.teamforge/Editor/Testing/TeamForgeTestLabWindow.cs",
  "unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeEditorSurfaceTests.cs",
  "unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeUxTests.cs",
  "unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeHierarchyModelTests.cs",
  "unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeGoldenCompatibilityTests.cs",
  "unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeAuthorityViewTests.cs",
  "unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeConnectionCompositionTests.cs",
  "unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgePolicyProfileTests.cs",
  "unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeProjectProtocolTests.cs",
  "unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeIdentityAuthorityAuditTests.cs",
  "unity-package/com.eunsung.teamforge/Tests/Fixtures/teamforge-compatibility-v1.json",
  "unity-project/ProjectSettings/ProjectVersion.txt",
  "docs/decisions/phase-0.md",
  "docs/decisions/phase-1.md",
  "docs/phase-1-test-report.md",
  "docs/phase-2-test-report.md",
  "docs/roadmap.md",
  "docs/project-state.md",
  "docs/architecture-decisions.md",
  "docs/known-issues.md",
  "docs/deployment.md",
  "docs/phases/phase-0.md",
  "docs/phases/phase-1.md",
  "docs/phases/phase-2.md",
  "docs/phases/phase-3.md",
  "docs/phase-3-test-report.md",
  "docs/phase-3-manual-test-checklist.md",
  "docs/phase-3-v0.4.1-patch-report.md",
  "docs/phase-3-v0.4.1-test-report.md",
  "docs/phase-3-v0.4.1-manual-test-checklist.md",
  "docs/phase-3-v0.4.1-unity-hotfix-report.md",
  "docs/changed-files-v0.4.1.md",
  "docs/rollback-v0.4.1.md",
  "docs/phases/phase-4.md",
  "docs/phase-4-v0.5.0-implementation-report.md",
  "docs/phase-4-v0.5.0-test-report.md",
  "docs/phase-4-v0.5.0-manual-test-checklist.md",
  "docs/phase-4-v0.5.0-hotfix3-report.md",
  "docs/work-state/PHASE4_HOTFIX3_SESSION.md",
  "docs/changed-files-v0.5.0.md",
  "docs/known-issues-v0.5.0.md",
  "docs/rollback-v0.5.0.md",
  "docs/protocol-v1.md",
  "docs/protocol-project-transfer-v1.md",
  "docs/decisions/phase-4.5.md",
  "docs/phase-4.5-field-closure-checklist.md",
  "docs/phase-4.5-rollback-reference.md",
  "docs/phase-4.5-closure-report.md",
  "docs/phase-4.5-test-report.md",
  "docs/changed-files-phase-4.5-closure.md",
  "docs/phase-4.5-wp8-field-hotfix-saved-transform-identity-report.md",
  "docs/phase-4.5-wp8-field-hotfix-checklist.md",
  "docs/changed-files-phase-4.5-wp8-field-hotfix.md",
  "docs/phase-4.5-wp8-identity-authority-audit-report.md",
  "docs/phase-4.5-wp8-identity-contract-matrix.md",
  "docs/phase-4.5-wp8-identity-authority-audit-test-evidence.md",
  "docs/phase-4.5-wp8-identity-authority-audit-field-checklist.md",
  "docs/changed-files-phase-4.5-wp8-identity-authority-audit.md",
  "docs/phase-4.5-wp8-identity-authority-test-reconciliation-hotfix-report.md",
  "docs/phase-4.5-wp8-identity-authority-rearm-rootcause-hotfix-report.md",
  "docs/changed-files-phase-4.5-wp8-identity-authority-rearm-rootcause-hotfix.md",
  "docs/phase-4.5-wp1-characterization-report.md",
  "docs/changed-files-phase-4.5-wp1.md",
  "docs/phase-4.5-wp2-server-authority-core-report.md",
  "docs/changed-files-phase-4.5-wp2.md",
  "docs/phase-4.5-wp5-transport-strategy-report.md",
  "docs/changed-files-phase-4.5-wp5.md",
  "docs/phase-4.5-wp6-transfer-source-report.md",
  "docs/changed-files-phase-4.5-wp6.md",
  "docs/phase-4.5-wp7-policy-profile-report.md",
  "docs/changed-files-phase-4.5-wp7.md",
  "project-peer/src/bootstrap-invite.mjs",
  "project-peer/src/filesystem-safety.mjs",
  "project-peer/src/guest-destination.mjs",
  "project-peer/src/guest-orchestrator.mjs",
  "project-peer/src/guest-orchestrator-cli.mjs",
  "project-peer/src/guest-state.mjs",
  "project-peer/src/guest-trust.mjs",
  "project-peer/test/bootstrap-invite.test.mjs",
  "project-peer/test/guest-active-validation.test.mjs",
  "project-peer/test/guest-bridge.test.mjs",
  "project-peer/test/guest-orchestrator.test.mjs",
  "project-peer/test/guest-refresh.test.mjs",
  "project-peer/test/guest-safety.test.mjs",
  "project-peer/test/wp4-unity-host-handoff-static.test.mjs",
  "project-peer/test/wp5-diagnostics-recovery.test.mjs",
  "unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeGuestHandoff.cs",
  "unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeGuestHandoff.cs.meta",
  "unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeRecoveryUx.cs",
  "unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeRecoveryUx.cs.meta",
  "launcher/README.md",
  "launcher/Directory.Build.props",
  "launcher/runtime-loader.mjs",
  "launcher/test/runtime-loader.test.mjs",
  "launcher/src/TeamForge.Launcher.Core/BridgeClient.cs",
  "launcher/src/TeamForge.Launcher.Core/EnvironmentPolicy.cs",
  "launcher/src/TeamForge.Launcher.Core/GuestUiContract.cs",
  "launcher/src/TeamForge.Launcher.Core/RuntimeLayout.cs",
  "launcher/src/TeamForge.Launcher.Core/DiagnosticsRecovery.cs",
  "launcher/src/TeamForge.Launcher.Core/UnityLaunchPolicy.cs",
  "launcher/src/TeamForge.Launcher/App.xaml.cs",
  "launcher/src/TeamForge.Launcher/MainWindow.xaml",
  "launcher/src/TeamForge.Launcher/MainWindow.xaml.cs",
  "launcher/src/TeamForge.Launcher/RuntimePins.g.cs",
  "launcher/win-x64/launcher-manifest.json",
  "launcher/tests/TeamForge.Launcher.Core.Tests/Program.cs",
  "scripts/build-wp4-launcher.mjs",
  "scripts/stage-wp4-release.mjs",
  "scripts/verify-wp4-launcher.mjs",
  "scripts/verify-wp4-archive.ps1",
  "scripts/test-wp4-archive-verifier.ps1",
  "WP4-Field-Hotfix-Report.md",
  "Release-Integrity-Audit.md",
  "changed-files-wp4-release-integrity-hotfix.md",
  "supported-entrypoints-inventory.md",
  "dependency-runtime-version-audit.md",
  "executable-smoke-results.md",
  "historical-files-retained.txt",
  "removed-deprecated-obsolete-files.md",
  "Windows-Field-Test-Checklist-WP4-Hotfix.md",
  "WP5-Diagnostics-Recovery-UX-Report.md",
  "changed-files-wp5.md",
  "Windows-Field-Test-Checklist-WP5.md",
  "executable-smoke-results-wp5.md",
];

for (const required of requiredFiles) {
  assert(files.includes(join(root, required)), `Missing required file: ${required}`);
}

for (const file of files.filter((path) => path.endsWith(".json"))) {
  JSON.parse(await readFile(file, "utf8"));
}

for (const file of files.filter((path) => path.endsWith(".md"))) {
  const markdown = await readFile(file, "utf8");
  for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const destination = match[1].trim().split("#", 1)[0];
    if (!destination || /^(?:https?:|mailto:|sandbox:)/u.test(destination)) {
      continue;
    }
    const localPath = resolve(file, "..", destination);
    assert(
      files.includes(localPath),
      `Broken local Markdown link in ${relative(root, file)}: ${destination}`,
    );
  }
}

for (const file of files.filter((path) => path.endsWith(".cs"))) {
  const source = await readFile(file, "utf8");
  assertBalancedCSharp(source, file);
  assertNoDuplicateCSharpFields(source, file);
  assert(!source.includes("UnityEngine.Object.GetInstanceID"), `Cross-editor ID must not use Instance ID: ${file}`);
  const executableSource = removeCSharpStringsAndComments(source);
  assert(
    !/\b(?:UnityEditor\.)?Progress\s*\.(?:Start|Report|Finish|Remove|GetStatus)\s*\(/u.test(executableSource),
    `Unexpected Unity Progress API lifecycle was introduced in ${relative(root, file)}.`,
  );
}

const editorTestSources = await Promise.all(
  files
    .filter((path) => {
      const portablePath = relative(root, path).replaceAll("\\", "/");
      return portablePath.startsWith("unity-package/com.eunsung.teamforge/Tests/Editor/") &&
             portablePath.endsWith(".cs");
    })
    .map((path) => readFile(path, "utf8")),
);
const editorTestCaseCount = editorTestSources.reduce((count, source) => {
  const stripped = removeCSharpStringsAndComments(source);
  return count +
    (stripped.match(/\[Test(?:Attribute)?\s*\]/g)?.length ?? 0) +
    (stripped.match(/\[UnityTest(?:Attribute)?\s*\]/g)?.length ?? 0) +
    (stripped.match(/\[TestCase(?:Attribute)?\s*(?:\([^\]]*\))?\s*\]/g)?.length ?? 0);
}, 0);
assert(
  editorTestCaseCount >= 125,
  `Unity Editor compatibility suite unexpectedly shrank below the frozen 125-case baseline (${editorTestCaseCount}).`,
);

const unityPackageRoot = join(root, "unity-package/com.eunsung.teamforge");
const unityAssetFiles = files.filter(
  (path) => path.startsWith(unityPackageRoot) && (path.endsWith(".cs") || path.endsWith(".asmdef")),
);
for (const file of unityAssetFiles) {
  assert(files.includes(`${file}.meta`), `Missing Unity meta file: ${relative(root, file)}.meta`);
}

const unityMetaGuids = new Set();
for (const metaFile of files.filter((path) => path.startsWith(unityPackageRoot) && path.endsWith(".meta"))) {
  const source = await readFile(metaFile, "utf8");
  const guid = source.match(/^guid:\s*([0-9a-f]{32})$/m)?.[1];
  assert(guid, `Invalid Unity GUID in ${relative(root, metaFile)}.`);
  assert(!unityMetaGuids.has(guid), `Duplicate Unity GUID ${guid}.`);
  unityMetaGuids.add(guid);
}

const releaseContract = JSON.parse(await readFile(join(root, "release-contract.json"), "utf8"));
assert.equal(releaseContract.schemaVersion, 1);
assert.equal(releaseContract.product, "Unity TeamForge");
assert.match(releaseContract.productVersion, /^\d+\.\d+\.\d+$/u);
assert.equal(releaseContract.releaseId, `${releaseContract.productVersion}-wp5.1-path-resilience`);
assert.equal(releaseContract.workPackage, "UX Bootstrap WP5.1 Path Resilience & Automatic Short Workspace");
assert.equal(releaseContract.target, "win-x64");
assert.equal(releaseContract.status, "FIELD_BLOCKED",
  "WP4 cannot be marked closed before the manual two-PC Windows field gate.");
assert.deepEqual(releaseContract.protocols, {
  realtime: 1,
  projectTransfer: 1,
  projectManifest: 1,
  runtimeManifest: 1,
  launcherManifest: 1,
  releaseManifest: 1,
});
assert.equal(releaseContract.unity.packageLine, "6000.3");
assert.match(releaseContract.unity.testedEditor, /^6000\.3\.\d+f\d+$/u);
assert.equal(releaseContract.node.version, "24.19.0");
assert.deepEqual(releaseContract.node.supportedMajors, [22, 24]);
assert.deepEqual(releaseContract.node.minimumVersions, { 22: "22.23.2", 24: "24.18.1" });
assert.equal(releaseContract.ws.version, "8.21.3");
assert.match(releaseContract.ws.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/u);
assert.equal(releaseContract.dotnet.targetFramework, "net10.0-windows");
assert.equal(releaseContract.dotnet.runtimeVersion, "10.0.11");
assert.equal(releaseContract.dotnet.testedSdk, "10.0.303");
assert.equal(releaseContract.npm.version, "11.19.0");
assert.equal(releaseContract.npm.lockfileVersion, 3);
assert.equal(releaseContract.launcher.signed, false);

const globalJson = JSON.parse(await readFile(join(root, "global.json"), "utf8"));
assert.equal(globalJson.sdk.version, releaseContract.dotnet.testedSdk);
assert.equal(globalJson.sdk.rollForward, "latestPatch");
assert.equal(globalJson.sdk.allowPrerelease, false);
const releaseManifestPath = join(root, "release-manifest.json");
const releaseManifest = files.includes(releaseManifestPath)
  ? JSON.parse(await readFile(releaseManifestPath, "utf8"))
  : null;
if (releaseManifest) {
  assert.equal(releaseManifest.schemaVersion, releaseContract.protocols.releaseManifest);
  assert.equal(releaseManifest.product, releaseContract.product);
  assert.equal(releaseManifest.productVersion, releaseContract.productVersion);
  assert.equal(releaseManifest.releaseId, releaseContract.releaseId);
  assert.equal(releaseManifest.workPackage, releaseContract.workPackage);
  assert.equal(releaseManifest.target, releaseContract.target);
  assert.equal(releaseManifest.status, releaseContract.status);
  assert.equal(releaseManifest.releaseContractSha256,
    createHash("sha256").update(await readFile(join(root, "release-contract.json"))).digest("hex"));
}
for (const operationalRelative of [
  "README.md",
  "server/README.md",
  "project-peer/README.md",
  "launcher/README.md",
  "unity-package/com.eunsung.teamforge/README.md",
  "unity-package/com.eunsung.teamforge/Documentation~/index.md",
  "unity-project/README.md",
  "docs/project-state.md",
  "docs/roadmap.md",
  "docs/known-issues.md",
  "docs/deployment.md",
  "docs/compatibility.md",
]) {
  const operationalText = await readFile(join(root, operationalRelative), "utf8");
  assert(operationalText.includes(releaseContract.productVersion),
    `Current operational document omits product ${releaseContract.productVersion}: ${operationalRelative}`);
  assert(!/Node(?:\.js)?\s+20(?:\s|\+|$)|Node\.js 20 or newer/iu.test(operationalText),
    `Current operational document advertises obsolete Node 20: ${operationalRelative}`);
  assert(!/validate-hotfix-windows\.ps1/u.test(operationalText),
    `Current operational document advertises the removed Phase 3 validator: ${operationalRelative}`);
  assert(!/(?:current|normal|requires|version-aligned)[^\n]{0,100}(?:0\.5\.0|0\.4\.1)/iu.test(operationalText),
    `Current operational document makes an obsolete product-version claim: ${operationalRelative}`);
}

const unityPackage = JSON.parse(
  await readFile(join(root, "unity-package/com.eunsung.teamforge/package.json"), "utf8"),
);
assert.equal(unityPackage.unity, releaseContract.unity.packageLine);
assert.equal(unityPackage.name, "com.eunsung.teamforge");
assert.equal(unityPackage.version, releaseContract.productVersion);

const workspacePackage = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const workspaceLock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
const serverPackage = JSON.parse(await readFile(join(root, "server/package.json"), "utf8"));
const serverLock = JSON.parse(await readFile(join(root, "server/package-lock.json"), "utf8"));
const peerPackage = JSON.parse(await readFile(join(root, "project-peer/package.json"), "utf8"));
const peerLock = JSON.parse(await readFile(join(root, "project-peer/package-lock.json"), "utf8"));
assert.equal(workspacePackage.version, unityPackage.version, "Workspace and Unity package versions differ.");
assert.equal(workspacePackage.packageManager, `npm@${releaseContract.npm.version}`);
assert.equal(workspaceLock.version, releaseContract.productVersion);
assert.equal(workspaceLock.packages[""].version, releaseContract.productVersion);
assert.equal(workspaceLock.lockfileVersion, releaseContract.npm.lockfileVersion);
assert.equal(serverPackage.version, unityPackage.version, "Server and Unity package versions differ.");
assert.equal(serverLock.version, serverPackage.version, "Server package and lockfile versions differ.");
assert.equal(serverLock.packages[""].version, serverPackage.version);
assert.equal(serverLock.lockfileVersion, releaseContract.npm.lockfileVersion);
assert.equal(peerPackage.version, unityPackage.version, "Project Peer and Unity package versions differ.");
assert.equal(peerLock.version, peerPackage.version, "Project Peer package and lockfile versions differ.");
assert.equal(peerLock.packages[""].version, peerPackage.version);
assert.equal(peerLock.lockfileVersion, releaseContract.npm.lockfileVersion);
assert.equal(peerPackage.bin["teamforge-project-peer"], "src/cli.mjs", "Existing Project Peer CLI must remain.");
assert.equal(peerPackage.bin["teamforge-preflight"], "src/preflight-cli.mjs");
assert.equal(serverPackage.engines.node, ">=22.23.2 <23 || >=24.18.1 <25");
assert.equal(peerPackage.engines.node, ">=22.23.2 <23 || >=24.18.1 <25");
assert.equal(peerLock.packages[""].bin["teamforge-project-peer"], "src/cli.mjs");
assert.equal(peerLock.packages[""].bin["teamforge-preflight"], "src/preflight-cli.mjs");
assert.equal(workspacePackage.scripts.preflight, "node project-peer/src/preflight-cli.mjs inspect");
assert.match(workspacePackage.scripts["repair:dependencies"], /repair-dependencies --confirm-repair/u);
assert.equal(
  workspacePackage.scripts["install:server"],
  "npm --prefix server ci --ignore-scripts --workspaces=false",
  "The isolated Server install must not hoist its production dependency into the workspace root.",
);
assert.equal(
  workspacePackage.scripts["install:peer"],
  "npm --prefix project-peer ci --ignore-scripts --workspaces=false",
  "The isolated Project Peer install must not hoist its production dependency into the workspace root.",
);

const projectVersion = await readFile(join(root, "unity-project/ProjectSettings/ProjectVersion.txt"), "utf8");
assert.match(projectVersion,
  new RegExp(`^m_EditorVersion: ${releaseContract.unity.testedEditor.replaceAll(".", "\\.")}$`, "m"));

const serverProtocol = await readFile(join(root, "server/src/protocol.mjs"), "utf8");
const serverHost = await readFile(join(root, "server/src/teamforge-server.mjs"), "utf8");
const serverProjectCoordinator = await readFile(join(root, "server/src/project-coordinator.mjs"), "utf8");
const serverProjectCoordinatorCore = await readFile(
  join(root, "server/src/project-coordinator-core.mjs"),
  "utf8",
);
const serverHierarchyModel = await readFile(join(root, "server/src/hierarchy-model.mjs"), "utf8");
const serverSessionAuthority = await readFile(join(root, "server/src/session-authority.mjs"), "utf8");
const serverPolicyProfile = await readFile(join(root, "server/src/policy-profile.mjs"), "utf8");
const serverHierarchyTests = await readFile(join(root, "server/test/hierarchy-model.test.mjs"), "utf8");
const serverSessionAuthorityTests = await readFile(join(root, "server/test/session-authority.test.mjs"), "utf8");
const serverProjectCoordinatorCoreTests = await readFile(
  join(root, "server/test/project-coordinator-core.test.mjs"),
  "utf8",
);
const serverIntegrationTests = await readFile(join(root, "server/test/server.test.mjs"), "utf8");
const peerConstants = await readFile(join(root, "project-peer/src/constants.mjs"), "utf8");
const peerPolicyProfile = await readFile(join(root, "project-peer/src/policy-profile.mjs"), "utf8");
const peerTransferSource = await readFile(join(root, "project-peer/src/transfer-source.mjs"), "utf8");
const peerDirectTransferClient = await readFile(
  join(root, "project-peer/src/direct-transfer-client.mjs"),
  "utf8",
);
const peerSwarmDownloader = await readFile(join(root, "project-peer/src/swarm-downloader.mjs"), "utf8");
const peerEngine = await readFile(join(root, "project-peer/src/project-peer.mjs"), "utf8");
const peerPreflight = await readFile(join(root, "project-peer/src/unified-preflight.mjs"), "utf8");
const peerPreflightCli = await readFile(join(root, "project-peer/src/preflight-cli.mjs"), "utf8");
const peerOrchestratorContract = await readFile(
  join(root, "project-peer/src/orchestrator-contract.mjs"),
  "utf8",
);
const peerProcessLifecycle = await readFile(
  join(root, "project-peer/src/process-lifecycle.mjs"),
  "utf8",
);
const peerPublicationPlan = await readFile(join(root, "project-peer/src/publication-plan.mjs"), "utf8");
const peerHostOrchestrator = await readFile(join(root, "project-peer/src/host-orchestrator.mjs"), "utf8");
const peerHostBridge = await readFile(join(root, "project-peer/src/host-orchestrator-cli.mjs"), "utf8");
const peerBootstrapInvite = await readFile(join(root, "project-peer/src/bootstrap-invite.mjs"), "utf8");
const peerGuestOrchestrator = await readFile(join(root, "project-peer/src/guest-orchestrator.mjs"), "utf8");
const peerGuestBridge = await readFile(join(root, "project-peer/src/guest-orchestrator-cli.mjs"), "utf8");
const peerGuestRefreshTests = await readFile(join(root, "project-peer/test/guest-refresh.test.mjs"), "utf8");
const peerManagedProject = await readFile(join(root, "project-peer/src/managed-project.mjs"), "utf8");
const peerCli = await readFile(join(root, "project-peer/src/cli.mjs"), "utf8");
const serverLifecycleChild = await readFile(join(root, "server/src/lifecycle-child.mjs"), "utf8");
const uxBootstrapWp1Report = await readFile(
  join(root, "docs/ux-bootstrap-wp1-unified-preflight-report.md"),
  "utf8",
);
const uxBootstrapWp2Report = await readFile(
  join(root, "docs/ux-bootstrap-wp2-lifecycle-manager-report.md"),
  "utf8",
);
const uxBootstrapWp3Report = await readFile(
  join(root, "docs/ux-bootstrap-wp3-one-click-host-report.md"),
  "utf8",
);
const unityHostFlow = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeHostFlow.cs"),
  "utf8",
);
const unityHostEndpointPolicy = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeHostEndpointPolicy.cs"),
  "utf8",
);
const launcherRuntimeLoader = await readFile(join(root, "launcher/runtime-loader.mjs"), "utf8");
const launcherEnvironmentPolicy = await readFile(
  join(root, "launcher/src/TeamForge.Launcher.Core/EnvironmentPolicy.cs"),
  "utf8",
);
const launcherGuestUiContract = await readFile(
  join(root, "launcher/src/TeamForge.Launcher.Core/GuestUiContract.cs"),
  "utf8",
);
const launcherUnityPolicy = await readFile(
  join(root, "launcher/src/TeamForge.Launcher.Core/UnityLaunchPolicy.cs"),
  "utf8",
);
const launcherDiagnosticsRecovery = await readFile(
  join(root, "launcher/src/TeamForge.Launcher.Core/DiagnosticsRecovery.cs"),
  "utf8",
);
const launcherRuntimeLayout = await readFile(
  join(root, "launcher/src/TeamForge.Launcher.Core/RuntimeLayout.cs"),
  "utf8",
);
const launcherMainWindowXaml = await readFile(
  join(root, "launcher/src/TeamForge.Launcher/MainWindow.xaml"),
  "utf8",
);
const launcherMainWindow = await readFile(
  join(root, "launcher/src/TeamForge.Launcher/MainWindow.xaml.cs"),
  "utf8",
);
const launcherPathResilience = await readFile(
  join(root, "launcher/src/TeamForge.Launcher.Core/PathResilience.cs"),
  "utf8",
);
const launcherExecutionAlias = await readFile(
  join(root, "launcher/src/TeamForge.Launcher.Core/ExecutionAliasManager.cs"),
  "utf8",
);
const launcherApplicationManifest = await readFile(
  join(root, "launcher/src/TeamForge.Launcher/app.manifest"),
  "utf8",
);
const pathResilienceContract = JSON.parse(await readFile(
  join(root, "project-peer/src/path-resilience-contract.json"),
  "utf8",
));
const launcherApplication = await readFile(
  join(root, "launcher/src/TeamForge.Launcher/App.xaml.cs"),
  "utf8",
);
const launcherBuildProperties = await readFile(
  join(root, "launcher/Directory.Build.props"),
  "utf8",
);
const launcherProject = await readFile(
  join(root, "launcher/src/TeamForge.Launcher/TeamForge.Launcher.csproj"),
  "utf8",
);
const launcherRuntimePins = await readFile(
  join(root, "launcher/src/TeamForge.Launcher/RuntimePins.g.cs"),
  "utf8",
);
const launcherManifest = JSON.parse(await readFile(
  join(root, "launcher/win-x64/launcher-manifest.json"),
  "utf8",
));
const launcherRuntimeManifestSource = await readFile(
  join(root, "launcher/win-x64/Runtime/runtime-manifest.json"),
);
const launcherLoaderSource = await readFile(join(root, "launcher/win-x64/runtime-loader.mjs"));
const launcherCoreTests = await readFile(
  join(root, "launcher/tests/TeamForge.Launcher.Core.Tests/Program.cs"),
  "utf8",
);
const peerFilesystemSafety = await readFile(
  join(root, "project-peer/src/filesystem-safety.mjs"),
  "utf8",
);
const unityGuestHandoff = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeGuestHandoff.cs"),
  "utf8",
);
const unityRecoveryUx = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeRecoveryUx.cs"),
  "utf8",
);
const unityConnectionSettings = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Editor/Settings/TeamForgeConnectionSettings.cs"),
  "utf8",
);
const wp4ArchiveVerifier = await readFile(join(root, "scripts/verify-wp4-archive.ps1"), "utf8");
const wp4ArchiveRegression = await readFile(
  join(root, "scripts/test-wp4-archive-verifier.ps1"),
  "utf8",
);
const uxBootstrapWp4Report = await readFile(
  join(root, "WP4-Field-Hotfix-Report.md"),
  "utf8",
);
const uxBootstrapWp4FieldChecklist = await readFile(
  join(root, "Windows-Field-Test-Checklist-WP4-Hotfix.md"),
  "utf8",
);
const wp5Report = await readFile(join(root, "WP5-Diagnostics-Recovery-UX-Report.md"), "utf8");
const wp5Checklist = await readFile(join(root, "Windows-Field-Test-Checklist-WP5.md"), "utf8");
const wp5Smoke = await readFile(join(root, "executable-smoke-results-wp5.md"), "utf8");
const wp5FocusedTests = await readFile(
  join(root, "project-peer/test/wp5-diagnostics-recovery.test.mjs"),
  "utf8",
);
const peerTransferSourceTests = await readFile(
  join(root, "project-peer/test/transfer-source-contract.test.mjs"),
  "utf8",
);
assert(!/from\s+["']ws["']/u.test(peerPreflight), "Preflight must start before ws is installed.");
assert(!/project-peer\.mjs|direct-transfer|managed-project|swarm-downloader/u.test(peerPreflight));
assert.match(peerPreflight, /operation:\s*"inspect"[\s\S]*mutatesLocalState:\s*false[\s\S]*mutatesRemoteState:\s*false/u);
assert.match(
  peerPreflight,
  /"ci",[\s\S]*"--ignore-scripts",[\s\S]*"--no-audit",[\s\S]*"--no-fund",[\s\S]*"--workspaces=false"/u,
);
assert.match(peerPreflight, /open\(lockPath,\s*"wx"/u);
assert.match(peerPreflightCli, /repair-dependencies[\s\S]*--confirm-repair/u);
assert.match(peerOrchestratorContract, /dependency_missing[\s\S]*dependenciesNotReady/u);
assert.match(peerOrchestratorContract, /port_occupied_unverified[\s\S]*portConflict/u);
assert.match(uxBootstrapWp1Report, /Unity 6000\.3 EditMode: \*\*NOT RUN\*\*/u);
assert.match(uxBootstrapWp1Report, /WP2 Server\/Seed lifecycle[\s\S]*Component Sync/u);
assert.match(serverHost, /service:\s*"unity-teamforge-server"[\s\S]*lifecycleInstanceId/u);
assert.match(serverLifecycleChild, /TEAMFORGE_LIFECYCLE_TOKEN/u);
assert.match(serverLifecycleChild, /await server\.stop\(\)/u);
assert.match(peerCli, /transferTokenFingerprint:\s*createHash\("sha256"\)/u);
assert.match(peerProcessLifecycle, /probeCoordinatorHealth/u);
assert.match(peerProcessLifecycle, /randomBytes\(32\)/u);
assert.match(peerProcessLifecycle, /method:\s*"authenticated_ipc"/u);
assert.match(peerProcessLifecycle, /forceOwnedAfterTimeout\s*=\s*false/u);
assert.match(peerProcessLifecycle, /record\.child\.kill\("SIGKILL"\)/u);
assert(!/process\.kill|taskkill|kill-port/iu.test(peerProcessLifecycle), "WP2 must never kill by PID or port.");
assert.match(peerProcessLifecycle, /async ensurePublishingSeed/u);
assert.match(peerPublicationPlan, /teamforge-publish-review-v1/u);
assert.match(peerPublicationPlan, /sourceDescriptorDigest[\s\S]*manifestHash[\s\S]*added/u);
assert(!/from\s+["']\.\/host-orchestrator\.mjs["']/u.test(peerHostBridge),
  "WP3 bridge must inspect and repair before loading ws-dependent Host modules.");
assert.match(peerHostBridge, /await import\("\.\/host-orchestrator\.mjs"\)/u);
assert.match(peerHostOrchestrator, /this\.lifecycle\.ensureCoordinator/u);
assert.match(peerHostOrchestrator, /this\.lifecycle\.ensurePublishingSeed/u);
assert.match(peerHostOrchestrator, /inspectCoordinatorBaseline[\s\S]*this\.lifecycle\.ensureSeed/u);
assert.match(peerHostOrchestrator, /exactBaselineMatches[\s\S]*Coordinator registry was not rebuilt/u);
assert.match(peerHostOrchestrator, /uniqueManifestChunks[\s\S]*baseline_unavailable[\s\S]*cannot safely re-arm/u);
assert.match(peerHostOrchestrator, /mode === "existing_baseline"[\s\S]*source_changed/u);
assert.match(peerPublicationPlan, /reuseExistingBaseline[\s\S]*hostMode/u);
assert.match(peerEngine, /coordinator_registry_empty[\s\S]*Seed the signed existing Baseline/u);
assert.match(peerHostOrchestrator, /confirmation !== "PUBLISH"/u);
assert.match(peerHostOrchestrator, /stopSeed[\s\S]*stopCoordinator/u);
assert.match(peerCli, /waitForLifecyclePublishConfirmation/u);
assert.match(peerCli, /message\.fingerprint !== fingerprint/u);
assert.match(peerOrchestratorContract, /port_conflict[\s\S]*portConflict/u);
assert.match(uxBootstrapWp2Report, /macOS lifecycle runtime tests: \*\*NOT RUN\*\*/u);
assert.match(uxBootstrapWp2Report, /Linux lifecycle runtime tests: \*\*NOT RUN\*\*/u);
assert.match(uxBootstrapWp2Report, /WP3\/WP4 UI or launcher[\s\S]*Component Sync/u);
assert.match(uxBootstrapWp3Report, /Unity EditMode Test Runner execution: \*\*NOT RUN\*\*/u);
assert.match(uxBootstrapWp3Report, /WP4 Guest standalone launcher[\s\S]*Component Sync/u);
assert.match(peerBootstrapInvite, /teamforge-bootstrap-invite-v1/u);
assert.match(peerBootstrapInvite, /validateStrictProjectInvite[\s\S]*ownerSignature/u);
assert.match(peerBootstrapInvite, /MAXIMUM_BOOTSTRAP_INVITE_BYTES\s*=\s*65_536/u);
assert.match(peerGuestOrchestrator, /importInviteValue[\s\S]*coordinator\.connect\(\)/u,
  "WP4 Guest must pin the signed Project Invite before connecting to Coordinator state.");
assert.match(peerEngine,
  /validateInvite\(invite\)[\s\S]*existing\.projectUuid !== invite\.projectUuid[\s\S]*existing\.ownerKeyId !== invite\.ownerKeyId[\s\S]*writeJsonAtomic\(destination, invite\)/u,
  "WP4.1 invite refresh must revalidate and atomically replace only the same Project/Owner binding.");
assert.match(peerGuestRefreshTests,
  /rev1 Fresh Guest rejoins a restarted Host session[\s\S]*rev2 signed refresh activates a new immutable Active[\s\S]*changed Publisher requires explicit trust[\s\S]*failed rev2 transfer retains failure staging/u,
  "WP4.1 refresh/rejoin regression coverage is incomplete.");
assert.match(peerGuestOrchestrator, /syncFromSnapshot\([\s\S]*signal:\s*active\.controller\.signal/u);
assert.match(peerGuestOrchestrator,
  /const current = await managed\.validatedCurrent\(\)[\s\S]*handoff = await this\.handoffWriter/u,
  "WP4 Guest must validate the exact Active result before creating the one-shot Unity handoff.");
assert.match(peerGuestOrchestrator, /previousPublisherFingerprint[\s\S]*containsScripts[\s\S]*containsPackages/u);
assert.match(peerGuestBridge, /runGuestBridge[\s\S]*forbiddenRoots/u);
assert.match(peerManagedProject, /async validatedCurrent\(\)[\s\S]*activeRelativePath/u);
assert.match(peerHostOrchestrator,
  /assertRealtimeSceneMatchesPublication[\s\S]*entry\.fileHash !== scene\.sha256[\s\S]*ensureCoordinator/u,
  "WP4 Host must bind the fresh TF1 Scene fingerprint to the reviewed publication before lifecycle start.");
assert.match(unityHostFlow, /TeamForgeJoinCode\.TryCreateFresh/u);
assert.match(launcherRuntimeLoader,
  /guestBridgeRelativePath[\s\S]*runGuestBridge\(\{ forbiddenRoots: \[launcherRoot, verified\.root\] \}\)/u);
assert.match(launcherEnvironmentPolicy, /StartsWith\("NODE_"[\s\S]*SSL_CERT_FILE[\s\S]*OPENSSL_CONF/u);
assert.match(launcherUnityPolicy, /ActiveNameRegex[\s\S]*\^\[1-9\]\[0-9\]\*-\[0-9a-f\]\{12\}\$/u);
assert.match(unityGuestHandoff, /LocalApplicationData[\s\S]*guest-core[\s\S]*handoff/u);
assert.match(unityGuestHandoff,
  /TEAMFORGE_GUEST_HANDOFF_PATH[\s\S]*TEAMFORGE_GUEST_HANDOFF_SHA256[\s\S]*TryApply/u);
assert.match(launcherMainWindow, /private string\? _pendingAccessCode/u);
assert.match(launcherMainWindow,
  /AccessCodeBox\.Clear\(\)[\s\S]*values\["authenticationToken"\]\s*=\s*_pendingAccessCode/u,
  "WP4 access codes must leave the password control and reach the Guest bridge only through the private request frame.");
assert.match(launcherMainWindow,
  /RefreshHandoffForUnityLaunchAsync\(sourceProject\)[\s\S]*UnityPathStrategy\.PrepareAsync\(launchProject\)[\s\S]*CreateUnityOpenStartInfo\(editor, launchProject, _pendingAccessCode, preparedPath\)[\s\S]*Process\.Start\(startInfo\)/u,
  "WP4 must refresh the one-shot handoff immediately before launching Unity and pass the access code only in child-process memory.");
assert.equal(pathResilienceContract.schemaVersion, 1);
assert.equal(pathResilienceContract.windowsHighRiskPathLength, 260);
assert.equal(pathResilienceContract.unityPackageCacheHeadroom, 162);
assert.match(launcherApplicationManifest, /<ws2:longPathAware>true<\/ws2:longPathAware>/u,
  "WP5.1 Launcher must explicitly opt its own Win32 I/O into long-path-aware behavior.");
assert.match(launcherPathResilience,
  /PathCapabilityProbe[\s\S]*PathBudgetAnalyzer[\s\S]*ManagedRootSelector[\s\S]*PathAliasAllocator[\s\S]*PathStrategyRouter[\s\S]*ToolchainPathEnvironment/u,
  "WP5.1 path routing responsibilities must remain independently testable.");
assert.match(launcherExecutionAlias, /FsctlSetReparsePoint/u);
assert.match(launcherExecutionAlias, /FsctlGetReparsePoint/u);
assert.match(launcherExecutionAlias, /MountPointReparseTag/u);
assert.match(launcherExecutionAlias, /VerifyImmediatelyBeforeLaunch/u,
  "WP5.1 execution aliases must be mount-point junctions whose raw tag and final target are reverified before launch.");
assert.doesNotMatch(launcherMainWindow,
  /throw new BridgeException\(\s*"path_length_risk"/u,
  "WP5.1 path risk must route to automatic optimization instead of blocking verified receive.");
assert.match(launcherMainWindow,
  /catch[\s\S]*DeleteRefreshedHandoff\(launchProject\)[\s\S]*ClearPendingAccessCode/u,
  "WP4 launch failures must retire the launcher-created handoff and clear the in-memory access code.");
assert.match(launcherUnityPolicy, /GuestAuthenticationEnvironmentVariable\s*=\s*"TEAMFORGE_GUEST_AUTHENTICATION_TOKEN"/u);
assert.match(launcherUnityPolicy,
  /MaximumAuthenticationTokenLength[\s\S]*IndexOfAny\(\['\\0', '\\r', '\\n'\]\)[\s\S]*info\.Environment\[GuestAuthenticationEnvironmentVariable\]\s*=\s*authenticationToken/u,
  "The optional Guest access code must be bounded and passed through one explicit Unity child environment variable.");
assert.match(unityGuestHandoff,
  /Environment\.SetEnvironmentVariable\(PathEnvironmentVariable, null\)[\s\S]*Environment\.SetEnvironmentVariable\(HashEnvironmentVariable, null\)[\s\S]*Environment\.SetEnvironmentVariable\(AuthenticationEnvironmentVariable, null\)/u,
  "Unity must clear every launcher control environment variable before handoff parsing or diagnostics.");
assert.match(unityGuestHandoff,
  /AuthenticationToken\s*=\s*string\.Empty[\s\S]*TrySetGuestTransientAuthenticationToken\([\s\S]*TeamForgeConnectionService\.Connect\(\)/u,
  "Unity must keep the persistent Project credential empty and install the one-shot Guest credential only after verified handoff and TF1 application.");
assert.match(unityConnectionSettings,
  /\[NonSerialized\][\s\S]*_guestTransientAuthenticationToken[\s\S]*EffectiveAuthenticationToken[\s\S]*ClearGuestTransientAuthenticationToken/u,
  "Guest authentication must use a nonserialized transient credential seam with an explicit clear path.");
assert.match(launcherCoreTests, /TryGetProperty\("authenticationToken", out _\)/u,
  "Launcher regression coverage must prove the refreshed handoff does not serialize the access code.");
assert.match(launcherUnityPolicy,
  /RefreshHandoffForUnityLaunchAsync[\s\S]*FileMode\.CreateNew[\s\S]*FileOptions\.Asynchronous \| FileOptions\.WriteThrough[\s\S]*Flush\(flushToDisk:\s*true\)[\s\S]*File\.Delete\(source\)/u,
  "The JIT Unity handoff must be create-new, durable, hash-verified, and replace the exact original one-shot file.");
assert.match(launcherUnityPolicy,
  /DeleteRefreshedHandoff[\s\S]*StartsWith\("unity-launch-"[\s\S]*File\.Delete\(handoff\)/u,
  "Launcher cleanup must be restricted to its own JIT handoff names under the verified state subtree.");
assert.match(unityGuestHandoff,
  /MaximumAgeMilliseconds\s*=\s*15 \* 60 \* 1000[\s\S]*MaximumFutureSkewMilliseconds\s*=\s*5 \* 60 \* 1000[\s\S]*createdAtUnixMs/u,
  "Unity must retain bounded age/future-skew validation for the JIT handoff.");
assert.match(launcherGuestUiContract,
  /IsOrdinaryWindowsDriveRoot[\s\S]*driveType\s*!=\s*DriveType\.Fixed/u,
  "The Launcher destination must be an ordinary fixed local Windows drive.");
assert.match(launcherGuestUiContract,
  /IsEqualOrInside\(root, application\)[\s\S]*IsEqualOrInside\(application, root\)[\s\S]*IsEqualOrInside\(root, runtime\)[\s\S]*IsEqualOrInside\(runtime, root\)/u,
  "The Launcher must reject destination overlap with app/Runtime in both descendant and ancestor directions.");
assert.match(launcherGuestUiContract,
  /segment is "\." or "\.\."[\s\S]*"<>:\\"\|\?\*"\.Contains\(character\)[\s\S]*IsReservedDosDeviceName/u,
  "The Launcher must reject traversal, ADS/invalid characters, and reserved DOS path segments.");
assert.match(peerFilesystemSafety,
  /WINDOWS_LOCAL_ROOT[\s\S]*WINDOWS_RESERVED_SEGMENT[\s\S]*WINDOWS_INVALID_SEGMENT[\s\S]*canonicalizeThroughExistingDirectory[\s\S]*realpath/u,
  "The Guest core must independently enforce ordinary Windows paths and canonicalize through existing directories.");
assert.match(launcherCoreTests, /destination rejects UNC and device roots/u);
assert.match(launcherCoreTests, /DriveType\.Network[\s\S]*DriveType\.NoRootDirectory/u);
assert.match(launcherCoreTests, /HasSafeWindowsPathShape[\s\S]*LPT9\.data[\s\S]*bad<name/u);
assert.match(wp4ArchiveVerifier,
  /entryCount -gt 20000[\s\S]*entry\.Length -gt 400MB[\s\S]*entry\.Length \/ \$entry\.CompressedLength\) -gt 2000[\s\S]*totalBytes -gt 1500MB/u,
  "The WP4 archive verifier must retain bounded entry, file, ratio, and aggregate extraction limits.");
assert.match(wp4ArchiveVerifier,
  /Case-insensitive duplicate ZIP entry[\s\S]*Symbolic link entry is forbidden[\s\S]*file is also an ancestor path/u,
  "The WP4 archive verifier must reject ambiguous/colliding paths and symbolic links before extraction.");
assert.match(wp4ArchiveVerifier,
  /release-manifest\.json[\s\S]*runtimeManifestSha256[\s\S]*launcherManifestSha256[\s\S]*Archive file set differs from the explicit release manifest/u,
  "The archive gate must bind the exact candidate file set and nested Runtime/Launcher manifests.");
assert.match(wp4ArchiveRegression, /noncanonical_duplicate_zip_path_rejected/u);
assert.match(uxBootstrapWp4Report,
  /atomic replacement[\s\S]*same[\s\S]*Project UUID[\s\S]*pinned Owner[\s\S]*129\/129/u);
assert.match(uxBootstrapWp4Report,
  /failed rev2[\s\S]*preserves rev1[\s\S]*NOT RUN manually[\s\S]*FIELD BLOCKED \/ NOT COMPLETED/u);
assert.match(uxBootstrapWp4FieldChecklist, /Status at delivery: \*\*NOT RUN manually\*\*/u);
assert(!/\[[xX]\]/u.test(uxBootstrapWp4FieldChecklist), "WP4 manual field items must remain unchecked at delivery.");
assert.match(peerBootstrapInvite,
  /expectedProductVersion[\s\S]*teamforge_version_mismatch[\s\S]*inviteProductVersion[\s\S]*runtimeProductVersion/u,
  "WP5 must distinguish a valid signed Invite from an incompatible TeamForge product version.");
assert.match(peerGuestOrchestrator,
  /currentRunHistory\.length > 32[\s\S]*validatedCurrent\(\)[\s\S]*previousVerifiedActiveAvailable/u,
  "WP5 Guest diagnostics must be bounded and derive prior-Active availability from verified state.");
assert.match(launcherDiagnosticsRecovery,
  /RecoveryActionKind[\s\S]*OpenExistingVerifiedProject[\s\S]*PreviousVerifiedActiveAvailable[\s\S]*MaximumEntries\s*=\s*32/u,
  "WP5 Launcher recovery actions must be state-driven and current-run history must be bounded.");
assert(launcherDiagnosticsRecovery.includes("authorization\\\\s*:\\\\s*bearer") &&
  launcherDiagnosticsRecovery.includes("private[-_ ]?key") && launcherDiagnosticsRecovery.includes("[redacted]"),
  "WP5 Launcher diagnostics must redact Authorization and access/token/secret/private-key fields.");
assert.match(launcherDiagnosticsRecovery,
  /PathResilienceContract\.Current\.UnityPackageCacheHeadroom[\s\S]*PathResilienceContract\.Current\.WindowsHighRiskPathLength/u,
  "WP5.1 must consume the shared deterministic Unity path-budget contract.");
assert.match(launcherRuntimeLayout,
  /RuntimeVerificationException[\s\S]*embedded trust pins[\s\S]*pinned manifest and loader hashes[\s\S]*runtime file inventory/u,
  "WP5 Runtime errors must preserve the exact fail-closed verification stage.");
assert.match(launcherUnityPolicy,
  /ValidateExistingActiveAsync[\s\S]*RequireNoReparsePointsOnExistingPath[\s\S]*RequireUnityProjectShape[\s\S]*CreateExistingProjectOpenStartInfo/u,
  "WP5 may open only an independently revalidated existing immutable Active.");
for (const requiredLauncherSurface of [
  "Open existing verified project", "Choose a shorter project location",
  "Advanced / Technical Details", "Copy diagnostics",
]) {
  assert(launcherMainWindowXaml.includes(requiredLauncherSurface),
    `WP5 Launcher surface is missing: ${requiredLauncherSurface}`);
}
assert.match(unityRecoveryUx, /MaximumHistory\s*=\s*32[\s\S]*BuildCopyDiagnostics/u);
assert(unityRecoveryUx.includes("authorization\\\\s*:\\\\s*bearer") && unityRecoveryUx.includes("[redacted]"),
  "WP5 Unity diagnostics must be bounded, copyable, and secret-safe.");
assert(!/Process\.Kill|Stop-Process|kill-port/u.test(`${launcherDiagnosticsRecovery}\n${unityRecoveryUx}`),
  "WP5 diagnostic/recovery code must not terminate an unknown process.");
assert.match(wp5FocusedTests,
  /stale 0\.5\.0 runtime[\s\S]*wrong access code[\s\S]*failed revision[\s\S]*damaged Invite[\s\S]*Unity UX/u,
  "WP5 focused regression coverage is incomplete.");
assert.match(wp5Report,
  /Protocol v1[\s\S]*134\/134 PASS[\s\S]*24\/24 PASS[\s\S]*Unity 6000\.3\.21f1 EditMode: \*\*NOT RUN\*\*/u);
assert.match(wp5Checklist, /Status at delivery: \*\*NOT RUN manually\*\*/u);
assert(!/\[[xX]\]/u.test(wp5Checklist), "WP5 manual field items must remain unchecked at delivery.");
assert.match(wp5Smoke,
  /STAGED EXECUTABLE PASS[\s\S]*Formal two-PC WP4\.1 closure[\s\S]*DEFERRED[\s\S]*Packaged Runtime[\s\S]*93 files[\s\S]*0\.0\.0\.0:5080/u);
const unityProtocol = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Editor/Protocol/TeamForgeProtocol.cs"),
  "utf8",
);
const unityConnectionService = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Editor/Connection/TeamForgeConnectionService.cs"),
  "utf8",
);
const unityPolicyProfile = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Editor/Settings/TeamForgeProfile.cs"),
  "utf8",
);
const unityConnectionStrategy = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Editor/Connection/ConnectionStrategy.cs"),
  "utf8",
);
const unityRealtimeTransport = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Editor/Transport/IRealtimeTransport.cs"),
  "utf8",
);
const unityClientWebSocketTransport = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Editor/Transport/ClientWebSocketTransport.cs"),
  "utf8",
);
const unityRealtimeTransportFactory = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Editor/Transport/RealtimeTransportFactory.cs"),
  "utf8",
);
const unityConnectionCompositionTests = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeConnectionCompositionTests.cs"),
  "utf8",
);
const unityTransformService = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Editor/TransformSync/TeamForgeTransformSyncService.cs"),
  "utf8",
);
const unityEditorAssemblyInfo = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Editor/AssemblyInfo.cs"),
  "utf8",
);
const unityTransformModel = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Editor/TransformSync/TeamForgeTransformModel.cs"),
  "utf8",
);
const unityAuthorityView = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Editor/Authority/TeamForgeAuthorityView.cs"),
  "utf8",
);
const unityAuthorityViewTests = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeAuthorityViewTests.cs"),
  "utf8",
);
const unityHierarchyService = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Editor/HierarchySync/TeamForgeHierarchySyncService.cs"),
  "utf8",
);
const unityHierarchyIdentity = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Editor/HierarchySync/TeamForgeHierarchyIdentityRegistry.cs"),
  "utf8",
);
const unityObjectIdentity = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Editor/Presence/TeamForgeObjectIdentity.cs"),
  "utf8",
);
const unityPresenceService = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Editor/Presence/TeamForgePresenceService.cs"),
  "utf8",
);
const unityHierarchyTests = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeHierarchyModelTests.cs"),
  "utf8",
);
const unityProjectContract = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Editor/ProjectTransfer/TeamForgeProjectModel.cs"),
  "utf8",
);
const unityProjectService = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Editor/ProjectTransfer/TeamForgeProjectService.cs"),
  "utf8",
);
const unityWindow = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Editor/UI/TeamForgeWindow.cs"),
  "utf8",
);
const unityEditorSurfaceTests = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeEditorSurfaceTests.cs"),
  "utf8",
);
const unityHomeWindow = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeHomeWindow.cs"),
  "utf8",
);
const unityRuntimeDiscovery = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeRuntimeDiscovery.cs"),
  "utf8",
);
const unityRuntimePin = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeRuntimeManifest.g.cs"),
  "utf8",
);
const runtimeManifestSource = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Runtime~/runtime-manifest.json"),
);
const runtimeManifest = JSON.parse(runtimeManifestSource.toString("utf8"));
const unityJoinCode = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeJoinCode.cs"),
  "utf8",
);
const unityBaselineFingerprint = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeBaselineFingerprint.cs"),
  "utf8",
);
const unityTestLab = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Editor/Testing/TeamForgeTestLab.cs"),
  "utf8",
);
const phase45Architecture = await readFile(join(root, "docs/architecture.md"), "utf8");
const phase45Roadmap = await readFile(join(root, "docs/roadmap.md"), "utf8");
const phase45ProjectState = await readFile(join(root, "docs/project-state.md"), "utf8");
const phase45Adr = await readFile(join(root, "docs/decisions/phase-4.5.md"), "utf8");
const phase45FieldChecklist = await readFile(
  join(root, "docs/phase-4.5-field-closure-checklist.md"),
  "utf8",
);
const phase45ClosureReport = await readFile(join(root, "docs/phase-4.5-closure-report.md"), "utf8");
const phase45TestReport = await readFile(join(root, "docs/phase-4.5-test-report.md"), "utf8");
const phase45ChangedFiles = await readFile(
  join(root, "docs/changed-files-phase-4.5-closure.md"),
  "utf8",
);
const phase45FieldHotfixReport = await readFile(
  join(root, "docs/phase-4.5-wp8-field-hotfix-saved-transform-identity-report.md"),
  "utf8",
);
const phase45FieldHotfixChecklist = await readFile(
  join(root, "docs/phase-4.5-wp8-field-hotfix-checklist.md"),
  "utf8",
);
const phase45FieldHotfixChangedFiles = await readFile(
  join(root, "docs/changed-files-phase-4.5-wp8-field-hotfix.md"),
  "utf8",
);
const unityProjectProtocolTests = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeProjectProtocolTests.cs"),
  "utf8",
);
const unityIdentityAuthorityAuditTests = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeIdentityAuthorityAuditTests.cs"),
  "utf8",
);
const phase45IdentityAuditReport = await readFile(
  join(root, "docs/phase-4.5-wp8-identity-authority-audit-report.md"),
  "utf8",
);
const phase45IdentityContractMatrix = await readFile(
  join(root, "docs/phase-4.5-wp8-identity-contract-matrix.md"),
  "utf8",
);
const phase45IdentityAuditTestEvidence = await readFile(
  join(root, "docs/phase-4.5-wp8-identity-authority-audit-test-evidence.md"),
  "utf8",
);
const phase45IdentityAuditFieldChecklist = await readFile(
  join(root, "docs/phase-4.5-wp8-identity-authority-audit-field-checklist.md"),
  "utf8",
);
const phase45IdentityAuditChangedFiles = await readFile(
  join(root, "docs/changed-files-phase-4.5-wp8-identity-authority-audit.md"),
  "utf8",
);
const phase45IdentityReconciliationReport = await readFile(
  join(root, "docs/phase-4.5-wp8-identity-authority-test-reconciliation-hotfix-report.md"),
  "utf8",
);
const phase45IdentityRearmReport = await readFile(
  join(root, "docs/phase-4.5-wp8-identity-authority-rearm-rootcause-hotfix-report.md"),
  "utf8",
);
const phase45IdentityRearmChangedFiles = await readFile(
  join(root, "docs/changed-files-phase-4.5-wp8-identity-authority-rearm-rootcause-hotfix.md"),
  "utf8",
);
const protocolV1Doc = await readFile(join(root, "docs/protocol-v1.md"), "utf8");
const transferProtocolV1Doc = await readFile(
  join(root, "docs/protocol-project-transfer-v1.md"),
  "utf8",
);
const serverVersion = Number(serverProtocol.match(/PROTOCOL_VERSION\s*=\s*(\d+)/)?.[1]);
const unityVersion = Number(unityProtocol.match(/Version\s*=\s*(\d+)/)?.[1]);
const peerRealtimeVersion = Number(peerConstants.match(/REALTIME_PROTOCOL_VERSION\s*=\s*(\d+)/)?.[1]);
const serverTransferVersion = Number(
  serverProjectCoordinator.match(/PROJECT_TRANSFER_PROTOCOL_VERSION\s*=\s*(\d+)/)?.[1],
);
const peerTransferVersion = Number(peerConstants.match(/TRANSFER_PROTOCOL_VERSION\s*=\s*(\d+)/)?.[1]);
const unityTransferVersion = Number(unityProjectContract.match(/TransferProtocolVersion\s*=\s*(\d+)/)?.[1]);
const serverManifestVersion = Number(
  serverProjectCoordinator.match(/PROJECT_MANIFEST_SCHEMA_VERSION\s*=\s*(\d+)/)?.[1],
);
const peerManifestVersion = Number(peerConstants.match(/MANIFEST_SCHEMA_VERSION\s*=\s*(\d+)/)?.[1]);
const unityManifestVersion = Number(unityProjectContract.match(/ManifestSchemaVersion\s*=\s*(\d+)/)?.[1]);
const serverRealtimeProductVersion = serverProtocol.match(/SERVER_VERSION\s*=\s*"([^"]+)"/)?.[1];
const serverProductVersion = serverProjectCoordinator.match(/PROJECT_PRODUCT_VERSION\s*=\s*"([^"]+)"/)?.[1];
const peerProductVersion = peerConstants.match(/PRODUCT_VERSION\s*=\s*"([^"]+)"/)?.[1];
const unityProductVersion = unityProjectContract.match(/ProductVersion\s*=\s*"([^"]+)"/)?.[1];
assert.equal(serverVersion, unityVersion, "Server and Unity protocol versions differ.");
assert.equal(serverVersion, peerRealtimeVersion, "Server and Project Peer realtime protocol versions differ.");
assert.equal(serverVersion, releaseContract.protocols.realtime, "Realtime Protocol drifted from release-contract.json.");
assert.equal(serverTransferVersion, peerTransferVersion, "Server and Project Peer transfer versions differ.");
assert.equal(serverTransferVersion, unityTransferVersion, "Server and Unity transfer versions differ.");
assert.equal(serverTransferVersion, releaseContract.protocols.projectTransfer,
  "Project Transfer Protocol drifted from release-contract.json.");
assert.equal(serverManifestVersion, peerManifestVersion, "Server and Project Peer manifest versions differ.");
assert.equal(serverManifestVersion, unityManifestVersion, "Server and Unity manifest versions differ.");
assert.equal(serverManifestVersion, releaseContract.protocols.projectManifest,
  "Project Manifest Schema drifted from release-contract.json.");
assert.equal(serverRealtimeProductVersion, releaseContract.productVersion,
  "Server health/handshake version differs from release-contract.json.");
assert.equal(serverProductVersion, serverPackage.version, "Server source and package product versions differ.");
assert.equal(peerProductVersion, peerPackage.version, "Project Peer source and package product versions differ.");
assert.equal(unityProductVersion, unityPackage.version, "Unity source and package product versions differ.");
assert.deepEqual(Object.keys(serverPackage.dependencies ?? {}), ["ws"], "Server closure dependency set drifted.");
assert.deepEqual(Object.keys(peerPackage.dependencies ?? {}), ["ws"], "Project Peer closure dependency set drifted.");
assert.equal(serverPackage.dependencies.ws, releaseContract.ws.version,
  "Server ws version drifted from release-contract.json.");
assert.equal(peerPackage.dependencies.ws, releaseContract.ws.version,
  "Project Peer ws version drifted from release-contract.json.");
for (const [label, lock] of [
  ["workspace", workspaceLock],
  ["server", serverLock],
  ["project-peer", peerLock],
]) {
  const ws = lock.packages["node_modules/ws"];
  assert.equal(ws.version, releaseContract.ws.version, `${label} lock ws version drifted.`);
  assert.equal(ws.integrity, releaseContract.ws.integrity, `${label} lock ws integrity drifted.`);
  assert.equal(ws.resolved,
    `https://registry.npmjs.org/ws/-/ws-${releaseContract.ws.version}.tgz`,
    `${label} lock ws registry source drifted.`);
}
const versionPattern = releaseContract.productVersion.replaceAll(".", "\\.");
assert.match(launcherBuildProperties, new RegExp(`<Version>${versionPattern}</Version>`, "u"));
assert.match(launcherBuildProperties, new RegExp(`<AssemblyVersion>${versionPattern}\\.0</AssemblyVersion>`, "u"));
assert.match(launcherBuildProperties, new RegExp(`<FileVersion>${versionPattern}\\.0</FileVersion>`, "u"));
assert.match(launcherBuildProperties, new RegExp(`<InformationalVersion>${versionPattern}</InformationalVersion>`, "u"));
assert.match(launcherProject,
  new RegExp(`<TargetFramework>${releaseContract.dotnet.targetFramework.replaceAll(".", "\\.")}</TargetFramework>`, "u"));
assert.match(launcherProject,
  new RegExp(`<RuntimeFrameworkVersion>${releaseContract.dotnet.runtimeVersion.replaceAll(".", "\\.")}</RuntimeFrameworkVersion>`, "u"));
assert(!/NuGetAudit>false</u.test(launcherBuildProperties + launcherProject),
  "Launcher release projects must not disable NuGet audit.");
assert(launcherApplication.includes(`"${releaseContract.productVersion}"`),
  "Launcher App product version differs from release-contract.json.");
assert(launcherMainWindow.includes(`"${releaseContract.productVersion}"`),
  "Launcher MainWindow product version differs from release-contract.json.");
assert.equal(launcherManifest.schemaVersion, releaseContract.protocols.launcherManifest);
assert.equal(launcherManifest.productVersion, releaseContract.productVersion);
assert.equal(launcherManifest.target, releaseContract.target);
assert.equal(launcherManifest.targetFramework, releaseContract.dotnet.targetFramework);
assert.equal(launcherManifest.dotnetSdkVersion, releaseContract.dotnet.testedSdk);
assert.equal(launcherManifest.dotnetRuntimeVersion, releaseContract.dotnet.runtimeVersion);
assert.equal(launcherManifest.signed, releaseContract.launcher.signed);
assert.deepEqual(launcherRuntimeManifestSource, runtimeManifestSource,
  "Launcher and Unity Runtime manifests must be byte-identical.");
const runtimeManifestSha256 = createHash("sha256").update(runtimeManifestSource).digest("hex");
const launcherLoaderSha256 = createHash("sha256").update(launcherLoaderSource).digest("hex");
assert.equal(launcherManifest.runtimeManifestSha256, runtimeManifestSha256);
assert.equal(launcherManifest.loaderSha256, launcherLoaderSha256);
assert.match(launcherRuntimePins, new RegExp(runtimeManifestSha256, "u"));
assert.match(launcherRuntimePins, new RegExp(launcherLoaderSha256, "u"));
if (releaseManifest) {
  assert.equal(releaseManifest.runtimeManifestSha256, runtimeManifestSha256);
  assert.equal(releaseManifest.launcherManifestSha256,
    createHash("sha256").update(await readFile(join(root, "launcher/win-x64/launcher-manifest.json"))).digest("hex"));
}
assert.match(serverPolicyProfile, /LegacyPhase4Compatible/);
assert.match(serverPolicyProfile, /class ConnectionPolicy/);
assert.match(peerPolicyProfile, /LegacyPhase4Compatible/);
assert.match(peerPolicyProfile, /class ConnectionPolicy/);
assert.match(peerPolicyProfile, /class TransferPolicy/);
assert.match(peerPolicyProfile, /class TrustRequirements/);
assert.match(peerPolicyProfile, /class TeamForgeProfile/);
assert.match(unityPolicyProfile, /LegacyPhase4Compatible/);
assert.match(unityPolicyProfile, /sealed class ConnectionPolicy/);
assert.match(unityPolicyProfile, /sealed class TransferPolicy/);
assert.match(unityPolicyProfile, /sealed class TrustRequirements/);
assert.match(unityPolicyProfile, /sealed class TeamForgeProfile/);
assert(
  !/(?:disable|skip|bypass)(?:Uuid|Owner|Publisher|Descriptor|Signature|Manifest|Chunk|Hash|Path|Staging|Activation|Revision|Lock|Hierarchy|Tombstone)/iu.test(
    `${serverPolicyProfile}\n${peerPolicyProfile}\n${unityPolicyProfile}`,
  ),
  "Safety invariants must not become Policy/Profile disable flags.",
);
assert(
  !/\b(?:Balanced|Speed|Reliability|Security|Custom)(?:Profile|Policy)\b/u.test(
    `${serverPolicyProfile}\n${peerPolicyProfile}\n${unityPolicyProfile}`,
  ),
  "Phase 4.5 closure permits only LegacyPhase4Compatible; future user profiles require a later decision.",
);
assert.match(peerTransferSource, /version:\s*1/);
assert.match(peerTransferSource, /\["descriptor", "manifest", "inventory", "chunk"\]/);
assert.match(peerTransferSource, /function assertProjectTransferSource/);
assert.match(peerTransferSource, /function createTransferSourceError/);
assert.match(peerTransferSource, /function transferSourceErrorInfo/);
assert.match(peerDirectTransferClient, /assertProjectTransferSource\(this\)/);
assert.match(peerDirectTransferClient, /response\.headers\.get\("retry-after"\)/);
assert.match(peerDirectTransferClient, /sha256\(bytes\) !== hash/);
assert.match(peerSwarmDownloader, /transferSourceErrorInfo\(error\)/);
assert.match(peerSwarmDownloader, /store\.has\(chunk\.hash, chunk\.size, true\)/);
assert(
  !/error\?\.details\?\.(?:status|retryable|retryAfterMilliseconds)|response\.(?:status|headers)/u.test(
    peerSwarmDownloader,
  ),
  "Transfer Core must consume normalized source errors instead of HTTP response/status/header details.",
);
assert.match(peerEngine, /PROJECT_PEER_STABLE_BACKEND/);
assert.match(peerEngine, /transferSourceAdapters:\s*Object\.freeze\(\[DirectTransferClient\]\)/);
assert.match(peerTransferSourceTests, /const SOURCE_VARIANTS/);
assert.match(peerTransferSourceTests, /\["fake", fakeSource\]/);
assert.match(peerTransferSourceTests, /\["direct HTTP", directHttpSource\]/);
assert.match(peerTransferSourceTests, /verified Chunk resume through the shared Transfer Core/);
assert.match(peerTransferSourceTests, /expected-size and SHA-256 verification/);
assert(
  !/WebRTC|RTCDataChannel|\bICE\b|\bSTUN\b|\bTURN\b|\bRelay\b/u.test(
    `${peerTransferSource}\n${peerDirectTransferClient}\n${peerSwarmDownloader}`,
  ),
  "WP6 must not introduce WebRTC, RTCDataChannel, ICE/STUN/TURN, or Relay routes.",
);
const phase45ProductSources = await Promise.all(
  files
    .filter((path) =>
      path.endsWith(".mjs") || path.endsWith(".cs"))
    .filter((path) =>
      path.startsWith(join(root, "server/src")) ||
      path.startsWith(join(root, "project-peer/src")) ||
      path.startsWith(join(root, "unity-package/com.eunsung.teamforge/Editor")))
    .map(async (path) => `${relative(root, path)}\n${await readFile(path, "utf8")}`),
);
const phase45ProductSource = phase45ProductSources.join("\n");
assert(
  !/WebRTC|RTCDataChannel|RTCPeerConnection|\bICE\b|\bSTUN\b|\bTURN\b|\bRelay\b/u.test(phase45ProductSource),
  "Phase 4.5 product source must not contain WebRTC, ICE/STUN/TURN, or Relay implementations.",
);
assert.match(unityHomeWindow,
  /new Button\(StartCollaboration\)[\s\S]*Copy Collaboration Invite[\s\S]*Save Collaboration Invite/u);
assert.match(unityHostFlow, /EnsureSavedActiveSceneInteractive/u);
assert.match(unityHostFlow, /AssetDatabase\.SaveAssets\(\)/u);
assert.match(unityHostFlow, /Publish & Start/u);
assert.match(unityHostFlow, /reuseExistingBaseline[\s\S]*Start Existing Baseline/u);
assert.match(unityHostFlow, /reviewFingerprint[\s\S]*confirmation = "PUBLISH"/u);
assert.match(unityHostFlow, /requireRealtimeBootstrap = true[\s\S]*LooksLikeCollaborationInvite/u);
assert.match(unityHostFlow, /CopyCollaborationInvite[\s\S]*SaveCollaborationInvite/u);
assert.match(unityHostEndpointPolicy,
  /advertisedWildcard[\s\S]*listenExposed && advertisedLocalOnly[\s\S]*listenExposed && string\.IsNullOrWhiteSpace\(authenticationToken\)/u);
assert.match(unityHostFlow, /AssemblyReloadEvents\.beforeAssemblyReload/u);
assert.match(unityHostFlow, /TeamForgeRuntimeDiscovery\.Resolve\(\)/u);
assert.match(unityHostFlow, /TEAMFORGE_RUNTIME_KIND/u);
assert(!/TEAMFORGE_WORKSPACE_ROOT|TEAMFORGE_NODE_PATH/u.test(unityHostFlow),
  "Unity Host flow must delegate developer overrides to package-first runtime discovery.");
assert.match(unityRuntimeDiscovery, /PackageInfo\.FindForAssembly/u);
assert.match(unityRuntimeDiscovery, /Runtime~[\s\S]*runtime-manifest\.json/u);
assert.match(unityRuntimeDiscovery, /runtime_bundle_corrupt/u);
assert.match(unityRuntimeDiscovery, /UseShellExecute\s*=\s*false/u);
assert.match(unityRuntimeDiscovery, /Developer compatibility fallback only[\s\S]*TEAMFORGE_WORKSPACE_ROOT/u);
assert.equal(runtimeManifest.schemaVersion, releaseContract.protocols.runtimeManifest);
assert.equal(runtimeManifest.backendContractVersion, 1);
assert.equal(runtimeManifest.productVersion, releaseContract.productVersion);
assert.equal(runtimeManifest.nodeVersion, releaseContract.node.version);
assert.equal(runtimeManifest.nodeSourceArchive, releaseContract.node.sourceArchive);
assert.equal(runtimeManifest.nodeSourceArchiveSha256, releaseContract.node.sourceArchiveSha256);
assert.deepEqual(runtimeManifest.supportedNodeMajors, releaseContract.node.supportedMajors);
assert.deepEqual(runtimeManifest.minimumNodeVersions, releaseContract.node.minimumVersions);
assert.equal(runtimeManifest.wsVersion, releaseContract.ws.version);
assert.equal(runtimeManifest.wsIntegrity, releaseContract.ws.integrity);
assert(Array.isArray(runtimeManifest.files) && runtimeManifest.files.length > 0,
  "Runtime manifest must declare a non-empty exact file set.");
const runtimeManifestPaths = new Set();
for (const record of runtimeManifest.files) {
  assert.equal(typeof record?.path, "string", "Runtime manifest file path must be a string.");
  assert(
    record.path.length > 0 &&
    !record.path.includes("\\") &&
    !record.path.startsWith("/") &&
    !record.path.split("/").some((segment) => segment === "" || segment === "." || segment === ".."),
    `Runtime manifest contains an unsafe file path: ${record.path}`,
  );
  assert(!runtimeManifestPaths.has(record.path), `Runtime manifest contains duplicate file path: ${record.path}`);
  runtimeManifestPaths.add(record.path);
  assert(Number.isSafeInteger(record.size) && record.size >= 0,
    `Runtime manifest contains an invalid file size: ${record.path}`);
  assert.match(record.sha256, /^[0-9a-f]{64}$/u,
    `Runtime manifest contains an invalid SHA-256: ${record.path}`);
}
assert(runtimeManifestPaths.has(runtimeManifest.bridgeRelativePath),
  "Runtime manifest must declare its Host bridge file.");
assert(runtimeManifestPaths.has(runtimeManifest.guestBridgeRelativePath),
  "Runtime manifest must declare its Guest bridge file.");
for (const platform of runtimeManifest.platforms) {
  assert(runtimeManifestPaths.has(platform.executable),
    `Runtime manifest must declare the pinned ${platform.id} Node executable.`);
}
assert.match(unityRuntimePin,
  new RegExp(createHash("sha256").update(runtimeManifestSource).digest("hex"), "u"),
  "Unity runtime manifest pin must match the packaged manifest.");
assert.match(peerPreflight, /runtimeKind === "bundled_package" \|\| runtimeKind === "installed_package_runtime"/u);
assert.match(peerPreflight, /runtime_bundle_corrupt[\s\S]*runtime repair is disabled/u);
assert(!/\.Kill\s*\(|taskkill|kill-port/iu.test(unityHostFlow),
  "Unity Host flow must request WP2 cooperative stop and never kill a process directly.");
assert(
  !/AutoFallback|AutomaticFallback|LanDiscovery|ServerlessAuthority|EmbeddedAuthority|ComponentSync/u.test(
    phase45ProductSource,
  ),
  "Phase 4.5 product source must not contain deferred routes, authority modes, or Component Sync.",
);
assert.match(serverHost, /presence_update/);
assert.match(serverHost, /transform_update/);
assert.match(serverHost, /lock_request/);
assert.match(serverHost, /project_peer_announce/);
assert.match(serverHost, /project_baseline_publish/);
assert.match(serverHost, /hierarchy_seed/);
assert.match(serverHost, /hierarchy_operation/);
assert.match(serverHierarchyModel, /HIERARCHY_OPERATION_KINDS/);
assert.match(serverHierarchyModel, /tf:\[0-9a-f\]/);
assert.match(serverHierarchyModel, /sceneIds/);
assert.match(serverHierarchyTests, /subtree/i);
assert.match(serverHierarchyTests, /tombstone/i);
assert.match(serverSessionAuthority, /hierarchySceneIds/);
assert.match(serverSessionAuthority, /hierarchy_object_deleted/);
assert.match(serverSessionAuthority, /hierarchy_sync_required/);
assert.match(serverSessionAuthority, /selectedObjectId:\s*""/);
assert.match(unityProtocol, /PresenceUpdateMessage/);
assert.match(unityProtocol, /TransformUpdateMessage/);
assert.match(unityProtocol, /LockRequestMessage/);
assert.match(unityProtocol, /ProjectRegistrySnapshotMessage/);
assert.match(unityProtocol, /ProjectBaselineChangedMessage/);
assert.match(unityProtocol, /supportsHierarchySync/);
assert.match(unityProtocol, /hierarchySyncEnabled/);
assert.match(unityProtocol, /HierarchySnapshotMessage/);
assert.match(unityProtocol, /HierarchyOperationMessage/);
assert.match(unityProtocol, /public string\[\] sceneIds/);
assert.match(unityHierarchyService, /ObjectChangeEvents\.changesPublished/);
assert.match(unityHierarchyService, /CreateGameObjectHierarchy/);
assert.match(unityHierarchyService, /DestroyGameObjectHierarchy/);
assert.match(unityHierarchyService, /ChangeGameObjectParent/);
assert.match(unityHierarchyService, /ChangeChildrenOrder/);
assert.match(unityHierarchyService, /authoritative/i);
assert.match(unityHierarchyService, /sceneIds/);
assert.match(unityHierarchyService, /IsChildOf/);
assert.match(unityHierarchyIdentity, /Library\/TeamForge\/hierarchy-ids-v1\.json/);
assert.match(unityHierarchyIdentity, /LogicalPrefix = "tf:"/);
assert.match(unityHierarchyIdentity, /HashSet<string> SessionCanonicalLogicalIds/);
assert.match(
  unityHierarchyIdentity,
  /BeginConnectionIdentityEpoch[\s\S]*SessionCanonicalLogicalIds\.Clear\(\)/u,
  "A connection identity change must revoke logical authority inherited from the previous session.",
);
assert.match(unityHierarchyIdentity, /TryGetSessionLogicalId\(/);
assert.match(
  unityHierarchyIdentity,
  /BindLogicalCore\(logicalId, target, false\)/,
  "A persisted Library alias must bind only as a local resolver hint, never as current-session authority.",
);
assert(
  !unityHierarchyIdentity.includes("InstanceIDToObject"),
  "Unity 6000.3 deprecates InstanceIDToObject; the hierarchy identity registry must use EntityIdToObject.",
);
assert(
  !unityHierarchyIdentity.includes("GetInstanceID"),
  "Hierarchy identity registry must cache Unity 6000.3 EntityId values rather than legacy int Instance IDs.",
);
assert.match(
  unityHierarchyIdentity,
  /Dictionary<EntityId, string>/,
  "Hierarchy identity registry must key live-object identity by UnityEngine.EntityId.",
);
assert.match(
  unityHierarchyIdentity,
  /GetEntityId\(\)/,
  "Hierarchy identity registry must obtain live IDs with Object.GetEntityId on Unity 6000.3.",
);
assert.match(
  unityHierarchyIdentity,
  /Resources\.EntityIdToObject\(/,
  "Hierarchy identity registry must resolve cached live EntityIds with Resources.EntityIdToObject.",
);
assert.match(
  unityHierarchyService,
  /out string error,\s*bool applyTransform\)\s*\{\s*target = null;\s*error = string\.Empty;/u,
  "EnsureAndApplyObject must initialize its out error on every successful control-flow path (Unity C# CS0177 regression).",
);
assert.match(
  unityHierarchyService,
  /\(message\.kind == "create_object" \|\| message\.kind == "reparent_object"\)[\s\S]*state\.ObjectId == message\.objectId/u,
  "Remote Hierarchy apply must only apply Transform payloads to the create/reparent target; rename/reorder must preserve live Transform state.",
);
assert.match(
  unityHierarchyTests,
  /RemoteRenamePreservesLiveTransformWhenHierarchyRecordTransformIsStale/,
  "Unity EditMode coverage must retain the remote-rename Transform preservation regression.",
);
assert.match(
  serverSessionAuthority,
  /hierarchyRecord\.localPosition = copyVector3\(message\.localPosition\);[\s\S]*hierarchySnapshotByteLength\(session\)/u,
  "Accepted Transform updates must refresh the authoritative Hierarchy record and keep Hierarchy snapshot size checks active.",
);
assert.match(
  serverIntegrationTests,
  /Transform updates keep authoritative Hierarchy transforms current across rename and late join/,
  "Server integration coverage must retain Transform/Hierarchy coherence across rename and late join.",
);
assert.match(
  unityTransformService,
  /selectedAuthoritativeState[\s\S]*BeginTrackingSelection\(_wasConnected\)/u,
  "Hierarchy authority must re-arm Transform selection tracking after a newly-created selected object enters the baseline.",
);
assert.match(unityAuthorityView, /interface IAuthorityView/);
assert.match(unityAuthorityView, /long SessionRevision/);
assert.match(unityAuthorityView, /TeamForgeLockRegistry Locks/);
assert.match(unityAuthorityView, /string ConnectionId/);
assert.match(unityAuthorityView, /bool TransformSyncAvailable/);
assert.match(unityAuthorityView, /ObserveRevision\(long revision\)/);
assert.match(unityTransformService, /public static TeamForgeLockRegistry Locks => Authority\.Locks;/);
assert.match(unityTransformService, /public static long CurrentRevision => Authority\.SessionRevision;/);
assert(
  !/TeamForgeTransformSyncService\.(?:CurrentRevision|Locks|ObserveAuthoritativeRevision)/u.test(unityHierarchyService),
  "Hierarchy must consume the shared Authority View instead of Transform Service authority storage.",
);
assert.match(unityHierarchyService, /private static IAuthorityView Authority/);
assert.match(unityAuthorityViewTests, /SessionRevisionIsMonotonicAcrossSnapshotAndLiveObservationOrder/);
assert.match(unityAuthorityViewTests, /TransformCompatibilityFacadeAliasesTheSharedLockRegistry/);
assert(
  !/ScriptableSingleton|FilePath\s*\(/u.test(unityAuthorityView),
  "Observed connection Authority state must remain transient and must not persist through ScriptableSingleton.",
);
assert.match(unityConnectionStrategy, /interface IConnectionStrategy/);
assert.match(unityConnectionStrategy, /sealed class LegacyServerStrategy : IConnectionStrategy/);
assert.match(unityConnectionStrategy, /out RealtimeConnectionAttempt\[\] attempts/);
assert.match(
  unityConnectionStrategy,
  /attempts = new\[\][\s\S]*new RealtimeConnectionAttempt/u,
  "Legacy Server strategy must return the single configured Server endpoint as one ordered attempt.",
);
assert.match(unityRealtimeTransportFactory, /interface IRealtimeTransportFactory/);
assert.match(unityRealtimeTransportFactory, /sealed class WebSocketTransportFactory : IRealtimeTransportFactory/);
assert.match(unityRealtimeTransportFactory, /new ClientWebSocket\(\)/);
assert.match(unityRealtimeTransportFactory, /Options\.KeepAliveInterval/);
assert.match(unityRealtimeTransportFactory, /SetRequestHeader\([\s\S]*"Authorization"/u);
assert.match(unityRealtimeTransportFactory, /new ClientWebSocketTransport\(attempt\.Endpoint, socket\)/);
assert.match(unityRealtimeTransport, /Task ConnectAsync\(CancellationToken cancellationToken\);/);
assert(
  !/ConnectAsync\s*\(\s*Uri|bearerToken|keepAliveSeconds/u.test(unityRealtimeTransport),
  "Realtime transport connection must be configured by the attempt/factory rather than adapter-specific Connect arguments.",
);
assert(
  !/Options\.KeepAliveInterval|SetRequestHeader/u.test(unityClientWebSocketTransport),
  "ClientWebSocketTransport must execute the factory-configured attempt without rebuilding connection options.",
);
assert.match(unityConnectionService, /IConnectionStrategy ConnectionStrategy = new LegacyServerStrategy\(\)/);
assert.match(unityConnectionService, /IRealtimeTransportFactory TransportFactory = new WebSocketTransportFactory\(\)/);
assert.match(unityConnectionService, /var transport = TransportFactory\.Create\(attempt\);/);
assert.match(unityConnectionService, /CurrentEndpoint = attempt\.Endpoint\.ToString\(\);/);
assert.match(unityConnectionService, /await transport\.ConnectAsync\(timeout\.Token\);/);
assert(
  !/new ClientWebSocketTransport/u.test(unityConnectionService),
  "Connection Service must not directly construct the concrete ClientWebSocket adapter.",
);
assert.match(unityConnectionService, /AssemblyReloadEvents\.beforeAssemblyReload \+= BeforeAssemblyReload/);
assert.match(unityConnectionService, /EditorApplication\.delayCall \+= ResumeAfterAssemblyReload/);
assert.match(unityConnectionCompositionTests, /LegacyServerStrategyProducesExactlyOneConfiguredAttempt/);
assert.match(unityConnectionCompositionTests, /WebSocketTransportFactoryCreatesTheConfiguredExistingAdapter/);
assert.match(unityConnectionCompositionTests, /RealtimeTransportConnectContractIsAttemptConfiguredAndTextFocused/);
assert(
  !/WebRTC|\bICE\b|STUN|TURN|LAN discovery|Auto fallback|Relay/u.test(
    `${unityConnectionStrategy}\n${unityRealtimeTransportFactory}`,
  ),
  "WP5 must not add forbidden routes, discovery, relay, or WebRTC concepts.",
);
assert.match(
  unityTransformService,
  /_lastObservedState = authoritativeTransform\.Clone\(\);[\s\S]*_lastConfirmedState = authoritativeTransform\.Clone\(\);[\s\S]*_stateAtLockRequest = authoritativeTransform\.Clone\(\);/u,
  "Re-armed create tracking must preserve the server-approved create Transform so an in-flight local delta is not silently adopted.",
);
assert.match(unityTransformModel, /public bool TryGetCanonicalObjectId\(/);
assert.match(
  unityTransformModel,
  /TeamForgeObjectIdentity\.TryGetCanonicalObjectId\([\s\S]*logicalId => Contains\(sceneId, logicalId\)/u,
  "Transform baseline canonicalization must share the current-authority identity rule and retain exact membership.",
);
assert.match(unityTransformModel, /public bool TryGetCanonicalParentObjectId\(/);
assert.match(
  unityObjectIdentity,
  /TryGetSessionLogicalId\(target[\s\S]*acceptsLogicalId[\s\S]*objectId = string\.Empty;[\s\S]*return false;[\s\S]*TryGetGlobalObjectId\(target/u,
  "A rejected current-session logical key must fail closed instead of falling back to a split Global key.",
);
assert(
  !/TryGetCollaborativeObjectId[\s\S]{0,300}TryGetKnownId/u.test(unityObjectIdentity),
  "Presence and other wire producers must not promote an arbitrary persisted Library alias.",
);
assert.match(unityPresenceService, /SessionIdentityChanged \+= OnSessionIdentityChanged/);
assert.match(unityPresenceService, /BeginConnectionIdentityEpoch\(/);
assert.match(
  unityPresenceService,
  /presenceScene = !string\.IsNullOrEmpty\(selectedObjectId\)[\s\S]*\? selected\.scene[\s\S]*: activeScene/u,
  "Presence Scene identity must describe the selected object when a selection identity is transmitted.",
);
assert.match(
  unityPresenceService,
  /IsLogicalId\(objectId\)[\s\S]*!TeamForgeHierarchyIdentityRegistry\.IsSessionCanonicalLogicalId\(objectId\)[\s\S]*return false/u,
  "A persisted-only logical alias must fail closed on Presence resolution.",
);
assert.match(
  unityHierarchyService,
  /TryGetSessionLogicalId\(gameObject, out var logicalId\)/,
  "Live Hierarchy capture must not promote a persisted alias from a previous authority epoch.",
);
assert.match(
  unityTransformService,
  /Authority\.HierarchySyncAvailable[\s\S]*!TeamForgeHierarchySyncService\.SnapshotReady[\s\S]*Waiting for the authoritative Hierarchy snapshot/u,
  "Transform/Lock tracking must wait for current Hierarchy authority after reconnect.",
);
assert.match(
  unityTransformService,
  /IsLogicalId\(message\.objectId\)[\s\S]*!TeamForgeHierarchyIdentityRegistry\.IsSessionCanonicalLogicalId\(message\.objectId\)[\s\S]*return false/u,
  "Inbound logical Transform state must be confirmed by the current identity epoch.",
);
assert.match(
  unityTransformService,
  /OnTransformMessageReceived[\s\S]*Authority\.HierarchySyncAvailable[\s\S]*!TeamForgeHierarchySyncService\.SnapshotReady[\s\S]*return;[\s\S]*switch \(messageType\)/u,
  "Hierarchy-capable connections must reject all Transform/Lock authority messages before the Hierarchy snapshot is ready.",
);
assert.match(
  unityTransformService,
  /Baseline\.TryGetCanonicalObjectId\(message\.sceneId, target, out var canonicalObjectId\)[\s\S]*canonicalObjectId != message\.objectId[\s\S]*return false/u,
  "Inbound Transform must use the same exact canonical object key as Hierarchy authority.",
);
assert.match(
  unityTransformService,
  /OnHierarchyChanged\(\)[\s\S]*_nextIdentityValidationAt = 0;/u,
  "Hierarchy changes must force identity and parent revalidation before the next authority action.",
);
assert.match(
  unityTransformService,
  /SendLockRequest\(bool renewal\)[\s\S]*IsOperationPendingFor\(_selectedSceneId, _selectedObjectId\)[\s\S]*ValidateTrackedTargetOrSuspend\(\)[\s\S]*LockRequestMessage/u,
  "Every Lock request and renewal must revalidate the exact object and parent identity.",
);
assert.match(
  unityTransformService,
  /TryGetSceneId\(selected[\s\S]*Baseline\.TryGetCanonicalObjectId\(sceneId, selected[\s\S]*Baseline\.TryGetCanonicalParentObjectId\(sceneId, selected[\s\S]*Baseline\.Contains\(sceneId, objectId\)[\s\S]*Baseline\.MatchesParent\(sceneId, objectId, parentObjectId\)/u,
  "Saved selection and parent validation must use baseline-canonical identities without bypassing clean-baseline checks.",
);
assert.match(
  unityTransformService,
  /Baseline\.TryGetCanonicalParentObjectId\([\s\S]*message\.sceneId[\s\S]*Baseline\.MatchesParent\(message\.sceneId, message\.objectId, actualParentObjectId\)/u,
  "Remote Transform parent validation must canonicalize the same saved/logical aliases as local tracking.",
);
assert.match(unityHierarchyTests, /HierarchyRegistryKeepsCloneIsolationAndTombstonesDeletedIdentity/);
assert.match(
  unityHierarchyService,
  /PrepareInitialSnapshot[\s\S]*TryApplyAuthoritativeTombstones[\s\S]*CanApplyInitialSnapshot/u,
  "Reconnect must apply authoritative tombstones before the dirty-scene safety gate so offline edits cannot keep deleted objects alive.",
);
assert.match(
  unityHierarchyService,
  /DirtySceneHierarchyMatchesAuthoritative[\s\S]*ApproximatelyEquals/u,
  "Dirty reconnect reconciliation must preserve the fail-closed guard for divergent live Hierarchy or Transform state.",
);
assert.match(
  unityHierarchyTests,
  /InitialSnapshotDeletesOfflineEditedTombstoneAndAcceptsMatchingDirtyLiveHierarchy/,
  "Unity EditMode coverage must retain offline tombstone deletion on reconnect.",
);
assert.match(
  unityHierarchyTests,
  /InitialSnapshotStillRejectsDirtyLiveHierarchyDivergenceAfterTombstoneCleanup/,
  "Unity EditMode coverage must retain dirty live-object safety while allowing tombstone dominance.",
);
assert.match(unityWindow, /Hierarchy Sync/);
assert.match(unityHomeWindow, /Window\/TeamForge\/Collaboration/);
assert.match(unityHomeWindow, /Copy Collaboration Invite/);
assert.match(unityHomeWindow, /Advanced session-only TF1 code copied/);
assert(
  !/text\s*=\s*T\("Copy Invite"/u.test(unityHomeWindow),
  "The normal collaboration path must not expose the ambiguous legacy Copy Invite label.",
);
assert.match(unityHomeWindow, /TeamForgeTestLabWindow\.Open/);
assert.match(unityJoinCode, /public const string Prefix = "TF1\."/);
assert.match(unityJoinCode, /sceneBaseline/);
assert.match(unityJoinCode, /TeamForgeInviteCache/);
assert.match(unityJoinCode, /IsHex\(payload\.sceneBaseline\.sceneGuid, 32\)/);
assert.match(unityJoinCode, /IsHex\(payload\.sceneBaseline\.sha256, 64\)/);
assert.match(
  unityBaselineFingerprint,
  /if \(!File\.Exists\(fullPath\)\)[\s\S]*error\s*=[\s\S]*return false;[\s\S]*if \(!TryHashFile\(fullPath, out var localHash, out error\)\)/u,
  "Scene baseline validation must assign an actionable error before returning on a missing file; do not short-circuit an out error behind File.Exists.",
);
assert(
  !/!File\.Exists\(fullPath\)\s*\|\|\s*!TryHashFile\(fullPath,\s*out var localHash,\s*out error\)/u.test(unityBaselineFingerprint),
  "Do not combine File.Exists with TryHashFile(out error) using ||; short-circuiting leaves the out parameter unassigned (CS0177).",
);
assert(
  !/AuthenticationToken|Bearer Token|ownerPrivateKey|privateKey/u.test(unityJoinCode),
  "Join Code implementation must not serialize credentials or private keys.",
);
assert.match(unityTestLab, /"Library", "Temp", "Logs", "obj", "UserSettings"/);
assert.match(unityTestLab, /TEAMFORGE_TESTLAB_AUTH_TOKEN/);
assert.match(unityTestLab, /EditorApplication\.applicationPath/);
assert.match(unityTestLab, /HasDirtyLoadedScenes/);
assert.match(unityTestLab, /ShouldAutoConnectClone/);
assert.match(unityTestLab, /TryCreateStandardLab/);
assert.match(unityTestLab, /robocopy\.exe/);
const unityCloneBootstrap = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Editor/Testing/TeamForgeCloneBootstrap.cs"),
  "utf8",
);
assert.match(unityCloneBootstrap, /EditorApplication\.isCompiling/);
assert.match(unityCloneBootstrap, /EditorApplication\.isUpdating/);
assert.match(unityCloneBootstrap, /EditorApplication\.update \+= TryPrepareCloneWhenReady/);
assert.match(unityCloneBootstrap, /TeamForgeSceneBaseline sceneBaseline/);
assert.match(unityCloneBootstrap, /TryPrepareAutomationScene/);
assert.match(
  unityCloneBootstrap,
  /_baselinePrepared = true;[\s\S]*Give sceneOpened\/hierarchy callbacks one Editor update[\s\S]*return;/u,
  "Test Lab must yield one Editor update after the authoritative Scene opens before auto-connect can deliver realtime snapshots.",
);

assert.match(
  unityTestLab,
  /TryCaptureActiveScene\(out var sceneBaseline[\s\S]*WriteBootstrap\([\s\S]*sceneBaseline\)/u,
  "Test Lab clones must carry the exact saved host Scene baseline into clone bootstrap data.",
);
assert.match(
  unityBaselineFingerprint,
  /TryPrepareAutomationScene[\s\S]*AssetDatabase\.GUIDToAssetPath[\s\S]*EditorSceneManager\.OpenScene\(expectedPath, OpenSceneMode\.Single\)/u,
  "Test Lab automation must resolve the copied Scene GUID and open the exact baseline Scene before connecting.",
);
assert.match(
  unityBaselineFingerprint,
  /TryPrepareAutomationScene[\s\S]*HasDirtyLoadedScenes\(\)[\s\S]*stay offline/u,
  "Automatic clone Scene preparation must fail closed rather than discard dirty local Scenes.",
);
assert.match(
  unityHomeWindow,
  /SnapshotReady[\s\S]*Collaboration partially ready/u,
  "Home UI must not claim full collaboration readiness before the authoritative Hierarchy snapshot is accepted.",
);

const developerScript = await readFile(join(root, "scripts/teamforge.ps1"), "utf8");
assert.match(developerScript, /'unity-test'/);
assert.match(developerScript,
  /Start-Process -FilePath \$editor -ArgumentList \$arguments -PassThru[\s\S]*\$process\.WaitForExit\(\)[\s\S]*\$exitCode = \$process\.ExitCode/u,
  "Unity test entrypoint must wait on the Unity.exe process handle and capture its exit code.");
assert.doesNotMatch(developerScript, /^[ \t]*(?:\$[^=\r\n]+=[ \t]*)?Start-Process\b[^\r\n]*-Wait/mu,
  "Unity test entrypoint must not wait indefinitely on Unity-spawned descendants.");
assert.match(developerScript,
  /'-projectPath', \('"\{0\}"' -f \$project\)[\s\S]*'-testResults', \('"\{0\}"' -f \$results\)[\s\S]*'-logFile', \('"\{0\}"' -f \$log\)/u,
  "Unity test entrypoint must preserve quoted project and evidence paths.");
assert.match(developerScript,
  /Remove-Item -LiteralPath \$generatedPath[\s\S]*HasAttribute\('result'\)[\s\S]*'total', 'passed', 'failed', 'skipped', 'inconclusive'/u,
  "Unity test entrypoint must reject stale or malformed result XML.");
const isolatedWorkspaceInstalls = developerScript.match(
  /& \$Npm\.Source --prefix \(Join-Path \$Root '(?:server|project-peer)'\) ci --ignore-scripts --workspaces=false/gu,
) ?? [];
assert.equal(isolatedWorkspaceInstalls.length, 4,
  "Developer entrypoint must keep all isolated workspace installs local and lifecycle-script-free.");
assert.match(developerScript, /-runTests/);
assert.match(developerScript, /['"]-testPlatform['"]\s*,\s*['"]EditMode['"]/u);
assert.match(developerScript, /-testResults/);
assert.match(
  unityEditorSurfaceTests,
  /UnityEditor\.PackageManager\.PackageInfo\.FindForAssembly/,
  "Unity package tests must fully qualify PackageManager.PackageInfo on Unity 6000.3.",
);
assert(
  !/(^|[^.A-Za-z0-9_])PackageInfo\.FindForAssembly/u.test(unityEditorSurfaceTests),
  "A bare PackageInfo.FindForAssembly reference can trigger Unity 6000.3 CS0104.",
);
assert.match(unityProjectContract, /Ready\s*=\s*6/);
assert.match(unityProjectContract, /InvitationMismatch\s*=\s*9/);
assert.match(unityProjectContract, /BaselineAvailableNoSeed\s*=\s*10/);
assert.match(unityProjectService, /ResolveAvailability\(\s*true,\s*TryGetPreferredSeed/u);
assert.match(unityWindow, /Verified baseline exists · no direct seed is online/);
assert.match(unityWindow, /No verified baseline has been published/);

const transformModelTests = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeTransformModelTests.cs"),
  "utf8",
);
const presenceSafetyTests = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgePresenceSafetyTests.cs"),
  "utf8",
);
const globalObjectIdTests = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeGlobalObjectIdProbeTests.cs"),
  "utf8",
);
const projectValidationTests = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeProjectValidationTests.cs"),
  "utf8",
);
for (const [name, source] of [
  ["TeamForgeTransformModelTests.cs", transformModelTests],
  ["TeamForgePresenceSafetyTests.cs", presenceSafetyTests],
  ["TeamForgeGlobalObjectIdProbeTests.cs", globalObjectIdTests],
]) {
  assert(
    !source.includes("NewSceneMode.Additive"),
    `${name} must not create additive EditMode test scenes while Unity can own an unsaved Untitled scene.`,
  );
  assert(
    !source.includes("EditorSceneManager.CloseScene(workingScene"),
    `${name} must not explicitly unload the last loaded EditMode test scene; switch with NewSceneMode.Single instead.`,
  );
}
assert.match(
  transformModelTests,
  /AuthoritativeHierarchyCreateRearmsSelectedTransformTrackingAndPreservesPendingDelta/,
  "Unity EditMode coverage must retain the selected-new-object Hierarchy-to-Transform re-arm regression.",
);
assert.match(
  transformModelTests,
  /ResolveTransformSelectionIdentity\(target\)[\s\S]*AwaitingHierarchySnapshot[\s\S]*ObjectIdentityUnavailable/u,
  "The selected-new-object regression must use typed selection resolution instead of callback timing or UI status strings.",
);
assert.match(unityEditorAssemblyInfo, /InternalsVisibleTo\("EunSung\.TeamForge\.Editor\.Tests"\)/);
assert.match(
  unityTransformModel,
  /internal enum TeamForgeTransformSelectionRejection[\s\S]*AwaitingHierarchySnapshot[\s\S]*ProtectedConflict[\s\S]*internal sealed class TeamForgeTransformSelectionResolution[\s\S]*SceneId[\s\S]*ObjectId[\s\S]*ParentObjectId[\s\S]*Rejection/u,
  "Transform selection testability must remain an internal typed canonical identity result.",
);
assert.match(
  unityTransformService,
  /BeginTrackingSelection\(bool requestImmediately\)[\s\S]*ResolveTransformSelectionIdentity\(selected\)[\s\S]*ApplySelectionRejection\(resolution\)[\s\S]*_selectedObjectId = resolution\.ObjectId/u,
  "Production selection tracking must consume the same typed identity decision used by tests.",
);
assert.match(
  unityTransformService,
  /ResolveTransformSelectionIdentity[\s\S]*SnapshotReady[\s\S]*TryGetCanonicalObjectId[\s\S]*TryGetCanonicalParentObjectId[\s\S]*HierarchyBlockedKeys[\s\S]*Baseline\.Contains[\s\S]*Baseline\.MatchesParent[\s\S]*ProtectedConflictKeys/u,
  "The typed resolver must preserve the snapshot, canonical identity, baseline, parent and protected-conflict guards.",
);
assert.match(unityTransformService, /MatchesAuthoritativeSelection\(/);
assert.match(
  transformModelTests,
  /SavedBaselineLogicalAliasesCanonicalizeForTrackingLockAndTransform/,
  "Unity EditMode coverage must retain the WP8 saved-baseline logical-alias regression.",
);
assert.match(transformModelTests, /clone has no Library identity cache/);
assert.match(transformModelTests, /TeamForgeProtocol\.Deserialize<LockRequestMessage>/);
assert.match(transformModelTests, /TeamForgeProtocol\.Deserialize<TransformUpdateMessage>/);
assert.match(unityIdentityAuthorityAuditTests, /SavedPresenceIdentityIsDirectionIndependentAcrossMixedLibraryCaches/);
assert.match(unityIdentityAuthorityAuditTests, /SavedParentChildUseGlobalCanonicalFamilyAcrossPresenceTransformAndHierarchy/);
assert.match(unityIdentityAuthorityAuditTests, /RuntimeLogicalIdentityRemainsCanonicalAfterSaveAndAuthoritativeBaselineUpsert/);
assert.match(unityIdentityAuthorityAuditTests, /PresenceSelectionRecomputesWhenCurrentSessionLogicalIdentityChanges/);
assert.match(unityIdentityAuthorityAuditTests, /ReconnectRevokesPriorLogicalIdentityAndWaitsForHierarchySnapshot/);
assert.match(unityIdentityAuthorityAuditTests, /HierarchyConfirmationEstablishesCurrentLogicalSelectionIdentity/);
assert.match(unityIdentityAuthorityAuditTests, /AuthoritativeConfirmationAutomaticallyRearmsSelectedTransform/);
assert.match(unityIdentityAuthorityAuditTests, /AutomaticRearmRequestsLockWithCurrentCanonicalLogicalIdentity/);
assert.match(unityIdentityAuthorityAuditTests, /StaleLogicalTransformCreatesAnIsolatedProtectedConflictWithoutHidingRearmRootCause/);
assert.match(unityIdentityAuthorityAuditTests, /CurrentLogicalAuthorityRejectsGlobalTransformAndAcceptsExactLogicalTransform/);
assert.match(unityIdentityAuthorityAuditTests, /PendingLogicalParentChangeCannotSendLockOrTransformUnderStaleIdentity/);
assert.match(unityIdentityAuthorityAuditTests, /A current-session logical child must not fall back/);
assert.match(unityIdentityAuthorityAuditTests, /TeamForgeTransformSelectionRejection\.AwaitingHierarchySnapshot/);
assert.match(unityIdentityAuthorityAuditTests, /TeamForgeTransformSelectionRejection\.ProtectedConflict/);
assert.match(unityIdentityAuthorityAuditTests, /RequestSelectedLock\(\), Is\.False/);
assert(
  !unityIdentityAuthorityAuditTests.includes("BeginTrackingSelection"),
  "Identity/Authority re-arm tests must not directly call BeginTrackingSelection after authoritative apply.",
);
assert(
  !unityIdentityAuthorityAuditTests.includes("ReconnectDoesNotSendLockUnderUnconfirmedPriorLogicalIdentity"),
  "The contaminated reconnect mega-test must not return.",
);
assert(
  !unityIdentityAuthorityAuditTests.includes("ApplyAuthoritativeTransform"),
  "Identity/Authority tests must not bypass production ordering through private Transform apply.",
);
assert.match(
  unityIdentityAuthorityAuditTests,
  /StaleLogicalTransformCreatesAnIsolatedProtectedConflictWithoutHidingRearmRootCause[\s\S]*OnTransformMessageReceived/u,
  "Stale logical Transform coverage must enter through the production message entrypoint.",
);
assert.match(
  unityIdentityAuthorityAuditTests,
  /internal ReconnectRearmScenario\(\)[\s\S]*catch[\s\S]*Dispose\(\)[\s\S]*throw;/u,
  "A failed scenario constructor must clean up its shared Editor state before rethrowing.",
);
assert.match(
  unityIdentityAuthorityAuditTests,
  /"_pendingOperation",\s*"_scanScheduled"/u,
  "Identity/Authority tests must restore the Hierarchy scan scheduler as well as snapshot state.",
);
assert.match(unityIdentityAuthorityAuditTests, /PresenceSelectionSceneMatchesSelectedObjectInAdditiveSceneEditing/);
assert.match(unityIdentityAuthorityAuditTests, /\[TestCase\(true, false\)\]/);
assert.match(unityIdentityAuthorityAuditTests, /\[TestCase\(false, true\)\]/);
assert.match(unityIdentityAuthorityAuditTests, /\[TestCase\(true, true\)\]/);
assert.match(unityIdentityAuthorityAuditTests, /\[TestCase\(false, false\)\]/);
assert.match(
  transformModelTests,
  /new GameObject\("New Unsaved Object"\);\s*EditorSceneManager\.MarkSceneDirty\(workingScene\);/u,
  "The dirty-scene baseline regression must explicitly mark programmatic scene edits dirty.",
);
assert.match(
  transformModelTests,
  /if \(guard\.transform\.localPosition != Vector3\.zero\)[\s\S]*Undo\.PerformUndo\(\);/u,
  "The target-undo regression must tolerate Unity 6000.3 retaining an empty cleared Undo group.",
);
assert(
  !projectValidationTests.includes("ScriptableObject.CreateInstance<TeamForgeConnectionSettings>"),
  "ScriptableSingleton settings must not be instantiated with ScriptableObject.CreateInstance in tests.",
);
assert.match(
  projectValidationTests,
  /TeamForgeConnectionSettings\.instance/,
  "Invitation policy regression must exercise the actual ScriptableSingleton instance.",
);

for (const file of files.filter((path) => path.startsWith(join(root, "server/src")) && path.endsWith(".mjs"))) {
  const name = relative(root, file);
  const source = await readFile(file, "utf8");
  assert(!/from\s+["']node:fs(?:\/promises)?["']/.test(source), `${name} must not write Project payload to disk.`);
  assert(!/\b(?:writeFile|appendFile|createWriteStream)\s*\(/.test(source), `${name} contains a disk write API.`);
}
assert.match(serverProjectCoordinator, /Project payload and unknown fields are rejected/);
assert.match(serverHost, /createSessionAuthority/);
assert.match(serverHost, /createProjectCoordinatorCore/);
assert.match(serverProjectCoordinatorCore, /class ProjectCoordinatorCore/);
assert.match(serverProjectCoordinatorCore, /dispatch\(command\)/);
assert.match(serverProjectCoordinatorCore, /COORDINATOR_EFFECTS/);
assert.match(serverSessionAuthority, /class SessionAuthority/);
assert.match(serverSessionAuthority, /dispatch\(command\)/);
assert.match(serverSessionAuthority, /AUTHORITY_EFFECTS/);
assert.match(serverSessionAuthorityTests, /lease expiry ordering/);
assert.match(serverSessionAuthorityTests, /non-resurrectable tombstones/);
assert.match(
  serverSessionAuthorityTests,
  /Presence, Transform, Lock, Hierarchy, late join, and reconnect are directionally symmetric/,
);
assert.match(serverSessionAuthorityTests, /directionalRoutes/);
assert.match(serverSessionAuthorityTests, /operationRevisions[\s\S]*\[5, 6, 7, 8, 9\]/u);
assert.match(
  serverProjectCoordinatorCoreTests,
  /Project registry snapshots are atomically empty or fully bound to one UUID across announce and supersede/,
);
assert.match(
  unityProjectProtocolTests,
  /ProjectRegistryUuidInvariantAcceptsOnlyEmptyOrFullyUuidBoundSnapshots/,
);
assert.match(unityProjectProtocolTests, /Project registry baseline UUID does not match its routing UUID/);
assert(
  !/WebSocket|node:http|\bsocket\b|setInterval|setTimeout|clearInterval|clearTimeout|JSON\.parse|\.send\s*\(|\.close\s*\(/u.test(
    serverSessionAuthority,
  ),
  "Session Authority must not depend on WebSocket, HTTP, socket I/O, JSON parsing, or host timers.",
);
assert(
  !/session\.(?:locks|transforms|hierarchyObjects|hierarchyTombstones|hierarchySceneIds|operations|revision|members)\s*(?:=|\.set\s*\(|\.delete\s*\(|\.clear\s*\(|\.add\s*\()/u.test(
    serverHost,
  ),
  "Dedicated Server host must not directly mutate Session Authority state.",
);
assert(
  !/WebSocket|node:http|\bsocket\b|setInterval|setTimeout|clearInterval|clearTimeout|JSON\.parse|\.send\s*\(|\.close\s*\(/u.test(
    serverProjectCoordinatorCore,
  ),
  "Project Coordinator Core must not depend on WebSocket, HTTP, socket I/O, JSON parsing, or host timers.",
);
assert(
  !/projectMembers|projects\.(?:set|delete|clear)\s*\(|projectSessions\.(?:set|delete|clear)\s*\(/u.test(serverHost),
  "Dedicated Server host must not directly mutate Project Coordinator registry state.",
);
assert(
  !/from\s+["'][^"']*project-coordinator(?:-core)?\.mjs["']/u.test(serverSessionAuthority),
  "Session Authority Core must not depend on Project Coordinator modules.",
);
assert.match(
  serverProjectCoordinatorCore,
  /import \{ makeSessionKey \} from "\.\/session-authority\.mjs";/,
  "Project Coordinator Core must reuse the frozen session-key canonicalization helper.",
);
assert(
  !/\b(?:SessionAuthority|createSessionAuthority)\b/u.test(serverProjectCoordinatorCore),
  "Project Coordinator Core must not construct or drive Session Authority state.",
);

assert.match(phase45Architecture, /TeamForge Server WebSocket[\s\S]*direct HTTP between `project-peer` processes/);
assert.match(phase45Architecture, /LegacyPhase4Compatible/);
assert.match(
  phase45Architecture,
  /Collaboration identity is authority-canonical[\s\S]*GlobalObjectId[\s\S]*Library\/TeamForge[\s\S]*EntityId[\s\S]*baseline `Contains`[\s\S]*dirty-Scene fail-closed/u,
);
assert.match(phase45Architecture, /outgoing and inbound Transform\/Lock authority wait for `SnapshotReady`/);
assert.match(phase45Roadmap, /Phase 5[^\n]*Not started/i);
assert.match(phase45Roadmap, /WP4[^\n]*Field Closure BLOCKED/i);
assert.match(phase45ProjectState,
  /current closure remains \*\*BLOCKED\*\*[\s\S]*Windows-Field-Test-Checklist-WP5\.1\.md[\s\S]*NOT RUN[\s\S]*licensing IPC[\s\S]*NOT RUN/u);
assert.match(phase45Adr, /Preserve Protocol v1 and Phase 0/);
assert.match(phase45FieldChecklist, /A\/B\/C connection and Late Join/);
assert.match(phase45FieldChecklist, /NOT RUN/);
assert.match(phase45FieldChecklist, /exactly `123\/123`/);
assert.match(phase45ClosureReport, /Status: \*\*BLOCKED\*\*[\s\S]*field gate `NOT RUN`/u);
assert.match(phase45ClosureReport, /WP8-identity-authority-rearm-rootcause-hotfix-candidate\.zip/);
assert.match(phase45ClosureReport, /72\/72 PASS/);
assert.match(phase45ClosureReport, /73\/73 PASS/);
assert.match(phase45ClosureReport, /Exact final fresh archive[\s\S]*Unity Test Runner \*\*NOT RUN\*\*[\s\S]*expected count `123`/u);
assert.match(phase45TestReport, /105\/105 PASS/);
assert.match(phase45TestReport, /Field gate[\s\S]*NOT RUN/u);
assert(
  !/Pending final archive build/u.test(
    `${phase45ClosureReport}\n${phase45TestReport}\n${phase45FieldHotfixReport}\n${phase45IdentityAuditReport}\n${phase45IdentityAuditTestEvidence}\n${phase45IdentityRearmReport}`,
  ),
  "Final Closure documents must not retain provisional archive-result placeholders.",
);
assert.match(phase45ChangedFiles, /No Server, Project Peer or Unity product\/runtime file changed/);
assert.match(phase45FieldHotfixReport, /106 total, 105 passed, 1 failed/);
assert.match(phase45FieldHotfixReport, /106\/106 PASS/);
assert.match(phase45FieldHotfixReport, /Later repeat attempts produced no result XML[\s\S]*not[^\n]*reported as PASS/iu);
assert.match(phase45FieldHotfixReport, /Server and Project Peer trees are byte-identical/);
assert.match(phase45FieldHotfixReport, /Closure remains \*\*BLOCKED\*\*/);
assert.match(phase45FieldHotfixReport, /A\/B\/C multi-editor field test is \*\*NOT RUN\*\*/);
assert.match(phase45FieldHotfixChecklist, /Saved child with saved-parent alias A→B \/ B→A/);
assert.match(phase45FieldHotfixChecklist, /Overall hotfix field gate: PASS \/ FAIL \/ NOT RUN/);
assert.match(phase45FieldHotfixChangedFiles, /TeamForgeTransformModel\.cs/);
assert.match(phase45FieldHotfixChangedFiles, /TeamForgeTransformSyncService\.cs/);
assert.match(phase45FieldHotfixChangedFiles, /all `server\/` files/);
assert.match(phase45IdentityAuditReport, /53D624AC05634001EFBCBD3207F4EB7EA7579F2D8E92973E734823508A48A32D/);
assert.match(phase45IdentityAuditReport, /A therefore transmitted `tf:`[\s\S]*A -> B failure and B -> A success/u);
assert.match(phase45IdentityAuditReport, /current-session logical object rejected[\s\S]*splitting Hierarchy from Lock\/Transform/u);
assert.match(phase45IdentityAuditReport, /Inbound Transform[\s\S]*current-epoch confirmation/u);
assert.match(phase45IdentityAuditReport, /Unity EditMode: \*\*NOT RUN\*\*, expected `117`/);
assert.match(phase45IdentityAuditReport, /Server: \*\*72\/72 PASS\*\*/);
assert.match(phase45IdentityAuditReport, /Project Peer: \*\*73\/73 PASS\*\*/);
assert.match(phase45IdentityAuditReport, /Closure remains \*\*BLOCKED\*\*/);
assert.match(phase45IdentityContractMatrix, /Persisted local alias[\s\S]*cannot grant authority/u);
assert.match(phase45IdentityContractMatrix, /never fall back to a second Global server key/);
assert.match(phase45IdentityContractMatrix, /WP2-WP7 authority audit/);
assert.match(phase45IdentityAuditTestEvidence, /licensing IPC initialization failures/);
assert.match(phase45IdentityAuditTestEvidence, /106 \+ 10 \+ 1 = 117/);
assert.match(phase45IdentityAuditTestEvidence, /Fresh archive install\/test\/check\/smoke\/validator[\s\S]*\*\*PASS\*\*/u);
assert.match(phase45IdentityAuditFieldChecklist, /exactly `123\/123`/);
assert.match(phase45IdentityAuditFieldChecklist, /Overall field gate: PASS \/ FAIL \/ NOT RUN/);
assert.match(phase45IdentityAuditFieldChecklist, /Project UUID warning observed: YES \/ NO/);
assert.match(phase45IdentityAuditChangedFiles, /TeamForgeObjectIdentity\.cs/);
assert.match(phase45IdentityAuditChangedFiles, /TeamForgeIdentityAuthorityAuditTests\.cs/);
assert.match(phase45IdentityAuditChangedFiles, /No Server product\/runtime source and no Project Peer source\/test file changed/);
assert.match(phase45IdentityReconciliationReport, /Subsequent evidence correction/);
assert.match(phase45IdentityReconciliationReport, /116\/117 PASS/);
assert.match(phase45IdentityReconciliationReport, /Historical rerun instruction — superseded/);
assert.match(phase45IdentityRearmReport, /B2DAC04C72F7D0F048158A09208A1699F3C40E148DE85F9D43E70DBC271E55B5/);
assert.match(phase45IdentityRearmReport, /protected conflict[\s\S]*normal production sequence/iu);
assert.match(phase45IdentityRearmReport, /Clearing `ProtectedConflictKeys`[\s\S]*weaken/iu);
assert.match(phase45IdentityRearmReport, /Full Unity EditMode suite[\s\S]*\*\*NOT RUN\*\*, expected `123`/u);
assert.match(phase45IdentityRearmReport, /Server[\s\S]*\*\*72\/72 PASS\*\*/u);
assert.match(phase45IdentityRearmReport, /Project Peer[\s\S]*\*\*73\/73 PASS\*\*/u);
assert.match(phase45IdentityRearmReport, /Phase 4\.5 Closure remains \*\*BLOCKED\*\*/);
assert.match(phase45IdentityRearmChangedFiles, /Changed or added: 14/);
assert.match(phase45IdentityRearmChangedFiles, /Input files: 321/);
assert.match(phase45IdentityRearmChangedFiles, /Output files: 325/);
assert.match(phase45IdentityRearmChangedFiles, /TeamForgeTransformSelectionResolution/);
assert.match(phase45IdentityRearmChangedFiles, /Deleted: 0/);
assert.match(
  transferProtocolV1Doc,
  /hello_ack[\s\S]*presence_snapshot[\s\S]*hierarchy_snapshot[\s\S]*transform_snapshot[\s\S]*project_registry_snapshot/u,
  "Realtime Protocol v1 documentation must preserve negotiated snapshot ordering.",
);
assert.match(transferProtocolV1Doc, /Project Transfer Protocol v1/);

const settingsSource = await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Editor/Settings/TeamForgeConnectionSettings.cs"),
  "utf8",
);
assert.match(settingsSource, /UserSettings\/TeamForgeSettings\.asset/);

const gitIgnore = await readFile(join(root, ".gitignore"), "utf8");
assert.match(gitIgnore, /^TeamForgeProjects\/$/m, "Managed Project data and Owner keys must be ignored by default.");
assert.match(gitIgnore, /^teamforge-project-peer\.launch\.json$/m, "Sidecar launch settings should be local-only.");

const phase4Doc = await readFile(join(root, "docs/phases/phase-4.md"), "utf8");
const phase4TestReport = await readFile(join(root, "docs/phase-4-v0.5.0-test-report.md"), "utf8");
assert.match(phase4Doc, /Hierarchy Synchronization/);
assert.match(phase4Doc, /Phase 5/);
assert.match(phase4TestReport, /6000\.3\.21f1/);
assert.match(phase4TestReport, /NOT RUN/);

const goldenCompatibility = JSON.parse(await readFile(
  join(root, "unity-package/com.eunsung.teamforge/Tests/Fixtures/teamforge-compatibility-v1.json"),
  "utf8",
));
assert.equal(goldenCompatibility.schemaVersion, 1);
assert.equal(goldenCompatibility.realtimeProtocolVersion, 1);
assert.equal(goldenCompatibility.capabilityMatrix.length, 16);
assert.equal(new Set(goldenCompatibility.capabilityMatrix.map((entry) => entry.id)).size, 16);
for (const entry of goldenCompatibility.capabilityMatrix) {
  const accepted = (!entry.transform || entry.presence) &&
    (!entry.hierarchy || (entry.presence && entry.transform));
  assert.equal(entry.accepted, accepted, `Golden capability acceptance drifted for ${entry.id}.`);
  if (!accepted) {
    assert.deepEqual(entry.expectedMessages, ["error:invalid_hello"]);
    continue;
  }
  const expected = ["hello_ack"];
  if (entry.presence) expected.push("presence_snapshot");
  if (entry.hierarchy) expected.push("hierarchy_snapshot");
  if (entry.transform) expected.push("transform_snapshot");
  if (entry.project) expected.push("project_registry_snapshot");
  assert.deepEqual(entry.expectedMessages, expected, `Golden snapshot ordering drifted for ${entry.id}.`);
}
const goldenDescriptor = goldenCompatibility.descriptor;
const canonicalPayload = [
  "teamforge-baseline-v1",
  goldenDescriptor.projectId,
  goldenDescriptor.projectUuid,
  String(goldenDescriptor.baselineRevision),
  goldenDescriptor.manifestHash,
  goldenDescriptor.unityVersion,
  goldenDescriptor.teamForgePackageVersion,
  String(goldenDescriptor.realtimeProtocolVersion),
  String(goldenDescriptor.transferProtocolVersion),
  String(goldenDescriptor.manifestSchemaVersion),
  goldenDescriptor.ownerKeyId,
  goldenDescriptor.publisherKeyId,
].join("\n");
assert.equal(canonicalPayload, goldenCompatibility.canonicalPayload);
assert.equal(
  createHash("sha256").update(Buffer.from(canonicalPayload, "utf8")).digest("hex"),
  goldenDescriptor.descriptorHash,
);
assert.equal(goldenCompatibility.invite.projectUuid, goldenDescriptor.projectUuid);
assert.equal(goldenCompatibility.invite.ownerKeyId, goldenDescriptor.ownerKeyId);

for (const file of files) {
  const details = await stat(file);
  const portable = relative(root, file).replaceAll("\\", "/");
  if (portable === "unity-package/com.eunsung.teamforge/Runtime~/platforms/win-x64/node.exe" ||
      portable === "launcher/win-x64/Runtime/platforms/win-x64/node.exe") {
    assert.equal(details.size, 92_825_416, "Bundled Node executable size differs from the verified upstream payload.");
  } else if (portable.startsWith("launcher/win-x64/")) {
    assert(details.size <= 400 * 1024 * 1024,
      `Launcher publish file exceeds the archive per-file safety bound: ${relative(root, file)}`);
  } else {
    assert(details.size < 5_000_000, `Unexpectedly large tracked file: ${relative(root, file)}`);
  }
}

console.info(
  `Repository validation passed: ${files.length} files, ` +
    `${files.filter((path) => path.endsWith(".cs")).length} C# sources, protocol v${serverVersion}.`,
);
