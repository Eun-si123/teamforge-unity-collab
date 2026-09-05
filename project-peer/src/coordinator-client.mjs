import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { REALTIME_PROTOCOL_VERSION, UUID_PATTERN } from "./constants.mjs";
import { fail, TeamForgePeerError } from "./errors.mjs";
import { LEGACY_CONNECTION_DEFAULTS } from "./policy-profile.mjs";
import { websocketUrl } from "./url-policy.mjs";

function descriptorCoordinatorFields(descriptor) {
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
  };
}

export class CoordinatorClient extends EventEmitter {
  constructor({
    serverAddress,
    realtimePath = LEGACY_CONNECTION_DEFAULTS.realtimePath,
    authenticationToken = "",
    userId,
    userName,
    userColor = "#64B5F6",
    projectId,
    sessionId,
    timeoutMilliseconds = LEGACY_CONNECTION_DEFAULTS.coordinatorTimeoutMilliseconds,
  }) {
    super();
    for (const [name, value, maximum] of [
      ["userId", userId, 128], ["userName", userName, 64], ["projectId", projectId, 128],
      ["sessionId", sessionId, 128],
    ]) {
      if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum ||
          /[\u0000-\u001f\u007f]/u.test(value)) {
        fail("invalid_coordinator_identity", `${name} is invalid.`);
      }
    }
    if (!/^#[0-9a-fA-F]{6}$/u.test(userColor) || !Number.isInteger(timeoutMilliseconds) ||
        timeoutMilliseconds < 100 || timeoutMilliseconds > 300_000) {
      fail("invalid_coordinator_configuration", "Coordinator color or timeout is invalid.");
    }
    this.url = websocketUrl(serverAddress, realtimePath);
    this.authenticationToken = authenticationToken;
    this.userId = userId.trim();
    this.userName = userName.trim();
    this.userColor = userColor.toUpperCase();
    this.projectId = projectId.trim();
    this.sessionId = sessionId.trim();
    this.timeoutMilliseconds = timeoutMilliseconds;
    this.socket = null;
    this.connectionId = "";
    this.projectTransferEnabled = false;
    this.snapshot = null;
    this.pendingConnect = null;
    this.pendingRequests = new Map();
  }

  async connect() {
    if (this.socket?.readyState === WebSocket.OPEN && this.projectTransferEnabled) {
      return this.snapshot;
    }
    const headers = this.authenticationToken
      ? { authorization: `Bearer ${this.authenticationToken}` }
      : undefined;
    const socket = new WebSocket(this.url, { headers, perMessageDeflate: false, maxPayload: 1_048_576 });
    this.socket = socket;
    const helloRequestId = randomUUID();
    let timer;
    const connected = new Promise((resolve, reject) => {
      this.pendingConnect = { resolve, reject, helloRequestId };
      timer = setTimeout(() => {
        socket.terminate();
        reject(new TeamForgePeerError("coordinator_timeout", "Coordinator handshake timed out."));
      }, this.timeoutMilliseconds);
      socket.once("open", () => {
        this.#send({
          type: "hello",
          protocolVersion: REALTIME_PROTOCOL_VERSION,
          requestId: helloRequestId,
          userName: this.userName,
          projectId: this.projectId,
          sessionId: this.sessionId,
          supportsPresence: false,
          supportsTransformSync: false,
          supportsProjectTransfer: true,
          userId: this.userId,
          userColor: this.userColor,
        });
      });
      socket.on("message", (data, isBinary) => this.#receive(data, isBinary));
      socket.once("unexpected-response", (_request, response) => {
        const status = Number(response?.statusCode) || 0;
        reject(new TeamForgePeerError(
          status === 401 || status === 403 ? "access_code_incorrect" : "coordinator_error",
          status === 401 || status === 403
            ? "Coordinator rejected the supplied access code."
            : `Coordinator rejected the WebSocket upgrade with HTTP ${status || "unknown"}.`,
          { httpStatus: status },
        ));
        // Handling unexpected-response replaces ws's default handshake cleanup.
        // Reject first so termination cannot replace the status-specific error.
        socket.terminate();
      });
      socket.once("error", (error) => reject(new TeamForgePeerError("coordinator_error", error.message)));
      socket.once("close", (code, reason) => {
        this.projectTransferEnabled = false;
        this.#rejectPendingRequests(new TeamForgePeerError(
          "coordinator_closed",
          "Coordinator closed before the request was acknowledged.",
        ));
        this.emit("close", { code, reason: reason.toString("utf8") });
        if (!this.snapshot) {
          reject(new TeamForgePeerError("coordinator_closed", "Coordinator closed before Project snapshot."));
        }
      });
    });
    try {
      return await connected;
    } finally {
      clearTimeout(timer);
      this.pendingConnect = null;
    }
  }

  #receive(data, isBinary) {
    if (isBinary) {
      this.socket?.close(1002, "binary_not_supported");
      return;
    }
    let message;
    try {
      message = JSON.parse(data.toString("utf8"));
    } catch {
      this.socket?.close(1002, "invalid_json");
      return;
    }
    if (!message || message.protocolVersion !== REALTIME_PROTOCOL_VERSION || typeof message.type !== "string") {
      this.socket?.close(1002, "invalid_envelope");
      return;
    }
    if (message.type === "hello_ack") {
      if (message.requestId !== this.pendingConnect?.helloRequestId ||
          typeof message.connectionId !== "string" || !message.projectTransferEnabled) {
        this.pendingConnect?.reject(
          new TeamForgePeerError("project_transfer_not_negotiated", "Server did not negotiate Project Transfer."),
        );
        this.socket?.close(1002, "project_transfer_not_negotiated");
        return;
      }
      this.connectionId = message.connectionId;
      this.projectTransferEnabled = true;
      this.emit("hello", message);
      return;
    }
    if (message.type === "project_registry_snapshot") {
      if (!this.projectTransferEnabled || message.projectId !== this.projectId || !Array.isArray(message.peers)) {
        this.socket?.close(1002, "invalid_project_snapshot");
        return;
      }
      if (message.projectUuid && !UUID_PATTERN.test(message.projectUuid)) {
        this.socket?.close(1002, "invalid_project_uuid");
        return;
      }
      this.snapshot = message;
      this.pendingConnect?.resolve(message);
      this.emit("snapshot", message);
      return;
    }
    if ([
      "project_peer_joined", "project_peer_updated", "project_peer_left",
      "project_baseline_changed", "project_sync_required",
    ].includes(message.type)) {
      if (message.type === "project_baseline_changed") {
        this.snapshot = this.snapshot ? { ...this.snapshot, projectUuid: message.baseline?.projectUuid, baseline: message.baseline } : this.snapshot;
        this.#resolveRequest(message.requestId, message, "publish");
      } else if (message.type === "project_peer_joined" || message.type === "project_peer_updated") {
        this.#resolveRequest(message.requestId, message, "announce");
      }
      this.emit(message.type, message);
      return;
    }
    if (message.type === "error") {
      const error = new TeamForgePeerError(
        message.code ?? "coordinator_protocol_error",
        message.message ?? "Coordinator returned an error.",
        { requestId: message.requestId ?? "" },
      );
      this.emit("protocolError", error);
      this.#rejectRequest(message.requestId, error);
      if (this.pendingConnect && !this.snapshot) {
        this.pendingConnect.reject(error);
      }
    }
  }

  #send(message) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      fail("coordinator_not_connected", "Coordinator WebSocket is not connected.");
    }
    this.socket.send(JSON.stringify(message));
  }

  #resolveRequest(requestId, value, expectedKind) {
    const pending = this.pendingRequests.get(requestId);
    if (!pending || pending.kind !== expectedKind) {
      return;
    }
    this.pendingRequests.delete(requestId);
    clearTimeout(pending.timer);
    pending.resolve(value);
  }

  #rejectRequest(requestId, error) {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      return;
    }
    this.pendingRequests.delete(requestId);
    clearTimeout(pending.timer);
    pending.reject(error);
  }

  #rejectPendingRequests(error) {
    for (const requestId of this.pendingRequests.keys()) {
      this.#rejectRequest(requestId, error);
    }
  }

  announce({
    descriptor,
    completeBaseline,
    availableChunkCount,
    totalChunkCount,
    endpoint,
    transferToken,
    ownerProofSignature = "",
  }) {
    const requestId = randomUUID();
    const acknowledgement = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#rejectRequest(requestId, new TeamForgePeerError(
          "coordinator_timeout",
          "Coordinator did not acknowledge the Project Peer announcement.",
          { requestId },
        ));
      }, this.timeoutMilliseconds);
      this.pendingRequests.set(requestId, { resolve, reject, timer, kind: "announce" });
    });
    try {
      this.#send({
      type: "project_peer_announce",
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      requestId,
      userId: this.userId,
      ...descriptorCoordinatorFields(descriptor),
      completeBaseline,
      availableChunkCount,
      totalChunkCount,
      endpoint,
      transferToken,
      ownerProofSignature,
      });
    } catch (error) {
      this.#rejectRequest(requestId, error);
    }
    return acknowledgement.then((message) => {
      const peer = message?.peer;
      if (!peer || peer.projectUuid !== descriptor.projectUuid ||
          peer.baselineRevision !== descriptor.baselineRevision ||
          peer.manifestHash !== descriptor.manifestHash || peer.endpoint !== endpoint ||
          peer.transferToken !== transferToken) {
        throw new TeamForgePeerError(
          "invalid_announce_acknowledgement",
          "Coordinator acknowledged a different Project Peer advertisement.",
          { requestId },
        );
      }
      return message;
    });
  }

  publishBaseline(descriptor) {
    const requestId = randomUUID();
    const acknowledgement = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#rejectRequest(requestId, new TeamForgePeerError(
          "coordinator_timeout",
          "Coordinator did not acknowledge the Baseline publication.",
          { requestId },
        ));
      }, this.timeoutMilliseconds);
      this.pendingRequests.set(requestId, { resolve, reject, timer, kind: "publish" });
    });
    try {
      this.#send({
      type: "project_baseline_publish",
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      requestId,
      userId: this.userId,
      ...descriptorCoordinatorFields(descriptor),
      });
    } catch (error) {
      this.#rejectRequest(requestId, error);
    }
    return acknowledgement.then((message) => {
      const baseline = message?.baseline;
      if (!baseline || baseline.projectUuid !== descriptor.projectUuid ||
          baseline.baselineRevision !== descriptor.baselineRevision ||
          baseline.manifestHash !== descriptor.manifestHash ||
          baseline.descriptorHash !== descriptor.descriptorHash) {
        throw new TeamForgePeerError(
          "invalid_publish_acknowledgement",
          "Coordinator acknowledged a different Baseline descriptor.",
          { requestId },
        );
      }
      return message;
    });
  }

  close() {
    const socket = this.socket;
    this.socket = null;
    this.#rejectPendingRequests(new TeamForgePeerError(
      "coordinator_closed",
      "Coordinator client was closed before the request completed.",
    ));
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      socket.close(1000, "client_close");
    }
  }
}

export { descriptorCoordinatorFields, websocketUrl };
