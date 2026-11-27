// Internal, offline evidence only: the trusted operator supplies an enrolled
// roster, and must stop competing writers. Never clear the SQLite journal,
// infer roster completeness, or re-enable live editing from these reports.
import {isDeepStrictEqual as equal} from "node:util";
import {performance} from "node:perf_hooks";
import {inspectPendingProjectTransitions} from "./project-transition-recovery.mjs";
import {loadStoredPublication,readPublishedBaseline} from "../../project-peer/src/stored-publication.mjs";
import {sha256} from "../../project-peer/src/hash.mjs";
import {fail} from "../../project-peer/src/errors.mjs";
import {createGuestReconciliationChallenge,verifyGuestReconciliationReceipts} from "../../project-peer/src/guest-transition-proof.mjs";

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
    journalHash:sha256(JSON.stringify(journal)),hostPointerHash:sha256(JSON.stringify(pointer)),
    ownerKeyId:descriptor.ownerKeyId,publisherKeyId:descriptor.publisherKeyId};
}
export async function beginOfflineGuestReconciliation({store,managedRoot,request,participants,ownerIdentity,signal}={}){
  request=Object.freeze({...request});
  const context=await snapshot({store,managedRoot,request,signal});
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
  return {challenge:structuredClone(issued),revoke(){revoked=true;},
    async inspectReceipts(receipts,{signal}={}){
      assertCurrent();
      if(!Array.isArray(receipts)||receipts.length>issued.body.participants.length) refuse();
      const evidence=structuredClone(receipts);
      let latest;
      try {latest=await snapshot({store,managedRoot,request,signal});}
      catch(error){revoked=true;throw error;}
      if(!equal(context,latest)){revoked=true;refuse();}
      assertCurrent();
      return verifyGuestReconciliationReceipts({challenge:issued,trustedOwnerKeyId:context.ownerKeyId,receipts:evidence});
    }};
}
