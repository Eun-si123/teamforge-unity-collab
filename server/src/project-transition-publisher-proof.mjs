// In-process future M4->M5 Publisher key-possession proof. A signed Baseline
// file alone is replayable and does NOT demonstrate that its Publisher still
// owns the signing key. Domain-separate a fresh, one-use, 32-byte nonce from
// the historic signed Descriptor, bind exact old/new Project and freeze ID.
// This is NOT wired to WebSocket or the SQLite/Host commit state machine.
import { createPublicKey, randomBytes, randomUUID, verify as verifySignature } from "node:crypto";
import { descriptorIsCompatible, verifyProjectDescriptor } from "./project-coordinator.mjs";

const MAX_CHALLENGES=128;
const CHALLENGE_LIFETIME_MS=30_000;

export class ProjectTransitionPublisherProof {
  #quiescence;
  #pending=new Map();
  #verified=new Map();

  constructor(quiescence) { this.#quiescence=quiescence; }

  issue({ticket,candidate,nowUnixMs=Date.now()}) {
    if (!this.#quiescence?.matches(ticket,ticket?.descriptorHash))
      return {error:"project_transition_freeze_required"};
    if (!Number.isSafeInteger(nowUnixMs) || nowUnixMs < 1 ||
        nowUnixMs > Number.MAX_SAFE_INTEGER-CHALLENGE_LIFETIME_MS)
      return {error:"project_transition_invalid_time"};
    // Retire expired nonces when a future request arrives, without relying on
    // a background timer or on the Editor sending an expiration message.
    for(const [key,stored] of this.#pending)
      if (stored.expiresAtUnixMs < nowUnixMs || !this.#quiescence.matches(stored.ticket,stored.ticket.descriptorHash))
        this.#pending.delete(key);
    if (this.#verified.has(ticket.projectId))
      return {error:"project_transition_proof_already_verified"};
    if (this.#pending.has(ticket.projectId))
      return {error:"project_transition_challenge_pending"};
    if (this.#pending.size >= MAX_CHALLENGES)
      return {error:"project_transition_challenge_limit"};
    if (!candidate || typeof candidate !== "object" ||
        candidate.projectUuid!==ticket.projectUuid ||
        candidate.baselineRevision!==ticket.baselineRevision+1 ||
        candidate.ownerKeyId!==ticket.ownerKeyId ||
        candidate.ownerPublicKey!==ticket.ownerPublicKey ||
        candidate.descriptorHash===ticket.descriptorHash ||
        !descriptorIsCompatible(candidate))
      return {error:"project_transition_candidate_invalid"};

    // Verify actual Ed25519 Baseline signature and Owner authorization of a
    // separate Publisher; NEVER accept a caller-supplied public key alone.
    const verified=verifyProjectDescriptor(candidate,ticket.projectId);
    if (verified.error)
      return {error:"project_transition_candidate_invalid"};
    let publicKey;
    try {
      publicKey=createPublicKey({key:Buffer.from(candidate.publisherPublicKey,"base64"),
        format:"der",type:"spki"});
      if (publicKey.asymmetricKeyType!=="ed25519") throw new Error("Invalid Publisher key.");
    } catch {return {error:"project_transition_candidate_invalid"};}
    const challengeId=randomUUID();
    const nonce=randomBytes(32).toString("base64url");
    const expiresAtUnixMs=nowUnixMs+CHALLENGE_LIFETIME_MS;
    const payload=[
      "teamforge-m4m5-publisher-possession-v1",
      ticket.projectId,ticket.projectUuid,
      String(ticket.baselineRevision),ticket.manifestHash,ticket.descriptorHash,
      String(candidate.baselineRevision),candidate.manifestHash,candidate.descriptorHash,
      candidate.publisherKeyId,challengeId,nonce,String(expiresAtUnixMs),
    ].join("\n");
    this.#pending.set(ticket.projectId,{ticket,challengeId,payload,publicKey,
      nonce,issuedAtUnixMs:nowUnixMs,expiresAtUnixMs,
      candidateDescriptorHash:candidate.descriptorHash});
    return Object.freeze({challengeId,payload,expiresAtUnixMs});
  }

  consume({ticket,challengeId,signature,nowUnixMs=Date.now()}) {
    const pending=this.#pending.get(ticket?.projectId);
    // Any attempt that names the valid active freeze consumes the nonce,
    // including wrong signatures, stale timestamps and wrong request IDs.
    if (!this.#quiescence?.matches(ticket,ticket?.descriptorHash) || !pending ||
        pending.ticket!==ticket)
      return {error:"project_transition_challenge_missing"};
    this.#pending.delete(ticket.projectId);
    if (!Number.isSafeInteger(nowUnixMs) || nowUnixMs > pending.expiresAtUnixMs ||
        nowUnixMs < pending.issuedAtUnixMs || challengeId!==pending.challengeId ||
        typeof signature!=="string" || signature.length>128 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)$/u.test(signature))
      return {error:"project_transition_publisher_proof_invalid"};
    const bytes=Buffer.from(signature,"base64");
    if (bytes.length!==64 || bytes.toString("base64")!==signature ||
        !verifySignature(null,Buffer.from(pending.payload,"utf8"),pending.publicKey,bytes))
      return {error:"project_transition_publisher_proof_invalid"};
    const receipt=Object.freeze({verified:true,projectId:ticket.projectId,
      projectUuid:ticket.projectUuid,challengeId:pending.challengeId,
      candidateDescriptorHash:pending.candidateDescriptorHash,
      expiresAtUnixMs:pending.expiresAtUnixMs});
    this.#verified.set(ticket.projectId,{ticket,receipt});
    return receipt;
  }

  matchesReceipt({ticket,receipt,candidateDescriptorHash,nowUnixMs=Date.now()}) {
    const stored=this.#verified.get(ticket?.projectId);
    return Boolean(stored && stored.ticket===ticket && stored.receipt===receipt &&
      receipt?.candidateDescriptorHash===candidateDescriptorHash &&
      Number.isSafeInteger(nowUnixMs) && nowUnixMs <= receipt.expiresAtUnixMs &&
      this.#quiescence.matches(ticket,ticket.descriptorHash));
  }

  revoke(ticket) {
    const pending=this.#pending.get(ticket?.projectId);
    const verified=this.#verified.get(ticket?.projectId);
    if (pending?.ticket!==ticket && verified?.ticket!==ticket) return false;
    if (pending?.ticket===ticket) this.#pending.delete(ticket.projectId);
    if (verified?.ticket===ticket) this.#verified.delete(ticket.projectId);
    return true;
  }

  clear() {this.#pending.clear();this.#verified.clear();}
}
