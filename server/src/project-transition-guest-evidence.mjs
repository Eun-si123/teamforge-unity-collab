// Historical transition evidence, not an authority token. The journal has
// already been verified by the SQLite owner before entering these helpers.
import {isDeepStrictEqual as equal} from "node:util";
import {canonicalGuestRoster,verifyGuestReconciliationReceipts} from "../../project-peer/src/guest-transition-proof.mjs";
import {signText,verifyText,keyIdFromPublicKey} from "../../project-peer/src/identity.mjs";
import {sha256} from "../../project-peer/src/hash.mjs";

const hash=v=>typeof v==="string"&&/^[a-f0-9]{64}$/u.test(v);
const keys=(v,k)=>v&&typeof v==="object"&&!Array.isArray(v)&&equal(Object.keys(v).sort(),[...k].sort());
const stages=["sqlite_committed","sqlite_rolled_back"];
const identityFields=["projectId","projectUuid","transitionId","previousDescriptorHash","candidateDescriptorHash"];
const invalid=()=>{throw new TypeError("Invalid durable Guest reconciliation evidence.");};

export function captureGuestRoster(participants,previous,candidate){
  const roster=canonicalGuestRoster(participants);
  if(!hash(previous?.ownerKeyId)||!hash(previous.publisherKeyId)||!hash(candidate?.publisherKeyId)||
    previous.ownerKeyId!==candidate.ownerKeyId||
    roster.some(p=>[previous.ownerKeyId,previous.publisherKeyId,candidate.publisherKeyId].includes(p.keyId))) invalid();
  return {version:1,ownerKeyId:previous.ownerKeyId,
    previousPublisherKeyId:previous.publisherKeyId,candidatePublisherKeyId:candidate.publisherKeyId,
    participants:roster};
}
export function validateCapturedGuestRoster(roster,previous,current,stage){
  if(!keys(roster,["version","ownerKeyId","previousPublisherKeyId","candidatePublisherKeyId","participants"])||
    roster.version!==1||!hash(roster.candidatePublisherKeyId)||
    !equal(canonicalGuestRoster(roster.participants),roster.participants)||
    roster.ownerKeyId!==previous?.ownerKeyId||roster.ownerKeyId!==current?.ownerKeyId||
    roster.previousPublisherKeyId!==previous?.publisherKeyId||
    roster[stage==="sqlite_rolled_back"?"previousPublisherKeyId":"candidatePublisherKeyId"]!==current?.publisherKeyId||
    roster.participants.some(p=>[roster.ownerKeyId,roster.previousPublisherKeyId,roster.candidatePublisherKeyId].includes(p.keyId))) invalid();
}

// The verified store returns canonical JSON objects (sorted keys). Evidence
// is excluded from the binding so recording it cannot invalidate its own
// signature. After rollback reconstruct the original committed journal
// from its retained immutable cursors to verify historical candidate evidence.
export function transitionJournalBinding(journal,stage=journal.stage){
  const {guestReconciliationEvidence,...base}=journal;
  if(stage==="sqlite_committed"&&journal.stage==="sqlite_rolled_back"){
    base.stage="sqlite_committed";
    base.sessions=base.sessions.map(({rollbackEpoch,rollbackChecksum,...entry})=>entry);
  }else if(stage!==journal.stage) invalid();
  return sha256(JSON.stringify(base));
}

export function validateHistoricalGuestEvidence(journal,stage,evidence){
  if(!stages.includes(stage)||!keys(evidence,["verifiedAtUnixMs","challenge","receipts"])||
    !journal.guestRoster||!Number.isSafeInteger(evidence.verifiedAtUnixMs)||evidence.verifiedAtUnixMs<1) invalid();
  const {challenge,receipts}=evidence;
  const body=challenge?.body,roster=journal.guestRoster;
  const side=stage==="sqlite_rolled_back"?"previous":"candidate";
  if(!body||!identityFields.every(k=>body[k]===journal[k])||body.sqliteStage!==stage||
    body.targetDescriptorHash!==journal[side+"DescriptorHash"]||
    body.targetBaselineRevision!==journal[side+"BaselineRevision"]||
    body.journalHash!==transitionJournalBinding(journal,stage)||
    body.ownerKeyId!==roster.ownerKeyId||body.publisherKeyId!==roster[side+"PublisherKeyId"]||
    !equal(body.participants,roster.participants)) invalid();
  const result=verifyGuestReconciliationReceipts({challenge,trustedOwnerKeyId:roster.ownerKeyId,
    receipts,nowUnixMs:evidence.verifiedAtUnixMs});
  if(result.status!=="all_enrolled_guests_reported") invalid();
  return result;
}

export function validateStoredGuestEvidence(journal){
  if(!Object.hasOwn(journal,"guestReconciliationEvidence")) return;
  const evidence=journal.guestReconciliationEvidence;
  if(!evidence||typeof evidence!=="object"||Array.isArray(evidence)||!Object.keys(evidence).length||
    Object.keys(evidence).some(stage=>!stages.includes(stage)||
      stage==="sqlite_rolled_back"&&journal.stage!=="sqlite_rolled_back")) invalid();
  for(const [stage,bundle] of Object.entries(evidence)) validateHistoricalGuestEvidence(journal,stage,bundle);
}

// Explicit offline operator attestation, not proof of actual remote process
// state or authoritative live membership. Bound to a fresh complete round.
function finalizationText(evidence){
  const b=evidence.challenge.body;
  return JSON.stringify(["teamforge-offline-transition-finalization-v1",b.journalHash,
    b.hostPointerHash,b.roundId,evidence.verifiedAtUnixMs,
    evidence.receipts.map(r=>[r.participantId,r.signature]),
    "operator-attests-complete-roster-and-stopped-writers"]);
}
export function signOfflineFinalization(evidence,ownerIdentity){
  return {evidence,ownerSignature:signText(ownerIdentity,finalizationText(evidence))};
}
export function validateOfflineFinalization(journal,finalization){
  if(journal.stage!=="sqlite_committed"||!keys(finalization,["evidence","ownerSignature"])) invalid();
  const {evidence,ownerSignature}=finalization;
  validateHistoricalGuestEvidence(journal,journal.stage,evidence);
  const publicKey=evidence.challenge.ownerPublicKey;
  if(typeof ownerSignature!=="string"||! /^[A-Za-z0-9+/]{86}==$/u.test(ownerSignature)||
    Buffer.from(ownerSignature,"base64").toString("base64")!==ownerSignature||
    keyIdFromPublicKey(publicKey)!==journal.guestRoster.ownerKeyId||
    !verifyText(publicKey,finalizationText(evidence),ownerSignature)) invalid();
}
