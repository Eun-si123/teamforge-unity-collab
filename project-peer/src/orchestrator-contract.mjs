export const ORCHESTRATOR_API_VERSION = 1;

export const ORCHESTRATOR_STATES = Object.freeze([
  "idle",
  "preflighting",
  "needs_action",
  "planning_host",
  "awaiting_publish_confirmation",
  "starting_server",
  "publishing",
  "starting_seed",
  "host_ready",
  "syncing",
  "awaiting_trust",
  "join_complete",
  "opening_project",
  "stopping",
  "failed",
]);

export const ORCHESTRATOR_OPERATIONS = Object.freeze({
  inspect: Object.freeze({
    mutatesLocalState: false,
    mutatesRemoteState: false,
    requiresUserConfirmation: false,
  }),
  planHost: Object.freeze({
    // Existing publication preparation can create local draft metadata/chunks.
    mutatesLocalState: true,
    mutatesRemoteState: false,
    requiresUserConfirmation: false,
  }),
  commitHost: Object.freeze({
    mutatesLocalState: true,
    mutatesRemoteState: true,
    requiresUserConfirmation: true,
    confirmation: "publish_review",
  }),
  createInvite: Object.freeze({
    mutatesLocalState: true,
    mutatesRemoteState: false,
    requiresUserConfirmation: false,
  }),
  join: Object.freeze({
    mutatesLocalState: true,
    mutatesRemoteState: true,
    requiresUserConfirmation: true,
    confirmation: "publisher_trust",
  }),
  openActiveProject: Object.freeze({
    mutatesLocalState: false,
    mutatesRemoteState: false,
    requiresUserConfirmation: true,
    confirmation: "open_project",
  }),
  stop: Object.freeze({
    mutatesLocalState: true,
    mutatesRemoteState: true,
    requiresUserConfirmation: false,
    ownedProcessesOnly: true,
  }),
});

export const ORCHESTRATOR_FAILURE_KINDS = Object.freeze({
  dependenciesNotReady: "dependencies_not_ready",
  serverUnavailable: "server_unavailable",
  portConflict: "port_conflict",
  projectNotInitialized: "project_not_initialized",
  launchSettingsInvalid: "launch_settings_invalid",
  realtimeSessionMissing: "realtime_session_missing",
  sourceChanged: "source_changed",
  baselineUnavailable: "baseline_unavailable",
  trustRequired: "trust_required",
  activePathInvalid: "active_path_invalid",
  operationCancelled: "operation_cancelled",
  unexpected: "unexpected",
});

const FAILURE_POLICIES = Object.freeze({
  [ORCHESTRATOR_FAILURE_KINDS.dependenciesNotReady]: Object.freeze({
    recoverable: true,
    action: "repair_dependencies",
  }),
  [ORCHESTRATOR_FAILURE_KINDS.serverUnavailable]: Object.freeze({
    recoverable: true,
    action: "start_or_select_server",
  }),
  [ORCHESTRATOR_FAILURE_KINDS.portConflict]: Object.freeze({
    recoverable: true,
    action: "inspect_port_owner",
  }),
  [ORCHESTRATOR_FAILURE_KINDS.projectNotInitialized]: Object.freeze({
    recoverable: true,
    action: "resolve_managed_root_or_publish",
  }),
  [ORCHESTRATOR_FAILURE_KINDS.launchSettingsInvalid]: Object.freeze({
    recoverable: true,
    action: "regenerate_launch_settings",
  }),
  [ORCHESTRATOR_FAILURE_KINDS.realtimeSessionMissing]: Object.freeze({
    recoverable: true,
    action: "restart_host_from_unity",
  }),
  [ORCHESTRATOR_FAILURE_KINDS.sourceChanged]: Object.freeze({
    recoverable: true,
    action: "review_source_and_replan",
  }),
  [ORCHESTRATOR_FAILURE_KINDS.baselineUnavailable]: Object.freeze({
    recoverable: true,
    action: "wait_for_approved_seed",
  }),
  [ORCHESTRATOR_FAILURE_KINDS.trustRequired]: Object.freeze({
    recoverable: true,
    action: "review_publisher_fingerprint",
  }),
  [ORCHESTRATOR_FAILURE_KINDS.activePathInvalid]: Object.freeze({
    recoverable: false,
    action: "preserve_and_diagnose_managed_root",
  }),
  [ORCHESTRATOR_FAILURE_KINDS.operationCancelled]: Object.freeze({
    recoverable: true,
    action: "return_to_review",
  }),
  [ORCHESTRATOR_FAILURE_KINDS.unexpected]: Object.freeze({
    recoverable: false,
    action: "export_diagnostics",
  }),
});

const CODE_TO_KIND = new Map([
  ["ERR_MODULE_NOT_FOUND", ORCHESTRATOR_FAILURE_KINDS.dependenciesNotReady],
  ["unsupported_node_version", ORCHESTRATOR_FAILURE_KINDS.dependenciesNotReady],
  ["npm_unavailable", ORCHESTRATOR_FAILURE_KINDS.dependenciesNotReady],
  ["lockfile_missing", ORCHESTRATOR_FAILURE_KINDS.dependenciesNotReady],
  ["dependency_missing", ORCHESTRATOR_FAILURE_KINDS.dependenciesNotReady],
  ["dependency_stale", ORCHESTRATOR_FAILURE_KINDS.dependenciesNotReady],
  ["dependency_contract_invalid", ORCHESTRATOR_FAILURE_KINDS.dependenciesNotReady],
  ["dependency_repair_failed", ORCHESTRATOR_FAILURE_KINDS.dependenciesNotReady],
  ["dependency_repair_in_progress", ORCHESTRATOR_FAILURE_KINDS.dependenciesNotReady],
  ["EADDRINUSE", ORCHESTRATOR_FAILURE_KINDS.portConflict],
  ["port_conflict", ORCHESTRATOR_FAILURE_KINDS.portConflict],
  ["port_occupied_unverified", ORCHESTRATOR_FAILURE_KINDS.portConflict],
  ["lifecycle_identity_mismatch", ORCHESTRATOR_FAILURE_KINDS.portConflict],
  ["ECONNREFUSED", ORCHESTRATOR_FAILURE_KINDS.serverUnavailable],
  ["server_authentication_unavailable", ORCHESTRATOR_FAILURE_KINDS.serverUnavailable],
  ["coordinator_start_timeout", ORCHESTRATOR_FAILURE_KINDS.serverUnavailable],
  ["coordinator_closed", ORCHESTRATOR_FAILURE_KINDS.serverUnavailable],
  ["coordinator_timeout", ORCHESTRATOR_FAILURE_KINDS.serverUnavailable],
  ["project_not_initialized", ORCHESTRATOR_FAILURE_KINDS.projectNotInitialized],
  ["invalid_launch_settings", ORCHESTRATOR_FAILURE_KINDS.launchSettingsInvalid],
  ["invalid_launch_settings_file", ORCHESTRATOR_FAILURE_KINDS.launchSettingsInvalid],
  ["invalid_launch_settings_path", ORCHESTRATOR_FAILURE_KINDS.launchSettingsInvalid],
  ["launch_path_escape", ORCHESTRATOR_FAILURE_KINDS.launchSettingsInvalid],
  ["launch_settings_load_failed", ORCHESTRATOR_FAILURE_KINDS.launchSettingsInvalid],
  ["invalid_project_root", ORCHESTRATOR_FAILURE_KINDS.launchSettingsInvalid],
  ["unity_project_version_missing", ORCHESTRATOR_FAILURE_KINDS.launchSettingsInvalid],
  ["unsupported_unity_version", ORCHESTRATOR_FAILURE_KINDS.launchSettingsInvalid],
  ["realtime_session_missing", ORCHESTRATOR_FAILURE_KINDS.realtimeSessionMissing],
  ["invalid_managed_root", ORCHESTRATOR_FAILURE_KINDS.projectNotInitialized],
  ["managed_root_not_writable", ORCHESTRATOR_FAILURE_KINDS.projectNotInitialized],
  ["source_changed", ORCHESTRATOR_FAILURE_KINDS.sourceChanged],
  ["unity_descriptor_changed", ORCHESTRATOR_FAILURE_KINDS.sourceChanged],
  ["baseline_unavailable", ORCHESTRATOR_FAILURE_KINDS.baselineUnavailable],
  ["direct_transfer_unavailable", ORCHESTRATOR_FAILURE_KINDS.baselineUnavailable],
  ["AwaitingTrust", ORCHESTRATOR_FAILURE_KINDS.trustRequired],
  ["invalid_current_pointer", ORCHESTRATOR_FAILURE_KINDS.activePathInvalid],
  ["publish_cancelled", ORCHESTRATOR_FAILURE_KINDS.operationCancelled],
  ["download_cancelled", ORCHESTRATOR_FAILURE_KINDS.operationCancelled],
]);

function text(value) {
  return typeof value === "string" ? value : "";
}

export function normalizeOrchestratorFailure(errorLike = {}) {
  const rawCode = text(errorLike.code) || text(errorLike.state) || "unexpected_error";
  const message = text(errorLike.message);
  let kind = CODE_TO_KIND.get(rawCode);
  if (!kind && (message.includes("Cannot find package 'ws'") || message.includes('Cannot find module "ws"'))) {
    kind = ORCHESTRATOR_FAILURE_KINDS.dependenciesNotReady;
  }
  kind ??= ORCHESTRATOR_FAILURE_KINDS.unexpected;
  const policy = FAILURE_POLICIES[kind];
  return Object.freeze({
    kind,
    rawCode,
    message,
    recoverable: policy.recoverable,
    action: policy.action,
  });
}
