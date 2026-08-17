import { createServer } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { configFromEnv } from "./config.mjs";
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
} from "./session-authority.mjs";

const NOOP_LOGGER = Object.freeze({
  info() {},
  warn() {},
  error() {},
});
const MAX_BUFFERED_BYTES = Symbol("teamForgeMaxBufferedBytes");
const CLIENT_STATE = Symbol("teamForgeClientState");

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
    socket.send(typeof message === "string" ? message : JSON.stringify(message));
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
  delete config.logger;
  delete config.lifecycleInstanceId;

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
  const startedAt = Date.now();
  let lockSweepTimer = null;
  let connectionSweepTimer = null;
  let stopping = false;

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
        const payload = JSON.stringify(effect.message);
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
    const result = authority.dispatch(command);
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
        const payload = JSON.stringify(effect.message);
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
    executeCoordinatorCommand({
      type: "peer_announce",
      connection: state,
      message,
      nowUnixMs: Date.now(),
    });
  }

  function handleProjectBaselinePublish(_socket, state, message) {
    executeCoordinatorCommand({
      type: "baseline_publish",
      connection: state,
      message,
      nowUnixMs: Date.now(),
    });
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

  function handleHierarchySeed(_socket, state, message) {
    executeAuthorityCommand({
      type: "hierarchy_seed",
      connection: state,
      message,
      nowUnixMs: Date.now(),
    });
  }


  function handleHierarchyOperation(_socket, state, message) {
    executeAuthorityCommand({
      type: "hierarchy_operation",
      connection: state,
      message,
      nowUnixMs: Date.now(),
    });
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


  function handleLockRequest(_socket, state, message) {
    executeAuthorityCommand({
      type: "lock_request",
      connection: state,
      message,
      nowUnixMs: Date.now(),
    });
  }


  function handleLockRelease(_socket, state, message) {
    executeAuthorityCommand({
      type: "lock_release",
      connection: state,
      message,
      nowUnixMs: Date.now(),
    });
  }


  function handleTransformUpdate(_socket, state, message) {
    executeAuthorityCommand({
      type: "transform_update",
      connection: state,
      message,
      nowUnixMs: Date.now(),
    });
  }


  const httpServer = createServer((request, response) => {
    if (request.method === "GET" && requestPath(request) === config.healthPath) {
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
      supportsPresence: false,
      supportsTransformSync: false,
      supportsHierarchySync: false,
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
    logger.info(`WebSocket connected (${state.connectionId}).`);

    socket.on("message", (data, isBinary) => {
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
        if (state.helloAccepted) {
          safeSend(socket, errorMessage("hello_already_received", "Hello was already accepted.", message.requestId ?? ""));
          return;
        }

        const wantsPresence = message.supportsPresence === true;
        const wantsTransformSync = message.supportsTransformSync === true;
        const wantsHierarchySync = message.supportsHierarchySync === true;
        const wantsProjectTransfer = message.supportsProjectTransfer === true;
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
          (wantsTransformSync && !wantsPresence
            ? "Transform Sync requires Presence capability."
            : null) ??
          (wantsHierarchySync && (!wantsPresence || !wantsTransformSync)
            ? "Hierarchy Sync requires Presence and Transform Sync capabilities."
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
        state.supportsProjectTransfer = wantsProjectTransfer;
        state.userId = wantsPresence || wantsProjectTransfer ? message.userId.trim() : state.connectionId;
        state.userColor = wantsPresence ? message.userColor.toUpperCase() : deterministicColor(state.connectionId);
        state.userName = message.userName.trim();
        state.projectId = message.projectId.trim();
        state.sessionId = message.sessionId.trim();

        let projectRegistrationError = wantsProjectTransfer
          ? projectRegistrationCapacityError(state)
          : null;
        if (projectRegistrationError) {
          state.supportsProjectTransfer = false;
        }

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
          projectTransferEnabled: state.supportsProjectTransfer,
          userId: state.userId,
          userColor: state.userColor,
        });

        if (state.supportsPresence) {
          registerPresence(socket, state, message.requestId);
        }
        if (state.supportsProjectTransfer) {
          projectRegistrationError = registerProjectClient(state);
          if (projectRegistrationError) {
            state.supportsProjectTransfer = false;
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
      if (message.type === "project_peer_announce") {
        handleProjectPeerAnnounce(socket, state, message);
        return;
      }
      if (message.type === "project_baseline_publish") {
        handleProjectBaselinePublish(socket, state, message);
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
      clients.delete(socket);
      clientsByConnectionId.delete(state.connectionId);
      removeProjectClient(state);
      removePresence(socket, state);
      logger.info(`WebSocket disconnected (${state.connectionId}).`);
    });
  });

  httpServer.on("clientError", (_error, socket) => {
    if (socket.writable) {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    }
  });

  async function start() {
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        httpServer.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        httpServer.off("error", onError);
        resolve();
      };
      httpServer.once("error", onError);
      httpServer.once("listening", onListening);
      httpServer.listen(config.port, config.host);
    });

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

  async function stop() {
    stopping = true;
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
