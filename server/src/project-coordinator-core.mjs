import { PROTOCOL_VERSION, errorMessage } from "./protocol.mjs";
import {
  calculateSeedRank,
  compareProjectPeers,
  descriptorIsCompatible,
  descriptorMatchesBaseline,
  validateProjectCoordinatorMessage,
  verifyProjectDescriptor,
  verifyProjectOwnerProof,
} from "./project-coordinator.mjs";
import { makeSessionKey } from "./session-authority.mjs";

export const COORDINATOR_EFFECTS = Object.freeze({
  SEND: "send",
  BROADCAST: "broadcast",
  CLOSE: "close",
  SEND_BOUNDED: "send_bounded",
});

function send(connectionId, message) {
  return { type: COORDINATOR_EFFECTS.SEND, connectionId, message };
}

function close(connectionId, code, reason) {
  return { type: COORDINATOR_EFFECTS.CLOSE, connectionId, code, reason };
}

function broadcast(session, message, excludedConnectionId = "") {
  return {
    type: COORDINATOR_EFFECTS.BROADCAST,
    connectionIds: Array.from(session.members.keys()).filter(
      (connectionId) => connectionId !== excludedConnectionId,
    ),
    message,
  };
}

function publicBaseline(project) {
  return project?.baseline ? { ...project.baseline } : null;
}

function baselineFromDescriptor(descriptor, connection, timestamp) {
  return {
    projectUuid: descriptor.projectUuid,
    baselineRevision: descriptor.baselineRevision,
    manifestHash: descriptor.manifestHash,
    descriptorHash: descriptor.descriptorHash,
    unityVersion: descriptor.unityVersion,
    teamForgePackageVersion: descriptor.teamForgePackageVersion,
    realtimeProtocolVersion: descriptor.realtimeProtocolVersion,
    transferProtocolVersion: descriptor.transferProtocolVersion,
    manifestSchemaVersion: descriptor.manifestSchemaVersion,
    ownerKeyId: descriptor.ownerKeyId,
    ownerPublicKey: descriptor.ownerPublicKey,
    publisherKeyId: descriptor.publisherKeyId,
    publisherPublicKey: descriptor.publisherPublicKey,
    publisherAuthorization: descriptor.publisherAuthorization,
    baselineSignature: descriptor.baselineSignature,
    publishedByUserId: connection.userId,
    publishedByConnectionId: connection.connectionId,
    publishedAtUnixMs: timestamp,
  };
}

function projectPeerEvent(type, peer, requestId, timestamp) {
  return {
    type,
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    peer: { ...peer },
    serverTimestampUnixMs: timestamp,
  };
}

function baselineChangedMessage(project, requestId, idempotent, timestamp) {
  return {
    type: "project_baseline_changed",
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    baseline: publicBaseline(project),
    idempotent,
    serverTimestampUnixMs: timestamp,
  };
}

function projectSyncReason(peer, baseline) {
  if (!baseline) return "baseline_unavailable";
  if (peer.baselineRevision < baseline.baselineRevision) return "baseline_outdated";
  if (peer.baselineRevision > baseline.baselineRevision) return "baseline_not_published";
  if (!descriptorIsCompatible(peer)) return "incompatible_descriptor";
  if (peer.manifestHash !== baseline.manifestHash || peer.descriptorHash !== baseline.descriptorHash) {
    return "manifest_mismatch";
  }
  return peer.seedRank === 99 ? "baseline_unavailable" : "";
}

function identityError(project, descriptor) {
  if (!project) return null;
  if (project.projectUuid !== descriptor.projectUuid) return "project_uuid_conflict";
  if (project.ownerKeyId !== descriptor.ownerKeyId || project.ownerPublicKey !== descriptor.ownerPublicKey) {
    return "owner_key_mismatch";
  }
  return null;
}

function identityErrorMessage(requestId, code) {
  return code === "project_uuid_conflict"
    ? errorMessage(code, "This projectId is already bound to a different projectUuid.", requestId)
    : errorMessage(code, "The Project Owner key does not match the established Project identity.", requestId);
}

export class ProjectCoordinatorCore {
  constructor(config) {
    this.config = config;
    this.projects = new Map();
    this.sessions = new Map();
  }

  getOrCreateSession(key) {
    let session = this.sessions.get(key);
    if (!session) {
      session = { members: new Map() };
      this.sessions.set(key, session);
    }
    return session;
  }

  registrationCapacityError(connection) {
    const session = this.sessions.get(makeSessionKey(connection.projectId, connection.sessionId));
    const replacement = session && Array.from(session.members.values()).some(
      (member) => member.connection.userId === connection.userId,
    );
    return session && !replacement && session.members.size >= this.config.maxProjectPeersPerSession
      ? "The Project session peer safety limit was reached."
      : null;
  }

  activeRecord(connection) {
    const session = this.sessions.get(connection.sessionKey);
    const record = session?.members.get(connection.connectionId);
    return session && record ? { session, record } : null;
  }

  dispatch(command) {
    switch (command.type) {
      case "register_client":
        return this.#registerClient(command.connection, command.nowUnixMs, command.broadcast !== false);
      case "remove_client":
        return this.#removeClient(command.connectionId, command.reason, command.nowUnixMs, command.broadcast !== false);
      case "send_snapshot":
        return this.#sendSnapshot(command.connection, command.requestId, command.nowUnixMs);
      case "peer_announce":
        return this.#handlePeerAnnounce(command.connection, command.message, command.nowUnixMs);
      case "baseline_publish":
        return this.#handleBaselinePublish(command.connection, command.message, command.nowUnixMs);
      default:
        throw new TypeError(`Unsupported Project Coordinator command: ${command.type}`);
    }
  }

  #createProject(connection, descriptor, timestamp, bootstrapPublisherConnectionId = "") {
    const project = {
      projectId: connection.projectId,
      projectUuid: descriptor.projectUuid,
      ownerKeyId: descriptor.ownerKeyId,
      ownerPublicKey: descriptor.ownerPublicKey,
      baseline: baselineFromDescriptor(descriptor, connection, timestamp),
      bootstrapPublisherConnectionId,
    };
    this.projects.set(connection.projectId, project);
    return project;
  }

  #globalBroadcast(projectId, message) {
    const effects = [];
    for (const session of this.sessions.values()) {
      const connectionIds = Array.from(session.members.values())
        .filter((member) => member.connection.projectId === projectId)
        .map((member) => member.connection.connectionId);
      if (connectionIds.length > 0) {
        effects.push({ type: COORDINATOR_EFFECTS.BROADCAST, connectionIds, message });
      }
    }
    return effects;
  }

  #registerClient(connection, timestamp, shouldBroadcast) {
    const key = makeSessionKey(connection.projectId, connection.sessionId);
    const session = this.getOrCreateSession(key);
    const previous = Array.from(session.members.values()).find(
      (member) => member.connection.userId === connection.userId &&
        member.connection.connectionId !== connection.connectionId,
    );
    if (!previous && !session.members.has(connection.connectionId) &&
        session.members.size >= this.config.maxProjectPeersPerSession) {
      return { error: "The Project session peer safety limit was reached.", effects: [], removedConnectionIds: [] };
    }

    const effects = [];
    const removedConnectionIds = [];
    if (previous) {
      session.members.delete(previous.connection.connectionId);
      previous.connection.projectClientRegistered = false;
      removedConnectionIds.push(previous.connection.connectionId);
      if (previous.peer && shouldBroadcast) {
        effects.push(broadcast(session, projectPeerEvent("project_peer_left", {
          ...previous.peer,
          leaveReason: "session_superseded",
        }, "", timestamp)));
      }
      effects.push(send(
        previous.connection.connectionId,
        errorMessage("session_superseded", "A newer connection replaced this Project peer."),
      ));
      effects.push(close(previous.connection.connectionId, 4001, "session_superseded"));
    }

    connection.sessionKey = key;
    connection.projectClientRegistered = true;
    session.members.set(connection.connectionId, { connection, peer: null });
    return { error: null, effects, removedConnectionIds };
  }

  #removeClient(connectionId, reason = "connection_closed", timestamp, shouldBroadcast) {
    for (const [key, session] of this.sessions) {
      const record = session.members.get(connectionId);
      if (!record) continue;
      session.members.delete(connectionId);
      record.connection.projectClientRegistered = false;
      const effects = [];
      if (record.peer && shouldBroadcast) {
        effects.push(broadcast(session, projectPeerEvent("project_peer_left", {
          ...record.peer,
          leaveReason: reason,
        }, "", timestamp)));
      }
      if (session.members.size === 0) this.sessions.delete(key);
      return { effects, removedConnectionIds: [connectionId] };
    }
    return { effects: [], removedConnectionIds: [] };
  }

  #snapshotMessage(connection, session, requestId, timestamp) {
    const project = this.projects.get(connection.projectId);
    const peers = Array.from(session.members.values())
      .filter((member) => member.peer)
      .map((member) => ({ ...member.peer }))
      .sort(compareProjectPeers);
    return {
      type: "project_registry_snapshot",
      protocolVersion: PROTOCOL_VERSION,
      requestId,
      projectId: connection.projectId,
      projectUuid: project?.projectUuid ?? "",
      baseline: publicBaseline(project),
      peers,
      serverTimestampUnixMs: timestamp,
    };
  }

  #sendSnapshot(connection, requestId, timestamp) {
    const session = this.sessions.get(connection.sessionKey);
    if (!session || !session.members.has(connection.connectionId)) return { effects: [] };
    return {
      effects: [{
        type: COORDINATOR_EFFECTS.SEND_BOUNDED,
        connectionId: connection.connectionId,
        message: this.#snapshotMessage(connection, session, requestId, timestamp),
        maximumBytes: this.config.maxSnapshotBytes,
        error: errorMessage(
          "project_snapshot_too_large",
          "The Project peer snapshot exceeds this server's safe message limit.",
          requestId,
        ),
        closeCode: 1009,
        closeReason: "project_snapshot_too_large",
      }],
    };
  }

  #validateAndVerify(connection, message, messageType) {
    const validationError = validateProjectCoordinatorMessage(message, messageType);
    if (validationError) {
      return { error: errorMessage("invalid_project_message", validationError, message.requestId ?? "") };
    }
    if (message.userId !== connection.userId) {
      return { error: errorMessage(
        "project_identity_mismatch",
        "Project Coordinator messages can only use this connection's identity.",
        message.requestId,
      ) };
    }
    const verified = verifyProjectDescriptor(message, connection.projectId);
    if (verified.error) {
      return { error: errorMessage("invalid_project_signature", verified.error, message.requestId) };
    }
    const projectIdentityError = identityError(this.projects.get(connection.projectId), verified.descriptor);
    return projectIdentityError
      ? { error: identityErrorMessage(message.requestId, projectIdentityError) }
      : { error: null, verified };
  }

  #precondition(connection, requestId) {
    if (!connection.supportsProjectTransfer || !connection.projectClientRegistered || !this.activeRecord(connection)) {
      const message = !connection.supportsProjectTransfer
        ? errorMessage(
          "project_transfer_not_negotiated",
          "Project Transfer must be enabled in the Hello message.",
          requestId ?? "",
        )
        : errorMessage(
          "project_session_not_registered",
          "Project session registration is not active.",
          requestId ?? "",
        );
      return { effects: [send(connection.connectionId, message)] };
    }
    return null;
  }

  #syncRequiredEffect(record, reason, requestId, timestamp) {
    const project = this.projects.get(record.connection.projectId);
    if (!project || !reason) return null;
    return send(record.connection.connectionId, {
      type: "project_sync_required",
      protocolVersion: PROTOCOL_VERSION,
      requestId,
      reason,
      baseline: publicBaseline(project),
      serverTimestampUnixMs: timestamp,
    });
  }

  #recalculateProjectPeers(projectId, emitUpdates, timestamp) {
    const project = this.projects.get(projectId);
    if (!project) return [];
    const effects = [];
    for (const session of this.sessions.values()) {
      for (const member of session.members.values()) {
        if (member.connection.projectId !== projectId || !member.peer) continue;
        const nextRank = calculateSeedRank(
          member.peer,
          project.baseline,
          project.bootstrapPublisherConnectionId,
        );
        if (member.peer.seedRank !== nextRank) {
          member.peer.seedRank = nextRank;
          member.peer.lastUpdatedUnixMs = timestamp;
          if (emitUpdates) {
            effects.push(broadcast(
              session,
              projectPeerEvent("project_peer_updated", member.peer, "", timestamp),
            ));
          }
        }
      }
    }
    return effects;
  }

  #syncRequirementEffects(projectId, timestamp) {
    const project = this.projects.get(projectId);
    if (!project) return [];
    const effects = [];
    for (const session of this.sessions.values()) {
      for (const member of session.members.values()) {
        if (member.connection.projectId !== projectId || !member.peer) continue;
        const effect = this.#syncRequiredEffect(
          member,
          projectSyncReason(member.peer, project.baseline),
          "",
          timestamp,
        );
        if (effect) effects.push(effect);
      }
    }
    return effects;
  }

  #handlePeerAnnounce(connection, message, timestamp) {
    const precondition = this.#precondition(connection, message.requestId);
    if (precondition) return precondition;
    const active = this.activeRecord(connection);
    const checked = this.#validateAndVerify(connection, message, "project_peer_announce");
    if (checked.error) return { effects: [send(connection.connectionId, checked.error)] };
    const proof = verifyProjectOwnerProof(
      message,
      connection.projectId,
      connection.connectionId,
      checked.verified.ownerPublicKeyObject,
    );
    if (proof.error) {
      return { effects: [send(
        connection.connectionId,
        errorMessage("invalid_owner_proof", proof.error, message.requestId),
      )] };
    }

    let project = this.projects.get(connection.projectId);
    let recoveredBaseline = false;
    if (!project) {
      if (!descriptorIsCompatible(checked.verified.descriptor)) {
        return { effects: [send(connection.connectionId, errorMessage(
          "incompatible_project_descriptor",
          "An empty Project registry can only be reconstructed from a compatible signed Descriptor.",
          message.requestId,
        ))] };
      }
      if (this.projects.size >= this.config.maxProjectRegistries) {
        return { effects: [send(connection.connectionId, errorMessage(
          "project_registry_limit",
          "The global Project registry safety limit was reached.",
          message.requestId,
        ))] };
      }
      project = this.#createProject(connection, checked.verified.descriptor, timestamp);
      recoveredBaseline = true;
    }

    const previous = active.record.peer;
    const descriptor = checked.verified.descriptor;
    const peer = {
      connectionId: connection.connectionId,
      userId: connection.userId,
      userName: connection.userName,
      projectUuid: descriptor.projectUuid,
      baselineRevision: descriptor.baselineRevision,
      manifestHash: descriptor.manifestHash,
      descriptorHash: descriptor.descriptorHash,
      completeBaseline: message.completeBaseline,
      availableChunkCount: message.availableChunkCount,
      totalChunkCount: message.totalChunkCount,
      endpoint: message.endpoint.trim(),
      transferToken: message.transferToken.trim(),
      unityVersion: descriptor.unityVersion,
      teamForgePackageVersion: descriptor.teamForgePackageVersion,
      realtimeProtocolVersion: descriptor.realtimeProtocolVersion,
      transferProtocolVersion: descriptor.transferProtocolVersion,
      manifestSchemaVersion: descriptor.manifestSchemaVersion,
      ownerKeyId: descriptor.ownerKeyId,
      ownerPublicKey: descriptor.ownerPublicKey,
      publisherKeyId: descriptor.publisherKeyId,
      publisherPublicKey: descriptor.publisherPublicKey,
      publisherAuthorization: descriptor.publisherAuthorization,
      baselineSignature: descriptor.baselineSignature,
      ownerProofSignature: message.ownerProofSignature.trim(),
      ownerProofVerified: proof.verified,
      descriptorVerified: true,
      seedRank: 99,
      observedLatencyMilliseconds: 0,
      announcedAtUnixMs: previous?.announcedAtUnixMs ?? timestamp,
      lastUpdatedUnixMs: timestamp,
    };
    peer.seedRank = calculateSeedRank(peer, project.baseline, project.bootstrapPublisherConnectionId);
    active.record.peer = peer;

    const effects = [];
    if (recoveredBaseline) {
      effects.push(...this.#globalBroadcast(
        connection.projectId,
        baselineChangedMessage(project, message.requestId, false, timestamp),
      ));
    }
    effects.push(broadcast(
      active.session,
      projectPeerEvent(previous ? "project_peer_updated" : "project_peer_joined", peer, message.requestId, timestamp),
    ));
    const syncEffect = this.#syncRequiredEffect(
      active.record,
      projectSyncReason(peer, project.baseline),
      message.requestId,
      timestamp,
    );
    if (syncEffect) effects.push(syncEffect);
    return { effects };
  }

  #handleBaselinePublish(connection, message, timestamp) {
    const precondition = this.#precondition(connection, message.requestId);
    if (precondition) return precondition;
    const checked = this.#validateAndVerify(connection, message, "project_baseline_publish");
    if (checked.error) return { effects: [send(connection.connectionId, checked.error)] };
    const descriptor = checked.verified.descriptor;
    if (!descriptorIsCompatible(descriptor)) {
      return { effects: [send(connection.connectionId, errorMessage(
        "incompatible_project_descriptor",
        "The published Baseline is not compatible with this Coordinator version.",
        message.requestId,
      ))] };
    }

    let project = this.projects.get(connection.projectId);
    if (!project) {
      if (descriptor.baselineRevision !== 1) {
        return { effects: [send(connection.connectionId, errorMessage(
          "baseline_revision_gap",
          "The first explicit Baseline must use revision 1.",
          message.requestId,
        ))] };
      }
      if (this.projects.size >= this.config.maxProjectRegistries) {
        return { effects: [send(connection.connectionId, errorMessage(
          "project_registry_limit",
          "The global Project registry safety limit was reached.",
          message.requestId,
        ))] };
      }
      project = this.#createProject(connection, descriptor, timestamp, connection.connectionId);
      return {
        effects: [
          ...this.#globalBroadcast(
            connection.projectId,
            baselineChangedMessage(project, message.requestId, false, timestamp),
          ),
          ...this.#recalculateProjectPeers(connection.projectId, true, timestamp),
          ...this.#syncRequirementEffects(connection.projectId, timestamp),
        ],
      };
    }

    const current = project.baseline;
    if (descriptor.baselineRevision === current.baselineRevision) {
      return descriptorMatchesBaseline(descriptor, current)
        ? { effects: [send(
          connection.connectionId,
          baselineChangedMessage(project, message.requestId, true, timestamp),
        )] }
        : { effects: [send(connection.connectionId, errorMessage(
          "baseline_revision_conflict",
          "This Baseline revision is already bound to different Descriptor metadata.",
          message.requestId,
        ))] };
    }
    if (descriptor.baselineRevision < current.baselineRevision) {
      return { effects: [send(connection.connectionId, errorMessage(
        "baseline_downgrade",
        "Publishing an older Baseline revision is not allowed.",
        message.requestId,
      ))] };
    }
    if (descriptor.baselineRevision !== current.baselineRevision + 1) {
      return { effects: [send(connection.connectionId, errorMessage(
        "baseline_revision_gap",
        "A new Baseline must use exactly the next revision.",
        message.requestId,
      ))] };
    }

    project.baseline = baselineFromDescriptor(descriptor, connection, timestamp);
    project.bootstrapPublisherConnectionId = "";
    return {
      effects: [
        ...this.#globalBroadcast(
          connection.projectId,
          baselineChangedMessage(project, message.requestId, false, timestamp),
        ),
        ...this.#recalculateProjectPeers(connection.projectId, true, timestamp),
        ...this.#syncRequirementEffects(connection.projectId, timestamp),
      ],
    };
  }

  countMembers(announcedOnly = false) {
    let count = 0;
    for (const session of this.sessions.values()) {
      for (const member of session.members.values()) {
        if (!announcedOnly || member.peer) count += 1;
      }
    }
    return count;
  }

  clear() {
    this.sessions.clear();
    this.projects.clear();
  }
}

export function createProjectCoordinatorCore(config) {
  return new ProjectCoordinatorCore(config);
}
