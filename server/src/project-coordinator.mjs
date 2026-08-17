import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { PROTOCOL_VERSION, validateText, validateTextOrEmpty } from "./protocol.mjs";

export const PROJECT_TRANSFER_PROTOCOL_VERSION = 1;
export const PROJECT_MANIFEST_SCHEMA_VERSION = 1;
export const PROJECT_PRODUCT_VERSION = "0.5.1";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const UNITY_6000_3_PATTERN = /^6000\.3\.\d+[abfp]\d+$/;
const BASE_FIELDS = new Set(["type", "protocolVersion", "requestId"]);
const DESCRIPTOR_FIELDS = [
  "userId",
  "projectUuid",
  "baselineRevision",
  "manifestHash",
  "descriptorHash",
  "unityVersion",
  "teamForgePackageVersion",
  "realtimeProtocolVersion",
  "transferProtocolVersion",
  "manifestSchemaVersion",
  "ownerKeyId",
  "ownerPublicKey",
  "publisherKeyId",
  "publisherPublicKey",
  "publisherAuthorization",
  "baselineSignature",
];
const PEER_FIELDS = [
  ...DESCRIPTOR_FIELDS,
  "completeBaseline",
  "availableChunkCount",
  "totalChunkCount",
  "endpoint",
  "transferToken",
  "ownerProofSignature",
];
const ALLOWED_FIELDS = Object.freeze({
  project_baseline_publish: new Set([...BASE_FIELDS, ...DESCRIPTOR_FIELDS]),
  project_peer_announce: new Set([...BASE_FIELDS, ...PEER_FIELDS]),
});

function invalidUnknownField(message, messageType) {
  const allowed = ALLOWED_FIELDS[messageType];
  if (!allowed) {
    return `Unsupported Project Coordinator message type: ${messageType}.`;
  }
  for (const field of Object.keys(message)) {
    if (!allowed.has(field)) {
      return `${messageType}.${field} is not allowed; Project payload and unknown fields are rejected.`;
    }
  }
  return null;
}

function validateHash(value, name) {
  return typeof value === "string" && HASH_PATTERN.test(value)
    ? null
    : `${name} must be a lowercase 64-character SHA-256 hex string.`;
}

function validateUuid(value) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value) || value === "00000000-0000-0000-0000-000000000000") {
    return "projectUuid must be a canonical lowercase non-zero UUID.";
  }
  return null;
}

function validateSafeInteger(value, name, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? null
    : `${name} must be a safe integer between ${minimum} and ${maximum}.`;
}

function decodeCanonicalBase64(value, name, { allowEmpty = false, maximumBytes = 512 } = {}) {
  if (allowEmpty && value === "") {
    return { buffer: Buffer.alloc(0), error: null };
  }
  if (typeof value !== "string" || value.length === 0 || value.length > 4_096 || !BASE64_PATTERN.test(value)) {
    return { buffer: null, error: `${name} must be canonical base64.` };
  }
  const buffer = Buffer.from(value, "base64");
  if (buffer.length === 0 || buffer.length > maximumBytes || buffer.toString("base64") !== value) {
    return { buffer: null, error: `${name} must be canonical base64 within its size limit.` };
  }
  return { buffer, error: null };
}

function parseEd25519PublicKey(value, name) {
  const decoded = decodeCanonicalBase64(value, name, { maximumBytes: 512 });
  if (decoded.error) {
    return { key: null, der: null, error: decoded.error };
  }
  try {
    const key = createPublicKey({ key: decoded.buffer, format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ed25519") {
      return { key: null, der: null, error: `${name} must contain an Ed25519 SPKI public key.` };
    }
    return { key, der: decoded.buffer, error: null };
  } catch {
    return { key: null, der: null, error: `${name} must contain a valid Ed25519 SPKI public key.` };
  }
}

function decodeEd25519Signature(value, name, allowEmpty = false) {
  const decoded = decodeCanonicalBase64(value, name, { allowEmpty, maximumBytes: 64 });
  if (decoded.error) {
    return decoded;
  }
  if ((allowEmpty && decoded.buffer.length === 0) || decoded.buffer.length === 64) {
    return decoded;
  }
  return { buffer: null, error: `${name} must contain a 64-byte Ed25519 signature.` };
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function baselineCanonicalPayload(projectId, descriptor) {
  return [
    "teamforge-baseline-v1",
    projectId,
    descriptor.projectUuid,
    String(descriptor.baselineRevision),
    descriptor.manifestHash,
    descriptor.unityVersion,
    descriptor.teamForgePackageVersion,
    String(descriptor.realtimeProtocolVersion),
    String(descriptor.transferProtocolVersion),
    String(descriptor.manifestSchemaVersion),
    descriptor.ownerKeyId,
    descriptor.publisherKeyId,
  ].join("\n");
}

export function publisherAuthorizationPayload(projectUuid, publisherKeyId) {
  return `teamforge-publisher-v1\n${projectUuid}\n${publisherKeyId}`;
}

export function ownerProofPayload(projectId, connectionId, peer) {
  return [
    "teamforge-owner-proof-v1",
    projectId,
    peer.projectUuid,
    connectionId,
    String(peer.baselineRevision),
    peer.manifestHash,
    peer.endpoint,
    peer.transferToken,
  ].join("\n");
}

export function validateProjectCoordinatorMessage(message, messageType) {
  const unknownFieldError = invalidUnknownField(message, messageType);
  if (unknownFieldError) {
    return unknownFieldError;
  }

  const descriptorError =
    validateText(message.requestId, "requestId", 128) ??
    validateText(message.userId, "userId", 128) ??
    validateUuid(message.projectUuid) ??
    validateSafeInteger(message.baselineRevision, "baselineRevision", 1) ??
    validateHash(message.manifestHash, "manifestHash") ??
    validateHash(message.descriptorHash, "descriptorHash") ??
    validateText(message.unityVersion, "unityVersion", 64) ??
    validateText(message.teamForgePackageVersion, "teamForgePackageVersion", 64) ??
    validateSafeInteger(message.realtimeProtocolVersion, "realtimeProtocolVersion", 1, 1_000) ??
    validateSafeInteger(message.transferProtocolVersion, "transferProtocolVersion", 1, 1_000) ??
    validateSafeInteger(message.manifestSchemaVersion, "manifestSchemaVersion", 1, 1_000) ??
    validateHash(message.ownerKeyId, "ownerKeyId") ??
    validateText(message.ownerPublicKey, "ownerPublicKey", 4_096) ??
    validateHash(message.publisherKeyId, "publisherKeyId") ??
    validateText(message.publisherPublicKey, "publisherPublicKey", 4_096) ??
    validateTextOrEmpty(message.publisherAuthorization, "publisherAuthorization", 4_096) ??
    validateText(message.baselineSignature, "baselineSignature", 4_096);
  if (descriptorError || message.realtimeProtocolVersion !== PROTOCOL_VERSION) {
    return descriptorError ?? `realtimeProtocolVersion must be ${PROTOCOL_VERSION}.`;
  }

  if (messageType !== "project_peer_announce") {
    return null;
  }

  return (
    (typeof message.completeBaseline === "boolean" ? null : "completeBaseline must be a boolean.") ??
    validateSafeInteger(message.availableChunkCount, "availableChunkCount", 0, 10_000_000) ??
    validateSafeInteger(message.totalChunkCount, "totalChunkCount", 0, 10_000_000) ??
    (message.availableChunkCount <= message.totalChunkCount
      ? null
      : "availableChunkCount cannot exceed totalChunkCount.") ??
    (message.completeBaseline && message.availableChunkCount !== message.totalChunkCount
      ? "completeBaseline requires all chunks to be available."
      : null) ??
    validateEndpoint(message.endpoint) ??
    validateTransferToken(message.transferToken) ??
    validateTextOrEmpty(message.ownerProofSignature, "ownerProofSignature", 4_096)
  );
}

function validateEndpoint(value) {
  const textError = validateText(value, "endpoint", 512);
  if (textError) {
    return textError;
  }
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") ||
        url.username || url.password || url.search || url.hash || !url.hostname) {
      return "endpoint must be an absolute HTTP(S) URL without credentials, query, or fragment.";
    }
    return null;
  } catch {
    return "endpoint must be an absolute HTTP(S) URL.";
  }
}

function validateTransferToken(value) {
  const error = validateText(value, "transferToken", 512);
  if (error) {
    return error;
  }
  return value.trim().length >= 16 ? null : "transferToken must contain at least 16 printable characters.";
}

export function verifyProjectDescriptor(message, projectId) {
  const descriptor = {};
  for (const field of DESCRIPTOR_FIELDS) {
    descriptor[field] = typeof message[field] === "string" ? message[field].trim() : message[field];
  }

  const owner = parseEd25519PublicKey(descriptor.ownerPublicKey, "ownerPublicKey");
  if (owner.error) {
    return { error: owner.error };
  }
  const publisher = parseEd25519PublicKey(descriptor.publisherPublicKey, "publisherPublicKey");
  if (publisher.error) {
    return { error: publisher.error };
  }
  if (sha256Hex(owner.der) !== descriptor.ownerKeyId) {
    return { error: "ownerKeyId does not match ownerPublicKey." };
  }
  if (sha256Hex(publisher.der) !== descriptor.publisherKeyId) {
    return { error: "publisherKeyId does not match publisherPublicKey." };
  }

  const canonicalPayload = baselineCanonicalPayload(projectId, descriptor);
  if (sha256Hex(Buffer.from(canonicalPayload, "utf8")) !== descriptor.descriptorHash) {
    return { error: "descriptorHash does not match the canonical Baseline Descriptor." };
  }

  const baselineSignature = decodeEd25519Signature(descriptor.baselineSignature, "baselineSignature");
  if (baselineSignature.error ||
      !verifySignature(null, Buffer.from(canonicalPayload, "utf8"), publisher.key, baselineSignature.buffer)) {
    return { error: baselineSignature.error ?? "baselineSignature verification failed." };
  }

  if (descriptor.publisherKeyId === descriptor.ownerKeyId) {
    if (descriptor.publisherPublicKey !== descriptor.ownerPublicKey || descriptor.publisherAuthorization !== "") {
      return { error: "Owner-published Baselines must use the same public key and an empty publisherAuthorization." };
    }
  } else {
    const authorization = decodeEd25519Signature(
      descriptor.publisherAuthorization,
      "publisherAuthorization",
    );
    const authorizationPayload = Buffer.from(
      publisherAuthorizationPayload(descriptor.projectUuid, descriptor.publisherKeyId),
      "utf8",
    );
    if (authorization.error || !verifySignature(null, authorizationPayload, owner.key, authorization.buffer)) {
      return { error: authorization.error ?? "publisherAuthorization verification failed." };
    }
  }

  return {
    error: null,
    descriptor,
    ownerPublicKeyObject: owner.key,
  };
}

export function verifyProjectOwnerProof(message, projectId, connectionId, ownerPublicKeyObject) {
  if (message.ownerProofSignature === "") {
    return { error: null, verified: false };
  }
  const signature = decodeEd25519Signature(message.ownerProofSignature, "ownerProofSignature");
  if (signature.error) {
    return { error: signature.error, verified: false };
  }
  const peer = {
    projectUuid: message.projectUuid.trim(),
    baselineRevision: message.baselineRevision,
    manifestHash: message.manifestHash,
    endpoint: message.endpoint.trim(),
    transferToken: message.transferToken.trim(),
  };
  const payload = Buffer.from(ownerProofPayload(projectId, connectionId, peer), "utf8");
  return verifySignature(null, payload, ownerPublicKeyObject, signature.buffer)
    ? { error: null, verified: true }
    : { error: "ownerProofSignature verification failed.", verified: false };
}

export function descriptorMatchesBaseline(descriptor, baseline) {
  return Boolean(
    baseline &&
    descriptor.projectUuid === baseline.projectUuid &&
    descriptor.baselineRevision === baseline.baselineRevision &&
    descriptor.manifestHash === baseline.manifestHash &&
    descriptor.descriptorHash === baseline.descriptorHash,
  );
}

export function descriptorIsCompatible(descriptor) {
  return descriptor.realtimeProtocolVersion === PROTOCOL_VERSION &&
    descriptor.transferProtocolVersion === PROJECT_TRANSFER_PROTOCOL_VERSION &&
    descriptor.manifestSchemaVersion === PROJECT_MANIFEST_SCHEMA_VERSION &&
    descriptor.teamForgePackageVersion === PROJECT_PRODUCT_VERSION &&
    UNITY_6000_3_PATTERN.test(descriptor.unityVersion);
}

export function calculateSeedRank(peer, baseline, bootstrapPublisherConnectionId = "") {
  if (!peer || !descriptorMatchesBaseline(peer, baseline) || !descriptorIsCompatible(peer)) {
    return 99;
  }
  if (peer.completeBaseline && peer.ownerProofVerified) {
    return 0;
  }
  if (peer.completeBaseline) {
    return 1;
  }
  if (peer.availableChunkCount > 0) {
    return 2;
  }
  return peer.connectionId === bootstrapPublisherConnectionId ? 3 : 99;
}

export function compareProjectPeers(left, right) {
  return left.seedRank - right.seedRank ||
    left.observedLatencyMilliseconds - right.observedLatencyMilliseconds ||
    left.connectionId.localeCompare(right.connectionId);
}

export function descriptorFields() {
  return [...DESCRIPTOR_FIELDS];
}
