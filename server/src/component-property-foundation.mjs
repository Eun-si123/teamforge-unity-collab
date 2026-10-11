// WP6 pre-wire property contract experiment ONLY.
// This module is not connected to HTTP, WebSocket, Session Authority dispatch or
// the Unity Editor. It authorizes no network operation or Unity mutation.
// A later feature needs negotiated capabilities, revision/replay/lock authority,
// Undo and rejection reconciliation before any live Inspector writes.
import {
  isPreparedComponentIdentityBaseline,
  validateComponentIdentityRecord,
} from "./component-foundation.mjs";

const CANDIDATE_FIELDS = Object.freeze([
  "sceneId", "objectId", "componentId", "typeName", "baseRevision",
  "propertyPath", "valueKind", "value",
]);
const SIMPLE_PROPERTY_PATH = /^m_[A-Za-z][A-Za-z0-9_]{0,79}$/u;
const VALUE_KINDS = Object.freeze(["boolean", "int32", "float", "vector3"]);
// Explicitly blocked even if a caller misconfigures the prototype allowlist.
const BLOCKED_PATHS = new Set([
  "m_Script", "m_GameObject", "m_PrefabInstance", "m_PrefabAsset",
  "m_CorrespondingSourceObject", "m_ManagedReferences",
]);
const MAX_MAGNITUDE = 1_000_000;

function reject(error, reason) {
  return { error, reason };
}

function isExactRecord(value, fields) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === fields.length && keys.every(key => fields.includes(key)) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function finiteBounded(value) {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_MAGNITUDE;
}

function cloneValidatedValue(kind, value) {
  if (kind === "boolean") {
    return typeof value === "boolean" ? value : null;
  }
  if (kind === "int32") {
    return typeof value === "number" && Number.isInteger(value) &&
      value >= -2147483648 && value <= 2147483647 ? value : null;
  }
  if (kind === "float") {
    return finiteBounded(value) ? value : null;
  }
  if (kind === "vector3") {
    if (!isExactRecord(value, ["x", "y", "z"]) ||
        !finiteBounded(value.x) || !finiteBounded(value.y) || !finiteBounded(value.z)) {
      return null;
    }
    return Object.freeze({ x: value.x, y: value.y, z: value.z });
  }
  return null;
}

export function validateComponentPropertyCandidate(candidate) {
  if (!isExactRecord(candidate, CANDIDATE_FIELDS)) {
    return "Property candidate must have the exact supported fields.";
  }
  const identity = validateComponentIdentityRecord({
    objectId: candidate.objectId,
    componentId: candidate.componentId,
    typeName: candidate.typeName,
  });
  if (identity) return identity;
  if (typeof candidate.sceneId !== "string" || candidate.sceneId.length === 0 ||
      candidate.sceneId.length > 128 || candidate.sceneId !== candidate.sceneId.trim() ||
      /[\u0000-\u001f\u007f]/u.test(candidate.sceneId)) {
    return "sceneId must be a canonical non-empty Scene identity.";
  }
  if (!Number.isSafeInteger(candidate.baseRevision) || candidate.baseRevision < 0) {
    return "baseRevision must be a non-negative safe integer.";
  }
  if (typeof candidate.propertyPath !== "string" ||
      !SIMPLE_PROPERTY_PATH.test(candidate.propertyPath) ||
      BLOCKED_PATHS.has(candidate.propertyPath)) {
    return "Only a simple, explicitly allowed and non-reference SerializedProperty path is supported.";
  }
  if (!VALUE_KINDS.includes(candidate.valueKind)) {
    return "Only boolean, int32, float and vector3 candidate values are supported.";
  }
  if (cloneValidatedValue(candidate.valueKind, candidate.value) === null) {
    return "Property candidate value is not finite, bounded or the exact declared shape.";
  }
  return null;
}

// "allowedProperties" is a Map<ComponentType, Map<exactPath, valueKind>>.
// A caller must supply it explicitly; this module does not grant any defaults.
// The trusted baseline must come from prepareComponentIdentityBaseline rather than
// from caller-provided JSON. The returned object is inert frozen *test data*.
export function prepareComponentPropertyCandidate(session, trustedBaseline, candidate, policy) {
  if (!session || !Number.isSafeInteger(session.revision) ||
      !(session.hierarchySceneIds instanceof Set) ||
      !(session.hierarchyObjects instanceof Map) ||
      !isPreparedComponentIdentityBaseline(trustedBaseline)) {
    return reject("component_authority_unavailable", "A locally validated Component and Hierarchy baseline is required.");
  }
  const invalid = validateComponentPropertyCandidate(candidate);
  if (invalid) {
    return reject("invalid_component_property", invalid);
  }
  if (candidate.baseRevision !== session.revision ||
      trustedBaseline.baseRevision !== session.revision) {
    return reject("component_property_stale_revision", "The Component candidate and identity baseline must match current authority.");
  }
  if (trustedBaseline.sceneId !== candidate.sceneId ||
      !session.hierarchySceneIds.has(candidate.sceneId)) {
    return reject("component_property_scene_mismatch", "The candidate must belong to the currently authoritative Scene.");
  }
  if (!session.hierarchyObjects.has(JSON.stringify([candidate.sceneId, candidate.objectId]))) {
    return reject("component_property_owner_missing", "The owning GameObject must remain authoritative.");
  }
  if (!trustedBaseline.records.some(record =>
    record.sceneId === candidate.sceneId &&
    record.objectId === candidate.objectId &&
    record.componentId === candidate.componentId &&
    record.typeName === candidate.typeName)) {
    return reject("component_property_identity_mismatch", "The Component must match its locally prepared identity baseline.");
  }
  if (!policy || !(policy.allowedProperties instanceof Map)) {
    return reject("component_property_policy_missing", "An explicit type/path/value-kind allowlist is required.");
  }
  const paths = policy.allowedProperties.get(candidate.typeName);
  if (!(paths instanceof Map) ||
      paths.get(candidate.propertyPath) !== candidate.valueKind) {
    return reject("component_property_not_allowed", "Component type, exact property path and kind must all be allowlisted.");
  }

  const clonedValue = cloneValidatedValue(candidate.valueKind, candidate.value);
  return Object.freeze({
    sceneId: candidate.sceneId,
    objectId: candidate.objectId,
    componentId: candidate.componentId,
    typeName: candidate.typeName,
    baseRevision: candidate.baseRevision,
    propertyPath: candidate.propertyPath,
    valueKind: candidate.valueKind,
    value: clonedValue,
  });
}
