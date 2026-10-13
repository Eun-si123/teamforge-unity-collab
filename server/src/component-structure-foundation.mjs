// WP6 **unwired** Component add/remove candidate guardrails.
// This does not assign authority, reserve IDs, mutate a Session/Unity Scene,
// issue a protocol message, or implement ordering/replay, locks or Undo.
import { validateText } from "./protocol.mjs";
import {
  isLogicalComponentId,
  isPreparedComponentIdentityBaseline,
  isSavedComponentId,
} from "./component-foundation.mjs";

const FIELDS = Object.freeze([
  "kind", "sceneId", "objectId", "componentId", "typeName", "baseRevision",
]);
const TYPE_POLICY_FIELDS = Object.freeze([
  "canAdd", "canRemove", "allowMultiple", "requires", "minPerObject", "maxPerObject",
]);
const BLOCKED_TYPES = new Set([
  "UnityEngine.Transform", "UnityEngine.RectTransform", "UnityEngine.MonoBehaviour",
]);
const MAX_POLICY_COMPONENTS = 10000;

function reject(error, reason) {
  return { error, reason };
}

function exactRecord(record, names) {
  return record !== null && typeof record === "object" && !Array.isArray(record) &&
    (Object.getPrototypeOf(record) === Object.prototype || Object.getPrototypeOf(record) === null) &&
    Reflect.ownKeys(record).length === names.length &&
    Reflect.ownKeys(record).every(key => names.includes(key));
}

export function validateComponentStructureCandidate(candidate) {
  if (!exactRecord(candidate, FIELDS)) {
    return "Component structural intent must have exactly its six defined fields.";
  }
  if (candidate.kind !== "add_component" && candidate.kind !== "remove_component") {
    return "Only Component add and remove intents may be validated.";
  }
  for (const [field, limit] of [["sceneId", 128], ["objectId", 512], ["typeName", 256]]) {
    if (validateText(candidate[field], field, limit) ||
        candidate[field] !== candidate[field].trim()) {
      return field + " must be a canonical, bounded, printable identity.";
    }
  }
  if (!Number.isSafeInteger(candidate.baseRevision) || candidate.baseRevision < 0) {
    return "baseRevision must be a non-negative safe integer.";
  }
  if (candidate.kind === "add_component" && !isLogicalComponentId(candidate.componentId)) {
    return "A proposed add requires a logical pending Component ID, not an existing saved ID.";
  }
  if (candidate.kind === "remove_component" && !isSavedComponentId(candidate.componentId)) {
    return "A proposed remove requires an existing saved Component GlobalObjectId.";
  }
  return null;
}

function validTypePolicy(metadata) {
  return exactRecord(metadata, TYPE_POLICY_FIELDS) &&
    typeof metadata.canAdd === "boolean" &&
    typeof metadata.canRemove === "boolean" &&
    typeof metadata.allowMultiple === "boolean" &&
    Number.isSafeInteger(metadata.minPerObject) && metadata.minPerObject >= 0 &&
    Number.isSafeInteger(metadata.maxPerObject) &&
    metadata.maxPerObject >= 1 &&
    metadata.minPerObject <= metadata.maxPerObject &&
    (metadata.allowMultiple || metadata.maxPerObject === 1) &&
    Array.isArray(metadata.requires) &&
    metadata.requires.length <= 16 &&
    metadata.requires.every(value =>
      typeof value === "string" && value.length > 0 && value.length <= 256 &&
      value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value)) &&
    new Set(metadata.requires).size === metadata.requires.length;
}

// Caller-supplied metadata is a *test-only assumption*. A live implementation
// must independently derive and verify Unity RequireComponent/multiplicity,
// dependencies and protected types in Editor probes before granting operations.
export function prepareComponentStructureCandidate(session, baseline, intent, policy) {
  if (!session || !Number.isSafeInteger(session.revision) ||
      !(session.hierarchyObjects instanceof Map) ||
      !(session.hierarchySceneIds instanceof Set) ||
      !isPreparedComponentIdentityBaseline(baseline, session)) {
    return reject("component_structure_authority_unavailable", "A same-Session prepared identity baseline is required.");
  }
  const validation = validateComponentStructureCandidate(intent);
  if (validation) return reject("invalid_component_structure", validation);
  if (baseline.baseRevision !== session.revision || intent.baseRevision !== session.revision) {
    return reject("component_structure_stale_revision", "The baseline and intent must match the current Hierarchy revision.");
  }
  if (baseline.sceneId !== intent.sceneId || !session.hierarchySceneIds.has(intent.sceneId)) {
    return reject("component_structure_scene_mismatch", "Scene must match the authoritative baseline.");
  }
  if (!session.hierarchyObjects.has(JSON.stringify([intent.sceneId, intent.objectId]))) {
    return reject("component_structure_owner_missing", "GameObject must be authoritative.");
  }
  if (!policy || !(policy.types instanceof Map) ||
      !Number.isSafeInteger(policy.maxComponents) ||
      policy.maxComponents < 1 || policy.maxComponents > MAX_POLICY_COMPONENTS) {
    return reject("component_structure_policy_missing", "An explicit bounded type-policy Map is required.");
  }

  // Verify the policy for *all* currently observed types before making
  // dependency decisions. Otherwise a removal might orphan an unknown type.
  const declaredTypes = new Map();
  for (const [type, metadata] of policy.types) {
    if (typeof type !== "string" || type.length < 1 || type.length > 256 ||
        !validTypePolicy(metadata) || BLOCKED_TYPES.has(type)) {
      return reject("component_structure_policy_invalid", "Type policy has an unsupported or ambiguous descriptor.");
    }
    declaredTypes.set(type, metadata);
  }
  for (const record of baseline.records) {
    if (!declaredTypes.has(record.typeName)) {
      return reject("component_structure_policy_incomplete", "Existing Component has no verified dependency metadata.");
    }
  }
  if (baseline.records.length > policy.maxComponents) {
    return reject("component_structure_limit_exceeded", "Existing baseline exceeds the configured Component limit.");
  }
  const metadata = declaredTypes.get(intent.typeName);
  if (!metadata) return reject("component_structure_type_not_allowed", "Component type is not allowlisted.");
  const siblings = baseline.records.filter(row => row.objectId === intent.objectId);
  const sameType = siblings.filter(row => row.typeName === intent.typeName);
  const existing = baseline.records.find(row => row.componentId === intent.componentId);

  if (intent.kind === "add_component") {
    if (!metadata.canAdd) return reject("component_structure_add_denied", "Component addition is not allowed.");
    if (existing) return reject("component_structure_identity_collision", "Component ID is already in the baseline.");
    if (baseline.records.length >= policy.maxComponents || sameType.length >= metadata.maxPerObject ||
        (!metadata.allowMultiple && sameType.length !== 0)) {
      return reject("component_structure_limit_exceeded", "Component or per-owner multiplicity limit reached.");
    }
    if (metadata.requires.includes(intent.typeName)) {
      return reject("component_structure_policy_invalid", "A Component cannot declare a self-dependency.");
    }
    for (const requiredType of metadata.requires) {
      if (!declaredTypes.has(requiredType)) {
        return reject("component_structure_policy_incomplete", "Required Component dependency metadata is missing.");
      }
      if (!siblings.some(row => row.typeName === requiredType)) {
        return reject("component_structure_dependency_missing",
          "Required Component must already exist; implicit Unity additions are not supported.");
      }
    }
  } else {
    if (!metadata.canRemove) return reject("component_structure_remove_denied", "Component removal is not allowed.");
    if (!existing || existing.sceneId !== intent.sceneId ||
        existing.objectId !== intent.objectId || existing.typeName !== intent.typeName) {
      return reject("component_structure_identity_mismatch", "Remove target must match the exact authoritative owner and type.");
    }
    if (sameType.length <= metadata.minPerObject) {
      return reject("component_structure_minimum_required", "Removing this Component would violate the minimum count.");
    }
    for (const sibling of siblings) {
      if (sibling.componentId === intent.componentId) continue;
      const dependent = declaredTypes.get(sibling.typeName);
      if (dependent.requires.includes(intent.typeName) && sameType.length === 1) {
        return reject("component_structure_dependency_in_use",
          "A remaining Component depends on the last instance of the requested type.");
      }
    }
  }

  // A validated plan is *not* a grant, reserved identity or mutation. No
  // simulation may silently create/delete extra Unity-required Components.
  return Object.freeze({
    kind: intent.kind,
    sceneId: intent.sceneId,
    objectId: intent.objectId,
    componentId: intent.componentId,
    typeName: intent.typeName,
    baseRevision: intent.baseRevision,
    requiredTypes: Object.freeze([...metadata.requires].sort()),
  });
}
