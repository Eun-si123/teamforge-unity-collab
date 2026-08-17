import {
  LEGACY_SERVER_CONNECTION_DEFAULTS,
  legacyServerProfile,
} from "./policy-profile.mjs";

const DEFAULTS = LEGACY_SERVER_CONNECTION_DEFAULTS;

function parseInteger(name, rawValue, fallback, minimum, maximum) {
  if (rawValue === undefined || rawValue === "") {
    return fallback;
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }

  return value;
}

export function normalizeHttpPath(value, fallback) {
  const candidate = (value ?? fallback).trim();
  if (candidate.length === 0 || candidate.includes("?") || candidate.includes("#")) {
    throw new Error("Endpoint paths must be non-empty and cannot contain a query or fragment.");
  }

  const normalized = `/${candidate.replace(/^\/+|\/+$/g, "")}`;
  if (normalized === "/") {
    throw new Error("Endpoint paths cannot be the server root.");
  }

  return normalized;
}

export function profileFromEnv(env = process.env) {
  return legacyServerProfile({
    host: (env.TEAMFORGE_HOST ?? DEFAULTS.host).trim() || DEFAULTS.host,
    port: parseInteger("TEAMFORGE_PORT", env.TEAMFORGE_PORT, DEFAULTS.port, 0, 65_535),
    wsPath: normalizeHttpPath(env.TEAMFORGE_WS_PATH, DEFAULTS.wsPath),
    healthPath: normalizeHttpPath(env.TEAMFORGE_HEALTH_PATH, DEFAULTS.healthPath),
    maxMessageBytes: parseInteger(
      "TEAMFORGE_MAX_MESSAGE_BYTES",
      env.TEAMFORGE_MAX_MESSAGE_BYTES,
      DEFAULTS.maxMessageBytes,
      1_024,
      16_777_216,
    ),
    maxConnections: parseInteger(
      "TEAMFORGE_MAX_CONNECTIONS",
      env.TEAMFORGE_MAX_CONNECTIONS,
      DEFAULTS.maxConnections,
      1,
      10_000,
    ),
    rateLimitPerSecond: parseInteger(
      "TEAMFORGE_RATE_LIMIT_PER_SECOND",
      env.TEAMFORGE_RATE_LIMIT_PER_SECOND,
      DEFAULTS.rateLimitPerSecond,
      1,
      10_000,
    ),
    lockLeaseMilliseconds: parseInteger(
      "TEAMFORGE_LOCK_LEASE_MS",
      env.TEAMFORGE_LOCK_LEASE_MS,
      DEFAULTS.lockLeaseMilliseconds,
      1_000,
      300_000,
    ),
    maxRecentOperations: parseInteger(
      "TEAMFORGE_MAX_RECENT_OPERATIONS",
      env.TEAMFORGE_MAX_RECENT_OPERATIONS,
      DEFAULTS.maxRecentOperations,
      128,
      100_000,
    ),
    maxRetainedTransforms: parseInteger(
      "TEAMFORGE_MAX_RETAINED_TRANSFORMS",
      env.TEAMFORGE_MAX_RETAINED_TRANSFORMS,
      DEFAULTS.maxRetainedTransforms,
      1,
      100_000,
    ),
    maxHierarchyObjects: parseInteger(
      "TEAMFORGE_MAX_HIERARCHY_OBJECTS",
      env.TEAMFORGE_MAX_HIERARCHY_OBJECTS,
      DEFAULTS.maxHierarchyObjects,
      1,
      100_000,
    ),
    maxHierarchyTombstones: parseInteger(
      "TEAMFORGE_MAX_HIERARCHY_TOMBSTONES",
      env.TEAMFORGE_MAX_HIERARCHY_TOMBSTONES,
      DEFAULTS.maxHierarchyTombstones,
      1,
      200_000,
    ),
    maxHierarchySnapshotBytes: parseInteger(
      "TEAMFORGE_MAX_HIERARCHY_SNAPSHOT_BYTES",
      env.TEAMFORGE_MAX_HIERARCHY_SNAPSHOT_BYTES,
      DEFAULTS.maxHierarchySnapshotBytes,
      16_384,
      16_777_216,
    ),
    maxHierarchyDepth: parseInteger(
      "TEAMFORGE_MAX_HIERARCHY_DEPTH",
      env.TEAMFORGE_MAX_HIERARCHY_DEPTH,
      DEFAULTS.maxHierarchyDepth,
      1,
      4_096,
    ),
    maxHierarchyNameLength: parseInteger(
      "TEAMFORGE_MAX_HIERARCHY_NAME_LENGTH",
      env.TEAMFORGE_MAX_HIERARCHY_NAME_LENGTH,
      DEFAULTS.maxHierarchyNameLength,
      1,
      1_024,
    ),
    maxLocksPerConnection: parseInteger(
      "TEAMFORGE_MAX_LOCKS_PER_CONNECTION",
      env.TEAMFORGE_MAX_LOCKS_PER_CONNECTION,
      DEFAULTS.maxLocksPerConnection,
      1,
      10_000,
    ),
    maxLocksPerSession: parseInteger(
      "TEAMFORGE_MAX_LOCKS_PER_SESSION",
      env.TEAMFORGE_MAX_LOCKS_PER_SESSION,
      DEFAULTS.maxLocksPerSession,
      1,
      100_000,
    ),
    maxSnapshotBytes: parseInteger(
      "TEAMFORGE_MAX_SNAPSHOT_BYTES",
      env.TEAMFORGE_MAX_SNAPSHOT_BYTES,
      DEFAULTS.maxSnapshotBytes,
      16_384,
      16_777_216,
    ),
    maxBufferedBytes: parseInteger(
      "TEAMFORGE_MAX_BUFFERED_BYTES",
      env.TEAMFORGE_MAX_BUFFERED_BYTES,
      DEFAULTS.maxBufferedBytes,
      16_384,
      16_777_216,
    ),
    helloTimeoutMilliseconds: parseInteger(
      "TEAMFORGE_HELLO_TIMEOUT_MS",
      env.TEAMFORGE_HELLO_TIMEOUT_MS,
      DEFAULTS.helloTimeoutMilliseconds,
      1_000,
      120_000,
    ),
    heartbeatIntervalMilliseconds: parseInteger(
      "TEAMFORGE_HEARTBEAT_INTERVAL_MS",
      env.TEAMFORGE_HEARTBEAT_INTERVAL_MS,
      DEFAULTS.heartbeatIntervalMilliseconds,
      1_000,
      300_000,
    ),
    heartbeatTimeoutMilliseconds: parseInteger(
      "TEAMFORGE_HEARTBEAT_TIMEOUT_MS",
      env.TEAMFORGE_HEARTBEAT_TIMEOUT_MS,
      DEFAULTS.heartbeatTimeoutMilliseconds,
      2_000,
      900_000,
    ),
    maxProjectRegistries: parseInteger(
      "TEAMFORGE_MAX_PROJECT_REGISTRIES",
      env.TEAMFORGE_MAX_PROJECT_REGISTRIES,
      DEFAULTS.maxProjectRegistries,
      1,
      100_000,
    ),
    maxProjectPeersPerSession: parseInteger(
      "TEAMFORGE_MAX_PROJECT_PEERS_PER_SESSION",
      env.TEAMFORGE_MAX_PROJECT_PEERS_PER_SESSION,
      DEFAULTS.maxProjectPeersPerSession,
      1,
      10_000,
    ),
  });
}

export function configFromEnv(env = process.env) {
  const profile = profileFromEnv(env);
  const { host, port, wsPath, healthPath, ...limits } = profile.connectionPolicy;
  return {
    host,
    port,
    wsPath,
    healthPath,
    // Credentials remain runtime input, not inspectable policy/profile data.
    authToken: env.TEAMFORGE_AUTH_TOKEN ?? "",
    ...limits,
  };
}

export { DEFAULTS };
