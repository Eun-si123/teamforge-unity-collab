// Explicit Guest-side participant provisioning. Private key remains in
// per-user Launcher state, never the shared Project or bridge output.
// Enrollment still requires independent Host approval of the public key.
import path from "node:path";
import {lstat,mkdir} from "node:fs/promises";
import {isDeepStrictEqual as equal} from "node:util";
import {inspectGuestDestination} from "./guest-destination.mjs";
import {inspectGuestStateRoot} from "./guest-state.mjs";
import {readGuestTrustPin,compareGuestTrustPin} from "./guest-trust.mjs";
import {ManagedProjectStore} from "./managed-project.mjs";
import {ChunkStore} from "./content-store.mjs";
import {generateIdentity,loadIdentity,saveIdentity} from "./identity.mjs";
import {assertNoRedirectedDirectorySegments} from "./filesystem-safety.mjs";
import {withProcessBoundLock} from "./process-bound-lock.mjs";
import {fail} from "./errors.mjs";

const uuid=v=>typeof v==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(v);
const hash=v=>typeof v==="string"&&/^[a-f0-9]{64}$/u.test(v);
const refuse=()=>fail("guest_participant_identity_unavailable","A verified local Project and matching Guest trust are required. Existing identity files are not replaced.");
export async function prepareGuestParticipantIdentity({managedRoot,stateRoot,projectUuid,baselineRevision,manifestHash,forbiddenRoots=[]}={}){
  if(!uuid(projectUuid)||!Number.isSafeInteger(baselineRevision)||baselineRevision<1||!hash(manifestHash)) refuse();
  const inspect=async()=>{
    const destination=await inspectGuestDestination({destinationRoot:managedRoot,forbiddenRoots});
    if(!destination.projects.some(p=>p.projectUuid===projectUuid)) refuse();
    const state=await inspectGuestStateRoot({stateRoot,destinationRoot:destination.destination,forbiddenRoots});
    if(!state.managed) refuse();
    const metadata=path.join(destination.destination,projectUuid,"metadata");
    await assertNoRedirectedDirectorySegments(metadata);
    const store=new ManagedProjectStore({managedRoot:destination.destination,projectUuid,
      chunkStore:new ChunkStore(path.join(metadata,"chunks"))});
    const current=await store.validatedCurrent();
    if(!current||current.baselineRevision!==baselineRevision||current.manifestHash!==manifestHash) refuse();
    const trust=await readGuestTrustPin(state.guestRoot,projectUuid);
    if(compareGuestTrustPin(trust,current.descriptor)!=="match") refuse();
    return {guestRoot:state.guestRoot,rootMarker:state.marker,descriptor:current.descriptor,trust:trust.pin};
  };
  const before=await inspect();
  const directory=path.join(before.guestRoot,"participants");
  await assertNoRedirectedDirectorySegments(directory);
  await mkdir(directory,{recursive:true,mode:0o700});
  await assertNoRedirectedDirectorySegments(directory);
  const file=path.join(directory,projectUuid+"-"+before.descriptor.ownerKeyId+".json");
  return withProcessBoundLock(file+".lock",async()=>{
    if(!equal(await inspect(),before)) refuse();
    let present;
    try{present=await lstat(file);}
    catch(error){if(error.code!=="ENOENT") throw error;}
    if(!present) await saveIdentity(file,generateIdentity("TeamForge Guest participant"));
    const stat=await lstat(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||
       (process.platform!=="win32"&&(stat.mode&0o077)!==0)) refuse();
    const identity=await loadIdentity(file);
    if(identity.label!=="TeamForge Guest participant"||
       [before.descriptor.ownerKeyId,before.descriptor.publisherKeyId].includes(identity.keyId)||
       !equal(await inspect(),before)) refuse();
    return {schemaVersion:1,projectUuid,ownerKeyId:before.descriptor.ownerKeyId,
      participantId:identity.keyId,keyId:identity.keyId,publicKey:identity.publicKey,
      hostApprovalRequired:true};
  },{busyCode:"guest_participant_identity_busy",busyMessage:"Another local participant identity operation is active."});
}
