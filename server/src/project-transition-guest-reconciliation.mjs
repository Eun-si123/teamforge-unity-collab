// Internal offline reconciliation: the trusted operator supplies an enrolled
// roster and must stop competing writers. Only explicit signed finalization
// archives the journal; evidence alone never grants live Editor authority.
import {isDeepStrictEqual as equal} from "node:util";
import {performance} from "node:perf_hooks";
import path from "node:path";
import {HOST_RECOVERY_FENCE_NAME,assertNoPendingHostRecovery,withPublishedPointerLock} from "../../project-peer/src/published-pointer-lock.mjs";
import {unlink} from "node:fs/promises";
import {syncMetadataDirectory} from "../../project-peer/src/persistent-metadata.mjs";
import {readStoredMetadataJson,STORED_PROJECT_MAX_BYTES} from "../../project-peer/src/stored-metadata-reader.mjs";
import {validateIdentity} from "../../project-peer/src/identity.mjs";
import {inspectPendingProjectTransitions} from "./project-transition-recovery.mjs";
import {loadStoredPublication,readPublishedBaseline} from "../../project-peer/src/stored-publication.mjs";
import {sha256} from "../../project-peer/src/hash.mjs";
import {fail} from "../../project-peer/src/errors.mjs";
import {canonicalGuestRoster,createGuestReconciliationChallenge,verifyGuestReconciliationReceipts} from "../../project-peer/src/guest-transition-proof.mjs";

import {transitionJournalBinding,signOfflineFinalization,validateCompletedRollbackFence,validateForwardFence} from "./project-transition-guest-evidence.mjs";

const fields=["projectId","projectUuid","transitionId","previousDescriptorHash","candidateDescriptorHash"];
const scoped=(a,b)=>a&&b&&fields.every(k=>a[k]===b[k]);
const refuse=()=>fail("guest_reconciliation_host_conflict","Host approval and pending SQLite transition must exactly agree before collecting Guest evidence.");
async function snapshot({store,managedRoot,request,signal}){
  if(!request||typeof store?.listProjectTransitionJournals!=="function") refuse();
  const journal=store.listProjectTransitionJournals().find(j=>scoped(j,request));
  if(!journal||!["sqlite_committed","sqlite_rolled_back"].includes(journal.stage)) refuse();
  const side=journal.stage==="sqlite_rolled_back"?"previous":"candidate";
  const pointer=await readPublishedBaseline({managedRoot,projectUuid:journal.projectUuid});
  if(!pointer||pointer.descriptorHash!==journal[side+"DescriptorHash"]||
    pointer.manifestHash!==journal[side+"ManifestHash"]||
    pointer.baselineRevision!==journal[side+"BaselineRevision"]) refuse();
  const reports=await inspectPendingProjectTransitions({store,managedRoot,signal});
  const report=reports.find(r=>scoped(r,request));
  if(!report||report.state!=="host_points_"+side||report.sqliteStage!==journal.stage||
    !report.signedMetadataVerified||!report.previousContentVerified||!report.candidateContentVerified) refuse();
  const {descriptor}=await loadStoredPublication({managedRoot,projectId:journal.projectId,
    projectUuid:journal.projectUuid,manifestHash:pointer.manifestHash,descriptorHash:pointer.descriptorHash,requireApproved:true});
  if(pointer.ownerKeyId!==descriptor.ownerKeyId||
    !equal(await readPublishedBaseline({managedRoot,projectUuid:journal.projectUuid}),pointer)||
    !equal(store.listProjectTransitionJournals().find(j=>scoped(j,request)),journal)) refuse();
  signal?.throwIfAborted();
  return {...Object.fromEntries(fields.map(k=>[k,journal[k]])),sqliteStage:journal.stage,
    targetDescriptorHash:pointer.descriptorHash,targetBaselineRevision:pointer.baselineRevision,
    journalHash:transitionJournalBinding(journal),hostPointerHash:sha256(JSON.stringify(pointer)),
    ownerKeyId:descriptor.ownerKeyId,publisherKeyId:descriptor.publisherKeyId,
    capturedRoster:journal.guestRoster?.participants??null};
}
export async function beginOfflineGuestReconciliation({store,managedRoot,request,participants,ownerIdentity,signal}={}){
  request=Object.freeze({...request});
  const context=await snapshot({store,managedRoot,request,signal});
  ownerIdentity=Object.freeze({...validateIdentity(ownerIdentity)});
  // Legacy journals may still be inspected with an explicitly supplied
  // roster, but only the roster captured atomically at transition time
  // can be persisted as historical completion evidence.
  if(context.capturedRoster){
    if(participants!==undefined&&!equal(canonicalGuestRoster(participants),context.capturedRoster)) refuse();
    participants=context.capturedRoster;
  }
  const challenge=createGuestReconciliationChallenge({context,participants,ownerIdentity});
  // Keep exact issued challenge in this round's local closure. Server restart
  // requires a fresh round; callers cannot swap in a different signed roster.
  const issued=structuredClone(challenge);
  const started=performance.now();
  const {issuedAtUnixMs,expiresAtUnixMs}=issued.body;
  let revoked=false;
  const assertCurrent=()=>{
    const now=Date.now();
    if(revoked || now<issuedAtUnixMs || now>expiresAtUnixMs ||
        performance.now()-started>expiresAtUnixMs-issuedAtUnixMs){
      revoked=true;
      refuse();
    }
  };
  const verify=async(receipts,signal)=>{
    assertCurrent();
    if(!Array.isArray(receipts)||receipts.length>issued.body.participants.length) refuse();
    const evidence=structuredClone(receipts);
    let latest;
    try {latest=await snapshot({store,managedRoot,request,signal});}
    catch(error){revoked=true;throw error;}
    if(!equal(context,latest)){revoked=true;refuse();}
    assertCurrent();
    const verifiedAtUnixMs=Date.now();
    const result=verifyGuestReconciliationReceipts({challenge:issued,trustedOwnerKeyId:context.ownerKeyId,
      receipts:evidence,nowUnixMs:verifiedAtUnixMs});
    return {result,evidence,verifiedAtUnixMs};
  };
  let recordedBundle;
  const finalize=async(stage,receipts,{approve,signal}={})=>{
      if(!context.capturedRoster||context.sqliteStage!==stage||
          typeof approve!=="function"||typeof store.finalizeProjectTransition!=="function"||
          store.readOnly!==false||!path.isAbsolute(managedRoot)) refuse();
      const initial=await verify(receipts,signal);
      if(initial.result.status!=="all_enrolled_guests_reported") return initial.result;
      const ordered=initial.evidence.sort((a,b)=>a.participantId<b.participantId?-1:a.participantId>b.participantId?1:0);
      const summary=Object.freeze({transitionId:context.transitionId,projectId:context.projectId,
        targetDescriptorHash:context.targetDescriptorHash,targetBaselineRevision:context.targetBaselineRevision,
        participantIds:Object.freeze(context.capturedRoster.map(p=>p.participantId)),
        requiresCompleteRosterAttestation:true,requiresAllWritersStoppedAttestation:true,
        archivesPreviousAndSelectedCheckpoints:true,editorResumePermitted:false});
      if(await approve(summary)!==true) return {status:"offline_finalization_declined",editorResumePermitted:false};
      signal?.throwIfAborted();
      const metadata=path.join(managedRoot,context.projectUuid,"metadata");
      return withPublishedPointerLock(metadata,async()=>{
        const rolledBack=stage==="sqlite_rolled_back";
        const fencePath=path.join(metadata,HOST_RECOVERY_FENCE_NAME);
        const journal=store.listProjectTransitionJournals().find(j=>scoped(j,request));
        if(!journal) refuse();
        let fence,forward;
        if(rolledBack){
          fence=await readStoredMetadataJson(fencePath,STORED_PROJECT_MAX_BYTES);
          validateCompletedRollbackFence(journal,fence);
        }else if(journal.hostForwardFence){
          forward=await readStoredMetadataJson(fencePath,STORED_PROJECT_MAX_BYTES);
          validateForwardFence(journal,forward);
          if(!equal(forward,journal.hostForwardFence)) refuse();
        }else await assertNoPendingHostRecovery(metadata);
        const fresh=await verify(ordered,signal);
        if(fresh.result.status!=="all_enrolled_guests_reported") refuse();
        const bundle={challenge:issued,receipts:fresh.evidence,verifiedAtUnixMs:fresh.verifiedAtUnixMs};
        const finalization=signOfflineFinalization(bundle,ownerIdentity,fence);
        if(rolledBack){
          if(!equal(await readStoredMetadataJson(fencePath,STORED_PROJECT_MAX_BYTES),fence)) refuse();
        }else if(forward){
          if(!equal(await readStoredMetadataJson(fencePath,STORED_PROJECT_MAX_BYTES),forward)) refuse();
        }else await assertNoPendingHostRecovery(metadata);
        const pointer=await readPublishedBaseline({managedRoot,projectUuid:context.projectUuid});
        if(!pointer||sha256(JSON.stringify(pointer))!==context.hostPointerHash||
            (rolledBack&&!equal(pointer,fence.target))||(forward&&!equal(pointer,forward.target))) refuse();
        assertCurrent();signal?.throwIfAborted();
        const result=store.finalizeProjectTransition({projectId:context.projectId,
          transitionId:context.transitionId,finalization});
        revoked=true;
        if(rolledBack){
          // SQLite is durable first. A remaining Host marker blocks startup
          // and normal publishing until the archived release is retried.
          await releaseArchivedRollbackFence({store,managedRoot,request,metadata,signal});
        }else if(forward){
          await releaseArchivedCandidateFence({store,managedRoot,request,metadata,signal});
        }
        return result;
      });
  };
  return {challenge:structuredClone(issued),revoke(){revoked=true;},
    async inspectReceipts(receipts,{signal}={}){
      return (await verify(receipts,signal)).result;
    },
    finalizeCandidate(receipts,options){return finalize("sqlite_committed",receipts,options);},
    finalizeRollback(receipts,options){return finalize("sqlite_rolled_back",receipts,options);},
    async recordReceipts(receipts,{signal}={}){
      if(!context.capturedRoster||typeof store.recordGuestReconciliationEvidence!=="function") refuse();
      const {result,evidence,verifiedAtUnixMs}=await verify(receipts,signal);
      if(result.status!=="all_enrolled_guests_reported") return result;
      const ordered=evidence.sort((a,b)=>a.participantId<b.participantId?-1:a.participantId>b.participantId?1:0);
      if(recordedBundle&&!equal(recordedBundle.receipts,ordered)) refuse();
      const bundle=recordedBundle??{challenge:issued,receipts:ordered,verifiedAtUnixMs};
      assertCurrent();
      signal?.throwIfAborted();
      // Synchronous SQLite CAS: no await between final in-process check
      // and commit. External writers must remain stopped as before.
      const saved=store.recordGuestReconciliationEvidence({projectId:context.projectId,
        transitionId:context.transitionId,expectedJournalHash:context.journalHash,
        stage:context.sqliteStage,evidence:bundle});
      recordedBundle=bundle;
      return saved;
    }};
}

// Caller owns published-pointer lock and the stopped Coordinator store.
async function releaseArchivedRollbackFence({store,managedRoot,request,metadata,signal}){
  const archive=store.readFinalizedProjectTransition(request.transitionId);
  const latest=store.listFinalizedProjectTransitions().filter(x=>x.projectId===request.projectId).at(-1);
  if(!archive||!scoped(archive.journal,request)||archive.journal.stage!=="sqlite_rolled_back"||
    latest?.transitionId!==request.transitionId||
    store.listProjectTransitionJournals().some(j=>j.projectId===request.projectId)) refuse();
  const fence=archive.finalization.rollbackFence;
  validateCompletedRollbackFence(archive.journal,fence);
  const pointer=await readPublishedBaseline({managedRoot,projectUuid:request.projectUuid});
  if(!equal(pointer,fence.target)||
    sha256(JSON.stringify(pointer))!==archive.finalization.evidence.challenge.body.hostPointerHash) refuse();
  const fencePath=path.join(metadata,HOST_RECOVERY_FENCE_NAME);
  let actual;
  try{actual=await readStoredMetadataJson(fencePath,STORED_PROJECT_MAX_BYTES);}
  catch(error){
    if(error.code!=="ENOENT") throw error;
    // Retry after unlink, including directory sync failure.
    await syncMetadataDirectory(metadata);
    return {status:"offline_rollback_fence_released",replayed:true,editorResumePermitted:false};
  }
  if(!equal(actual,fence)) refuse();
  // Only release before Coordinator startup rotates epochs. A later edit or
  // transition cannot use historical authorization to clear a new marker.
  const records=store.loadAll().filter(r=>r.scope.projectId===request.projectId);
  if(records.length!==archive.journal.sessionCount||
    records.some(r=>!archive.journal.sessions.some(e=>e.sessionId===r.scope.sessionId&&
      r.scope.projectUuid===request.projectUuid&&r.epoch===e.rollbackEpoch&&
      r.revision===e.revision&&r.checksum===e.rollbackChecksum))) refuse();
  signal?.throwIfAborted();
  await unlink(fencePath);
  await syncMetadataDirectory(metadata);
  return {status:"offline_rollback_fence_released",replayed:false,editorResumePermitted:false};
}

// Explicit offline retry; no fresh Guest approval is necessary because the
// exact completed decision and signed marker are already committed. Never
// create or replace a marker. All competing writers must remain stopped.
export async function finishOfflineRollbackRelease({store,managedRoot,request,signal}={}){
  if(store?.readOnly!==false||typeof managedRoot!=="string"||!path.isAbsolute(managedRoot)||
    !request||typeof store.readFinalizedProjectTransition!=="function") refuse();
  request=Object.freeze({...request});
  const archive=store.readFinalizedProjectTransition(request.transitionId);
  if(!archive||!scoped(archive.journal,request)||archive.journal.stage!=="sqlite_rolled_back") refuse();
  const metadata=path.join(managedRoot,archive.journal.projectUuid,"metadata");
  return withPublishedPointerLock(metadata,()=>releaseArchivedRollbackFence({store,managedRoot,request,metadata,signal}));
}

// Candidate counterpart of rollback release. The journal's forward marker
// is included in the exact journal hash signed by all Guests and Owner.
async function releaseArchivedCandidateFence({store,managedRoot,request,metadata,signal}){
  const archive=store.readFinalizedProjectTransition(request.transitionId);
  const latest=store.listFinalizedProjectTransitions().filter(x=>x.projectId===request.projectId).at(-1);
  if(!archive||!scoped(archive.journal,request)||archive.journal.stage!=="sqlite_committed"||
    latest?.transitionId!==request.transitionId||!archive.journal.hostForwardFence||
    store.listProjectTransitionJournals().some(j=>j.projectId===request.projectId)) refuse();
  const fence=archive.journal.hostForwardFence;
  validateForwardFence(archive.journal,fence);
  const pointer=await readPublishedBaseline({managedRoot,projectUuid:request.projectUuid});
  if(!equal(pointer,fence.target)||
    sha256(JSON.stringify(pointer))!==archive.finalization.evidence.challenge.body.hostPointerHash) refuse();
  const fencePath=path.join(metadata,HOST_RECOVERY_FENCE_NAME);
  let actual;
  try{actual=await readStoredMetadataJson(fencePath,STORED_PROJECT_MAX_BYTES);}
  catch(error){
    if(error.code!=="ENOENT") throw error;
    await syncMetadataDirectory(metadata);
    return {status:"offline_candidate_fence_released",replayed:true,editorResumePermitted:false};
  }
  if(!equal(actual,fence)) refuse();
  const records=store.loadAll().filter(r=>r.scope.projectId===request.projectId);
  if(records.length!==archive.journal.sessionCount||
    records.some(r=>!archive.journal.sessions.some(e=>e.sessionId===r.scope.sessionId&&
      r.scope.projectUuid===request.projectUuid&&r.epoch===e.nextEpoch&&
      r.revision===e.revision&&r.checksum===e.nextChecksum))) refuse();
  signal?.throwIfAborted();
  await unlink(fencePath);
  await syncMetadataDirectory(metadata);
  return {status:"offline_candidate_fence_released",replayed:false,editorResumePermitted:false};
}

export async function finishOfflineCandidateRelease({store,managedRoot,request,signal}={}){
  if(store?.readOnly!==false||typeof managedRoot!=="string"||!path.isAbsolute(managedRoot)||
    !request||typeof store.readFinalizedProjectTransition!=="function") refuse();
  request=Object.freeze({...request});
  const archive=store.readFinalizedProjectTransition(request.transitionId);
  if(!archive||!scoped(archive.journal,request)||archive.journal.stage!=="sqlite_committed"||
    !archive.journal.hostForwardFence) refuse();
  const metadata=path.join(managedRoot,archive.journal.projectUuid,"metadata");
  return withPublishedPointerLock(metadata,()=>releaseArchivedCandidateFence({store,managedRoot,request,metadata,signal}));
}
