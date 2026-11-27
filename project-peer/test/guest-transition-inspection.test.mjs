import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdir,readFile,writeFile,rm,readdir,symlink} from "node:fs/promises";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {temporaryRoot,cleanup,createUnityProject} from "./helpers.mjs";
import {prepareGuestDestination} from "../src/guest-destination.mjs";
import {prepareGuestStateRoot} from "../src/guest-state.mjs";
import {writeGuestTrustPin} from "../src/guest-trust.mjs";
import {ProjectPeerEngine} from "../src/project-peer.mjs";
import {ManagedProjectStore} from "../src/managed-project.mjs";
import {ChunkStore} from "../src/content-store.mjs";
import {writeJsonContentAddressed} from "../src/persistent-metadata.mjs";
import {STORED_DESCRIPTOR_MAX_BYTES} from "../src/stored-metadata-reader.mjs";
import {buildManifest} from "../src/manifest.mjs";
import {PRODUCT_VERSION} from "../src/constants.mjs";
import {inspectGuestTransition} from "../src/guest-transition-inspection.mjs";
import {createGuestTransitionRecoveryCopy} from "../src/guest-transition-recovery-copy.mjs";

async function fixture(t){
  const root=await temporaryRoot("teamforge-guest-transition-");
  t.after(()=>cleanup(root));
  const managedRoot=path.join(root,"managed"),stateRoot=path.join(root,"state");
  const source=path.join(root,"source");
  await prepareGuestDestination({destinationRoot:managedRoot});
  const state=await prepareGuestStateRoot({stateRoot,destinationRoot:managedRoot});
  await createUnityProject(source,{dependencies:{"com.eunsung.teamforge":PRODUCT_VERSION}});
  const engine=new ProjectPeerEngine({managedRoot:path.join(root,"host-managed")});
  const previous=await engine.preparePublication({projectRoot:source,projectId:"transition-test",baselineRevision:1});
  const projectUuid=previous.project.projectUuid;
  await new ProjectPeerEngine({managedRoot}).ensureProject({projectId:"transition-test",projectUuid});
  const guestChunks=new ChunkStore(path.join(managedRoot,projectUuid,"metadata","chunks"));
  const managed=new ManagedProjectStore({managedRoot,projectUuid,chunkStore:guestChunks});
  const cache=async publication=>{
    await writeJsonContentAddressed(path.join(managed.metadataRoot,"manifests",
      publication.manifest.manifestHash+".json"),publication.manifest);
    await writeJsonContentAddressed(path.join(managed.metadataRoot,"descriptors",
      publication.descriptor.descriptorHash+".json"),publication.descriptor,STORED_DESCRIPTOR_MAX_BYTES);
    for(const file of publication.manifest.files)
      for(const chunk of file.chunks)
        await guestChunks.put(await publication.store.read(chunk.hash,chunk.size),chunk.hash);
  };
  const activate=async publication=>{
    await cache(publication);
    return managed.activate({...publication,trustApproval:async()=>true});
  };
  await activate(previous);
  await writeGuestTrustPin(state.guestRoot,{projectUuid,ownerKeyId:previous.descriptor.ownerKeyId,
    publisherKeyId:previous.descriptor.publisherKeyId});
  await writeFile(path.join(source,"Assets","Test.txt"),"candidate asset\n");
  const candidate=await engine.preparePublication({projectRoot:source,projectId:"transition-test",baselineRevision:2});
  const request={managedRoot,stateRoot,projectId:"transition-test",projectUuid,transitionId:randomUUID(),
    previousDescriptorHash:previous.descriptor.descriptorHash,candidateDescriptorHash:candidate.descriptor.descriptorHash};
  return {root,managed,previous,candidate,request,state,activate,cache};
}
const assertFenced=r=>{
  assert.equal(r.editorResumePermitted,false);
  assert.equal(r.automaticActivationPermitted,false);
  assert.equal(r.automaticRollbackPermitted,false);
  assert.equal(r.unsavedEditorStateVerified,false);
};

test("exact prior and candidate Active are independently inspected without modifying pointer, trust or chunks",async t=>{
  const f=await fixture(t);
  const pointer=await readFile(f.managed.currentPath);
  const chunks=await readdir(path.join(f.managed.metadataRoot,"chunks"));
  const trustPath=path.join(f.state.guestRoot,"trust",f.request.projectUuid+".json");
  const trust=await readFile(trustPath);
  const previous=await inspectGuestTransition(f.request);
  assert.equal(previous.status,"guest_saved_manifest_matches");
  assert.equal(previous.activeSide,"previous");
  assertFenced(previous);
  assert.deepEqual(await readFile(f.managed.currentPath),pointer);
  assert.deepEqual(await readFile(trustPath),trust);
  assert.deepEqual(await readdir(path.join(f.managed.metadataRoot,"chunks")),chunks);
  await f.activate(f.candidate);
  const candidate=await inspectGuestTransition(f.request);
  assert.equal(candidate.status,"guest_saved_manifest_matches");
  assert.equal(candidate.activeSide,"candidate");
  assertFenced(candidate);
});
test("changed, added and deleted saved assets require review and remain untouched",async t=>{
  const f=await fixture(t),active=await f.managed.validatedCurrent();
  const asset=path.join(active.activePath,"Assets","Test.txt");
  const pointer=await readFile(f.managed.currentPath);
  await writeFile(asset,"local work");
  let r=await inspectGuestTransition(f.request);
  assert.equal(r.status,"guest_saved_manifest_differs");assertFenced(r);
  assert.equal(await readFile(asset,"utf8"),"local work");
  await rm(asset);await writeFile(path.join(active.activePath,"Assets","New.txt"),"new work");
  r=await inspectGuestTransition(f.request);
  assert.equal(r.status,"guest_saved_manifest_differs");assertFenced(r);
  assert.deepEqual(await readFile(f.managed.currentPath),pointer);
});
test("wrong transition pin, missing trust and corrupt current metadata are never accepted",async t=>{
  const f=await fixture(t);
  let r=await inspectGuestTransition({...f.request,previousDescriptorHash:"a".repeat(64)});
  assert.equal(r.status,"guest_active_conflict");assertFenced(r);
  await rm(path.join(f.state.guestRoot,"trust",f.request.projectUuid+".json"));
  r=await inspectGuestTransition(f.request);
  assert.equal(r.status,"guest_trust_review_required");assertFenced(r);
  await writeFile(f.managed.currentPath,"{bad");
  r=await inspectGuestTransition(f.request);
  assert.equal(r.status,"guest_inspection_unavailable");assertFenced(r);
  assert.equal(await readFile(f.managed.currentPath,"utf8"),"{bad");
});
test("Active revision change during saved-source inspection invalidates the observation",async t=>{
  const f=await fixture(t);
  const r=await inspectGuestTransition(f.request,async options=>{
    const scanned=await buildManifest(options);
    await f.activate(f.candidate);
    return scanned;
  });
  assert.equal(r.status,"guest_observation_changed");assertFenced(r);
  assert.equal((await f.managed.validatedCurrent()).baselineRevision,2);
});
test("invalid inputs and cancelled inspection do not create a managed root",async t=>{
  const f=await fixture(t);
  const missing=path.join(f.root,"missing");
  await assert.rejects(inspectGuestTransition({...f.request,managedRoot:missing,transitionId:"invalid"}),TypeError);
  const controller=new AbortController();controller.abort();
  await assert.rejects(inspectGuestTransition({...f.request,managedRoot:missing,signal:controller.signal}));
  assert.ok(!(await readdir(f.root)).includes("missing"));
});
test("offline CLI produces only scoped observation, never local paths or resume permission",async t=>{
  const f=await fixture(t),q=f.request;
  const cli=fileURLToPath(new URL("../src/guest-transition-inspect-cli.mjs",import.meta.url));
  const result=spawnSync(process.execPath,[cli,q.managedRoot,q.stateRoot,q.projectId,q.projectUuid,
    q.transitionId,q.previousDescriptorHash,q.candidateDescriptorHash],{encoding:"utf8",timeout:15000});
  assert.equal(result.status,0,result.stderr);
  assert.ok(!result.stdout.includes(f.root));
  const report=JSON.parse(result.stdout);
  assert.equal(report.status,"guest_saved_manifest_matches");assertFenced(report);
});

test("trust change during inspection invalidates a matching saved-source observation",async t=>{
  const f=await fixture(t);
  const report=await inspectGuestTransition(f.request,async options=>{
    const scanned=await buildManifest(options);
    await writeGuestTrustPin(f.state.guestRoot,{projectUuid:f.request.projectUuid,
      ownerKeyId:f.previous.descriptor.ownerKeyId,publisherKeyId:"a".repeat(64)});
    return scanned;
  });
  assert.equal(report.status,"guest_observation_changed");assertFenced(report);
  const next=await inspectGuestTransition(f.request);
  assert.equal(next.status,"guest_trust_review_required");assertFenced(next);
});

test("a missing Guest and redirected metadata never create or overwrite local data",async t=>{
  const f=await fixture(t),missing=path.join(f.root,"missing");
  const absent=await inspectGuestTransition({...f.request,managedRoot:missing});
  assert.equal(absent.status,"guest_project_missing");assertFenced(absent);
  assert.ok(!(await readdir(f.root)).includes("missing"));
  const descriptorRoot=path.join(f.managed.metadataRoot,"descriptors");
  const target=path.join(f.root,"external");
  // Use a directory junction on Windows; no symlink privilege assumed.
  await rm(descriptorRoot,{recursive:true});
  await mkdir(target);
  await writeFile(path.join(target,"sentinel.txt"),"retain");
  await symlink(target,descriptorRoot,process.platform==="win32"?"junction":"dir");
  const report=await inspectGuestTransition(f.request);
  assert.equal(report.status,"guest_inspection_unavailable");assertFenced(report);
  assert.equal(await readFile(path.join(target,"sentinel.txt"),"utf8"),"retain");
});

test("scan work budget refuses incomplete results instead of reporting a match",async t=>{
  const f=await fixture(t);
  const report=await inspectGuestTransition(f.request,async options=>{
    // Synthetic sink input tests the budget without allocating or writing a
    // 256 MiB fixture. Actual saved-file scans are tested above.
    const chunk=Buffer.alloc(1024*1024);
    for(let i=0;i<257;i++) await options.store.put(chunk);
    throw new Error("budget should have stopped the scan");
  });
  assert.equal(report.status,"guest_scan_resource_limit");assertFenced(report);
});

test("explicit previous-baseline recovery creates a separate verified copy and preserves dirty current and retained files",async t=>{
  const f=await fixture(t);
  const old=await f.managed.validatedCurrent();
  await writeFile(path.join(old.activePath,"Assets","Test.txt"),"older local edit");
  await f.activate(f.candidate);
  const current=await f.managed.validatedCurrent(),pointer=await readFile(f.managed.currentPath);
  await writeFile(path.join(current.activePath,"Assets","Test.txt"),"current local edit");
  const trustPath=path.join(f.state.guestRoot,"trust",f.request.projectUuid+".json");
  const trust=await readFile(trustPath);
  const result=await createGuestTransitionRecoveryCopy({request:f.request,recoveryParent:f.root,
    targetSide:"previous",approve:async summary=>{
      assert.equal(summary.targetRevision,1);
      assert.equal(summary.originalSavedState,"guest_saved_manifest_differs");
      assert.equal(summary.copiesSignedBaselineOnly,true);
      return true;
    }});
  assert.equal(result.status,"guest_recovery_copy_created",JSON.stringify(result));
  assertFenced(result);
  assert.notEqual(result.activePath,old.activePath);
  assert.equal(await readFile(path.join(result.activePath,"Assets","Test.txt"),"utf8"),"hello teamforge\n");
  assert.equal(await readFile(path.join(old.activePath,"Assets","Test.txt"),"utf8"),"older local edit");
  assert.equal(await readFile(path.join(current.activePath,"Assets","Test.txt"),"utf8"),"current local edit");
  assert.deepEqual(await readFile(f.managed.currentPath),pointer);
  assert.deepEqual(await readFile(trustPath),trust);
  const copy=new ManagedProjectStore({managedRoot:result.recoveryRoot,projectUuid:f.request.projectUuid,
    chunkStore:new ChunkStore(path.join(result.recoveryRoot,f.request.projectUuid,"metadata","chunks"))});
  const verified=await copy.validatedCurrent();
  assert.equal(verified.descriptorHash,f.request.previousDescriptorHash);
  const intent=JSON.parse(await readFile(path.join(copy.metadataRoot,"recovery-copy-intent.json"),"utf8"));
  const complete=JSON.parse(await readFile(path.join(copy.metadataRoot,"recovery-copy-complete.json"),"utf8"));
  assert.equal(intent.transitionId,f.request.transitionId);
  assert.equal(intent.observedActiveDescriptorHash,f.request.candidateDescriptorHash);
  assert.equal(complete.verifiedManifestHash,verified.manifestHash);
  assert.equal(complete.editorResumePermitted,false);
  for(const file of verified.manifest.files)
    for(const chunk of file.chunks) await copy.chunkStore.read(chunk.hash,chunk.size);
});

test("candidate recovery from locally cached signed bytes uses a distinct new root on each approved copy",async t=>{
  const f=await fixture(t);
  await f.cache(f.candidate);
  const pointer=await readFile(f.managed.currentPath);
  const opts={request:f.request,recoveryParent:f.root,targetSide:"candidate",approve:async()=>true};
  const first=await createGuestTransitionRecoveryCopy(opts);
  const second=await createGuestTransitionRecoveryCopy(opts);
  assert.equal(first.status,"guest_recovery_copy_created",JSON.stringify(first));
  assert.equal(second.status,"guest_recovery_copy_created",JSON.stringify(second));
  assert.notEqual(first.recoveryRoot,second.recoveryRoot);
  assert.equal(await readFile(path.join(second.activePath,"Assets","Test.txt"),"utf8"),"candidate asset\n");
  assert.deepEqual(await readFile(f.managed.currentPath),pointer);
});

test("declined copy, missing target and overlapping destination leave original untouched",async t=>{
  const f=await fixture(t);
  const original=await readFile(f.managed.currentPath);
  const rootEntries=await readdir(f.root);
  const opts={request:f.request,recoveryParent:f.root,targetSide:"previous"};
  assert.equal((await createGuestTransitionRecoveryCopy({...opts,approve:async()=>false})).status,"guest_recovery_declined");
  await assert.rejects(createGuestTransitionRecoveryCopy({...opts,targetSide:"candidate",approve:async()=>assert.fail("no candidate yet")}));
  await assert.rejects(createGuestTransitionRecoveryCopy({...opts,recoveryParent:f.request.managedRoot,approve:async()=>assert.fail("overlap")}));
  assert.deepEqual(await readdir(f.root),rootEntries);
  assert.deepEqual(await readFile(f.managed.currentPath),original);
});

test("corrupt baseline chunk blocks recovery before approval",async t=>{
  const f=await fixture(t);
  const chunk=f.previous.manifest.files.find(file=>file.path==="Assets/Test.txt").chunks[0];
  await writeFile(f.managed.chunkStore.pathForHash(chunk.hash),Buffer.alloc(chunk.size));
  const rootEntries=await readdir(f.root);
  await assert.rejects(createGuestTransitionRecoveryCopy({request:f.request,recoveryParent:f.root,
    targetSide:"previous",approve:async()=>assert.fail("damaged bytes must not be approved")}));
  assert.deepEqual(await readdir(f.root),rootEntries);
});

test("Active changes during review refuse creating a new recovery copy",async t=>{
  const f=await fixture(t);
  const rootEntries=await readdir(f.root);
  await assert.rejects(createGuestTransitionRecoveryCopy({request:f.request,recoveryParent:f.root,
    targetSide:"previous",approve:async()=>{
      await f.activate(f.candidate);
      return true;
    }}));
  assert.deepEqual(await readdir(f.root),rootEntries);
  assert.equal((await f.managed.validatedCurrent()).baselineRevision,2);
});

test("source chunk loss after approval retains incomplete recovery copy without changing original",async t=>{
  const f=await fixture(t);
  const pointer=await readFile(f.managed.currentPath);
  const chunk=f.previous.manifest.files.find(file=>file.path==="Assets/Test.txt").chunks[0];
  const result=await createGuestTransitionRecoveryCopy({request:f.request,recoveryParent:f.root,
    targetSide:"previous",approve:async()=>{
      await rm(f.managed.chunkStore.pathForHash(chunk.hash));
      return true;
    }});
  assert.equal(result.status,"guest_recovery_copy_incomplete",JSON.stringify(result));
  assert.equal(result.editorResumePermitted,false);
  assert.ok((await readdir(f.root)).includes(path.basename(result.recoveryRoot)));
  const metadata=path.join(result.recoveryRoot,f.request.projectUuid,"metadata");
  const intent=JSON.parse(await readFile(path.join(metadata,"recovery-copy-intent.json"),"utf8"));
  assert.equal(intent.targetDescriptorHash,f.request.previousDescriptorHash);
  await assert.rejects(readFile(path.join(metadata,"recovery-copy-complete.json")),{code:"ENOENT"});
  assert.deepEqual(await readFile(f.managed.currentPath),pointer);
});

test("Publisher trust change or cancellation at approval never creates a copy",async t=>{
  const f=await fixture(t);
  const entries=await readdir(f.root),pointer=await readFile(f.managed.currentPath);
  const controller=new AbortController();
  const opts={request:f.request,recoveryParent:f.root,targetSide:"previous"};
  await assert.rejects(createGuestTransitionRecoveryCopy({...opts,signal:controller.signal,approve:async()=>{
    controller.abort();return true;
  }}));
  await assert.rejects(createGuestTransitionRecoveryCopy({...opts,approve:async()=>{
    await writeGuestTrustPin(f.state.guestRoot,{projectUuid:f.request.projectUuid,
      ownerKeyId:f.previous.descriptor.ownerKeyId,publisherKeyId:"a".repeat(64)});
    return true;
  }}));
  assert.deepEqual(await readdir(f.root),entries);
  assert.deepEqual(await readFile(f.managed.currentPath),pointer);
});
