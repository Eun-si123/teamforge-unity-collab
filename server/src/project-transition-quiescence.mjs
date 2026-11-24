// Narrow in-process Project edit barrier for a FUTURE authorized M4->M5
// transaction. There is NO WebSocket freeze/commit handler. Until real Editor
// pause + ACK exists, begin() permits ONLY an empty client/member set.
// A freeze is in-memory, never a durable transition record or proof of safety
// after process restart. SQLite's transition journal owns crash recovery.

function canonicalProjectId(projectId) {
  return typeof projectId === "string" && projectId.trim() === projectId &&
    projectId.length > 0 && projectId.length <= 128 &&
    !/[\u0000-\u001f\u007f]/u.test(projectId) && projectId.isWellFormed();
}

export class ProjectTransitionQuiescence {
  #pending = new Map();
  #frozen = new Map();

  isFrozen(projectId) { return this.#frozen.has(projectId); }

  pendingCount(projectId) { return this.#pending.get(projectId) ?? 0; }

  // Call synchronously BEFORE the async source verification begins, and
  // release only after its returned Promise settles. A freeze must not race
  // pending source approval, imported Scene verification or Collider admission.
  beginSourceAdmission(projectId) {
    if (!canonicalProjectId(projectId) || this.isFrozen(projectId)) return null;
    this.#pending.set(projectId,this.pendingCount(projectId)+1);
    let released=false;
    return () => {
      if (released) return false;
      released=true;
      const count=this.pendingCount(projectId);
      if(count <= 1) this.#pending.delete(projectId);
      else this.#pending.set(projectId,count-1);
      return true;
    };
  }

  // This API is in-process, never authorized by a peer. It does not accept
  // made-up remote ACKs. Only a fully unoccupied Project can freeze for now.
  // Existing lock leases have to be zero: timed expiry during freeze would
  // otherwise mutate the supposedly stable in-memory Session state.
  beginOfflineFreeze({projectId,connectedClientCount,sessionMemberCount,activeLockCount,approvedBaseline}) {
    if (!canonicalProjectId(projectId) ||
        ![connectedClientCount,sessionMemberCount,activeLockCount].every(value=>
          Number.isSafeInteger(value) && value >= 0))
      return {error:"project_transition_invalid_freeze"};
    if (this.isFrozen(projectId)) return {error:"project_transition_already_frozen"};
    if (connectedClientCount || sessionMemberCount || activeLockCount || this.pendingCount(projectId))
      return {error:"project_transition_not_quiescent"};
    if (!approvedBaseline || typeof approvedBaseline.descriptorHash!=="string" ||
        !/^[a-f0-9]{64}$/u.test(approvedBaseline.descriptorHash) ||
        typeof approvedBaseline.projectUuid!=="string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(approvedBaseline.projectUuid))
      return {error:"project_transition_signed_baseline_required"};
    if (!Number.isSafeInteger(approvedBaseline.baselineRevision) ||
        approvedBaseline.baselineRevision < 1 ||
        typeof approvedBaseline.manifestHash!=="string" ||
        !/^[a-f0-9]{64}$/u.test(approvedBaseline.manifestHash) ||
        typeof approvedBaseline.ownerKeyId!=="string" ||
        !/^[a-f0-9]{64}$/u.test(approvedBaseline.ownerKeyId) ||
        typeof approvedBaseline.ownerPublicKey!=="string" ||
        approvedBaseline.ownerPublicKey.length > 4096)
      return {error:"project_transition_signed_baseline_required"};
    const ticket=Object.freeze({projectId,projectUuid:approvedBaseline.projectUuid,
      baselineRevision:approvedBaseline.baselineRevision,
      manifestHash:approvedBaseline.manifestHash,ownerKeyId:approvedBaseline.ownerKeyId,
      ownerPublicKey:approvedBaseline.ownerPublicKey,
      descriptorHash:approvedBaseline.descriptorHash});
    this.#frozen.set(projectId,ticket);
    return {ticket};
  }

  matches(ticket,descriptorHash) {
    return !!ticket && this.#frozen.get(ticket.projectId) === ticket &&
      ticket.descriptorHash === descriptorHash;
  }

  release(ticket) {
    if (!this.matches(ticket,ticket?.descriptorHash)) return false;
    this.#frozen.delete(ticket.projectId);
    return true;
  }

  clear() {
    this.#frozen.clear();
    this.#pending.clear();
  }
}
