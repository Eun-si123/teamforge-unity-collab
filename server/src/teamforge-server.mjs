import { ComponentCollaboration } from "./component-collaboration.mjs";
import { createServer } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { configFromEnv } from "./config.mjs";
import { DurableSessionRuntime } from "./durable-session-runtime.mjs";
import { inspectSignedProjectTransition } from "./project-transition-preflight.mjs";
import { ProjectTransitionQuiescence } from "./project-transition-quiescence.mjs";
import { ProjectTransitionPublisherProof } from "./project-transition-publisher-proof.mjs";
import { inspectPausedSignedSources } from "./project-transition-paused-source-preflight.mjs";
import {
  PROTOCOL_VERSION,
  SERVER_VERSION,
  deterministicColor,
  errorMessage,
  validateEnvelope,
  validateHtmlColor,
  validateText,
} from "./protocol.mjs";
import {
  COORDINATOR_EFFECTS,
  createProjectCoordinatorCore,
} from "./project-coordinator-core.mjs";
import {
  AUTHORITY_EFFECTS,
  createSessionAuthority,
  makeSessionKey,
} from "./session-authority.mjs";
import { assertEditorReceivableBudgets } from "./policy-profile.mjs";
import { inspectCurrentSignedProjectForRecoveryPreview }
  from "./component-recovery-project-gate.mjs";
import {
  issueComponentSourceChallenge,
  consumeComponentSourceChallenge,
} from "./component-source-challenge.mjs";

const NOOP_LOGGER = Object.freeze({
  info() {},
  warn() {},
  error() {},
});
const MAX_BUFFERED_BYTES = Symbol("teamForgeMaxBufferedBytes");
const CLIENT_STATE = Symbol("teamForgeClientState");
const DURABLE_REALTIME_WRITES = new Set(["hierarchy_seed", "hierarchy_operation", "transform_update"]);
// Requests that would change shared realtime state or acquire edit authority.
// lock_release, snapshots and reports stay allowed so an outdated Editor can
// always let go of its locks and recover.
const REALTIME_MUTATION_TYPES = new Set(["hierarchy_seed", "hierarchy_operation", "transform_update", "lock_request",
  "component_property_set", "component_structure_set"]);
const DURABLE_EPOCH_COMMANDS = new Set([...DURABLE_REALTIME_WRITES, "lock_request", "lock_release", "component_scene_join"]);
const CLIENT_ROLE = Object.freeze({
  PENDING: "pending/unidentified",
  UNITY_EDITOR: "Unity Editor realtime",
  REALTIME: "Realtime collaboration client",
  PROJECT_TRANSFER: "Project Transfer client",
  PROJECT_TRANSFER_OBSERVER: "Project Transfer observer",
  PROJECT_PEER: "Project Peer / Seed",
  PROTOCOL: "Protocol client",
});

function classifyAcceptedHello(state) {
  if (state.supportsPresence && state.supportsTransformSync && state.supportsHierarchySync) {
    return CLIENT_ROLE.UNITY_EDITOR;
  }
  if (state.supportsPresence) {
    return CLIENT_ROLE.REALTIME;
  }
  if (state.supportsProjectTransfer) {
    return CLIENT_ROLE.PROJECT_TRANSFER;
  }
  return CLIENT_ROLE.PROTOCOL;
}

function disconnectedClientRole(state) {
  if (!state.helloAccepted) return CLIENT_ROLE.PENDING;
  if (state.clientRole === CLIENT_ROLE.PROJECT_TRANSFER) {
    return CLIENT_ROLE.PROJECT_TRANSFER_OBSERVER;
  }
  return state.clientRole || CLIENT_ROLE.PROTOCOL;
}

function requestPath(request) {
  try {
    return new URL(request.url ?? "/", "http://teamforge.invalid").pathname;
  } catch {
    return "";
  }
}

function writeJson(response, statusCode, body) {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(payload);
}

function rejectUpgrade(socket, statusCode, reason) {
  const body = JSON.stringify({ error: reason });
  socket.write(
    `HTTP/1.1 ${statusCode} ${reason}\r\n` +
      "Connection: close\r\n" +
      "Content-Type: application/json; charset=utf-8\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n` +
      body,
  );
  socket.destroy();
}

function hasValidBearerToken(request, expectedToken) {
  if (!expectedToken) {
    return true;
  }

  const header = request.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    return false;
  }

  const supplied = Buffer.from(header.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

// Keep malformed client correlation IDs out of all outbound responses, including
// bounded authority snapshots, without changing the incoming validation result.
function serializeOutboundMessage(message) {
  if (typeof message === "string") return message;
  const requestId = message?.requestId;
  if (requestId !== undefined && (
    typeof requestId !== "string" || requestId.length > 128 ||
    /[\u0000-\u001f\u007f]/.test(requestId) ||
    validateText(requestId, "requestId", 128) !== null
  )) {
    return JSON.stringify({ ...message, requestId: "" });
  }
  return JSON.stringify(message);
}

function safeSend(socket, message) {
  if (socket.readyState !== WebSocket.OPEN) {
    return false;
  }

  const maximumBufferedBytes = socket[MAX_BUFFERED_BYTES] ?? Number.MAX_SAFE_INTEGER;
  if (socket.bufferedAmount > maximumBufferedBytes) {
    socket.terminate();
    return false;
  }

  try {
    socket.send(serializeOutboundMessage(message));
    return true;
  } catch {
    socket.terminate();
    return false;
  }
}

function closeWithProtocolError(socket, code, message, requestId = "") {
  safeSend(socket, errorMessage(code, message, requestId));
  socket.close(1002, code.slice(0, 120));
}

function countMembers(sessions) {
  let count = 0;
  for (const session of sessions.values()) {
    count += session.members.size;
  }
  return count;
}

function countSessionMapEntries(sessions, field) {
  let count = 0;
  for (const session of sessions.values()) {
    count += session[field].size;
  }
  return count;
}

function aggregateSessionCount(authoritySessions, coordinatorSessions) {
  return new Set([...authoritySessions.keys(), ...coordinatorSessions.keys()]).size;
}

export function createTeamForgeServer(options = {}) {
  const config = { ...configFromEnv({}), ...options };
  const logger = options.logger ?? NOOP_LOGGER;
  const lifecycleInstanceId = typeof options.lifecycleInstanceId === "string"
    ? options.lifecycleInstanceId
    : "";
  // Explicitly application-only opt-in; no environment variable or
  // package default can silently expose the experimental read-only path.
  const enableComponentRecoveryPreview = options.enableComponentRecoveryPreview === true;
  const enableComponentPropertySync = config.enableComponentPropertySync === true &&
    typeof config.componentProjectManagedRoot === "string" && config.componentProjectManagedRoot.trim() !== "";
  const enableComponentStructureSync = config.enableComponentStructureSync === true;
  if (enableComponentStructureSync && !enableComponentPropertySync)
    throw new Error("Component structure synchronization requires explicit property synchronization and its managed root.");
  const enablePrimitiveTemplateSync = config.enablePrimitiveTemplateSync === true;
  if (enablePrimitiveTemplateSync && (!enableComponentPropertySync || !enableComponentStructureSync))
    throw new Error("Primitive template synchronization requires Component property/structure synchronization and its managed root.");
  const componentProjectManagedRoot = config.componentProjectManagedRoot;
  const durableSessionDatabasePath = config.durableSessionDatabasePath;
  if (durableSessionDatabasePath && (typeof componentProjectManagedRoot !== "string" || !componentProjectManagedRoot.trim()))
    throw new Error("Durable Sessions require an approved managed Project store.");
  delete config.enableComponentPropertySync;
  delete config.enableComponentStructureSync;
  delete config.enablePrimitiveTemplateSync;
  delete config.componentProjectManagedRoot;
  delete config.durableSessionDatabasePath;
  delete config.logger;
  delete config.lifecycleInstanceId;
  delete config.enableComponentRecoveryPreview;

  assertEditorReceivableBudgets(config);
  if (config.wsPath === config.healthPath) {
    throw new Error("WebSocket and health paths must be different.");
  }
  if (config.maxLocksPerConnection > config.maxLocksPerSession) {
    throw new Error("maxLocksPerConnection cannot exceed maxLocksPerSession.");
  }
  if (config.heartbeatTimeoutMilliseconds <= config.heartbeatIntervalMilliseconds) {
    throw new Error("heartbeatTimeoutMilliseconds must exceed heartbeatIntervalMilliseconds.");
  }

  const clients = new Set();
  const clientsByConnectionId = new Map();
  const authority = createSessionAuthority(config);
  const sessions = authority.sessions;
  const coordinator = createProjectCoordinatorCore(config);
  const projectSessions = coordinator.sessions;
  const projects = coordinator.projects;
  const componentCollaboration = enableComponentPropertySync ? new ComponentCollaboration({
    coordinator, authority, managedRoot: componentProjectManagedRoot,
    maximumBytes: config.maxMessageBytes, maximumOperations: config.maxRecentOperations, enableStructure:enableComponentStructureSync, enablePrimitives:enablePrimitiveTemplateSync,
  }) : null;
  if (componentCollaboration) componentCollaboration.connections = clientsByConnectionId;
  if (enablePrimitiveTemplateSync) authority.primitiveLifecycle = {
    context:(...args)=>componentCollaboration.primitiveContext(...args),
    prepare:(...args)=>componentCollaboration.prepareHierarchyTopology(...args),
    replay:(...args)=>componentCollaboration.replayHierarchyTopology(...args),
  };
  const startedAt = Date.now();
  let lockSweepTimer = null;
  let connectionSweepTimer = null;
  let stopping = false;
  let startPromise = null;
  let stopPromise = null;
  let durable = null;
  let durableFaulted = false;
  // Only one read-only M5 transition scan may load managed signed Manifests
  // per Coordinator at a time. This is not a publication lock.
  const activeTransitionPreviews = new Set();
  const activePausedSourceAudits = new Set();
  // Ephemeral source observations, not recovery or Publisher authority.
  // Keyed by the exact online pause; never written to SQLite or Guest Active.
  const onlineSourceObservations = new Map();
  const projectQuiescence = new ProjectTransitionQuiescence();
  const publisherProofs = new ProjectTransitionPublisherProof(projectQuiescence);

  function faultDurableStorage(error) {
    if (durableFaulted) return;
    durableFaulted = true;
    logger.error("Durable Session checkpoint failed. Realtime editing stopped before publishing the result (" +
      (typeof error?.code === "string" ? error.code : "checkpoint_failed") + ").");
    for (const socket of clients) {
      safeSend(socket,errorMessage("durable_storage_unavailable", "The confirmed Session was retained on disk. Restart the Coordinator after checking its storage."));
      socket.close(1011,"durable_storage_unavailable");
    }
  }

  function persistDurableResult(connection, session, operationId = null, response = null) {
    try {
      if (durableFaulted || !durable || !session) throw new Error("Durable storage is unavailable.");
      let operation = null;
      if (operationId !== null) {
        const entry = session.operations.get(operationId);
        if (!entry) throw new Error("An accepted operation is missing its authoritative result and fingerprint.");
        operation = {operationId,userId:connection.userId,fingerprint:entry.fingerprint,result:response ?? entry.applied};
      }
      durable.commit(connection,session,operation);
      return true;
    } catch (error) {
      faultDurableStorage(error);
      return false;
    }
  }

  // Per-connection causal order in durable mode (#673). A message that waits
  // on asynchronous durable admission must not be overtaken by a later,
  // otherwise synchronous message from the same connection (for example a
  // lock_release after a transform_update). Other connections never wait.
  function chainInConnectionOrder(connection, task) {
    const tail = (connection.durableOrderTail ?? Promise.resolve()).then(task).catch(error => {
      logger.error(`Ordered durable request failed (${typeof error?.code === "string" ? error.code : "unexpected"}).`);
    });
    connection.durableOrderTail = tail;
    tail.finally(() => { if (connection.durableOrderTail === tail) connection.durableOrderTail = null; });
  }

  function inConnectionOrder(socket, connection, message, task) {
    if (!durable || !connection.durableOrderTail) {
      task();
      return;
    }
    // A queued lock or component command is still outstanding work, even
    // after the signed Scene admission ahead of it has released its fence.
    // Count it at enqueue time, so a trusted transition caller cannot
    // freeze between the two promises and admit a stale mutation afterward.
    const release = projectQuiescence.beginSourceAdmission(connection.projectId);
    if (!release) {
      safeSend(socket,errorMessage("project_transition_paused",
        "Project editing is paused for a signed Baseline transition.",message.requestId ?? ""));
      return;
    }
    chainInConnectionOrder(connection, async () => {
      try {
        if (durableFaulted || stopping || socket.readyState !== WebSocket.OPEN ||
            !authority.activeSession(connection)) return;
        await task();
      } finally {
        release();
      }
    });
  }

  function withDurableSource(socket, connection, message, dispatch) {
    const release = projectQuiescence.beginSourceAdmission(connection.projectId);
    if (!release) {
      safeSend(socket,errorMessage("project_transition_paused",
        "Project editing is paused for a signed Baseline transition.",message.requestId ?? ""));
      return;
    }
    if (!durable) {
      try {
        // In normal/legacy sessions, the source guard is synchronous unless
        // a signed component join returns an async admission Promise.
        Promise.resolve(dispatch()).catch(error => {
          logger.error("Project admission failed: " + (error?.code ?? "unavailable"));
        }).finally(release);
      } catch (error) {release();throw error;}
      return;
    }
    const admit = approved => {
      if (durableFaulted || stopping || socket.readyState !== WebSocket.OPEN || !authority.activeSession(connection)) return;
      if (coordinator.projects.get(connection.projectId)?.baseline?.descriptorHash !== approved.descriptorHash) {
        safeSend(socket,errorMessage("durable_source_required","The current approved Project changed. Reconnect to recover its state.",message.requestId ?? ""));
        return;
      }
      return dispatch();
    };
    const refuse = () => {
      if (socket.readyState === WebSocket.OPEN)
        safeSend(socket,errorMessage("durable_source_required","Wait for the Host to approve the managed signed Project publication, then retry.",message.requestId ?? ""));
    };
    // Keep the transition admission held through signed Scene IO and
    // retain same-connection causal order (#673). Cached synchronous edits
    // do not create a queue; async admission holds both fences until settled.
    const settle = pending => Promise.resolve(pending).catch(error => faultDurableStorage(error)).finally(release);
    const cached = durable.approvedFor(connection.projectId, coordinator.projects.get(connection.projectId)?.baseline);
    if (cached && !connection.durableOrderTail) {
      let pending;
      try { pending = admit(cached); }
      catch (error) { try { faultDurableStorage(error); } finally { release(); } return; }
      const settled = settle(pending);
      if (typeof pending?.then === "function")
        chainInConnectionOrder(connection, () => settled);
      return;
    }
    // Read the baseline on this request's turn, and release even if the
    // admission implementation throws synchronously before returning a Promise.
    chainInConnectionOrder(connection, () => settle(Promise.resolve().then(() =>
      durable.approveProject(connection.projectId,
        coordinator.projects.get(connection.projectId)?.baseline)).then(admit, refuse)));
  }

  function identifyClientRole(state, role) {
    if (state.clientRole === role) return;
    state.clientRole = role;
    logger.info(`WebSocket identified (${state.connectionId}) [${role}].`);
  }

  function executeAuthorityEffects(effects) {
    for (const effect of effects) {
      if (effect.type === AUTHORITY_EFFECTS.SEND) {
        const target = clientsByConnectionId.get(effect.connectionId);
        if (target) {
          safeSend(target.socket, effect.message);
        }
        continue;
      }
      if (effect.type === AUTHORITY_EFFECTS.BROADCAST) {
        for (const connectionId of effect.connectionIds) {
          const target = clientsByConnectionId.get(connectionId);
          if (target) {
            safeSend(target.socket, effect.message);
          }
        }
        continue;
      }
      if (effect.type === AUTHORITY_EFFECTS.CLOSE) {
        clientsByConnectionId.get(effect.connectionId)?.socket.close(effect.code, effect.reason);
        continue;
      }
      if (effect.type === AUTHORITY_EFFECTS.CONNECTION_SUPERSEDED) {
        const target = clientsByConnectionId.get(effect.connectionId);
        if (target) {
          removeProjectClient(target.state, effect.reason);
        }
        continue;
      }
      if (effect.type === AUTHORITY_EFFECTS.SEND_BOUNDED) {
        const target = clientsByConnectionId.get(effect.connectionId);
        if (!target) {
          continue;
        }
        const payload = serializeOutboundMessage(effect.message);
        if (Buffer.byteLength(payload) > effect.maximumBytes) {
          safeSend(target.socket, effect.error);
          target.socket.close(effect.closeCode, effect.closeReason);
        } else {
          safeSend(target.socket, payload);
        }
        continue;
      }
      throw new TypeError(`Unsupported Session Authority effect: ${effect.type}`);
    }
  }

  function executeAuthorityCommand(command) {
    const session = durable && DURABLE_REALTIME_WRITES.has(command.type) ? authority.activeSession(command.connection)?.session : null;
    if (session && !durableFaulted) {
      let admitted;
      try { admitted = durable.canAdmit(command.connection); }
      catch (error) { faultDurableStorage(error); return {effects:[]}; }
      if (!admitted) {
        // Refuse this new Session's first durable write before any in-memory
        // mutation. Established Sessions keep editing (#670).
        const target = clientsByConnectionId.get(command.connection.connectionId);
        if (target) safeSend(target.socket, errorMessage("durable_session_capacity",
          "The Coordinator's durable Session capacity is full. Existing Sessions are unaffected; free retained Sessions, then retry.",
          command.message?.requestId ?? ""));
        return {effects:[]};
      }
    }
    const revisionBefore = session?.revision;
    const result = authority.dispatch(command);
    if (session && (session.revision !== revisionBefore || result.effects.some(effect =>
        effect.message?.type === "hierarchy_seed_accepted" && !effect.message.idempotent))) {
      const operationId = session.revision !== revisionBefore ? command.message.operationId.trim() : null;
      if (!persistDurableResult(command.connection,session,operationId)) return {effects:[]};
    }
    executeAuthorityEffects(result.effects);
    return result;
  }

  function executeCoordinatorEffects(effects) {
    for (const effect of effects) {
      if (effect.type === COORDINATOR_EFFECTS.SEND) {
        const target = clientsByConnectionId.get(effect.connectionId);
        if (target) safeSend(target.socket, effect.message);
        continue;
      }
      if (effect.type === COORDINATOR_EFFECTS.BROADCAST) {
        for (const connectionId of effect.connectionIds) {
          const target = clientsByConnectionId.get(connectionId);
          if (target) safeSend(target.socket, effect.message);
        }
        continue;
      }
      if (effect.type === COORDINATOR_EFFECTS.CLOSE) {
        clientsByConnectionId.get(effect.connectionId)?.socket.close(effect.code, effect.reason);
        continue;
      }
      if (effect.type === COORDINATOR_EFFECTS.SEND_BOUNDED) {
        const target = clientsByConnectionId.get(effect.connectionId);
        if (!target) continue;
        const payload = serializeOutboundMessage(effect.message);
        if (Buffer.byteLength(payload) > effect.maximumBytes) {
          safeSend(target.socket, effect.error);
          target.socket.close(effect.closeCode, effect.closeReason);
        } else {
          safeSend(target.socket, payload);
        }
        continue;
      }
      throw new TypeError(`Unsupported Project Coordinator effect: ${effect.type}`);
    }
  }

  function executeCoordinatorCommand(command) {
    const result = coordinator.dispatch(command);
    for (const connectionId of result.removedConnectionIds ?? []) {
      const target = clientsByConnectionId.get(connectionId);
      if (target) target.state.projectClientRegistered = false;
    }
    executeCoordinatorEffects(result.effects);
    return result;
  }

  function projectRegistrationCapacityError(state) {
    return coordinator.registrationCapacityError(state);
  }

  function registerProjectClient(state) {
    const result = executeCoordinatorCommand({
      type: "register_client",
      connection: state,
      nowUnixMs: Date.now(),
      broadcast: !stopping,
    });
    return result.error;
  }

  function sendProjectSnapshot(state, requestId) {
    executeCoordinatorCommand({
      type: "send_snapshot",
      connection: state,
      requestId,
      nowUnixMs: Date.now(),
    });
  }

  function removeProjectClient(state, reason = "connection_closed") {
    if (!state.projectClientRegistered) return;
    executeCoordinatorCommand({
      type: "remove_client",
      connectionId: state.connectionId,
      reason,
      nowUnixMs: Date.now(),
      broadcast: !stopping,
    });
    state.projectClientRegistered = false;
  }

  function handleProjectPeerAnnounce(_socket, state, message) {
    const result = executeCoordinatorCommand({
      type: "peer_announce",
      connection: state,
      message,
      nowUnixMs: Date.now(),
    });
    if (!result.error) {
      identifyClientRole(state, CLIENT_ROLE.PROJECT_PEER);
    }
  }

  function handleProjectBaselinePublish(socket, state, message) {
    const previous = durable?.approvedProjects.get(state.projectId);
    if (previous && message.descriptorHash !== previous.descriptorHash) {
      safeSend(socket,errorMessage("durable_checkpoint_required","Changing the signed Project requires a durable Project checkpoint transition.",message.requestId ?? ""));
      return;
    }
    const transition = componentCollaboration?.inspectBaselinePublication(state,message);
    if (transition) {
      safeSend(socket,errorMessage(transition.error,transition.reason,message.requestId ?? ""));
      return;
    }
    executeCoordinatorCommand({
      type: "baseline_publish",
      connection: state,
      message,
      nowUnixMs: Date.now(),
    });
  }
  async function handleProjectTransitionPreview(socket, state, message) {
    const requestId = validateText(message.requestId, "requestId", 128) === null
      ? message.requestId : "";
    if (!durable || durableFaulted || stopping || !componentCollaboration) {
      safeSend(socket, errorMessage("project_transition_unavailable",
        "An active M4 durable Coordinator is required to inspect a Project transition.", requestId));
      return;
    }
    if (activeTransitionPreviews.size >= 4 || activeTransitionPreviews.has(state.projectId)) {
      safeSend(socket, errorMessage("project_transition_busy",
        "A signed Project transition review is already underway. Retry after it finishes.", requestId));
      return;
    }
    activeTransitionPreviews.add(state.projectId);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    socket.once("close", cancel);
    try {
      const result = await inspectSignedProjectTransition({
        coordinator, authority, durable, components: componentCollaboration,
        managedRoot: componentProjectManagedRoot, connection: state, message,
        signal:controller.signal,
      });
      if (stopping || durableFaulted || socket.readyState !== WebSocket.OPEN) return;
      if (result.error) {
        safeSend(socket, errorMessage(result.error, result.reason, requestId));
        return;
      }
      if (Buffer.byteLength(JSON.stringify(result), "utf8") > config.maxMessageBytes) {
        safeSend(socket, errorMessage("project_transition_response_limit",
          "Signed Project transition preview exceeds the bounded response limit.", requestId));
        return;
      }
      safeSend(socket, result);
    } catch {
      // File paths, signatures and storage internals are never echoed to peers.
      if (socket.readyState === WebSocket.OPEN)
        safeSend(socket, errorMessage("project_transition_unavailable",
          "The exact signed Project transition could not be inspected.", requestId));
    } finally {
      socket.off("close", cancel);
      activeTransitionPreviews.delete(state.projectId);
    }
  }

  function notifyProjectPauseCancelled(projectId,pauseId) {
    const source = onlineSourceObservations.get(projectId);
    if (source?.pauseId===pauseId) {
      publisherProofs.revoke(source.ticket);
      onlineSourceObservations.delete(projectId);
    }
    for (const socket of clients) {
      const state=socket[CLIENT_STATE];
      if (state?.helloAccepted && state.projectId===projectId && state.supportsProjectEditPause)
        safeSend(socket,{type:"project_edit_pause_cancelled",protocolVersion:PROTOCOL_VERSION,
          requestId:"",pauseId});
    }
  }

  function currentOnlinePause(projectId,pauseId) {
    const status=projectQuiescence.onlineStatus(projectId,pauseId);
    if (status?.expired) {
      notifyProjectPauseCancelled(projectId,pauseId);
      return null;
    }
    return status;
  }

  function handleProjectEditPauseAck(socket,state,message) {
    const fields=["type","protocolVersion","requestId","pauseId","status",
      "serverRevision","authorityEpoch","durableSessionId"];
    const requestId=validateText(message.requestId,"requestId",128)===null
      ? message.requestId : "";
    if (!state.supportsProjectEditPause || Object.keys(message).length!==fields.length ||
        Object.keys(message).some(key=>!fields.includes(key)) ||
        validateText(message.pauseId,"pauseId",64)!==null ||
        !Number.isSafeInteger(message.serverRevision) || message.serverRevision<0 ||
        !["ready","busy"].includes(message.status)) {
      safeSend(socket,errorMessage("project_transition_pause_invalid_ack",
        "Project edit pause acknowledgements require the exact negotiated fields.",requestId));
      return;
    }
    const pauseId=message.pauseId;
    const status=currentOnlinePause(state.projectId,pauseId);
    if (!status) {
      safeSend(socket,errorMessage("project_transition_pause_stale",
        "No current Project edit pause matches this request.",requestId));
      return;
    }
    const actual=authority.activeSession(state)?.session;
    // The authenticated connection must still point to the EXACT same
    // durable Session cursor; malicious or stale ACKs cannot promote a pause.
    if (!actual || actual.revision!==message.serverRevision ||
        actual.durableEpoch!==message.authorityEpoch ||
        durable?.lineageFor(actual)!==message.durableSessionId) {
      projectQuiescence.cancelOnlinePause(state.projectId,pauseId);
      notifyProjectPauseCancelled(state.projectId,pauseId);
      safeSend(socket,errorMessage("project_transition_editor_stale",
        "Project Session cursor changed during the pause request.",requestId));
      return;
    }
    const result=projectQuiescence.acknowledgeOnlinePause({projectId:state.projectId,
      connectionId:state.connectionId,pauseId,status:message.status,
      serverRevision:message.serverRevision,authorityEpoch:message.authorityEpoch,
      durableSessionId:message.durableSessionId});
    if(result.aborted) {
      notifyProjectPauseCancelled(state.projectId,pauseId);
      safeSend(socket,errorMessage(result.error,
        "An Editor cannot confirm a safe pause. All Editors may continue the original M4 session.",requestId));
      return;
    }
    if(result.error) {
      safeSend(socket,errorMessage(result.error,"Pause acknowledgement rejected.",requestId));
      return;
    }
    safeSend(socket,{type:"project_edit_pause_acknowledged",protocolVersion:PROTOCOL_VERSION,
      requestId,pauseId,confirmedCount:result.confirmedCount,
      expectedCount:result.expectedCount,allEditorsReportedReady:result.ready,
      commitPermitted:false});
  }

  function sweepExpiredLocks() {
    if (stopping) {
      return;
    }
    executeAuthorityCommand({ type: "expire_locks", nowUnixMs: Date.now() });
  }

  function sweepConnections() {
    if (stopping) {
      return;
    }

    const now = Date.now();
    for (const expired of projectQuiescence.expiredOnlinePauses(now))
      notifyProjectPauseCancelled(expired.projectId,expired.pauseId);
    for (const socket of clients) {
      const state = socket[CLIENT_STATE];
      if (!state) {
        socket.terminate();
        continue;
      }
      if (!state.helloAccepted && now >= state.helloDeadlineAt) {
        socket.terminate();
        continue;
      }
      if (state.helloAccepted && now - state.lastPongAt >= config.heartbeatTimeoutMilliseconds) {
        socket.terminate();
        continue;
      }
      if (now >= state.nextHeartbeatAt && socket.readyState === WebSocket.OPEN) {
        state.nextHeartbeatAt = now + config.heartbeatIntervalMilliseconds;
        try {
          socket.ping();
        } catch {
          socket.terminate();
        }
      }
    }
  }

  function handleHierarchySeed(socket, state, message) {
    withDurableSource(socket,state,message,() => executeAuthorityCommand({
      type: "hierarchy_seed",
      connection: state,
      message,
      nowUnixMs: Date.now(),
    }));
  }


  function handleHierarchyOperation(socket, state, message) {
    withDurableSource(socket,state,message,() => executeAuthorityCommand({
      type: "hierarchy_operation",
      connection: state,
      message,
      nowUnixMs: Date.now(),
    }));
  }


  function registerPresence(_socket, state, helloRequestId) {
    const result = authority.dispatch({
      type: "register_presence",
      connection: state,
      requestId: helloRequestId,
      nowUnixMs: Date.now(),
    });
    state.sessionKey = result.sessionKey;
    executeAuthorityEffects(result.effects);
  }


  function removePresence(_socket, state) {
    executeAuthorityCommand({
      type: "remove_presence",
      connection: state,
      nowUnixMs: Date.now(),
      broadcast: !stopping,
    });
  }


  function handleLockRequest(socket, state, message) {
    inConnectionOrder(socket, state, message, () => executeAuthorityCommand({
      type: "lock_request",
      connection: state,
      message,
      nowUnixMs: Date.now(),
    }));
  }


  function handleLockRelease(socket, state, message) {
    inConnectionOrder(socket, state, message, () => executeAuthorityCommand({
      type: "lock_release",
      connection: state,
      message,
      nowUnixMs: Date.now(),
    }));
  }


  function handleTransformUpdate(socket, state, message) {
    withDurableSource(socket,state,message,() => executeAuthorityCommand({
      type: "transform_update",
      connection: state,
      message,
      nowUnixMs: Date.now(),
    }));
  }


  const httpServer = createServer((request, response) => {
    if (request.method === "GET" && requestPath(request) === config.healthPath) {
      if (durableFaulted) { writeJson(response,503,{error:"durable_storage_unavailable"}); return; }
      writeJson(response, 200, {
        status: "ok",
        service: "unity-teamforge-server",
        serverVersion: SERVER_VERSION,
        protocolVersion: PROTOCOL_VERSION,
        healthPath: config.healthPath,
        wsPath: config.wsPath,
        authenticationRequired: Boolean(config.authToken),
        lifecycleInstanceId: lifecycleInstanceId || null,
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1_000),
        connections: clients.size,
        sessions: aggregateSessionCount(sessions, projectSessions),
        presenceMembers: countMembers(sessions),
        activeLocks: countSessionMapEntries(sessions, "locks"),
        retainedTransforms: countSessionMapEntries(sessions, "transforms"),
        hierarchyObjects: countSessionMapEntries(sessions, "hierarchyObjects"),
        hierarchyTombstones: countSessionMapEntries(sessions, "hierarchyTombstones"),
        hierarchyScenes: Array.from(sessions.values()).reduce(
          (count, session) => count + (session.hierarchySceneIds?.size ?? 0),
          0,
        ),
        projectRegistries: projects.size,
        projectBaselines: Array.from(projects.values()).filter((project) => project.baseline).length,
        projectSessions: projectSessions.size,
        projectClients: coordinator.countMembers(),
        projectPeers: coordinator.countMembers(true),
      });
      return;
    }

    writeJson(response, 404, { error: "not_found" });
  });

  const webSocketServer = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    maxPayload: config.maxMessageBytes,
    perMessageDeflate: false,
  });

  httpServer.on("upgrade", (request, socket, head) => {
    if (requestPath(request) !== config.wsPath) {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }
    if (!hasValidBearerToken(request, config.authToken)) {
      rejectUpgrade(socket, 401, "Unauthorized");
      return;
    }
    if (clients.size >= config.maxConnections) {
      rejectUpgrade(socket, 503, "Service Unavailable");
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit("connection", webSocket, request);
    });
  });

  webSocketServer.on("connection", (socket) => {
    const connectedAt = Date.now();
    const state = {
      connectionId: randomUUID(),
      helloAccepted: false,
      clientRole: CLIENT_ROLE.PENDING,
      supportsPresence: false,
      supportsTransformSync: false,
      supportsHierarchySync: false,
      supportsHierarchyRenameRecovery: false,
      supportsHierarchyReparentRecovery: false,
      supportsHierarchySiblingRecovery: false,
      supportsComponentRecoveryPreview: false,
      supportsComponentPropertySync: false,
      supportsComponentStructureSync: false,
      supportsPrimitiveTemplateSync: false,
      supportsProjectTransfer: false,
      projectClientRegistered: false,
      userId: "",
      userColor: "",
      userName: "",
      projectId: "",
      sessionId: "",
      sessionKey: "",
      rateWindowStartedAt: connectedAt,
      messagesInWindow: 0,
      helloDeadlineAt: connectedAt + config.helloTimeoutMilliseconds,
      lastPongAt: connectedAt,
      nextHeartbeatAt: connectedAt + config.heartbeatIntervalMilliseconds,
    };

    socket[MAX_BUFFERED_BYTES] = config.maxBufferedBytes;
    socket[CLIENT_STATE] = state;
    clients.add(socket);
    clientsByConnectionId.set(state.connectionId, { socket, state });
    logger.info(`WebSocket connected (${state.connectionId}) [pending hello].`);

    socket.on("message", (data, isBinary) => {
      if (durableFaulted) {
        socket.close(1011,"durable_storage_unavailable");
        return;
      }
      const now = Date.now();
      if (now - state.rateWindowStartedAt >= 1_000) {
        state.rateWindowStartedAt = now;
        state.messagesInWindow = 0;
      }
      state.messagesInWindow += 1;
      if (state.messagesInWindow > config.rateLimitPerSecond) {
        safeSend(socket, errorMessage("rate_limited", "Message rate limit exceeded."));
        socket.close(1008, "rate_limited");
        return;
      }

      if (isBinary) {
        closeWithProtocolError(socket, "binary_not_supported", "Only UTF-8 JSON messages are supported.");
        return;
      }

      let message;
      try {
        message = JSON.parse(data.toString("utf8"));
      } catch {
        closeWithProtocolError(socket, "invalid_json", "Message is not valid JSON.");
        return;
      }

      const envelopeError = validateEnvelope(message);
      if (envelopeError) {
        closeWithProtocolError(socket, "invalid_envelope", envelopeError, message?.requestId ?? "");
        return;
      }

      if (!state.helloAccepted && message.type !== "hello") {
        safeSend(
          socket,
          errorMessage("hello_required", "A valid hello message must be sent first.", message.requestId ?? ""),
        );
        return;
      }

      if (message.type === "hello") {
        if (projectQuiescence.isFrozen(message.projectId)) {
          safeSend(socket,errorMessage("project_transition_paused",
            "This Project is temporarily quiesced for a signed Baseline transition.",message.requestId ?? ""));
          return;
        }
        if (state.helloAccepted) {
          safeSend(socket, errorMessage("hello_already_received", "Hello was already accepted.", message.requestId ?? ""));
          return;
        }

        const wantsPresence = message.supportsPresence === true;
        const wantsTransformSync = message.supportsTransformSync === true;
        const wantsHierarchySync = message.supportsHierarchySync === true;
        const wantsComponentRecoveryPreview = message.supportsComponentRecoveryPreview === true;
        const wantsProjectTransfer = message.supportsProjectTransfer === true;
        const wantsComponentPropertySync = message.supportsComponentPropertySync === true;
        const wantsComponentStructureSync = message.supportsComponentStructureSync === true;
        const wantsPrimitiveTemplateSync = message.supportsPrimitiveTemplateSync === true;
        const wantsDurableSessionRecovery = message.supportsDurableSessionRecovery === true;
        const wantsProjectEditPause = message.supportsProjectEditPause === true;
        const wantsHierarchyRenameRecovery = message.supportsHierarchyRenameRecovery === true;
        const wantsHierarchyReparentRecovery = message.supportsHierarchyReparentRecovery === true;
        const wantsHierarchySiblingRecovery = message.supportsHierarchySiblingRecovery === true;
        const validationError =
          validateText(message.requestId, "requestId", 128) ??
          validateText(message.userName, "userName", 64) ??
          validateText(message.projectId, "projectId", 128) ??
          validateText(message.sessionId, "sessionId", 128) ??
          (message.supportsPresence === undefined || typeof message.supportsPresence === "boolean"
            ? null
            : "supportsPresence must be a boolean.") ??
          (message.supportsTransformSync === undefined || typeof message.supportsTransformSync === "boolean"
            ? null
            : "supportsTransformSync must be a boolean.") ??
          (message.supportsHierarchySync === undefined || typeof message.supportsHierarchySync === "boolean"
            ? null
            : "supportsHierarchySync must be a boolean.") ??
          (message.supportsProjectTransfer === undefined || typeof message.supportsProjectTransfer === "boolean"
            ? null
            : "supportsProjectTransfer must be a boolean.") ??
          (message.supportsComponentRecoveryPreview === undefined ||
           typeof message.supportsComponentRecoveryPreview === "boolean"
            ? null
            : "supportsComponentRecoveryPreview must be a boolean.") ??
          (message.supportsComponentPropertySync === undefined || typeof message.supportsComponentPropertySync === "boolean"
            ? null : "supportsComponentPropertySync must be a boolean.") ??
          (message.supportsComponentStructureSync === undefined || typeof message.supportsComponentStructureSync === "boolean"
            ? null : "supportsComponentStructureSync must be a boolean.") ??
          (message.supportsPrimitiveTemplateSync === undefined || typeof message.supportsPrimitiveTemplateSync === "boolean"
            ? null : "supportsPrimitiveTemplateSync must be a boolean.") ??
          (message.supportsDurableSessionRecovery === undefined || typeof message.supportsDurableSessionRecovery === "boolean"
            ? null : "supportsDurableSessionRecovery must be a boolean.") ??
          (message.supportsProjectEditPause === undefined || typeof message.supportsProjectEditPause === "boolean"
            ? null : "supportsProjectEditPause must be a boolean.") ??
          (wantsProjectEditPause && (!wantsDurableSessionRecovery || !wantsProjectTransfer ||
            !wantsPresence || !wantsTransformSync || !wantsHierarchySync)
            ? "Project edit pause requires full durable Editor and Project Transfer capabilities." : null) ??
          (message.supportsHierarchyRenameRecovery === undefined || typeof message.supportsHierarchyRenameRecovery === "boolean"
            ? null : "supportsHierarchyRenameRecovery must be a boolean.") ??
          (message.supportsHierarchyReparentRecovery === undefined || typeof message.supportsHierarchyReparentRecovery === "boolean"
            ? null : "supportsHierarchyReparentRecovery must be a boolean.") ??
          (message.supportsHierarchySiblingRecovery === undefined || typeof message.supportsHierarchySiblingRecovery === "boolean"
            ? null : "supportsHierarchySiblingRecovery must be a boolean.") ??
          (durable && (wantsHierarchySync || wantsTransformSync) && (!wantsDurableSessionRecovery || !wantsProjectTransfer)
            ? "Durable realtime editing requires the Session recovery capability and Project Transfer." : null) ??
          (wantsPrimitiveTemplateSync && (!wantsComponentStructureSync || !wantsComponentPropertySync || !wantsHierarchySync || !wantsProjectTransfer)
            ? "Primitive template synchronization requires Component property/structure, Hierarchy and Project Transfer capabilities." : null) ??
          (enablePrimitiveTemplateSync && (wantsHierarchySync || wantsTransformSync) &&
              (!wantsPrimitiveTemplateSync || !wantsComponentStructureSync || !wantsComponentPropertySync)
            ? "This operator-enabled Session requires primitive template and Component structure capabilities for Editor connections." : null) ??
          (wantsComponentStructureSync && !wantsComponentPropertySync
            ? "Component structure synchronization requires property synchronization." : null) ??
          (wantsComponentPropertySync && (!wantsHierarchySync || !wantsProjectTransfer)
            ? "Collider property synchronization requires Hierarchy and Project Transfer capabilities." : null) ??
          (wantsTransformSync && !wantsPresence
            ? "Transform Sync requires Presence capability."
            : null) ??
          (wantsHierarchySync && (!wantsPresence || !wantsTransformSync)
            ? "Hierarchy Sync requires Presence and Transform Sync capabilities."
            : null) ??
          (wantsComponentRecoveryPreview && !wantsHierarchySync
            ? "Read-only Component preview requires Hierarchy Sync capability."
            : null) ??
          (wantsPresence || wantsProjectTransfer ? validateText(message.userId, "userId", 128) : null) ??
          (wantsPresence ? validateHtmlColor(message.userColor) : null);

        if (validationError) {
          safeSend(socket, errorMessage("invalid_hello", validationError, message.requestId ?? ""));
          return;
        }

        state.helloAccepted = true;
        state.lastPongAt = Date.now();
        state.nextHeartbeatAt = state.lastPongAt + config.heartbeatIntervalMilliseconds;
        state.supportsPresence = wantsPresence;
        state.supportsTransformSync = wantsTransformSync;
        state.supportsHierarchySync = wantsHierarchySync;
        state.supportsComponentRecoveryPreview =
          enableComponentRecoveryPreview && wantsComponentRecoveryPreview && wantsHierarchySync;
        state.supportsProjectTransfer = wantsProjectTransfer;
        state.supportsComponentPropertySync = enableComponentPropertySync && wantsComponentPropertySync;
        state.supportsComponentStructureSync = enableComponentStructureSync && wantsComponentStructureSync && state.supportsComponentPropertySync;
        state.supportsPrimitiveTemplateSync = enablePrimitiveTemplateSync && wantsPrimitiveTemplateSync && state.supportsComponentStructureSync;
        state.supportsDurableSessionRecovery = Boolean(durable && wantsDurableSessionRecovery && wantsTransformSync);
        state.supportsProjectEditPause = state.supportsDurableSessionRecovery && wantsProjectEditPause &&
          wantsPresence && wantsHierarchySync && wantsProjectTransfer;
        state.supportsHierarchyRenameRecovery = state.supportsDurableSessionRecovery && wantsHierarchySync && wantsHierarchyRenameRecovery;
        state.supportsHierarchyReparentRecovery = state.supportsDurableSessionRecovery && wantsHierarchySync && wantsHierarchyReparentRecovery;
        state.supportsHierarchySiblingRecovery = state.supportsDurableSessionRecovery && wantsHierarchySync && wantsHierarchySiblingRecovery;
        const projectBeforeHierarchy = state.supportsHierarchyRenameRecovery || state.supportsHierarchyReparentRecovery ||
          state.supportsHierarchySiblingRecovery;
        state.userId = wantsPresence || wantsProjectTransfer ? message.userId.trim() : state.connectionId;
        state.userColor = wantsPresence ? message.userColor.toUpperCase() : deterministicColor(state.connectionId);
        state.userName = message.userName.trim();
        state.projectId = message.projectId.trim();
        state.sessionId = message.sessionId.trim();
        identifyClientRole(state, classifyAcceptedHello(state));

        let projectRegistrationError = wantsProjectTransfer
          ? projectRegistrationCapacityError(state)
          : null;
        // Collider admission and Hierarchy recovery depend on actual
        // Project registration before the capability is advertised.
        if (!projectRegistrationError && (state.supportsComponentPropertySync || projectBeforeHierarchy))
          projectRegistrationError = registerProjectClient(state);
        if (projectRegistrationError) {
          if (state.supportsDurableSessionRecovery) {
            closeWithProtocolError(socket,"project_session_limit",projectRegistrationError,message.requestId);
            return;
          }
          state.supportsProjectTransfer = false;
          state.supportsComponentPropertySync = false;
          state.supportsComponentStructureSync = false;
          state.supportsPrimitiveTemplateSync = false;
        }
        const durableSession = state.supportsDurableSessionRecovery
          ? authority.getOrCreateSession(makeSessionKey(state.projectId,state.sessionId)) : null;
        const durableSessionId = durableSession ? durable.lineageFor(durableSession) : null;

        safeSend(socket, {
          type: "hello_ack",
          protocolVersion: PROTOCOL_VERSION,
          requestId: message.requestId,
          connectionId: state.connectionId,
          serverVersion: SERVER_VERSION,
          serverTimestampUnixMs: Date.now(),
          presenceEnabled: state.supportsPresence,
          transformSyncEnabled: state.supportsTransformSync,
          hierarchySyncEnabled: state.supportsHierarchySync,
          // Do not change legacy hello_ack shape unless this preview is
          // explicitly requested. Do NOT advertise Component/Inspector sync.
          ...(wantsComponentRecoveryPreview
            ? { componentRecoveryPreviewEnabled: state.supportsComponentRecoveryPreview }
            : {}),
          ...(wantsComponentPropertySync ? {
            componentPropertySyncEnabled: state.supportsComponentPropertySync,
            componentStructureSyncEnabled: state.supportsComponentStructureSync,
            ...(state.supportsComponentPropertySync && enableComponentStructureSync ? {componentStructureSceneId:
              authority.sessions.get(makeSessionKey(state.projectId,state.sessionId))?.componentStructureSceneId ?? ""} : {}),
            ...(state.supportsComponentPropertySync ? {componentPropertySceneId:
              authority.sessions.get(makeSessionKey(state.projectId,state.sessionId))?.componentPropertySceneId ?? ""} : {}),
          } : {}),
          ...(wantsPrimitiveTemplateSync ? {primitiveTemplateSyncEnabled:state.supportsPrimitiveTemplateSync} : {}),
          ...(durableSessionId ? {durableSessionRecoveryEnabled:true,authorityEpoch:durableSession.durableEpoch,durableSessionId} : {}),
          ...(wantsProjectEditPause ? {projectEditPauseEnabled:state.supportsProjectEditPause} : {}),
          ...(state.supportsHierarchyRenameRecovery ? { hierarchyRenameRecoveryEnabled: true } : {}),
          ...(state.supportsHierarchyReparentRecovery ? { hierarchyReparentRecoveryEnabled: true } : {}),
          ...(state.supportsHierarchySiblingRecovery ? { hierarchySiblingRecoveryEnabled: true } : {}),
          projectTransferEnabled: state.supportsProjectTransfer,
          userId: state.userId,
          userColor: state.userColor,
        });

        // Hierarchy recovery needs the signed Project pin to reconcile the first
        // Hierarchy snapshot. Transform still depends on that Hierarchy.
        if (projectBeforeHierarchy) {
          sendProjectSnapshot(state, message.requestId);
        }
        if (state.supportsPresence) {
          registerPresence(socket, state, message.requestId);
        }
        if (state.supportsProjectTransfer && !projectBeforeHierarchy) {
          if (!state.projectClientRegistered)
            projectRegistrationError = registerProjectClient(state);
          if (projectRegistrationError) {
            state.supportsProjectTransfer = false;
            state.supportsComponentPropertySync = false;
            state.supportsComponentStructureSync = false;
            state.supportsPrimitiveTemplateSync = false;
            safeSend(socket, errorMessage("project_session_limit", projectRegistrationError, message.requestId));
          } else {
            state.projectClientRegistered = true;
            sendProjectSnapshot(state, message.requestId);
          }
        } else if (projectRegistrationError) {
          safeSend(socket, errorMessage("project_session_limit", projectRegistrationError, message.requestId));
        }
        return;
      }

      // Only negotiated, exact, cursor-checked ACKs may cross a pending
      // pause fence. They report local Editor readiness, never commit rights.
      if (message.type === "project_edit_pause_ack") {
        handleProjectEditPauseAck(socket,state,message);
        return;
      }
      // Deny ALL non-heartbeat frames while frozen. This covers Hierarchy,
      // Transform, Component, locks, Publisher/Seed announcements, read/ACK
      // side effects and future protocol additions by default. A caller
      // cannot bypass the barrier by omitting authorityEpoch or replaying an ID.
      if (projectQuiescence.isFrozen(state.projectId) && message.type !== "ping") {
        safeSend(socket,errorMessage("project_transition_paused",
          "The signed Project is quiesced; no editor or peer changes are accepted.",message.requestId ?? ""));
        return;
      }
      if (durable && DURABLE_EPOCH_COMMANDS.has(message.type) &&
          (!state.supportsDurableSessionRecovery || typeof message.authorityEpoch !== "string" ||
            message.authorityEpoch !== authority.activeSession(state)?.session.durableEpoch)) {
        safeSend(socket,errorMessage("authority_epoch_mismatch","Reconnect and review local work against the current durable Session.",message.requestId ?? ""));
        return;
      }

      if (message.type === "ping") {
        const validationError = validateText(message.requestId, "requestId", 128);
        if (validationError || !Number.isSafeInteger(message.clientTimestampUnixMs)) {
          safeSend(
            socket,
            errorMessage(
              "invalid_ping",
              validationError ?? "clientTimestampUnixMs must be a safe integer.",
              message.requestId ?? "",
            ),
          );
          return;
        }
        safeSend(socket, {
          type: "pong",
          protocolVersion: PROTOCOL_VERSION,
          requestId: message.requestId,
          clientTimestampUnixMs: message.clientTimestampUnixMs,
          serverTimestampUnixMs: Date.now(),
        });
        return;
      }

      if (REALTIME_MUTATION_TYPES.has(message.type)) {
        const blocked = coordinator.realtimeWriteBlockReason(state);
        if (blocked) {
          const requestId = typeof message.requestId === "string" ? message.requestId : "";
          safeSend(socket, message.type.startsWith("component_")
            ? {type:"component_property_rejected",protocolVersion:PROTOCOL_VERSION,requestId,
              operationId:validateText(message.operationId,"operationId",128) === null ? message.operationId : "",
              sceneId:typeof message.sceneId === "string" && /^[0-9a-f]{32}$/u.test(message.sceneId) ? message.sceneId : "",
              epoch:"",serverRevision:authority.activeSession(state)?.session?.revision ?? 0,
              error:"project_sync_required",
              reason:"Update to the current signed Project before editing. Local unconfirmed work is kept.",
              repair:"resnapshot_required"}
            : errorMessage("project_sync_required",
              `Update to the current signed Project before editing (${blocked}). Local unconfirmed work is kept.`, requestId));
          return;
        }
      }

      if (["component_scene_join", "component_snapshot_request", "component_property_set", "component_structure_set", "component_apply_report"].includes(message.type)) {
        const rejectComponent = result => {
          const live = authority.activeSession(state)?.session;
          const ledger = live && componentCollaboration?.ledgers.get(live);
          safeSend(socket, {type:"component_property_rejected",protocolVersion:PROTOCOL_VERSION,
            requestId:typeof message.requestId === "string" ? message.requestId : "",
            operationId:validateText(message.operationId,"operationId",128) === null ? message.operationId : "",
            sceneId:typeof message.sceneId === "string" && /^[0-9a-f]{32}$/u.test(message.sceneId) ? message.sceneId : "",
            epoch:ledger?.epoch ?? "",serverRevision:live?.revision ?? 0,
            error:result.error,reason:result.reason,repair:result.repair ?? "resnapshot_required"});
        };
        if (!componentCollaboration || !state.supportsComponentPropertySync) {
          rejectComponent({error:"component_sync_not_negotiated",reason:"Collider property synchronization was not negotiated."});
          return;
        }
        const deliverComponent = result => {
          if (durableFaulted || stopping || socket.readyState !== WebSocket.OPEN || !authority.activeSession(state)) return;
          if (result.error) { rejectComponent(result); return; }
          if (message.type === "component_scene_join") {
            const current = authority.activeSession(state)?.session;
            const ledger = current && componentCollaboration.ledgers.get(current);
            if (ledger?.sceneRequirementPending) {
              ledger.sceneRequirementPending = false;
              // Existing compatible Editors must gate this Scene's lock/edit
              // requests before applying their own Collider join snapshot.
              const required = {type:"component_scene_required",protocolVersion:PROTOCOL_VERSION,
                sceneId:ledger.sceneId,serverRevision:current.revision,
                ...(current.componentStructureSceneId ? {requiresStructure:true} : {})};
              for (const member of current.members.values()) {
                const peer = clientsByConnectionId.get(member.connectionId);
                if (member.supportsComponentPropertySync && peer?.state.supportsComponentPropertySync)
                  safeSend(peer.socket,required);
              }
            }
          }
          if (["component_property_set","component_structure_set"].includes(message.type) && !result.replayed) {
            const current = authority.activeSession(state)?.session;
            const ledger = current && componentCollaboration.ledgers.get(current);
            if (ledger) for (const id of componentCollaboration.recipientConnectionIds(ledger)) {
              const peer = clientsByConnectionId.get(id);
              if (peer) safeSend(peer.socket, id === state.connectionId ? result : {...result,requestId:""});
            }
          } else safeSend(socket,result);
        };
        if (message.type === "component_scene_join") {
          withDurableSource(socket,state,message,() => componentCollaboration.join(state,message).then(deliverComponent).catch(() => {
            rejectComponent({error:"component_admission_failed",reason:"Signed Scene admission could not complete."});
          }));
        } else inConnectionOrder(socket, state, message, () => {
          if (durableFaulted || stopping || socket.readyState !== WebSocket.OPEN) return;
          const result = message.type === "component_property_set"
            ? componentCollaboration.commit(state,message,Date.now())
            : message.type === "component_structure_set"
              ? componentCollaboration.structure(state,message,Date.now())
            : message.type === "component_apply_report"
              ? componentCollaboration.report(state,message)
              : componentCollaboration.recover(state,message);
          if (durable && !result.error && !result.replayed && ["component_property_set","component_structure_set"].includes(message.type) &&
              !persistDurableResult(state,authority.activeSession(state)?.session,message.operationId,result)) return;
          deliverComponent(result);
        });
        return;
      }

      if (message.type === "presence_update") {
        executeAuthorityCommand({
          type: "presence_update",
          connection: state,
          message,
          nowUnixMs: Date.now(),
        });
        return;
      }

      if (message.type === "hierarchy_seed") {
        handleHierarchySeed(socket, state, message);
        return;
      }
      if (message.type === "hierarchy_operation") {
        handleHierarchyOperation(socket, state, message);
        return;
      }
      if (message.type === "lock_request") {
        handleLockRequest(socket, state, message);
        return;
      }
      if (message.type === "lock_release") {
        handleLockRelease(socket, state, message);
        return;
      }
      if (message.type === "transform_update") {
        handleTransformUpdate(socket, state, message);
        return;
      }
      // WP6 Test Lab: bounded one-time freshness probe for future signed
      // Active Scene handoff. Echo is intentionally NOT an attestation,
      // an Inspector apply, or an authorization to write Scene/Component data.
      if (message.type === "component_source_challenge_request" ||
          message.type === "component_source_challenge_echo") {
        if (!state.supportsComponentRecoveryPreview) {
          safeSend(socket, errorMessage("unsupported_message",
            "Read-only WP6 challenge was not explicitly negotiated.",
            typeof message.requestId === "string" ? message.requestId : ""));
          return;
        }
        const isIssue = message.type === "component_source_challenge_request";
        const fields = isIssue
          ? ["type", "protocolVersion", "requestId", "sceneId"]
          : ["type", "protocolVersion", "requestId", "sceneId", "nonce"];
        if (Object.keys(message).length !== fields.length ||
            Object.keys(message).some(field => !fields.includes(field))) {
          safeSend(socket, errorMessage(
            "component_source_challenge_invalid", "Exact WP6 challenge fields are required.",
            typeof message.requestId === "string" ? message.requestId : ""));
          return;
        }
        const result = isIssue
          ? issueComponentSourceChallenge(
              coordinator, authority, state, message.sceneId)
          : consumeComponentSourceChallenge(
              coordinator, authority, state, message.sceneId, message.nonce);
        if (result.error) {
          safeSend(socket, errorMessage(result.error, result.reason,
            typeof message.requestId === "string" ? message.requestId : ""));
          return;
        }
        safeSend(socket, {
          ...result,
          type: isIssue ? "component_source_challenge" : "component_source_challenge_echo_result",
          protocolVersion: PROTOCOL_VERSION,
          requestId: message.requestId,
        });
        return;
      }
      if (message.type === "component_recovery_preview_request") {
        // Never grant Component reads to legacy or spoofed clients. No
        // network-provided seed or write/Undo operation exists here.
        if (!state.supportsComponentRecoveryPreview) {
          safeSend(socket, errorMessage(
            "unsupported_message", "Component recovery preview was not negotiated.",
            typeof message.requestId === "string" ? message.requestId : "",
          ));
          return;
        }
        const fields = [
          "type", "protocolVersion", "requestId", "sceneId",
          "knownRevision", "knownFingerprint",
        ];
        if (Object.keys(message).length !== fields.length ||
            Object.keys(message).some(field => !fields.includes(field))) {
          safeSend(socket, errorMessage(
            "component_recovery_request_invalid",
            "Component recovery requests require exactly the six defined fields.",
            typeof message.requestId === "string" ? message.requestId : "",
          ));
          return;
        }
        const request = {
          requestId: message.requestId,
          sceneId: message.sceneId,
          knownRevision: message.knownRevision,
          knownFingerprint: message.knownFingerprint,
        };
        // The current realtime Session alone is not enough. The Editor must
        // ALSO be the exact live Project member with a still-valid Owner/
        // Publisher signed Baseline. Otherwise a raw WS client could bypass
        // the opt-in Unity Editor's local Project source check.
        const projectGate = inspectCurrentSignedProjectForRecoveryPreview(
          coordinator, authority, state,
        );
        if (projectGate.error) {
          safeSend(socket, errorMessage(
            projectGate.error, projectGate.reason,
            typeof message.requestId === "string" ? message.requestId : "",
          ));
          return;
        }
        const result = authority.inspectComponentRecoveryPreview(
          state, request, Math.min(64 * 1024, config.maxMessageBytes),
        );
        if (result.error) {
          safeSend(socket, errorMessage(
            result.error, result.reason, typeof message.requestId === "string" ? message.requestId : "",
          ));
          return;
        }
        const response = {
          ...result,
          type: "component_recovery_preview",
          protocolVersion: PROTOCOL_VERSION,
        };
        if (Buffer.byteLength(JSON.stringify(response), "utf8") > config.maxMessageBytes) {
          safeSend(socket, errorMessage(
            "component_recovery_snapshot_size_limit",
            "The Component recovery preview exceeds the configured wire message limit.",
            message.requestId,
          ));
          return;
        }
        safeSend(socket, response);
        return;
      }
      if (message.type === "project_peer_announce") {
        handleProjectPeerAnnounce(socket, state, message);
        return;
      }
      if (message.type === "project_baseline_publish") {
        handleProjectBaselinePublish(socket, state, message);
        return;
      }
      if (message.type === "project_baseline_transition_preview") {
        void handleProjectTransitionPreview(socket, state, message);
        return;
      }

      safeSend(
        socket,
        errorMessage("unsupported_message", `Unsupported message type: ${message.type}`, message.requestId ?? ""),
      );
    });

    socket.on("error", (error) => {
      logger.warn(`WebSocket error (${state.connectionId}): ${error.message}`);
    });

    socket.on("pong", () => {
      state.lastPongAt = Date.now();
    });

    socket.on("close", () => {
      const aborted=projectQuiescence.onlineConnectionLost(state.projectId,state.connectionId);
      if (aborted) notifyProjectPauseCancelled(state.projectId,aborted.pauseId);
      clients.delete(socket);
      componentCollaboration?.removeConnection(state);
      clientsByConnectionId.delete(state.connectionId);
      removeProjectClient(state);
      removePresence(socket, state);
      logger.info(`WebSocket disconnected (${state.connectionId}) [${disconnectedClientRole(state)}].`);
    });
  });

  httpServer.on("clientError", (_error, socket) => {
    if (socket.writable) {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    }
  });

  function stoppingError() {
    return Object.assign(new Error("TeamForge server is stopping or already stopped."), { code: "server_stopping" });
  }

  function start() {
    if (stopping) return Promise.reject(stoppingError());
    if (!startPromise) {
      startPromise = startListening();
      const pending = startPromise;
      pending.catch(() => {
        // A failed bind may be retried while this instance remains open.
        if (startPromise === pending && !stopping) startPromise = null;
      });
    }
    return startPromise;
  }

  async function startListening() {
    if (durableSessionDatabasePath && !durable) {
      durable = new DurableSessionRuntime({filePath:durableSessionDatabasePath,managedRoot:componentProjectManagedRoot,
        authority,coordinator,components:componentCollaboration});
      try { await durable.restore(); }
      catch (error) {
        durable.close();
        durable = null;
        componentCollaboration?.clear();
        sessions.clear();
        coordinator.clear();
        throw error;
      }
      if (componentCollaboration) componentCollaboration.persistAdmission = (connection,session) => {
        if (!persistDurableResult(connection,session)) throw new Error("The Collider admission checkpoint failed.");
      };
      if (stopping) throw stoppingError();
    }
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        httpServer.off("error", onError);
        httpServer.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        httpServer.off("error", onError);
        resolve();
      };
      httpServer.once("error", onError);
      httpServer.once("listening", onListening);
      try {
        httpServer.listen(config.port, config.host);
      } catch (error) {
        onError(error);
      }
    });

    // stop() owns a pending listen until it settles, then closes any late
    // listener. Do not recreate timers or advertise readiness after shutdown.
    if (stopping) throw stoppingError();

    const address = httpServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Unable to resolve the listening address.");
    }

    const sweepMilliseconds = Math.max(25, Math.min(1_000, Math.floor(config.lockLeaseMilliseconds / 4)));
    lockSweepTimer = setInterval(sweepExpiredLocks, sweepMilliseconds);
    lockSweepTimer.unref?.();

    const connectionSweepMilliseconds = Math.max(
      10,
      Math.min(
        1_000,
        Math.floor(config.helloTimeoutMilliseconds / 4),
        Math.floor(config.heartbeatIntervalMilliseconds / 4),
      ),
    );
    connectionSweepTimer = setInterval(sweepConnections, connectionSweepMilliseconds);
    connectionSweepTimer.unref?.();

    logger.info(`TeamForge server ${SERVER_VERSION} listening on ${config.host}:${address.port}.`);
    return {
      host: config.host,
      port: address.port,
      healthPath: config.healthPath,
      wsPath: config.wsPath,
    };
  }

  function stop() {
    if (stopPromise) return stopPromise;
    stopping = true;
    stopPromise = stopListening();
    return stopPromise;
  }

  async function stopListening() {
    // Startup never waits for stop: it rejects if shutdown has begun. Waiting
    // here therefore cannot cycle, and preserves ownership of a late listener.
    await startPromise?.catch(() => {});
    if (lockSweepTimer) {
      clearInterval(lockSweepTimer);
      lockSweepTimer = null;
    }
    if (connectionSweepTimer) {
      clearInterval(connectionSweepTimer);
      connectionSweepTimer = null;
    }
    for (const client of clients) {
      client.terminate();
    }
    clients.clear();
    clientsByConnectionId.clear();
    projectQuiescence.clear();
    onlineSourceObservations.clear();
    publisherProofs.clear();
    componentCollaboration?.clear();
    durable?.close();
    sessions.clear();
    coordinator.clear();

    await new Promise((resolve) => webSocketServer.close(() => resolve()));
    if (httpServer.listening) {
      await new Promise((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  }

  return {
    config,
    httpServer,
    webSocketServer,
    start,
    stop,
    // Trusted in-process M4 pause review. Not remotely invokable: a WS user
    // cannot initiate a pause, obtain a signing challenge or commit M5.
    tryBeginOnlineProjectPause(projectId) {
      if (!durable?.ready || durableFaulted || stopping || !componentCollaboration ||
          activeTransitionPreviews.has(projectId))
        return {error:"project_transition_unavailable"};
      const current=durable.approvedProjects.get(projectId);
      if (!current || coordinator.projects.get(projectId)?.baseline?.descriptorHash!==current.descriptorHash)
        return {error:"project_transition_signed_baseline_required"};
      const connections=[...clients].map(socket=>({socket,state:socket[CLIENT_STATE]}))
        .filter(entry=>entry.state?.helloAccepted && entry.state.projectId===projectId);
      if (!connections.length || connections.length>128 || connections.some(({socket,state})=>
          !state.supportsProjectEditPause || !state.supportsDurableSessionRecovery ||
          !state.projectClientRegistered || socket.readyState!==WebSocket.OPEN))
        return {error:"project_transition_editor_capability_required"};
      const editors=[];
      for(const {state} of connections) {
        const session=authority.activeSession(state)?.session;
        if (!session || !session.durableEpoch || !session.durableLineageId)
          return {error:"project_transition_editor_stale"};
        editors.push({connectionId:state.connectionId,sessionId:state.sessionId,
          authorityEpoch:session.durableEpoch,durableSessionId:session.durableLineageId,
          serverRevision:session.revision});
      }
      let sessionMemberCount=0,activeLockCount=0;
      for (const [key,session] of sessions) {
        let decoded;
        try {decoded=JSON.parse(key);}catch{return {error:"project_transition_invalid_roster"};}
        if (!Array.isArray(decoded) || decoded.length!==2) return {error:"project_transition_invalid_roster"};
        if (decoded[0]!==projectId) continue;
        sessionMemberCount+=session.members.size;
        activeLockCount+=session.locks.size;
      }
      const opened=projectQuiescence.beginOnlinePause({projectId,approvedBaseline:current,
        editors,sessionMemberCount,activeLockCount});
      if(opened.error) return opened;
      for (const {socket,state} of connections) {
        const editor=editors.find(item=>item.connectionId===state.connectionId);
        const sent=safeSend(socket,{type:"project_edit_pause_request",
          protocolVersion:PROTOCOL_VERSION,requestId:"",pauseId:opened.pauseId,
          projectUuid:current.projectUuid,baselineRevision:current.baselineRevision,
          manifestHash:current.manifestHash,descriptorHash:current.descriptorHash,
          authorityEpoch:editor.authorityEpoch,durableSessionId:editor.durableSessionId,
          serverRevision:editor.serverRevision,expiresAtUnixMs:opened.expiresAtUnixMs});
        if (!sent) {
          projectQuiescence.cancelOnlinePause(projectId,opened.pauseId);
          notifyProjectPauseCancelled(projectId,opened.pauseId);
          return {error:"project_transition_editor_disconnected"};
        }
      }
      // Never return a freeze authority ticket until ALL Editors have
      // actually sent verified ACKs; the pause ID alone carries no authority.
      return {pauseId:opened.pauseId,expectedCount:opened.expectedCount,
        expiresAtUnixMs:opened.expiresAtUnixMs,commitPermitted:false};
    },
    inspectOnlineProjectPause(projectId,pauseId) {
      if (!durable?.ready || durableFaulted || stopping) return null;
      const status=currentOnlinePause(projectId,pauseId);
      if (!status) return null;
      return {ready:status.ready,confirmedCount:status.confirmedCount,
        expectedCount:status.expectedCount,commitPermitted:false,
        // Keep the private ticket strictly inside the server. ACKs alone
        // cannot establish Unity filesystem, Guest Active or Host durability.
      };
    },
    cancelOnlineProjectPause(projectId,pauseId) {
      const cancelled=projectQuiescence.cancelOnlinePause(projectId,pauseId);
      if (cancelled) notifyProjectPauseCancelled(projectId,pauseId);
      return cancelled;
    },
    // Internal preparation only. This nonce proves current private-key
    // possession, not filesystem immutability or a commit/rollback grant.
    issueOnlinePublisherChallenge(projectId,pauseId,candidateDescriptor) {
      const attested=onlineSourceObservations.get(projectId);
      const paused=currentOnlinePause(projectId,pauseId);
      const current=durable?.approvedProjects.get(projectId);
      if (!attested || attested.pauseId!==pauseId || !paused?.ready ||
          attested.ticket!==paused.ticket || stopping || durableFaulted ||
          !current || current.descriptorHash!==attested.ticket.descriptorHash ||
          coordinator.projects.get(projectId)?.baseline?.descriptorHash!==current.descriptorHash)
        return {error:"project_transition_source_attestation_required",commitPermitted:false};
      if (!candidateDescriptor || candidateDescriptor.descriptorHash!==attested.descriptorHash ||
          candidateDescriptor.manifestHash!==attested.manifestHash)
        return {error:"project_transition_candidate_mismatch",commitPermitted:false};
      const issued=publisherProofs.issue({ticket:attested.ticket,candidate:candidateDescriptor});
      // The challenge signed payload binds its own expiry, but the caller
      // must obey the SHORTER editor pause deadline as well.
      return { ...issued,
        ...(issued.challengeId ? { expiresAtUnixMs: Math.min(issued.expiresAtUnixMs,paused.expiresAtUnixMs) } : {}),
        commitPermitted:false };

    },
    // Consume exactly one signed nonce and RE-VERIFY the stored source against
    // the current pause, durable Session cursors and approved Host pointer.
    // A positive response is only diagnostic; no private receipt is exposed.
    async verifyOnlinePublisherChallenge(projectId,pauseId,candidateDescriptor,challengeId,signature) {
      const attested=onlineSourceObservations.get(projectId);
      const paused=currentOnlinePause(projectId,pauseId);
      if (!attested || attested.pauseId!==pauseId || !paused?.ready ||
          attested.ticket!==paused.ticket || stopping || durableFaulted ||
          activePausedSourceAudits.has(projectId) || activeTransitionPreviews.has(projectId) ||
          candidateDescriptor?.descriptorHash!==attested.descriptorHash ||
          candidateDescriptor?.manifestHash!==attested.manifestHash)
        return {error:"project_transition_source_attestation_required",commitPermitted:false};
      const receipt=publisherProofs.consume({ticket:attested.ticket,challengeId,signature});
      if (!receipt.verified)
        return {...receipt,commitPermitted:false};
      activePausedSourceAudits.add(projectId);
      let report;
      try {
        report=await inspectPausedSignedSources({projectId,pauseId,candidateDescriptor,
          quiescence:projectQuiescence,coordinator,authority,durable,
          components:componentCollaboration,managedRoot:componentProjectManagedRoot,
          stopping:()=>stopping || durableFaulted});
      } finally {
        activePausedSourceAudits.delete(projectId);
      }
      const now=currentOnlinePause(projectId,pauseId);
      const stillTrusted=report?.status==="verified_source_only" &&
        now?.ready && now.ticket===attested.ticket &&
        onlineSourceObservations.get(projectId)===attested &&
        publisherProofs.matchesReceipt({ticket:attested.ticket,receipt,
          candidateDescriptorHash:attested.descriptorHash});
      if (!stillTrusted) {
        publisherProofs.revoke(attested.ticket);
        if (onlineSourceObservations.get(projectId)===attested)
          onlineSourceObservations.delete(projectId);
        return {error:"project_transition_source_or_publisher_stale",commitPermitted:false};
      }
      return {verified:true,sourceVerified:true,commitPermitted:false,
        pauseId,candidateDescriptorHash:attested.descriptorHash,
        expiresAtUnixMs:Math.min(receipt.expiresAtUnixMs,now.expiresAtUnixMs)};
    },
    // Trusted in-process read-only audit. This is not a WebSocket handler,
    // and no returned source report can authorize a Baseline commit.
    async inspectPausedProjectSources(projectId,pauseId,candidateDescriptor) {
      if (!durable?.ready || durableFaulted || stopping ||
          activePausedSourceAudits.has(projectId) ||
          activeTransitionPreviews.has(projectId))
        return {error:"project_transition_source_unavailable",commitPermitted:false};
      // Any new scan invalidates earlier source evidence and pending proof.
      const previous=onlineSourceObservations.get(projectId);
      if(previous) {
        onlineSourceObservations.delete(projectId);
        publisherProofs.revoke(previous.ticket);
      }
      activePausedSourceAudits.add(projectId);
      try {
        const result=await inspectPausedSignedSources({projectId,pauseId,candidateDescriptor,
          quiescence:projectQuiescence,coordinator,authority,durable,
          components:componentCollaboration,managedRoot:componentProjectManagedRoot,
          stopping:()=>stopping || durableFaulted});
        const current=currentOnlinePause(projectId,pauseId);
        if(result.status==="verified_source_only" && current?.ready &&
            candidateDescriptor && !stopping && !durableFaulted)
          onlineSourceObservations.set(projectId,Object.freeze({
            pauseId,ticket:current.ticket,descriptorHash:candidateDescriptor.descriptorHash,
            manifestHash:candidateDescriptor.manifestHash,
          }));
        return result;
      } finally {
        activePausedSourceAudits.delete(projectId);
      }
    },
    // Internal-only future transition infrastructure; deliberately no WS
    // message exposes or authenticates this operation. An occupied Project
    // may NOT be frozen until Editor pause/ACK is implemented separately.
    tryBeginOfflineProjectFreeze(projectId) {
      if (!durable?.ready || durableFaulted || stopping || !projectQuiescence ||
          activeTransitionPreviews.has(projectId))
        return {error:"project_transition_unavailable"};
      const current = durable.approvedProjects.get(projectId);
      if (!current || coordinator.projects.get(projectId)?.baseline?.descriptorHash !== current.descriptorHash)
        return {error:"project_transition_signed_baseline_required"};
      let sessionMemberCount=0,activeLockCount=0;
      for (const [key,session] of sessions) {
        let scoped;
        try {scoped=JSON.parse(key);} catch {return {error:"project_transition_unavailable"};}
        if (!Array.isArray(scoped) || scoped[0]!==projectId) continue;
        sessionMemberCount+=session.members.size;
        activeLockCount+=session.locks.size;
      }
      const connectedClientCount=[...clients].filter(socket =>
        socket[CLIENT_STATE]?.helloAccepted && socket[CLIENT_STATE].projectId===projectId).length;
      return projectQuiescence.beginOfflineFreeze({projectId,
        connectedClientCount,sessionMemberCount,activeLockCount,approvedBaseline:current});
    },
    issueOfflinePublisherChallenge(ticket,candidateDescriptor) {
      const current=durable?.approvedProjects.get(ticket?.projectId);
      if (!current || !projectQuiescence.matchesOffline(ticket,current.descriptorHash) ||
          coordinator.projects.get(ticket.projectId)?.baseline?.descriptorHash !== current.descriptorHash)
        return {error:"project_transition_freeze_required"};
      return publisherProofs.issue({ticket,candidate:candidateDescriptor});
    },
    verifyOfflinePublisherChallenge(ticket,challengeId,signature) {
      const current=durable?.approvedProjects.get(ticket?.projectId);
      if (!current || !projectQuiescence.matchesOffline(ticket,current.descriptorHash) ||
          coordinator.projects.get(ticket.projectId)?.baseline?.descriptorHash !== current.descriptorHash)
        return {error:"project_transition_freeze_required"};
      return publisherProofs.consume({ticket,challengeId,signature});
    },
    isOfflinePublisherReceiptCurrent(ticket,receipt,candidateDescriptorHash) {
      const current=durable?.approvedProjects.get(ticket?.projectId);
      return Boolean(current && projectQuiescence.matchesOffline(ticket,current.descriptorHash) &&
        current.descriptorHash===ticket.descriptorHash &&
        coordinator.projects.get(ticket.projectId)?.baseline?.descriptorHash===ticket.descriptorHash &&
        publisherProofs.matchesReceipt({ticket,receipt,candidateDescriptorHash}));
    },
    releaseOfflineProjectFreeze(ticket) {
      if (!projectQuiescence.matchesOffline(ticket,ticket?.descriptorHash)) return false;
      publisherProofs.revoke(ticket);
      return projectQuiescence.release(ticket);
    },
    get connectionCount() {
      return clients.size;
    },
    get presenceSessionCount() {
      return aggregateSessionCount(sessions, projectSessions);
    },
    get presenceMemberCount() {
      return countMembers(sessions);
    },
    get activeLockCount() {
      return countSessionMapEntries(sessions, "locks");
    },
    get projectRegistryCount() {
      return projects.size;
    },
    get projectPeerCount() {
      return coordinator.countMembers(true);
    },
  };
}
