// The caller supplies locally trusted Project/participant identity and the
// exact active socket's negotiated pause cursor. Never sign opaque text
// supplied by the server without checking the domain and all bindings.
import {validateIdentity,signText} from "./identity.mjs";
import {fail} from "./errors.mjs";
const uuid=v=>typeof v==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(v);
const hash=v=>typeof v==="string"&&/^[a-f0-9]{64}$/u.test(v);
const id=v=>typeof v==="string"&&v.length>0&&v.length<=128&&v.trim()===v&&v.isWellFormed()&&!/[\u0000-\u001f\u007f]/u.test(v);
const refuse=()=>fail("guest_roster_challenge_invalid","Participant challenge differs from the local paused connection.");
export function signPausedGuestChallenge({challenge,context,identity,nowUnixMs=Date.now()}={}){
  validateIdentity(identity);
  if(!context||!id(context.projectId)||!uuid(context.projectUuid)||!hash(context.descriptorHash)||
    !uuid(context.pauseId)||!uuid(context.connectionId)||!id(context.sessionId)||
    !uuid(context.authorityEpoch)||!uuid(context.durableSessionId)||
    !Number.isSafeInteger(context.serverRevision)||context.serverRevision<0||!id(context.participantId)||
    !Number.isSafeInteger(nowUnixMs)||nowUnixMs<1||
    !Number.isSafeInteger(context.expiresAtUnixMs)||context.expiresAtUnixMs<nowUnixMs||
    !challenge||challenge.type!=="project_guest_transition_challenge"||challenge.protocolVersion!==1||
    challenge.pauseId!==context.pauseId||!uuid(challenge.challengeId)||
    challenge.expiresAtUnixMs!==context.expiresAtUnixMs||context.expiresAtUnixMs-nowUnixMs>30_000||
    typeof challenge.payload!=="string"||challenge.payload.length>4096) refuse();
  let fields;
  try{fields=JSON.parse(challenge.payload);}catch{refuse();}
  if(!Array.isArray(fields)||fields.length!==15||!hash(fields[13])) refuse();
  const expected=JSON.stringify(["teamforge-m5-participant-possession-v1",context.projectId,context.projectUuid,
    context.descriptorHash,context.pauseId,context.connectionId,context.sessionId,context.authorityEpoch,
    context.durableSessionId,context.serverRevision,context.participantId,identity.keyId,challenge.challengeId,
    fields[13],context.expiresAtUnixMs]);
  if(expected!==challenge.payload) refuse();
  return {pauseId:context.pauseId,challengeId:challenge.challengeId,signature:signText(identity,expected)};
}
