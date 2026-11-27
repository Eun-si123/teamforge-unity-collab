// Internal, offline evidence only: the trusted operator supplies an enrolled
// roster, and must stop competing writers. Never clear the SQLite journal,
// infer roster completeness, or re-enable live editing from these reports.
import {isDeepStrictEqual as equal} from "node:util";
import {performance} from "node:perf_hooks";
import path from "node:path";
import {assertNoPendingHostRecovery,withPublishedPointerLock} from "../../project-peer/src/published-pointer-lock.mjs";
import {validateIdentity} from "../../project-peer/src/identity.mjs";
import {inspectPendingProjectTransitions} from "./project-transition-recovery.mjs";
import {loadStoredPublication,readPublishedBaseline} from "../../project-peer/src/stored-publication.mjs";
import {sha256} from "../../project-peer/src/hash.mjs";
import {fail} from "../../project-peer/src/errors.mjs";
import {canonicalGuestRoster,createGuestReconciliationChallenge,verifyGuestReconciliationReceipts} from "../../project-peer/src/guest-transition-proof.mjs";

import {transitionJournalBinding,signOfflineFinalization} from "./project-transition-guest-evidence.mjs";

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
  return {challenge:structuredClone(issued),revoke(){revoked=true;},
    async inspectReceipts(receipts,{signal}={}){
      return (await verify(receipts,signal)).result;
    },
    async finalizeCandidate(receipts,{approve,signal}={}){
      if(!context.capturedRoster||context.sqliteStage!=="sqlite_committed"||
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
        await assertNoPendingHostRecovery(metadata);
        const fresh=await verify(ordered,signal);
        if(fresh.result.status!=="all_enrolled_guests_reported") refuse();
        const bundle={challenge:issued,receipts:fresh.evidence,verifiedAtUnixMs:fresh.verifiedAtUnixMs};
        const finalization=signOfflineFinalization(bundle,ownerIdentity);
        await assertNoPendingHostRecovery(metadata);
        const pointer=await readPublishedBaseline({managedRoot,projectUuid:context.projectUuid});
        if(!pointer||sha256(JSON.stringify(pointer))!==context.hostPointerHash) refuse();
        assertCurrent();signal?.throwIfAborted();
        const result=store.finalizeProjectTransition({projectId:context.projectId,
          transitionId:context.transitionId,finalization});
        revoked=true;
        return result;
      });
    },
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
