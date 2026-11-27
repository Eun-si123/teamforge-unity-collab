// In-process Project edit barrier for a FUTURE authorized M4->M5 transaction.
// Offline freeze requires zero connected Editors. Online preparation only
// accepts explicit opt-in simulated/compatible Editor ACKs and NEVER grants
// publication or cross-store commit. No remote pause initiator exists.
// An online ACK is an internal transport-stage observation, NOT an Editor
// local filesystem guarantee or permission for any cross-store M5 commit.
// A freeze is in-memory, never a durable transition record or proof of safety
// after process restart. SQLite's transition journal owns crash recovery.
import { randomUUID } from "node:crypto";

function canonicalProjectId(projectId) {
  return typeof projectId === "string" && projectId.trim() === projectId &&
    projectId.length > 0 && projectId.length <= 128 &&
    !/[\u0000-\u001f\u007f]/u.test(projectId) && projectId.isWellFormed();
}

export class ProjectTransitionQuiescence {
  #pending = new Map();
  #frozen = new Map();
  #online = new Map();

  isFrozen(projectId) { return this.#frozen.has(projectId) || this.#online.has(projectId); }
  isOnlinePausing(projectId) { return this.#online.has(projectId); }

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
    const ticket = this.#signedTicket(projectId,approvedBaseline);
    if (!ticket) return {error:"project_transition_signed_baseline_required"};
    this.#frozen.set(projectId,ticket);
    return {ticket};
  }

  #signedTicket(projectId,approvedBaseline) {
    if (!approvedBaseline || typeof approvedBaseline.descriptorHash!=="string" ||
        !/^[a-f0-9]{64}$/u.test(approvedBaseline.descriptorHash) ||
        typeof approvedBaseline.projectUuid!=="string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(approvedBaseline.projectUuid) ||
        !Number.isSafeInteger(approvedBaseline.baselineRevision) ||
        approvedBaseline.baselineRevision < 1 ||
        typeof approvedBaseline.manifestHash!=="string" ||
        !/^[a-f0-9]{64}$/u.test(approvedBaseline.manifestHash) ||
        typeof approvedBaseline.ownerKeyId!=="string" ||
        !/^[a-f0-9]{64}$/u.test(approvedBaseline.ownerKeyId) ||
        typeof approvedBaseline.ownerPublicKey!=="string" ||
        approvedBaseline.ownerPublicKey.length > 4096) return null;
    return Object.freeze({projectId,projectUuid:approvedBaseline.projectUuid,
      baselineRevision:approvedBaseline.baselineRevision,
      manifestHash:approvedBaseline.manifestHash,ownerKeyId:approvedBaseline.ownerKeyId,
      ownerPublicKey:approvedBaseline.ownerPublicKey,
      descriptorHash:approvedBaseline.descriptorHash});
  }

  // Caller must supply the exact current authenticated Project Editor roster
  // and independently captured M4 Server checkpoints. No network user can
  // issue this command. This installs the barrier SYNCHRONOUSLY, *before* the
  // first pause notification is sent to a client.
  beginOnlinePause({projectId,approvedBaseline,editors,sessionMemberCount,
    activeLockCount,nowUnixMs=Date.now(),timeoutMilliseconds=15_000}) {
    if (!canonicalProjectId(projectId) || !Array.isArray(editors) ||
        !Number.isSafeInteger(sessionMemberCount) || sessionMemberCount<0 ||
        !Number.isSafeInteger(activeLockCount) || activeLockCount<0 ||
        !Number.isSafeInteger(nowUnixMs) || nowUnixMs<1 ||
        !Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds<1000 ||
        timeoutMilliseconds>30_000 || nowUnixMs>Number.MAX_SAFE_INTEGER-timeoutMilliseconds)
      return {error:"project_transition_invalid_pause"};
    if (this.isFrozen(projectId)) return {error:"project_transition_already_frozen"};
    if (!editors.length || editors.length>128 || sessionMemberCount!==editors.length ||
        activeLockCount!==0 || this.pendingCount(projectId)!==0)
      return {error:"project_transition_not_quiescent"};
    const ticket=this.#signedTicket(projectId,approvedBaseline);
    if (!ticket) return {error:"project_transition_signed_baseline_required"};
    const expected=new Map();
    for(const editor of editors) {
      if (!editor || typeof editor.connectionId!=="string" || !editor.connectionId ||
          typeof editor.sessionId!=="string" || !editor.sessionId ||
          typeof editor.authorityEpoch!=="string" ||
          !/^[a-f0-9-]{36}$/u.test(editor.authorityEpoch) ||
          typeof editor.durableSessionId!=="string" ||
          !/^[a-f0-9-]{36}$/u.test(editor.durableSessionId) ||
          !Number.isSafeInteger(editor.serverRevision) || editor.serverRevision<0 ||
          expected.has(editor.connectionId))
        return {error:"project_transition_invalid_roster"};
      expected.set(editor.connectionId,Object.freeze({...editor}));
    }
    const pauseId=randomUUID();
    const expiresAtUnixMs=nowUnixMs+timeoutMilliseconds;
    const transition={ticket,pauseId,expected,confirmed:new Set(),expiresAtUnixMs};
    this.#online.set(projectId,transition);
    return {ticket,pauseId,expiresAtUnixMs,expectedCount:expected.size};
  }

  // ACK is a report from the exact authenticated active connection, not a
  // transfer of signing/commit authority. A single refusal aborts everyone.
  acknowledgeOnlinePause({projectId,connectionId,pauseId,status,serverRevision,
    authorityEpoch,durableSessionId,nowUnixMs=Date.now()}) {
    const transition=this.#online.get(projectId);
    if (!transition || transition.pauseId!==pauseId ||
        !Number.isSafeInteger(nowUnixMs) || nowUnixMs>transition.expiresAtUnixMs ||
        nowUnixMs<1) return {error:"project_transition_pause_stale"};
    const editor=transition.expected.get(connectionId);
    if (!editor || transition.confirmed.has(connectionId))
      return {error:"project_transition_pause_unexpected_ack"};
    if (status!=="ready" && status!=="busy")
      return {error:"project_transition_pause_invalid_ack"};
    if (status==="busy") {
      this.#online.delete(projectId);
      return {error:"project_transition_editor_busy",aborted:true};
    }
    if (serverRevision!==editor.serverRevision ||
        authorityEpoch!==editor.authorityEpoch || durableSessionId!==editor.durableSessionId) {
      this.#online.delete(projectId);
      return {error:"project_transition_editor_stale",aborted:true};
    }
    transition.confirmed.add(connectionId);
    return {accepted:true,ready:transition.confirmed.size===transition.expected.size,
      confirmedCount:transition.confirmed.size,expectedCount:transition.expected.size};
  }

  onlineStatus(projectId,pauseId,nowUnixMs=Date.now()) {
    const transition=this.#online.get(projectId);
    if (!transition || transition.pauseId!==pauseId) return null;
    if (!Number.isSafeInteger(nowUnixMs) || nowUnixMs>transition.expiresAtUnixMs) {
      this.#online.delete(projectId);
      return {error:"project_transition_pause_timeout",expired:true};
    }
    return {ready:transition.confirmed.size===transition.expected.size,
      confirmedCount:transition.confirmed.size,expectedCount:transition.expected.size,
      ticket:transition.ticket,expiresAtUnixMs:transition.expiresAtUnixMs};
  }

  // Internal exact current connected roster; no mutable authority ticket
  // or caller-provided member set. Available only after every pause ACK.
  confirmedOnlineEditors(projectId,pauseId){
    const transition=this.#online.get(projectId);
    if(!transition||transition.pauseId!==pauseId||Date.now()>transition.expiresAtUnixMs||
        transition.confirmed.size!==transition.expected.size) return null;
    return [...transition.expected.values()].map(editor=>({...editor}));
  }

  onlineConnectionLost(projectId,connectionId) {
    const transition=this.#online.get(projectId);
    if (!transition || !transition.expected.has(connectionId)) return null;
    this.#online.delete(projectId);
    return {error:"project_transition_editor_disconnected",pauseId:transition.pauseId};
  }

  cancelOnlinePause(projectId,pauseId) {
    const transition=this.#online.get(projectId);
    if (!transition || transition.pauseId!==pauseId) return false;
    this.#online.delete(projectId);
    return true;
  }

  expiredOnlinePauses(nowUnixMs=Date.now()) {
    const expired=[];
    for(const [projectId,transition] of this.#online)
      if (!Number.isSafeInteger(nowUnixMs) || nowUnixMs>transition.expiresAtUnixMs) {
        this.#online.delete(projectId);
        expired.push({projectId,pauseId:transition.pauseId});
      }
    return expired;
  }

  // The existing offline proof APIs must never borrow an online transport
  // ticket: offline means zero connected Editors, not merely all ACKs.
  matchesOffline(ticket,descriptorHash) {
    return Boolean(ticket && ticket.descriptorHash===descriptorHash &&
      this.#frozen.get(ticket.projectId)===ticket);
  }

  matches(ticket,descriptorHash) {
    if (!ticket || ticket.descriptorHash!==descriptorHash) return false;
    const online=this.#online.get(ticket.projectId);
    return this.#frozen.get(ticket.projectId)===ticket ||
      Boolean(online && online.ticket===ticket &&
        online.confirmed.size===online.expected.size && Date.now()<=online.expiresAtUnixMs);
  }

  release(ticket) {
    if (!this.matches(ticket,ticket?.descriptorHash)) return false;
    if (this.#frozen.get(ticket.projectId)===ticket)
      this.#frozen.delete(ticket.projectId);
    else this.#online.delete(ticket.projectId);
    return true;
  }

  clear() {
    this.#frozen.clear();
    this.#online.clear();
    this.#pending.clear();
  }
}
