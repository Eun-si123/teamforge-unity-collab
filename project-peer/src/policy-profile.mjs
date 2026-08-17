import { DEFAULT_TRANSFER_BASE_PATH, MAXIMUM_CHUNK_SIZE } from "./constants.mjs";

export const PROFILE_NAME = "LegacyPhase4Compatible";

export class ConnectionPolicy {
  constructor(values) {
    Object.assign(this, values);
    Object.freeze(this);
  }
}

export class TransferPolicy {
  constructor(values) {
    Object.assign(this, values);
    Object.freeze(this);
  }
}

export class TrustRequirements {
  constructor() {
    // These modes describe mandatory legacy behavior; they are not disable switches.
    this.ownerTrustMode = "signed-invite-owner-pin";
    this.publisherApprovalMode = "explicit-fingerprint-approval";
    this.activationMode = "verified-staging-then-atomic-activation";
    Object.freeze(this);
  }
}

export class TeamForgeProfile {
  constructor({ connectionPolicy, transferPolicy, trustRequirements }) {
    this.name = PROFILE_NAME;
    this.connectionPolicy = connectionPolicy;
    this.transferPolicy = transferPolicy;
    this.trustRequirements = trustRequirements;
    Object.freeze(this);
  }
}

export const LEGACY_CONNECTION_DEFAULTS = Object.freeze({
  serverAddress: "http://127.0.0.1:5080",
  realtimePath: "ws",
  coordinatorTimeoutMilliseconds: 10_000,
  reconnectBaseMilliseconds: 1_000,
  reconnectMaximumMilliseconds: 10_000,
  reconnectExponentLimit: 4,
});

export const LEGACY_TRANSFER_DEFAULTS = Object.freeze({
  host: "127.0.0.1",
  port: 0,
  basePath: DEFAULT_TRANSFER_BASE_PATH,
  maxConcurrency: 4,
  timeoutMilliseconds: 10_000,
  retryRounds: 3,
  retryBaseMilliseconds: 100,
  retryMaximumMilliseconds: 5_000,
  retryJitterRatio: 0.2,
  minimumPeerIntervalMilliseconds: 10,
  maxJsonBytes: 2_097_152,
  maxChunkBytes: MAXIMUM_CHUNK_SIZE,
  maxConcurrentRequests: 8,
  rateLimitPerSecond: 120,
  maxBytesPerSecond: 0,
});

export function legacyProjectPeerProfile({ connection = {}, transfer = {} } = {}) {
  return new TeamForgeProfile({
    connectionPolicy: new ConnectionPolicy({ ...LEGACY_CONNECTION_DEFAULTS, ...connection }),
    transferPolicy: new TransferPolicy({ ...LEGACY_TRANSFER_DEFAULTS, ...transfer }),
    trustRequirements: new TrustRequirements(),
  });
}

export const LegacyPhase4Compatible = legacyProjectPeerProfile();
