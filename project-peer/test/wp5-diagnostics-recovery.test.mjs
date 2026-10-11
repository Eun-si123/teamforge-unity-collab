import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseSessionJoinCode } from "../src/bootstrap-invite.mjs";
import { TeamForgePeerError } from "../src/errors.mjs";
import { guestErrorInfo } from "../src/guest-orchestrator.mjs";

function sessionJoinCode(productVersion = "0.5.1") {
  const payload = {
    format: "teamforge-join-v1",
    productVersion,
    projectId: "wp5-diagnostics",
    projectUuid: "123e4567-e89b-42d3-a456-426614174000",
    sessionId: "session-2",
    serverAddress: "http://192.0.2.10:5080",
    realtimePath: "ws",
    hostDisplayName: "Host",
    createdUtc: "2026-08-16T00:00:00.000Z",
    sceneBaseline: {
      scenePath: "Assets/Scenes/Main.unity",
      sceneGuid: "1".repeat(32),
      sha256: "2".repeat(64),
    },
  };
  return `TF1.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
}

test("WP5 stale 0.5.0 runtime reports explicit 0.5.1 Invite version mismatch", () => {
  assert.throws(
    () => parseSessionJoinCode(sessionJoinCode("0.5.1"), { expectedProductVersion: "0.5.0" }),
    (error) => {
      assert.equal(error.code, "teamforge_version_mismatch");
      assert.deepEqual(error.details, {
        inviteProductVersion: "0.5.1",
        runtimeProductVersion: "0.5.0",
      });
      return true;
    },
  );
});

test("WP5 wrong access code is retryable and every copied field is secret safe", () => {
  const secret = "one-time-access-code";
  const error = new TeamForgePeerError(
    "access_code_incorrect",
    `Coordinator rejected accessCode=${secret} Authorization: Bearer ${secret}.`,
  );
  const info = guestErrorInfo(error, {
    secrets: [secret],
    diagnostics: {
      operation: "coordinator_connect",
      role: "Guest",
      projectIdentity: "123e4567…4000",
      endpoint: "http://192.0.2.10:5080",
      authenticationToken: secret,
      privateKey: secret,
      previousVerifiedActiveAvailable: true,
    },
  });
  assert.equal(info.code, "access_code_incorrect");
  assert.equal(info.userMessage, "Access code is incorrect.");
  assert.match(info.recoveryAction, /again and retry/u);
  assert.equal(JSON.stringify(info).includes(secret), false);
  assert.equal(Object.hasOwn(info.diagnostics, "authenticationToken"), false);
  assert.equal(Object.hasOwn(info.diagnostics, "privateKey"), false);
  assert.equal(info.diagnostics.previousVerifiedActiveAvailable, true);
});

test("WP5 failed revision diagnostics explicitly preserve a previous verified Active", () => {
  const error = new TeamForgePeerError(
    "direct_transfer_unavailable",
    "All verified direct Seeds were unavailable.",
    { stagingPath: "C:\\TF\\project\\staging\\download-2" },
  );
  const info = guestErrorInfo(error, {
    diagnostics: {
      operation: "project_receive",
      role: "Guest",
      baselineRevision: 2,
      activeRevision: 1,
      activePath: "C:\\TF\\project\\active\\1-abcdefabcdef",
      transferState: "failed",
      previousVerifiedActiveAvailable: true,
    },
  });
  assert.equal(info.userMessage, "Required project revision could not be downloaded.");
  assert.match(info.recoveryAction, /verified data will be reused/u);
  assert.equal(info.diagnostics.previousVerifiedActiveAvailable, true);
  assert.equal(info.diagnostics.activeRevision, 1);
  assert.match(info.diagnostics.stagingPath, /staging/u);
});

test("WP5 damaged Invite remains a fail-closed state with no destructive recovery", () => {
  const info = guestErrorInfo(new TeamForgePeerError(
    "invalid_bootstrap_invite",
    "Bootstrap invite signature verification failed.",
  ));
  assert.equal(info.userMessage, "Invite is invalid or damaged.");
  assert.equal(info.recoveryAction, "Copy a new invite from the Host.");
  assert.doesNotMatch(`${info.userMessage} ${info.recoveryAction}`, /delete|remove|overwrite/iu);
});

test("Unity Host settings identify the Host PC and surface malformed address inline", async () => {
  const root = path.resolve(import.meta.dirname, "..", "..");
  const [home, hostFlow] = await Promise.all([
    readFile(path.join(root, "unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeHomeWindow.cs"), "utf8"),
    readFile(path.join(root, "unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeHostFlow.cs"), "utf8"),
  ]);
  assert.match(home, /Host address \(Guests connect here\)/u);
  assert.match(home, /호스트 주소 \(참가자가 접속할 주소\)/u);
  assert.match(home, /hostAddressField\.RegisterValueChangedCallback[\s\S]*settings\.ServerAddress = evt\.newValue[\s\S]*settings\.SaveSettings\(\)/u);
  assert.match(home, /TryValidateBaseAddress\(settings\.ServerAddress[\s\S]*hostAddressError\.text = addressError/u);
  assert.match(hostFlow, /Use this Host address for Guests\?/u);
  assert.doesNotMatch(home, /T\("Guest address", "Guest 주소"\)/u);
});

test("Host access code is generated securely, rotated explicitly and never included in invites", async () => {
  const root = path.resolve(import.meta.dirname, "..", "..");
  const [settings, flow, home] = await Promise.all([
    readFile(path.join(root, "unity-package/com.eunsung.teamforge/Editor/Settings/TeamForgeConnectionSettings.cs"), "utf8"),
    readFile(path.join(root, "unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeHostFlow.cs"), "utf8"),
    readFile(path.join(root, "unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeHomeWindow.cs"), "utf8"),
  ]);
  assert.match(settings, /RandomNumberGenerator\.Create\(\)/u);
  assert.match(settings, /new byte\[32\]/u);
  assert.match(settings, /TryAssignGeneratedHostAccessCodeIfMissing/u);
  assert.match(settings, /EffectiveAuthenticationToken\)\) return false/u);
  assert.match(flow, /Generate a Host access code\?/u);
  assert.match(flow, /TryAssignGeneratedHostAccessCodeIfMissing\(settings\)/u);
  assert.match(home, /Show access code/u);
  assert.match(home, /Copy code/u);
  assert.match(home, /Regenerate Host access code\?/u);
  assert.match(home, /GUIUtility\.systemCopyBuffer = settings\.AuthenticationToken/u);
  assert.match(home, /TeamForgeHostFlow\.IsBusy \|\| TeamForgeHostFlow\.State == TeamForgeHostFlowState\.Ready/u);
});

test("WP5 Unity UX consumes stable Scene/Host codes and exposes one redacted copy action", async () => {
  const root = path.resolve(import.meta.dirname, "..", "..");
  const [baseline, joinCode, home, hostFlow, recovery] = await Promise.all([
    readFile(path.join(root, "unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeBaselineFingerprint.cs"), "utf8"),
    readFile(path.join(root, "unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeJoinCode.cs"), "utf8"),
    readFile(path.join(root, "unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeHomeWindow.cs"), "utf8"),
    readFile(path.join(root, "unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeHostFlow.cs"), "utf8"),
    readFile(path.join(root, "unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeRecoveryUx.cs"), "utf8"),
  ]);
  assert.match(baseline, /out string failureCode/u);
  assert.match(baseline, /failureCode = "scene_baseline_mismatch"/u);
  assert.match(joinCode, /TryValidateLocalScene\([\s\S]*out failureCode/u);
  assert.match(home, /Advanced \/ Technical Details/u);
  assert.match(home, /CopyRecoveryDiagnostics/u);
  assert.match(home, /_lastRecoveryRole/u);
  assert.match(home, /_lastRecoveryOperation/u);
  // The UI must use the *current* Host failure, even after a prior Guest recovery,
  // and retire old Host error details as a new attempt starts or succeeds.
  assert.match(home,
    /hostState == TeamForgeHostFlowState\.NeedsAction[\s\S]*_lastRecoveryCode = TeamForgeHostFlow\.ErrorCode[\s\S]*_lastRecoveryDetail = /u);
  assert.match(home,
    /else if \(ShouldClearPreviousRecovery\(hostState, _lastRecoveryRole\)\)[\s\S]*_lastRecoveryCode = "none"[\s\S]*_lastRecoveryDetail = string\.Empty/u);
  assert.match(home, /internal static bool ShouldClearPreviousRecovery/u);
  assert.doesNotMatch(home, /FailureGeneration != _lastHostFailureGeneration/u);
  assert.doesNotMatch(home, /var role = TeamForgeHostFlow\.State/u);
  assert.match(hostFlow, /failure\.rawCode/u);
  assert.match(hostFlow, /failure\.message/u);
  assert.match(hostFlow, /DiagnosticDetail/u);
  assert.match(hostFlow, /FailureGeneration/u);
  assert.match(hostFlow, /MaximumStandardErrorCharacters = 16384/u);
  assert.match(hostFlow, /DiagnosticDetail => BuildHostDiagnosticDetail\(_diagnosticDetail, StandardErrorSnapshot\(\)\)/u);
  assert.match(hostFlow, /failure\.message[\s\S]*backendDetail/u);
  assert.match(hostFlow, /exception\.Code,[\s\S]*exception\.Message/u);
  assert.match(hostFlow, /unknown_listener_not_terminated/u);
  assert.match(recovery, /MaximumHistory = 32/u);
  assert.match(recovery, /case "coordinator_timeout"/u);
  assert.match(recovery, /A timeout alone does not prove/u);
  assert.match(recovery, /SanitizeDiagnosticText/u);
  assert.match(recovery, /authorization[\s\S]*\[redacted\]/iu);
  assert.doesNotMatch(recovery, /Kill\(|Stop-Process|Process\.Kill/u);
});
