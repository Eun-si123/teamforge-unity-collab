// Builds a complete, write-INTENT-ONLY M4->M5 SQLite repin from the existing
// durable Session records. Never calls transitionProjectCheckpoints; caller
// must not run this against production until a cross-store crash protocol,
// exact live Publisher proof, Editor freeze and Host/Guest commit exist.
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { descriptorIsCompatible, verifyProjectDescriptor } from "./project-coordinator.mjs";

const reject = (code) => ({error:code,commitPermitted:false});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const signedFields=["projectUuid","baselineRevision","manifestHash","descriptorHash",
  "unityVersion","teamForgePackageVersion","realtimeProtocolVersion",
  "transferProtocolVersion","manifestSchemaVersion","ownerKeyId","ownerPublicKey",
  "publisherKeyId","publisherPublicKey","publisherAuthorization","baselineSignature"];
const sameSigned=(a,b)=>a&&b&&signedFields.every(key=>a[key]===b[key]);
const normalId=(value,max=128)=>typeof value==="string" && value.length>0 &&
  value.length<=max && value.trim()===value && value.isWellFormed() &&
  !/[\u0000-\u001f\u007f]/u.test(value);

// This helper operates on trusted, previously verified SQLite records; it is
// neither a remote API nor an authority token. The atomic SQLite writer must
// perform its own CAS/revalidation; a read-only plan can go stale immediately.
export function planSignedCheckpointTransition({
  store,projectId,previousDescriptor,candidateDescriptor,publication,
  nextEpoch = randomUUID,
}={}) {
  if (!normalId(projectId) || typeof store?.loadAll!=="function" ||
      typeof store?.listProjectTransitionJournals!=="function" ||
      typeof nextEpoch!=="function") return reject("project_transition_plan_invalid");
  const old=verifyProjectDescriptor(previousDescriptor ?? {},projectId);
  const candidate=verifyProjectDescriptor(candidateDescriptor ?? {},projectId);
  if (old.error || candidate.error || !descriptorIsCompatible(previousDescriptor) ||
      !descriptorIsCompatible(candidateDescriptor) ||
      (previousDescriptor.projectId!==undefined && previousDescriptor.projectId!==projectId) ||
      (candidateDescriptor.projectId!==undefined && candidateDescriptor.projectId!==projectId) ||
      old.descriptor.projectUuid!==candidate.descriptor.projectUuid ||
      candidate.descriptor.baselineRevision!==old.descriptor.baselineRevision+1 ||
      old.descriptor.ownerKeyId!==candidate.descriptor.ownerKeyId ||
      old.descriptor.ownerPublicKey!==candidate.descriptor.ownerPublicKey ||
      old.descriptor.descriptorHash===candidate.descriptor.descriptorHash)
    return reject("project_transition_plan_signed_source_invalid");
  if (!normalId(publication?.publishedByUserId) ||
      !normalId(publication?.publishedByConnectionId) ||
      !Number.isSafeInteger(publication?.publishedAtUnixMs) ||
      publication.publishedAtUnixMs<=0 || publication.publishedAtUnixMs>253402300799999)
    return reject("project_transition_plan_publication_invalid");
  let records;
  try {
    if (store.listProjectTransitionJournals().length)
      return reject("project_transition_recovery_required");
    records=store.loadAll();
  } catch { return reject("project_transition_plan_storage_unavailable"); }
  if (!Array.isArray(records)) return reject("project_transition_plan_storage_unavailable");
  const selected=records.filter(row=>row?.scope?.projectId===projectId);
  if (!selected.length || selected.length>128)
    return reject("project_transition_plan_session_set_invalid");
  const observed=new Set(),epochs=new Set(),nextEpochs=new Set();
  const liveEpochs=new Set(records.map(row=>row.epoch));
  let priorPublication=null;
  const sessions=[];
  for(const row of selected) {
    const {scope,checkpoint}=row;
    if(!normalId(scope?.sessionId,256) || observed.has(scope.sessionId) ||
        scope.projectUuid!==old.descriptor.projectUuid ||
        !UUID.test(row.epoch??"") || epochs.has(row.epoch) ||
        !Number.isSafeInteger(row.revision) || row.revision<0 ||
        !/^[a-f0-9]{64}$/u.test(row.checksum??"") ||
        checkpoint?.version!==1 || !UUID.test(checkpoint.lineageId??"") ||
        checkpoint.realtime?.revision!==row.revision ||
        checkpoint.project?.projectId!==undefined && checkpoint.project.projectId!==projectId ||
        !sameSigned(checkpoint.project,old.descriptor) ||
        !normalId(checkpoint.publication?.publishedByUserId) ||
        !normalId(checkpoint.publication?.publishedByConnectionId) ||
        !Number.isSafeInteger(checkpoint.publication?.publishedAtUnixMs) ||
        publication.publishedAtUnixMs<checkpoint.publication.publishedAtUnixMs ||
        (priorPublication!==null && !isDeepStrictEqual(priorPublication,checkpoint.publication)) ||
        (checkpoint.components!==null && checkpoint.components!==undefined &&
          (!checkpoint.components.source ||
            checkpoint.components.source.projectId!==projectId ||
            checkpoint.components.source.projectUuid!==old.descriptor.projectUuid ||
            checkpoint.components.source.baselineRevision!==old.descriptor.baselineRevision ||
            checkpoint.components.source.manifestHash!==old.descriptor.manifestHash ||
            checkpoint.components.source.descriptorHash!==old.descriptor.descriptorHash ||
            checkpoint.components.source.ownerKeyId!==old.descriptor.ownerKeyId)))
      return reject("project_transition_plan_checkpoint_conflict");
    observed.add(scope.sessionId);
    epochs.add(row.epoch);
    priorPublication=checkpoint.publication;
    let fresh;
    try {fresh=nextEpoch();} catch {return reject("project_transition_plan_epoch_invalid");}
    if (!UUID.test(fresh??"") || liveEpochs.has(fresh) || nextEpochs.has(fresh))
      return reject("project_transition_plan_epoch_invalid");
    nextEpochs.add(fresh);
    const next=structuredClone(checkpoint);
    next.project={...candidate.descriptor,projectId};
    delete next.project.userId;
    // Never persist arbitrary extra caller properties as publication metadata.
    next.publication={publishedByUserId:publication.publishedByUserId,
      publishedByConnectionId:publication.publishedByConnectionId,
      publishedAtUnixMs:publication.publishedAtUnixMs};
    if(next.components?.source) {
      next.components.source={...next.components.source,
        projectId,projectUuid:candidate.descriptor.projectUuid,
        baselineRevision:candidate.descriptor.baselineRevision,
        manifestHash:candidate.descriptor.manifestHash,
        descriptorHash:candidate.descriptor.descriptorHash,
        ownerKeyId:candidate.descriptor.ownerKeyId};
    }
    sessions.push({scope:{...scope},previousEpoch:row.epoch,nextEpoch:fresh,
      revision:row.revision,expectedChecksum:row.checksum,checkpoint:next});
  }
  if([...epochs].some(epoch=>nextEpochs.has(epoch)))
    return reject("project_transition_plan_epoch_invalid");
  sessions.sort((a,b)=>Buffer.compare(Buffer.from(a.scope.sessionId,"utf8"),
    Buffer.from(b.scope.sessionId,"utf8")));
  try {
    const after=store.loadAll().filter(row=>row?.scope?.projectId===projectId);
    if(store.listProjectTransitionJournals().length)
      return reject("project_transition_recovery_required");
    if(after.length!==selected.length || after.some((row,i)=>{
      const prior=selected.find(oldRow=>oldRow.scope.sessionId===row.scope.sessionId);
      return !prior || row.epoch!==prior.epoch || row.revision!==prior.revision ||
        row.checksum!==prior.checksum || !isDeepStrictEqual(row.checkpoint,prior.checkpoint);
    })) return reject("project_transition_plan_checkpoint_changed");
  } catch { return reject("project_transition_plan_storage_unavailable"); }
  return { status:"read_only_intent",commitPermitted:false,sessionCount:sessions.length,
    migrationInput:{projectId,projectUuid:old.descriptor.projectUuid,
      previousDescriptorHash:old.descriptor.descriptorHash,
      candidateDescriptorHash:candidate.descriptor.descriptorHash,sessions}};
}
