// WP6 offline-only authority lifecycle simulation. It closes the gap
// between Publisher approval of a complete Collider observation and the
// EXISTING local property transaction's revision/lock/replay behavior.
// Does NOT prove Scene source bytes, create a wire handler, or authorize
// the Unity Editor's source-only local Inspector write prototype.
import { types as nodeTypes } from "node:util";
import { ProjectCoordinatorCore } from "./project-coordinator-core.mjs";
import { descriptorIsCompatible, descriptorMatchesBaseline,
  verifyProjectDescriptor } from "./project-coordinator.mjs";
import { SessionAuthority } from "./session-authority.mjs";
import { verifyPublisherApprovedColliderObservationForLocalTest }
  from "./component-publisher-observation-approval.mjs";
import { seedCompleteSavedColliderTransactionForLocalTest }
  from "./component-collider-completeness.mjs";
import {
  commitComponentPropertyTransaction, readComponentPropertyTransaction,
  componentPropertyTransactionIdentityForLocalTest, retireComponentPropertyTransaction,
} from "./component-property-transaction.mjs";

const handles = new WeakMap();
const managedSessions = new WeakMap();
const MAX_LOCAL_DELIVERY_HISTORY = 256;
const MAX_LOCAL_DELIVERY_BYTES = 8 * 1024;

function denied(error, reason, repair = "none") {
  return Object.freeze({ error, reason, repair });
}

function liveContext(state) {
  const { coordinator, realtime, actor, session, baseline, connectionStamp } = state;
  if (actor.projectId !== connectionStamp.projectId ||
      actor.sessionId !== connectionStamp.sessionId ||
      actor.sessionKey !== connectionStamp.sessionKey ||
      actor.userId !== connectionStamp.userId ||
      actor.connectionId !== connectionStamp.connectionId ||
      !(coordinator instanceof ProjectCoordinatorCore) ||
      !(realtime instanceof SessionAuthority) ||
      managedSessions.get(session) !== state ||
      realtime.sessions.get(actor.sessionKey) !== session ||
      realtime.activeSession(actor)?.session !== session ||
      !realtime.activeSession(actor)?.record?.supportsHierarchySync ||
      coordinator.activeRecord(actor)?.record?.connection !== actor ||
      coordinator.activeRecord(actor)?.session !== coordinator.sessions.get(actor.sessionKey) ||
      actor.supportsHierarchySync !== true || actor.supportsProjectTransfer !== true) {
    return denied("component_publisher_ledger_member_replaced",
      "The original Project and realtime member must remain the same active connection.",
      "resnapshot_required");
  }

  const project = coordinator.projects.get(actor.projectId);
  const current = project?.baseline;
  if (!project || !current ||
      project.projectId !== actor.projectId ||
      project.projectUuid !== baseline.projectUuid ||
      project.ownerKeyId !== baseline.ownerKeyId ||
      project.ownerPublicKey !== baseline.ownerPublicKey ||
      current.projectUuid !== baseline.projectUuid ||
      current.baselineRevision !== baseline.baselineRevision ||
      current.manifestHash !== baseline.manifestHash ||
      current.descriptorHash !== baseline.descriptorHash ||
      current.ownerKeyId !== baseline.ownerKeyId ||
      current.ownerPublicKey !== baseline.ownerPublicKey ||
      current.publisherKeyId !== baseline.publisherKeyId ||
      current.publisherPublicKey !== baseline.publisherPublicKey ||
      current.publisherAuthorization !== baseline.publisherAuthorization ||
      current.baselineSignature !== baseline.baselineSignature) {
    return denied("component_publisher_ledger_baseline_rotated",
      "The registered signed Project baseline changed since this local observation was approved.",
      "resnapshot_required");
  }
  const checked = verifyProjectDescriptor(current, actor.projectId);
  if (checked.error || !descriptorIsCompatible(checked.descriptor) ||
      !descriptorMatchesBaseline(checked.descriptor, current)) {
    return denied("component_publisher_ledger_descriptor_invalid",
      "The registered Project Baseline no longer has valid Owner/Publisher authority.",
      "resnapshot_required");
  }
  if (componentPropertyTransactionIdentityForLocalTest(session) !== state.transactionIdentity) {
    return denied("component_publisher_ledger_stale",
      "The Publisher-owned local transaction was retired or independently replaced.",
      "resnapshot_required");
  }
  const view = readComponentPropertyTransaction(session);
  if (view.error || view.sceneId !== state.sceneId) {
    return denied("component_publisher_ledger_stale",
      "The current property ledger is missing, stale or scoped to another Scene.",
      "resnapshot_required");
  }
  return Object.freeze({ status: "live_local_publisher_ledger", view });
}

function retireState(state) {
  if (state.retired) return;
  state.retired = true;
  // Never delete a newer transaction if another local research API
  // replaced this handle's original seed.
  retireComponentPropertyTransaction(state.session, state.transactionIdentity);
  if (managedSessions.get(state.session) === state)
    managedSessions.delete(state.session);
}

function getState(handle) {
  const state = handle && typeof handle === "object" ? handles.get(handle) : null;
  if (!state || state.retired) return null;
  return state;
}

function inertCurrentRecipient(recipient) {
  if (!recipient || typeof recipient !== "object" ||
      Array.isArray(recipient) || nodeTypes.isProxy(recipient)) return false;
  const prototype = Object.getPrototypeOf(recipient);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const fields = Object.getOwnPropertyDescriptors(recipient);
  return ["userId", "connectionId", "projectId", "sessionId", "sessionKey",
    "supportsHierarchySync", "supportsProjectTransfer",
    "projectClientRegistered"].every(key =>
    Object.hasOwn(fields, key) &&
    Object.hasOwn(fields[key], "value") &&
    fields[key].enumerable);
}

// This is a *disconnected* integration test gate. The Publisher may approve
// completely fabricated observations; only real signed Scene-byte witnesses
// plus an authenticated Editor bridge can ever authorize production edits.
export function beginPublisherApprovedColliderLedgerForLocalTest({
  coordinator, realtime, actor, identityBaseline, propertySnapshot,
  publisherApproval, propertyPolicy,
} = {}) {
  const approved = verifyPublisherApprovedColliderObservationForLocalTest(
    coordinator, realtime, actor, identityBaseline, propertySnapshot, publisherApproval);
  if (approved.error) return approved;

  const session = realtime.activeSession(actor)?.session;
  if (!session)
    return denied("component_publisher_ledger_member_replaced",
      "A registered current realtime Session is required.", "resnapshot_required");
  const existing = managedSessions.get(session);
  if (existing) {
    // An old handle may be lost after a baseline/connection/revision change.
    // Reap stale ownership on the next begin instead of wedging the Session.
    if (!liveContext(existing).error)
      return denied("component_publisher_ledger_already_active",
        "Only one publisher-bound local Component ledger may be active in a Session.");
    retireState(existing);
  }

  const project = coordinator.projects.get(actor.projectId);
  const b = project?.baseline;
  if (!b)
    return denied("component_publisher_ledger_baseline_missing",
      "An approved current Project baseline is required.");

  // Copy all relevant signed baseline identity facts prior to seeding.
  const baseline = Object.freeze({
    projectUuid: b.projectUuid, baselineRevision: b.baselineRevision,
    manifestHash: b.manifestHash, descriptorHash: b.descriptorHash,
    ownerKeyId: b.ownerKeyId, ownerPublicKey: b.ownerPublicKey,
    publisherKeyId: b.publisherKeyId, publisherPublicKey: b.publisherPublicKey,
    publisherAuthorization: b.publisherAuthorization,
    baselineSignature: b.baselineSignature,
  });
  const seeded = seedCompleteSavedColliderTransactionForLocalTest(
    session, identityBaseline, propertySnapshot, propertyPolicy);
  if (seeded.error) return seeded;
  const transactionIdentity = componentPropertyTransactionIdentityForLocalTest(session);
  if (!transactionIdentity)
    return denied("component_publisher_ledger_stale",
      "A newly seeded local transaction must retain a private identity.", "resnapshot_required");

  const handle = Object.freeze({
    status: "publisher_bound_local_ledger_scene_bytes_unverified",
    sceneId: approved.sceneId,
    baselineRevision: approved.baselineRevision,
    realtimeRevision: approved.realtimeRevision,
    componentCount: approved.componentCount,
    propertyCount: approved.propertyCount,
  });
  const connectionStamp = Object.freeze({
    projectId: actor.projectId, sessionId: actor.sessionId,
    sessionKey: actor.sessionKey, userId: actor.userId,
    connectionId: actor.connectionId,
  });
  const state = {
    coordinator, realtime, actor, session, sceneId: approved.sceneId,
    baseline, connectionStamp, transactionIdentity,
    initialRevision: approved.realtimeRevision,
    appliedByRevision: new Map(), retired: false,
  };
  handles.set(handle, state);
  managedSessions.set(session, state);
  return handle;
}

export function inspectPublisherApprovedColliderLedgerForLocalTest(handle) {
  const state = getState(handle);
  if (!state) return denied("component_publisher_ledger_retired",
    "A retired or forged handle cannot read a publisher-bound local ledger.",
    "resnapshot_required");
  const context = liveContext(state);
  if (context.error) {
    retireState(state);
    return context;
  }
  return Object.freeze({
    status: "publisher_bound_local_ledger_read_only",
    sceneId: state.sceneId,
    serverRevision: context.view.serverRevision,
    properties: context.view.properties,
  });
}

export function commitPublisherApprovedColliderLedgerForLocalTest(
  handle, intent, operationId, nowUnixMs,
) {
  const state = getState(handle);
  if (!state) return denied("component_publisher_ledger_retired",
    "A retired or forged handle cannot commit a local Component operation.",
    "resnapshot_required");
  const context = liveContext(state);
  if (context.error) {
    retireState(state);
    return context;
  }

  // The existing simulator alone owns the common revision, lock,
  // operation history, precise target allowlist and idempotent applied
  // receipt. We never invent or accept an 'applied' object from a peer.
  const result = commitComponentPropertyTransaction(
    state.session, intent, operationId, state.actor, nowUnixMs);
  if (result.error === "component_transaction_reseed_required" ||
      result.error === "component_session_not_registered") retireState(state);
  if (result.error) return result;
  if (result.status === "committed_locally") {
    if (state.appliedByRevision.size >= MAX_LOCAL_DELIVERY_HISTORY ||
        state.appliedByRevision.has(result.applied.serverRevision)) {
      // This should be unreachable because the underlying 256-entry
      // transaction history is bounded, but never manufacture a receipt.
      retireState(state);
      return denied("component_publisher_delivery_history_exhausted",
        "The local delivery record budget has been exhausted.", "resnapshot_required");
    }
    state.appliedByRevision.set(result.applied.serverRevision, result.applied);
  } else if (result.status === "replayed") {
    if (state.appliedByRevision.get(result.applied.serverRevision) !== result.applied) {
      retireState(state);
      return denied("component_publisher_delivery_history_mismatch",
        "The replayed applied record is not part of this Publisher-approved ledger.",
        "resnapshot_required");
    }
  } else {
    retireState(state);
    return denied("component_publisher_delivery_unexpected_commit",
      "The local transaction did not return a recognized applied operation.",
      "resnapshot_required");
  }
  return Object.freeze({
    status: result.status === "committed_locally"
      ? "publisher_bound_local_commit" : "publisher_bound_local_replayed",
    applied: result.applied,
    serverRevision: result.serverRevision,
    sceneBytesAttested: false,
  });
}

// This *reads* one already committed, server-authored operation per
// revision. The peer-supplied knownRevision is only a selection cursor,
// NOT an ACK that Unity applied it. No real socket is allowed to call this.
// True delivery requires verified Scene provenance, authenticated wire
// negotiation, revision/Undo reconciliation and receiver acknowledgments.
export function inspectPublisherApprovedColliderNextDeliveryForLocalTest(
  handle, recipient, knownRevision,
) {
  const state = getState(handle);
  if (!state) return denied("component_publisher_delivery_retired",
    "A retired or forged local ledger cannot deliver a Component result.",
    "resnapshot_required");
  const context = liveContext(state);
  if (context.error) {
    retireState(state);
    return context;
  }

  if (!inertCurrentRecipient(recipient) ||
      recipient.projectId !== state.connectionStamp.projectId ||
      recipient.sessionId !== state.connectionStamp.sessionId ||
      recipient.sessionKey !== state.connectionStamp.sessionKey ||
      recipient.supportsHierarchySync !== true ||
      recipient.supportsProjectTransfer !== true ||
      recipient.projectClientRegistered !== true ||
      state.coordinator.activeRecord(recipient)?.record?.connection !== recipient ||
      state.coordinator.activeRecord(recipient)?.session !==
        state.coordinator.sessions.get(recipient.sessionKey) ||
      state.realtime.activeSession(recipient)?.session !== state.session ||
      state.realtime.activeSession(recipient)?.record?.supportsHierarchySync !== true) {
    return denied("component_publisher_delivery_recipient_unregistered",
      "Only the exact active Project and Hierarchy member may inspect a local delivery preview.");
  }

  if (!Number.isSafeInteger(knownRevision) ||
      knownRevision < state.initialRevision ||
      knownRevision > context.view.serverRevision) {
    return denied("component_publisher_delivery_cursor_invalid",
      "The next revision must be selected from the exact bounded local baseline.",
      "resnapshot_required");
  }

  if (knownRevision === context.view.serverRevision) {
    return Object.freeze({
      status: "publisher_bound_local_delivery_current_unverified",
      sceneId: state.sceneId,
      serverRevision: context.view.serverRevision,
      sceneBytesAttested: false,
    });
  }

  const nextRevision = knownRevision + 1;
  const applied = state.appliedByRevision.get(nextRevision);
  // The generic shared Session history can interleave other operation
  // kinds. Those have no Component applied record, so this local API
  // MUST request a resnapshot instead of skipping a revision.
  if (!applied || applied.type !== "component_property_applied" ||
      applied.baseRevision !== knownRevision ||
      applied.serverRevision !== nextRevision ||
      applied.sceneId !== state.sceneId ||
      state.session.operations.get(applied.operationId)?.applied !== applied) {
    return denied("component_publisher_delivery_gap",
      "No authentic contiguous Component applied record exists for this revision.",
      "resnapshot_required");
  }

  // This is an untrusted-in-transit *display preview*, not a signed
  // authorization receipt or a command for a remote Unity Editor.
  const delivery = Object.freeze({
    status: "publisher_bound_local_next_applied_unverified",
    projectId: state.connectionStamp.projectId,
    projectUuid: state.baseline.projectUuid,
    baselineRevision: state.baseline.baselineRevision,
    manifestHash: state.baseline.manifestHash,
    descriptorHash: state.baseline.descriptorHash,
    sessionId: state.connectionStamp.sessionId,
    recipientConnectionId: recipient.connectionId,
    sceneId: state.sceneId,
    knownRevision, serverRevision: nextRevision,
    applied,
    sceneBytesAttested: false,
  });
  if (Buffer.byteLength(JSON.stringify(delivery), "utf8") > MAX_LOCAL_DELIVERY_BYTES) {
    return denied("component_publisher_delivery_size_limit",
      "One local applied delivery would exceed its 8 KiB limit.", "resnapshot_required");
  }
  return delivery;
}

export function retirePublisherApprovedColliderLedgerForLocalTest(handle) {
  const state = getState(handle);
  if (!state) return false;
  retireState(state);
  return true;
}
