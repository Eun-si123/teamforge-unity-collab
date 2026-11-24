// Read-only M4->M5 stored-source audit *after* all participating Editors have
// acknowledged an in-memory pause. This is not a commit/rollback protocol:
// no receipt, lock or inspection result may authorize a future write.
// Reuse the same signed-source, GUID and content checks as the public read-only
// preview. Never open or trust a user-supplied file path.
import { isDeepStrictEqual } from "node:util";
import { descriptorIsCompatible, verifyProjectDescriptor } from "./project-coordinator.mjs";
import { captureProjectTransitionSessions, sameProjectTransitionSessions }
  from "./project-transition-preflight.mjs";
import { loadStoredPublication, readPublishedBaseline }
  from "../../project-peer/src/stored-publication.mjs";
import { auditSignedCandidateContents }
  from "../../project-peer/src/signed-candidate-content-audit.mjs";
import { auditSignedAssetGuids }
  from "../../project-peer/src/signed-asset-guid-audit.mjs";
import { summarizeSignedManifestChanges, missingChangedAssetMetadata,
  previewRetainedM4SourceChanges } from "../../project-peer/src/baseline-transition-source-preview.mjs";

const refused = error => ({error,commitPermitted:false});

export async function inspectPausedSignedSources({
  projectId, pauseId, candidateDescriptor, quiescence, coordinator, authority,
  durable, components, managedRoot, stopping = () => false, signal,
} = {}) {
  const initial = quiescence?.onlineStatus(projectId,pauseId);
  if (!initial?.ready || !initial.ticket || stopping())
    return refused("project_transition_all_editors_required");
  const ticket = initial.ticket;
  const approved = durable?.approvedProjects.get(projectId);
  const record = coordinator?.projects.get(projectId);
  const old = record?.baseline;
  if (!approved || !old || old.descriptorHash !== approved.descriptorHash ||
      old.descriptorHash !== ticket.descriptorHash ||
      old.manifestHash !== ticket.manifestHash ||
      old.projectUuid !== ticket.projectUuid ||
      old.baselineRevision !== ticket.baselineRevision)
    return refused("project_transition_signed_baseline_required");
  if (!candidateDescriptor || !descriptorIsCompatible(candidateDescriptor) ||
      verifyProjectDescriptor(candidateDescriptor,projectId).error ||
      candidateDescriptor.ownerKeyId !== ticket.ownerKeyId ||
      candidateDescriptor.ownerPublicKey !== ticket.ownerPublicKey ||
      candidateDescriptor.projectUuid !== ticket.projectUuid ||
      candidateDescriptor.baselineRevision !== ticket.baselineRevision + 1 ||
      candidateDescriptor.descriptorHash === ticket.descriptorHash)
    return refused("project_transition_candidate_invalid");

  const before = captureProjectTransitionSessions({authority,durable,components,
    projectId,projectUuid:ticket.projectUuid,baseline:old});
  if (!before) return refused("project_transition_session_stale");

  try {
    signal?.throwIfAborted();
    const [current,candidate] = await Promise.all([
      loadStoredPublication({managedRoot,projectId,projectUuid:ticket.projectUuid,
        manifestHash:ticket.manifestHash,descriptorHash:ticket.descriptorHash,
        requireApproved:true}),
      loadStoredPublication({managedRoot,projectId,projectUuid:ticket.projectUuid,
        manifestHash:candidateDescriptor.manifestHash,
        descriptorHash:candidateDescriptor.descriptorHash,requireApproved:false}),
    ]);
    if (current.descriptor.descriptorHash !== ticket.descriptorHash ||
        candidate.descriptor.descriptorHash !== candidateDescriptor.descriptorHash ||
        !isDeepStrictEqual(candidate.descriptor,candidateDescriptor))
      return refused("project_transition_source_mismatch");
    const delta = summarizeSignedManifestChanges(candidate.manifest,current.manifest);
    const [oldContent,newContent,metadataAudit] = await Promise.all([
      auditSignedCandidateContents(current,{signal}),
      auditSignedCandidateContents(candidate,{signal}),
      auditSignedAssetGuids(candidate,delta,{signal}),
    ]);
    signal?.throwIfAborted();
    const review = previewRetainedM4SourceChanges(current.manifest,candidate.manifest,
      delta,missingChangedAssetMetadata(candidate.manifest,delta),metadataAudit);

    // A source reader never owns the editor pause. A disconnect, expired ACK,
    // Publisher pin change, M4 Session revision or external Host pointer edit
    // invalidates the entire report even after successful chunk hashes.
    const [pointer, rereadCandidate] = await Promise.all([
      readPublishedBaseline({managedRoot,projectUuid:ticket.projectUuid}),
      loadStoredPublication({managedRoot,projectId,projectUuid:ticket.projectUuid,
        manifestHash:candidateDescriptor.manifestHash,
        descriptorHash:candidateDescriptor.descriptorHash,requireApproved:false}),
    ]);
    const final = quiescence.onlineStatus(projectId,pauseId);
    const after = captureProjectTransitionSessions({authority,durable,components,
      projectId,projectUuid:ticket.projectUuid,baseline:old});
    if (!final?.ready || final.ticket !== ticket || stopping() ||
        !sameProjectTransitionSessions(before,after) ||
        coordinator.projects.get(projectId) !== record || record.baseline !== old ||
        durable.approvedProjects.get(projectId)?.descriptorHash !== ticket.descriptorHash ||
        pointer?.manifestHash !== ticket.manifestHash ||
        pointer?.descriptorHash !== ticket.descriptorHash ||
        rereadCandidate.descriptor.descriptorHash !== candidateDescriptor.descriptorHash ||
        !isDeepStrictEqual(rereadCandidate.manifest,candidate.manifest))
      return refused("project_transition_source_stale");

    const contentVerified = oldContent.status === "verified" &&
      newContent.status === "verified" && metadataAudit.status === "verified";
    return Object.freeze({
      status:contentVerified && review.blockerCount === 0
        ? "verified_source_only" : "source_reconciliation_required",
      oldSignedContentStatus:oldContent.status,
      candidateSignedContentStatus:newContent.status,
      metadataAuditStatus:metadataAudit.status,
      candidateVerifiedFiles:newContent.verifiedFiles,
      candidateVerifiedBytes:newContent.verifiedBytes,
      candidateVerifiedChunks:newContent.verifiedChunks,
      blockerCount:review.blockerCount,
      blockersPreview:review.blockersPreview,
      // Both ACK and source verification are necessary but INSUFFICIENT for
      // Host+SQLite+Guest atomic promotion. This is intentionally NEVER true.
      commitPermitted:false,
    });
  } catch {
    return refused("project_transition_source_unavailable");
  }
}
