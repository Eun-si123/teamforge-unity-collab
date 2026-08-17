import {
  validateQuaternion,
  validateText,
  validateTextOrEmpty,
  validateVector3,
} from "./protocol.mjs";

export const HIERARCHY_OPERATION_KINDS = Object.freeze([
  "create_object",
  "delete_object",
  "rename_object",
  "reparent_object",
  "reorder_sibling",
]);

const LOGICAL_OBJECT_ID = /^tf:[0-9a-f]{32}$/;

function copyVector3(value) {
  return { x: value.x, y: value.y, z: value.z };
}

function copyQuaternion(value) {
  return { x: value.x, y: value.y, z: value.z, w: value.w };
}

function normalizedQuaternion(value) {
  const magnitude = Math.hypot(value.x, value.y, value.z, value.w);
  return {
    x: value.x / magnitude,
    y: value.y / magnitude,
    z: value.z / magnitude,
    w: value.w / magnitude,
  };
}

function objectKey(sceneId, objectId) {
  return JSON.stringify([sceneId, objectId]);
}

function cloneRecord(record) {
  return {
    sceneId: record.sceneId,
    objectId: record.objectId,
    name: record.name,
    parentObjectId: record.parentObjectId,
    siblingIndex: record.siblingIndex,
    localPosition: copyVector3(record.localPosition),
    localRotation: copyQuaternion(record.localRotation),
    localScale: copyVector3(record.localScale),
    createdRevision: record.createdRevision,
    hierarchyRevision: record.hierarchyRevision,
  };
}

function cloneTombstone(record) {
  return {
    sceneId: record.sceneId,
    objectId: record.objectId,
    deletedRevision: record.deletedRevision,
    deletedByUserId: record.deletedByUserId,
    serverTimestampUnixMs: record.serverTimestampUnixMs,
  };
}

function sceneRecords(objects, sceneId) {
  return Array.from(objects.values()).filter((record) => record.sceneId === sceneId);
}

function childrenOf(objects, sceneId, parentObjectId, excludeObjectId = "") {
  return sceneRecords(objects, sceneId)
    .filter((record) =>
      record.parentObjectId === parentObjectId && record.objectId !== excludeObjectId)
    .sort((left, right) =>
      left.siblingIndex - right.siblingIndex || left.objectId.localeCompare(right.objectId));
}

function assignSiblingOrder(objects, sceneId, parentObjectId, orderedIds, revision, changedKeys) {
  orderedIds.forEach((objectId, index) => {
    const key = objectKey(sceneId, objectId);
    const record = objects.get(key);
    if (!record) {
      return;
    }
    if (record.siblingIndex !== index) {
      record.siblingIndex = index;
      record.hierarchyRevision = revision;
      changedKeys.add(key);
    }
  });
}

function insertAtCanonicalIndex(objects, record, requestedIndex, revision, changedKeys) {
  const siblings = childrenOf(objects, record.sceneId, record.parentObjectId, record.objectId);
  const boundedIndex = Math.max(0, Math.min(requestedIndex, siblings.length));
  const orderedIds = siblings.map((item) => item.objectId);
  orderedIds.splice(boundedIndex, 0, record.objectId);
  assignSiblingOrder(objects, record.sceneId, record.parentObjectId, orderedIds, revision, changedKeys);
}

function canonicalizeSceneSiblingOrder(objects, sceneId, revision = 0) {
  const parentIds = new Set(sceneRecords(objects, sceneId).map((record) => record.parentObjectId));
  for (const parentObjectId of parentIds) {
    const siblings = childrenOf(objects, sceneId, parentObjectId);
    siblings.forEach((record, index) => {
      record.siblingIndex = index;
      if (revision > 0) {
        record.hierarchyRevision = Math.max(record.hierarchyRevision, revision);
      }
    });
  }
}

function validateTransformFields(record, prefix) {
  const validationError =
    validateVector3(record.localPosition, `${prefix}.localPosition`) ??
    validateQuaternion(record.localRotation, `${prefix}.localRotation`) ??
    validateVector3(record.localScale, `${prefix}.localScale`);
  if (validationError) {
    return validationError;
  }

  const magnitudeSquared =
    record.localRotation.x * record.localRotation.x +
    record.localRotation.y * record.localRotation.y +
    record.localRotation.z * record.localRotation.z +
    record.localRotation.w * record.localRotation.w;
  if (magnitudeSquared < 0.000001 || magnitudeSquared > 4) {
    return `${prefix}.localRotation must be a usable normalized quaternion.`;
  }
  return null;
}


function validateHierarchyName(value, name, maximumLength) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength || value.trim().length === 0) {
    return `${name} must contain 1-${maximumLength} printable characters.`;
  }
  if (/[\u0000-\u001f\u007f]/u.test(value)) {
    return `${name} must contain 1-${maximumLength} printable characters.`;
  }
  return null;
}

export function isLogicalHierarchyObjectId(value) {
  return typeof value === "string" && LOGICAL_OBJECT_ID.test(value);
}

export function validateHierarchySeed(message, config) {
  const validationError =
    validateText(message.requestId, "requestId", 128) ??
    validateText(message.userId, "userId", 128) ??
    validateText(message.sceneId, "sceneId", 128);
  if (validationError) {
    return validationError;
  }
  if (!Number.isSafeInteger(message.baseRevision) || message.baseRevision < 0) {
    return "baseRevision must be a non-negative safe integer.";
  }
  if (!Array.isArray(message.objects)) {
    return "objects must be an array.";
  }
  if (message.objects.length > config.maxHierarchyObjects) {
    return "Hierarchy seed exceeds the configured object safety limit.";
  }

  const ids = new Set();
  for (let index = 0; index < message.objects.length; index += 1) {
    const record = message.objects[index];
    if (record === null || typeof record !== "object" || Array.isArray(record)) {
      return `objects[${index}] must be an object.`;
    }
    const prefix = `objects[${index}]`;
    const recordError =
      validateText(record.objectId, `${prefix}.objectId`, 512) ??
      validateHierarchyName(record.name, `${prefix}.name`, config.maxHierarchyNameLength) ??
      validateTextOrEmpty(record.parentObjectId, `${prefix}.parentObjectId`, 512) ??
      validateTransformFields(record, prefix);
    if (recordError) {
      return recordError;
    }
    if (isLogicalHierarchyObjectId(record.objectId)) {
      return `${prefix}.objectId must use the saved-object identity in a clean baseline seed.`;
    }
    if (!Number.isSafeInteger(record.siblingIndex) || record.siblingIndex < 0) {
      return `${prefix}.siblingIndex must be a non-negative safe integer.`;
    }
    if (!ids.add(record.objectId.trim())) {
      return "Hierarchy seed contains a duplicate objectId.";
    }
  }

  for (const record of message.objects) {
    const parentObjectId = record.parentObjectId.trim();
    if (parentObjectId && !ids.has(parentObjectId)) {
      return "Hierarchy seed contains a missing parent object.";
    }
    if (parentObjectId === record.objectId.trim()) {
      return "Hierarchy seed cannot parent an object to itself.";
    }
  }
  return null;
}

export function validateHierarchyOperation(message, config) {
  const validationError =
    validateText(message.requestId, "requestId", 128) ??
    validateText(message.operationId, "operationId", 128) ??
    validateText(message.userId, "userId", 128) ??
    validateText(message.sceneId, "sceneId", 128) ??
    validateText(message.objectId, "objectId", 512);
  if (validationError) {
    return validationError;
  }
  if (!HIERARCHY_OPERATION_KINDS.includes(message.kind)) {
    return "kind is not a supported Hierarchy operation.";
  }
  if (!Number.isSafeInteger(message.baseRevision) || message.baseRevision < 0) {
    return "baseRevision must be a non-negative safe integer.";
  }

  switch (message.kind) {
    case "create_object": {
      if (!isLogicalHierarchyObjectId(message.objectId.trim())) {
        return "create_object requires a logical objectId in tf:<32 lowercase hex> format.";
      }
      return (
        validateHierarchyName(message.name, "name", config.maxHierarchyNameLength) ??
        validateTextOrEmpty(message.parentObjectId, "parentObjectId", 512) ??
        (!Number.isSafeInteger(message.siblingIndex) || message.siblingIndex < 0
          ? "siblingIndex must be a non-negative safe integer."
          : null) ??
        validateTransformFields(message, "create_object")
      );
    }
    case "rename_object":
      return validateHierarchyName(message.name, "name", config.maxHierarchyNameLength);
    case "reparent_object":
      return (
        validateTextOrEmpty(message.parentObjectId, "parentObjectId", 512) ??
        (!Number.isSafeInteger(message.siblingIndex) || message.siblingIndex < 0
          ? "siblingIndex must be a non-negative safe integer."
          : null) ??
        validateTransformFields(message, "reparent_object")
      );
    case "reorder_sibling":
      return !Number.isSafeInteger(message.siblingIndex) || message.siblingIndex < 0
        ? "siblingIndex must be a non-negative safe integer."
        : null;
    case "delete_object":
      return null;
    default:
      return "Unsupported Hierarchy operation.";
  }
}

export function hierarchyOperationFingerprint(message) {
  return JSON.stringify({
    messageType: "hierarchy_operation",
    operationId: message.operationId.trim(),
    userId: message.userId.trim(),
    sceneId: message.sceneId.trim(),
    objectId: message.objectId.trim(),
    kind: message.kind,
    baseRevision: message.baseRevision,
    name: typeof message.name === "string" ? message.name : "",
    parentObjectId: typeof message.parentObjectId === "string" ? message.parentObjectId.trim() : "",
    siblingIndex: Number.isSafeInteger(message.siblingIndex) ? message.siblingIndex : -1,
    localPosition: message.localPosition ? copyVector3(message.localPosition) : null,
    localRotation: message.localRotation ? copyQuaternion(message.localRotation) : null,
    localScale: message.localScale ? copyVector3(message.localScale) : null,
  });
}

export function hierarchySnapshotMessage(session, requestId = "", timestamp = Date.now()) {
  return {
    type: "hierarchy_snapshot",
    protocolVersion: 1,
    requestId,
    serverRevision: session.revision,
    sceneIds: Array.from(session.hierarchySceneIds ?? []).sort((left, right) => left.localeCompare(right)),
    objects: Array.from(session.hierarchyObjects.values())
      .map(cloneRecord)
      .sort((left, right) =>
        left.sceneId.localeCompare(right.sceneId) ||
        left.parentObjectId.localeCompare(right.parentObjectId) ||
        left.siblingIndex - right.siblingIndex ||
        left.objectId.localeCompare(right.objectId)),
    tombstones: Array.from(session.hierarchyTombstones.values())
      .map(cloneTombstone)
      .sort((left, right) => left.deletedRevision - right.deletedRevision || left.objectId.localeCompare(right.objectId)),
    serverTimestampUnixMs: timestamp,
  };
}

export function hierarchySnapshotByteLength(session) {
  return Buffer.byteLength(JSON.stringify(hierarchySnapshotMessage(session)));
}

function normalizedSeedObjects(message) {
  const objects = new Map();
  for (const source of message.objects) {
    const record = {
      sceneId: message.sceneId.trim(),
      objectId: source.objectId.trim(),
      name: source.name,
      parentObjectId: source.parentObjectId.trim(),
      siblingIndex: source.siblingIndex,
      localPosition: copyVector3(source.localPosition),
      localRotation: normalizedQuaternion(source.localRotation),
      localScale: copyVector3(source.localScale),
      createdRevision: 0,
      hierarchyRevision: message.baseRevision,
    };
    objects.set(objectKey(record.sceneId, record.objectId), record);
  }
  canonicalizeSceneSiblingOrder(objects, message.sceneId.trim());
  return objects;
}

function sceneFingerprint(records, sceneId) {
  return JSON.stringify(
    sceneRecords(records, sceneId)
      .map(cloneRecord)
      .sort((left, right) => left.objectId.localeCompare(right.objectId)),
  );
}

function validateNoCyclesAndDepth(objects, sceneId, maximumDepth) {
  const byId = new Map(sceneRecords(objects, sceneId).map((record) => [record.objectId, record]));
  for (const record of byId.values()) {
    const visited = new Set([record.objectId]);
    let parentObjectId = record.parentObjectId;
    let depth = 0;
    while (parentObjectId) {
      depth += 1;
      if (depth > maximumDepth) {
        return "Hierarchy exceeds the configured maximum parent depth.";
      }
      if (!visited.add(parentObjectId)) {
        return "Hierarchy contains a parent cycle.";
      }
      const parent = byId.get(parentObjectId);
      if (!parent) {
        return "Hierarchy references a missing parent.";
      }
      parentObjectId = parent.parentObjectId;
    }
  }
  return null;
}

export function prepareHierarchySeed(session, message, config) {
  if (message.baseRevision !== session.revision) {
    return {
      error: "hierarchy_seed_revision_conflict",
      reason: `Hierarchy seed baseRevision ${message.baseRevision} does not match server revision ${session.revision}.`,
    };
  }

  const sceneId = message.sceneId.trim();
  const incoming = normalizedSeedObjects(message);
  const graphError = validateNoCyclesAndDepth(incoming, sceneId, config.maxHierarchyDepth);
  if (graphError) {
    return { error: "invalid_hierarchy_seed", reason: graphError };
  }

  const existingCount = sceneRecords(session.hierarchyObjects, sceneId).length;
  const existingTombstones = Array.from(session.hierarchyTombstones.values())
    .some((record) => record.sceneId === sceneId);
  const sceneAlreadyAuthoritative = session.hierarchySceneIds?.has(sceneId) === true;
  if (sceneAlreadyAuthoritative || existingCount > 0 || existingTombstones) {
    const idempotent =
      !existingTombstones &&
      sceneFingerprint(session.hierarchyObjects, sceneId) === sceneFingerprint(incoming, sceneId);
    return idempotent
      ? { idempotent: true }
      : {
          error: "hierarchy_seed_conflict",
          reason: "This Scene already has a different authoritative Hierarchy state.",
        };
  }

  const nextObjects = new Map(session.hierarchyObjects);
  for (const [key, record] of incoming) {
    nextObjects.set(key, record);
  }
  if (nextObjects.size > config.maxHierarchyObjects) {
    return {
      error: "hierarchy_object_limit",
      reason: "The combined Session Hierarchy would exceed the configured object safety limit.",
    };
  }
  const shadow = {
    ...session,
    hierarchyObjects: nextObjects,
  };
  if (hierarchySnapshotByteLength(shadow) > config.maxHierarchySnapshotBytes) {
    return {
      error: "hierarchy_snapshot_size_limit",
      reason: "The Hierarchy seed would exceed the configured snapshot safety limit.",
    };
  }
  return { nextObjects, idempotent: false };
}

function authoritativeObject(objects, sceneId, objectId) {
  return objects.get(objectKey(sceneId, objectId)) ?? null;
}

function descendantsIncluding(objects, sceneId, rootObjectId) {
  const byParent = new Map();
  for (const record of sceneRecords(objects, sceneId)) {
    if (!byParent.has(record.parentObjectId)) {
      byParent.set(record.parentObjectId, []);
    }
    byParent.get(record.parentObjectId).push(record.objectId);
  }
  const result = [];
  const pending = [rootObjectId];
  while (pending.length > 0) {
    const objectId = pending.shift();
    result.push(objectId);
    for (const child of byParent.get(objectId) ?? []) {
      pending.push(child);
    }
  }
  return result;
}

function wouldCreateCycle(objects, sceneId, objectId, parentObjectId) {
  let cursor = parentObjectId;
  const visited = new Set();
  while (cursor) {
    if (cursor === objectId) {
      return true;
    }
    if (!visited.add(cursor)) {
      return true;
    }
    const parent = authoritativeObject(objects, sceneId, cursor);
    if (!parent) {
      return false;
    }
    cursor = parent.parentObjectId;
  }
  return false;
}

function changedRecords(objects, changedKeys) {
  return Array.from(changedKeys)
    .map((key) => objects.get(key))
    .filter(Boolean)
    .map(cloneRecord)
    .sort((left, right) =>
      left.parentObjectId.localeCompare(right.parentObjectId) ||
      left.siblingIndex - right.siblingIndex ||
      left.objectId.localeCompare(right.objectId));
}

export function prepareHierarchyOperation(
  session,
  message,
  state,
  config,
  targetLockedByOther,
  timestamp = Date.now(),
) {
  const sceneId = message.sceneId.trim();
  const objectId = message.objectId.trim();
  if (session.hierarchySceneIds && !session.hierarchySceneIds.has(sceneId)) {
    return {
      conflict: "hierarchy_scene_unseeded",
      reason: "The Scene has no authoritative Hierarchy baseline yet.",
      authoritativeObject: null,
    };
  }
  const key = objectKey(sceneId, objectId);
  const operationRevision = session.revision + 1;
  const nextObjects = new Map(
    Array.from(session.hierarchyObjects.entries(), ([entryKey, record]) => [entryKey, cloneRecord(record)]),
  );
  const nextTombstones = new Map(
    Array.from(session.hierarchyTombstones.entries(), ([entryKey, record]) => [entryKey, cloneTombstone(record)]),
  );
  const changedKeys = new Set();
  const deletedObjectIds = [];
  const affectedParentIds = new Set();
  let transformState = null;

  if (message.baseRevision !== session.revision) {
    return {
      conflict: "stale_revision",
      reason: `baseRevision ${message.baseRevision} does not match server revision ${session.revision}.`,
      authoritativeObject: authoritativeObject(nextObjects, sceneId, objectId),
    };
  }

  const existing = authoritativeObject(nextObjects, sceneId, objectId);
  const tombstone = nextTombstones.get(key);
  if (message.kind !== "create_object" && !existing) {
    return {
      conflict: tombstone ? "object_deleted" : "missing_object",
      reason: tombstone ? "The object was already deleted." : "The object does not exist in the authoritative Hierarchy.",
      authoritativeObject: null,
    };
  }

  if (message.kind !== "create_object" && targetLockedByOther) {
    return {
      conflict: "locked_by_other_user",
      reason: "The Hierarchy target is locked by another connection.",
      authoritativeObject: existing,
    };
  }

  switch (message.kind) {
    case "create_object": {
      if (existing || tombstone) {
        return {
          conflict: tombstone ? "object_id_tombstoned" : "object_exists",
          reason: tombstone
            ? "The logical objectId is tombstoned and cannot be reused in this Session."
            : "The objectId already exists.",
          authoritativeObject: existing,
        };
      }
      if (nextObjects.size >= config.maxHierarchyObjects) {
        return { conflict: "hierarchy_object_limit", reason: "The Hierarchy object safety limit was reached." };
      }
      const parentObjectId = message.parentObjectId.trim();
      if (parentObjectId && !authoritativeObject(nextObjects, sceneId, parentObjectId)) {
        return { conflict: "missing_parent", reason: "The requested parent does not exist." };
      }
      const record = {
        sceneId,
        objectId,
        name: message.name,
        parentObjectId,
        siblingIndex: 0,
        localPosition: copyVector3(message.localPosition),
        localRotation: normalizedQuaternion(message.localRotation),
        localScale: copyVector3(message.localScale),
        createdRevision: operationRevision,
        hierarchyRevision: operationRevision,
      };
      nextObjects.set(key, record);
      changedKeys.add(key);
      affectedParentIds.add(parentObjectId);
      insertAtCanonicalIndex(nextObjects, record, message.siblingIndex, operationRevision, changedKeys);
      transformState = cloneRecord(record);
      break;
    }
    case "delete_object": {
      const oldParent = existing.parentObjectId;
      affectedParentIds.add(oldParent);
      for (const deletedObjectId of descendantsIncluding(nextObjects, sceneId, objectId)) {
        const deletedKey = objectKey(sceneId, deletedObjectId);
        nextObjects.delete(deletedKey);
        deletedObjectIds.push(deletedObjectId);
        nextTombstones.delete(deletedKey);
        nextTombstones.set(deletedKey, {
          sceneId,
          objectId: deletedObjectId,
          deletedRevision: operationRevision,
          deletedByUserId: state.userId,
          serverTimestampUnixMs: timestamp,
        });
      }
      const siblings = childrenOf(nextObjects, sceneId, oldParent);
      assignSiblingOrder(
        nextObjects,
        sceneId,
        oldParent,
        siblings.map((record) => record.objectId),
        operationRevision,
        changedKeys,
      );
      break;
    }
    case "rename_object":
      existing.name = message.name;
      existing.hierarchyRevision = operationRevision;
      changedKeys.add(key);
      break;
    case "reparent_object": {
      const parentObjectId = message.parentObjectId.trim();
      if (parentObjectId && !authoritativeObject(nextObjects, sceneId, parentObjectId)) {
        return { conflict: "missing_parent", reason: "The requested parent does not exist." };
      }
      if (wouldCreateCycle(nextObjects, sceneId, objectId, parentObjectId)) {
        return { conflict: "parent_cycle", reason: "The requested parent would create a Hierarchy cycle." };
      }
      const oldParent = existing.parentObjectId;
      existing.parentObjectId = parentObjectId;
      existing.localPosition = copyVector3(message.localPosition);
      existing.localRotation = normalizedQuaternion(message.localRotation);
      existing.localScale = copyVector3(message.localScale);
      existing.hierarchyRevision = operationRevision;
      changedKeys.add(key);
      affectedParentIds.add(oldParent);
      affectedParentIds.add(parentObjectId);
      const oldSiblings = childrenOf(nextObjects, sceneId, oldParent, objectId);
      assignSiblingOrder(
        nextObjects,
        sceneId,
        oldParent,
        oldSiblings.map((record) => record.objectId),
        operationRevision,
        changedKeys,
      );
      insertAtCanonicalIndex(nextObjects, existing, message.siblingIndex, operationRevision, changedKeys);
      transformState = cloneRecord(existing);
      break;
    }
    case "reorder_sibling": {
      affectedParentIds.add(existing.parentObjectId);
      insertAtCanonicalIndex(nextObjects, existing, message.siblingIndex, operationRevision, changedKeys);
      existing.hierarchyRevision = operationRevision;
      changedKeys.add(key);
      break;
    }
    default:
      return { conflict: "unsupported_operation", reason: "Unsupported Hierarchy operation." };
  }

  const graphError = validateNoCyclesAndDepth(nextObjects, sceneId, config.maxHierarchyDepth);
  if (graphError) {
    return { conflict: "invalid_hierarchy", reason: graphError, authoritativeObject: existing };
  }
  while (nextTombstones.size > config.maxHierarchyTombstones) {
    nextTombstones.delete(nextTombstones.keys().next().value);
  }

  const shadow = {
    ...session,
    hierarchyObjects: nextObjects,
    hierarchyTombstones: nextTombstones,
    revision: operationRevision,
  };
  if (hierarchySnapshotByteLength(shadow) > config.maxHierarchySnapshotBytes) {
    return {
      conflict: "hierarchy_snapshot_size_limit",
      reason: "This edit would make the Hierarchy snapshot exceed its safety limit.",
      authoritativeObject: existing,
    };
  }

  return {
    nextObjects,
    nextTombstones,
    serverRevision: operationRevision,
    changedObjects: changedRecords(nextObjects, changedKeys),
    deletedObjectIds,
    affectedParentIds: Array.from(affectedParentIds),
    transformState,
  };
}

export function objectKeyForHierarchy(sceneId, objectId) {
  return objectKey(sceneId, objectId);
}

export function hierarchyRecordForTransform(record, operationId, userId, baseRevision, serverRevision, timestamp = Date.now()) {
  if (!record) {
    return null;
  }
  return {
    type: "transform_applied",
    protocolVersion: 1,
    requestId: "",
    operationId,
    userId,
    sceneId: record.sceneId,
    objectId: record.objectId,
    baseRevision,
    serverRevision,
    localPosition: copyVector3(record.localPosition),
    localRotation: copyQuaternion(record.localRotation),
    localScale: copyVector3(record.localScale),
    serverTimestampUnixMs: timestamp,
  };
}
