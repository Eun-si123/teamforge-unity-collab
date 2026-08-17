import { fork as nodeFork } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRODUCT_VERSION,
  REALTIME_PROTOCOL_VERSION,
  SHA256_PATTERN,
  UUID_PATTERN,
} from "./constants.mjs";
import { normalizeOrchestratorFailure } from "./orchestrator-contract.mjs";
import { inspectPreflight, probePort } from "./unified-preflight.mjs";

const CHANNEL = "teamforge-lifecycle-v1";
const MAXIMUM_HEALTH_BYTES = 65_536;
const DEFAULT_TIMEOUT_MILLISECONDS = 5_000;

export class TeamForgeLifecycleError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "TeamForgeLifecycleError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new TeamForgeLifecycleError(code, message, details);
}

function validPort(value, allowZero = false) {
  return Number.isInteger(value) && value >= (allowZero ? 0 : 1) && value <= 65_535;
}

function normalizePath(value, fallback) {
  const candidate = String(value ?? fallback).trim();
  if (!candidate || candidate.includes("?") || candidate.includes("#")) {
    fail("invalid_lifecycle_config", "Lifecycle HTTP paths must be non-empty and contain no query or fragment.");
  }
  const normalized = `/${candidate.replace(/^\/+|\/+$/gu, "")}`;
  if (normalized === "/") fail("invalid_lifecycle_config", "Lifecycle paths cannot be the server root.");
  return normalized;
}

function displayHost(host) {
  if (host === "0.0.0.0") return "127.0.0.1";
  if (host === "::") return "::1";
  return host;
}

function httpUrl(host, port, requestPath) {
  const selected = displayHost(host);
  const authority = selected.includes(":") ? `[${selected}]` : selected;
  return `http://${authority}:${port}${requestPath}`;
}

function publicHandle(managerId, record, reused) {
  return Object.freeze({
    managerId,
    handleId: record.handleId,
    kind: record.kind,
    instanceId: record.instanceId,
    owned: record.owned,
    reused,
    pid: record.owned ? record.child?.pid ?? null : null,
    endpoint: record.endpoint,
    identity: record.identity,
  });
}

function externalHandle(managerId, kind, endpoint, identity) {
  return Object.freeze({
    managerId,
    handleId: randomUUID(),
    kind,
    instanceId: identity.lifecycleInstanceId ?? null,
    owned: false,
    reused: true,
    pid: null,
    endpoint,
    identity: Object.freeze({ ...identity }),
  });
}

function failure(code, message) {
  return normalizeOrchestratorFailure({ code, message });
}

async function responseTextBounded(response) {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAXIMUM_HEALTH_BYTES) {
    fail("server_health_unverified", "Coordinator health response exceeds the bounded identity limit.");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAXIMUM_HEALTH_BYTES) {
    fail("server_health_unverified", "Coordinator health response exceeds the bounded identity limit.");
  }
  return new TextDecoder().decode(bytes);
}

export async function probeCoordinatorHealth({
  host = "127.0.0.1",
  port,
  healthPath = "/health",
  wsPath = "/ws",
  authToken = "",
  timeoutMilliseconds = 1_000,
  fetchImplementation = globalThis.fetch,
} = {}) {
  if (!validPort(port)) fail("invalid_lifecycle_config", "Coordinator health probe requires a fixed port.");
  const expectedHealthPath = normalizePath(healthPath, "/health");
  const expectedWsPath = normalizePath(wsPath, "/ws");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMilliseconds);
  timer.unref?.();
  let response;
  try {
    response = await fetchImplementation(httpUrl(host, port, expectedHealthPath), {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
  } catch {
    return Object.freeze({ state: "unverified", compatible: false, identity: null });
  } finally {
    clearTimeout(timer);
  }
  if (response.status !== 200 || !/^application\/json\b/iu.test(response.headers.get("content-type") ?? "")) {
    return Object.freeze({ state: "unverified", compatible: false, identity: null });
  }
  let identity;
  try {
    identity = JSON.parse(await responseTextBounded(response));
  } catch {
    return Object.freeze({ state: "unverified", compatible: false, identity: null });
  }
  const structurallyValid = identity && typeof identity === "object" && !Array.isArray(identity) &&
    identity.status === "ok" && identity.service === "unity-teamforge-server" &&
    typeof identity.serverVersion === "string" && Number.isInteger(identity.protocolVersion) &&
    typeof identity.healthPath === "string" && typeof identity.wsPath === "string" &&
    typeof identity.authenticationRequired === "boolean" &&
    (identity.lifecycleInstanceId === null || typeof identity.lifecycleInstanceId === "string");
  if (!structurallyValid) {
    return Object.freeze({ state: "unverified", compatible: false, identity: null });
  }
  const compatible = identity.serverVersion === PRODUCT_VERSION &&
    identity.protocolVersion === REALTIME_PROTOCOL_VERSION &&
    identity.healthPath === expectedHealthPath && identity.wsPath === expectedWsPath;
  if (!compatible) {
    return Object.freeze({ state: "incompatible", compatible: false, identity: Object.freeze(identity) });
  }
  if (identity.authenticationRequired && !authToken) {
    return Object.freeze({ state: "authentication_required", compatible: false, identity: Object.freeze(identity) });
  }
  return Object.freeze({ state: "compatible", compatible: true, identity: Object.freeze(identity) });
}

function waitForChildMessage(child, predicate, timeoutMilliseconds, timeoutCode) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("error", onError);
      child.off("exit", onExit);
      callback(value);
    };
    const onMessage = (message) => {
      if (predicate(message)) finish(resolve, message);
    };
    const onError = () => finish(
      reject,
      new TeamForgeLifecycleError("lifecycle_child_failed", "Owned lifecycle child reported a process error."),
    );
    const onExit = (code, signal) => finish(
      reject,
      new TeamForgeLifecycleError(
        "lifecycle_child_exited",
        "Owned lifecycle child exited before completing the authenticated request.",
        { exitCode: code, signal: signal ?? null },
      ),
    );
    const timer = setTimeout(() => finish(
      reject,
      new TeamForgeLifecycleError(timeoutCode, "Owned lifecycle child did not respond before the timeout."),
    ), timeoutMilliseconds);
    timer.unref?.();
    child.on("message", onMessage);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

function sendAuthenticated(record, type, timeoutMilliseconds) {
  const requestId = randomUUID();
  const response = waitForChildMessage(
    record.child,
    (message) => message?.channel === CHANNEL && message.instanceId === record.instanceId &&
      message.requestId === requestId &&
      (message.type === (type === "status" ? "status" : "stopped") || message.type === "failure"),
    timeoutMilliseconds,
    type === "status" ? "lifecycle_status_timeout" : "graceful_stop_timeout",
  );
  record.child.send({
    channel: CHANNEL,
    type,
    instanceId: record.instanceId,
    token: record.token,
    requestId,
  }, (error) => {
    if (error) record.lastSendError = error.code ?? "ipc_send_failed";
  });
  return response;
}

function waitForClose(child, timeoutMilliseconds) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new TeamForgeLifecycleError("graceful_stop_timeout", "Owned child did not exit after stop.")),
      timeoutMilliseconds,
    );
    timer.unref?.();
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal: signal ?? null });
    });
  });
}

function seedCoreIdentity(value) {
  if (!value || typeof value !== "object" ||
      typeof value.projectId !== "string" || !value.projectId.trim() || value.projectId.length > 128 ||
      !UUID_PATTERN.test(value.projectUuid ?? "") ||
      typeof value.sessionId !== "string" || !value.sessionId.trim() || value.sessionId.length > 128 ||
      !Number.isInteger(value.baselineRevision) || value.baselineRevision < 1 ||
      !SHA256_PATTERN.test(value.manifestHash ?? "")) {
    fail("invalid_seed_identity", "Seed ownership requires exact Project, Session, revision, and manifest identity.");
  }
  return Object.freeze({
    projectId: value.projectId.trim(),
    projectUuid: value.projectUuid.toLowerCase(),
    sessionId: value.sessionId.trim(),
    baselineRevision: value.baselineRevision,
    manifestHash: value.manifestHash,
  });
}

function sameSeedCore(left, right) {
  return left.projectId === right.projectId && left.projectUuid === right.projectUuid &&
    left.sessionId === right.sessionId && left.baselineRevision === right.baselineRevision &&
    left.manifestHash === right.manifestHash;
}

function sameSeedIdentity(left, right) {
  return sameSeedCore(left, right) && left.endpoint === right.endpoint &&
    left.boundHost === right.boundHost && left.boundPort === right.boundPort &&
    left.transferTokenFingerprint === right.transferTokenFingerprint;
}

function seedKey(identity) {
  return [
    identity.projectId,
    identity.projectUuid,
    identity.sessionId,
    identity.baselineRevision,
    identity.manifestHash,
  ].join("\n");
}

function optionValue(arguments_, name) {
  for (let index = 0; index < arguments_.length; index += 1) {
    if (arguments_[index] === `--${name}`) return arguments_[index + 1];
    if (arguments_[index].startsWith(`--${name}=`)) return arguments_[index].slice(name.length + 3);
  }
  return undefined;
}

function validateSeedArguments(arguments_, port) {
  if (!Array.isArray(arguments_) || arguments_[0] !== "seed" ||
      arguments_.some((value) => typeof value !== "string" || value.includes("\u0000"))) {
    fail("invalid_seed_lifecycle_command", "Lifecycle manager accepts only the existing seed CLI command.");
  }
  if (arguments_.some((value) => value === "--once" || value.startsWith("--auth-token"))) {
    fail(
      "invalid_seed_lifecycle_command",
      "Lifecycle Seed cannot use --once or command-line credentials; pass credentials through the child environment.",
    );
  }
  for (const name of ["managed-root", "launch-settings"] ) {
    const value = optionValue(arguments_, name);
    if (value !== undefined && !path.isAbsolute(value)) {
      fail("invalid_seed_lifecycle_command", `--${name} must be absolute for lifecycle management.`);
    }
  }
  const commandPort = optionValue(arguments_, "port");
  if (commandPort === undefined || Number(commandPort) !== port) {
    fail("invalid_seed_lifecycle_command", "Seed CLI --port must exactly match the lifecycle request.");
  }
}

function validatePublishingSeedArguments(arguments_, port) {
  if (!Array.isArray(arguments_) || arguments_[0] !== "publish" ||
      arguments_.some((value) => typeof value !== "string" || value.includes("\u0000"))) {
    fail("invalid_seed_lifecycle_command", "Publishing Seed lifecycle accepts only the existing publish CLI command.");
  }
  if (arguments_.some((value) => value === "--once" || value === "--confirm-publish" ||
      value.startsWith("--auth-token"))) {
    fail(
      "invalid_seed_lifecycle_command",
      "Publishing Seed confirmation is authenticated IPC only; --once, --confirm-publish, and command-line credentials are forbidden.",
    );
  }
  const launchSettings = optionValue(arguments_, "launch-settings");
  if (!launchSettings || !path.isAbsolute(launchSettings)) {
    fail("invalid_seed_lifecycle_command", "Publishing Seed requires an absolute Unity launch-settings path.");
  }
  const commandPort = optionValue(arguments_, "port");
  if (commandPort === undefined || Number(commandPort) !== port) {
    fail("invalid_seed_lifecycle_command", "Publish CLI --port must exactly match the lifecycle request.");
  }
}

function drain(stream) {
  if (!stream) return;
  stream.on("data", () => {});
}

export class TeamForgeProcessLifecycleManager {
  constructor({
    workspaceRoot,
    forkProcess = nodeFork,
    fetchImplementation = globalThis.fetch,
    portProbe = probePort,
    preflight = inspectPreflight,
    platform = process.platform,
  } = {}) {
    if (!workspaceRoot) fail("invalid_lifecycle_config", "Lifecycle manager requires a workspace root.");
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.managerId = randomUUID();
    this.forkProcess = forkProcess;
    this.fetchImplementation = fetchImplementation;
    this.portProbe = portProbe;
    this.preflight = preflight;
    this.platform = platform;
    this.records = new Map();
    this.coordinatorKeys = new Map();
    this.seedKeys = new Map();
  }

  async #runtime() {
    const result = await this.preflight({
      workspaceRoot: this.workspaceRoot,
      serverPort: 0,
      seedPort: 0,
    });
    const blocking = result.failures.find((item) => item.kind === "dependencies_not_ready");
    if (blocking) fail(blocking.rawCode, blocking.message, { failure: blocking });
    return result;
  }

  #spawn(modulePath, arguments_, env, nodeExecutable) {
    const child = this.forkProcess(modulePath, arguments_, {
      cwd: this.workspaceRoot,
      env,
      execPath: nodeExecutable,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      windowsHide: true,
      serialization: "json",
    });
    drain(child.stdout);
    drain(child.stderr);
    return child;
  }

  async #ownedStatus(record, timeoutMilliseconds) {
    if (record.child.exitCode !== null || record.child.signalCode !== null || !record.child.connected) {
      return null;
    }
    try {
      const message = await sendAuthenticated(record, "status", timeoutMilliseconds);
      return message.type === "status" && !message.stopping ? message : null;
    } catch {
      return null;
    }
  }

  async ensureCoordinator({
    host = "127.0.0.1",
    port = 5080,
    healthPath = "/health",
    wsPath = "/ws",
    authToken = "",
    timeoutMilliseconds = DEFAULT_TIMEOUT_MILLISECONDS,
    environment = {},
  } = {}) {
    if (typeof host !== "string" || !host.trim() || !validPort(port, true)) {
      fail("invalid_lifecycle_config", "Coordinator host/port are invalid.");
    }
    const selectedHost = host.trim();
    const selectedHealthPath = normalizePath(healthPath, "/health");
    const selectedWsPath = normalizePath(wsPath, "/ws");
    if (selectedHealthPath === selectedWsPath) {
      fail("invalid_lifecycle_config", "Coordinator health and WebSocket paths must differ.");
    }
    const runtime = await this.#runtime();
    const key = `${selectedHost}\n${port}\n${selectedHealthPath}\n${selectedWsPath}\n${Boolean(authToken)}`;
    const existingId = this.coordinatorKeys.get(key);
    const existing = existingId ? this.records.get(existingId) : null;
    if (existing) {
      const status = await this.#ownedStatus(existing, timeoutMilliseconds);
      if (status) {
        const health = await probeCoordinatorHealth({
          host: existing.endpoint.host,
          port: existing.endpoint.port,
          healthPath: selectedHealthPath,
          wsPath: selectedWsPath,
          authToken,
          timeoutMilliseconds,
          fetchImplementation: this.fetchImplementation,
        });
        if (health.compatible && health.identity.lifecycleInstanceId === existing.instanceId) {
          return publicHandle(this.managerId, existing, true);
        }
      }
      this.records.delete(existing.handleId);
      this.coordinatorKeys.delete(key);
    }

    if (port > 0) {
      const portState = await this.portProbe({
        host: selectedHost,
        port,
        timeoutMilliseconds: Math.min(timeoutMilliseconds, 1_000),
      });
      if (portState.state !== "no_listener") {
        if (portState.state !== "occupied_unverified") {
          fail("port_conflict", `Coordinator port ${selectedHost}:${port} cannot be safely classified.`);
        }
        const health = await probeCoordinatorHealth({
          host: selectedHost,
          port,
          healthPath: selectedHealthPath,
          wsPath: selectedWsPath,
          authToken,
          timeoutMilliseconds,
          fetchImplementation: this.fetchImplementation,
        });
        if (health.state === "authentication_required") {
          fail("server_authentication_unavailable", "Compatible TeamForge Server requires authentication.");
        }
        if (!health.compatible) {
          fail("port_conflict", "Port accepts connections but verified compatible TeamForge health identity is absent.");
        }
        return externalHandle(this.managerId, "coordinator", Object.freeze({
          host: selectedHost,
          port,
          healthPath: selectedHealthPath,
          wsPath: selectedWsPath,
          url: httpUrl(selectedHost, port, ""),
        }), health.identity);
      }
    }

    const instanceId = randomUUID();
    const token = randomBytes(32).toString("base64url");
    const childPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..", "..", "server", "src", "lifecycle-child.mjs",
    );
    const env = {
      ...process.env,
      ...environment,
      TEAMFORGE_HOST: selectedHost,
      TEAMFORGE_PORT: String(port),
      TEAMFORGE_HEALTH_PATH: selectedHealthPath,
      TEAMFORGE_WS_PATH: selectedWsPath,
      TEAMFORGE_AUTH_TOKEN: String(authToken),
      TEAMFORGE_LIFECYCLE_INSTANCE_ID: instanceId,
      TEAMFORGE_LIFECYCLE_TOKEN: token,
    };
    const child = this.#spawn(childPath, [], env, runtime.runtimeStrategy.nodeExecutable);
    const ready = await waitForChildMessage(
      child,
      (message) => message?.channel === CHANNEL && message.type === "ready" &&
        message.kind === "coordinator" && message.instanceId === instanceId,
      timeoutMilliseconds,
      "coordinator_start_timeout",
    );
    const endpoint = Object.freeze({
      host: ready.endpoint.host,
      port: ready.endpoint.port,
      healthPath: ready.endpoint.healthPath,
      wsPath: ready.endpoint.wsPath,
      url: httpUrl(ready.endpoint.host, ready.endpoint.port, ""),
    });
    const health = await probeCoordinatorHealth({
      host: endpoint.host,
      port: endpoint.port,
      healthPath: endpoint.healthPath,
      wsPath: endpoint.wsPath,
      authToken,
      timeoutMilliseconds,
      fetchImplementation: this.fetchImplementation,
    });
    if (!health.compatible || health.identity.lifecycleInstanceId !== instanceId) {
      const temporary = { child, token, instanceId };
      await sendAuthenticated(temporary, "stop", timeoutMilliseconds).catch(() => {});
      fail("lifecycle_identity_mismatch", "Started Coordinator did not present its exact lifecycle identity.");
    }
    const record = {
      handleId: randomUUID(),
      kind: "coordinator",
      instanceId,
      token,
      child,
      owned: true,
      endpoint,
      identity: health.identity,
      key,
    };
    this.records.set(record.handleId, record);
    this.coordinatorKeys.set(key, record.handleId);
    return publicHandle(this.managerId, record, false);
  }

  async ensureSeed({
    arguments: arguments_,
    expectedIdentity,
    host = "127.0.0.1",
    port = 0,
    timeoutMilliseconds = DEFAULT_TIMEOUT_MILLISECONDS,
    environment = {},
  } = {}) {
    if (typeof host !== "string" || !host.trim() || !validPort(port, true)) {
      fail("invalid_lifecycle_config", "Seed host/port are invalid.");
    }
    validateSeedArguments(arguments_, port);
    const expected = seedCoreIdentity(expectedIdentity);
    const runtime = await this.#runtime();
    const key = seedKey(expected);
    const existingId = this.seedKeys.get(key);
    const existing = existingId ? this.records.get(existingId) : null;
    if (existing) {
      const status = await this.#ownedStatus(existing, timeoutMilliseconds);
      if (status?.identity && sameSeedIdentity(status.identity, existing.identity)) {
        return publicHandle(this.managerId, existing, true);
      }
      this.records.delete(existing.handleId);
      this.seedKeys.delete(key);
    }

    if (port > 0) {
      const portState = await this.portProbe({
        host,
        port,
        timeoutMilliseconds: Math.min(timeoutMilliseconds, 1_000),
      });
      if (portState.state !== "no_listener") {
        const ownedAtPort = Array.from(this.records.values()).find(
          (record) => record.kind === "seed" && record.owned && record.identity?.boundPort === port &&
            record.identity?.boundHost === host,
        );
        if (ownedAtPort && sameSeedCore(ownedAtPort.identity, expected)) {
          const status = await this.#ownedStatus(ownedAtPort, timeoutMilliseconds);
          if (status?.identity && sameSeedIdentity(status.identity, ownedAtPort.identity)) {
            return publicHandle(this.managerId, ownedAtPort, true);
          }
        }
        fail("port_conflict", "Direct Seed port is occupied without exact orchestrator-owned Seed identity.");
      }
    }

    const instanceId = randomUUID();
    const token = randomBytes(32).toString("base64url");
    const childPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "cli.mjs");
    const env = {
      ...process.env,
      ...environment,
      TEAMFORGE_LIFECYCLE_INSTANCE_ID: instanceId,
      TEAMFORGE_LIFECYCLE_TOKEN: token,
    };
    const child = this.#spawn(childPath, arguments_, env, runtime.runtimeStrategy.nodeExecutable);
    let ready;
    try {
      ready = await waitForChildMessage(
        child,
        (message) => message?.channel === CHANNEL &&
          (message.type === "ready" || message.type === "failure") &&
          message.kind === "seed" && message.instanceId === instanceId,
        timeoutMilliseconds,
        "seed_start_timeout",
      );
    } catch (error) {
      if (port > 0) {
        fail("port_conflict", "Direct Seed could not bind or prove ownership on the requested port.", {
          causeCode: error.code,
        });
      }
      throw error;
    }
    if (ready.type === "failure") {
      fail(ready.code ?? "lifecycle_child_failed", "Direct Seed child failed before readiness.");
    }
    if (!sameSeedCore(ready.identity ?? {}, expected) || !validPort(ready.identity.boundPort) ||
        ready.identity.boundHost !== host || (port > 0 && ready.identity.boundPort !== port) ||
        !SHA256_PATTERN.test(ready.identity.transferTokenFingerprint ?? "")) {
      const temporary = { child, token, instanceId };
      await sendAuthenticated(temporary, "stop", timeoutMilliseconds).catch(() => {});
      fail("lifecycle_identity_mismatch", "Started Seed did not report the exact requested ownership identity.");
    }
    const identity = Object.freeze({ ...ready.identity });
    const endpoint = Object.freeze({
      host: identity.boundHost,
      port: identity.boundPort,
      url: identity.endpoint,
    });
    const record = {
      handleId: randomUUID(),
      kind: "seed",
      instanceId,
      token,
      child,
      owned: true,
      endpoint,
      identity,
      key,
    };
    this.records.set(record.handleId, record);
    this.seedKeys.set(key, record.handleId);
    return publicHandle(this.managerId, record, false);
  }

  async ensurePublishingSeed({
    arguments: arguments_,
    expectedIdentity,
    publishReviewFingerprint,
    host = "127.0.0.1",
    port = 0,
    timeoutMilliseconds = DEFAULT_TIMEOUT_MILLISECONDS,
    environment = {},
  } = {}) {
    if (typeof host !== "string" || !host.trim() || !validPort(port, true) ||
        !SHA256_PATTERN.test(publishReviewFingerprint ?? "")) {
      fail("invalid_lifecycle_config", "Publishing Seed host, port, or review fingerprint is invalid.");
    }
    validatePublishingSeedArguments(arguments_, port);
    const expected = seedCoreIdentity(expectedIdentity);
    const runtime = await this.#runtime();
    if (this.seedKeys.has(seedKey(expected))) {
      fail("source_changed", "The exact Baseline is already managed; create a fresh Publish review before another commit.");
    }
    if (port > 0) {
      const portState = await this.portProbe({
        host,
        port,
        timeoutMilliseconds: Math.min(timeoutMilliseconds, 1_000),
      });
      if (portState.state !== "no_listener") {
        fail("port_conflict", "Direct Seed publish port is occupied without exact orchestrator ownership.");
      }
    }

    const instanceId = randomUUID();
    const token = randomBytes(32).toString("base64url");
    const childPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "cli.mjs");
    const env = {
      ...process.env,
      ...environment,
      TEAMFORGE_LIFECYCLE_INSTANCE_ID: instanceId,
      TEAMFORGE_LIFECYCLE_TOKEN: token,
    };
    const child = this.#spawn(childPath, arguments_, env, runtime.runtimeStrategy.nodeExecutable);
    const temporary = { child, token, instanceId };
    const reviewMessage = await waitForChildMessage(
      child,
      (message) => message?.channel === CHANNEL && message.instanceId === instanceId &&
        message.kind === "seed" && (message.type === "publish_review" || message.type === "failure"),
      timeoutMilliseconds,
      "publish_review_timeout",
    );
    if (reviewMessage.type === "failure") {
      fail(reviewMessage.code ?? "lifecycle_child_failed", "Publishing Seed failed before review confirmation.");
    }
    if (reviewMessage.fingerprint !== publishReviewFingerprint) {
      child.send({
        channel: CHANNEL,
        type: "cancel_publish",
        instanceId,
        token,
      }, () => {});
      await waitForClose(child, timeoutMilliseconds).catch(() => {});
      fail("source_changed", "Source or Publish base changed after review; re-review is required.");
    }

    const readyPromise = waitForChildMessage(
      child,
      (message) => message?.channel === CHANNEL && message.instanceId === instanceId &&
        message.kind === "seed" && (message.type === "ready" || message.type === "failure"),
      timeoutMilliseconds,
      "seed_start_timeout",
    );
    child.send({
      channel: CHANNEL,
      type: "confirm_publish",
      instanceId,
      token,
      confirmation: "PUBLISH",
      fingerprint: publishReviewFingerprint,
    }, () => {});
    const ready = await readyPromise;
    if (ready.type === "failure") {
      fail(ready.code ?? "lifecycle_child_failed", "Publishing Seed failed before readiness.");
    }
    if (ready.published !== true || !sameSeedCore(ready.identity ?? {}, expected) ||
        !validPort(ready.identity.boundPort) || ready.identity.boundHost !== host ||
        (port > 0 && ready.identity.boundPort !== port) ||
        !SHA256_PATTERN.test(ready.identity.transferTokenFingerprint ?? "")) {
      await sendAuthenticated(temporary, "stop", timeoutMilliseconds).catch(() => {});
      fail("lifecycle_identity_mismatch", "Published Seed did not prove the exact approved Baseline identity.");
    }
    const identity = Object.freeze({ ...ready.identity });
    const key = seedKey(identity);
    const record = {
      handleId: randomUUID(),
      kind: "seed",
      instanceId,
      token,
      child,
      owned: true,
      endpoint: Object.freeze({ host: identity.boundHost, port: identity.boundPort, url: identity.endpoint }),
      identity,
      key,
    };
    this.records.set(record.handleId, record);
    this.seedKeys.set(key, record.handleId);
    return publicHandle(this.managerId, record, false);
  }

  async #stop(handle, expectedKind, {
    timeoutMilliseconds = DEFAULT_TIMEOUT_MILLISECONDS,
    forceOwnedAfterTimeout = false,
  } = {}) {
    if (!handle || handle.kind !== expectedKind || handle.managerId !== this.managerId || !handle.owned) {
      return Object.freeze({
        state: "needs_action",
        stopped: false,
        owned: false,
        failure: failure("operation_cancelled", "Lifecycle stop refused because ownership is not proven."),
      });
    }
    const record = this.records.get(handle.handleId);
    if (!record || record.instanceId !== handle.instanceId || record.kind !== expectedKind) {
      return Object.freeze({
        state: "needs_action",
        stopped: false,
        owned: false,
        failure: failure("operation_cancelled", "Lifecycle stop refused because ownership is stale or unknown."),
      });
    }
    try {
      const stopped = await sendAuthenticated(record, "stop", timeoutMilliseconds);
      if (stopped.type === "failure" || stopped.graceful !== true) {
        fail("lifecycle_child_failed", "Owned child did not confirm graceful shutdown.");
      }
      const closed = await waitForClose(record.child, timeoutMilliseconds);
      this.#forget(record);
      return Object.freeze({
        state: "idle",
        stopped: true,
        owned: true,
        graceful: true,
        forced: false,
        method: "authenticated_ipc",
        platform: this.platform,
        exitCode: closed.code,
        signal: closed.signal,
      });
    } catch (error) {
      if (!forceOwnedAfterTimeout) throw error;
      record.child.kill("SIGKILL");
      const closed = await waitForClose(record.child, timeoutMilliseconds);
      this.#forget(record);
      return Object.freeze({
        state: "idle",
        stopped: true,
        owned: true,
        graceful: false,
        forced: true,
        method: "owned_child_force_fallback",
        platform: this.platform,
        exitCode: closed.code,
        signal: closed.signal,
      });
    }
  }

  #forget(record) {
    this.records.delete(record.handleId);
    if (record.kind === "coordinator" && this.coordinatorKeys.get(record.key) === record.handleId) {
      this.coordinatorKeys.delete(record.key);
    }
    if (record.kind === "seed" && this.seedKeys.get(record.key) === record.handleId) {
      this.seedKeys.delete(record.key);
    }
  }

  stopCoordinator(handle, options) {
    return this.#stop(handle, "coordinator", options);
  }

  stopSeed(handle, options) {
    return this.#stop(handle, "seed", options);
  }

  async stopAll(options) {
    const results = [];
    for (const record of Array.from(this.records.values()).filter((item) => item.owned)) {
      results.push(await this.#stop(publicHandle(this.managerId, record, true), record.kind, options));
    }
    return Object.freeze(results);
  }
}
