import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
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
import {generateIdentity} from "../src/identity.mjs";
import {signGuestReconciliationReceipt,verifyGuestReconciliationReceipts,
  createGuestReconciliationChallenge} from "../src/guest-transition-proof.mjs";
import {signOfflineFinalization} from "../../server/src/project-transition-guest-evidence.mjs";
import {DurableSessionRuntime} from "../../server/src/durable-session-runtime.mjs";
import {createSessionState,captureRealtimeCheckpoint,createSessionAuthority,makeSessionKey} from "../../server/src/session-authority.mjs";
import {configFromEnv} from "../../server/src/config.mjs";
import {beginOfflineGuestReconciliation} from "../../server/src/project-transition-guest-reconciliation.mjs";
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

async function reconciliationFixture(t,{captureRoster=true}={}){
  const f=await fixture(t);
  await f.activate(f.candidate);
  const prior=f.previous.descriptor,candidate=f.candidate.descriptor;
  const hostRoot=path.join(f.root,"host-managed");
  const published=path.join(hostRoot,f.request.projectUuid,"metadata","published.json");
  const hostPointer={schemaVersion:1,projectUuid:prior.projectUuid,
    baselineRevision:candidate.baselineRevision,manifestHash:candidate.manifestHash,
    descriptorHash:candidate.descriptorHash,ownerKeyId:candidate.ownerKeyId,approvedAtUnixMs:Date.now()};
  await writeFile(published,JSON.stringify(hostPointer));
  const sqlitePath=path.join(f.root,"reconciliation.sqlite");
  const store=openDurableSessionStore({filePath:sqlitePath});
  t.after(()=>store.close());
  const scope={projectId:prior.projectId,projectUuid:prior.projectUuid,sessionId:"reconciliation-session"};
  const session=createSessionState();session.revision=1;
  const original={version:1,lineageId:randomUUID(),project:prior,
    publication:{publishedByUserId:"host",publishedByConnectionId:"connection",publishedAtUnixMs:1000},
    realtime:captureRealtimeCheckpoint(session),components:null};
  const epoch=randomUUID();
  const saved=store.commit({scope,epoch,baseRevision:0,revision:1,checkpoint:original,operation:null});
  const next=structuredClone(original);
  next.project=candidate;next.publication.publishedAtUnixMs=2000;
  const a=generateIdentity("Guest A"),b=generateIdentity("Guest B");
  const participants=[{participantId:"guest-a",keyId:a.keyId,publicKey:a.publicKey},
    {participantId:"guest-b",keyId:b.keyId,publicKey:b.publicKey}];
  const migration={projectId:scope.projectId,projectUuid:scope.projectUuid,
    previousDescriptorHash:prior.descriptorHash,candidateDescriptorHash:candidate.descriptorHash,
    sessions:[{scope,previousEpoch:epoch,nextEpoch:randomUUID(),revision:1,expectedChecksum:saved.checksum,checkpoint:next}]};
  store.transitionProjectCheckpoints({...migration,...(captureRoster?{guestParticipants:participants}:{})});
  const journal=store.listProjectTransitionJournals()[0];
  const request={...f.request,transitionId:journal.transitionId};
  const managedRoot=path.join(f.root,"guest-two"),stateRoot=path.join(f.root,"guest-two-state");
  await prepareGuestDestination({destinationRoot:managedRoot});
  const state=await prepareGuestStateRoot({stateRoot,destinationRoot:managedRoot});
  await new ProjectPeerEngine({managedRoot}).ensureProject({projectId:prior.projectId,projectUuid:prior.projectUuid});
  const metadata=path.join(managedRoot,prior.projectUuid,"metadata");
  const chunks=new ChunkStore(path.join(metadata,"chunks"));
  const guestTwo=new ManagedProjectStore({managedRoot,projectUuid:prior.projectUuid,chunkStore:chunks});
  for(const pub of [f.previous,f.candidate]){
    await writeJsonContentAddressed(path.join(metadata,"manifests",pub.manifest.manifestHash+".json"),pub.manifest);
    await writeJsonContentAddressed(path.join(metadata,"descriptors",pub.descriptor.descriptorHash+".json"),pub.descriptor,STORED_DESCRIPTOR_MAX_BYTES);
    for(const file of pub.manifest.files)for(const chunk of file.chunks)
      await chunks.put(await pub.store.read(chunk.hash,chunk.size),chunk.hash);
    await guestTwo.activate({...pub,trustApproval:async()=>true});
  }
  await writeGuestTrustPin(state.guestRoot,{projectUuid:prior.projectUuid,
    ownerKeyId:prior.ownerKeyId,publisherKeyId:prior.publisherKeyId});
  const options={store,managedRoot:hostRoot,request,participants,ownerIdentity:f.previous.ownerIdentity};
  const receipt=(round,which="a")=>signGuestReconciliationReceipt({challenge:round.challenge,
    request:which==="a"?request:{...request,managedRoot,stateRoot},
    participantId:which==="a"?"guest-a":"guest-b",identity:which==="a"?a:b});
  return {f,store,request,options,receipt,a,b,guestTwo,published,hostPointer,original,scope,sqlitePath,migration,guestTwoRequest:{...request,managedRoot,stateRoot}};
}

test("two independent Guest roots sign actual selected Active observations; all enrolled receipts do not resolve the journal",async t=>{
  const f=await reconciliationFixture(t);
  const round=await beginOfflineGuestReconciliation(f.options);
  const a=await f.receipt(round),b=await f.receipt(round,"b");
  const pending=await round.inspectReceipts([a]);
  assert.equal(pending.status,"guest_receipts_pending");
  assert.deepEqual(pending.missingParticipants,["guest-b"]);
  assert.equal(pending.editorResumePermitted,false);
  const complete=await round.inspectReceipts([b,a]);
  assert.equal(complete.status,"all_enrolled_guests_reported");
  assert.equal(complete.confirmedCount,2);
  assert.equal(complete.expectedCount,2);
  assert.equal(complete.rosterCompletenessVerified,false);
  assert.equal(complete.journalResolutionPermitted,false);
  assert.equal(complete.unsavedEditorStateVerified,false);
  assert.equal(complete.editorResumePermitted,false);
  assert.equal(f.store.listProjectTransitionJournals().length,1);
  assert.equal(f.store.listProjectTransitionJournals()[0].stage,"sqlite_committed");
  assert.equal(f.store.load(f.scope).checkpoint.project.descriptorHash,f.request.candidateDescriptorHash);
  assert.equal(JSON.parse(await readFile(f.published,"utf8")).descriptorHash,f.request.candidateDescriptorHash);
  // Transport retries of the exact bundle in the same fresh round are read-only.
  assert.deepEqual(await round.inspectReceipts([a,b]),complete);
});

test("roster duplication, owner key reuse, missing roster, and wrong signing owner refuse a reconciliation round",async t=>{
  const f=await reconciliationFixture(t),opts=f.options;
  for(const participants of [[],[opts.participants[0],opts.participants[0]],
    [opts.participants[0],{...opts.participants[0],participantId:"different"}],
    [{participantId:"owner",keyId:opts.ownerIdentity.keyId,publicKey:opts.ownerIdentity.publicKey}]]){
    await assert.rejects(beginOfflineGuestReconciliation({...opts,participants}));
  }
  await assert.rejects(beginOfflineGuestReconciliation({...opts,ownerIdentity:generateIdentity()}));
});

test("receipt forgery, duplication, alternate roster, wrong identity and cross-round replay are refused",async t=>{
  const f=await reconciliationFixture(t),round=await beginOfflineGuestReconciliation(f.options);
  const a=await f.receipt(round),b=await f.receipt(round,"b");
  for(const receipts of [[a,a],[a,{...b,signature:a.signature}],
    [{...a,participantId:"guest-b"}],[{...a,activeDescriptorHash:f.request.previousDescriptorHash}],
    [{...a,savedManifestMatches:false}],[{...a,keyId:f.b.keyId}]]){
    await assert.rejects(round.inspectReceipts(receipts));
  }
  const next=await beginOfflineGuestReconciliation(f.options);
  await assert.rejects(next.inspectReceipts([a,b]));
  const forged=structuredClone(round.challenge);
  forged.body.participants.pop();
  await assert.rejects(f.receipt({challenge:forged}));
  await assert.rejects(signGuestReconciliationReceipt({challenge:round.challenge,request:f.request,
    participantId:"guest-a",identity:f.b}));
  // Even an Owner-signed alternate roster is not the one that this round issued.
  const alt=createGuestReconciliationChallenge({context:round.challenge.body,
    participants:[f.options.participants[0]],ownerIdentity:f.options.ownerIdentity});
  await assert.rejects(round.inspectReceipts([await f.receipt({challenge:alt})]));
});

test("dirty or wrong-version Guest refuses to sign; expired or not-yet-issued challenge refuses verification",async t=>{
  const f=await reconciliationFixture(t),round=await beginOfflineGuestReconciliation(f.options);
  const a=await f.receipt(round);
  const active=await f.f.managed.validatedCurrent();
  const file=path.join(active.activePath,"Assets","Test.txt");
  await writeFile(file,"local edit");
  await assert.rejects(f.receipt(round));
  assert.equal(await readFile(file,"utf8"),"local edit");
  await writeFile(file,"candidate asset\n");
  await rebind(f.f,"previous",async()=>true,f.request);
  await assert.rejects(f.receipt(round));
  const {issuedAtUnixMs,expiresAtUnixMs,ownerKeyId}=round.challenge.body;
  for(const nowUnixMs of [issuedAtUnixMs-1,expiresAtUnixMs+1]){
    assert.throws(()=>verifyGuestReconciliationReceipts({challenge:round.challenge,
      trustedOwnerKeyId:ownerKeyId,receipts:[a],nowUnixMs}));
  }
});

test("a Host pointer change or real SQLite rollback invalidates the entire previously issued round",async t=>{
  const f=await reconciliationFixture(t);
  const round=await beginOfflineGuestReconciliation(f.options);
  const a=await f.receipt(round),b=await f.receipt(round,"b");
  await writeFile(f.published,JSON.stringify({...f.hostPointer,approvedAtUnixMs:f.hostPointer.approvedAtUnixMs+1}));
  await assert.rejects(round.inspectReceipts([a,b]),{code:"guest_reconciliation_host_conflict"});
  await writeFile(f.published,JSON.stringify(f.hostPointer));
  await assert.rejects(round.inspectReceipts([a,b]),{code:"guest_reconciliation_host_conflict"});
  const beforeRollback=await beginOfflineGuestReconciliation(f.options);
  const beforeReceipt=await f.receipt(beforeRollback);
  const result=await rollbackOfflineHostTransition({store:f.store,managedRoot:f.options.managedRoot,request:f.request});
  assert.equal(result.status,"host_sqlite_rolled_back");
  await assert.rejects(round.inspectReceipts([a,b]),{code:"guest_reconciliation_host_conflict"});
  await assert.rejects(beforeRollback.inspectReceipts([beforeReceipt]),{code:"guest_reconciliation_host_conflict"});
  const recovery=await beginOfflineGuestReconciliation(f.options);
  assert.equal(recovery.challenge.body.targetDescriptorHash,f.request.previousDescriptorHash);
  assert.equal(recovery.challenge.body.sqliteStage,"sqlite_rolled_back");
  await assert.rejects(f.receipt(recovery));
  await rebind(f.f,"previous",async()=>true,f.request);
  const restored=await f.receipt(recovery);
  assert.equal((await recovery.inspectReceipts([restored])).confirmedCount,1);
  assert.equal(f.store.listProjectTransitionJournals().length,1);
});

test("an expired or explicitly revoked reconciliation round cannot be resurrected by clock rollback",async t=>{
  const f=await reconciliationFixture(t);
  const round=await beginOfflineGuestReconciliation(f.options),a=await f.receipt(round);
  const mock=t.mock.method(Date,"now",()=>round.challenge.body.expiresAtUnixMs+1);
  try {await assert.rejects(round.inspectReceipts([a]),{code:"guest_reconciliation_host_conflict"});}
  finally {mock.mock.restore();}
  await assert.rejects(round.inspectReceipts([a]),{code:"guest_reconciliation_host_conflict"});
  const fresh=await beginOfflineGuestReconciliation(f.options),b=await f.receipt(fresh);
  fresh.revoke();
  await assert.rejects(fresh.inspectReceipts([b]),{code:"guest_reconciliation_host_conflict"});
});

test("captured roster cannot be shrunk or replaced; complete signed evidence survives SQLite reopen and idempotent retry",async t=>{
  const f=await reconciliationFixture(t);
  const initial=f.store.listProjectTransitionJournals()[0];
  assert.deepEqual(initial.guestRoster.participants,f.options.participants);
  assert.equal(initial.guestReconciliationEvidence,undefined);
  await assert.rejects(beginOfflineGuestReconciliation({...f.options,participants:[f.options.participants[0]]}));
  const round=await beginOfflineGuestReconciliation({...f.options,participants:undefined});
  const a=await f.receipt(round),b=await f.receipt(round,"b");
  assert.equal((await round.recordReceipts([a])).status,"guest_receipts_pending");
  assert.deepEqual(f.store.listProjectTransitionJournals()[0],initial);
  const result=await round.recordReceipts([b,a]);
  assert.equal(result.status,"guest_evidence_recorded");
  assert.equal(result.replayed,false);
  assert.equal(result.editorResumePermitted,false);
  assert.equal(result.journalResolutionPermitted,false);
  const repeated=await round.recordReceipts([a,b]);
  assert.equal(repeated.replayed,true);
  const journal=f.store.listProjectTransitionJournals()[0];
  const bundle=journal.guestReconciliationEvidence.sqlite_committed;
  assert.deepEqual(bundle.challenge,round.challenge);
  assert.deepEqual(bundle.receipts,[a,b]);
  assert.equal((await round.inspectReceipts([a,b])).status,"all_enrolled_guests_reported");
  f.store.close();
  const reopened=openDurableSessionStore({filePath:f.sqlitePath});
  t.after(()=>reopened.close());
  assert.deepEqual(reopened.listProjectTransitionJournals()[0],journal);
  assert.equal(reopened.load(f.scope).checkpoint.project.descriptorHash,f.request.candidateDescriptorHash);
  assert.equal(reopened.recordGuestReconciliationEvidence({projectId:f.request.projectId,
    transitionId:f.request.transitionId,stage:"sqlite_committed",expectedJournalHash:round.challenge.body.journalHash,
    evidence:bundle}).replayed,true);
  // Never convert the historical proof into permission to rotate/accept edits.
  assert.throws(()=>reopened.rotateRecoveredEpochs({sessions:[{scope:f.scope,previousEpoch:journal.sessions[0].nextEpoch,
    nextEpoch:randomUUID(),revision:journal.sessions[0].revision,expectedChecksum:journal.sessions[0].nextChecksum}]}),{code:"TRANSITION_RECOVERY_REQUIRED"});
});

test("legacy journal without captured roster may inspect but cannot persist claimed completion",async t=>{
  const f=await reconciliationFixture(t,{captureRoster:false});
  const round=await beginOfflineGuestReconciliation(f.options);
  const a=await f.receipt(round),b=await f.receipt(round,"b");
  assert.equal((await round.inspectReceipts([a,b])).status,"all_enrolled_guests_reported");
  await assert.rejects(round.recordReceipts([a,b]),{code:"guest_reconciliation_host_conflict"});
  assert.equal(f.store.listProjectTransitionJournals()[0].guestRoster,undefined);
  assert.equal(f.store.listProjectTransitionJournals()[0].guestReconciliationEvidence,undefined);
});

test("invalid signatures, incomplete bundles, wrong journal hash and wrong stage cannot mutate SQLite evidence",async t=>{
  const f=await reconciliationFixture(t),round=await beginOfflineGuestReconciliation(f.options);
  const a=await f.receipt(round),b=await f.receipt(round,"b");
  const before=f.store.listProjectTransitionJournals();
  const valid={projectId:f.request.projectId,transitionId:f.request.transitionId,
    stage:"sqlite_committed",expectedJournalHash:round.challenge.body.journalHash,
    evidence:{verifiedAtUnixMs:Date.now(),challenge:round.challenge,receipts:[a,b]}};
  for(const input of [{...valid,stage:"sqlite_rolled_back"},
    {...valid,expectedJournalHash:"f".repeat(64)},
    {...valid,evidence:{...valid.evidence,receipts:[a]}},
    {...valid,evidence:{...valid.evidence,receipts:[a,{...b,signature:a.signature}]}},
    {...valid,evidence:{...valid.evidence,verifiedAtUnixMs:round.challenge.body.expiresAtUnixMs+1}}]){
    assert.throws(()=>f.store.recordGuestReconciliationEvidence(input));
    assert.deepEqual(f.store.listProjectTransitionJournals(),before);
  }
});

test("rollback retains historical candidate evidence and requires a fresh full previous-version bundle",async t=>{
  const f=await reconciliationFixture(t),round=await beginOfflineGuestReconciliation(f.options);
  const a=await f.receipt(round),b=await f.receipt(round,"b");
  await round.recordReceipts([a,b]);
  const oldBundle=f.store.listProjectTransitionJournals()[0].guestReconciliationEvidence.sqlite_committed;
  await rollbackOfflineHostTransition({store:f.store,managedRoot:f.options.managedRoot,request:f.request});
  const rolled=f.store.listProjectTransitionJournals()[0];
  assert.equal(rolled.stage,"sqlite_rolled_back");
  assert.deepEqual(rolled.guestReconciliationEvidence.sqlite_committed,oldBundle);
  assert.equal(rolled.guestReconciliationEvidence.sqlite_rolled_back,undefined);
  await assert.rejects(round.recordReceipts([a,b]));
  const recovery=await beginOfflineGuestReconciliation({...f.options,participants:undefined});
  await rebind(f.f,"previous",async()=>true,f.request);
  await rebindOfflineGuestTransition({request:f.guestTwoRequest,targetSide:"previous",approve:async()=>true});
  const ra=await f.receipt(recovery),rb=await f.receipt(recovery,"b");
  await assert.rejects(recovery.recordReceipts([a,b]));
  assert.equal((await recovery.recordReceipts([ra])).status,"guest_receipts_pending");
  assert.equal((await recovery.recordReceipts([ra,rb])).status,"guest_evidence_recorded");
  const final=f.store.listProjectTransitionJournals()[0];
  assert.deepEqual(final.guestReconciliationEvidence.sqlite_committed,oldBundle);
  assert.equal(final.guestReconciliationEvidence.sqlite_rolled_back.challenge.body.targetDescriptorHash,f.request.previousDescriptorHash);
  assert.deepEqual(f.store.load(f.scope).checkpoint,f.original);
  f.store.close();
  const reopened=openDurableSessionStore({filePath:f.sqlitePath});
  t.after(()=>reopened.close());
  assert.deepEqual(reopened.listProjectTransitionJournals()[0],final);
});

test("roster validation fails atomically before any checkpoint repin or journal is persisted",async t=>{
  const f=await reconciliationFixture(t,{captureRoster:false});
  const db=openDurableSessionStore({filePath:path.join(f.f.root,"roster-invalid.sqlite")});
  t.after(()=>db.close());
  const old=f.original;
  const epoch=randomUUID();
  const saved=db.commit({scope:f.scope,epoch,baseRevision:0,revision:1,checkpoint:old,operation:null});
  const migration={...f.migration,sessions:[{...f.migration.sessions[0],previousEpoch:epoch,
    nextEpoch:randomUUID(),expectedChecksum:saved.checksum}]};
  const expected=db.load(f.scope);
  for(const guestParticipants of [[],[f.options.participants[0],f.options.participants[0]],
    [{participantId:"owner",keyId:f.options.ownerIdentity.keyId,publicKey:f.options.ownerIdentity.publicKey}]]){
    assert.throws(()=>db.transitionProjectCheckpoints({...migration,guestParticipants}),{code:"INVALID_INPUT"});
    assert.deepEqual(db.load(f.scope),expected);
    assert.deepEqual(db.listProjectTransitionJournals(),[]);
  }
  db.transitionProjectCheckpoints({...migration,guestParticipants:f.options.participants});
  assert.deepEqual(db.listProjectTransitionJournals()[0].guestRoster.participants,f.options.participants);
});

test("SQLite evidence commit survives actual process death before and after COMMIT without opening the edit fence",async t=>{
  if(process.platform!=="linux") return t.skip("Linux SIGKILL test; Windows native test separate");
  for(const phase of ["before_commit","after_commit"]) await t.test(phase,async t=>{
    const f=await reconciliationFixture(t),round=await beginOfflineGuestReconciliation(f.options);
    const a=await f.receipt(round),b=await f.receipt(round,"b");
    const before=f.store.listProjectTransitionJournals()[0];
    const input={projectId:f.request.projectId,transitionId:f.request.transitionId,
      stage:"sqlite_committed",expectedJournalHash:round.challenge.body.journalHash,
      evidence:{verifiedAtUnixMs:Date.now(),challenge:round.challenge,receipts:[a,b]}};
    f.store.close();
    const source=`
      import {DatabaseSync} from "node:sqlite";
      import {writeSync} from "node:fs";
      const {openDurableSessionStore}=await import(${JSON.stringify(new URL("../../server/src/durable-session-store.mjs",import.meta.url).href)});
      const [filePath,phase,input]=JSON.parse(process.argv[1]);
      const store=openDurableSessionStore({filePath});
      const original=DatabaseSync.prototype.exec;
      DatabaseSync.prototype.exec=function(sql){
        if(sql!=="COMMIT;") return original.call(this,sql);
        if(phase==="after_commit") original.call(this,sql);
        writeSync(1,"commit-boundary:"+phase);
        process.kill(process.pid,"SIGKILL");
      };
      store.recordGuestReconciliationEvidence(input);
      process.exit(3);
    `;
    const killed=spawnSync(process.execPath,["--input-type=module","-e",source,
      JSON.stringify([f.sqlitePath,phase,input])],{encoding:"utf8",timeout:15000});
    assert.equal(killed.signal,"SIGKILL",killed.stderr);
    assert.equal(killed.stdout.trim(),"commit-boundary:"+phase);
    const reopened=openDurableSessionStore({filePath:f.sqlitePath});
    t.after(()=>reopened.close());
    const journal=reopened.listProjectTransitionJournals()[0];
    if(phase==="before_commit") assert.deepEqual(journal,before);
    else assert.deepEqual(journal.guestReconciliationEvidence.sqlite_committed,input.evidence);
    const recovered=reopened.recordGuestReconciliationEvidence(input);
    assert.equal(recovered.replayed,phase==="after_commit");
    assert.equal(recovered.editorResumePermitted,false);
    assert.equal(reopened.listProjectTransitionJournals().length,1);
    assert.equal(reopened.load(f.scope).checkpoint.project.descriptorHash,f.request.candidateDescriptorHash);
  });
});

test("expired evidence cannot be newly recorded with a backdated timestamp; a committed bundle stays historical",async t=>{
  const f=await reconciliationFixture(t),round=await beginOfflineGuestReconciliation(f.options);
  const a=await f.receipt(round),b=await f.receipt(round,"b");
  const input={projectId:f.request.projectId,transitionId:f.request.transitionId,
    stage:"sqlite_committed",expectedJournalHash:round.challenge.body.journalHash,
    evidence:{verifiedAtUnixMs:Date.now(),challenge:round.challenge,receipts:[a,b]}};
  let clock=t.mock.method(Date,"now",()=>round.challenge.body.expiresAtUnixMs+1);
  try{
    assert.throws(()=>f.store.recordGuestReconciliationEvidence(input),{code:"TRANSITION_CONFLICT"});
    assert.equal(f.store.listProjectTransitionJournals()[0].guestReconciliationEvidence,undefined);
  }finally{clock.mock.restore();}
  assert.equal(f.store.recordGuestReconciliationEvidence(input).replayed,false);
  clock=t.mock.method(Date,"now",()=>round.challenge.body.expiresAtUnixMs+1);
  try{
    const old=f.store.recordGuestReconciliationEvidence(input);
    assert.equal(old.replayed,true);
    assert.equal(old.editorResumePermitted,false);
  }finally{clock.mock.restore();}
});

test("reopening rejects altered Guest signature even when the ordinary journal checksum was recomputed",async t=>{
  const f=await reconciliationFixture(t),round=await beginOfflineGuestReconciliation(f.options);
  const a=await f.receipt(round),b=await f.receipt(round,"b");
  await round.recordReceipts([a,b]);
  f.store.close();
  const db=new DatabaseSync(f.sqlitePath);
  const row=db.prepare("SELECT project_id,project_uuid,journal_json FROM project_transition_journal").get();
  const journal=JSON.parse(row.journal_json);
  journal.guestReconciliationEvidence.sqlite_committed.receipts[0].signature=b.signature;
  const json=JSON.stringify(journal);
  const checksum=createHash("sha256").update("teamforge-durable-transition-journal-v1\n")
    .update(JSON.stringify({projectId:row.project_id,projectUuid:row.project_uuid})).update("\n").update(json).digest("hex");
  db.prepare("UPDATE project_transition_journal SET journal_json=?,checksum=?").run(json,checksum);
  db.close();
  assert.throws(()=>openDurableSessionStore({filePath:f.sqlitePath}),{code:"INTEGRITY_ERROR"});
  const read=new DatabaseSync(f.sqlitePath,{readOnly:true});
  assert.equal(read.prepare("SELECT journal_json FROM project_transition_journal").get().journal_json,json);
  read.close();
});

test("offline candidate finalization archives exact generations, removes pending fence atomically and restores Coordinator only on the selected Host version",async t=>{
  const f=await reconciliationFixture(t),round=await beginOfflineGuestReconciliation(f.options);
  const a=await f.receipt(round),b=await f.receipt(round,"b");
  const before=f.store.listProjectTransitionJournals()[0];
  const selected=f.store.load(f.scope);
  const prior=f.store.readProjectTransitionBackup({projectId:f.scope.projectId,sessionId:f.scope.sessionId});
  assert.equal((await round.finalizeCandidate([a],{approve:async()=>assert.fail("missing Guest")})).status,"guest_receipts_pending");
  assert.equal((await round.finalizeCandidate([a,b],{approve:async()=>false})).status,"offline_finalization_declined");
  assert.deepEqual(f.store.listProjectTransitionJournals()[0],before);
  const result=await round.finalizeCandidate([a,b],{approve:async summary=>{
    assert.deepEqual(summary.participantIds,["guest-a","guest-b"]);
    assert.equal(summary.requiresCompleteRosterAttestation,true);
    assert.equal(summary.requiresAllWritersStoppedAttestation,true);
    return true;
  }});
  assert.equal(result.status,"offline_transition_finalized");
  assert.equal(result.editorResumePermitted,false);
  assert.deepEqual(f.store.listProjectTransitionJournals(),[]);
  assert.equal(f.store.listFinalizedProjectTransitions().length,1);
  const archive=f.store.readFinalizedProjectTransition(f.request.transitionId);
  assert.deepEqual(archive.journal,before);
  assert.deepEqual(f.store.load(f.scope),selected);
  assert.equal(f.store.finalizeProjectTransition({projectId:f.request.projectId,
    transitionId:f.request.transitionId,finalization:archive.finalization}).replayed,true);
  f.store.close();
  const db=new DatabaseSync(f.sqlitePath,{readOnly:true});
  const rows=db.prepare("SELECT role,checkpoint_json,checksum FROM finalized_transition_checkpoints ORDER BY role").all();
  db.close();
  assert.equal(rows.length,2);
  assert.equal(rows[0].role,"previous");assert.deepEqual(JSON.parse(rows[0].checkpoint_json),prior.checkpoint);
  assert.equal(rows[0].checksum,prior.checksum);
  assert.equal(rows[1].role,"selected");assert.deepEqual(JSON.parse(rows[1].checkpoint_json),selected.checkpoint);
  assert.equal(rows[1].checksum,selected.checksum);
  const authority=createSessionAuthority(configFromEnv({})),coordinator={projects:new Map()};
  const runtime=new DurableSessionRuntime({filePath:f.sqlitePath,managedRoot:f.options.managedRoot,
    authority,coordinator,components:null});
  t.after(()=>runtime.close());
  await writeFile(f.published,JSON.stringify({...f.hostPointer,descriptorHash:f.request.previousDescriptorHash}));
  await assert.rejects(runtime.restore(),/Finalized Project differs/);
  assert.equal(authority.sessions.size,0);
  await writeFile(f.published,JSON.stringify(f.hostPointer));
  await runtime.restore();
  assert.equal(runtime.ready,true);
  const session=authority.sessions.get(makeSessionKey(f.scope.projectId,f.scope.sessionId));
  assert.equal(session.revision,selected.revision);
  assert.notEqual(session.durableEpoch,selected.epoch);
  assert.equal(session.durableLineageId,selected.checkpoint.lineageId);
  assert.equal(coordinator.projects.get(f.scope.projectId).baseline.descriptorHash,f.request.candidateDescriptorHash);
  assert.deepEqual(runtime.store.readFinalizedProjectTransition(f.request.transitionId),archive);
});

test("finalization refuses legacy or rolled back journal, forged owner approval, and changed Host pointer",async t=>{
  const f=await reconciliationFixture(t),round=await beginOfflineGuestReconciliation(f.options);
  const a=await f.receipt(round),b=await f.receipt(round,"b");
  const original=f.store.listProjectTransitionJournals()[0];
  assert.throws(()=>f.store.finalizeProjectTransition({projectId:f.request.projectId,transitionId:f.request.transitionId,
    finalization:{evidence:{challenge:round.challenge,receipts:[a,b],verifiedAtUnixMs:Date.now()},ownerSignature:a.signature}}),
    {code:"INVALID_INPUT"});
  await assert.rejects(round.finalizeCandidate([a,b],{approve:async()=>{
    await writeFile(f.published,JSON.stringify({...f.hostPointer,approvedAtUnixMs:f.hostPointer.approvedAtUnixMs+1}));
    return true;
  }}));
  assert.deepEqual(f.store.listProjectTransitionJournals()[0],original);
  assert.deepEqual(f.store.listFinalizedProjectTransitions(),[]);
  await writeFile(f.published,JSON.stringify(f.hostPointer));
  await rollbackOfflineHostTransition({store:f.store,managedRoot:f.options.managedRoot,request:f.request});
  const recovery=await beginOfflineGuestReconciliation(f.options);
  await assert.rejects(recovery.finalizeCandidate([],{approve:async()=>assert.fail("rollback remains fenced")}));
  assert.equal(f.store.listProjectTransitionJournals()[0].stage,"sqlite_rolled_back");
  assert.deepEqual(f.store.listFinalizedProjectTransitions(),[]);
});

test("candidate finalization survives actual SQLite COMMIT boundary process death without losing either generation",async t=>{
  if(process.platform!=="linux") return t.skip("Linux SIGKILL fixture; native Windows separate");
  for(const phase of ["before_commit","after_commit"]) await t.test(phase,async t=>{
    const f=await reconciliationFixture(t),round=await beginOfflineGuestReconciliation(f.options);
    const a=await f.receipt(round),b=await f.receipt(round,"b");
    const before=f.store.listProjectTransitionJournals()[0],selected=f.store.load(f.scope);
    const finalization=signOfflineFinalization({challenge:round.challenge,receipts:[a,b],
      verifiedAtUnixMs:Date.now()},f.options.ownerIdentity);
    const input={projectId:f.request.projectId,transitionId:f.request.transitionId,finalization};
    f.store.close();
    const source=`
      import {DatabaseSync} from "node:sqlite";
      import {writeSync} from "node:fs";
      const {openDurableSessionStore}=await import(${JSON.stringify(new URL("../../server/src/durable-session-store.mjs",import.meta.url).href)});
      const [filePath,phase,input]=JSON.parse(process.argv[1]);
      const store=openDurableSessionStore({filePath});
      const original=DatabaseSync.prototype.exec;
      DatabaseSync.prototype.exec=function(sql){
        if(sql!=="COMMIT;") return original.call(this,sql);
        if(phase==="after_commit") original.call(this,sql);
        writeSync(1,"finalization-boundary:"+phase);
        process.kill(process.pid,"SIGKILL");
      };
      store.finalizeProjectTransition(input);
      process.exit(3);
    `;
    const killed=spawnSync(process.execPath,["--input-type=module","-e",source,
      JSON.stringify([f.sqlitePath,phase,input])],{encoding:"utf8",timeout:15000});
    assert.equal(killed.signal,"SIGKILL",killed.stderr);
    assert.equal(killed.stdout,"finalization-boundary:"+phase);
    const reopened=openDurableSessionStore({filePath:f.sqlitePath});
    t.after(()=>reopened.close());
    if(phase==="before_commit"){
      assert.deepEqual(reopened.listProjectTransitionJournals(),[before]);
      assert.deepEqual(reopened.listFinalizedProjectTransitions(),[]);
    }else{
      assert.deepEqual(reopened.listProjectTransitionJournals(),[]);
      assert.equal(reopened.readFinalizedProjectTransition(f.request.transitionId).journal.transitionId,before.transitionId);
    }
    assert.equal(reopened.finalizeProjectTransition(input).replayed,phase==="after_commit");
    assert.deepEqual(reopened.load(f.scope),selected);
    assert.deepEqual(reopened.listProjectTransitionJournals(),[]);
    assert.deepEqual(reopened.readFinalizedProjectTransition(f.request.transitionId).journal,before);
  });
});

test("v2 pending journal upgrades to v3 without changing any checkpoint or evidence",async t=>{
  const f=await reconciliationFixture(t),round=await beginOfflineGuestReconciliation(f.options);
  await round.recordReceipts([await f.receipt(round),await f.receipt(round,"b")]);
  const before=f.store.listProjectTransitionJournals(),selected=f.store.load(f.scope);
  f.store.close();
  const db=new DatabaseSync(f.sqlitePath);
  db.exec("DROP TABLE finalized_transition_checkpoints; DROP TABLE finalized_project_transitions; PRAGMA user_version=2;");
  db.close();
  const bytes=await readFile(f.sqlitePath);
  assert.throws(()=>openDurableSessionStore({filePath:f.sqlitePath,readOnly:true}),{code:"UPGRADE_REQUIRED"});
  assert.deepEqual(await readFile(f.sqlitePath),bytes);
  const reopened=openDurableSessionStore({filePath:f.sqlitePath});
  t.after(()=>reopened.close());
  assert.deepEqual(reopened.listProjectTransitionJournals(),before);
  assert.deepEqual(reopened.load(f.scope),selected);
  assert.deepEqual(reopened.listFinalizedProjectTransitions(),[]);
});

test("finalized archive refuses missing previous checkpoint on restart even when current candidate remains valid",async t=>{
  const f=await reconciliationFixture(t),round=await beginOfflineGuestReconciliation(f.options);
  await round.finalizeCandidate([await f.receipt(round),await f.receipt(round,"b")],{approve:async()=>true});
  f.store.close();
  const db=new DatabaseSync(f.sqlitePath);
  db.exec("DELETE FROM finalized_transition_checkpoints WHERE role='previous'");
  db.close();
  assert.throws(()=>openDurableSessionStore({filePath:f.sqlitePath}),{code:"INTEGRITY_ERROR"});
});
