import {
  PROTOCOL_VERSION,
  errorMessage,
  validateQuaternion,
  validateText,
  validateTextOrEmpty,
  validateVector3,
} from "./protocol.mjs";
import {
  hierarchyOperationFingerprint,
  hierarchyRecordForTransform,
  hierarchySnapshotByteLength,
  hierarchySnapshotMessage,
  objectKeyForHierarchy,
  prepareHierarchyOperation,
  prepareHierarchySeed,
  validateHierarchyOperation,
  validateHierarchySeed,
} from "./hierarchy-model.mjs";

export const AUTHORITY_EFFECTS = Object.freeze({
  SEND: "send",
  BROADCAST: "broadcast",
  CLOSE: "close",
  CONNECTION_SUPERSEDED: "connection_superseded",
  SEND_BOUNDED: "send_bounded",
});

export function makeSessionKey(projectId, sessionId) {
  return JSON.stringify([projectId, sessionId]);
}

export function createSessionState() {
  return {
    members: new Map(),
    locks: new Map(),
    transforms: new Map(),
    hierarchyObjects: new Map(),
    hierarchyTombstones: new Map(),
    hierarchySceneIds: new Set(),
    operations: new Map(),
    revision: 0,
  };
}

function makeObjectKey(sceneId, objectId) {
  return JSON.stringify([sceneId, objectId]);
}

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

function transformFingerprint(message, sceneId, objectId, operationId, userId) {
  return JSON.stringify({
    messageType: "transform_update",
    operationId,
    userId,
    sceneId,
    objectId,
    baseRevision: message.baseRevision,
    localPosition: copyVector3(message.localPosition),
    localRotation: copyQuaternion(message.localRotation),
    localScale: copyVector3(message.localScale),
  });
}

function initialPresence(connection, timestamp) {
  return {
    userId: connection.userId,
    connectionId: connection.connectionId,
    displayName: connection.userName,
    color: connection.userColor,
    sceneId: "",
    sceneName: "",
    selectedObjectId: "",
    selectedObjectName: "",
    hasSceneView: false,
    cameraPosition: { x: 0, y: 0, z: 0 },
    cameraRotation: { x: 0, y: 0, z: 0, w: 1 },
    cameraPivot: { x: 0, y: 0, z: 0 },
    cameraSize: 10,
    cameraOrthographic: false,
    activity: "Connected",
    lastHeartbeatUnixMs: timestamp,
  };
}

function validatePresenceUpdate(message) {
  return (
    validateText(message.requestId, "requestId", 128) ??
    validateText(message.userId, "userId", 128) ??
    validateTextOrEmpty(message.sceneId, "sceneId", 128) ??
    validateTextOrEmpty(message.sceneName, "sceneName", 128) ??
    validateTextOrEmpty(message.selectedObjectId, "selectedObjectId", 512) ??
    validateTextOrEmpty(message.selectedObjectName, "selectedObjectName", 128) ??
    (typeof message.hasSceneView === "boolean" ? null : "hasSceneView must be a boolean.") ??
    validateVector3(message.cameraPosition, "cameraPosition") ??
    validateQuaternion(message.cameraRotation, "cameraRotation") ??
    validateVector3(message.cameraPivot, "cameraPivot") ??
    (Number.isFinite(message.cameraSize) && message.cameraSize >= 0.001 && message.cameraSize <= 1_000_000_000
      ? null
      : "cameraSize must be a finite number between 0.001 and 1000000000.") ??
    (typeof message.cameraOrthographic === "boolean" ? null : "cameraOrthographic must be a boolean.") ??
    validateTextOrEmpty(message.activity, "activity", 64)
  );
}

function presenceFromUpdate(connection, message, timestamp) {
  return {
    userId: connection.userId,
    connectionId: connection.connectionId,
    displayName: connection.userName,
    color: connection.userColor,
    sceneId: message.sceneId.trim(),
    sceneName: message.sceneName.trim(),
    selectedObjectId: message.selectedObjectId.trim(),
    selectedObjectName: message.selectedObjectName.trim(),
    hasSceneView: message.hasSceneView,
    cameraPosition: copyVector3(message.cameraPosition),
    cameraRotation: copyQuaternion(message.cameraRotation),
    cameraPivot: copyVector3(message.cameraPivot),
    cameraSize: message.cameraSize,
    cameraOrthographic: message.cameraOrthographic,
    activity: message.activity.trim(),
    lastHeartbeatUnixMs: timestamp,
  };
}

function validateLockTarget(message) {
  return (
    validateText(message.requestId, "requestId", 128) ??
    validateText(message.userId, "userId", 128) ??
    validateText(message.sceneId, "sceneId", 128) ??
    validateText(message.objectId, "objectId", 512)
  );
}

function validateTransformUpdate(message) {
  const validationError =
    validateLockTarget(message) ??
    validateText(message.operationId, "operationId", 128) ??
    validateVector3(message.localPosition, "localPosition") ??
    validateQuaternion(message.localRotation, "localRotation") ??
    validateVector3(message.localScale, "localScale");
  if (validationError) {
    return validationError;
  }
  if (!Number.isSafeInteger(message.baseRevision) || message.baseRevision < 0) {
    return "baseRevision must be a non-negative safe integer.";
  }
  const rotationMagnitudeSquared =
    message.localRotation.x * message.localRotation.x +
    message.localRotation.y * message.localRotation.y +
    message.localRotation.z * message.localRotation.z +
    message.localRotation.w * message.localRotation.w;
  if (rotationMagnitudeSquared < 0.000001 || rotationMagnitudeSquared > 4) {
    return "localRotation must be a usable normalized quaternion.";
  }
  return null;
}

function send(connectionId, message) {
  return { type: AUTHORITY_EFFECTS.SEND, connectionId, message };
}

function close(connectionId, code, reason) {
  return { type: AUTHORITY_EFFECTS.CLOSE, connectionId, code, reason };
}

function broadcast(session, channel, message, excludedConnectionId = "") {
  const connectionIds = [];
  for (const member of session.members.values()) {
    if (member.connectionId === excludedConnectionId) {
      continue;
    }
    if (channel === "transform" && !member.supportsTransformSync) {
      continue;
    }
    if (channel === "hierarchy" && !member.supportsHierarchySync) {
      continue;
    }
    connectionIds.push(member.connectionId);
  }
  return {
    type: AUTHORITY_EFFECTS.BROADCAST,
    channel,
    connectionIds,
    message,
  };
}

function boundedSend(connectionId, message, maximumBytes, code, detail) {
  return {
    type: AUTHORITY_EFFECTS.SEND_BOUNDED,
    connectionId,
    message,
    maximumBytes,
    error: errorMessage(code, detail, message.requestId ?? ""),
    closeCode: 1009,
    closeReason: code,
  };
}

function lockReleasedMessage(lockState, reason, requestId, timestamp) {
  return {
    type: "lock_released",
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    sceneId: lockState.sceneId,
    objectId: lockState.objectId,
    previousOwnerUserId: lockState.ownerUserId,
    previousOwnerConnectionId: lockState.ownerConnectionId,
    reason,
    serverTimestampUnixMs: timestamp,
  };
}

function transformSnapshotMessage(session, requestId, timestamp) {
  return {
    type: "transform_snapshot",
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    serverRevision: session.revision,
    transforms: Array.from(session.transforms.values()),
    locks: Array.from(session.locks.values()),
    serverTimestampUnixMs: timestamp,
  };
}

function snapshotByteLength(session, timestamp) {
  return Buffer.byteLength(JSON.stringify(transformSnapshotMessage(session, "", timestamp)));
}

function hierarchyConflictMessage(session, message, reason, detail, authoritativeObject, timestamp) {
  return {
    type: "hierarchy_conflict",
    protocolVersion: PROTOCOL_VERSION,
    requestId: message.requestId ?? "",
    operationId: message.operationId ?? "",
    sceneId: typeof message.sceneId === "string" ? message.sceneId.trim() : "",
    objectId: typeof message.objectId === "string" ? message.objectId.trim() : "",
    reason,
    detail,
    serverRevision: session.revision,
    authoritativeObject: authoritativeObject ? { ...authoritativeObject } : null,
    serverTimestampUnixMs: timestamp,
  };
}

function countLocksForConnection(session, connectionId) {
  let count = 0;
  for (const lockState of session.locks.values()) {
    if (lockState.ownerConnectionId === connectionId) {
      count += 1;
    }
  }
  return count;
}

function registerRecentOperation(session, operationId, fingerprint, applied, maximumOperations) {
  session.operations.set(operationId, { fingerprint, applied });
  while (session.operations.size > maximumOperations) {
    session.operations.delete(session.operations.keys().next().value);
  }
}

function hierarchyTargetCompatibilityError(session, connection, sceneId, objectId) {
  if (!session.hierarchySceneIds.has(sceneId)) {
    return null;
  }
  if (!connection.supportsHierarchySync) {
    return {
      code: "hierarchy_sync_required",
      message: "This Scene has authoritative Phase 4 Hierarchy state; Transform/Lock edits require Hierarchy Sync capability.",
    };
  }
  const key = objectKeyForHierarchy(sceneId, objectId);
  if (session.hierarchyTombstones.has(key)) {
    return {
      code: "hierarchy_object_deleted",
      message: "The Hierarchy target was deleted and cannot be locked or transformed.",
    };
  }
  if (!session.hierarchyObjects.has(key)) {
    return {
      code: "hierarchy_object_missing",
      message: "The Hierarchy target is not part of the authoritative Scene state.",
    };
  }
  return null;
}

export class SessionAuthority {
  constructor(config) {
    this.config = config;
    this.sessions = new Map();
  }

  getOrCreateSession(key) {
    let session = this.sessions.get(key);
    if (!session) {
      session = createSessionState();
      this.sessions.set(key, session);
    }
    return session;
  }

  deleteSessionIfUnused(key, session = this.sessions.get(key)) {
    if (session && session.members.size === 0) {
      this.sessions.delete(key);
      return true;
    }
    return false;
  }

  activeSession(connection) {
    const session = this.sessions.get(connection.sessionKey);
    const record = session?.members.get(connection.userId);
    if (!session || !record || record.connectionId !== connection.connectionId) {
      return null;
    }
    return { session, record };
  }

  dispatch(command) {
    switch (command.type) {
      case "register_presence":
        return this.#registerPresence(command.connection, command.requestId, command.nowUnixMs);
      case "remove_presence":
        return this.#removePresence(command.connection, command.nowUnixMs, command.broadcast !== false);
      case "presence_update":
        return this.#updatePresence(command.connection, command.message, command.nowUnixMs);
      case "hierarchy_seed":
        return this.#handleHierarchySeed(command.connection, command.message, command.nowUnixMs);
      case "hierarchy_operation":
        return this.#handleHierarchyOperation(command.connection, command.message, command.nowUnixMs);
      case "lock_request":
        return this.#handleLockRequest(command.connection, command.message, command.nowUnixMs);
      case "lock_release":
        return this.#handleLockRelease(command.connection, command.message, command.nowUnixMs);
      case "transform_update":
        return this.#handleTransformUpdate(command.connection, command.message, command.nowUnixMs);
      case "expire_locks":
        return this.#expireAllLocks(command.nowUnixMs);
      default:
        throw new TypeError(`Unsupported Session Authority command: ${command.type}`);
    }
  }

  #releaseLock(session, objectKey, reason, requestId, timestamp, shouldBroadcast = true) {
    const lockState = session.locks.get(objectKey);
    if (!lockState) {
      return [];
    }
    session.locks.delete(objectKey);
    const released = lockReleasedMessage(lockState, reason, requestId, timestamp);
    return shouldBroadcast ? [broadcast(session, "transform", released)] : [];
  }

  #releaseLocksForConnection(session, connectionId, reason, timestamp, shouldBroadcast = true) {
    const effects = [];
    for (const [objectKey, lockState] of Array.from(session.locks.entries())) {
      if (lockState.ownerConnectionId === connectionId) {
        effects.push(...this.#releaseLock(session, objectKey, reason, "", timestamp, shouldBroadcast));
      }
    }
    return effects;
  }

  #expireSessionLocks(session, timestamp) {
    const effects = [];
    for (const [objectKey, lockState] of Array.from(session.locks.entries())) {
      if (lockState.expiresAtUnixMs <= timestamp) {
        effects.push(...this.#releaseLock(session, objectKey, "lease_expired", "", timestamp));
      }
    }
    return effects;
  }

  #expireAllLocks(timestamp) {
    const effects = [];
    for (const session of this.sessions.values()) {
      effects.push(...this.#expireSessionLocks(session, timestamp));
    }
    return { effects };
  }

  #registerPresence(connection, requestId, timestamp) {
    const key = makeSessionKey(connection.projectId, connection.sessionId);
    const session = this.getOrCreateSession(key);
    const effects = [];
    const previous = session.members.get(connection.userId);
    if (previous && previous.connectionId !== connection.connectionId) {
      effects.push(...this.#releaseLocksForConnection(
        session,
        previous.connectionId,
        "session_superseded",
        timestamp,
      ));
      effects.push({
        type: AUTHORITY_EFFECTS.CONNECTION_SUPERSEDED,
        connectionId: previous.connectionId,
        reason: "session_superseded",
      });
    }

    const record = {
      connectionId: connection.connectionId,
      userId: connection.userId,
      supportsTransformSync: connection.supportsTransformSync,
      supportsHierarchySync: connection.supportsHierarchySync,
      presence: initialPresence(connection, timestamp),
    };
    session.members.set(connection.userId, record);

    if (previous && previous.connectionId !== connection.connectionId) {
      effects.push(send(
        previous.connectionId,
        errorMessage("session_superseded", "A newer connection replaced this editor presence."),
      ));
      effects.push(close(previous.connectionId, 4001, "session_superseded"));
      effects.push(broadcast(session, "presence", {
        type: "presence_updated",
        protocolVersion: PROTOCOL_VERSION,
        requestId: "",
        presence: record.presence,
      }, connection.connectionId));
    } else {
      effects.push(broadcast(session, "presence", {
        type: "user_joined",
        protocolVersion: PROTOCOL_VERSION,
        requestId: "",
        presence: record.presence,
      }, connection.connectionId));
    }

    effects.push(send(connection.connectionId, {
      type: "presence_snapshot",
      protocolVersion: PROTOCOL_VERSION,
      requestId,
      members: Array.from(session.members.values(), (member) => member.presence),
      serverTimestampUnixMs: timestamp,
    }));

    if (connection.supportsHierarchySync) {
      effects.push(boundedSend(
        connection.connectionId,
        hierarchySnapshotMessage(session, requestId, timestamp),
        this.config.maxHierarchySnapshotBytes,
        "hierarchy_snapshot_too_large",
        "The retained Hierarchy snapshot exceeds this server's safe message limit.",
      ));
    }
    if (connection.supportsTransformSync) {
      effects.push(...this.#expireSessionLocks(session, timestamp));
      effects.push(boundedSend(
        connection.connectionId,
        transformSnapshotMessage(session, requestId, timestamp),
        this.config.maxSnapshotBytes,
        "snapshot_too_large",
        "The retained Transform snapshot exceeds this server's safe message limit.",
      ));
    }
    return { effects, sessionKey: key };
  }

  #removePresence(connection, timestamp, shouldBroadcast) {
    if (!connection.supportsPresence || !connection.sessionKey) {
      return { effects: [] };
    }
    const session = this.sessions.get(connection.sessionKey);
    const current = session?.members.get(connection.userId);
    if (!session || !current || current.connectionId !== connection.connectionId) {
      return { effects: [] };
    }
    const effects = this.#releaseLocksForConnection(
      session,
      connection.connectionId,
      "connection_closed",
      timestamp,
      shouldBroadcast,
    );
    session.members.delete(connection.userId);
    if (this.deleteSessionIfUnused(connection.sessionKey, session)) {
      return { effects };
    }
    if (shouldBroadcast) {
      effects.push(broadcast(session, "presence", {
        type: "user_left",
        protocolVersion: PROTOCOL_VERSION,
        requestId: "",
        userId: connection.userId,
        connectionId: connection.connectionId,
        serverTimestampUnixMs: timestamp,
      }));
    }
    return { effects };
  }

  #updatePresence(connection, message, timestamp) {
    if (!connection.supportsPresence) {
      return { effects: [send(connection.connectionId, errorMessage(
        "presence_not_negotiated",
        "Presence must be enabled in the Hello message.",
        message.requestId ?? "",
      ))] };
    }
    const validationError = validatePresenceUpdate(message);
    if (validationError) {
      return { effects: [send(connection.connectionId, errorMessage(
        "invalid_presence",
        validationError,
        message.requestId ?? "",
      ))] };
    }
    if (message.userId !== connection.userId) {
      return { effects: [send(connection.connectionId, errorMessage(
        "presence_identity_mismatch",
        "Presence updates can only modify the identity negotiated by this connection.",
        message.requestId,
      ))] };
    }
    const active = this.activeSession(connection);
    if (!active) {
      return { effects: [send(connection.connectionId, errorMessage(
        "presence_not_registered",
        "Presence registration is not active.",
        message.requestId,
      ))] };
    }
    active.record.presence = presenceFromUpdate(connection, message, timestamp);
    return { effects: [broadcast(active.session, "presence", {
      type: "presence_updated",
      protocolVersion: PROTOCOL_VERSION,
      requestId: message.requestId,
      presence: active.record.presence,
    })] };
  }

  #requireCapability(connection, capability, requestId) {
    if (connection[capability]) {
      return null;
    }
    const hierarchy = capability === "supportsHierarchySync";
    return send(connection.connectionId, errorMessage(
      hierarchy ? "hierarchy_sync_not_negotiated" : "transform_sync_not_negotiated",
      hierarchy
        ? "Hierarchy Sync must be enabled in the Hello message."
        : "Transform Sync must be enabled in the Hello message.",
      requestId ?? "",
    ));
  }

  #handleHierarchySeed(connection, message, timestamp) {
    const missingCapability = this.#requireCapability(connection, "supportsHierarchySync", message.requestId);
    if (missingCapability) return { effects: [missingCapability] };
    const validationError = validateHierarchySeed(message, this.config);
    if (validationError) {
      return { effects: [send(connection.connectionId, errorMessage(
        "invalid_hierarchy_seed",
        validationError,
        message.requestId ?? "",
      ))] };
    }
    if (message.userId !== connection.userId) {
      return { effects: [send(connection.connectionId, errorMessage(
        "hierarchy_identity_mismatch",
        "Hierarchy messages can only use this connection's identity.",
        message.requestId,
      ))] };
    }
    const active = this.activeSession(connection);
    if (!active) {
      return { effects: [send(connection.connectionId, errorMessage(
        "session_not_registered",
        "Session registration is not active.",
        message.requestId,
      ))] };
    }
    const { session } = active;
    const prepared = prepareHierarchySeed(session, message, this.config);
    if (prepared.error) {
      return { effects: [send(connection.connectionId, hierarchyConflictMessage(
        session,
        message,
        prepared.error,
        prepared.reason,
        null,
        timestamp,
      ))] };
    }
    if (!prepared.idempotent) {
      session.hierarchyObjects = prepared.nextObjects;
    }
    session.hierarchySceneIds.add(message.sceneId.trim());
    const effects = [send(connection.connectionId, {
      type: "hierarchy_seed_accepted",
      protocolVersion: PROTOCOL_VERSION,
      requestId: message.requestId,
      sceneId: message.sceneId.trim(),
      serverRevision: session.revision,
      idempotent: prepared.idempotent,
      serverTimestampUnixMs: timestamp,
    })];
    if (!prepared.idempotent) {
      effects.push(broadcast(
        session,
        "hierarchy",
        hierarchySnapshotMessage(session, "", timestamp),
        connection.connectionId,
      ));
    }
    return { effects };
  }

  #handleHierarchyOperation(connection, message, timestamp) {
    const missingCapability = this.#requireCapability(connection, "supportsHierarchySync", message.requestId);
    if (missingCapability) return { effects: [missingCapability] };
    const validationError = validateHierarchyOperation(message, this.config);
    if (validationError) {
      return { effects: [send(connection.connectionId, errorMessage(
        "invalid_hierarchy_operation",
        validationError,
        message.requestId ?? "",
      ))] };
    }
    if (message.userId !== connection.userId) {
      return { effects: [send(connection.connectionId, errorMessage(
        "hierarchy_identity_mismatch",
        "Hierarchy operations can only use this connection's identity.",
        message.requestId,
      ))] };
    }
    const active = this.activeSession(connection);
    if (!active) {
      return { effects: [send(connection.connectionId, errorMessage(
        "session_not_registered",
        "Session registration is not active.",
        message.requestId,
      ))] };
    }
    const { session } = active;
    const operationId = message.operationId.trim();
    const fingerprint = hierarchyOperationFingerprint(message);
    const duplicate = session.operations.get(operationId);
    if (duplicate) {
      return { effects: [send(
        connection.connectionId,
        duplicate.fingerprint !== fingerprint
          ? errorMessage(
              "operation_id_conflict",
              "Operation ID was already used for a different operation.",
              message.requestId,
            )
          : { ...duplicate.applied, requestId: message.requestId },
      )] };
    }

    const effects = this.#expireSessionLocks(session, timestamp);
    const sceneId = message.sceneId.trim();
    const objectId = message.objectId.trim();
    const objectKey = objectKeyForHierarchy(sceneId, objectId);
    const lockState = session.locks.get(objectKey);
    const targetLockedByOther = Boolean(lockState && lockState.ownerConnectionId !== connection.connectionId);
    const existingHierarchyRecord = session.hierarchyObjects.get(objectKey) ?? null;
    const requestedParentObjectId = typeof message.parentObjectId === "string" ? message.parentObjectId.trim() : "";
    const parentIdsToCheck = new Set();
    if ((message.kind === "create_object" || message.kind === "reparent_object") && requestedParentObjectId) {
      parentIdsToCheck.add(requestedParentObjectId);
    }
    if (existingHierarchyRecord &&
        (message.kind === "delete_object" ||
         message.kind === "reparent_object" ||
         message.kind === "reorder_sibling") &&
        existingHierarchyRecord.parentObjectId) {
      parentIdsToCheck.add(existingHierarchyRecord.parentObjectId);
    }
    for (const parentObjectId of parentIdsToCheck) {
      const parentLock = session.locks.get(objectKeyForHierarchy(sceneId, parentObjectId));
      if (parentLock && parentLock.ownerConnectionId !== connection.connectionId) {
        effects.push(send(connection.connectionId, hierarchyConflictMessage(
          session,
          message,
          "parent_locked_by_other_user",
          "A parent child-list affected by this Hierarchy edit is locked by another connection.",
          existingHierarchyRecord,
          timestamp,
        )));
        return { effects };
      }
    }
    const prepared = prepareHierarchyOperation(
      session,
      message,
      connection,
      this.config,
      targetLockedByOther,
      timestamp,
    );
    if (prepared.conflict) {
      effects.push(send(connection.connectionId, hierarchyConflictMessage(
        session,
        message,
        prepared.conflict,
        prepared.reason,
        prepared.authoritativeObject,
        timestamp,
      )));
      return { effects };
    }
    if (message.kind === "delete_object") {
      for (const deletedObjectId of prepared.deletedObjectIds) {
        const subtreeLock = session.locks.get(objectKeyForHierarchy(sceneId, deletedObjectId));
        if (subtreeLock && subtreeLock.ownerConnectionId !== connection.connectionId) {
          effects.push(send(connection.connectionId, hierarchyConflictMessage(
            session,
            message,
            "subtree_locked_by_other_user",
            "Delete was blocked because an object in the subtree is locked by another connection.",
            existingHierarchyRecord,
            timestamp,
          )));
          return { effects };
        }
      }
    }

    const previousRevision = session.revision;
    session.hierarchyObjects = prepared.nextObjects;
    session.hierarchyTombstones = prepared.nextTombstones;
    session.revision = prepared.serverRevision;
    for (const deletedObjectId of prepared.deletedObjectIds) {
      const deletedKey = objectKeyForHierarchy(sceneId, deletedObjectId);
      effects.push(...this.#releaseLock(session, deletedKey, "hierarchy_deleted", "", timestamp));
      session.transforms.delete(deletedKey);
    }
    if (prepared.transformState && session.transforms.has(objectKey)) {
      session.transforms.set(objectKey, hierarchyRecordForTransform(
        prepared.transformState,
        operationId,
        connection.userId,
        previousRevision,
        prepared.serverRevision,
        timestamp,
      ));
    }
    const applied = {
      type: "hierarchy_applied",
      protocolVersion: PROTOCOL_VERSION,
      requestId: message.requestId,
      operationId,
      userId: connection.userId,
      kind: message.kind,
      sceneId,
      objectId,
      baseRevision: message.baseRevision,
      serverRevision: prepared.serverRevision,
      changedObjects: prepared.changedObjects,
      deletedObjectIds: prepared.deletedObjectIds,
      serverTimestampUnixMs: timestamp,
    };
    registerRecentOperation(session, operationId, fingerprint, applied, this.config.maxRecentOperations);
    effects.push(broadcast(session, "hierarchy", applied));
    if (prepared.deletedObjectIds.length > 0) {
      this.#clearDeletedPresenceReferences(session, sceneId, prepared.deletedObjectIds, timestamp, effects);
    }
    return { effects };
  }

  #clearDeletedPresenceReferences(session, sceneId, deletedObjectIds, timestamp, effects) {
    const deleted = new Set(deletedObjectIds);
    for (const member of session.members.values()) {
      const presence = member.presence;
      if (!presence || presence.sceneId !== sceneId || !deleted.has(presence.selectedObjectId)) {
        continue;
      }
      member.presence = {
        ...presence,
        selectedObjectId: "",
        selectedObjectName: "",
        lastHeartbeatUnixMs: timestamp,
      };
      effects.push(broadcast(session, "presence", {
        type: "presence_updated",
        protocolVersion: PROTOCOL_VERSION,
        requestId: "",
        presence: member.presence,
      }));
    }
  }

  #handleLockRequest(connection, message, timestamp) {
    const missingCapability = this.#requireCapability(connection, "supportsTransformSync", message.requestId);
    if (missingCapability) return { effects: [missingCapability] };
    const validationError = validateLockTarget(message);
    if (validationError) {
      return { effects: [send(connection.connectionId, errorMessage(
        "invalid_lock_request",
        validationError,
        message.requestId ?? "",
      ))] };
    }
    if (message.userId !== connection.userId) {
      return { effects: [send(connection.connectionId, errorMessage(
        "lock_identity_mismatch",
        "A lock can only be requested for this connection's identity.",
        message.requestId,
      ))] };
    }
    const active = this.activeSession(connection);
    if (!active) {
      return { effects: [send(connection.connectionId, errorMessage(
        "session_not_registered",
        "Session registration is not active.",
        message.requestId,
      ))] };
    }
    const { session } = active;
    const effects = this.#expireSessionLocks(session, timestamp);
    const sceneId = message.sceneId.trim();
    const objectId = message.objectId.trim();
    const objectKey = makeObjectKey(sceneId, objectId);
    const compatibilityError = hierarchyTargetCompatibilityError(session, connection, sceneId, objectId);
    if (compatibilityError) {
      effects.push(send(connection.connectionId, errorMessage(
        compatibilityError.code,
        compatibilityError.message,
        message.requestId,
      )));
      return { effects };
    }
    const existing = session.locks.get(objectKey);
    if (existing && existing.ownerConnectionId !== connection.connectionId) {
      effects.push(send(connection.connectionId, {
        type: "lock_denied",
        protocolVersion: PROTOCOL_VERSION,
        requestId: message.requestId,
        reason: "locked_by_other_user",
        lockState: existing,
        serverTimestampUnixMs: timestamp,
      }));
      return { effects };
    }
    if (!existing && session.locks.size >= this.config.maxLocksPerSession) {
      effects.push(send(connection.connectionId, errorMessage(
        "session_lock_limit",
        "The session lock safety limit was reached.",
        message.requestId,
      )));
      return { effects };
    }
    if (!existing && countLocksForConnection(session, connection.connectionId) >= this.config.maxLocksPerConnection) {
      effects.push(send(connection.connectionId, errorMessage(
        "connection_lock_limit",
        "This connection's lock safety limit was reached.",
        message.requestId,
      )));
      return { effects };
    }
    const lockState = {
      sceneId,
      objectId,
      ownerUserId: connection.userId,
      ownerConnectionId: connection.connectionId,
      ownerDisplayName: connection.userName,
      ownerColor: connection.userColor,
      expiresAtUnixMs: timestamp + this.config.lockLeaseMilliseconds,
    };
    session.locks.set(objectKey, lockState);
    effects.push(send(connection.connectionId, {
      type: "lock_granted",
      protocolVersion: PROTOCOL_VERSION,
      requestId: message.requestId,
      lockState,
      serverTimestampUnixMs: timestamp,
    }));
    effects.push(broadcast(session, "transform", {
      type: "lock_state_changed",
      protocolVersion: PROTOCOL_VERSION,
      requestId: "",
      lockState,
      serverTimestampUnixMs: timestamp,
    }, connection.connectionId));
    return { effects };
  }

  #handleLockRelease(connection, message, timestamp) {
    const missingCapability = this.#requireCapability(connection, "supportsTransformSync", message.requestId);
    if (missingCapability) return { effects: [missingCapability] };
    const validationError = validateLockTarget(message);
    if (validationError) {
      return { effects: [send(connection.connectionId, errorMessage(
        "invalid_lock_release",
        validationError,
        message.requestId ?? "",
      ))] };
    }
    if (message.userId !== connection.userId) {
      return { effects: [send(connection.connectionId, errorMessage(
        "lock_identity_mismatch",
        "A lock can only be released by this connection's identity.",
        message.requestId,
      ))] };
    }
    const active = this.activeSession(connection);
    if (!active) {
      return { effects: [send(connection.connectionId, errorMessage(
        "session_not_registered",
        "Session registration is not active.",
        message.requestId,
      ))] };
    }
    const { session } = active;
    const effects = this.#expireSessionLocks(session, timestamp);
    const objectKey = makeObjectKey(message.sceneId.trim(), message.objectId.trim());
    const existing = session.locks.get(objectKey);
    if (!existing) {
      effects.push(send(connection.connectionId, {
        type: "lock_released",
        protocolVersion: PROTOCOL_VERSION,
        requestId: message.requestId,
        sceneId: message.sceneId.trim(),
        objectId: message.objectId.trim(),
        previousOwnerUserId: "",
        previousOwnerConnectionId: "",
        reason: "already_unlocked",
        serverTimestampUnixMs: timestamp,
      }));
      return { effects };
    }
    if (existing.ownerConnectionId !== connection.connectionId) {
      effects.push(send(connection.connectionId, errorMessage(
        "lock_not_owned",
        "The object lock is owned by another connection.",
        message.requestId,
      )));
      return { effects };
    }
    effects.push(...this.#releaseLock(session, objectKey, "client_release", message.requestId, timestamp));
    return { effects };
  }

  #handleTransformUpdate(connection, message, timestamp) {
    const missingCapability = this.#requireCapability(connection, "supportsTransformSync", message.requestId);
    if (missingCapability) return { effects: [missingCapability] };
    const validationError = validateTransformUpdate(message);
    if (validationError) {
      return { effects: [send(connection.connectionId, errorMessage(
        "invalid_transform",
        validationError,
        message.requestId ?? "",
      ))] };
    }
    if (message.userId !== connection.userId) {
      return { effects: [send(connection.connectionId, errorMessage(
        "transform_identity_mismatch",
        "Transform updates can only use this connection's identity.",
        message.requestId,
      ))] };
    }
    const active = this.activeSession(connection);
    if (!active) {
      return { effects: [send(connection.connectionId, errorMessage(
        "session_not_registered",
        "Session registration is not active.",
        message.requestId,
      ))] };
    }
    const { session } = active;
    const sceneId = message.sceneId.trim();
    const objectId = message.objectId.trim();
    const objectKey = makeObjectKey(sceneId, objectId);
    const compatibilityError = hierarchyTargetCompatibilityError(session, connection, sceneId, objectId);
    if (compatibilityError) {
      return { effects: [send(connection.connectionId, errorMessage(
        compatibilityError.code,
        compatibilityError.message,
        message.requestId,
      ))] };
    }
    const operationId = message.operationId.trim();
    const fingerprint = transformFingerprint(message, sceneId, objectId, operationId, connection.userId);
    const duplicate = session.operations.get(operationId);
    if (duplicate) {
      return { effects: [send(
        connection.connectionId,
        duplicate.fingerprint !== fingerprint
          ? errorMessage(
              "operation_id_conflict",
              "Operation ID was already used for a different operation.",
              message.requestId,
            )
          : { ...duplicate.applied, requestId: message.requestId },
      )] };
    }
    const effects = this.#expireSessionLocks(session, timestamp);
    const lockState = session.locks.get(objectKey);
    if (!lockState || lockState.ownerConnectionId !== connection.connectionId) {
      effects.push(send(connection.connectionId, errorMessage(
        "lock_required",
        "The connection must own an active lock before updating Transform.",
        message.requestId,
      )));
      return { effects };
    }
    if (message.baseRevision > session.revision) {
      effects.push(send(connection.connectionId, errorMessage(
        "revision_ahead",
        `baseRevision ${message.baseRevision} is ahead of server revision ${session.revision}.`,
        message.requestId,
      )));
      return { effects };
    }
    const currentObjectState = session.transforms.get(objectKey);
    if (!currentObjectState && session.transforms.size >= this.config.maxRetainedTransforms) {
      effects.push(send(connection.connectionId, errorMessage(
        "session_object_limit",
        "The session retained-Transform safety limit was reached.",
        message.requestId,
      )));
      return { effects };
    }
    const nextRevision = session.revision + 1;
    const applied = {
      type: "transform_applied",
      protocolVersion: PROTOCOL_VERSION,
      requestId: message.requestId,
      operationId,
      userId: connection.userId,
      sceneId,
      objectId,
      baseRevision: message.baseRevision,
      serverRevision: nextRevision,
      localPosition: copyVector3(message.localPosition),
      localRotation: normalizedQuaternion(message.localRotation),
      localScale: copyVector3(message.localScale),
      serverTimestampUnixMs: timestamp,
    };
    const hierarchyRecord = session.hierarchyObjects.get(objectKey) ?? null;
    const previousHierarchyTransform = hierarchyRecord
      ? {
          localPosition: copyVector3(hierarchyRecord.localPosition),
          localRotation: copyQuaternion(hierarchyRecord.localRotation),
          localScale: copyVector3(hierarchyRecord.localScale),
        }
      : null;
    session.transforms.set(objectKey, applied);
    if (hierarchyRecord) {
      hierarchyRecord.localPosition = copyVector3(message.localPosition);
      hierarchyRecord.localRotation = normalizedQuaternion(message.localRotation);
      hierarchyRecord.localScale = copyVector3(message.localScale);
    }
    if (
      snapshotByteLength(session, timestamp) > this.config.maxSnapshotBytes ||
      hierarchySnapshotByteLength(session) > this.config.maxHierarchySnapshotBytes
    ) {
      if (currentObjectState) session.transforms.set(objectKey, currentObjectState);
      else session.transforms.delete(objectKey);
      if (hierarchyRecord && previousHierarchyTransform) {
        hierarchyRecord.localPosition = previousHierarchyTransform.localPosition;
        hierarchyRecord.localRotation = previousHierarchyTransform.localRotation;
        hierarchyRecord.localScale = previousHierarchyTransform.localScale;
      }
      effects.push(send(connection.connectionId, errorMessage(
        "snapshot_size_limit",
        "This Transform would make the recovery snapshot exceed its safety limit.",
        message.requestId,
      )));
      return { effects };
    }
    session.revision = nextRevision;
    registerRecentOperation(session, operationId, fingerprint, applied, this.config.maxRecentOperations);
    effects.push(broadcast(session, "transform", applied));
    return { effects };
  }
}

export function createSessionAuthority(config) {
  return new SessionAuthority(config);
}
