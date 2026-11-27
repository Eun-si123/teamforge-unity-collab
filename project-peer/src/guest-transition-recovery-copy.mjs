// Offline separate-copy recovery only. No original Active or trust write,
// no launch, no cross-store commit or Editor resume authorization.
import path from "node:path";
import {mkdtemp,lstat} from "node:fs/promises";
import {isDeepStrictEqual} from "node:util";
import {inspectGuestTransition} from "./guest-transition-inspection.mjs";
import {inspectGuestDestination,prepareGuestDestination} from "./guest-destination.mjs";
import {inspectGuestStateRoot} from "./guest-state.mjs";
import {readGuestTrustPin,compareGuestTrustPin} from "./guest-trust.mjs";
import {assertNoRedirectedDirectorySegments,assertOrdinaryLocalPathSyntax,canonicalizeThroughExistingDirectory} from "./filesystem-safety.mjs";
import {readStoredMetadataJson,STORED_DESCRIPTOR_MAX_BYTES,STORED_MANIFEST_MAX_BYTES} from "./stored-metadata-reader.mjs";
import {validateDescriptor} from "./descriptor.mjs";
import {validateManifest,uniqueManifestChunks} from "./manifest.mjs";
import {auditSignedCandidateContents} from "./signed-candidate-content-audit.mjs";
import {ChunkStore} from "./content-store.mjs";
import {ManagedProjectStore} from "./managed-project.mjs";
import {ProjectPeerEngine} from "./project-peer.mjs";
import {writeJsonContentAddressed,writeJsonExclusive} from "./persistent-metadata.mjs";
import {fail} from "./errors.mjs";

const allowed=new Set(["guest_saved_manifest_matches","guest_saved_manifest_differs"]);
const inside=(parent,child)=>{
  const relative=path.relative(parent,child);
  return relative==="" || (!path.isAbsolute(relative) && relative!==".." && !relative.startsWith(".."+path.sep));
};
const refused=()=>fail("guest_recovery_review_required","Exact offline Guest recovery requires verified signed content and explicit review.");

// Trusted local caller must stop Editors/Launcher/writers, choose the exact
// transition pins from the Host journal, and review the copy summary. The
// new copy is the signed BASELINE, not a backup of dirty or unsaved edits.
export async function createGuestTransitionRecoveryCopy({request,recoveryParent,targetSide,approve,signal}={}){
  if(!request || !["previous","candidate"].includes(targetSide) ||
      typeof recoveryParent!=="string" || !path.isAbsolute(recoveryParent) ||
      typeof approve!=="function") refused();
  request=Object.freeze({...request});
  const input={...request,signal};
  const targetHash=targetSide==="previous"?request.previousDescriptorHash:request.candidateDescriptorHash;
  const observe=async()=>{
    const report=await inspectGuestTransition(input);
    if(!allowed.has(report.status)) refused();
    const destination=await inspectGuestDestination({destinationRoot:request.managedRoot});
    const state=await inspectGuestStateRoot({stateRoot:request.stateRoot,destinationRoot:destination.destination});
    const metadata=path.join(destination.destination,request.projectUuid,"metadata");
    await assertNoRedirectedDirectorySegments(path.join(metadata,"chunks"));
    const chunks=new ChunkStore(path.join(metadata,"chunks"));
    const current=await new ManagedProjectStore({managedRoot:destination.destination,
      projectUuid:request.projectUuid,chunkStore:chunks}).validatedCurrent();
    if(!current || current.descriptorHash!==report.activeDescriptorHash) refused();
    const descriptor=validateDescriptor(await readStoredMetadataJson(
      path.join(metadata,"descriptors",targetHash+".json"),STORED_DESCRIPTOR_MAX_BYTES),
      {expectedProjectId:request.projectId,expectedProjectUuid:request.projectUuid,
        trustedOwnerKeyId:current.descriptor.ownerKeyId});
    if(descriptor.descriptorHash!==targetHash ||
        (report.activeSide!==targetSide &&
          descriptor.baselineRevision!==current.baselineRevision+(targetSide==="candidate"?1:-1))) refused();
    const trust=await readGuestTrustPin(state.guestRoot,request.projectUuid);
    if(compareGuestTrustPin(trust,current.descriptor)!=="match" ||
        compareGuestTrustPin(trust,descriptor)!=="match") refused();
    const manifest=await readStoredMetadataJson(
      path.join(metadata,"manifests",descriptor.manifestHash+".json"),STORED_MANIFEST_MAX_BYTES);
    validateManifest(manifest,{expectedProjectUuid:request.projectUuid,expectedManifestHash:descriptor.manifestHash});
    if(manifest.manifestHash!==descriptor.manifestHash || manifest.baselineRevision!==descriptor.baselineRevision) refused();
    return {report,destination:destination.destination,stateRoot:state.launcherRoot,
      rootMarker:destination.marker,stateMarker:state.marker,current,trust,descriptor,manifest,chunks};
  };
  const before=await observe();
  assertOrdinaryLocalPathSyntax(recoveryParent);
  await assertNoRedirectedDirectorySegments(recoveryParent);
  const parent=await canonicalizeThroughExistingDirectory(recoveryParent);
  const info=await lstat(parent,{bigint:true});
  if(!info.isDirectory() || info.isSymbolicLink() ||
      inside(before.destination,parent) || inside(before.stateRoot,parent)) refused();
  const audit=await auditSignedCandidateContents({manifest:before.manifest,store:before.chunks},{signal});
  if(audit.status!=="verified") refused();
  const summary=Object.freeze({transitionId:request.transitionId,projectUuid:request.projectUuid,
    targetSide,targetDescriptorHash:targetHash,targetRevision:before.descriptor.baselineRevision,
    totalFiles:before.manifest.totalFiles,totalBytes:before.manifest.totalBytes,
    originalSavedState:before.report.status,originalPreserved:true,unsavedEditorStateVerified:false,
    copiesSignedBaselineOnly:true,editorResumePermitted:false});
  if(await approve(summary)!==true) return {status:"guest_recovery_declined",editorResumePermitted:false};
  signal?.throwIfAborted();
  const after=await observe();
  const comparable=({chunks,...rest})=>rest;
  if(!isDeepStrictEqual(comparable(before),comparable(after))) refused();
  await assertNoRedirectedDirectorySegments(parent);
  const latest=await lstat(parent,{bigint:true});
  if(!latest.isDirectory() || latest.isSymbolicLink() || latest.dev!==info.dev || latest.ino!==info.ino) refused();
  signal?.throwIfAborted();
  // Unique root, never replace an existing recovery folder. Leave partial
  // copies for inspection if materialization fails. No normal Guest trust
  // pin is installed for the separate root.
  const recoveryRoot=await mkdtemp(path.join(parent,"teamforge-recovery-"));
  try{
    await prepareGuestDestination({destinationRoot:recoveryRoot,
      forbiddenRoots:[before.destination,before.stateRoot]});
    await new ProjectPeerEngine({managedRoot:recoveryRoot}).ensureProject({
      projectId:request.projectId,projectUuid:request.projectUuid});
    const metadata=path.join(recoveryRoot,request.projectUuid,"metadata");
    const intent={schemaVersion:1,kind:"guest_transition_recovery_copy",...summary,
      previousDescriptorHash:request.previousDescriptorHash,
      candidateDescriptorHash:request.candidateDescriptorHash,
      observedActiveDescriptorHash:after.current.descriptorHash};
    await writeJsonExclusive(path.join(metadata,"recovery-copy-intent.json"),intent);
    const store=new ChunkStore(path.join(metadata,"chunks"));
    for(const chunk of uniqueManifestChunks(after.manifest)){
      signal?.throwIfAborted();
      await store.put(await after.chunks.read(chunk.hash,chunk.size),chunk.hash);
    }
    await writeJsonContentAddressed(path.join(metadata,"descriptors",targetHash+".json"),
      after.descriptor,STORED_DESCRIPTOR_MAX_BYTES);
    await writeJsonContentAddressed(path.join(metadata,"manifests",after.manifest.manifestHash+".json"),after.manifest);
    const managed=new ManagedProjectStore({managedRoot:recoveryRoot,projectUuid:request.projectUuid,chunkStore:store});
    const activated=await managed.activate({descriptor:after.descriptor,manifest:after.manifest,
      expectedCurrent:null,signal,trustApproval:async()=>true});
    const current=await managed.validatedCurrent();
    if(activated.state!=="Complete" || current?.descriptorHash!==targetHash) refused();
    // Independent persisted records distinguish a completed copy from an
    // interrupted attempt. They do not prove Host approval or a Guest ACK.
    await writeJsonExclusive(path.join(metadata,"recovery-copy-complete.json"),{
      ...intent,status:"guest_recovery_copy_created",completedAtUnixMs:Date.now(),
      verifiedManifestHash:current.manifestHash});
    return {status:"guest_recovery_copy_created",recoveryRoot,activePath:current.activePath,
      ...summary,automaticActivationPermitted:false,automaticRollbackPermitted:false};
  }catch(error){
    // Preserve partial artifacts; return local recovery location without
    // pretending that a failed copy is complete. A pointer may already have
    // committed in the separate copy; inspect it before retrying. Never touch original data.
    return {status:"guest_recovery_copy_incomplete",recoveryRoot,
      code:typeof error?.code==="string"?error.code:"recovery_copy_failed",
      originalPreserved:true,editorResumePermitted:false};
  }
}
