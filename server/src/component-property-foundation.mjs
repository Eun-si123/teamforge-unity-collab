// WP6 pre-wire property contract experiment ONLY.
// This module is not connected to HTTP, WebSocket, Session Authority dispatch or
// the Unity Editor. It authorizes no network operation or Unity mutation.
// A later feature needs negotiated capabilities, revision/replay/lock authority,
// Undo and rejection reconciliation before any live Inspector writes.
import { types as nodeTypes } from "node:util";
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
  if (value === null || typeof value !== "object" || nodeTypes.isProxy(value) || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  // Reject getters, hidden keys and symbols before reading candidate values.
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  return keys.length === fields.length &&
    keys.every(key => fields.includes(key) && descriptors[key].enumerable &&
      Object.hasOwn(descriptors[key], "value"));
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
  if (!descriptor || typeof descriptor !== "object" || nodeTypes.isProxy(descriptor) || Array.isArray(descriptor)) {
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
  if (descriptor !== null && typeof descriptor === "object" && nodeTypes.isProxy(descriptor)) {
    return reject("component_property_policy_invalid", "Property policy descriptors must be inert records.");
  }
  // Do not execute a policy getter while checking a mismatched value kind.
  const declaredKind = descriptor && typeof descriptor === "object"
    ? Object.getOwnPropertyDescriptor(descriptor, "kind") : null;
  if (declaredKind && Object.hasOwn(declaredKind, "value") &&
      declaredKind.value !== candidate.valueKind) {
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
      typeof snapshot.sceneId !== "string" || nodeTypes.isProxy(snapshot.properties) ||
      !Array.isArray(snapshot.properties) ||
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

  // A sparse or accessor-backed array must not be read before validation.
  const propertyDescriptors = Object.getOwnPropertyDescriptors(snapshot.properties);
  if (Reflect.ownKeys(propertyDescriptors).length !== snapshot.properties.length + 1) {
    return reject("invalid_component_property_snapshot", "Property snapshot list must contain only dense data entries.");
  }
  for (let index = 0; index < snapshot.properties.length; index++) {
    const key = String(index);
    if (!Object.hasOwn(propertyDescriptors, key)) {
      return reject("invalid_component_property_snapshot", "Property snapshot list must contain only dense data entries.");
    }
    const entry = propertyDescriptors[key];
    if (!entry.enumerable || !Object.hasOwn(entry, "value")) {
      return reject("invalid_component_property_snapshot", "Property snapshot list must contain only dense data entries.");
    }
  }

  const entries = [], used = new Set();
  for (let index = 0; index < snapshot.properties.length; index++) {
    const entry = propertyDescriptors[String(index)].value;
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


// Read-only comparison of two locally prepared WP6 property observations.
// An absent record is not proof of deletion, and this result is not an ACK,
// authoritative repair, Unity patch, or permission to edit.
export function diffPreparedComponentPropertySnapshots(session, before, after, policy) {
  const left = before && typeof before === "object" ? preparedPropertySnapshots.get(before) : null;
  const right = after && typeof after === "object" ? preparedPropertySnapshots.get(after) : null;
  if (!session || !Number.isSafeInteger(session.revision) || session.revision < 0 ||
      !left || !right || left.session !== session || right.session !== session) {
    return reject("component_authority_unavailable",
      "Both observations must be locally prepared for the same authoritative Session.");
  }
  if (left.identityBaseline !== right.identityBaseline) {
    return reject("component_property_baseline_mismatch",
      "Both observations must share the exact prepared Component identity baseline.");
  }
  if (before.baseRevision !== session.revision || after.baseRevision !== session.revision) {
    return reject("component_property_stale_revision",
      "Observations must match current authority; cross-revision merging is not supported.");
  }
  if (before.sceneId !== after.sceneId || !(session.hierarchySceneIds instanceof Set) ||
      !session.hierarchySceneIds.has(before.sceneId)) {
    return reject("component_property_scene_mismatch",
      "Both observations must belong to the currently authoritative Scene.");
  }
  if (!policy || !(policy.allowedProperties instanceof Map)) {
    return reject("component_property_policy_missing",
      "Comparison requires an explicit current property policy.");
  }
  // Policy or owner state may change even when the revision remains unchanged.
  for (const snapshot of [before, after]) {
    for (const record of snapshot.properties) {
      const candidate = prepareComponentPropertyCandidate(session, left.identityBaseline, {
        sceneId: snapshot.sceneId, baseRevision: snapshot.baseRevision, ...record,
      }, policy);
      if (candidate.error) return reject(candidate.error, candidate.reason);
    }
  }
  const key = record => JSON.stringify([record.componentId, record.propertyPath]);
  const older = new Map(before.properties.map(record => [key(record), record]));
  const newer = new Map(after.properties.map(record => [key(record), record]));
  const observedOnlyBefore = [], observedOnlyAfter = [], observedChanged = [];
  for (const [id, previous] of older) {
    const current = newer.get(id);
    if (!current) {
      observedOnlyBefore.push(previous);
      continue;
    }
    if (previous.objectId !== current.objectId || previous.typeName !== current.typeName ||
        previous.valueKind !== current.valueKind) {
      return reject("component_property_identity_conflict",
        "The same Component/property path has conflicting owner, type, or value kind.");
    }
    if (JSON.stringify(previous.value) !== JSON.stringify(current.value)) {
      observedChanged.push(Object.freeze({ before: previous, after: current }));
    }
  }
  for (const [id, current] of newer) {
    if (!older.has(id)) observedOnlyAfter.push(current);
  }
  // Inputs and their nested property values are already deeply frozen.
  return Object.freeze({
    sceneId: before.sceneId, baseRevision: before.baseRevision,
    beforeFingerprint: before.fingerprint, afterFingerprint: after.fingerprint,
    observedOnlyBefore: Object.freeze(observedOnlyBefore),
    observedOnlyAfter: Object.freeze(observedOnlyAfter),
    observedChanged: Object.freeze(observedChanged),
  });
}

// Read-only *observation* triage for a future Inspector conflict/reconnect UX.
// No branch is an authorized winner: even "localOnly" is NOT permission to
// replay an edit, and a missing record never means delete/create.
// All snapshots are independently locally prepared for one identical Session,
// revision and Component baseline; no network input can impersonate them.
export function compareThreeWayPreparedComponentPropertySnapshots(
  session, baseline, local, remote, policy,
) {
  // Reuse every existing owner, policy, revision, provenance and cross-record
  // identity guard. Pairwise checking also rejects a local/remote type conflict
  // on a record that was absent from the common baseline.
  for (const [before, after] of [
    [baseline, local], [baseline, remote], [local, remote],
  ]) {
    const comparison = diffPreparedComponentPropertySnapshots(session, before, after, policy);
    if (comparison.error) return comparison;
  }

  const key = record => JSON.stringify([record.componentId, record.propertyPath]);
  const baseMap = new Map(baseline.properties.map(record => [key(record), record]));
  const localMap = new Map(local.properties.map(record => [key(record), record]));
  const remoteMap = new Map(remote.properties.map(record => [key(record), record]));
  const identities = [...new Set([...baseMap.keys(), ...localMap.keys(), ...remoteMap.keys()])]
    .sort();
  const observedLocalOnly = [], observedRemoteOnly = [], observedConvergent = [];
  const observedDivergent = [], observedIncomplete = [];
  let observedUnchangedCount = 0;
  for (const identity of identities) {
    const base = baseMap.get(identity) ?? null;
    const localRecord = localMap.get(identity) ?? null;
    const remoteRecord = remoteMap.get(identity) ?? null;
    const observation = Object.freeze({
      baseline: base, local: localRecord, remote: remoteRecord,
    });
    if (!base || !localRecord || !remoteRecord) {
      observedIncomplete.push(observation);
      continue;
    }
    // Validated canonical property values are frozen; JSON comparison handles
    // both scalar and canonical Vector3 and preserves JSON numeric-zero rules.
    const baselineValue = JSON.stringify(base.value);
    const localValue = JSON.stringify(localRecord.value);
    const remoteValue = JSON.stringify(remoteRecord.value);
    if (localValue === baselineValue && remoteValue === baselineValue) {
      observedUnchangedCount += 1;
    } else if (localValue === remoteValue) {
      observedConvergent.push(observation);
    } else if (remoteValue === baselineValue) {
      observedLocalOnly.push(observation);
    } else if (localValue === baselineValue) {
      observedRemoteOnly.push(observation);
    } else {
      observedDivergent.push(observation);
    }
  }

  return Object.freeze({
    sceneId: baseline.sceneId,
    baseRevision: baseline.baseRevision,
    baselineFingerprint: baseline.fingerprint,
    localFingerprint: local.fingerprint,
    remoteFingerprint: remote.fingerprint,
    observedUnchangedCount,
    observedLocalOnly: Object.freeze(observedLocalOnly),
    observedRemoteOnly: Object.freeze(observedRemoteOnly),
    observedConvergent: Object.freeze(observedConvergent),
    observedDivergent: Object.freeze(observedDivergent),
    observedIncomplete: Object.freeze(observedIncomplete),
  });
}
