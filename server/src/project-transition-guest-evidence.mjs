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
const pointerFields=["schemaVersion","projectUuid","baselineRevision","manifestHash","descriptorHash","ownerKeyId","approvedAtUnixMs"];
const pointerValues=p=>pointerFields.map(k=>p[k]);
// Forward write-ahead intent is part of the exact SQLite journal and thus
// of the signed Guest/Owner finalization binding. No separate schema.
// Stable prior-cursor binding independent of in-memory proposed plan and
// object property order. Includes the complete session set, revision, epoch
// and checkpoint checksum. SQLite journal uses the same canonical rows.
export function priorCursorBinding(sessions){
  return sha256(JSON.stringify(sessions.map(s=>[s.sessionId,s.previousEpoch,s.revision,s.previousChecksum])
    .sort((a,b)=>Buffer.compare(Buffer.from(a[0],"utf8"),Buffer.from(b[0],"utf8")))));
}
export function validateForwardFence(journal,fence){
  if(!keys(fence,["schemaVersion","kind",...identityFields,"planHash","priorCursorHash","before","target"])||
    fence.schemaVersion!==1||fence.kind!=="host_baseline_forward"||
    !identityFields.every(k=>fence[k]===journal[k])||!hash(fence.planHash)||
    !hash(fence.priorCursorHash)||fence.priorCursorHash!==priorCursorBinding(journal.sessions)) invalid();
  const matches=(p,side)=>keys(p,pointerFields)&&p.schemaVersion===1&&p.projectUuid===journal.projectUuid&&
    p.baselineRevision===journal[side+"BaselineRevision"]&&p.manifestHash===journal[side+"ManifestHash"]&&
    p.descriptorHash===journal[side+"DescriptorHash"]&&p.ownerKeyId===journal.guestRoster?.ownerKeyId&&
    Number.isSafeInteger(p.approvedAtUnixMs)&&p.approvedAtUnixMs>0;
  if(!matches(fence.before,"previous")||!matches(fence.target,"candidate")||
    fence.target.approvedAtUnixMs<=fence.before.approvedAtUnixMs) invalid();
}
export function validateCompletedRollbackFence(journal,fence){
  if(journal.stage!=="sqlite_rolled_back"||
    !keys(fence,["schemaVersion","kind",...identityFields,"recoveredAtUnixMs","before","target"])||
    fence.schemaVersion!==1||fence.kind!=="host_baseline_rollback"||
    !identityFields.every(k=>fence[k]===journal[k])||
    !Number.isSafeInteger(fence.recoveredAtUnixMs)||fence.recoveredAtUnixMs<1) invalid();
  const matches=(p,side)=>keys(p,pointerFields)&&p.schemaVersion===1&&p.projectUuid===journal.projectUuid&&
    p.baselineRevision===journal[side+"BaselineRevision"]&&p.manifestHash===journal[side+"ManifestHash"]&&
    p.descriptorHash===journal[side+"DescriptorHash"]&&p.ownerKeyId===journal.guestRoster?.ownerKeyId&&
    Number.isSafeInteger(p.approvedAtUnixMs)&&p.approvedAtUnixMs>0;
  if(!matches(fence.target,"previous")||
    (!matches(fence.before,"previous")&&!matches(fence.before,"candidate"))) invalid();
  if(matches(fence.before,"previous")?!equal(fence.before,fence.target):
    fence.target.approvedAtUnixMs!==fence.recoveredAtUnixMs) invalid();
}
function finalizationText(evidence,rollbackFence){
  const b=evidence.challenge.body;
  const parts=["teamforge-offline-transition-finalization-v1",b.journalHash,
    b.hostPointerHash,b.roundId,evidence.verifiedAtUnixMs,
    evidence.receipts.map(r=>[r.participantId,r.signature]),
    "operator-attests-complete-roster-and-stopped-writers"];
  if(rollbackFence) parts.push(["rollback-fence-v1",...identityFields.map(k=>rollbackFence[k]),
    rollbackFence.recoveredAtUnixMs,pointerValues(rollbackFence.before),pointerValues(rollbackFence.target)]);
  return JSON.stringify(parts);
}
export function signOfflineFinalization(evidence,ownerIdentity,rollbackFence){
  return {evidence,...(rollbackFence?{rollbackFence}:{}),ownerSignature:signText(ownerIdentity,finalizationText(evidence,rollbackFence))};
}
export function validateOfflineFinalization(journal,finalization){
  const rolledBack=journal.stage==="sqlite_rolled_back";
  if(!stages.includes(journal.stage)||!keys(finalization,["evidence","ownerSignature",...(rolledBack?["rollbackFence"]:[])])) invalid();
  const {evidence,ownerSignature,rollbackFence}=finalization;
  if(rolledBack) validateCompletedRollbackFence(journal,rollbackFence);
  validateHistoricalGuestEvidence(journal,journal.stage,evidence);
  if(!rolledBack&&journal.hostForwardFence){
    const target=journal.hostForwardFence.target;
    const ordered=Object.fromEntries(pointerFields.map(k=>[k,target[k]]));
    if(evidence.challenge.body.hostPointerHash!==sha256(JSON.stringify(ordered))) invalid();
  }
  const publicKey=evidence.challenge.ownerPublicKey;
  if(typeof ownerSignature!=="string"||! /^[A-Za-z0-9+/]{86}==$/u.test(ownerSignature)||
    Buffer.from(ownerSignature,"base64").toString("base64")!==ownerSignature||
    keyIdFromPublicKey(publicKey)!==journal.guestRoster.ownerKeyId||
    !verifyText(publicKey,finalizationText(evidence,rollbackFence),ownerSignature)) invalid();
}
