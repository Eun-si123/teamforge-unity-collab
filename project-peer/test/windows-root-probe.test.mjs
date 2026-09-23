import assert from "node:assert/strict";
import test from "node:test";
import { windowsRootProbeFailureCause } from "../src/windows-root-probe.mjs";

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
