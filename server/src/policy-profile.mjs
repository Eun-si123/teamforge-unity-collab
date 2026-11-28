export const PROFILE_NAME = "LegacyPhase4Compatible";

export class ConnectionPolicy {
  constructor(values) {
    Object.assign(this, values);
    Object.freeze(this);
  }
}

export class TeamForgeProfile {
  constructor({ connectionPolicy }) {
    this.name = PROFILE_NAME;
    this.connectionPolicy = connectionPolicy;
    Object.freeze(this);
  }
}

// Mirrors ClientWebSocketTransport.MaximumReceivedMessageBytes in the Unity
// package: the largest single WebSocket message a Unity Editor accepts. Any
// server budget for a message sent to Editors must not exceed it (#658).
export const UNITY_EDITOR_MAX_RECEIVED_MESSAGE_BYTES = 1_048_576;

// Server budgets that bound a single outbound message an Editor receives.
export const EDITOR_OUTBOUND_MESSAGE_BUDGETS = Object.freeze([
  "maxMessageBytes", "maxHierarchySnapshotBytes", "maxSnapshotBytes",
]);

export function assertEditorReceivableBudgets(config) {
  for (const name of EDITOR_OUTBOUND_MESSAGE_BUDGETS) {
    if (config[name] > UNITY_EDITOR_MAX_RECEIVED_MESSAGE_BYTES) {
      throw new Error(`${name} (${config[name]}) exceeds the ${UNITY_EDITOR_MAX_RECEIVED_MESSAGE_BYTES}-byte message ` +
        "limit Unity Editors can receive; Editors could never load such a snapshot.");
    }
  }
}

export const LEGACY_SERVER_CONNECTION_DEFAULTS = Object.freeze({
  host: "127.0.0.1",
  port: 5080,
  wsPath: "/ws",
  healthPath: "/health",
  maxMessageBytes: 1_048_576,
  maxConnections: 32,
  rateLimitPerSecond: 60,
  lockLeaseMilliseconds: 15_000,
  maxRecentOperations: 4_096,
  maxRetainedTransforms: 512,
  maxHierarchyObjects: 2_048,
  maxHierarchyTombstones: 4_096,
  maxHierarchySnapshotBytes: 1_048_576,
  maxHierarchyDepth: 256,
  maxHierarchyNameLength: 128,
  maxLocksPerConnection: 8,
  maxLocksPerSession: 256,
  maxSnapshotBytes: 921_600,
  maxBufferedBytes: 1_048_576,
  helloTimeoutMilliseconds: 10_000,
  heartbeatIntervalMilliseconds: 15_000,
  heartbeatTimeoutMilliseconds: 45_000,
  maxProjectRegistries: 1_024,
  maxProjectPeersPerSession: 32,
});

export function legacyServerProfile(connectionValues = LEGACY_SERVER_CONNECTION_DEFAULTS) {
  return new TeamForgeProfile({
    connectionPolicy: new ConnectionPolicy(connectionValues),
  });
}

export const LegacyPhase4Compatible = legacyServerProfile();
