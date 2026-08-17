import {
  MANIFEST_SCHEMA_VERSION,
  PRODUCT_VERSION,
  REALTIME_PROTOCOL_VERSION,
  SHA256_PATTERN,
  TRANSFER_PROTOCOL_VERSION,
  UUID_PATTERN,
} from "./constants.mjs";
import { keyIdFromPublicKey, signText, verifyText } from "./identity.mjs";
import { sha256 } from "./hash.mjs";
import { fail } from "./errors.mjs";

function validText(value, maximumLength) {
  return typeof value === "string" && value.trim().length > 0 &&
    value.trim().length <= maximumLength && !/[\u0000-\u001f\u007f]/.test(value);
}

export function baselinePayload(descriptor) {
  return [
    "teamforge-baseline-v1",
    descriptor.projectId,
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

export function ownerProofPayload({
  projectId,
  projectUuid,
  connectionId,
  baselineRevision,
  manifestHash,
  endpoint,
  transferToken,
}) {
  return [
    "teamforge-owner-proof-v1",
    projectId,
    projectUuid,
    connectionId,
    String(baselineRevision),
    manifestHash,
    endpoint,
    transferToken,
  ].join("\n");
}

export function calculateDescriptorHash(descriptor) {
  return sha256(Buffer.from(baselinePayload(descriptor), "utf8"));
}

export function createDescriptor({
  projectId,
  projectUuid,
  baselineRevision,
  manifestHash,
  unityVersion,
  ownerIdentity,
  publisherIdentity = ownerIdentity,
  publisherAuthorization = undefined,
}) {
  const ownerKeyId = ownerIdentity?.keyId;
  const publisherKeyId = publisherIdentity?.keyId;
  const samePublisher = ownerKeyId === publisherKeyId;
  const authorization = samePublisher
    ? ""
    : (publisherAuthorization ?? signText(
        ownerIdentity,
        publisherAuthorizationPayload(projectUuid, publisherKeyId),
      ));
  const unsigned = {
    descriptorSchemaVersion: 1,
    projectId: projectId?.trim(),
    projectUuid: projectUuid?.toLowerCase(),
    baselineRevision,
    manifestHash,
    unityVersion: unityVersion?.trim(),
    teamForgePackageVersion: PRODUCT_VERSION,
    realtimeProtocolVersion: REALTIME_PROTOCOL_VERSION,
    transferProtocolVersion: TRANSFER_PROTOCOL_VERSION,
    manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
    ownerKeyId,
    ownerPublicKey: ownerIdentity?.publicKey,
    publisherKeyId,
    publisherPublicKey: publisherIdentity?.publicKey,
    publisherAuthorization: authorization,
  };
  const baselineSignature = signText(publisherIdentity, baselinePayload(unsigned));
  const withSignature = { ...unsigned, baselineSignature };
  const descriptorHash = calculateDescriptorHash(withSignature);
  const descriptor = { ...withSignature, descriptorHash };
  validateDescriptor(descriptor);
  return descriptor;
}

export function validateDescriptor(descriptor, {
  expectedProjectId = undefined,
  expectedProjectUuid = undefined,
  expectedManifestHash = undefined,
  trustedOwnerKeyId = undefined,
} = {}) {
  if (!descriptor || descriptor.descriptorSchemaVersion !== 1 ||
      !validText(descriptor.projectId, 128) || !UUID_PATTERN.test(descriptor.projectUuid ?? "") ||
      !Number.isSafeInteger(descriptor.baselineRevision) || descriptor.baselineRevision < 1 ||
      !SHA256_PATTERN.test(descriptor.manifestHash ?? "") ||
      !validText(descriptor.unityVersion, 64) ||
      descriptor.teamForgePackageVersion !== PRODUCT_VERSION ||
      descriptor.realtimeProtocolVersion !== REALTIME_PROTOCOL_VERSION ||
      descriptor.transferProtocolVersion !== TRANSFER_PROTOCOL_VERSION ||
      descriptor.manifestSchemaVersion !== MANIFEST_SCHEMA_VERSION ||
      !SHA256_PATTERN.test(descriptor.ownerKeyId ?? "") ||
      !SHA256_PATTERN.test(descriptor.publisherKeyId ?? "") ||
      !SHA256_PATTERN.test(descriptor.descriptorHash ?? "")) {
    fail("invalid_descriptor", "Baseline descriptor metadata is invalid or incompatible.");
  }
  if (keyIdFromPublicKey(descriptor.ownerPublicKey) !== descriptor.ownerKeyId ||
      keyIdFromPublicKey(descriptor.publisherPublicKey) !== descriptor.publisherKeyId) {
    fail("descriptor_key_id_mismatch", "Descriptor key IDs do not match their SPKI public keys.");
  }
  if (expectedProjectId && descriptor.projectId !== expectedProjectId) {
    fail("project_id_mismatch", "Descriptor Project ID does not match the requested route.");
  }
  if (expectedProjectUuid && descriptor.projectUuid.toLowerCase() !== expectedProjectUuid.toLowerCase()) {
    fail("project_uuid_mismatch", "Descriptor Project UUID does not match the requested project.");
  }
  if (expectedManifestHash && descriptor.manifestHash !== expectedManifestHash) {
    fail("manifest_hash_mismatch", "Descriptor Manifest hash does not match the requested baseline.");
  }
  if (trustedOwnerKeyId && descriptor.ownerKeyId !== trustedOwnerKeyId) {
    fail("untrusted_owner", "Descriptor Owner key does not match the configured trust anchor.");
  }
  if (descriptor.ownerKeyId === descriptor.publisherKeyId) {
    if (descriptor.ownerPublicKey !== descriptor.publisherPublicKey || descriptor.publisherAuthorization !== "") {
      fail("invalid_publisher_authorization", "Owner-published descriptor has inconsistent publisher fields.");
    }
  } else if (!verifyText(
    descriptor.ownerPublicKey,
    publisherAuthorizationPayload(descriptor.projectUuid, descriptor.publisherKeyId),
    descriptor.publisherAuthorization,
  )) {
    fail("invalid_publisher_authorization", "Publisher is not authorized by the Project Owner.");
  }
  if (!verifyText(descriptor.publisherPublicKey, baselinePayload(descriptor), descriptor.baselineSignature)) {
    fail("invalid_baseline_signature", "Baseline signature verification failed.");
  }
  if (calculateDescriptorHash(descriptor) !== descriptor.descriptorHash) {
    fail("descriptor_hash_mismatch", "Descriptor hash verification failed.");
  }
  return descriptor;
}

export function createOwnerProof(ownerIdentity, context) {
  return signText(ownerIdentity, ownerProofPayload(context));
}

export function verifyOwnerProof(ownerPublicKey, context, signature) {
  return verifyText(ownerPublicKey, ownerProofPayload(context), signature);
}
