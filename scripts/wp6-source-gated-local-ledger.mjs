// WP6 offline monorepo integration only. Admit an *actual stored signed
// Scene-value match* BEFORE seeding the existing Publisher-bound local
// property ledger. All operations remain server-memory test simulations.
// No production WebSocket or Editor command imports this module.
import { inspectWp6PublisherColliderValuesInSignedSceneForLocalTest }
  from "./wp6-signed-collider-value-bridge.mjs";
import {
  beginPublisherApprovedColliderLedgerForLocalTest,
  inspectPublisherApprovedColliderLedgerForLocalTest,
  commitPublisherApprovedColliderLedgerForLocalTest,
  inspectPublisherApprovedColliderNextDeliveryForLocalTest,
  inspectPublisherApprovedColliderReceiverObservationForLocalTest,
  retirePublisherApprovedColliderLedgerForLocalTest,
} from "../server/src/component-publisher-ledger-lifecycle.mjs";

const admitted = new WeakMap();

function rejected(code, reason) {
  return Object.freeze({ error: code, reason, repair: "resnapshot_required" });
}
function stateFor(value) {
  if (!value || typeof value !== "object") return null;
  return admitted.get(value) ?? null;
}
function readState(value) {
  const state = stateFor(value);
  return state && !state.retired ? state : null;
}

// An invalid user cursor or stale *request* is not a reason to erase an
// otherwise healthy Publisher ledger. Retire only if the original live
// authority/session/epoch is invalidated by the underlying lifecycle.
const RETIRED_AUTHORITIES = new Set([
  "component_publisher_ledger_retired",
  "component_publisher_ledger_member_replaced",
  "component_publisher_ledger_baseline_rotated",
  "component_publisher_ledger_descriptor_invalid",
  "component_publisher_ledger_stale",
  "component_publisher_delivery_retired",
  "component_publisher_receiver_retired",
  "component_transaction_reseed_required",
  "component_session_not_registered",
]);
function authorityRetired(result) {
  return result?.error && RETIRED_AUTHORITIES.has(result.error);
}

// This is the sole admission entry point in this **new test path**.
// Publisher approval ALONE is insufficient. Only after exact stored
// Scene Collider values pass does the current Session get seeded.
// No asynchronous gap is introduced between successful proof and the
// synchronous preflight/seed in the existing server ledger.
export async function beginWp6SourceGatedColliderLedgerForLocalTest(args = {}) {
  const verified = await inspectWp6PublisherColliderValuesInSignedSceneForLocalTest(args);
  if (verified.error) return verified;
  if (verified.status !==
        "signed_stored_scene_collider_values_match_approved_snapshot_offline" ||
      verified.serializedValuesVerified !== true ||
      verified.editorApplyVerified !== false ||
      verified.networkWriteAuthorized !== false)
    return rejected("wp6_source_gated_admission_unverified",
      "Exact signed stored Scene Collider values were not independently verified.");

  const seeded = beginPublisherApprovedColliderLedgerForLocalTest({
    coordinator: args.coordinator, realtime: args.realtime,
    actor: args.actor, identityBaseline: args.identityBaseline,
    propertySnapshot: args.propertySnapshot,
    publisherApproval: args.publisherApproval,
    propertyPolicy: args.propertyPolicy,
  });
  if (seeded.error) return seeded;

  if (seeded.sceneId !== verified.sceneId ||
      seeded.baselineRevision !== verified.baselineRevision ||
      seeded.realtimeRevision !== verified.realtimeRevision ||
      seeded.componentCount !== verified.componentCount ||
      seeded.propertyCount !== verified.propertyCount) {
    // This must not happen after synchronous source/Session checks. Retire
    // the local seed instead of providing a misleading half-admission.
    retirePublisherApprovedColliderLedgerForLocalTest(seeded);
    return rejected("wp6_source_gated_admission_changed",
      "Local Publisher ledger and verified signed Scene observation disagree.");
  }

  const handle = Object.freeze({
    status: "signed_stored_collider_ledger_admitted_offline",
    projectUuid: verified.projectUuid,
    baselineRevision: verified.baselineRevision,
    manifestHash: verified.manifestHash,
    descriptorHash: verified.descriptorHash,
    sceneId: verified.sceneId,
    scenePath: verified.scenePath,
    sceneFileSha256: verified.sceneFileSha256,
    sceneMetaSha256: verified.sceneMetaSha256,
    initialRevision: verified.realtimeRevision,
    componentCount: verified.componentCount,
    propertyCount: verified.propertyCount,
    storedSceneValuesCheckedAtAdmission: true,
    editorApplyVerified: false,
    networkWriteAuthorized: false,
  });
  admitted.set(handle, { ledger: seeded, retired: false });
  return handle;
}

export function inspectWp6SourceGatedColliderLedgerForLocalTest(handle) {
  const state = readState(handle);
  if (!state) return rejected("wp6_source_gated_ledger_retired",
    "Only a current verified stored-Scene local admission may inspect the ledger.");
  const result = inspectPublisherApprovedColliderLedgerForLocalTest(state.ledger);
  if (authorityRetired(result)) state.retired = true;
  return result;
}

export function commitWp6SourceGatedColliderLedgerForLocalTest(
  handle, intent, operationId, nowUnixMs,
) {
  const state = readState(handle);
  if (!state) return rejected("wp6_source_gated_ledger_retired",
    "A forged, retired or non-source-admitted local handle cannot commit.");
  const result = commitPublisherApprovedColliderLedgerForLocalTest(
    state.ledger, intent, operationId, nowUnixMs);
  if (authorityRetired(result)) state.retired = true;
  if (result.error) return result;
  // A changed Collider property makes the post-commit in-memory state
  // differ from the initial saved Scene. This field means only an
  // independently verified SOURCE ADMISSION, not a continuous value
  // equivalence guarantee or verified Editor state.
  return Object.freeze({
    status: result.status,
    applied: result.applied,
    serverRevision: result.serverRevision,
    storedSceneValuesCheckedAtAdmission: true,
    editorApplyVerified: false,
    networkWriteAuthorized: false,
  });
}

export function inspectWp6SourceGatedNextDeliveryForLocalTest(
  handle, recipient, knownRevision,
) {
  const state = readState(handle);
  if (!state) return rejected("wp6_source_gated_ledger_retired",
    "Only a current source-admitted local ledger may inspect delivery.");
  const result = inspectPublisherApprovedColliderNextDeliveryForLocalTest(
    state.ledger, recipient, knownRevision);
  if (authorityRetired(result)) state.retired = true;
  return result;
}

export function inspectWp6SourceGatedReceiverObservationForLocalTest(
  handle, recipient, identityBaseline, propertySnapshot,
) {
  const state = readState(handle);
  if (!state) return rejected("wp6_source_gated_ledger_retired",
    "Only a current source-admitted local ledger may compare receiver state.");
  const result = inspectPublisherApprovedColliderReceiverObservationForLocalTest(
    state.ledger, recipient, identityBaseline, propertySnapshot);
  if (authorityRetired(result)) state.retired = true;
  return result;
}

export function retireWp6SourceGatedColliderLedgerForLocalTest(handle) {
  const state = readState(handle);
  if (!state) return false;
  state.retired = true;
  return retirePublisherApprovedColliderLedgerForLocalTest(state.ledger);
}
