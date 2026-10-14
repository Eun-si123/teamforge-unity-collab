// WP6 structural/property operation ID / retry classification (pre-wire only).
// No WebSocket dispatch, lock grant, Session mutation, replay ACK, or Unity
// scene/Undo action is performed here. Matching cached fingerprints are only
// observations; the authoritative server remains responsible for outcomes.
import { validateText } from "./protocol.mjs";
import { validateComponentStructureCandidate } from "./component-structure-foundation.mjs";
import { validateComponentPropertyCandidate } from "./component-property-foundation.mjs";

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
function isMatchingAppliedIdentity(applied, intent, operationId, authenticatedUserId, currentRevision, type) {
  return applied !== null && typeof applied === "object" && !Array.isArray(applied) &&
    applied.type === type &&
    applied.operationId === operationId &&
    applied.userId === authenticatedUserId &&
    applied.sceneId === intent.sceneId &&
    applied.objectId === intent.objectId &&
    applied.componentId === intent.componentId &&
    applied.typeName === intent.typeName &&
    applied.baseRevision === intent.baseRevision &&
    Number.isSafeInteger(applied.serverRevision) &&
    applied.serverRevision > intent.baseRevision &&
    applied.serverRevision <= currentRevision;
}

function isMatchingAppliedComponentResult(applied, intent, operationId, authenticatedUserId, currentRevision) {
  return isMatchingAppliedIdentity(applied, intent, operationId, authenticatedUserId,
    currentRevision, "component_structure_applied") && applied.kind === intent.kind;
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

function operationContextError(session, operationId, authenticatedUserId) {
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
  return null;
}

function inspectPriorRecord(session, operationId, currentFingerprint, matchesApplied) {
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
    // The cached result must match every operation identity/value field and
    // represent a *subsequent* authoritative revision.
    if (!matchesApplied(prior.applied)) {
      return reject("component_operation_history_invalid",
        "Matching operation ID lacks a complete, consistent Component applied result.");
    }
    return Object.freeze({
      status: "matching_prior_record_only",
      fingerprint: currentFingerprint,
    });
  }
  return null;
}

export function classifyComponentStructureReplay(session, intent, operationId, authenticatedUserId) {
  const contextError = operationContextError(session, operationId, authenticatedUserId);
  if (contextError) return contextError;
  const validationError = validateComponentStructureCandidate(intent);
  if (validationError) {
    return reject("invalid_component_structure", validationError);
  }

  const currentFingerprint = fingerprint(intent, operationId, authenticatedUserId);
  const prior = inspectPriorRecord(session, operationId, currentFingerprint, applied =>
    isMatchingAppliedComponentResult(applied, intent, operationId, authenticatedUserId, session.revision));
  if (prior) return prior;

  if (intent.baseRevision !== session.revision) {
    return reject("component_structure_stale_revision",
      "An unseen intent must match the current authoritative Session revision.");
  }
  return Object.freeze({
    status: "unseen_requires_authority",
    fingerprint: currentFingerprint,
  });
}

// Validation runs first. Canonical axis order makes JSON field insertion order
// irrelevant. JSON numeric semantics deliberately identify -0 with 0; missing,
// non-finite and extra value fields are never admitted by the typed validator.
function propertyValue(intent) {
  return intent.valueKind === "vector3"
    ? { x: intent.value.x, y: intent.value.y, z: intent.value.z }
    : intent.value;
}

function propertyFingerprint(intent, operationId, authenticatedUserId) {
  return JSON.stringify({
    messageType: "component_property_operation",
    operationId,
    userId: authenticatedUserId,
    sceneId: intent.sceneId,
    objectId: intent.objectId,
    componentId: intent.componentId,
    typeName: intent.typeName,
    baseRevision: intent.baseRevision,
    propertyPath: intent.propertyPath,
    valueKind: intent.valueKind,
    value: propertyValue(intent),
  });
}

function isMatchingAppliedProperty(applied, intent, operationId, authenticatedUserId, currentRevision) {
  if (!isMatchingAppliedIdentity(applied, intent, operationId, authenticatedUserId,
    currentRevision, "component_property_applied") ||
      applied.propertyPath !== intent.propertyPath || applied.valueKind !== intent.valueKind) {
    return false;
  }
  // A matching fingerprint alone cannot turn malformed cached values into a
  // successful edit. Validate the complete typed property before comparison.
  if (validateComponentPropertyCandidate({
    sceneId: applied.sceneId, objectId: applied.objectId,
    componentId: applied.componentId, typeName: applied.typeName,
    baseRevision: applied.baseRevision, propertyPath: applied.propertyPath,
    valueKind: applied.valueKind, value: applied.value,
  }) !== null) return false;
  return intent.valueKind === "vector3"
    ? applied.value.x === intent.value.x && applied.value.y === intent.value.y &&
      applied.value.z === intent.value.z
    : applied.value === intent.value;
}

export function classifyComponentPropertyReplay(session, intent, operationId, authenticatedUserId) {
  const contextError = operationContextError(session, operationId, authenticatedUserId);
  if (contextError) return contextError;
  const validationError = validateComponentPropertyCandidate(intent);
  if (validationError) {
    return reject("invalid_component_property", validationError);
  }

  const currentFingerprint = propertyFingerprint(intent, operationId, authenticatedUserId);
  const prior = inspectPriorRecord(session, operationId, currentFingerprint, applied =>
    isMatchingAppliedProperty(applied, intent, operationId, authenticatedUserId, session.revision));
  if (prior) return prior;
  if (intent.baseRevision !== session.revision) {
    return reject("component_property_stale_revision",
      "An unseen property intent must match the current authoritative Session revision.");
  }
  return Object.freeze({ status: "unseen_requires_authority", fingerprint: currentFingerprint });
}
