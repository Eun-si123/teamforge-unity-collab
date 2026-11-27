// Internal offline Guest transition primitive. No production/wire caller.
// The trusted caller must stop Unity, Launcher and all competing writers and
// obtain the exact Host transition decision. Local approval is not a signed
// participant ACK or proof of a stopped Editor. No source directories removed.
import path from "node:path";
import {isDeepStrictEqual as equal} from "node:util";
import {SHA256_PATTERN,UUID_PATTERN} from "./constants.mjs";
import {inspectGuestDestination} from "./guest-destination.mjs";
import {inspectGuestStateRoot} from "./guest-state.mjs";
import {readGuestTrustPin,compareGuestTrustPin} from "./guest-trust.mjs";
import {assertNoRedirectedDirectorySegments} from "./filesystem-safety.mjs";
import {readStoredMetadataJson,STORED_DESCRIPTOR_MAX_BYTES,STORED_PROJECT_MAX_BYTES} from "./stored-metadata-reader.mjs";
import {validateDescriptor} from "./descriptor.mjs";
import {buildManifest} from "./manifest.mjs";
import {ChunkStore} from "./content-store.mjs";
import {ManagedProjectStore} from "./managed-project.mjs";
import {withProcessBoundLock} from "./process-bound-lock.mjs";
import {writeJsonAtomic,writeJsonExclusive,syncMetadataDirectory} from "./persistent-metadata.mjs";
import {fail} from "./errors.mjs";

const uuid=v=>typeof v==="string" && UUID_PATTERN.test(v) && v===v.toLowerCase();
const hash=v=>typeof v==="string" && SHA256_PATTERN.test(v);
const id=v=>typeof v==="string" && v.length>0 && v.length<=128 && v.trim()===v &&
  v.isWellFormed() && !/[\u0000-\u001f\u007f]/u.test(v);
const root=v=>typeof v==="string" && v.length<=4096 && path.isAbsolute(v);
const refuse=()=>fail("guest_transition_rebind_conflict","Exact retained Guest versions or recovery intent differ. Preserve both versions and review.");
const pin=(descriptor,time)=>({schemaVersion:1,projectUuid:descriptor.projectUuid,
  baselineRevision:descriptor.baselineRevision,manifestHash:descriptor.manifestHash,
  descriptorHash:descriptor.descriptorHash,publisherKeyId:descriptor.publisherKeyId,
  activeRelativePath:"active/"+descriptor.baselineRevision+"-"+descriptor.manifestHash.slice(0,12),
  activatedAtUnixMs:time});
const activePin=active=>pin(active.descriptor,active.activatedAtUnixMs);
const validTime=v=>Number.isSafeInteger(v)&&v>0;
const budget={bytes:256*1024*1024,chunks:65_536,files:32_768};

async function assertSavedMatches(active,signal){
  const {manifest,descriptor}=active;
  if(manifest.totalFiles>budget.files || manifest.totalBytes>budget.bytes ||
      manifest.totalChunks>budget.chunks) refuse();
  let bytes=0,chunks=0;
  const scanned=await buildManifest({projectRoot:active.activePath,
    projectUuid:descriptor.projectUuid,baselineRevision:descriptor.baselineRevision,
    chunkSize:manifest.chunkSize,store:{put(buffer){
      signal?.throwIfAborted();
      bytes+=buffer.length;chunks++;
      if(bytes>budget.bytes || chunks>budget.chunks) refuse();
    }}});
  signal?.throwIfAborted();
  if(scanned.manifest.totalFiles>budget.files || scanned.manifestHash!==descriptor.manifestHash)
    fail("guest_transition_saved_work_review_required",
      "Saved files differ from their signed baseline. Preserve local work and use separate-copy review.");
}

export async function rebindOfflineGuestTransition({request,targetSide,approve,signal}={}){
  if(!request || !root(request.managedRoot) || !root(request.stateRoot) ||
      !id(request.projectId) || !uuid(request.projectUuid) || !uuid(request.transitionId) ||
      !hash(request.previousDescriptorHash) || !hash(request.candidateDescriptorHash) ||
      request.previousDescriptorHash===request.candidateDescriptorHash ||
      !["previous","candidate"].includes(targetSide) || typeof approve!=="function") refuse();
  request=Object.freeze({...request});
  const identity={schemaVersion:1,kind:"guest_transition_rebind",projectId:request.projectId,
    projectUuid:request.projectUuid,transitionId:request.transitionId,
    previousDescriptorHash:request.previousDescriptorHash,candidateDescriptorHash:request.candidateDescriptorHash,
    targetSide};
  const targetHash=targetSide==="previous"?request.previousDescriptorHash:request.candidateDescriptorHash;
  const otherHash=targetSide==="previous"?request.candidateDescriptorHash:request.previousDescriptorHash;
  const result=(status,detail={})=>({status,transitionId:request.transitionId,targetDescriptorHash:targetHash,
    ...detail,editorResumePermitted:false,automaticActivationPermitted:false,
    automaticRollbackPermitted:false,unsavedEditorStateVerified:false});
  const snapshot=async()=>{
    signal?.throwIfAborted();
    const destination=await inspectGuestDestination({destinationRoot:request.managedRoot});
    if(!destination.projects.some(p=>p.projectUuid===request.projectUuid&&p.projectId===request.projectId)) refuse();
    const state=await inspectGuestStateRoot({stateRoot:request.stateRoot,destinationRoot:destination.destination});
    if(!state.managed) refuse();
    const metadata=path.join(destination.destination,request.projectUuid,"metadata");
    for(const name of [metadata,path.join(metadata,"descriptors"),path.join(metadata,"manifests")])
      await assertNoRedirectedDirectorySegments(name);
    const store=new ManagedProjectStore({managedRoot:destination.destination,projectUuid:request.projectUuid,
      chunkStore:new ChunkStore(path.join(metadata,"chunks"))});
    const current=await store.validatedCurrent();
    if(!current || current.descriptor.projectId!==request.projectId ||
        ![targetHash,otherHash].includes(current.descriptorHash)) refuse();
    const currentPointer=activePin(current);
    // Preserve exact pointer equality, including activation time; never
    // manufacture a replacement for a stale request or a different pointer.
    if(!equal(await readStoredMetadataJson(store.currentPath,STORED_PROJECT_MAX_BYTES),currentPointer)) refuse();
    const readDescriptor=async descriptorHash=>{
      const descriptor=validateDescriptor(await readStoredMetadataJson(
        path.join(metadata,"descriptors",descriptorHash+".json"),STORED_DESCRIPTOR_MAX_BYTES),
        {expectedProjectId:request.projectId,expectedProjectUuid:request.projectUuid,
          trustedOwnerKeyId:current.descriptor.ownerKeyId});
      if(descriptor.descriptorHash!==descriptorHash || descriptor.projectUuid!==request.projectUuid) refuse();
      return descriptor;
    };
    const previous=await readDescriptor(request.previousDescriptorHash);
    const candidate=await readDescriptor(request.candidateDescriptorHash);
    if(candidate.baselineRevision!==previous.baselineRevision+1 ||
        previous.ownerPublicKey!==candidate.ownerPublicKey) refuse();
    const trust=await readGuestTrustPin(state.guestRoot,request.projectUuid);
    if(compareGuestTrustPin(trust,previous)!=="match" || compareGuestTrustPin(trust,candidate)!=="match") refuse();
    const target=targetSide==="previous"?previous:candidate;
    const other=targetSide==="previous"?candidate:previous;
    const intentPath=path.join(metadata,"guest-transition-"+request.transitionId+".json");
    let intent=null;
    try {intent=await readStoredMetadataJson(intentPath,STORED_PROJECT_MAX_BYTES);}
    catch(error){if(error.code!=="ENOENT") throw error;}
    if(intent!==null){
      if(!validTime(intent?.from?.activatedAtUnixMs)||!validTime(intent?.to?.activatedAtUnixMs)||
          intent.to.activatedAtUnixMs<=intent.from.activatedAtUnixMs||
          !equal(intent,{...identity,from:pin(other,intent.from.activatedAtUnixMs),
            to:pin(target,intent.to.activatedAtUnixMs)}) ||
          (!equal(currentPointer,intent.from)&&!equal(currentPointer,intent.to))) refuse();
    }
    // Normal validatedCurrent checks the Unity descriptor and package. Reuse
    // those exact checks for the retained directory, then verify saved bytes.
    for(const descriptor of [previous,candidate]){
      const active=await store.validateRetainedActive(pin(descriptor,1));
      await assertSavedMatches(active,signal);
    }
    if(!equal(await readStoredMetadataJson(store.currentPath,STORED_PROJECT_MAX_BYTES),currentPointer) ||
        !equal(await readGuestTrustPin(state.guestRoot,request.projectUuid),trust)) refuse();
    return {metadata,store,intentPath,intent,currentPointer,target,other,trust,
      rootMarker:destination.marker,stateMarker:state.marker};
  };
  const before=await snapshot();
  const comparable=({store,...rest})=>rest;
  const approval=Object.freeze({...identity,fromDescriptorHash:before.currentPointer.descriptorHash,
    targetDescriptorHash:targetHash,targetRevision:before.target.baselineRevision,
    retainedSavedTreesMatch:true,editorResumePermitted:false});
  if(await approve(approval)!==true) return result("guest_transition_rebind_declined");
  signal?.throwIfAborted();
  return await withProcessBoundLock(before.store.activationLockPath,async()=>{
    const locked=await snapshot();
    if(!equal(comparable(before),comparable(locked))) refuse();
    let intent=locked.intent;
    if(!intent && locked.currentPointer.descriptorHash===targetHash)
      return result("guest_transition_already_selected",{pointerChanged:false});
    if(!intent){
      // A wall-clock rollback must not recreate an earlier pointer identity
      // and let a stale transition retry match it again.
      const nextTime=Math.max(Date.now(),locked.currentPointer.activatedAtUnixMs+1);
      if(!validTime(nextTime)) refuse();
      intent={...identity,from:locked.currentPointer,to:pin(locked.target,nextTime)};
      // Durable write-ahead intent is retained, including after success.
      // No implicit reversal: a later conflicting pointer needs fresh review.
      await writeJsonExclusive(locked.intentPath,intent);
    }
    if(!equal(await readStoredMetadataJson(locked.intentPath,STORED_PROJECT_MAX_BYTES),intent) ||
        !equal(await readStoredMetadataJson(locked.store.currentPath,STORED_PROJECT_MAX_BYTES),locked.currentPointer)) refuse();
    signal?.throwIfAborted();
    const pointerChanged=!equal(locked.currentPointer,intent.to);
    if(pointerChanged) await writeJsonAtomic(locked.store.currentPath,intent.to);
    else {
      // An interrupted writer may have renamed current.json but died before
      // its directory sync. Re-establish the existing platform durability
      // boundary on exact replay; never rewrite the pointer to do so.
      await syncMetadataDirectory(locked.metadata);
    }
    // If write/flush/verification fails, the durable intent remains. Caller
    // must inspect the exact pointer and retry, not assume rollback.
    if(!equal(await readStoredMetadataJson(locked.store.currentPath,STORED_PROJECT_MAX_BYTES),intent.to)) refuse();
    const verified=await locked.store.validatedCurrent();
    if(!verified || !equal(activePin(verified),intent.to)) refuse();
    return result("guest_transition_rebound",{pointerChanged,replayed:!pointerChanged,
      selectedBaselineRevision:verified.baselineRevision});
  },{busyCode:"activation_busy",busyMessage:"Another Project activation is already in progress."});
}
