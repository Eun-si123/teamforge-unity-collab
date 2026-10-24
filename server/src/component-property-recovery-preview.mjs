// WP6 internal recovery-preview contract: no WebSocket handler, negotiated
// capability, Unity Scene edit, or authoritative late-join support is enabled.
// This reads ONLY a locally trusted, already seeded transaction ledger.
// A future socket integration must independently authenticate, negotiate and
// materialize a durable server-owned Component baseline before using it.
import { createHash } from "node:crypto";
import { types as nodeTypes } from "node:util";
import { validateText } from "./protocol.mjs";
import { readComponentPropertyTransaction } from "./component-property-transaction.mjs";

const ABSOLUTE_MAX_BYTES = 256 * 1024;
const REQUEST_FIELDS = Object.freeze([
  "requestId", "sceneId", "knownRevision", "knownFingerprint",
]);
const FINGERPRINT = /^[0-9a-f]{64}$/u;

function rejected(error, reason, session, repair = "none") {
  return Object.freeze({
    error, reason, repair,
    serverRevision: Number.isSafeInteger(session?.revision) ? session.revision : null,
  });
}
function exactRecord(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value) || nodeTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  return keys.length === fields.length && keys.every(key =>
    fields.includes(key) && descriptors[key].enumerable &&
    Object.hasOwn(descriptors[key], "value"));
}
function canonical(value, label, maximum) {
  return validateText(value, label, maximum) === null && value === value.trim();
}

// This is deliberately NOT a protocol message and cannot be sent to a remote
// Editor by existing Server routing. The caller must pass a Server-authenticated
// connection from the active Session; unknown and replaced memberships are
// denied before any property data is observed.
export function inspectComponentRecoveryPreview(session, connection, request, maximumBytes = 64 * 1024) {
  if (!session || !Number.isSafeInteger(session.revision) || session.revision < 0 ||
      !(session.members instanceof Map) || !(session.hierarchySceneIds instanceof Set) ||
      !connection || !canonical(connection.userId, "userId", 128) ||
      !canonical(connection.connectionId, "connectionId", 128)) {
    return rejected("component_recovery_context_invalid",
      "An authenticated current Session/connection is required.", session);
  }
  const member = session.members.get(connection.userId);
  if (!member || member.connectionId !== connection.connectionId) {
    return rejected("component_recovery_session_not_registered",
      "An unknown or replaced connection cannot inspect Component values.", session);
  }
  if (connection.supportsHierarchySync !== true || member.supportsHierarchySync !== true) {
    return rejected("component_recovery_hierarchy_required",
      "A current Hierarchy-capable Session member is required.", session);
  }
  if (!exactRecord(request, REQUEST_FIELDS) ||
      !canonical(request.requestId, "requestId", 128) ||
      !canonical(request.sceneId, "sceneId", 128) ||
      !Number.isSafeInteger(request.knownRevision) || request.knownRevision < 0 ||
      typeof request.knownFingerprint !== "string" ||
      (request.knownFingerprint !== "" && !FINGERPRINT.test(request.knownFingerprint))) {
    return rejected("component_recovery_request_invalid",
      "Use exact canonical Scene/revision/64-character SHA-256 fingerprint fields.", session);
  }
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 256 ||
      maximumBytes > ABSOLUTE_MAX_BYTES) {
    return rejected("component_recovery_limit_invalid",
      "Response size must be a bounded positive integer no larger than 256 KiB.", session);
  }
  if (request.knownRevision > session.revision) {
    return rejected("component_recovery_revision_ahead",
      "The requested revision is newer than authoritative Session state.", session,
      "resnapshot_required");
  }
  if (!session.hierarchySceneIds.has(request.sceneId)) {
    return rejected("component_recovery_scene_unseeded",
      "The requested Scene is not in the authoritative Hierarchy.", session);
  }

  const view = readComponentPropertyTransaction(session);
  if (view.error) {
    return rejected(view.error, view.reason, session, view.repair ?? "resnapshot_required");
  }
  if (view.sceneId !== request.sceneId) {
    return rejected("component_recovery_scene_mismatch",
      "The locally prepared Component ledger belongs to another Scene.", session);
  }

  const digestBytes = JSON.stringify({
    sceneId: view.sceneId,
    serverRevision: view.serverRevision,
    observedProperties: view.properties,
  });
  const fingerprint = createHash("sha256").update(digestBytes, "utf8").digest("hex");
  if (request.knownRevision === view.serverRevision &&
      request.knownFingerprint === fingerprint) {
    return Object.freeze({
      status: "local_preview_unchanged",
      sceneId: view.sceneId, serverRevision: view.serverRevision, fingerprint,
    });
  }

  // Only an immutable read of fully prepared local observations. Do not call
  // this "authoritative" remote repair: property values are not verified against
  // the Unity Editor, no undo/rollback exists, and incompleteness is not delete.
  const preview = Object.freeze({
    status: "local_preview_resnapshot",
    sceneId: view.sceneId,
    serverRevision: view.serverRevision,
    fingerprint,
    observedProperties: view.properties,
  });
  if (Buffer.byteLength(JSON.stringify(preview), "utf8") > maximumBytes) {
    return rejected("component_recovery_snapshot_size_limit",
      "The entire recovery preview exceeds its explicit UTF-8 response limit.", session);
  }
  return preview;
}
