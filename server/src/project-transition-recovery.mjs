// Read-only recovery decision support for a crash AFTER the Coordinator's
// atomic M4->M5 SQLite repin. Does NOT confirm Publisher possession, update
// Host published.json, restore Guests or authorize realtime editing.
import { readPublishedBaseline, loadStoredPublication }
  from "../../project-peer/src/stored-publication.mjs";
import { auditSignedCandidateContents } from "../../project-peer/src/signed-candidate-content-audit.mjs";
import { isDeepStrictEqual } from "node:util";

const result = (journal,state,detail={})=>({
  projectId:journal.projectId,projectUuid:journal.projectUuid,
  transitionId:journal.transitionId,sqliteStage:journal.stage,
  currentDescriptorHash:journal.stage==="sqlite_rolled_back"
    ? journal.previousDescriptorHash : journal.candidateDescriptorHash,
  candidateDescriptorHash:journal.candidateDescriptorHash,
  previousDescriptorHash:journal.previousDescriptorHash,
  state,editorResumePermitted:false,automaticPointerRepairPermitted:false,...detail,
});

export async function inspectPendingProjectTransitions({store,managedRoot,signal}={}) {
  if (typeof store?.listProjectTransitionJournals !== "function")
    throw new TypeError("A verified durable SQLite Session store is required.");
  const reports=[];
  for(const journal of store.listProjectTransitionJournals()) {
    signal?.throwIfAborted();
    let pointer;
    try {pointer=await readPublishedBaseline({managedRoot,projectUuid:journal.projectUuid});}
    catch(error) {
      if(signal?.aborted) throw error;
      reports.push(result(journal,"host_pointer_unavailable"));continue;
    }
    let pointerState;
    if (!pointer) pointerState="host_pointer_missing";
    else if (pointer.descriptorHash === journal.candidateDescriptorHash &&
        pointer.manifestHash === journal.candidateManifestHash &&
        pointer.baselineRevision === journal.candidateBaselineRevision)
      pointerState="host_points_candidate";
    else if (pointer.descriptorHash === journal.previousDescriptorHash &&
        pointer.manifestHash === journal.previousManifestHash &&
        pointer.baselineRevision === journal.previousBaselineRevision)
      pointerState="host_points_previous";
    else pointerState="host_pointer_conflict";
    // A pointer is mutable local metadata, never cryptographic proof itself.
    // Inspect exact both old+new signed artifacts by hashes from SQLite,
    // including their shared Owner identity; never select arbitrary drafts.
    let oldSource,candidate;
    try {
      [oldSource,candidate]=await Promise.all([
        loadStoredPublication({managedRoot,projectId:journal.projectId,
          projectUuid:journal.projectUuid,manifestHash:journal.previousManifestHash,
          descriptorHash:journal.previousDescriptorHash,requireApproved:false}),
        loadStoredPublication({managedRoot,projectId:journal.projectId,
          projectUuid:journal.projectUuid,manifestHash:journal.candidateManifestHash,
          descriptorHash:journal.candidateDescriptorHash,requireApproved:false}),
      ]);
    } catch(error) {
      if(signal?.aborted) throw error;
      reports.push(result(journal,"signed_source_unavailable",{pointerState}));continue;
    }
    const old=oldSource.descriptor,newer=candidate.descriptor;
    if (old.descriptorHash !== journal.previousDescriptorHash ||
        newer.descriptorHash !== journal.candidateDescriptorHash ||
        old.baselineRevision !== journal.previousBaselineRevision ||
        newer.baselineRevision !== journal.candidateBaselineRevision ||
        old.ownerKeyId !== newer.ownerKeyId || old.ownerPublicKey !== newer.ownerPublicKey ||
        pointer && pointerState!=="host_pointer_conflict" &&
        pointer.ownerKeyId !== newer.ownerKeyId) {
      reports.push(result(journal,"signed_source_mismatch",{pointerState}));continue;
    }
    let oldAudit,candidateAudit;
    try {
      oldAudit=await auditSignedCandidateContents(oldSource,{signal});
    } catch(error) {
      if(signal?.aborted) throw error;
      reports.push(result(journal,"previous_content_unavailable",{pointerState}));continue;
    }
    if(oldAudit.status!=="verified") {
      reports.push(result(journal,"previous_content_resource_limit",{pointerState}));continue;
    }
    try {
      candidateAudit=await auditSignedCandidateContents(candidate,{signal});
    } catch(error) {
      if(signal?.aborted) throw error;
      reports.push(result(journal,"candidate_content_unavailable",{pointerState}));continue;
    }
    if(candidateAudit.status!=="verified") {
      reports.push(result(journal,"candidate_content_resource_limit",{pointerState}));continue;
    }
    // Filesystem approval can change while streaming Chunks. The read-only
    // report must never describe a stale pointer as an exact current state.
    let latest;
    try {latest=await readPublishedBaseline({managedRoot,projectUuid:journal.projectUuid});}
    catch(error) {
      if(signal?.aborted) throw error;
      reports.push(result(journal,"host_pointer_unavailable"));continue;
    }
    if(!isDeepStrictEqual(latest,pointer)) {
      reports.push(result(journal,"host_pointer_changed"));continue;
    }
    // The trusted caller may own a writable store. A concurrent internal
    // rollback during async chunk reads must not label the old SQLite stage
    // as current. Offline CLI readers hold their own consistent snapshot.
    const currentJournal=store.listProjectTransitionJournals().find(
      item=>item.projectId===journal.projectId);
    if (!isDeepStrictEqual(currentJournal,journal)) {
      reports.push(result(currentJournal ?? journal,"sqlite_transition_changed",{pointerState}));continue;
    }
    reports.push(result(journal,pointerState,{
      signedMetadataVerified:true,previousContentVerified:true,candidateContentVerified:true,
      previousVerifiedFileCount:oldAudit.verifiedFiles,
      candidateVerifiedFileCount:candidateAudit.verifiedFiles,
      candidateVerifiedByteCount:candidateAudit.verifiedBytes,
    }));
  }
  return reports;
}
