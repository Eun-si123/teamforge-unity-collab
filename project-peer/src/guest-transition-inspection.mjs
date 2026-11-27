// Local offline evidence only; never authorizes a transition or changes Guest data.
// Reuse the normal managed-root, Active, trust and saved-source validators.
import path from "node:path";
import {isDeepStrictEqual} from "node:util";
import {SHA256_PATTERN,UUID_PATTERN} from "./constants.mjs";
import {ChunkStore} from "./content-store.mjs";
import {ManagedProjectStore} from "./managed-project.mjs";
import {inspectGuestDestination} from "./guest-destination.mjs";
import {inspectGuestStateRoot} from "./guest-state.mjs";
import {readGuestTrustPin,compareGuestTrustPin} from "./guest-trust.mjs";
import {assertNoRedirectedDirectorySegments} from "./filesystem-safety.mjs";
import {buildManifest} from "./manifest.mjs";

const MAX_BYTES=256*1024*1024, MAX_CHUNKS=65_536, MAX_FILES=32_768;
const uuid=value=>typeof value==="string" && UUID_PATTERN.test(value) && value===value.toLowerCase();
const hash=value=>typeof value==="string" && SHA256_PATTERN.test(value);
const id=value=>typeof value==="string" && value.length>0 && value.length<=128 &&
  value.trim()===value && value.isWellFormed() && !/[\u0000-\u001f\u007f]/u.test(value);
const validRoot=value=>typeof value==="string" && value.length<=4096 && path.isAbsolute(value);

// The caller chooses exact transition identity from the stopped Host's verified
// journal. This evidence is NOT a signed Guest acknowledgment, a participant
// roster, proof of Editor quiescence, or a recovery/activation command.
export async function inspectGuestTransition({managedRoot,stateRoot,projectId,projectUuid,
  transitionId,previousDescriptorHash,candidateDescriptorHash,signal}={},scanManifest=buildManifest) {
  if(!validRoot(managedRoot) || !validRoot(stateRoot) || !id(projectId) ||
      !uuid(projectUuid) || !uuid(transitionId) || !hash(previousDescriptorHash) ||
      !hash(candidateDescriptorHash) || previousDescriptorHash===candidateDescriptorHash)
    throw new TypeError("An exact transition and absolute Guest roots are required.");
  const report=(status,detail={})=>({schemaVersion:1,projectId,projectUuid,transitionId,
    previousDescriptorHash,candidateDescriptorHash,status,...detail,
    editorResumePermitted:false,automaticActivationPermitted:false,
    automaticRollbackPermitted:false,unsavedEditorStateVerified:false});
  const snapshot=async()=>{
    signal?.throwIfAborted();
    const destination=await inspectGuestDestination({destinationRoot:managedRoot});
    const project=destination.projects.find(item=>item.projectUuid===projectUuid);
    if(!project) return {status:"guest_project_missing"};
    if(project.projectId!==projectId) return {status:"guest_project_identity_conflict"};
    const state=await inspectGuestStateRoot({stateRoot,destinationRoot:destination.destination});
    const metadata=path.join(destination.destination,projectUuid,"metadata");
    for(const directory of [metadata,path.join(metadata,"descriptors"),path.join(metadata,"manifests")])
      await assertNoRedirectedDirectorySegments(directory);
    const managed=new ManagedProjectStore({managedRoot:destination.destination,projectUuid,
      chunkStore:new ChunkStore(path.join(metadata,"chunks"))});
    const current=await managed.validatedCurrent();
    if(!current) return {status:"guest_active_missing"};
    if(current.descriptor.projectId!==projectId) return {status:"guest_project_identity_conflict"};
    const trust=state.managed ? await readGuestTrustPin(state.guestRoot,projectUuid) : {state:"missing",pin:null};
    let trustState;
    try {trustState=compareGuestTrustPin(trust,current.descriptor);}
    catch {trustState="owner_conflict";}
    return {status:"observed",destination:destination.destination,rootMarker:destination.marker,
      stateMarker:state.marker??null,current,trust,trustState};
  };
  let before;
  try {before=await snapshot();}
  catch(error) {if(signal?.aborted) throw error;return report("guest_inspection_unavailable");}
  if(before.status!=="observed") return report(before.status);
  const {current,trustState}=before;
  const activeSide=current.descriptorHash===previousDescriptorHash ? "previous" :
    current.descriptorHash===candidateDescriptorHash ? "candidate" : "other";
  const details={activeSide,activeDescriptorHash:current.descriptorHash,
    activeBaselineRevision:current.baselineRevision,trustState};
  if(activeSide==="other") return report("guest_active_conflict",details);
  if(trustState!=="match") return report("guest_trust_review_required",details);
  if(current.manifest.totalBytes>MAX_BYTES || current.manifest.totalChunks>MAX_CHUNKS ||
      current.manifest.totalFiles>MAX_FILES) return report("guest_scan_resource_limit",details);
  // No chunks are written. Limit actual bytes/chunks hashed too, because the
  // writable saved tree may have grown after its signed baseline. Discovery
  // and Active tree validation retain their existing scanner limits; this is
  // an offline observation, not a hard CPU/memory deadline.
  let bytes=0,chunks=0,limit=false,scanned;
  try {
    ({manifest:scanned}=await scanManifest({projectRoot:current.activePath,projectUuid,
      baselineRevision:current.baselineRevision,chunkSize:current.manifest.chunkSize,
      store:{put(buffer){
        signal?.throwIfAborted();
        bytes+=buffer.length;chunks++;
        if(bytes>MAX_BYTES || chunks>MAX_CHUNKS){limit=true;throw new Error("Guest scan budget exceeded.");}
      }}}));
    if(scanned.totalFiles>MAX_FILES || scanned.totalBytes>MAX_BYTES ||
        scanned.totalChunks>MAX_CHUNKS) limit=true;
  } catch(error) {
    if(signal?.aborted) throw error;
    return report(limit?"guest_scan_resource_limit":"guest_saved_source_unavailable",details);
  }
  if(limit) return report("guest_scan_resource_limit",details);
  let after;
  try {after=await snapshot();}
  catch(error) {if(signal?.aborted) throw error;return report("guest_observation_changed");}
  signal?.throwIfAborted();
  if(!isDeepStrictEqual(before,after)) return report("guest_observation_changed");
  // Manifest equality includes paths, hashes and represented file attributes.
  // A difference (including platform executable bits) is conservative review,
  // not proof of an intentional user edit. Unity in-memory edits are unknown.
  return report(scanned.manifestHash===current.manifestHash ?
    "guest_saved_manifest_matches" : "guest_saved_manifest_differs",details);
}
