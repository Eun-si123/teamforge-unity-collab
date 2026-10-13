import assert from "node:assert/strict";
import test from "node:test";
import { windowsRootProbeFailureCause, windowsRootProbeFailureDetails } from "../src/windows-root-probe.mjs";

test("classifies managed-root probe exit codes without exposing raw private codes", () => {
  assert.equal(windowsRootProbeFailureCause({ code: 22 }), "windows_root_unavailable");
  assert.equal(windowsRootProbeFailureCause({ code: 23 }), "windows_root_drive_not_fixed");
  assert.equal(windowsRootProbeFailureCause({ code: 24 }), "windows_root_filesystem_unsupported");
  assert.equal(windowsRootProbeFailureCause({ code: "24" }), "windows_root_filesystem_unsupported");
});

test("preserves ordinary process error codes and uses a stable fallback", () => {
  assert.equal(windowsRootProbeFailureCause({ code: "ETIMEDOUT" }), "ETIMEDOUT");
  assert.equal(windowsRootProbeFailureCause({}), "windows_root_probe_failed");
  assert.equal(windowsRootProbeFailureCause(null), "windows_root_probe_failed");
});

test("diagnostic details distinguish generic PowerShell exit from timeout or native rejection", () => {
  assert.deepEqual(windowsRootProbeFailureDetails({ code: 1 }, 44), {
    cause: "windows_root_probe_failed", probeExitCode: 1, probeElapsedMs: 44,
  });
  assert.deepEqual(windowsRootProbeFailureDetails({ code: "23" }, 45), {
    cause: "windows_root_drive_not_fixed", probeExitCode: 23, probeElapsedMs: 45,
  });
  assert.deepEqual(windowsRootProbeFailureDetails({
    code: "ETIMEDOUT", killed: true, signal: "SIGTERM",
  }, 15002), {
    cause: "ETIMEDOUT", probeTerminated: true, probeSignal: "SIGTERM",
    probeElapsedMs: 15002,
  });
});

test("diagnostics expose only bounded allowlisted fields, never raw error text or private paths", () => {
  const bad = new Error("secret=not-for-logs");
  bad.code = "C:/private/path?token=not-for-logs";
  bad.signal = "NOT_A_SIGNAL";
  bad.stdout = "secret-stdout";
  bad.stderr = "secret-stderr";
  bad.killed = false;
  const result = windowsRootProbeFailureDetails(bad, 100);
  assert.deepEqual(result, {
    cause: "windows_root_probe_failed",
    probeElapsedMs: 100,
  });
  assert.doesNotMatch(JSON.stringify(result), /secret|private|stdout|stderr/u);
  assert.equal(windowsRootProbeFailureCause(bad), "windows_root_probe_failed");
});

test("diagnostics refuse invalid exit codes, durations and untrusted signal values", () => {
  for (const value of [-1, 256, 1.5, null, undefined, "999", "1.0"]) {
    const details = windowsRootProbeFailureDetails({ code: value }, 60001);
    assert.equal(details.cause, "windows_root_probe_failed");
    assert.equal("probeExitCode" in details, false);
    assert.equal("probeElapsedMs" in details, false);
  }
  for (const duration of [-1, NaN, Infinity, 1.5, "123", null]) {
    assert.equal("probeElapsedMs" in windowsRootProbeFailureDetails({}, duration), false);
  }
  assert.deepEqual(windowsRootProbeFailureDetails(null), { cause: "windows_root_probe_failed" });
  assert.equal(windowsRootProbeFailureCause({ code: "ENOENT" }), "ENOENT");
});

test("diagnostic classification preserves fail-closed output across raw error variants", () => {
  const native = windowsRootProbeFailureDetails({ code: 24, stderr: "private metadata" });
  assert.deepEqual(native, { cause: "windows_root_filesystem_unsupported", probeExitCode: 24 });
  const unknown = windowsRootProbeFailureDetails({ code: "BOGUS_STRING", killed: true, signal: "SIGKILL" });
  assert.deepEqual(unknown, {
    cause: "windows_root_probe_failed", probeTerminated: true, probeSignal: "SIGKILL",
  });
});
