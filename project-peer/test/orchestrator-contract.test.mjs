import assert from "node:assert/strict";
import test from "node:test";
import {
  ORCHESTRATOR_API_VERSION,
  ORCHESTRATOR_FAILURE_KINDS,
  ORCHESTRATOR_OPERATIONS,
  ORCHESTRATOR_STATES,
  normalizeOrchestratorFailure,
} from "../src/orchestrator-contract.mjs";

test("WP0 freezes an inactive v1 orchestration seam without weakening confirmations", () => {
  assert.equal(ORCHESTRATOR_API_VERSION, 1);
  assert.equal(new Set(ORCHESTRATOR_STATES).size, ORCHESTRATOR_STATES.length);
  assert(Object.isFrozen(ORCHESTRATOR_STATES));
  assert.deepEqual(
    Object.keys(ORCHESTRATOR_OPERATIONS),
    ["inspect", "planHost", "commitHost", "createInvite", "join", "openActiveProject", "stop"],
  );
  assert.equal(ORCHESTRATOR_OPERATIONS.planHost.mutatesRemoteState, false);
  assert.equal(ORCHESTRATOR_OPERATIONS.commitHost.confirmation, "publish_review");
  assert.equal(ORCHESTRATOR_OPERATIONS.join.confirmation, "publisher_trust");
  assert.equal(ORCHESTRATOR_OPERATIONS.openActiveProject.confirmation, "open_project");
  assert.equal(ORCHESTRATOR_OPERATIONS.stop.ownedProcessesOnly, true);
  for (const operation of Object.values(ORCHESTRATOR_OPERATIONS)) {
    assert(Object.isFrozen(operation));
  }
});

test("WP0 failure seam maps known field friction without claiming port ownership", () => {
  assert.deepEqual(
    normalizeOrchestratorFailure({ code: "ERR_MODULE_NOT_FOUND", message: "Cannot find package 'ws'" }),
    {
      kind: ORCHESTRATOR_FAILURE_KINDS.dependenciesNotReady,
      rawCode: "ERR_MODULE_NOT_FOUND",
      message: "Cannot find package 'ws'",
      recoverable: true,
      action: "repair_dependencies",
    },
  );
  assert.deepEqual(
    normalizeOrchestratorFailure({ code: "EADDRINUSE", message: "listen EADDRINUSE 127.0.0.1:5091" }),
    {
      kind: ORCHESTRATOR_FAILURE_KINDS.portConflict,
      rawCode: "EADDRINUSE",
      message: "listen EADDRINUSE 127.0.0.1:5091",
      recoverable: true,
      action: "inspect_port_owner",
    },
  );
  assert.equal(
    normalizeOrchestratorFailure({ code: "ECONNREFUSED" }).action,
    "start_or_select_server",
  );
  assert.equal(
    normalizeOrchestratorFailure({ code: "project_not_initialized" }).action,
    "resolve_managed_root_or_publish",
  );
  assert.equal(
    normalizeOrchestratorFailure({ state: "AwaitingTrust" }).action,
    "review_publisher_fingerprint",
  );
  assert.equal(
    normalizeOrchestratorFailure({ code: "invalid_current_pointer" }).recoverable,
    false,
  );
  assert.equal(
    normalizeOrchestratorFailure({ code: "dependency_missing" }).action,
    "repair_dependencies",
  );
  assert.equal(
    normalizeOrchestratorFailure({ code: "port_occupied_unverified" }).action,
    "inspect_port_owner",
  );
  assert.equal(
    normalizeOrchestratorFailure({ code: "unsupported_unity_version" }).kind,
    ORCHESTRATOR_FAILURE_KINDS.launchSettingsInvalid,
  );
  assert.deepEqual(
    normalizeOrchestratorFailure({ code: "realtime_session_missing" }),
    {
      kind: ORCHESTRATOR_FAILURE_KINDS.realtimeSessionMissing,
      rawCode: "realtime_session_missing",
      message: "",
      recoverable: true,
      action: "restart_host_from_unity",
    },
  );
  assert.equal(
    normalizeOrchestratorFailure({ code: "port_conflict" }).kind,
    ORCHESTRATOR_FAILURE_KINDS.portConflict,
  );
  assert.equal(
    normalizeOrchestratorFailure({ code: "server_authentication_unavailable" }).kind,
    ORCHESTRATOR_FAILURE_KINDS.serverUnavailable,
  );
});
