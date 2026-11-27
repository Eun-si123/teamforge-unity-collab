// Proof of possession for an explicitly provisioned participant, bound to a
// single current Editor socket and pause. No identity is inferred from userId.
// This module does not enroll keys, attest saved work or permit a commit.
import {randomBytes,randomUUID} from "node:crypto";
import {performance} from "node:perf_hooks";
import {isDeepStrictEqual as equal} from "node:util";
import {canonicalGuestRoster} from "../../project-peer/src/guest-transition-proof.mjs";
import {verifyText} from "../../project-peer/src/identity.mjs";

const fail=error=>({error,commitPermitted:false});
const id=v=>typeof v==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(v);
const sig=v=>typeof v==="string"&&/^[A-Za-z0-9+/]{86}==$/u.test(v)&&Buffer.from(v,"base64").toString("base64")===v;
export class PausedGuestRoster {
  #rounds=new Map();
  revoke(projectId,pauseId){
    if(this.#rounds.get(projectId)?.pauseId===pauseId) this.#rounds.delete(projectId);
  }
  clear(){this.#rounds.clear();}
  issue({projectId,pauseId,ticket,editors,expiresAtUnixMs,enrollments,excludedKeyIds=[]}){
    // Expired rounds may have been observed by another pause inspection
    // before the normal cancellation notification. Never retain them forever.
    const wall=Date.now(),monotonic=performance.now();
    for(const [id,round] of this.#rounds)
      if(wall<round.issuedAtUnixMs||wall>round.expiresAtUnixMs||monotonic>round.deadline||
        (id===projectId&&(round.pauseId!==pauseId||round.ticket!==ticket))) this.#rounds.delete(id);
    if(this.#rounds.has(projectId)) return fail("guest_roster_round_exists");
    if(this.#rounds.size>=128) return fail("guest_roster_limit");
    try{
      if(!Array.isArray(editors)||!editors.length||editors.length>128||
          !Array.isArray(enrollments)||enrollments.length!==editors.length||
          !id(pauseId)||!Number.isSafeInteger(expiresAtUnixMs)) throw Error();
      const now=Date.now(),remaining=expiresAtUnixMs-now;
      if(remaining<=0||remaining>30_000) throw Error();
      if(enrollments.some(p=>!p||typeof p!=="object"||Array.isArray(p)||
          !equal(Object.keys(p).sort(),["connectionId","keyId","participantId","publicKey"])||!id(p.connectionId))) throw Error();
      const roster=canonicalGuestRoster(enrollments.map(({participantId,keyId,publicKey})=>({participantId,keyId,publicKey})));
      if(roster.some(p=>excludedKeyIds.includes(p.keyId))) throw Error();
      const entries=new Map(),messages=[];
      for(const e of editors){
        const matches=enrollments.filter(p=>p.connectionId===e.connectionId);
        if(matches.length!==1||entries.has(e.connectionId)||!id(e.connectionId)) throw Error();
        const p=matches[0];
        const challengeId=randomUUID(),nonce=randomBytes(32).toString("hex");
        const payload=JSON.stringify(["teamforge-m5-participant-possession-v1",projectId,ticket.projectUuid,
          ticket.descriptorHash,pauseId,e.connectionId,e.sessionId,e.authorityEpoch,e.durableSessionId,
          e.serverRevision,p.participantId,p.keyId,challengeId,nonce,expiresAtUnixMs]);
        entries.set(e.connectionId,{participant:roster.find(r=>r.participantId===p.participantId),
          challengeId,payload,confirmed:false});
        messages.push({connectionId:e.connectionId,challengeId,payload,expiresAtUnixMs});
      }
      this.#rounds.set(projectId,{pauseId,ticket,editors:structuredClone(editors),entries,
        issuedAtUnixMs:now,expiresAtUnixMs,deadline:performance.now()+remaining});
      return {messages,expectedCount:entries.size,commitPermitted:false};
    }catch{return fail("guest_roster_invalid_enrollment");}
  }
  #current({projectId,pauseId,ticket,editors}){
    const round=this.#rounds.get(projectId);
    if(!round||round.pauseId!==pauseId) return null;
    if(round.ticket!==ticket||!equal(round.editors,editors)||Date.now()<round.issuedAtUnixMs||
        Date.now()>round.expiresAtUnixMs||performance.now()>round.deadline){
      this.revoke(projectId,pauseId);return null;
    }
    return round;
  }
  consume({projectId,pauseId,ticket,editors,connectionId,challengeId,signature}){
    const round=this.#current({projectId,pauseId,ticket,editors});
    const entry=round?.entries.get(connectionId);
    if(!entry||entry.confirmed) return fail("guest_roster_proof_stale");
    if(entry.challengeId!==challengeId||!sig(signature)||
        !verifyText(entry.participant.publicKey,entry.payload,signature)){
      this.revoke(projectId,pauseId);
      return fail("guest_roster_proof_invalid");
    }
    entry.confirmed=true;
    return {confirmedCount:[...round.entries.values()].filter(x=>x.confirmed).length,
      expectedCount:round.entries.size,commitPermitted:false};
  }
  capture(context){
    const round=this.#current(context);
    if(!round) return fail("guest_roster_proof_stale");
    const entries=[...round.entries.values()];
    if(entries.some(x=>!x.confirmed)) return {status:"guest_roster_pending",
      confirmedCount:entries.filter(x=>x.confirmed).length,expectedCount:entries.length,commitPermitted:false};
    return {status:"paused_guest_roster_verified",guestParticipants:canonicalGuestRoster(entries.map(x=>x.participant)),
      expectedCount:entries.length,connectedRosterVerified:true,offlineParticipantsVerified:false,
      commitPermitted:false,editorResumePermitted:false};
  }
}
