// WP6 disconnected Publisher-approval experiment. An Ed25519 signature on a
// complete Collider observation binds it to the CURRENT Project Coordinator
// Baseline, live registered Editor connection and exact Session revision.
// This does NOT prove the .unity Scene bytes match that observation, nor
// authorize any Component write. No socket or dispatch route calls this.
import { createHash, createPublicKey, verify } from "node:crypto";
import { types as nodeTypes } from "node:util";
import { ProjectCoordinatorCore } from "./project-coordinator-core.mjs";
import { descriptorIsCompatible, descriptorMatchesBaseline,
  verifyProjectDescriptor } from "./project-coordinator.mjs";
import { inspectCompleteSavedColliderObservation } from "./component-collider-completeness.mjs";
import { SessionAuthority, makeSessionKey } from "./session-authority.mjs";
import { validateText } from "./protocol.mjs";

const HEX_256 = /^[0-9a-f]{64}$/u;
const SIGNATURE_BASE64 = /^(?:[A-Za-z0-9+/]{4}){21}[A-Za-z0-9+/]{2}==$/u;
const APPROVAL_FIELDS = Object.freeze([
  "schemaVersion", "projectUuid", "baselineRevision", "manifestHash",
  "descriptorHash", "sceneId", "realtimeRevision",
  "identityFingerprintSha256", "propertyFingerprintSha256", "signature",
]);

function denied(error, reason) {
  return Object.freeze({ error, reason });
}

function validIdentifier(text) {
  return typeof text === "string" && text === text.trim() &&
    validateText(text, "identity", 128) === null;
}

function inertExactApproval(approval) {
  if (!approval || typeof approval !== "object" || Array.isArray(approval) ||
      nodeTypes.isProxy(approval)) return false;
  const proto = Object.getPrototypeOf(approval);
  if (proto !== Object.prototype && proto !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(approval);
  const fields = Reflect.ownKeys(descriptors);
  return fields.length === APPROVAL_FIELDS.length &&
    fields.every(field => typeof field === "string" &&
      APPROVAL_FIELDS.includes(field) &&
      descriptors[field].enumerable &&
      Object.hasOwn(descriptors[field], "value"));
}

export function publisherObservationApprovalPayload(projectId, sessionId, connectionId, approval) {
  // Signature format v1; no JSON key-order, locale, platform path, token or
  // mutable Session internals are part of the signed byte representation.
  return [
    "teamforge-wp6-collider-publisher-approval-v1",
    projectId, sessionId, connectionId,
    // Even though v1 is domain-separated and schemaVersion is checked,
    // cryptographically bind the explicit signed schema field too.
    String(approval.schemaVersion), approval.projectUuid, String(approval.baselineRevision),
    approval.manifestHash, approval.descriptorHash, approval.sceneId,
    String(approval.realtimeRevision),
    approval.identityFingerprintSha256, approval.propertyFingerprintSha256,
  ].join("\n");
}

function canonicalSignature(value) {
  if (typeof value !== "string" || value.length !== 88 ||
      !SIGNATURE_BASE64.test(value)) return null;
  const signature = Buffer.from(value, "base64");
  return signature.length === 64 && signature.toString("base64") === value
    ? signature : null;
}

export function verifyPublisherApprovedColliderObservationForLocalTest(
  coordinator, realtimeAuthority, connection, identityBaseline, propertySnapshot, approval,
) {
  // The exact authenticated server-owned connection must be present in both
  // existing registries. A client JSON object or stale/replaced connection
  // cannot stand in for this cross-service identity.
  if (!(coordinator instanceof ProjectCoordinatorCore) ||
      !(realtimeAuthority instanceof SessionAuthority) ||
      !connection || typeof connection !== "object" ||
      !validIdentifier(connection.projectId) ||
      !validIdentifier(connection.sessionId) ||
      !validIdentifier(connection.connectionId) ||
      !validIdentifier(connection.userId) ||
      connection.supportsProjectTransfer !== true ||
      connection.supportsHierarchySync !== true ||
      connection.projectClientRegistered !== true ||
      connection.sessionKey !== makeSessionKey(connection.projectId, connection.sessionId)) {
    return denied("component_publisher_context_invalid",
      "Both real server-owned authority contexts and one negotiated connection are required.");
  }

  const projectMember = coordinator.activeRecord(connection);
  const authorityMember = realtimeAuthority.activeSession(connection);
  if (!projectMember || projectMember.record.connection !== connection ||
      !authorityMember || !authorityMember.record.supportsHierarchySync ||
      authorityMember.session !== realtimeAuthority.sessions.get(connection.sessionKey) ||
      projectMember.session !== coordinator.sessions.get(connection.sessionKey)) {
    return denied("component_publisher_membership_stale",
      "The current Project and realtime Session must agree on the exact active connection.");
  }
  const session = authorityMember.session;
  const complete = inspectCompleteSavedColliderObservation(
    session, identityBaseline, propertySnapshot);
  if (complete.error) return complete;

  const project = coordinator.projects.get(connection.projectId);
  const baseline = project?.baseline;
  if (!project || !baseline ||
      project.projectId !== connection.projectId ||
      project.projectUuid !== baseline.projectUuid ||
      project.ownerKeyId !== baseline.ownerKeyId ||
      project.ownerPublicKey !== baseline.ownerPublicKey) {
    return denied("component_publisher_baseline_missing",
      "One currently registered Project baseline with a pinned owner is required.");
  }

  // Reverify the CURRENT signed descriptor, rather than trusting a mutable
  // in-memory registry field that could be stale/partially replaced.
  const checked = verifyProjectDescriptor(baseline, connection.projectId);
  if (checked.error || !descriptorIsCompatible(checked.descriptor) ||
      !descriptorMatchesBaseline(checked.descriptor, baseline)) {
    return denied("component_publisher_descriptor_invalid",
      "The registered baseline must have a currently valid owner-authorized Publisher signature.");
  }

  if (!inertExactApproval(approval) ||
      approval.schemaVersion !== 1 ||
      approval.projectUuid !== baseline.projectUuid ||
      approval.baselineRevision !== baseline.baselineRevision ||
      approval.manifestHash !== baseline.manifestHash ||
      approval.descriptorHash !== baseline.descriptorHash ||
      approval.sceneId !== complete.sceneId ||
      approval.realtimeRevision !== complete.baseRevision ||
      !HEX_256.test(approval.identityFingerprintSha256) ||
      !HEX_256.test(approval.propertyFingerprintSha256)) {
    return denied("component_publisher_approval_mismatch",
      "Approval must bind the same Project baseline, Scene, revision and exact bounded format.");
  }

  const identityHash = createHash("sha256").update(identityBaseline.fingerprint, "utf8").digest("hex");
  const propertyHash = createHash("sha256").update(propertySnapshot.fingerprint, "utf8").digest("hex");
  if (approval.identityFingerprintSha256 !== identityHash ||
      approval.propertyFingerprintSha256 !== propertyHash) {
    return denied("component_publisher_observation_changed",
      "The locally prepared Component observation differs from its approved fingerprints.");
  }

  const signature = canonicalSignature(approval.signature);
  if (!signature) {
    return denied("component_publisher_signature_invalid",
      "A canonical 64-byte Ed25519 Publisher signature is required.");
  }
  try {
    const publisher = createPublicKey({
      key: Buffer.from(checked.descriptor.publisherPublicKey, "base64"),
      format: "der", type: "spki",
    });
    const payload = publisherObservationApprovalPayload(
      connection.projectId, connection.sessionId, connection.connectionId, approval);
    if (!verify(null, Buffer.from(payload, "utf8"), publisher, signature)) {
      return denied("component_publisher_signature_invalid",
        "The registered Publisher did not sign the exact Component observation context.");
    }
  } catch {
    return denied("component_publisher_signature_invalid",
      "The registered Publisher signature could not be verified.");
  }

  return Object.freeze({
    status: "publisher_approved_local_observation_scene_bytes_unverified",
    projectUuid: baseline.projectUuid,
    baselineRevision: baseline.baselineRevision,
    sceneId: complete.sceneId,
    realtimeRevision: complete.baseRevision,
    componentCount: complete.componentCount,
    propertyCount: complete.propertyCount,
    identityFingerprintSha256: identityHash,
    propertyFingerprintSha256: propertyHash,
  });
}
