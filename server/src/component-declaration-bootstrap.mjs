// WP6 experimental first-Editor Collider declaration (NOT verified project truth).
// Only explicitly enabled developer servers may call this after an authenticated
// Presence/Hierarchy connection. This is a ONE-TIME, READ-ONLY preview seed,
// not Component Sync and never permission to apply remote Unity values.
import { prepareComponentIdentityBaseline } from "./component-foundation.mjs";
import { prepareComponentPropertySnapshot } from "./component-property-foundation.mjs";
import { seedComponentPropertyTransaction } from "./component-property-transaction.mjs";

const GUID = /^[0-9a-f]{32}$/u;
const SAVED = /^GlobalObjectId_V1-2-([0-9a-f]{32})-([1-9][0-9]{0,19})-(0|[1-9][0-9]{0,19})$/u;
const MAX_PACKET_BYTES = 16 * 1024;
// The first Hierarchy-capable Editor's principal is bound once per Session.
// A late survivor must not become a new "first Editor" when the original
// participant disconnects; never infer ownership from member count alone.
const originalEditorPrincipals = new WeakMap();

export function noteInitialColliderDeclarationPrincipal(session, connection) {
  if (!session || typeof session !== "object" ||
      !connection || connection.supportsHierarchySync !== true ||
      !(session.members instanceof Map) ||
      session.members.size !== 1 ||
      session.members.get(connection.userId)?.connectionId !== connection.connectionId ||
      originalEditorPrincipals.has(session)) return false;
  originalEditorPrincipals.set(session, connection.userId);
  return true;
}
const TYPES = Object.freeze({
  "UnityEngine.BoxCollider": Object.freeze({
    m_IsTrigger: "boolean", m_Center: "vector3", m_Size: "vector3",
  }),
  "UnityEngine.SphereCollider": Object.freeze({
    m_IsTrigger: "boolean", m_Center: "vector3", m_Radius: "float",
  }),
});
const REQUEST_FIELDS = Object.freeze([
  "type", "protocolVersion", "requestId", "userId", "sceneId",
  "baseRevision", "objectId", "componentId", "typeName", "sceneDirty", "properties",
]);
const PROPERTY_FIELDS = Object.freeze(["propertyPath", "valueKind", "value"]);
function fail(error, reason) {
  return Object.freeze({ error, reason });
}
function exact(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const desc = Object.getOwnPropertyDescriptors(value);
  const names = Reflect.ownKeys(desc);
  return names.length === fields.length &&
    names.every(name => fields.includes(name) && desc[name].enumerable &&
      Object.hasOwn(desc[name], "value"));
}
function validSaved(id, scene) {
  if (typeof id !== "string") return false;
  const match = SAVED.exec(id);
  return match !== null && match[1] === scene && match[3] === "0" &&
    BigInt(match[2]) <= 18446744073709551615n;
}
function boundedNumber(value, nonNegative) {
  return typeof value === "number" && Number.isFinite(value) &&
    value <= 100 && value >= (nonNegative ? 0 : -100);
}
function validValue(path, kind, value) {
  if (kind === "boolean") return typeof value === "boolean";
  if (kind === "float") return boundedNumber(value, true);
  if (kind === "vector3" && exact(value, ["x", "y", "z"])) {
    return boundedNumber(value.x, path === "m_Size") &&
      boundedNumber(value.y, path === "m_Size") &&
      boundedNumber(value.z, path === "m_Size");
  }
  return false;
}
function fixedPolicy(typeName) {
  const allowed = new Map();
  const definition = TYPES[typeName];
  for (const [path, kind] of Object.entries(definition)) {
    allowed.set(path,
      kind === "boolean" ? { kind } :
      kind === "float" ? { kind, minimum: 0, maximum: 100 } :
      { kind, maximumAbsolute: 100 });
  }
  return {
    maxProperties: 3,
    allowedProperties: new Map([[typeName, allowed]]),
  };
}

// The returned seed is explicitly an authenticated first-Editor's DECLARATION.
// Server cannot independently attest Unity's saved/dirty status or component
// provenance; it is never a verified baseline or permission to modify clients.
export function acceptFirstEditorColliderDeclaration(session, connection, message, timestamp) {
  if (!session || !(session.members instanceof Map) ||
      !(session.hierarchySceneIds instanceof Set) ||
      !(session.hierarchyObjects instanceof Map) ||
      !(session.locks instanceof Map) || !(session.operations instanceof Map) ||
      !Number.isSafeInteger(session.revision) || session.revision !== 0 ||
      session.operations.size !== 0 ||
      !Number.isSafeInteger(timestamp) || timestamp < 0) {
    return fail("component_declaration_session_not_pristine",
      "Only a clean first-Editor Scene bootstrap at revision zero is allowed.");
  }
  if (!connection || typeof connection.userId !== "string" ||
      typeof connection.connectionId !== "string" ||
      !connection.supportsHierarchySync || !connection.supportsComponentRecoveryPreview ||
      !connection.supportsComponentDeclarationPreview ||
      originalEditorPrincipals.get(session) !== connection.userId ||
      session.members.size !== 1 ||
      session.members.get(connection.userId)?.connectionId !== connection.connectionId ||
      session.members.get(connection.userId)?.supportsHierarchySync !== true) {
    return fail("component_declaration_owner_required",
      "One currently registered first Editor with the negotiated preview capability is required.");
  }
  if (!exact(message, REQUEST_FIELDS) ||
      message.type !== "component_declaration_preview_seed" ||
      message.protocolVersion !== 1 ||
      typeof message.requestId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(message.requestId) ||
      message.userId !== connection.userId ||
      typeof message.sceneId !== "string" || !GUID.test(message.sceneId) ||
      message.baseRevision !== session.revision ||
      !validSaved(message.objectId, message.sceneId) ||
      !validSaved(message.componentId, message.sceneId) ||
      message.objectId === message.componentId ||
      !Object.hasOwn(TYPES, message.typeName) ||
      message.sceneDirty !== false ||
      !Array.isArray(message.properties) ||
      message.properties.length !== 3) {
    return fail("component_declaration_invalid",
      "Only a saved Scene, one exact Collider and three allowed property observations are accepted.");
  }
  const bytes = Buffer.byteLength(JSON.stringify(message), "utf8");
  if (bytes > MAX_PACKET_BYTES) {
    return fail("component_declaration_size_limit",
      "Collider declaration exceeds the 16 KiB source-only limit.");
  }
  if (!session.hierarchySceneIds.has(message.sceneId) ||
      !session.hierarchyObjects.has(JSON.stringify([message.sceneId, message.objectId]))) {
    return fail("component_declaration_hierarchy_missing",
      "The exact saved GameObject must already exist in the authoritative Hierarchy.");
  }
  const lock = session.locks.get(JSON.stringify([message.sceneId, message.objectId]));
  if (!lock || lock.ownerUserId !== connection.userId ||
      lock.ownerConnectionId !== connection.connectionId ||
      !Number.isSafeInteger(lock.expiresAtUnixMs) ||
      lock.expiresAtUnixMs <= timestamp) {
    return fail("component_declaration_lock_required",
      "The first Editor must hold a current object lock for the saved Collider owner.");
  }
  const expected = TYPES[message.typeName];
  const received = new Map();
  for (const row of message.properties) {
    if (!exact(row, PROPERTY_FIELDS) ||
        typeof row.propertyPath !== "string" ||
        !Object.hasOwn(expected, row.propertyPath) ||
        row.valueKind !== expected[row.propertyPath] ||
        !validValue(row.propertyPath, row.valueKind, row.value) ||
        received.has(row.propertyPath)) {
      return fail("component_declaration_property_invalid",
        "Every allowlisted Collider property must occur once with the exact bounded type/value.");
    }
    received.set(row.propertyPath, row);
  }
  if (received.size !== 3) {
    return fail("component_declaration_property_incomplete", "All three Collider properties are required.");
  }
  const identity = prepareComponentIdentityBaseline(session, {
    sceneId: message.sceneId, baseRevision: session.revision,
    components: [{
      objectId: message.objectId,
      componentId: message.componentId,
      typeName: message.typeName,
    }],
  }, {
    maxComponents: 1, supportedTypes: new Set([message.typeName]),
  });
  if (identity.error) return fail(identity.error, identity.reason);
  const policy = fixedPolicy(message.typeName);
  const snapshot = prepareComponentPropertySnapshot(session, identity, {
    sceneId: message.sceneId, baseRevision: session.revision,
    properties: message.properties.map(row => ({
      objectId: message.objectId, componentId: message.componentId,
      typeName: message.typeName, propertyPath: row.propertyPath,
      valueKind: row.valueKind, value: row.value,
    })),
  }, policy);
  if (snapshot.error) return fail(snapshot.error, snapshot.reason);
  const seeded = seedComponentPropertyTransaction(session, identity, snapshot, policy);
  if (seeded.error) return fail(seeded.error, seeded.reason);
  return Object.freeze({
    status: "first_editor_declaration_recorded_unverified",
    sceneId: message.sceneId, serverRevision: session.revision,
    recordedComponents: 1, recordedProperties: 3,
  });
}
