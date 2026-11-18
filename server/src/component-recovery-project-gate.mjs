// Actual WP6 opt-in, metadata-only socket preflight. No source values are
// accepted from a peer, no Component ledger is seeded and no Inspector write
// is permitted. The registered Project Owner/Publisher signed Baseline must
// still be valid AT REQUEST TIME, in addition to realtime Session membership.
import { ProjectCoordinatorCore } from "./project-coordinator-core.mjs";
import { SessionAuthority, makeSessionKey } from "./session-authority.mjs";
import { descriptorIsCompatible, verifyProjectDescriptor } from "./project-coordinator.mjs";

function refused(code, reason) {
  return Object.freeze({ error: code, reason });
}

export function inspectCurrentSignedProjectForRecoveryPreview(
  coordinator, realtime, connection,
) {
  if (!(coordinator instanceof ProjectCoordinatorCore) ||
      !(realtime instanceof SessionAuthority) ||
      !connection || typeof connection !== "object" ||
      connection.supportsProjectTransfer !== true ||
      connection.projectClientRegistered !== true ||
      connection.supportsHierarchySync !== true ||
      !connection.projectId || !connection.sessionId ||
      connection.sessionKey !== makeSessionKey(connection.projectId, connection.sessionId)) {
    return refused("component_recovery_project_membership_required",
      "A currently registered Project Transfer and Hierarchy Editor is required for read-only preview.");
  }
  const active = coordinator.activeRecord(connection);
  const live = realtime.activeSession(connection);
  if (!active || active.record.connection !== connection ||
      active.session !== coordinator.sessions.get(connection.sessionKey) ||
      !live || live.session !== realtime.sessions.get(connection.sessionKey) ||
      live.record.connectionId !== connection.connectionId ||
      live.record.supportsHierarchySync !== true) {
    return refused("component_recovery_project_membership_required",
      "A replaced or unregistered Project/Session Editor cannot inspect a recovery preview.");
  }

  const project = coordinator.projects.get(connection.projectId);
  const baseline = project?.baseline;
  if (!project || !baseline || project.projectId !== connection.projectId ||
      project.projectUuid !== baseline.projectUuid ||
      project.ownerKeyId !== baseline.ownerKeyId ||
      project.ownerPublicKey !== baseline.ownerPublicKey ||
      !descriptorIsCompatible(baseline)) {
    return refused("component_recovery_signed_baseline_required",
      "A current compatible Owner/Publisher-signed Project Baseline is required.");
  }

  const verified = verifyProjectDescriptor(baseline, connection.projectId);
  if (verified.error ||
      verified.descriptor.projectUuid !== project.projectUuid ||
      verified.descriptor.ownerKeyId !== project.ownerKeyId ||
      verified.descriptor.ownerPublicKey !== project.ownerPublicKey) {
    return refused("component_recovery_signed_baseline_required",
      "The current Project Baseline signature or Publisher delegation is invalid.");
  }
  // This PIN is a minimal server-authenticated identity check, NOT proof
  // that a particular .unity file is included in the signed Manifest.
  // This helper does not authorize Scene/Component writes or an ACK.
  return Object.freeze({
    status: "signed_project_baseline_current_preview_only",
    projectUuid: project.projectUuid,
    baselineRevision: baseline.baselineRevision,
    manifestHash: baseline.manifestHash,
    descriptorHash: baseline.descriptorHash,
    sceneBytesAttested: false,
    editorApplyVerified: false,
    networkWriteAuthorized: false,
  });
}
