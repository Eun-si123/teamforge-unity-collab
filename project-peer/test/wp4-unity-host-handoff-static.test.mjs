import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("WP4 Unity Host requires a fresh TF1 code and exposes only the signed Collaboration Invite", async () => {
  const source = await readFile(path.join(
    repositoryRoot,
    "unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeHostFlow.cs",
  ), "utf8");
  const createIndex = source.indexOf("TeamForgeJoinCode.TryCreateFresh(out var realtimeJoinCode");
  const commitIndex = source.indexOf("SendAsync(\"commitHost\"");
  assert(createIndex >= 0 && createIndex < commitIndex);
  assert.match(source, /realtimeJoinCode\s*=\s*realtimeJoinCode/u);
  assert.match(source, /requireRealtimeBootstrap\s*=\s*true/u);
  assert.match(source, /!LooksLikeCollaborationInvite\(ready\.bootstrapInvite\)[\s\S]*StopAfterInvalidHostReadyAsync/u);
  assert.match(source, /_collaborationInvite\s*=\s*ready\.bootstrapInvite/u);
  assert.doesNotMatch(source, /_collaborationInvite\s*=\s*ready\.invite/u);
  assert.match(source, /teamforge-collaboration\.invite\.json/u);
  assert.doesNotMatch(source, /realtimeJoinCode\s*=.*AuthenticationToken/u);

  const joinCodeSource = await readFile(path.join(
    repositoryRoot,
    "unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeJoinCode.cs",
  ), "utf8");
  assert.match(joinCodeSource, /TryCreateFresh[\s\S]*TryCreateCore\(true,/u);
  assert.match(
    joinCodeSource,
    /if \(requireFreshSceneBaseline \|\|[\s\S]*!TeamForgeInviteCache\.TryGet/u,
  );
  assert.match(joinCodeSource, /TryCaptureActiveScene\(out sceneBaseline/u);
});

test("WP4 Host source-change guard binds TF1 Scene path and hash to the reviewed manifest before lifecycle start", async () => {
  const source = await readFile(path.join(repositoryRoot, "project-peer/src/host-orchestrator.mjs"), "utf8");
  const commitBody = source.slice(source.indexOf("async commitHost("), source.indexOf("async stop()"));
  const guardIndex = commitBody.indexOf("assertRealtimeSceneMatchesPublication(realtimeJoinCode, plan.publication)");
  const coordinatorIndex = commitBody.indexOf("this.lifecycle.ensureCoordinator");
  assert(guardIndex >= 0 && guardIndex < coordinatorIndex);
  assert.match(source, /file\.path === scene\.scenePath/u);
  assert.match(source, /entry\.fileHash !== scene\.sha256/u);
});

test("WP4 production Guest handoff is one-shot and applies TF1 only after exact Active identity checks", async () => {
  const source = await readFile(path.join(
    repositoryRoot,
    "unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeGuestHandoff.cs",
  ), "utf8");
  assert.match(source, /\[InitializeOnLoad\]/u);
  assert.match(source, /TEAMFORGE_GUEST_HANDOFF_PATH/u);
  assert.match(source, /TEAMFORGE_GUEST_HANDOFF_SHA256/u);
  assert.match(source, /TEAMFORGE_GUEST_AUTHENTICATION_TOKEN/u);
  assert.match(source, /Environment\.SpecialFolder\.LocalApplicationData/u);
  assert.match(source, /"guest-core",\s*\n\s*"handoff"/u);
  assert.match(source, /MaximumAgeMilliseconds\s*=\s*15\s*\*\s*60\s*\*\s*1000/u);
  assert.match(source, /HasExactJsonFields\(json, HandoffFields\)/u);
  assert.match(source, /descriptor\.baselineRevision\s*!=\s*handoff\.baselineRevision/u);
  assert.match(source, /descriptor\.manifestHash, handoff\.manifestHash/u);
  assert.match(source, /descriptor\.descriptorHash, handoff\.descriptorHash/u);
  assert.match(source, /descriptor\.unityVersion, Application\.unityVersion/u);

  const clearIndex = source.indexOf("Environment.SetEnvironmentVariable(PathEnvironmentVariable, null)");
  const clearAuthenticationIndex = source.indexOf("Environment.SetEnvironmentVariable(AuthenticationEnvironmentVariable, null)");
  const readIndex = source.indexOf("TryReadAndConsume(handoffPath, expectedHash");
  assert(clearIndex >= 0 && clearIndex < readIndex);
  assert(clearAuthenticationIndex >= 0 && clearAuthenticationIndex < readIndex);

  const consumeBody = source.slice(source.indexOf("private static bool TryReadAndConsume("));
  const integrityIndex = consumeBody.indexOf("HashBytes(bytes)");
  const deleteIndex = consumeBody.indexOf("File.Delete(fullPath)");
  const parseIndex = consumeBody.indexOf("JsonUtility.FromJson<TeamForgeGuestHandoffData>");
  assert(integrityIndex >= 0 && integrityIndex < deleteIndex);
  assert(deleteIndex >= 0 && deleteIndex < parseIndex);

  const applyBody = source.slice(
    source.indexOf("private static void ApplyWhenEditorReady()"),
    source.indexOf("private static bool TryReadAndConsume("),
  );
  const activeCheckIndex = applyBody.indexOf("TryValidateActiveProject(handoff");
  const applyIndex = applyBody.indexOf("TeamForgeJoinCode.TryApply(handoff.sessionJoinCode, true");
  const transientCredentialIndex = applyBody.indexOf("TrySetGuestTransientAuthenticationToken(");
  const connectIndex = applyBody.indexOf("TeamForgeConnectionService.Connect()");
  assert(activeCheckIndex >= 0 && activeCheckIndex < applyIndex);
  assert(applyIndex >= 0 && applyIndex < transientCredentialIndex);
  assert(transientCredentialIndex >= 0 && transientCredentialIndex < connectIndex);
  assert.doesNotMatch(source, /TeamForgeCloneBootstrap/u);
  assert.doesNotMatch(
    source.slice(source.indexOf("internal sealed class TeamForgeGuestHandoffData"), source.indexOf("[InitializeOnLoad]")),
    /AuthenticationToken/u,
  );

  const settingsSource = await readFile(path.join(
    repositoryRoot,
    "unity-package/com.eunsung.teamforge/Editor/Settings/TeamForgeConnectionSettings.cs",
  ), "utf8");
  assert.match(settingsSource, /\[NonSerialized\][\s\S]*_guestTransientAuthenticationToken/u);
  assert.match(settingsSource, /AuthenticationToken[\s\S]*_guestTransientAuthenticationToken/u);
  assert.match(settingsSource, /TrySetGuestTransientAuthenticationToken/u);
});

test("WP4 Launcher retains the optional access code only in memory until exact Unity starts", async () => {
  const source = await readFile(path.join(
    repositoryRoot,
    "launcher/src/TeamForge.Launcher/MainWindow.xaml.cs",
  ), "utf8");
  const receiveBody = source.slice(
    source.indexOf("private async void Receive_Click"),
    source.indexOf("private async void Pause_Click"),
  );
  const captureIndex = receiveBody.indexOf("var submittedAccessCode =");
  const invalidateIndex = receiveBody.indexOf("InvalidateReadyProject()");
  const retainIndex = receiveBody.indexOf("_pendingAccessCode = submittedAccessCode");
  const bridgeIndex = receiveBody.indexOf('["authenticationToken"] = _pendingAccessCode');
  const bridgeSendIndex = receiveBody.indexOf('SendRequestAsync("start", values)');
  const localRemoveIndex = receiveBody.indexOf('values.Remove("authenticationToken")');
  assert(captureIndex >= 0 && captureIndex < invalidateIndex);
  assert(invalidateIndex >= 0 && invalidateIndex < retainIndex);
  assert(retainIndex >= 0 && retainIndex < bridgeIndex);
  assert(bridgeIndex < bridgeSendIndex && bridgeSendIndex < localRemoveIndex);
  assert.match(receiveBody, /catch \(BridgeException exception\)[\s\S]*ClearPendingAccessCode\(\)/u);

  const launchBody = source.slice(
    source.indexOf("private async Task TryOpenUnityAsync"),
    source.indexOf("private void Bridge_EventReceived"),
  );
  const revalidateIndex = launchBody.indexOf("ValidateActiveResultAsync(");
  const refreshIndex = launchBody.indexOf("RefreshHandoffForUnityLaunchAsync(sourceProject)");
  const startInfoIndex = launchBody.indexOf("CreateUnityOpenStartInfo(editor, launchProject, _pendingAccessCode)");
  const processIndex = launchBody.indexOf("Process.Start(startInfo)");
  const clearIndex = launchBody.indexOf("ClearPendingAccessCode()");
  assert(revalidateIndex >= 0 && revalidateIndex < refreshIndex);
  assert(refreshIndex >= 0 && refreshIndex < startInfoIndex);
  assert(startInfoIndex >= 0 && startInfoIndex < processIndex);
  assert(processIndex >= 0 && processIndex < clearIndex);
  assert.match(launchBody, /catch[\s\S]*DeleteRefreshedHandoff\(launchProject\)/u);
  assert.doesNotMatch(source, /AppendDiagnostic\([^\n]*pendingAccessCode/u);
  assert.match(source, /AccessCodeBox\.IsEnabled\s*=\s*!_receiving\s*&&\s*_readyProject is null/u);

  const cancelBody = source.slice(
    source.indexOf("private async void Cancel_Click"),
    source.indexOf("private void ChooseDestination_Click"),
  );
  assert(cancelBody.indexOf("ClearPendingAccessCode()") < cancelBody.indexOf('SendRequestAsync("cancel"'));
  assert.match(source, /Window_Closing[\s\S]*ClearPendingAccessCode\(\)/u);
  assert.match(launchBody, /startInfo\.Environment\.Remove\(UnityLaunchPolicy\.GuestAuthenticationEnvironmentVariable\)/u);
});
