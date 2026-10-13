// WP6 pre-wire proof-of-contract only. No current websocket message or Unity Editor
// mutation is routed here. Later phases must explicitly negotiate their authority,
// replay/lock/Undo, allowed properties, and snapshot/rollback rules.
import { validateText } from "./protocol.mjs";
import { isLogicalHierarchyObjectId } from "./hierarchy-model.mjs";

const LOGICAL_COMPONENT_ID = /^tf:c:[0-9a-f]{32}$/u;
// Only saved Scene Components are candidates, not null/imported/source assets.
// Unity's local/prefab file IDs are ulong, including signed local IDs cast to
// ulong. Canonical decimal spelling avoids alternate fingerprints for one ID.
const SAVED_COMPONENT_ID = /^GlobalObjectId_V1-2-([0-9a-f]{32})-([1-9][0-9]{0,19})-(0|[1-9][0-9]{0,19})$/u;
const NULL_SCENE_GUID = "00000000000000000000000000000000";
const MAX_FILE_ID = 18446744073709551615n;
const COMPONENT_ID_FIELDS = Object.freeze(["objectId", "componentId", "typeName"]);
const MAX_COMPONENT_TYPE_LENGTH = 256;
const MAX_COMPONENT_ID_LENGTH = 512;
// Prototype-only absolute limits; user-supplied policy cannot disable them.
const ABSOLUTE_MAX_COMPONENTS = 2048;
const MAX_BASELINE_FINGERPRINT_BYTES = 256 * 1024;
const BASELINE_FIELDS = Object.freeze(["sceneId", "baseRevision", "components"]);
// Only locally prepared, immutable candidates may be consumed by later pre-wire
// experiments. A network-provided lookalike object must not claim validation.
const preparedBaselines = new WeakMap();

export function isPreparedComponentIdentityBaseline(value, session) {
  return value !== null && typeof value === "object" && session !== null &&
    typeof session === "object" && preparedBaselines.get(value) === session;
}

export function isLogicalComponentId(value) {
  return typeof value === "string" && LOGICAL_COMPONENT_ID.test(value);
}

export function isSavedComponentId(value) {
  if (typeof value !== "string") return false;
  const match = SAVED_COMPONENT_ID.exec(value);
  return match !== null && match[1] !== NULL_SCENE_GUID &&
    BigInt(match[2]) <= MAX_FILE_ID && BigInt(match[3]) <= MAX_FILE_ID;
}

export function validateComponentIdentityRecord(record) {
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    return "Component identity must be a plain record.";
  }
  const fields = Object.keys(record);
  if (fields.length !== COMPONENT_ID_FIELDS.length ||
      fields.some((field) => !COMPONENT_ID_FIELDS.includes(field))) {
    return "Component identity must contain only objectId, componentId and typeName; properties are not supported.";
  }

  const objectError = validateText(record.objectId, "objectId", 512);
  if (objectError) return objectError;
  if (record.objectId !== record.objectId.trim()) {
    return "objectId must be canonical without surrounding spaces.";
  }
  if (record.objectId.startsWith("tf:") && !isLogicalHierarchyObjectId(record.objectId)) {
    return "objectId has an invalid logical Hierarchy identity.";
  }
  if (typeof record.componentId !== "string" ||
      record.componentId.length > MAX_COMPONENT_ID_LENGTH ||
      !isSavedComponentId(record.componentId)) {
    return "Clean Component baseline requires a canonical saved Scene Component GlobalObjectId with bounded unsigned file IDs.";
  }

  const typeError = validateText(record.typeName, "typeName", MAX_COMPONENT_TYPE_LENGTH);
  if (typeError) return typeError;
  if (record.typeName !== record.typeName.trim()) {
    return "typeName must be canonical without surrounding spaces.";
  }
  return null;
}

function rejected(error, reason) {
  return { error, reason };
}

// Read-only candidate validation for a future, limited WP6 component identity
// baseline. This does not create authority, write a Session, accept a network
// message, serialize Inspector values, or enable Component synchronization.
export function prepareComponentIdentityBaseline(session, baseline, policy) {
  if (!session || !Number.isSafeInteger(session.revision) ||
      !(session.hierarchySceneIds instanceof Set) ||
      !(session.hierarchyObjects instanceof Map)) {
    return rejected("component_authority_unavailable", "An authoritative Hierarchy snapshot is required.");
  }
  if (!baseline || typeof baseline !== "object" || Array.isArray(baseline) ||
      Object.keys(baseline).length !== BASELINE_FIELDS.length ||
      Object.keys(baseline).some((field) => !BASELINE_FIELDS.includes(field)) ||
      validateText(baseline.sceneId, "sceneId", 128) ||
      baseline.sceneId !== baseline.sceneId.trim() ||
      !Number.isSafeInteger(baseline.baseRevision) || baseline.baseRevision < 0 ||
      !Array.isArray(baseline.components)) {
    return rejected("invalid_component_baseline", "Component baseline envelope is invalid.");
  }
  if (baseline.baseRevision !== session.revision) {
    return rejected("component_stale_revision", "Component baseline must match the current authoritative revision.");
  }
  if (!session.hierarchySceneIds.has(baseline.sceneId)) {
    return rejected("component_scene_unseeded", "Scene Hierarchy must be authoritative before Component identity validation.");
  }
  if (!policy || !Number.isSafeInteger(policy.maxComponents) || policy.maxComponents < 1 ||
      !(policy.supportedTypes instanceof Set)) {
    return rejected("component_policy_missing", "An explicit bounded allowlist and component limit are required.");
  }
  if (baseline.components.length > policy.maxComponents ||
      baseline.components.length > ABSOLUTE_MAX_COMPONENTS) {
    return rejected("component_limit_exceeded", "Component baseline exceeds the configured or absolute object safety limit.");
  }

  const usedComponentIds = new Set();
  const records = [];
  for (let i = 0; i < baseline.components.length; i += 1) {
    const entry = baseline.components[i];
    const validationError = validateComponentIdentityRecord(entry);
    if (validationError) {
      return rejected("invalid_component_identity", "components[" + i + "]: " + validationError);
    }
    if (!policy.supportedTypes.has(entry.typeName)) {
      return rejected("unsupported_component_type", "components[" + i + "]: Component type is not explicitly allowed.");
    }
    if (!session.hierarchyObjects.has(JSON.stringify([baseline.sceneId, entry.objectId]))) {
      return rejected("component_owner_missing", "components[" + i + "]: owning GameObject is not in the authoritative Scene.");
    }
    if (usedComponentIds.has(entry.componentId)) {
      return rejected("component_identity_collision", "Component identity is duplicated, including across different GameObjects.");
    }
    usedComponentIds.add(entry.componentId);
    records.push(Object.freeze({
      sceneId: baseline.sceneId,
      objectId: entry.objectId,
      componentId: entry.componentId,
      typeName: entry.typeName,
    }));
  }

  // Stable identity ordering means equal seeds yield identical fingerprints
  // regardless of Unity Inspector iteration order, without guessing type/index
  // based identity. Future mutation ordering requires its own authority rules.
  records.sort((a, b) => a.componentId < b.componentId ? -1 : a.componentId > b.componentId ? 1 : 0);
  const fingerprint = JSON.stringify(records);
  if (Buffer.byteLength(fingerprint, "utf8") > MAX_BASELINE_FINGERPRINT_BYTES) {
    return rejected("component_snapshot_size_limit",
      "Component identity baseline exceeds the prototype UTF-8 snapshot byte limit.");
  }
  const candidate = Object.freeze({
    sceneId: baseline.sceneId,
    baseRevision: baseline.baseRevision,
    records: Object.freeze(records),
    fingerprint,
  });
  preparedBaselines.set(candidate, session);
  return candidate;
}
