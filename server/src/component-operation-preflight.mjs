// WP6 structural operation ID / retry classification (pre-wire only).
// No WebSocket dispatch, lock grant, Session mutation, replay ACK, or Unity
// scene/Undo action is performed here. Matching cached fingerprints are only
// observations; the authoritative server remains responsible for outcomes.
import { validateText } from "./protocol.mjs";
import { validateComponentStructureCandidate } from "./component-structure-foundation.mjs";

function reject(error, reason) {
  return { error, reason };
}

function canonicalText(value, label) {
  return validateText(value, label, 128) === null && value === value.trim();
}

// Follow current Hierarchy/Transform's Session-wide operationId namespace
// and check past applied operations before evaluating current baseRevision.
// An authenticated connection's user ID MUST be supplied by the server,
// never read from untrusted Component intents.
function isMatchingAppliedComponentResult(applied, intent, operationId, authenticatedUserId, currentRevision) {
  return applied !== null && typeof applied === "object" && !Array.isArray(applied) &&
    applied.type === "component_structure_applied" &&
    applied.operationId === operationId &&
    applied.userId === authenticatedUserId &&
    applied.kind === intent.kind &&
    applied.sceneId === intent.sceneId &&
    applied.objectId === intent.objectId &&
    applied.componentId === intent.componentId &&
    applied.typeName === intent.typeName &&
    applied.baseRevision === intent.baseRevision &&
    Number.isSafeInteger(applied.serverRevision) &&
    applied.serverRevision > intent.baseRevision &&
    applied.serverRevision <= currentRevision;
}

function fingerprint(intent, operationId, authenticatedUserId) {
  return JSON.stringify({
    messageType: "component_structure_operation",
    operationId,
    userId: authenticatedUserId,
    sceneId: intent.sceneId,
    objectId: intent.objectId,
    componentId: intent.componentId,
    typeName: intent.typeName,
    kind: intent.kind,
    baseRevision: intent.baseRevision,
  });
}

export function classifyComponentStructureReplay(session, intent, operationId, authenticatedUserId) {
  if (!session || !Number.isSafeInteger(session.revision) || session.revision < 0 ||
      !(session.operations instanceof Map)) {
    return reject("component_operation_history_unavailable",
      "A current authoritative Session operation history is required.");
  }
  if (!canonicalText(operationId, "operationId") ||
      !canonicalText(authenticatedUserId, "authenticatedUserId")) {
    return reject("invalid_component_operation_identity",
      "An exact canonical operation ID and authenticated user identity are required.");
  }
  const validationError = validateComponentStructureCandidate(intent);
  if (validationError) {
    return reject("invalid_component_structure", validationError);
  }

  const currentFingerprint = fingerprint(intent, operationId, authenticatedUserId);
  if (session.operations.has(operationId)) {
    const prior = session.operations.get(operationId);
    // Operation IDs are Session-wide. A distinct fingerprint is a collision
    // even when an old Hierarchy/Transform result uses a different ACK shape.
    if (!prior || typeof prior.fingerprint !== "string") {
      return reject("component_operation_history_invalid",
        "Cached operation has no usable operation fingerprint.");
    }
    if (prior.fingerprint !== currentFingerprint) {
      return reject("operation_id_conflict",
        "This Session's operation ID already belongs to a different operation or operation kind.");
    }
    // An operationId + a plausible revision is not evidence of success.
    // The cached result must match every structural identity field and must
    // represent a *subsequent* authoritative revision.
    if (!isMatchingAppliedComponentResult(
      prior.applied, intent, operationId, authenticatedUserId, session.revision,
    )) {
      return reject("component_operation_history_invalid",
        "Matching operation ID lacks a complete, consistent Component applied result.");
    }
    return Object.freeze({
      status: "matching_prior_record_only",
      fingerprint: currentFingerprint,
    });
  }

  if (intent.baseRevision !== session.revision) {
    return reject("component_structure_stale_revision",
      "An unseen intent must match the current authoritative Session revision.");
  }
  return Object.freeze({
    status: "unseen_requires_authority",
    fingerprint: currentFingerprint,
  });
}
