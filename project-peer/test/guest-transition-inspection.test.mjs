import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdir,readFile,writeFile,rm,readdir,symlink} from "node:fs/promises";
import path from "node:path";
import {spawn,spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {once} from "node:events";
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
import {rebindOfflineGuestTransition} from "../src/guest-transition-rebind.mjs";
import {withProcessBoundLock} from "../src/process-bound-lock.mjs";
import {openDurableSessionStore} from "../../server/src/durable-session-store.mjs";
import {rollbackOfflineHostTransition} from "../../server/src/project-transition-host-rollback.mjs";
import {inspectPendingProjectTransitions} from "../../server/src/project-transition-recovery.mjs";

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

const rebind=(f,targetSide="previous",approve=async()=>true,request=f.request)=>
  rebindOfflineGuestTransition({request,targetSide,approve});
const intentPath=f=>path.join(f.managed.metadataRoot,"guest-transition-"+f.request.transitionId+".json");
const readPointer=async f=>JSON.parse(await readFile(f.managed.currentPath,"utf8"));

test("offline rebind actually selects the retained previous baseline without changing either project tree",async t=>{
  const f=await fixture(t),old=await f.managed.validatedCurrent();
  await f.activate(f.candidate);
  const newest=await f.managed.validatedCurrent();
  const before=await readPointer(f);
  const trustPath=path.join(f.state.guestRoot,"trust",f.request.projectUuid+".json");
  const trust=await readFile(trustPath);
  const result=await rebind(f,"previous",async summary=>{
    assert.equal(summary.fromDescriptorHash,f.request.candidateDescriptorHash);
    assert.equal(summary.targetDescriptorHash,f.request.previousDescriptorHash);
    assert.equal(summary.retainedSavedTreesMatch,true);
    return true;
  });
  assert.equal(result.status,"guest_transition_rebound");
  assert.equal(result.pointerChanged,true);assertFenced(result);
  const after=await readPointer(f);
  assert.equal(after.descriptorHash,f.request.previousDescriptorHash);
  assert.equal((await f.managed.validatedCurrent()).activePath,old.activePath);
  assert.equal(await readFile(path.join(old.activePath,"Assets","Test.txt"),"utf8"),"hello teamforge\n");
  assert.equal(await readFile(path.join(newest.activePath,"Assets","Test.txt"),"utf8"),"candidate asset\n");
  assert.deepEqual(await readFile(trustPath),trust);
  const intent=JSON.parse(await readFile(intentPath(f),"utf8"));
  assert.deepEqual(intent.from,before);assert.deepEqual(intent.to,after);
  const repeated=await rebind(f);
  assert.equal(repeated.replayed,true);assert.equal(repeated.pointerChanged,false);
  assert.deepEqual(await readPointer(f),after);
  await assert.rejects(rebind(f,"candidate"),{code:"guest_transition_rebind_conflict"});
  // A distinct reviewed transition can rebind the other way; an old retry
  // cannot change the new selection.
  const fresh={...f.request,transitionId:randomUUID()};
  assert.equal((await rebind(f,"candidate",async()=>true,fresh)).pointerChanged,true);
  const newer=await readPointer(f);
  await assert.rejects(rebind(f),{code:"guest_transition_rebind_conflict"});
  assert.deepEqual(await readPointer(f),newer);
  await assert.rejects(f.managed.activate({...f.previous,trustApproval:async()=>true}),{code:"project_update_stale"});
});

test("declining rebind or targeting an unmaterialized baseline creates no intent",async t=>{
  const f=await fixture(t);
  await f.cache(f.candidate);
  const original=await readPointer(f);
  await assert.rejects(rebind(f,"candidate",async()=>assert.fail("missing target")));
  assert.deepEqual(await readPointer(f),original);
  await f.activate(f.candidate);
  const before=await readPointer(f);
  assert.equal((await rebind(f,"previous",async()=>false)).status,"guest_transition_rebind_declined");
  assert.deepEqual(await readPointer(f),before);
  await assert.rejects(readFile(intentPath(f)),{code:"ENOENT"});
});

test("dirty current or retained target prevents pointer changes and preserves edited bytes",async t=>{
  const f=await fixture(t),old=await f.managed.validatedCurrent();
  await f.activate(f.candidate);
  const current=await f.managed.validatedCurrent(),before=await readPointer(f);
  const oldFile=path.join(old.activePath,"Assets","Test.txt");
  const currentFile=path.join(current.activePath,"Assets","Test.txt");
  await writeFile(oldFile,"retained local changes");
  await assert.rejects(rebind(f,"previous",async()=>assert.fail("dirty target")),{code:"guest_transition_saved_work_review_required"});
  assert.equal(await readFile(oldFile,"utf8"),"retained local changes");
  await writeFile(oldFile,"hello teamforge\n");
  await writeFile(currentFile,"current local changes");
  await assert.rejects(rebind(f,"previous",async()=>assert.fail("dirty current")),{code:"guest_transition_saved_work_review_required"});
  assert.equal(await readFile(currentFile,"utf8"),"current local changes");
  assert.deepEqual(await readPointer(f),before);
  await assert.rejects(readFile(intentPath(f)),{code:"ENOENT"});
});

test("activation lock contention and approval-time trust changes refuse the rebind",async t=>{
  const f=await fixture(t);await f.activate(f.candidate);
  const before=await readPointer(f);
  await withProcessBoundLock(f.managed.activationLockPath,async()=>{
    await assert.rejects(rebind(f),{code:"activation_busy"});
  },{busyCode:"test_busy",busyMessage:"test"});
  await assert.rejects(rebind(f,"previous",async()=>{
    await writeGuestTrustPin(f.state.guestRoot,{projectUuid:f.request.projectUuid,
      ownerKeyId:f.previous.descriptor.ownerKeyId,publisherKeyId:"a".repeat(64)});
    return true;
  }));
  assert.deepEqual(await readPointer(f),before);
  await assert.rejects(readFile(intentPath(f)),{code:"ENOENT"});
});

test("persisted exact intent simulates interruption before pointer commit and is replayed without losing either tree",async t=>{
  const f=await fixture(t);
  const old=await readPointer(f);
  await f.activate(f.candidate);
  const current=await readPointer(f);
  const {projectId,projectUuid,transitionId,previousDescriptorHash,candidateDescriptorHash}=f.request;
  const intent={schemaVersion:1,kind:"guest_transition_rebind",projectId,projectUuid,transitionId,
    previousDescriptorHash,candidateDescriptorHash,targetSide:"previous",from:current,
    to:{...old,activatedAtUnixMs:Math.max(Date.now(),current.activatedAtUnixMs+1)}};
  await writeFile(intentPath(f),JSON.stringify(intent));
  const result=await rebind(f);
  assert.equal(result.pointerChanged,true);assert.deepEqual(await readPointer(f),intent.to);
  assert.deepEqual(JSON.parse(await readFile(intentPath(f),"utf8")),intent);
  assert.equal((await rebind(f)).replayed,true);
});

test("damaged intent and pointer changes during approval are rejected without overwriting the pointer",async t=>{
  const f=await fixture(t);await f.activate(f.candidate);
  const before=await readPointer(f);
  await writeFile(intentPath(f),"{broken");
  await assert.rejects(rebind(f));
  assert.equal(await readFile(intentPath(f),"utf8"),"{broken");
  await rm(intentPath(f));
  const changed={...before,activatedAtUnixMs:before.activatedAtUnixMs+1};
  await assert.rejects(rebind(f,"previous",async()=>{
    await writeFile(f.managed.currentPath,JSON.stringify(changed));return true;
  }),{code:"guest_transition_rebind_conflict"});
  assert.deepEqual(await readPointer(f),changed);
  await assert.rejects(readFile(intentPath(f)),{code:"ENOENT"});
});

test("SIGKILL around real current.json rename keeps durable intent and recovers exact offline rebind",async t=>{
  if(process.platform!=="linux") return t.skip("Linux process-death lock recovery; native Windows field check separate");
  for(const phase of ["before_rename","after_rename"]) await t.test(phase,async t=>{
    const f=await fixture(t);
    const old=await f.managed.validatedCurrent();
    await f.activate(f.candidate);
    const newer=await f.managed.validatedCurrent(),before=await readPointer(f);
    // The test child alone intercepts the real filesystem rename to pause
    // at the precise pointer commit boundary; no production fault hook.
    const source=`
      import fs from "node:fs";
      import {syncBuiltinESMExports} from "node:module";
      const [request,pointerPath,phase]=JSON.parse(process.argv[1]);
      const rename=fs.promises.rename;
      fs.promises.rename=async (...args)=>{
        if(args[1]!==pointerPath) return rename(...args);
        if(phase==="after_rename") await rename(...args);
        process.send({phase});
        await new Promise(()=>{});
      };
      syncBuiltinESMExports();
      const {rebindOfflineGuestTransition}=await import(${JSON.stringify(new URL("../src/guest-transition-rebind.mjs",import.meta.url).href)});
      await rebindOfflineGuestTransition({request,targetSide:"previous",approve:async()=>true});
      process.send({phase:"unexpected_return"});
    `;
    const child=spawn(process.execPath,["--input-type=module","-e",source,
      JSON.stringify([f.request,f.managed.currentPath,phase])],{stdio:["ignore","ignore","pipe","ipc"]});
    t.after(()=>{if(child.exitCode===null&&child.signalCode===null) child.kill("SIGKILL");});
    let stderr="";
    child.stderr.on("data",bytes=>{stderr+=bytes;});
    let timer;
    const observed=await Promise.race([
      new Promise((resolve,reject)=>{
        child.once("message",resolve);
        child.once("error",reject);
        child.once("exit",(code,signal)=>reject(new Error("Child exited before commit boundary: "+code+"/"+signal+" "+stderr)));
      }),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("Child did not reach "+phase+" "+stderr)),10_000);})
    ]).finally(()=>clearTimeout(timer));
    assert.deepEqual(observed,{phase});
    const exit=once(child,"exit");
    assert.equal(child.kill("SIGKILL"),true);
    assert.deepEqual(await exit,[null,"SIGKILL"]);
    const intent=JSON.parse(await readFile(intentPath(f),"utf8"));
    assert.deepEqual(intent.from,before);
    assert.deepEqual(await readPointer(f),phase==="before_rename"?intent.from:intent.to);
    const recovered=await rebind(f);
    assert.equal(recovered.status,"guest_transition_rebound");
    assert.equal(recovered.pointerChanged,phase==="before_rename");
    assert.equal(recovered.replayed,phase==="after_rename");
    assertFenced(recovered);
    assert.deepEqual(await readPointer(f),intent.to);
    assert.equal(await readFile(path.join(old.activePath,"Assets","Test.txt"),"utf8"),"hello teamforge\n");
    assert.equal(await readFile(path.join(newer.activePath,"Assets","Test.txt"),"utf8"),"candidate asset\n");
    assert.deepEqual(JSON.parse(await readFile(intentPath(f),"utf8")),intent);
  });
});

test("already selected and cancelled offline rebind do not create intent or alter current",async t=>{
  const f=await fixture(t);await f.activate(f.candidate);
  const pointer=await readPointer(f);
  const already=await rebind(f,"candidate");
  assert.equal(already.status,"guest_transition_already_selected");
  assert.equal(already.pointerChanged,false);assertFenced(already);
  const controller=new AbortController();
  await assert.rejects(rebindOfflineGuestTransition({request:f.request,targetSide:"previous",
    signal:controller.signal,approve:async()=>{controller.abort();return true;}}));
  assert.deepEqual(await readPointer(f),pointer);
  await assert.rejects(readFile(intentPath(f)),{code:"ENOENT"});
});

test("real offline Host, SQLite and Guest rollback select the same signed baseline without clearing recovery fences",async t=>{
  const f=await fixture(t);
  await f.activate(f.candidate);
  const prior=f.previous.descriptor,candidate=f.candidate.descriptor;
  const hostRoot=path.join(f.root,"host-managed");
  const published=path.join(hostRoot,f.request.projectUuid,"metadata","published.json");
  await writeFile(published,JSON.stringify({schemaVersion:1,projectUuid:prior.projectUuid,
    baselineRevision:candidate.baselineRevision,manifestHash:candidate.manifestHash,
    descriptorHash:candidate.descriptorHash,ownerKeyId:candidate.ownerKeyId,approvedAtUnixMs:Date.now()}));
  const sqlitePath=path.join(f.root,"session.sqlite");
  const store=openDurableSessionStore({filePath:sqlitePath});
  t.after(()=>store.close());
  const scope={projectId:prior.projectId,projectUuid:prior.projectUuid,sessionId:"offline-session"};
  const original={version:1,lineageId:randomUUID(),project:prior,
    publication:{publishedByUserId:"host",publishedByConnectionId:"connection",publishedAtUnixMs:1000},
    realtime:{revision:1,hierarchyObjects:[{id:"saved-work",name:"Retained collaboration"}]},components:null};
  const epoch=randomUUID();
  const saved=store.commit({scope,epoch,baseRevision:0,revision:1,checkpoint:original,operation:null});
  const next=structuredClone(original);
  next.project=candidate;next.publication.publishedAtUnixMs=2000;
  store.transitionProjectCheckpoints({projectId:scope.projectId,projectUuid:scope.projectUuid,
    previousDescriptorHash:prior.descriptorHash,candidateDescriptorHash:candidate.descriptorHash,
    sessions:[{scope,previousEpoch:epoch,nextEpoch:randomUUID(),revision:1,
      expectedChecksum:saved.checksum,checkpoint:next}]});
  const journal=store.listProjectTransitionJournals()[0];
  const request={...f.request,transitionId:journal.transitionId};
  const rolled=await rollbackOfflineHostTransition({store,managedRoot:hostRoot,request});
  assert.equal(rolled.status,"host_sqlite_rolled_back");
  assert.equal(rolled.guestReconciliationRequired,true);
  assert.deepEqual(store.load(scope).checkpoint,original);
  const active=await f.managed.validatedCurrent();
  const asset=path.join(active.activePath,"Assets","Test.txt");
  await writeFile(asset,"unpublished Guest work");
  await assert.rejects(rebind(f,"previous",async()=>assert.fail("dirty Guest must refuse"),request),
    {code:"guest_transition_saved_work_review_required"});
  assert.equal((await readPointer(f)).descriptorHash,candidate.descriptorHash);
  assert.equal(await readFile(asset,"utf8"),"unpublished Guest work");
  // Simulate the operator preserving and resolving the local edit; the
  // recovery function itself never clears or overwrites dirty files.
  await writeFile(path.join(f.root,"retained-local-edit.txt"),await readFile(asset));
  await writeFile(asset,"candidate asset\n");
  const rebound=await rebind(f,"previous",async()=>true,request);
  assert.equal(rebound.status,"guest_transition_rebound");assertFenced(rebound);
  assert.equal((await readPointer(f)).descriptorHash,prior.descriptorHash);
  assert.equal(JSON.parse(await readFile(published,"utf8")).descriptorHash,prior.descriptorHash);
  assert.equal(await readFile(path.join(f.root,"retained-local-edit.txt"),"utf8"),"unpublished Guest work");
  const report=(await inspectPendingProjectTransitions({store,managedRoot:hostRoot}))[0];
  assert.equal(report.state,"host_points_previous");
  assert.equal(report.sqliteStage,"sqlite_rolled_back");
  assert.equal(report.editorResumePermitted,false);
  assert.equal(store.listProjectTransitionJournals().length,1);
});

test("wall-clock rollback cannot recreate a prior pointer identity during retained-version rebind",async t=>{
  const f=await fixture(t);
  await f.activate(f.candidate);
  const original=await readPointer(f);
  assert.equal((await rebind(f)).pointerChanged,true);
  const previous=await readPointer(f);
  assert.ok(previous.activatedAtUnixMs>original.activatedAtUnixMs);
  const mock=t.mock.method(Date,"now",()=>original.activatedAtUnixMs);
  try{
    const fresh={...f.request,transitionId:randomUUID()};
    assert.equal((await rebind(f,"candidate",async()=>true,fresh)).pointerChanged,true);
  }finally{mock.mock.restore();}
  const newer=await readPointer(f);
  assert.ok(newer.activatedAtUnixMs>previous.activatedAtUnixMs);
  await assert.rejects(rebind(f),{code:"guest_transition_rebind_conflict"});
  assert.deepEqual(await readPointer(f),newer);
});
