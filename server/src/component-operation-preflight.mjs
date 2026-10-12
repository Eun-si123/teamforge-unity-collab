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
    // Malformed records are not proof of any previous successful operation.
    if (!prior || typeof prior.fingerprint !== "string" ||
        !prior.applied || typeof prior.applied !== "object" ||
        prior.applied.operationId !== operationId ||
        !Number.isSafeInteger(prior.applied.serverRevision) ||
        prior.applied.serverRevision < 0 ||
        prior.applied.serverRevision > session.revision) {
      return reject("component_operation_history_invalid",
        "Cached operation has no complete applied-result identity and revision.");
    }
    if (prior.fingerprint !== currentFingerprint) {
      return reject("operation_id_conflict",
        "This Session's operation ID already belongs to a different operation or operation kind.");
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
