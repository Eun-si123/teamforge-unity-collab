// Explicit offline forward transition. The caller owns the stopped Coordinator
// store and must stop ALL Host/Guest Editors, Seeds and publication writers.
// A durable Host marker is installed before SQLite commits, and retained
// until archived finalization or exact pre-commit cancellation. Never live WS.
import path from "node:path";
import {randomUUID} from "node:crypto";
import {unlink} from "node:fs/promises";
import {sha256} from "../../project-peer/src/hash.mjs";
import {readStoredMetadataJson,STORED_PROJECT_MAX_BYTES} from "../../project-peer/src/stored-metadata-reader.mjs";
import {validateForwardFence,priorCursorBinding} from "./project-transition-guest-evidence.mjs";
import {isDeepStrictEqual as equal} from "node:util";
import {validateIdentity} from "../../project-peer/src/identity.mjs";
import {canonicalGuestRoster} from "../../project-peer/src/guest-transition-proof.mjs";
import {readPublishedBaseline,loadStoredPublication} from "../../project-peer/src/stored-publication.mjs";
import {auditSignedCandidateContents} from "../../project-peer/src/signed-candidate-content-audit.mjs";
import {auditSignedAssetGuids} from "../../project-peer/src/signed-asset-guid-audit.mjs";
import {summarizeSignedManifestChanges,missingChangedAssetMetadata,previewRetainedM4SourceChanges} from "../../project-peer/src/baseline-transition-source-preview.mjs";
import {withPublishedPointerLock,HOST_RECOVERY_FENCE_NAME} from "../../project-peer/src/published-pointer-lock.mjs";
import {writeJsonAtomic,writeJsonExclusive,syncMetadataDirectory} from "../../project-peer/src/persistent-metadata.mjs";
import {planSignedCheckpointTransition} from "./project-transition-checkpoint-plan.mjs";
import {inspectPendingProjectTransitions} from "./project-transition-recovery.mjs";
import {fail} from "../../project-peer/src/errors.mjs";

const hash=v=>typeof v==="string"&&/^[a-f0-9]{64}$/u.test(v);
const uuid=v=>typeof v==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(v);
const id=v=>typeof v==="string"&&v.length>0&&v.length<=128&&v.trim()===v&&v.isWellFormed()&&!/[\u0000-\u001f\u007f]/u.test(v);
const refuse=()=>fail("offline_transition_conflict","Exact approved source, plan or pending transition differs. Preserve both versions and review.");
const fields=["projectId","projectUuid","previousDescriptorHash","candidateDescriptorHash"];
const matches=(a,b,keys=fields)=>a&&b&&keys.every(k=>a[k]===b[k]);
const scopeOf=v=>{
  if(!v||!id(v.projectId)||!uuid(v.projectUuid)||!hash(v.previousDescriptorHash)||
      !hash(v.candidateDescriptorHash)||v.previousDescriptorHash===v.candidateDescriptorHash) refuse();
  return Object.fromEntries(fields.map(k=>[k,v[k]]));
};
function keysFor(ownerIdentity,publisherIdentity,previous,candidate){
  const owner=validateIdentity(ownerIdentity),publisher=validateIdentity(publisherIdentity);
  if(owner.keyId!==previous.ownerKeyId||owner.keyId!==candidate.ownerKeyId||
      owner.publicKey!==candidate.ownerPublicKey||publisher.keyId!==candidate.publisherKeyId||
      publisher.publicKey!==candidate.publisherPublicKey) refuse();
}
const result=(status,detail={})=>({status,...detail,guestReconciliationRequired:true,editorResumePermitted:false});
const pointerFor=(descriptor,approvedAtUnixMs)=>({schemaVersion:1,projectUuid:descriptor.projectUuid,
  baselineRevision:descriptor.baselineRevision,manifestHash:descriptor.manifestHash,
  descriptorHash:descriptor.descriptorHash,ownerKeyId:descriptor.ownerKeyId,approvedAtUnixMs});
async function readFence(metadata){
  try{return await readStoredMetadataJson(path.join(metadata,HOST_RECOVERY_FENCE_NAME),STORED_PROJECT_MAX_BYTES);}
  catch(error){if(error.code==="ENOENT") return null;throw error;}
}
const matchesPin=(pointer,descriptor)=>pointer&&equal(pointer,pointerFor(descriptor,pointer.approvedAtUnixMs));

async function auditSources({managedRoot,scope,previousManifestHash,candidateManifestHash,ownerIdentity,publisherIdentity,signal}){
  const [previous,candidate]=await Promise.all([
    loadStoredPublication({managedRoot,projectId:scope.projectId,projectUuid:scope.projectUuid,
      manifestHash:previousManifestHash,descriptorHash:scope.previousDescriptorHash}),
    loadStoredPublication({managedRoot,projectId:scope.projectId,projectUuid:scope.projectUuid,
      manifestHash:candidateManifestHash,descriptorHash:scope.candidateDescriptorHash})]);
  if(previous.descriptor.descriptorHash!==scope.previousDescriptorHash||
      candidate.descriptor.descriptorHash!==scope.candidateDescriptorHash||
      candidate.descriptor.baselineRevision!==previous.descriptor.baselineRevision+1) refuse();
  keysFor(ownerIdentity,publisherIdentity,previous.descriptor,candidate.descriptor);
  const delta=summarizeSignedManifestChanges(candidate.manifest,previous.manifest);
  const [oldAudit,newAudit,guidAudit]=await Promise.all([
    auditSignedCandidateContents(previous,{signal}),auditSignedCandidateContents(candidate,{signal}),
    auditSignedAssetGuids(candidate,delta,{signal})]);
  const review=previewRetainedM4SourceChanges(previous.manifest,candidate.manifest,delta,
    missingChangedAssetMetadata(candidate.manifest,delta),guidAudit);
  if(oldAudit.status!=="verified"||newAudit.status!=="verified"||guidAudit.status!=="verified"||
      review.blockerCount!==0) refuse();
  signal?.throwIfAborted();
  return {previous:previous.descriptor,candidate:candidate.descriptor};
}
function checkStore(store,managedRoot,approve){
  if(store?.readOnly!==false||typeof store.transitionProjectCheckpoints!=="function"||
      typeof managedRoot!=="string"||!path.isAbsolute(managedRoot)||typeof approve!=="function") refuse();
}
function checkRoster(roster,previous,candidate){
  const canonical=canonicalGuestRoster(roster);
  if(!equal(canonical,roster)||canonical.some(p=>[previous.ownerKeyId,previous.publisherKeyId,candidate.publisherKeyId].includes(p.keyId))) refuse();
}
async function completeLocked({store,managedRoot,scope,journal,sources,before,signal}){
  const exact=()=>store.listProjectTransitionJournals().find(j=>j.projectId===scope.projectId);
  if(!equal(exact(),journal)||journal.stage!=="sqlite_committed"||!journal.guestRoster) refuse();
  const metadata=path.join(managedRoot,scope.projectUuid,"metadata");
  const fence=await readFence(metadata);
  if(journal.hostForwardFence){
    validateForwardFence(journal,fence);
    if(!equal(fence,journal.hostForwardFence)) refuse();
  }else if(fence) refuse();
  const pointer=await readPublishedBaseline({managedRoot,projectUuid:scope.projectUuid});
  if(!equal(pointer,before)||(!matchesPin(pointer,sources.previous)&&!matchesPin(pointer,sources.candidate))) refuse();
  const changed=!matchesPin(pointer,sources.candidate);
  const target=fence?fence.target:changed?pointerFor(sources.candidate,Math.max(Date.now(),pointer.approvedAtUnixMs+1)):pointer;
  if(fence&&!equal(pointer,fence.before)&&!equal(pointer,fence.target)) refuse();
  if(!Number.isSafeInteger(target.approvedAtUnixMs)||target.approvedAtUnixMs<1||!equal(exact(),journal)) refuse();
  signal?.throwIfAborted();
  if(changed) await writeJsonAtomic(path.join(metadata,"published.json"),target);
  else await syncMetadataDirectory(metadata);
  if(!equal(await readPublishedBaseline({managedRoot,projectUuid:scope.projectUuid}),target)||!equal(exact(),journal)||!equal(await readFence(metadata),fence)) refuse();
  return result("offline_host_sqlite_candidate_selected",{transitionId:journal.transitionId,
    targetDescriptorHash:scope.candidateDescriptorHash,sessionCount:journal.sessionCount,hostPointerChanged:changed});
}

// A returned plan is only an intent. Rebuild it from verified signed sources
// and current SQLite cursors using its proposed epochs, compare exact content,
// then rely on the existing transactional CAS for the final write.
async function runOfflineTransitionPlan({store,managedRoot,plan,ownerIdentity,publisherIdentity,approve,signal}={},cancelUncommitted=false){
  checkStore(store,managedRoot,approve);
  ownerIdentity=Object.freeze({...validateIdentity(ownerIdentity)});
  publisherIdentity=Object.freeze({...validateIdentity(publisherIdentity)});
  const input=structuredClone(plan?.migrationInput);
  const scope=scopeOf(input);
  if(plan?.status!=="read_only_intent"||plan.commitPermitted!==false||
    !Array.isArray(input.sessions)||!input.sessions.length||input.sessions.length>128) refuse();
  const candidateManifestHash=input.sessions[0]?.checkpoint?.project?.manifestHash;
  if(!hash(candidateManifestHash)) refuse();
  const metadata=path.join(managedRoot,scope.projectUuid,"metadata");
  const snapshot=async()=>{
    const fence=await readFence(metadata);
    const pointer=await readPublishedBaseline({managedRoot,projectUuid:scope.projectUuid});
    if(pointer?.descriptorHash!==scope.previousDescriptorHash) refuse();
    const sources=await auditSources({managedRoot,scope,previousManifestHash:pointer.manifestHash,
      candidateManifestHash,ownerIdentity,publisherIdentity,signal});
    if(!matchesPin(pointer,sources.previous)) refuse();
    const planHash=sha256(JSON.stringify(input));
    const fenceScope={...scope,transitionId:fence?.transitionId,
      previousManifestHash:sources.previous.manifestHash,candidateManifestHash:sources.candidate.manifestHash,
      previousBaselineRevision:sources.previous.baselineRevision,candidateBaselineRevision:sources.candidate.baselineRevision,
      guestRoster:{ownerKeyId:sources.previous.ownerKeyId},
      sessions:input.sessions.map(s=>({sessionId:s.scope.sessionId,previousEpoch:s.previousEpoch,
        revision:s.revision,previousChecksum:s.expectedChecksum}))};
    if(fence){
      if(!uuid(fence.transitionId)||fence.planHash!==planHash||!equal(fence.before,pointer)) refuse();
      validateForwardFence(fenceScope,fence);
      if(store.readFinalizedProjectTransition(fence.transitionId)) refuse();
    }else if(cancelUncommitted) refuse();
    checkRoster(input.guestParticipants,sources.previous,sources.candidate);
    // The planner follows SQLite loadAll ordering, before sorting by Session
    // ID; use the corresponding proposed epoch in that same iteration order.
    const records=store.loadAll().filter(r=>r.scope.projectId===scope.projectId);
    let index=0;
    const rebuilt=planSignedCheckpointTransition({store,projectId:scope.projectId,
      previousDescriptor:sources.previous,candidateDescriptor:sources.candidate,
      publication:input.sessions[0].checkpoint.publication,
      nextEpoch:()=>input.sessions.find(s=>s.scope.sessionId===records[index++]?.scope.sessionId)?.nextEpoch});
    if(rebuilt.status!=="read_only_intent"||
        !equal({...rebuilt.migrationInput,guestParticipants:input.guestParticipants},input)||
        !equal(await readPublishedBaseline({managedRoot,projectUuid:scope.projectUuid}),pointer)) refuse();
    if(!equal(await readFence(metadata),fence)) refuse();
    return {pointer,sources,fence,planHash,priorCursorHash:priorCursorBinding(fenceScope.sessions)};
  };
  const before=await snapshot();
  if(await approve(Object.freeze({...scope,participantIds:Object.freeze(input.guestParticipants.map(p=>p.participantId)),
      sessionCount:input.sessions.length,cancelUncommitted,requiresStoppedWritersAndCompleteRosterAttestation:true,
      editorResumePermitted:false}))!==true) return {status:"offline_transition_declined",editorResumePermitted:false};
  return withPublishedPointerLock(metadata,async()=>{
    const current=await snapshot();
    if(!equal(before,current)) refuse();
    signal?.throwIfAborted();
    if(cancelUncommitted){
      // Planner CAS revalidation above proved the exact previous cursors and
      // no pending journal. Do not remove a marker for a committed transition.
      await unlink(path.join(metadata,HOST_RECOVERY_FENCE_NAME));
      await syncMetadataDirectory(metadata);
      return {status:"offline_uncommitted_transition_cancelled",editorResumePermitted:false};
    }
    const fence=current.fence??{schemaVersion:1,kind:"host_baseline_forward",...scope,
      transitionId:randomUUID(),planHash:current.planHash,priorCursorHash:current.priorCursorHash,before:current.pointer,
      target:pointerFor(current.sources.candidate,Math.max(Date.now(),current.pointer.approvedAtUnixMs+1))};
    if(!Number.isSafeInteger(fence.target.approvedAtUnixMs)) refuse();
    if(!current.fence) await writeJsonExclusive(path.join(metadata,HOST_RECOVERY_FENCE_NAME),fence);
    else await syncMetadataDirectory(metadata);
    if(!equal(await readFence(metadata),fence)||
      !equal(await readPublishedBaseline({managedRoot,projectUuid:scope.projectUuid}),fence.before)) refuse();
    signal?.throwIfAborted();
    store.transitionProjectCheckpoints({...input,hostForwardFence:fence});
    // A crash after this commit is intentionally recoverable through the
    // exact pending journal. Do not pretend this is a cross-store atomic write.
    const journal=store.listProjectTransitionJournals().find(j=>matches(j,scope));
    if(!journal) refuse();
    return completeLocked({store,managedRoot,scope,journal,sources:current.sources,before:current.pointer,signal});
  });
}

export function executeOfflineTransitionPlan(options){return runOfflineTransitionPlan(options);}
export function cancelOfflineUncommittedTransition(options){
  if(options?.plan) return runOfflineTransitionPlan(options,true);
  return cancelFromMarker(options);
}

// A process may die before SQLite has any journal and its in-memory plan
// may be lost. Cancel using the exact durable marker and independently
// verified complete OLD checkpoint cursors; never select a new draft.
async function cancelFromMarker({store,managedRoot,request,ownerIdentity,approve,signal}={}){
  checkStore(store,managedRoot,approve);
  const scope=scopeOf(request),transitionId=request.transitionId;
  if(!uuid(transitionId)) refuse();
  const owner=Object.freeze({...validateIdentity(ownerIdentity)});
  const metadata=path.join(managedRoot,scope.projectUuid,"metadata");
  const snapshot=async()=>{
    const fence=await readFence(metadata);
    if(!fence||!matches(fence,{...scope,transitionId},[...fields,"transitionId"])||
        store.listProjectTransitionJournals().length||store.readFinalizedProjectTransition(transitionId)) refuse();
    const pointer=await readPublishedBaseline({managedRoot,projectUuid:scope.projectUuid});
    if(!equal(pointer,fence.before)) refuse();
    const source=await loadStoredPublication({managedRoot,projectId:scope.projectId,projectUuid:scope.projectUuid,
      manifestHash:pointer.manifestHash,descriptorHash:scope.previousDescriptorHash,requireApproved:true});
    if(!matchesPin(pointer,source.descriptor)||owner.keyId!==source.descriptor.ownerKeyId||
        owner.publicKey!==source.descriptor.ownerPublicKey) refuse();
    const audit=await auditSignedCandidateContents(source,{signal});
    if(audit.status!=="verified") refuse();
    const records=store.loadAll().filter(r=>r.scope.projectId===scope.projectId);
    if(!records.length||records.some(r=>r.scope.projectUuid!==scope.projectUuid||
        r.checkpoint.project.descriptorHash!==scope.previousDescriptorHash)) refuse();
    const sessions=records.map(r=>({sessionId:r.scope.sessionId,previousEpoch:r.epoch,revision:r.revision,previousChecksum:r.checksum}));
    validateForwardFence({...scope,transitionId,previousManifestHash:source.descriptor.manifestHash,
      candidateManifestHash:fence.target?.manifestHash,previousBaselineRevision:source.descriptor.baselineRevision,
      candidateBaselineRevision:source.descriptor.baselineRevision+1,guestRoster:{ownerKeyId:owner.keyId},sessions},fence);
    if(!hash(fence.target.manifestHash)||!equal(await readFence(metadata),fence)||
      !equal(await readPublishedBaseline({managedRoot,projectUuid:scope.projectUuid}),pointer)||
      store.listProjectTransitionJournals().length||!equal(store.loadAll().filter(r=>r.scope.projectId===scope.projectId),records)) refuse();
    signal?.throwIfAborted();
    return {fence,records,pointer};
  };
  const before=await snapshot();
  if(await approve(Object.freeze({...scope,transitionId,cancelUncommitted:true,
      requiresStoppedWritersAndCompleteRosterAttestation:true,editorResumePermitted:false}))!==true)
    return {status:"offline_transition_declined",editorResumePermitted:false};
  return withPublishedPointerLock(metadata,async()=>{
    if(!equal(await snapshot(),before)) refuse();
    signal?.throwIfAborted();
    await unlink(path.join(metadata,HOST_RECOVERY_FENCE_NAME));
    await syncMetadataDirectory(metadata);
    return {status:"offline_uncommitted_transition_cancelled",editorResumePermitted:false};
  });
}

// Explicit retry after a durable SQLite commit; no repeat repin, no new epoch,
// and no ability to select a different draft or reverse a rolled-back journal.
export async function finishOfflineCandidateSelection({store,managedRoot,request,ownerIdentity,publisherIdentity,approve,signal}={}){
  checkStore(store,managedRoot,approve);
  ownerIdentity=Object.freeze({...validateIdentity(ownerIdentity)});
  publisherIdentity=Object.freeze({...validateIdentity(publisherIdentity)});
  const scope=scopeOf(request),transitionId=request.transitionId;
  if(!uuid(transitionId)) refuse();
  const metadata=path.join(managedRoot,scope.projectUuid,"metadata");
  const snapshot=async()=>{
    const fence=await readFence(metadata);
    const journal=store.listProjectTransitionJournals().find(j=>matches(j,{...scope,transitionId},[...fields,"transitionId"]));
    if(!journal||journal.stage!=="sqlite_committed"||!journal.guestRoster) refuse();
    if(journal.hostForwardFence){
      validateForwardFence(journal,fence);
      if(!equal(journal.hostForwardFence,fence)) refuse();
    }else if(fence) refuse();
    const sources=await auditSources({managedRoot,scope,previousManifestHash:journal.previousManifestHash,
      candidateManifestHash:journal.candidateManifestHash,ownerIdentity,publisherIdentity,signal});
    const pointer=await readPublishedBaseline({managedRoot,projectUuid:scope.projectUuid});
    if(!matchesPin(pointer,sources.previous)&&!matchesPin(pointer,sources.candidate)) refuse();
    const report=(await inspectPendingProjectTransitions({store,managedRoot,signal})).find(r=>r.transitionId===transitionId);
    if(!report?.previousContentVerified||!report?.candidateContentVerified||
        !["host_points_previous","host_points_candidate"].includes(report.state)||
        !equal(store.listProjectTransitionJournals().find(j=>j.transitionId===transitionId),journal)||
        !equal(await readPublishedBaseline({managedRoot,projectUuid:scope.projectUuid}),pointer)) refuse();
    if(!equal(await readFence(metadata),fence)) refuse();
    return {journal,sources,pointer,fence};
  };
  const before=await snapshot();
  if(await approve(Object.freeze({...scope,transitionId,requiresStoppedWritersAndCompleteRosterAttestation:true,
      editorResumePermitted:false}))!==true) return {status:"offline_transition_declined",editorResumePermitted:false};
  return withPublishedPointerLock(metadata,async()=>{
    const after=await snapshot();
    if(!equal(before,after)) refuse();
    return completeLocked({store,managedRoot,scope,journal:after.journal,sources:after.sources,before:after.pointer,signal});
  });
}
