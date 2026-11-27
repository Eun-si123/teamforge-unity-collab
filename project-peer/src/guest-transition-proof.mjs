// Internal offline reconciliation evidence. Provisioned participant keys and
// the roster are supplied by a trusted operator, not learned from a peer.
// No wire protocol, enrollment, or Editor resume authority is defined here.
import {isDeepStrictEqual as equal} from "node:util";
import {randomBytes,randomUUID} from "node:crypto";
import {keyIdFromPublicKey,signText,validateIdentity,verifyText} from "./identity.mjs";
import {sha256} from "./hash.mjs";
import {inspectGuestTransition} from "./guest-transition-inspection.mjs";
import {inspectGuestDestination} from "./guest-destination.mjs";
import {inspectGuestStateRoot} from "./guest-state.mjs";
import {readGuestTrustPin} from "./guest-trust.mjs";
import {fail} from "./errors.mjs";

const MAX_PARTICIPANTS=128, MAX_LIFETIME_MS=300_000;
const hash=v=>typeof v==="string"&&/^[a-f0-9]{64}$/u.test(v);
const uuid=v=>typeof v==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(v);
const textId=v=>typeof v==="string"&&v.length>0&&v.length<=128&&v.trim()===v&&v.isWellFormed()&&!/[\u0000-\u001f\u007f]/u.test(v);
const time=v=>Number.isSafeInteger(v)&&v>0;
const exact=(v,keys)=>v&&typeof v==="object"&&!Array.isArray(v)&&equal(Object.keys(v).sort(),[...keys].sort());
const validPublicKey=v=>typeof v==="string"&&v.length<=128;
const signature=v=>typeof v==="string"&&/^[A-Za-z0-9+/]{86}==$/u.test(v)&&Buffer.from(v,"base64").toString("base64")===v;
const reject=()=>fail("guest_transition_proof_invalid","The exact signed reconciliation round or participant proof is invalid or stale.");
const contextKeys=["projectId","projectUuid","transitionId","previousDescriptorHash","candidateDescriptorHash",
  "targetDescriptorHash","targetBaselineRevision","sqliteStage","journalHash","hostPointerHash","ownerKeyId","publisherKeyId"];
const bodyKeys=["schemaVersion","kind",...contextKeys,"roundId","nonce","issuedAtUnixMs","expiresAtUnixMs","participants"];
const proofKeys=["schemaVersion","kind","roundHash","participantId","keyId","activeDescriptorHash","activeBaselineRevision","savedManifestMatches","signature"];

export function canonicalGuestRoster(participants){
  if(!Array.isArray(participants)||participants.length<1||participants.length>MAX_PARTICIPANTS) reject();
  const ids=new Set(),keys=new Set();
  return participants.map(p=>{
    if(!exact(p,["participantId","keyId","publicKey"])||!textId(p.participantId)||
      !hash(p.keyId)||!validPublicKey(p.publicKey)||keyIdFromPublicKey(p.publicKey)!==p.keyId||
      ids.has(p.participantId)||keys.has(p.keyId)) reject();
    ids.add(p.participantId);keys.add(p.keyId);
    return {participantId:p.participantId,keyId:p.keyId,publicKey:p.publicKey};
  }).sort((a,b)=>a.participantId<b.participantId?-1:a.participantId>b.participantId?1:0);
}
function contextOf(v){
  if(!v||!textId(v.projectId)||!uuid(v.projectUuid)||!uuid(v.transitionId)||
    !["previousDescriptorHash","candidateDescriptorHash","targetDescriptorHash","journalHash","hostPointerHash","ownerKeyId","publisherKeyId"].every(k=>hash(v[k]))||
    v.previousDescriptorHash===v.candidateDescriptorHash||!time(v.targetBaselineRevision)||
    !["sqlite_committed","sqlite_rolled_back"].includes(v.sqliteStage)||
    v.targetDescriptorHash!==(v.sqliteStage==="sqlite_rolled_back"?v.previousDescriptorHash:v.candidateDescriptorHash)) reject();
  return Object.fromEntries(contextKeys.map(k=>[k,v[k]]));
}
function canonicalBody(body){
  if(!exact(body,bodyKeys)||body.schemaVersion!==1||body.kind!=="teamforge-guest-reconciliation-v1"||
    !uuid(body.roundId)||!hash(body.nonce)||!time(body.issuedAtUnixMs)||!time(body.expiresAtUnixMs)||
    body.expiresAtUnixMs<=body.issuedAtUnixMs||body.expiresAtUnixMs-body.issuedAtUnixMs>MAX_LIFETIME_MS) reject();
  const participants=canonicalGuestRoster(body.participants);
  if(!equal(participants,body.participants)||participants.some(p=>p.keyId===body.ownerKeyId||p.keyId===body.publisherKeyId)) reject();
  return {schemaVersion:1,kind:body.kind,...contextOf(body),roundId:body.roundId,nonce:body.nonce,
    issuedAtUnixMs:body.issuedAtUnixMs,expiresAtUnixMs:body.expiresAtUnixMs,participants};
}
const roundText=body=>JSON.stringify(canonicalBody(body));
const roundHash=body=>sha256(roundText(body));
function assertFresh(body,now){
  if(!time(now)||now<body.issuedAtUnixMs||now>body.expiresAtUnixMs) reject();
}
export function createGuestReconciliationChallenge({context,participants,ownerIdentity,nowUnixMs=Date.now(),lifetimeMs=MAX_LIFETIME_MS}={}){
  const ctx=contextOf(context);
  validateIdentity(ownerIdentity);
  if(ownerIdentity.keyId!==ctx.ownerKeyId||!time(nowUnixMs)||!time(lifetimeMs)||
    lifetimeMs>MAX_LIFETIME_MS||!time(nowUnixMs+lifetimeMs)) reject();
  const body=canonicalBody({schemaVersion:1,kind:"teamforge-guest-reconciliation-v1",...ctx,
    roundId:randomUUID(),nonce:randomBytes(32).toString("hex"),issuedAtUnixMs:nowUnixMs,
    expiresAtUnixMs:nowUnixMs+lifetimeMs,participants:canonicalGuestRoster(participants)});
  return {body,ownerPublicKey:ownerIdentity.publicKey,signature:signText(ownerIdentity,roundText(body))};
}
export function verifyGuestReconciliationChallenge(challenge,{trustedOwnerKeyId,nowUnixMs=Date.now()}={}){
  if(!exact(challenge,["body","ownerPublicKey","signature"])||!hash(trustedOwnerKeyId)||
    !validPublicKey(challenge.ownerPublicKey)||!signature(challenge.signature)||
    keyIdFromPublicKey(challenge.ownerPublicKey)!==trustedOwnerKeyId) reject();
  const body=canonicalBody(challenge.body);
  assertFresh(body,nowUnixMs);
  if(body.ownerKeyId!==trustedOwnerKeyId||!verifyText(challenge.ownerPublicKey,roundText(body),challenge.signature)) reject();
  return body;
}
function receiptBody(v){
  return {schemaVersion:1,kind:"teamforge-guest-reconciliation-receipt-v1",
    roundHash:v.roundHash,participantId:v.participantId,keyId:v.keyId,
    activeDescriptorHash:v.activeDescriptorHash,activeBaselineRevision:v.activeBaselineRevision,savedManifestMatches:true};
}
// Always inspect the actual local Active; no caller-supplied success report.
// Signed result attests what this Guest reports, not independent proof of
// arbitrary remote disk contents, an unsaved Editor state or process stop.
export async function signGuestReconciliationReceipt({challenge,request,participantId,identity,signal}={}){
  if(!request||typeof request.managedRoot!=="string"||typeof request.stateRoot!=="string") reject();
  request=Object.freeze({...request});
  challenge=structuredClone(challenge);
  identity=Object.freeze({...validateIdentity(identity)});
  const localTrust=async()=>{
    const destination=await inspectGuestDestination({destinationRoot:request.managedRoot});
    const state=await inspectGuestStateRoot({stateRoot:request.stateRoot,destinationRoot:destination.destination});
    if(!state.managed) reject();
    const trust=await readGuestTrustPin(state.guestRoot,request.projectUuid);
    if(trust.state!=="valid"||!trust.pin) reject();
    return trust.pin;
  };
  const trust=await localTrust();
  const body=verifyGuestReconciliationChallenge(challenge,{trustedOwnerKeyId:trust.ownerKeyId});
  const participant=body.participants.find(p=>p.participantId===participantId);
  if(!participant||participant.keyId!==identity.keyId||participant.publicKey!==identity.publicKey||
    body.publisherKeyId!==trust.publisherKeyId||
    !["projectId","projectUuid","transitionId","previousDescriptorHash","candidateDescriptorHash"].every(k=>body[k]===request[k])) reject();
  const report=await inspectGuestTransition({...request,signal});
  signal?.throwIfAborted();
  if(report.status!=="guest_saved_manifest_matches"||report.trustState!=="match"||
    report.activeDescriptorHash!==body.targetDescriptorHash||
    report.activeBaselineRevision!==body.targetBaselineRevision||!equal(await localTrust(),trust)) reject();
  assertFresh(body,Date.now());
  const receipt=receiptBody({roundHash:roundHash(body),participantId,keyId:identity.keyId,
    activeDescriptorHash:report.activeDescriptorHash,activeBaselineRevision:report.activeBaselineRevision});
  return {...receipt,signature:signText(identity,JSON.stringify(receipt))};
}
export function verifyGuestReconciliationReceipts({challenge,trustedOwnerKeyId,receipts,nowUnixMs=Date.now()}={}){
  const body=verifyGuestReconciliationChallenge(challenge,{trustedOwnerKeyId,nowUnixMs});
  if(!Array.isArray(receipts)||receipts.length>body.participants.length) reject();
  const seen=new Set(),digest=roundHash(body);
  for(const r of receipts){
    if(!exact(r,proofKeys)||r.schemaVersion!==1||r.kind!=="teamforge-guest-reconciliation-receipt-v1"||
      r.roundHash!==digest||r.activeDescriptorHash!==body.targetDescriptorHash||
      r.activeBaselineRevision!==body.targetBaselineRevision||r.savedManifestMatches!==true||
      !signature(r.signature)||seen.has(r.participantId)) reject();
    const p=body.participants.find(p=>p.participantId===r.participantId);
    if(!p||r.keyId!==p.keyId||!verifyText(p.publicKey,JSON.stringify(receiptBody(r)),r.signature)) reject();
    seen.add(r.participantId);
  }
  return {status:seen.size===body.participants.length?"all_enrolled_guests_reported":"guest_receipts_pending",
    expectedCount:body.participants.length,confirmedCount:seen.size,
    missingParticipants:body.participants.filter(p=>!seen.has(p.participantId)).map(p=>p.participantId),
    roundId:body.roundId,transitionId:body.transitionId,targetDescriptorHash:body.targetDescriptorHash,
    rosterCompletenessVerified:false,unsavedEditorStateVerified:false,editorResumePermitted:false,
    journalResolutionPermitted:false};
}
