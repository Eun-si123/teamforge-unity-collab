// Explicit offline forward transition. The caller owns the stopped Coordinator
// store and must stop ALL Host/Guest Editors, Seeds and publication writers.
// The SQLite journal fences Coordinator restart; it is not a filesystem fence
// for a standalone Host writer after a crash. Never invoke from live WS.
import path from "node:path";
import {isDeepStrictEqual as equal} from "node:util";
import {validateIdentity} from "../../project-peer/src/identity.mjs";
import {canonicalGuestRoster} from "../../project-peer/src/guest-transition-proof.mjs";
import {readPublishedBaseline,loadStoredPublication} from "../../project-peer/src/stored-publication.mjs";
import {auditSignedCandidateContents} from "../../project-peer/src/signed-candidate-content-audit.mjs";
import {auditSignedAssetGuids} from "../../project-peer/src/signed-asset-guid-audit.mjs";
import {summarizeSignedManifestChanges,missingChangedAssetMetadata,previewRetainedM4SourceChanges} from "../../project-peer/src/baseline-transition-source-preview.mjs";
import {withPublishedPointerLock,assertNoPendingHostRecovery} from "../../project-peer/src/published-pointer-lock.mjs";
import {writeJsonAtomic,syncMetadataDirectory} from "../../project-peer/src/persistent-metadata.mjs";
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
  await assertNoPendingHostRecovery(metadata);
  const pointer=await readPublishedBaseline({managedRoot,projectUuid:scope.projectUuid});
  if(!equal(pointer,before)||(!matchesPin(pointer,sources.previous)&&!matchesPin(pointer,sources.candidate))) refuse();
  const changed=!matchesPin(pointer,sources.candidate);
  const target=changed?pointerFor(sources.candidate,Math.max(Date.now(),pointer.approvedAtUnixMs+1)):pointer;
  if(!Number.isSafeInteger(target.approvedAtUnixMs)||target.approvedAtUnixMs<1||!equal(exact(),journal)) refuse();
  signal?.throwIfAborted();
  if(changed) await writeJsonAtomic(path.join(metadata,"published.json"),target);
  else await syncMetadataDirectory(metadata);
  if(!equal(await readPublishedBaseline({managedRoot,projectUuid:scope.projectUuid}),target)||!equal(exact(),journal)) refuse();
  return result("offline_host_sqlite_candidate_selected",{transitionId:journal.transitionId,
    targetDescriptorHash:scope.candidateDescriptorHash,sessionCount:journal.sessionCount,hostPointerChanged:changed});
}

// A returned plan is only an intent. Rebuild it from verified signed sources
// and current SQLite cursors using its proposed epochs, compare exact content,
// then rely on the existing transactional CAS for the final write.
export async function executeOfflineTransitionPlan({store,managedRoot,plan,ownerIdentity,publisherIdentity,approve,signal}={}){
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
    await assertNoPendingHostRecovery(metadata);
    const pointer=await readPublishedBaseline({managedRoot,projectUuid:scope.projectUuid});
    if(pointer?.descriptorHash!==scope.previousDescriptorHash) refuse();
    const sources=await auditSources({managedRoot,scope,previousManifestHash:pointer.manifestHash,
      candidateManifestHash,ownerIdentity,publisherIdentity,signal});
    if(!matchesPin(pointer,sources.previous)) refuse();
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
    return {pointer,sources};
  };
  const before=await snapshot();
  if(await approve(Object.freeze({...scope,participantIds:Object.freeze(input.guestParticipants.map(p=>p.participantId)),
      sessionCount:input.sessions.length,requiresStoppedWritersAndCompleteRosterAttestation:true,
      editorResumePermitted:false}))!==true) return {status:"offline_transition_declined",editorResumePermitted:false};
  return withPublishedPointerLock(metadata,async()=>{
    const current=await snapshot();
    if(!equal(before,current)) refuse();
    signal?.throwIfAborted();
    store.transitionProjectCheckpoints(input);
    // A crash after this commit is intentionally recoverable through the
    // exact pending journal. Do not pretend this is a cross-store atomic write.
    const journal=store.listProjectTransitionJournals().find(j=>matches(j,scope));
    if(!journal) refuse();
    return completeLocked({store,managedRoot,scope,journal,sources:current.sources,before:current.pointer,signal});
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
    await assertNoPendingHostRecovery(metadata);
    const journal=store.listProjectTransitionJournals().find(j=>matches(j,{...scope,transitionId},[...fields,"transitionId"]));
    if(!journal||journal.stage!=="sqlite_committed"||!journal.guestRoster) refuse();
    const sources=await auditSources({managedRoot,scope,previousManifestHash:journal.previousManifestHash,
      candidateManifestHash:journal.candidateManifestHash,ownerIdentity,publisherIdentity,signal});
    const pointer=await readPublishedBaseline({managedRoot,projectUuid:scope.projectUuid});
    if(!matchesPin(pointer,sources.previous)&&!matchesPin(pointer,sources.candidate)) refuse();
    const report=(await inspectPendingProjectTransitions({store,managedRoot,signal})).find(r=>r.transitionId===transitionId);
    if(!report?.previousContentVerified||!report?.candidateContentVerified||
        !["host_points_previous","host_points_candidate"].includes(report.state)||
        !equal(store.listProjectTransitionJournals().find(j=>j.transitionId===transitionId),journal)||
        !equal(await readPublishedBaseline({managedRoot,projectUuid:scope.projectUuid}),pointer)) refuse();
    return {journal,sources,pointer};
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
