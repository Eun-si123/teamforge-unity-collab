// WP6 structural/property authority preflight, disconnected from wire handlers.
// This only classifies server-owned Session state. It does NOT authorize a
// Component write, return a replay ACK, mutate the lock table, or enqueue a
// snapshot. The actual authority/Undo/rejection protocol remains unimplemented.
import { validateText } from "./protocol.mjs";
import {
  classifyComponentPropertyReplay,
  classifyComponentStructureReplay,
} from "./component-operation-preflight.mjs";
import { prepareComponentPropertyCandidate } from "./component-property-foundation.mjs";
import { prepareComponentStructureCandidate } from "./component-structure-foundation.mjs";

function reject(error, reason, serverRevision, repair = "none") {
  return Object.freeze({ error, reason, serverRevision, repair });
}

function validIdentity(value) {
  return typeof value === "string" && value === value.trim() &&
    validateText(value, "connection identity", 128) === null;
}

// The connection object must be obtained from authenticated Server state.
// session.members is checked again to refuse stale/replaced connections. A
// caller may NOT substitute a client-supplied connection/user ID.
function authorityContextError(session, connection, nowUnixMs) {
  if (!session || !Number.isSafeInteger(session.revision) || session.revision < 0 ||
      !(session.members instanceof Map) || !(session.locks instanceof Map) ||
      !Number.isSafeInteger(nowUnixMs) || nowUnixMs < 0 ||
      !connection || !validIdentity(connection.userId) ||
      !validIdentity(connection.connectionId)) {
    return reject("component_authority_context_invalid",
      "A valid server-owned Session, connection and sampled server time are required.", null);
  }
  const revision = session.revision;
  const member = session.members.get(connection.userId);
  if (!member || member.connectionId !== connection.connectionId) {
    return reject("component_session_not_registered",
      "The connection does not own the currently registered Session membership.", revision);
  }
  return null;
}

function replayDecision(retry, revision, staleError) {
  // Match old committed IDs BEFORE enforcing current locks/revisions, as the
  // existing Hierarchy/Transform authority does. Never return its cached ACK:
  // an idempotent lookup is NOT a new grant or Scene write.
  if (retry.error) {
    return reject(retry.error, retry.reason, revision,
      retry.error === staleError ? "resnapshot_required" : "none");
  }
  if (retry.status === "matching_prior_record_only") {
    return Object.freeze({
      status: "matching_prior_record_only",
      serverRevision: revision,
      // Only a future server-controlled recovery path may produce any ACK.
      repair: "none",
    });
  }
  return null;
}

function inspectOwnedLease(session, intent, connection, nowUnixMs, scope) {
  const revision = session.revision;
  // Shared Hierarchy/Transform lock key, scoped to a specific Scene and object.
  // For new Component edits we deliberately require an owned live lock instead
  // of allowing edits merely when no *other* owner has a lock.
  const key = JSON.stringify([intent.sceneId, intent.objectId]);
  const lock = session.locks.get(key);
  if (!lock) {
    return reject(`component_${scope}_lock_required`,
      "A current owned GameObject lock is required for Component edits.", revision);
  }
  if (lock.sceneId !== intent.sceneId || lock.objectId !== intent.objectId) {
    return reject(`component_${scope}_lock_invalid`,
      "The stored lock identity does not match its authoritative Scene and object key.", revision);
  }
  if (lock.ownerConnectionId !== connection.connectionId ||
      lock.ownerUserId !== connection.userId) {
    return reject(`component_${scope}_locked_by_other`,
      "This GameObject lock belongs to a different connection.", revision);
  }
  if (!Number.isSafeInteger(lock.expiresAtUnixMs) ||
      lock.expiresAtUnixMs <= nowUnixMs) {
    return reject(`component_${scope}_lock_expired`,
      "The GameObject lock has expired; acquire a new authoritative lease.", revision);
  }

  // A positive classification is a narrow *candidate*, not write permission.
  // Future runtime code must still recheck at the atomic commit boundary.
  return Object.freeze({
    status: "unseen_candidate_with_live_lock",
    serverRevision: revision,
    repair: "none",
  });
}

export function inspectComponentStructureAuthority(
  session, baseline, intent, policy, operationId, connection, nowUnixMs,
) {
  const contextError = authorityContextError(session, connection, nowUnixMs);
  if (contextError) return contextError;
  const revision = session.revision;
  const retry = replayDecision(classifyComponentStructureReplay(
    session, intent, operationId, connection.userId,
  ), revision, "component_structure_stale_revision");
  if (retry) return retry;
  const candidate = prepareComponentStructureCandidate(session, baseline, intent, policy);
  if (candidate.error) {
    const needsSnapshot = new Set([
      "component_structure_stale_revision", "component_structure_scene_mismatch",
      "component_structure_owner_missing", "component_structure_identity_mismatch",
    ]);
    return reject(candidate.error, candidate.reason, revision,
      needsSnapshot.has(candidate.error) ? "resnapshot_required" : "none");
  }
  return inspectOwnedLease(session, intent, connection, nowUnixMs, "structure");
}

export function inspectComponentPropertyAuthority(
  session, baseline, intent, policy, operationId, connection, nowUnixMs,
) {
  const contextError = authorityContextError(session, connection, nowUnixMs);
  if (contextError) return contextError;
  const revision = session.revision;
  const retry = replayDecision(classifyComponentPropertyReplay(
    session, intent, operationId, connection.userId,
  ), revision, "component_property_stale_revision");
  if (retry) return retry;
  const candidate = prepareComponentPropertyCandidate(session, baseline, intent, policy);
  if (candidate.error) {
    const needsSnapshot = new Set([
      "component_property_stale_revision", "component_property_scene_mismatch",
      "component_property_owner_missing", "component_property_identity_mismatch",
    ]);
    return reject(candidate.error, candidate.reason, revision,
      needsSnapshot.has(candidate.error) ? "resnapshot_required" : "none");
  }
  return inspectOwnedLease(session, intent, connection, nowUnixMs, "property");
}
