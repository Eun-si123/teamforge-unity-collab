// INTERNAL OFFLINE RECOVERY ONLY. The caller must own the stopped
// Coordinator's writable SQLite store and stop Host/Guest Editors/Seeds.
// No public command or realtime authority is exposed by this module.
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { readPublishedBaseline } from "../../project-peer/src/stored-publication.mjs";
import { readStoredMetadataJson,STORED_PROJECT_MAX_BYTES }
  from "../../project-peer/src/stored-metadata-reader.mjs";
import { writeJsonAtomic,writeJsonExclusive } from "../../project-peer/src/persistent-metadata.mjs";
import { HOST_RECOVERY_FENCE_NAME,withPublishedPointerLock }
  from "../../project-peer/src/published-pointer-lock.mjs";
import { fail } from "../../project-peer/src/errors.mjs";
import { inspectPendingProjectTransitions } from "./project-transition-recovery.mjs";

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const HASH=/^[a-f0-9]{64}$/u;
const fields=["projectId","projectUuid","transitionId","previousDescriptorHash","candidateDescriptorHash"];
const identityOf=record=>Object.fromEntries(fields.map(key=>[key,record[key]]));
const refused=()=>fail("host_transition_recovery_conflict",
  "The exact saved transition or approved Host pointer does not match recovery. Preserve both versions and inspect.");

function matchesPin(pointer,journal,side) {
  return pointer?.projectUuid===journal.projectUuid &&
    pointer.descriptorHash===journal[side+"DescriptorHash"] &&
    pointer.manifestHash===journal[side+"ManifestHash"] &&
    pointer.baselineRevision===journal[side+"BaselineRevision"];
}
function targetPointer(before,journal,recoveredAtUnixMs) {
  if(matchesPin(before,journal,"previous")) return before;
  return {schemaVersion:1,projectUuid:journal.projectUuid,
    baselineRevision:journal.previousBaselineRevision,
    manifestHash:journal.previousManifestHash,descriptorHash:journal.previousDescriptorHash,
    ownerKeyId:before.ownerKeyId,approvedAtUnixMs:recoveredAtUnixMs};
}
async function readFence(destination) {
  try {return await readStoredMetadataJson(destination,STORED_PROJECT_MAX_BYTES);}
  catch(error) {if(error.code==="ENOENT") return null; throw error;}
}

export async function rollbackOfflineHostTransition({store,managedRoot,request,signal}={}) {
  if (store?.readOnly!==false || typeof store.rollbackProjectTransitionCheckpoints!=="function" ||
      typeof managedRoot!=="string" || !path.isAbsolute(managedRoot) ||
      !request || typeof request.projectId!=="string" ||
      request.projectId.length<1 || request.projectId.length>128 ||
      !UUID.test(request.projectUuid??"") || !UUID.test(request.transitionId??"") ||
      !HASH.test(request.previousDescriptorHash??"") || !HASH.test(request.candidateDescriptorHash??""))
    refused();
  const identity=identityOf(request);
  const exactJournal=()=>{
    const journal=store.listProjectTransitionJournals().find(item=>item.projectId===identity.projectId);
    if(!journal || !isDeepStrictEqual(identityOf(journal),identity)) refused();
    return journal;
  };
  exactJournal(); // do not even create a lock in an unverified Project scope
  const metadataRoot=path.join(managedRoot,identity.projectUuid,"metadata");
  const fencePath=path.join(metadataRoot,HOST_RECOVERY_FENCE_NAME);
  const pointerPath=path.join(metadataRoot,"published.json");
  const readPointer=()=>readPublishedBaseline({managedRoot,projectUuid:identity.projectUuid});

  return await withPublishedPointerLock(metadataRoot,async ()=>{
    signal?.throwIfAborted();
    const journal=exactJournal();
    const before=await readPointer();
    if(!matchesPin(before,journal,"previous") && !matchesPin(before,journal,"candidate")) refused();
    // Both immutable signed sources and their chunks must still verify. This
    // intentionally refuses automatic Host rollback when either is damaged.
    const reports=await inspectPendingProjectTransitions({store,managedRoot,signal});
    const report=reports.find(item=>item.transitionId===identity.transitionId);
    if(!report || !["host_points_previous","host_points_candidate"].includes(report.state) ||
        !report.previousContentVerified || !report.candidateContentVerified ||
        !isDeepStrictEqual(exactJournal(),journal) ||
        !isDeepStrictEqual(await readPointer(),before)) refused();

    let fence=await readFence(fencePath);
    if(fence===null) {
      // Keep the original observed pointer. A replacement's timestamp is
      // the recorded recovery time, not a fabricated historic approval.
      const recoveredAtUnixMs=Date.now();
      fence={schemaVersion:1,kind:"host_baseline_rollback",...identity,
        recoveredAtUnixMs,before,target:targetPointer(before,journal,recoveredAtUnixMs)};
      // Durable write-ahead marker BEFORE touching any SQLite or Host pointer.
      await writeJsonExclusive(fencePath,fence);
    } else {
      if(fence.schemaVersion!==1 || fence.kind!=="host_baseline_rollback" ||
          !isDeepStrictEqual(identityOf(fence),identity) ||
          (!matchesPin(fence.before,journal,"previous") && !matchesPin(fence.before,journal,"candidate")) ||
          !Number.isSafeInteger(fence.recoveredAtUnixMs) || fence.recoveredAtUnixMs<1 ||
          !isDeepStrictEqual(fence.target,targetPointer(fence.before,journal,fence.recoveredAtUnixMs)) ||
          fence.before.ownerKeyId!==before.ownerKeyId ||
          (!isDeepStrictEqual(before,fence.before) && !isDeepStrictEqual(before,fence.target))) refused();
    }
    if(!isDeepStrictEqual(await readFence(fencePath),fence) ||
        !isDeepStrictEqual(await readPointer(),before) ||
        !isDeepStrictEqual(exactJournal(),journal)) refused();
    signal?.throwIfAborted();
    const restored=store.rollbackProjectTransitionCheckpoints(identity);
    if(restored.stage!=="sqlite_rolled_back") refused();
    // The durable marker and unresolved SQLite journal survive any failure
    // between these two stores. Never automatically remove either fence.
    if(!isDeepStrictEqual(await readFence(fencePath),fence) ||
        !isDeepStrictEqual(await readPointer(),before) ||
        exactJournal().stage!=="sqlite_rolled_back") refused();
    signal?.throwIfAborted();
    if(!isDeepStrictEqual(before,fence.target))
      await writeJsonAtomic(pointerPath,fence.target);
    if(!isDeepStrictEqual(await readPointer(),fence.target) ||
        !isDeepStrictEqual(await readFence(fencePath),fence) ||
        exactJournal().stage!=="sqlite_rolled_back") refused();
    return {status:"host_sqlite_rolled_back",transitionId:identity.transitionId,
      restoredDescriptorHash:identity.previousDescriptorHash,
      sessionCount:restored.sessionCount,sqliteReplayed:restored.replayed,
      hostPointerChanged:!isDeepStrictEqual(before,fence.target),
      guestReconciliationRequired:true,editorResumePermitted:false};
  });
}
