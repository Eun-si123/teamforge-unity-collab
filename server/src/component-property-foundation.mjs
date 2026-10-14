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
const SNAPSHOT_FIELDS = Object.freeze(["sceneId", "baseRevision", "properties"]);
const PROPERTY_RECORD_FIELDS = Object.freeze([
  "objectId", "componentId", "typeName", "propertyPath", "valueKind", "value",
]);
const TARGET_FIELDS = Object.freeze([
  "sceneId", "objectId", "componentId", "typeName", "propertyPath", "valueKind",
]);
// Separate property-snapshot prototype limits; explicit caller policy may only
// narrow them. These are not negotiated runtime/protocol promises.
const ABSOLUTE_MAX_PROPERTIES = 2048;
const MAX_PROPERTY_SNAPSHOT_BYTES = 256 * 1024;
const preparedPropertySnapshots = new WeakMap();

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

// "allowedProperties" is a Map<ComponentType, Map<exactPath, descriptor>>.
// Example descriptor: {kind:"float", minimum:0, maximum:100}.
// Range constraints must be explicit for every numeric candidate rather than
// treating a generic finite float as valid for all Unity properties.
// A caller must supply each allowlist explicitly; no default permissions.
function propertyRangeCheck(descriptor, kind, value) {
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
    return reject("component_property_policy_invalid", "Each property needs a typed policy descriptor.");
  }
  if (kind === "boolean") {
    if (!isExactRecord(descriptor, ["kind"]) || descriptor.kind !== kind) {
      return reject("component_property_policy_invalid", "Boolean policy must declare only its kind.");
    }
    return null;
  }
  if (kind === "vector3") {
    if (!isExactRecord(descriptor, ["kind", "maximumAbsolute"]) ||
        descriptor.kind !== kind ||
        !finiteBounded(descriptor.maximumAbsolute) || descriptor.maximumAbsolute < 0) {
      return reject("component_property_policy_invalid", "Vector3 policy requires a bounded non-negative maximumAbsolute.");
    }
    const bound = descriptor.maximumAbsolute;
    return Math.abs(value.x) > bound || Math.abs(value.y) > bound || Math.abs(value.z) > bound
      ? reject("component_property_range_exceeded", "Vector3 axis exceeds the permitted property-specific range.")
      : null;
  }
  if (!isExactRecord(descriptor, ["kind", "minimum", "maximum"]) ||
      descriptor.kind !== kind ||
      (kind === "int32" && (!Number.isInteger(descriptor.minimum) || !Number.isInteger(descriptor.maximum) ||
        descriptor.minimum < -2147483648 || descriptor.maximum > 2147483647)) ||
      (kind === "float" && (!finiteBounded(descriptor.minimum) || !finiteBounded(descriptor.maximum))) ||
      descriptor.minimum > descriptor.maximum) {
    return reject("component_property_policy_invalid", "Numeric policy needs an exact finite minimum and maximum.");
  }
  return value < descriptor.minimum || value > descriptor.maximum
    ? reject("component_property_range_exceeded", "The value exceeds the property-specific allowed range.")
    : null;
}
// The trusted baseline must come from prepareComponentIdentityBaseline rather than
// from caller-provided JSON. The returned object is inert frozen *test data*.
export function prepareComponentPropertyCandidate(session, trustedBaseline, candidate, policy) {
  if (!session || !Number.isSafeInteger(session.revision) ||
      !(session.hierarchySceneIds instanceof Set) ||
      !(session.hierarchyObjects instanceof Map) ||
      !isPreparedComponentIdentityBaseline(trustedBaseline, session)) {
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
  if (!(paths instanceof Map) || !paths.has(candidate.propertyPath)) {
    return reject("component_property_not_allowed", "The exact Component type and property path must be allowlisted.");
  }
  const descriptor = paths.get(candidate.propertyPath);
  if (descriptor && typeof descriptor === "object" && descriptor.kind !== candidate.valueKind) {
    return reject("component_property_not_allowed", "The declared value kind differs from the exact property policy.");
  }
  const validation = propertyRangeCheck(descriptor, candidate.valueKind, candidate.value);
  if (validation) return validation;

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

// Aggregate frozen test data for a future authoritative property seed. Preparing
// this snapshot does not authenticate its values or install them in a Session.
// Callers must obtain input/policy from trusted local state, never client claims.
export function prepareComponentPropertySnapshot(session, identityBaseline, snapshot, policy) {
  if (!session || !Number.isSafeInteger(session.revision) || session.revision < 0 ||
      !(session.hierarchySceneIds instanceof Set) || !(session.hierarchyObjects instanceof Map) ||
      !isPreparedComponentIdentityBaseline(identityBaseline, session)) {
    return reject("component_authority_unavailable", "A same-Session prepared identity baseline is required.");
  }
  if (!isExactRecord(snapshot, SNAPSHOT_FIELDS) ||
      typeof snapshot.sceneId !== "string" || !Array.isArray(snapshot.properties) ||
      !Number.isSafeInteger(snapshot.baseRevision) || snapshot.baseRevision < 0) {
    return reject("invalid_component_property_snapshot", "Property snapshot envelope has unsupported fields or shape.");
  }
  if (snapshot.baseRevision !== session.revision || identityBaseline.baseRevision !== session.revision) {
    return reject("component_property_stale_revision", "Property and identity snapshots must match current authority.");
  }
  if (snapshot.sceneId !== identityBaseline.sceneId || !session.hierarchySceneIds.has(snapshot.sceneId)) {
    return reject("component_property_scene_mismatch", "Property snapshot must belong to the authoritative Scene.");
  }
  if (!policy || !Number.isSafeInteger(policy.maxProperties) || policy.maxProperties < 1 ||
      !(policy.allowedProperties instanceof Map)) {
    return reject("component_property_snapshot_policy_missing", "An explicit property limit and typed allowlist are required.");
  }
  if (snapshot.properties.length > policy.maxProperties || snapshot.properties.length > ABSOLUTE_MAX_PROPERTIES) {
    return reject("component_property_limit_exceeded", "Property snapshot exceeds its configured or absolute count limit.");
  }

  const entries = [], used = new Set();
  for (let index = 0; index < snapshot.properties.length; index++) {
    const entry = snapshot.properties[index];
    if (!isExactRecord(entry, PROPERTY_RECORD_FIELDS)) {
      return reject("invalid_component_property_snapshot", "Every property record must contain exactly the supported fields.");
    }
    const candidate = prepareComponentPropertyCandidate(session, identityBaseline, {
      sceneId: snapshot.sceneId, baseRevision: snapshot.baseRevision, ...entry,
    }, policy);
    if (candidate.error) return reject(candidate.error, `properties[${index}]: ${candidate.reason}`);
    // Identity preparation already guarantees one owner/type for a Component.
    // A repeated path is a collision, even when its value or kind changes.
    const key = JSON.stringify([candidate.componentId, candidate.propertyPath]);
    if (used.has(key)) {
      return reject("component_property_identity_collision", "A Component/property path occurs more than once.");
    }
    used.add(key);
    entries.push({ key, record: Object.freeze({
      objectId: candidate.objectId, componentId: candidate.componentId,
      typeName: candidate.typeName, propertyPath: candidate.propertyPath,
      valueKind: candidate.valueKind, value: candidate.value,
    }) });
  }
  // Code-point ordering is deterministic across locales and Node versions.
  entries.sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
  const properties = Object.freeze(entries.map(entry => entry.record));
  const fingerprint = JSON.stringify({ sceneId: snapshot.sceneId, baseRevision: snapshot.baseRevision, properties });
  if (Buffer.byteLength(fingerprint, "utf8") > MAX_PROPERTY_SNAPSHOT_BYTES) {
    return reject("component_property_snapshot_size_limit", "Property snapshot exceeds the prototype canonical UTF-8 byte limit.");
  }
  const result = Object.freeze({
    sceneId: snapshot.sceneId, baseRevision: snapshot.baseRevision, properties, fingerprint,
  });
  preparedPropertySnapshots.set(result, { session, identityBaseline });
  return result;
}

// One-target lookup for a future rejection/reconnect contract. It neither
// returns a repair message nor authorizes applying the value to a Unity Scene.
export function inspectComponentPropertyTarget(session, snapshot, target, policy) {
  const binding = snapshot !== null && typeof snapshot === "object"
    ? preparedPropertySnapshots.get(snapshot) : null;
  if (!session || !Number.isSafeInteger(session.revision) || session.revision < 0 ||
      !binding || binding.session !== session) {
    return reject("component_authority_unavailable", "Only the same-Session locally prepared property snapshot can be inspected.");
  }
  if (!isExactRecord(target, TARGET_FIELDS)) {
    return reject("invalid_component_property_target", "Target must contain only exact Scene/object/Component/type/path/kind identity.");
  }
  if (snapshot.baseRevision !== session.revision) {
    return reject("component_property_stale_revision", "Target lookup needs a current property snapshot.");
  }
  if (target.sceneId !== snapshot.sceneId) {
    return reject("component_property_scene_mismatch", "Target must belong to this property snapshot's Scene.");
  }
  const record = snapshot.properties.find(entry =>
    entry.objectId === target.objectId && entry.componentId === target.componentId &&
    entry.typeName === target.typeName && entry.propertyPath === target.propertyPath &&
    entry.valueKind === target.valueKind);
  if (!record) {
    return reject("component_property_target_missing", "No property matches every requested target identity field.");
  }
  return prepareComponentPropertyCandidate(session, binding.identityBaseline, {
    sceneId: snapshot.sceneId, baseRevision: snapshot.baseRevision, ...record,
  }, policy);
}
