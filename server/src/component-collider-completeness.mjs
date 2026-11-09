// WP6 pre-wire only: assess whether one locally prepared observation is a
// COMPLETE allowlisted saved-Scene Collider set. This is neither verified
// Publisher provenance nor an authoritative network/Unity synchronization API.
import { isPreparedComponentIdentityBaseline, isSavedComponentId } from "./component-foundation.mjs";
import { isPreparedComponentPropertySnapshot } from "./component-property-foundation.mjs";
import { seedComponentPropertyTransaction } from "./component-property-transaction.mjs";

const TYPES = Object.freeze({
  "UnityEngine.BoxCollider": Object.freeze([
    ["m_IsTrigger", "boolean"], ["m_Center", "vector3"], ["m_Size", "vector3"],
  ]),
  "UnityEngine.SphereCollider": Object.freeze([
    ["m_IsTrigger", "boolean"], ["m_Center", "vector3"], ["m_Radius", "float"],
  ]),
});
const MAX_COLLIDERS = 512;
const SAVED_SCENE_ID = /^GlobalObjectId_V1-2-([0-9a-f]{32})-[1-9][0-9]{0,19}-0$/u;
const SCENE_GUID = /^[0-9a-f]{32}$/u;
const ZERO_GUID = "00000000000000000000000000000000";

function denied(error, reason) {
  return Object.freeze({ error, reason });
}

function finiteInRange(value, nonnegative = false) {
  return typeof value === "number" && Number.isFinite(value) &&
    value >= (nonnegative ? 0 : -100) && value <= 100;
}

function safeSavedId(value, sceneId) {
  // The upstream prepared-ID validator permits prefabs and logical object
  // references for other experiments. A saved-Scene Unity-only Collider
  // inventory has a narrower contract: both IDs have zero prefab file ID.
  const match = typeof value === "string" ? SAVED_SCENE_ID.exec(value) : null;
  return match !== null && match[1] === sceneId &&
    isSavedComponentId(value) && value.length <= 512;
}

function validValue(record) {
  if (record.valueKind === "boolean") return typeof record.value === "boolean";
  if (record.valueKind === "float") {
    return finiteInRange(record.value, record.propertyPath === "m_Radius");
  }
  if (record.valueKind !== "vector3") return false;
  const value = record.value;
  // prepareComponentPropertySnapshot deep-freezes and validates vector3 shape.
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const nonnegative = record.propertyPath === "m_Size";
  return finiteInRange(value.x, nonnegative) &&
    finiteInRange(value.y, nonnegative) &&
    finiteInRange(value.z, nonnegative);
}

// Do not accept plain JSON, cloneable lookalikes or even frozen records.
// Upstream preparation binds each input to the exact same live Session and
// identity baseline in private WeakMaps. Check CURRENT Session authority
// as well, because another Hierarchy/Transform edit may have advanced it.
export function inspectCompleteSavedColliderObservation(session, identityBaseline, propertySnapshot) {
  if (!session || typeof session !== "object" ||
      !isPreparedComponentIdentityBaseline(identityBaseline, session) ||
      !isPreparedComponentPropertySnapshot(propertySnapshot, session, identityBaseline)) {
    return denied("component_collider_observation_untrusted",
      "Two locally prepared observations bound to the same Session and identity baseline are required.");
  }
  if (!Number.isSafeInteger(session.revision) || session.revision < 0 ||
      session.revision !== identityBaseline.baseRevision ||
      session.revision !== propertySnapshot.baseRevision) {
    return denied("component_collider_observation_stale",
      "The entire Collider observation must match the current Session revision.");
  }
  if (!SCENE_GUID.test(identityBaseline.sceneId) ||
      identityBaseline.sceneId === ZERO_GUID ||
      identityBaseline.sceneId !== propertySnapshot.sceneId ||
      !(session.hierarchySceneIds instanceof Set) ||
      !session.hierarchySceneIds.has(identityBaseline.sceneId) ||
      !(session.hierarchyObjects instanceof Map)) {
    return denied("component_collider_scene_unverified",
      "One current saved Scene GUID and authoritative Hierarchy Scene are required.");
  }
  const components = identityBaseline.records;
  const properties = propertySnapshot.properties;
  if (!Array.isArray(components) || components.length < 1 ||
      components.length > MAX_COLLIDERS ||
      !Array.isArray(properties) || properties.length !== components.length * 3) {
    return denied("component_collider_observation_incomplete",
      "Each allowed Collider requires exactly three observed properties within the 512-Component limit.");
  }

  const expected = new Map();
  for (const component of components) {
    if (!Object.hasOwn(TYPES, component.typeName) ||
        !safeSavedId(component.componentId, identityBaseline.sceneId) ||
        !safeSavedId(component.objectId, identityBaseline.sceneId) ||
        component.componentId === component.objectId ||
        !session.hierarchyObjects.has(JSON.stringify([identityBaseline.sceneId, component.objectId])) ||
        expected.has(component.componentId)) {
      return denied("component_collider_identity_invalid",
        "Only distinct saved-Scene Collider IDs with current authoritative GameObject owners are supported.");
    }
    expected.set(component.componentId, { identity: component, seen: new Set() });
  }

  for (const record of properties) {
    const target = expected.get(record.componentId);
    if (!target || target.identity.objectId !== record.objectId ||
        target.identity.typeName !== record.typeName) {
      return denied("component_collider_property_identity_mismatch",
        "A property references an unknown or mismatched Component owner or type.");
    }
    const schema = TYPES[record.typeName];
    const match = schema.find(([name]) => name === record.propertyPath);
    if (!match || match[1] !== record.valueKind ||
        target.seen.has(record.propertyPath) || !validValue(record)) {
      return denied("component_collider_property_invalid",
        "Collider property path, value kind, range or uniqueness differs from the exact supported shape.");
    }
    target.seen.add(record.propertyPath);
  }
  if ([...expected.values()].some(x => x.seen.size !== 3)) {
    return denied("component_collider_observation_incomplete",
      "At least one Collider is missing a required allowlisted property.");
  }

  // Local observation completeness does NOT attest to signed project bytes,
  // a verified Publisher/Scene snapshot, user authorization or a live lock.
  return Object.freeze({
    status: "complete_local_observation_unverified",
    sceneId: identityBaseline.sceneId,
    baseRevision: session.revision,
    componentCount: components.length,
    propertyCount: properties.length,
    identityFingerprint: identityBaseline.fingerprint,
    propertyFingerprint: propertySnapshot.fingerprint,
  });
}

// An opt-in LOCAL simulator entrypoint that refuses sparse/mixed snapshots
// before the older generic seed API. It does not widen the generic API,
// change websocket dispatch, or enable a remotely supplied seed.
export function seedCompleteSavedColliderTransactionForLocalTest(
  session, identityBaseline, propertySnapshot, propertyPolicy, maxOperations = 256,
) {
  const complete = inspectCompleteSavedColliderObservation(session, identityBaseline, propertySnapshot);
  if (complete.error) return complete;
  return seedComponentPropertyTransaction(
    session, identityBaseline, propertySnapshot, propertyPolicy, maxOperations,
  );
}
