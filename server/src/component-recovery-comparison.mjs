// Source-only WP6 Collider comparison: compare one local Editor observation to
// a first Editor's *unverified declaration*, never mutate a Unity Scene or
// publish a Component property change. Requires explicit read-only preview
// negotiation and current registered authority; no lock for observation.
import { readComponentPropertyTransaction } from "./component-property-transaction.mjs";
import { isSavedComponentId } from "./component-foundation.mjs";
import { observeIndependentColliderComparison } from "./component-observation-evidence.mjs";

const SCENE_GUID = /^[0-9a-f]{32}$/u;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const FIELDS = Object.freeze([
  "type", "protocolVersion", "requestId", "userId", "sceneId",
  "baseRevision", "objectId", "componentId", "typeName", "sceneDirty", "properties",
]);
const ROW_FIELDS = Object.freeze(["propertyPath", "valueKind", "value"]);
const MAX_BYTES = 16 * 1024;
const TYPES = Object.freeze({
  "UnityEngine.BoxCollider": Object.freeze({
    m_IsTrigger: "boolean", m_Center: "vector3", m_Size: "vector3",
  }),
  "UnityEngine.SphereCollider": Object.freeze({
    m_IsTrigger: "boolean", m_Center: "vector3", m_Radius: "float",
  }),
});

function fail(error, reason) {
  return Object.freeze({ error, reason });
}
function record(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Reflect.ownKeys(descriptors);
  return names.length === fields.length &&
    names.every(name => fields.includes(name) && descriptors[name].enumerable &&
      Object.hasOwn(descriptors[name], "value"));
}
function safeNumber(value, positive) {
  return typeof value === "number" && Number.isFinite(value) &&
    value >= (positive ? 0 : -100) && value <= 100;
}
function validValue(path, kind, value) {
  if (kind === "boolean") return typeof value === "boolean";
  if (kind === "float") return safeNumber(value, true);
  if (kind === "vector3") {
    return record(value, ["x", "y", "z"]) &&
      safeNumber(value.x, path === "m_Size") &&
      safeNumber(value.y, path === "m_Size") &&
      safeNumber(value.z, path === "m_Size");
  }
  return false;
}
function equality(kind, a, b) {
  if (kind === "vector3") return b && a.x === b.x && a.y === b.y && a.z === b.z;
  return a === b;
}
function savedIdentity(value, sceneId) {
  return isSavedComponentId(value) &&
    value.startsWith("GlobalObjectId_V1-2-" + sceneId + "-") &&
    value.endsWith("-0");
}

export function compareColliderObservationReadOnly(session, connection, message) {
  // The activeSession check is performed by Session Authority, and repeated
  // here for direct internal invocations. No operation history/lock mutation.
  if (!session || !(session.members instanceof Map) ||
      !(session.hierarchySceneIds instanceof Set) ||
      !(session.hierarchyObjects instanceof Map) ||
      !Number.isSafeInteger(session.revision) || session.revision < 0 ||
      !connection || typeof connection.userId !== "string" ||
      typeof connection.connectionId !== "string" ||
      connection.supportsHierarchySync !== true ||
      connection.supportsComponentRecoveryPreview !== true ||
      session.members.get(connection.userId)?.connectionId !== connection.connectionId ||
      session.members.get(connection.userId)?.supportsHierarchySync !== true) {
    return fail("component_compare_membership_required",
      "A currently registered, read-only-preview-negotiated Hierarchy Editor is required.");
  }
  if (!record(message, FIELDS) ||
      message.type !== "component_recovery_compare_request" ||
      message.protocolVersion !== 1 ||
      typeof message.requestId !== "string" || !REQUEST_ID.test(message.requestId) ||
      message.userId !== connection.userId ||
      typeof message.sceneId !== "string" || !SCENE_GUID.test(message.sceneId) ||
      !Number.isSafeInteger(message.baseRevision) || message.baseRevision < 0 ||
      !savedIdentity(message.objectId, message.sceneId) ||
      !savedIdentity(message.componentId, message.sceneId) ||
      message.objectId === message.componentId ||
      !Object.hasOwn(TYPES, message.typeName) ||
      message.sceneDirty !== false ||
      !Array.isArray(message.properties) || message.properties.length !== 3) {
    return fail("component_compare_invalid",
      "Compare exactly one clean saved Box/SphereCollider with three typed properties.");
  }
  if (Buffer.byteLength(JSON.stringify(message), "utf8") > MAX_BYTES) {
    return fail("component_compare_size_limit", "Read-only Collider comparison exceeds 16 KiB.");
  }
  if (message.baseRevision !== session.revision) {
    return fail("component_compare_stale_revision",
      "A newer Session revision requires a fresh preview before comparing observations.");
  }
  if (!session.hierarchySceneIds.has(message.sceneId) ||
      !session.hierarchyObjects.has(JSON.stringify([message.sceneId, message.objectId]))) {
    return fail("component_compare_owner_missing",
      "The saved GameObject must be in the currently authoritative Scene.");
  }

  const expected = TYPES[message.typeName];
  const received = new Map();
  for (const row of message.properties) {
    if (!record(row, ROW_FIELDS) ||
        typeof row.propertyPath !== "string" ||
        !Object.hasOwn(expected, row.propertyPath) ||
        row.valueKind !== expected[row.propertyPath] ||
        !validValue(row.propertyPath, row.valueKind, row.value) ||
        received.has(row.propertyPath)) {
      return fail("component_compare_property_invalid",
        "Only three exact bounded, non-reference Collider properties may be compared.");
    }
    received.set(row.propertyPath, row);
  }
  if (received.size !== 3) {
    return fail("component_compare_property_incomplete", "Every supported Collider property is required.");
  }

  const view = readComponentPropertyTransaction(session);
  if (view.error) return fail(view.error, view.reason);
  if (view.sceneId !== message.sceneId) {
    return fail("component_compare_scene_mismatch",
      "The server declaration is for a different Scene.");
  }
  const target = view.properties.filter(row =>
    row.objectId === message.objectId &&
    row.componentId === message.componentId &&
    row.typeName === message.typeName);
  if (target.length !== 3 ||
      target.some(row => expected[row.propertyPath] !== row.valueKind)) {
    return fail("component_compare_target_unavailable",
      "An exact three-property Component declaration was not observed; do not assume deletion.");
  }
  const byPath = new Map(target.map(row => [row.propertyPath, row]));
  if (byPath.size !== 3) {
    return fail("component_compare_target_unavailable",
      "A complete non-duplicated initial declaration is required.");
  }
  const differingPaths = Object.keys(expected).filter(path =>
    !equality(expected[path], received.get(path).value, byPath.get(path)?.value));
  const status = differingPaths.length === 0 ? "observations_match" : "observations_differ";
  // Read-only to Unity/authoritative state: this updates only a bounded,
  // ephemeral peer-evidence register. A report never promotes a baseline.
  const peerEvidence = observeIndependentColliderComparison(
    session, connection, message, { status },
  );
  return Object.freeze({
    status,
    ...peerEvidence,
    requestId: message.requestId,
    sceneId: message.sceneId,
    objectId: message.objectId,
    componentId: message.componentId,
    typeName: message.typeName,
    serverRevision: view.serverRevision,
    comparedProperties: 3,
    differingPaths: Object.freeze(differingPaths),
    // Deliberately exclude observed values and any repair/authoritative action.
  });
}
