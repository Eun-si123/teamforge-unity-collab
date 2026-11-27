import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {spawn,spawnSync} from "node:child_process";
import {cp,mkdir,readFile,rm,writeFile,stat} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {ChunkStore} from "../../project-peer/src/content-store.mjs";
import {PRODUCT_VERSION} from "../../project-peer/src/constants.mjs";
import {createDescriptor} from "../../project-peer/src/descriptor.mjs";
import {buildManifest} from "../../project-peer/src/manifest.mjs";
import {publicationFixture,temporaryRoot,cleanup} from "../../project-peer/test/helpers.mjs";
import {openDurableSessionStore} from "../src/durable-session-store.mjs";
import {DurableSessionRuntime} from "../src/durable-session-runtime.mjs";
import {inspectPendingProjectTransitions} from "../src/project-transition-recovery.mjs";
import {planSignedCheckpointTransition} from "../src/project-transition-checkpoint-plan.mjs";
import {rollbackOfflineHostTransition} from "../src/project-transition-host-rollback.mjs";
import {HOST_RECOVERY_FENCE_NAME,withPublishedPointerLock,assertNoPendingHostRecovery}
  from "../../project-peer/src/published-pointer-lock.mjs";

async function fixture(t,{deferCommit=false,legacyWithoutProjectId=false}={}) {
  const root=await temporaryRoot("teamforge-transition-recovery-");
  const stores=[];
  t.after(async ()=>{
    for(const item of stores.reverse()) item.close();
    await cleanup(root);
  });
  const prior=await publicationFixture(root);
  // A real changed file makes the old and new content sets independently
  // verifiable, rather than both revisions reusing the exact same Chunks.
  await writeFile(path.join(prior.projectRoot,"Assets","Test.txt"),"changed asset for signed M5\n");
  const candidateManifest=(await buildManifest({projectRoot:prior.projectRoot,
    projectUuid:prior.projectUuid,baselineRevision:2,chunkSize:65536,store:prior.store})).manifest;
  const candidate=createDescriptor({projectId:prior.projectId,projectUuid:prior.projectUuid,
    baselineRevision:2,manifestHash:candidateManifest.manifestHash,
    unityVersion:"6000.3.21f1",ownerIdentity:prior.owner});
  const managedRoot=path.join(root,"managed");
  const metadata=path.join(managedRoot,prior.projectUuid,"metadata");
  const pointers=path.join(metadata,"published.json");
  await mkdir(path.join(metadata,"manifests"),{recursive:true});
  await mkdir(path.join(metadata,"descriptors"),{recursive:true});
  await cp(path.join(root,"chunks"),path.join(metadata,"chunks"),{recursive:true});
  await writeFile(path.join(metadata,"project.json"),JSON.stringify({schemaVersion:1,
    productVersion:PRODUCT_VERSION,projectId:prior.projectId,projectUuid:prior.projectUuid,
    createdAtUnixMs:Date.now()}));
  for(const [manifest,descriptor] of [[prior.manifest,prior.descriptor],[candidateManifest,candidate]]) {
    await writeFile(path.join(metadata,"manifests",`${manifest.manifestHash}.json`),JSON.stringify(manifest));
    await writeFile(path.join(metadata,"descriptors",`${descriptor.descriptorHash}.json`),JSON.stringify(descriptor));
  }
  const pointer=descriptor=>({schemaVersion:1,projectUuid:prior.projectUuid,
    baselineRevision:descriptor.baselineRevision,manifestHash:descriptor.manifestHash,
    descriptorHash:descriptor.descriptorHash,ownerKeyId:descriptor.ownerKeyId,approvedAtUnixMs:Date.now()});
  await writeFile(pointers,JSON.stringify(pointer(prior.descriptor)));

  const sqlitePath=path.join(root,"durable.sqlite");
  const store=openDurableSessionStore({filePath:sqlitePath});
  stores.push(store);
  const scope={projectId:prior.projectId,projectUuid:prior.projectUuid,sessionId:"saved-editor-session"};
  const oldEpoch=randomUUID(), nextEpoch=randomUUID(),lineage=randomUUID();
  const original={version:1,lineageId:lineage,
    project:legacyWithoutProjectId ? Object.fromEntries(
      Object.entries(prior.descriptor).filter(([key])=>key!=="projectId")) : prior.descriptor,
    publication:{publishedByUserId:"host",publishedByConnectionId:"connection1",publishedAtUnixMs:1000},
    realtime:{revision:1,hierarchyObjects:[{id:"scene-editor",name:"Preserve M4 work"}]},components:null};
  const saved=store.commit({scope,epoch:oldEpoch,baseRevision:0,revision:1,
    checkpoint:original,operation:null});
  const nextCheckpoint=structuredClone(original);
  nextCheckpoint.project=candidate;
  nextCheckpoint.publication={...original.publication,publishedAtUnixMs:2000};
  const migration={projectId:scope.projectId,projectUuid:scope.projectUuid,
    previousDescriptorHash:prior.descriptor.descriptorHash,candidateDescriptorHash:candidate.descriptorHash,
    sessions:[{scope,previousEpoch:oldEpoch,nextEpoch,revision:1,
      expectedChecksum:saved.checksum,checkpoint:nextCheckpoint}]};
  if(!deferCommit) store.transitionProjectCheckpoints(migration);
  return {root,prior,candidate,candidateManifest,managedRoot,metadata,pointers,pointer,
    store,scope,sqlitePath,original,migration,stores};
}

test("cross-store recovery inspector verifies signed previous and candidate revisions without changing Host pointer",async t=>{
  const f=await fixture(t);
  const first=await inspectPendingProjectTransitions({store:f.store,managedRoot:f.managedRoot});
  assert.equal(first.length,1);
  assert.equal(first[0].state,"host_points_previous");
  assert.equal(first[0].sqliteStage,"sqlite_committed");
  assert.equal(first[0].signedMetadataVerified,true);
  assert.equal(first[0].previousContentVerified,true);
  assert.equal(first[0].candidateContentVerified,true);
  assert.equal(first[0].candidateVerifiedFileCount,f.candidateManifest.totalFiles);
  assert.equal(first[0].candidateVerifiedByteCount,f.candidateManifest.totalBytes);
  assert.equal(first[0].editorResumePermitted,false);
  assert.equal(first[0].automaticPointerRepairPermitted,false);
  assert.equal(f.store.load(f.scope).checkpoint.project.descriptorHash,f.candidate.descriptorHash);
  assert.deepEqual(f.store.readProjectTransitionBackup({projectId:f.scope.projectId,sessionId:f.scope.sessionId}).checkpoint,
    f.original);
  await writeFile(f.pointers,JSON.stringify(f.pointer(f.candidate)));
  const second=await inspectPendingProjectTransitions({store:f.store,managedRoot:f.managedRoot});
  assert.equal(second[0].state,"host_points_candidate");
  assert.equal(second[0].editorResumePermitted,false,
    "Host pointer alone never grants fresh Editor, Publisher or Guest authority");
  const other={...f.pointer(f.candidate),manifestHash:"f".repeat(64)};
  await writeFile(f.pointers,JSON.stringify(other));
  const conflict=await inspectPendingProjectTransitions({store:f.store,managedRoot:f.managedRoot});
  assert.equal(conflict[0].state,"host_pointer_conflict");
  assert.equal(conflict[0].candidateContentVerified,true);
});

test("cross-store recovery never repairs missing or invalid pointer or trusts incomplete signed chunks",async t=>{
  const f=await fixture(t);
  await rm(f.pointers);
  assert.equal((await inspectPendingProjectTransitions({store:f.store,managedRoot:f.managedRoot}))[0].state,
    "host_pointer_missing");
  await writeFile(f.pointers,"{broken");
  assert.equal((await inspectPendingProjectTransitions({store:f.store,managedRoot:f.managedRoot}))[0].state,
    "host_pointer_unavailable");
  await writeFile(f.pointers,JSON.stringify(f.pointer(f.prior.descriptor)));
  const candidateChunks=new Set(f.candidateManifest.files.flatMap(file=>file.chunks).map(chunk=>chunk.hash));
  const chunk=f.prior.manifest.files.flatMap(file=>file.chunks)
    .find(chunk=>!candidateChunks.has(chunk.hash));
  assert.ok(chunk);
  await rm(new ChunkStore(path.join(f.metadata,"chunks")).pathForHash(chunk.hash));
  const damaged=await inspectPendingProjectTransitions({store:f.store,managedRoot:f.managedRoot});
  assert.equal(damaged[0].state,"previous_content_unavailable");
  assert.equal(damaged[0].editorResumePermitted,false);
});

test("Coordinator restore fails closed before projecting any recovered Session when a signed cross-store transition is unresolved",async t=>{
  const f=await fixture(t);
  f.store.close();
  const authority={sessions:new Map()};
  const coordinator={projects:new Map()};
  const runtime=new DurableSessionRuntime({filePath:f.sqlitePath,
    managedRoot:f.managedRoot,authority,coordinator,components:null});
  f.stores.push(runtime);
  await assert.rejects(runtime.restore(),/unresolved/);
  await writeFile(f.pointers,JSON.stringify(f.pointer(f.candidate)));
  await assert.rejects(runtime.restore(),/unresolved/,
    "even a matching Host pointer cannot grant Editor/Guest resume before reconciliation");
  assert.equal(runtime.ready,false);
  assert.equal(runtime.checkpoints.size,0);
  assert.equal(runtime.approvedProjects.size,0);
  assert.equal(authority.sessions.size,0);
  assert.equal(coordinator.projects.size,0);
  assert.equal(runtime.store.listProjectTransitionJournals().length,1);
});


test("Host approval changing during streamed signed Chunks invalidates the recovery diagnostic",async t=>{
  const f=await fixture(t);
  const original=ChunkStore.prototype.read;
  let changed=false;
  ChunkStore.prototype.read=async function(...args) {
    const bytes=await original.apply(this,args);
    if(!changed) {
      changed=true;
      await writeFile(f.pointers,JSON.stringify(f.pointer(f.candidate)));
    }
    return bytes;
  };
  try {
    const reports=await inspectPendingProjectTransitions({store:f.store,managedRoot:f.managedRoot});
    assert.equal(changed,true);
    assert.equal(reports[0].state,"host_pointer_changed");
    assert.equal(reports[0].editorResumePermitted,false);
  } finally {ChunkStore.prototype.read=original;}
});


test("SIGKILL after full SQLite COMMIT but before Host approval retains M4 backups and safely reports the cross-store gap",async t=>{
  if(process.platform==="win32") return t.skip("POSIX SIGKILL test; real Windows crash is a separate field gate");
  const f=await fixture(t,{deferCommit:true});
  f.store.close();
  const moduleUrl=new URL("../src/durable-session-store.mjs",import.meta.url).href;
  const source=`import {openDurableSessionStore} from ${JSON.stringify(moduleUrl)};
    const store=openDurableSessionStore({filePath:process.argv[1]});
    const transition=JSON.parse(process.argv[2]);
    const committed=store.transitionProjectCheckpoints(transition);
    process.send({phase:'sqlite_committed',sessionCount:committed.sessionCount});
    setInterval(()=>{},1000);`;
  const child=spawn(process.execPath,["--input-type=module","-e",source,
    f.sqlitePath,JSON.stringify(f.migration)],{stdio:["ignore","pipe","pipe","ipc"]});
  t.after(()=>{if(child.exitCode===null && !child.killed)child.kill("SIGKILL");});
  let timeout;
  const phase=await Promise.race([
    new Promise((resolve,reject)=>{
      child.once('message',resolve);
      child.once('error',reject);
      child.once('exit',(code,signal)=>reject(new Error(`Child exited before SQLite commit: ${code}/${signal}`)));
    }),
    new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Child did not commit SQLite')),5000);}),
  ]).finally(()=>clearTimeout(timeout));
  assert.deepEqual(phase,{phase:'sqlite_committed',sessionCount:1});
  child.kill('SIGKILL');
  await new Promise((resolve,reject)=>{
    if(child.exitCode!==null || child.signalCode!==null) return resolve();
    child.once('exit',resolve);
    child.once('error',reject);
  });
  const reopened=openDurableSessionStore({filePath:f.sqlitePath});
  f.stores.push(reopened);
  const journal=reopened.listProjectTransitionJournals();
  assert.equal(journal.length,1);
  assert.equal(journal[0].stage,'sqlite_committed');
  assert.equal(reopened.load(f.scope).checkpoint.project.descriptorHash,f.candidate.descriptorHash);
  assert.deepEqual(reopened.readProjectTransitionBackup({projectId:f.scope.projectId,
    sessionId:f.scope.sessionId}).checkpoint,f.original);
  const reports=await inspectPendingProjectTransitions({store:reopened,managedRoot:f.managedRoot});
  assert.equal(reports[0].state,'host_points_previous');
  assert.equal(reports[0].previousContentVerified,true);
  assert.equal(reports[0].candidateContentVerified,true);
  assert.equal(reports[0].editorResumePermitted,false);
});

test("cross-store inspector rejects missing candidate-only bytes, without treating old content as lost",async t=>{
  const f=await fixture(t);
  const oldChunks=new Set(f.prior.manifest.files.flatMap(file=>file.chunks).map(chunk=>chunk.hash));
  const candidateChunk=f.candidateManifest.files.flatMap(file=>file.chunks)
    .find(chunk=>!oldChunks.has(chunk.hash));
  assert.ok(candidateChunk);
  await rm(new ChunkStore(path.join(f.metadata,"chunks")).pathForHash(candidateChunk.hash));
  const reports=await inspectPendingProjectTransitions({store:f.store,managedRoot:f.managedRoot});
  assert.equal(reports[0].state,'candidate_content_unavailable');
  assert.equal(reports[0].editorResumePermitted,false);
  assert.deepEqual(f.store.readProjectTransitionBackup({projectId:f.scope.projectId,
    sessionId:f.scope.sessionId}).checkpoint,f.original);
});


test("offline read-only recovery CLI reports a real signed Host/M4-to-SQLite/M5 gap without editing the database or pointer",async t=>{
  const f=await fixture(t);
  f.store.close();
  const beforeDb=await readFile(f.sqlitePath);
  const beforePointer=await readFile(f.pointers);
  const cli=fileURLToPath(new URL("../scripts/inspect-transition-recovery.mjs",import.meta.url));
  const result=spawnSync(process.execPath,[cli,f.sqlitePath,f.managedRoot],
    {encoding:"utf8",timeout:10000});
  assert.equal(result.status,0,`CLI failed: ${result.stderr}`);
  const report=JSON.parse(result.stdout);
  assert.equal(report.mode,"offline_read_only_snapshot");
  assert.equal(report.pendingTransitionCount,1);
  assert.equal(report.reports[0].state,"host_points_previous");
  assert.equal(report.reports[0].previousContentVerified,true);
  assert.equal(report.reports[0].candidateContentVerified,true);
  assert.equal(report.editorResumePermitted,false);
  assert.equal(report.automaticRepairPermitted,false);
  assert.deepEqual(await readFile(f.sqlitePath),beforeDb);
  assert.deepEqual(await readFile(f.pointers),beforePointer);
  const scoped=spawnSync(process.execPath,[cli,f.sqlitePath,f.managedRoot,"--guest-request",report.reports[0].transitionId],
    {encoding:"utf8",timeout:10000});
  assert.equal(scoped.status,0,scoped.stderr);
  assert.deepEqual(JSON.parse(scoped.stdout),{
    schemaVersion:1,projectId:report.reports[0].projectId,projectUuid:report.reports[0].projectUuid,
    transitionId:report.reports[0].transitionId,previousDescriptorHash:report.reports[0].previousDescriptorHash,
    candidateDescriptorHash:report.reports[0].candidateDescriptorHash,
  });
  const wrong=spawnSync(process.execPath,[cli,f.sqlitePath,f.managedRoot,"--guest-request",randomUUID()],
    {encoding:"utf8",timeout:10000});
  assert.equal(wrong.status,1);assert.equal(wrong.stdout,"");
  assert.equal(scoped.stdout.includes(f.root),false);
  assert.deepEqual(await readFile(f.sqlitePath),beforeDb);
  assert.deepEqual(await readFile(f.pointers),beforePointer);
  const missing=spawnSync(process.execPath,[cli,path.join(f.root,"absent.sqlite"),f.managedRoot],
    {encoding:"utf8",timeout:10000});
  assert.equal(missing.status,1);
  assert.equal(missing.stdout,"");
  assert.equal(missing.stderr.includes(f.root),false,
    "Diagnostics must not print private managed-root paths");
  await assert.rejects(readFile(path.join(f.root,"absent.sqlite")),{code:"ENOENT"});
});


test("M4->M5 read-only planner generates real signed checkpoint transition from legacy M4 missing projectId without touching SQLite",async t=>{
  const f=await fixture(t,{deferCommit:true,legacyWithoutProjectId:true});
  const before=f.store.load(f.scope);
  assert.equal(before.checkpoint.project.projectId,undefined,
    "The production runtime can persist a signature-bound Project without repeating projectId.");
  const plan=planSignedCheckpointTransition({store:f.store,projectId:f.scope.projectId,
    previousDescriptor:f.prior.descriptor,candidateDescriptor:f.candidate,
    publication:{publishedByUserId:"host",publishedByConnectionId:"connection1",publishedAtUnixMs:2000}});
  assert.equal(plan.status,"read_only_intent",JSON.stringify(plan));
  assert.equal(plan.commitPermitted,false);
  assert.equal(plan.sessionCount,1);
  assert.deepEqual(f.store.load(f.scope),before,"Planning must not mutate the M4 disk checkpoint.");
  assert.deepEqual(f.store.listProjectTransitionJournals(),[],
    "A source plan alone never opens the crash-recovery journal.");
  const one=plan.migrationInput.sessions[0];
  assert.equal(one.revision,before.revision);
  assert.equal(one.expectedChecksum,before.checksum);
  assert.notEqual(one.nextEpoch,one.previousEpoch);
  assert.deepEqual(one.checkpoint.realtime,before.checkpoint.realtime);
  assert.equal(one.checkpoint.lineageId,before.checkpoint.lineageId);
  assert.equal(one.checkpoint.project.descriptorHash,f.candidate.descriptorHash);
  assert.equal(one.checkpoint.project.projectId,f.scope.projectId);
  // This explicit call is confined to a disposable TEST fixture, not a live
  // Coordinator. The production API intentionally does NOT call the writer.
  const committed=f.store.transitionProjectCheckpoints(plan.migrationInput);
  assert.equal(committed.sessionCount,1);
  assert.equal(f.store.load(f.scope).epoch,one.nextEpoch);
  assert.deepEqual(f.store.readProjectTransitionBackup({projectId:f.scope.projectId,
    sessionId:f.scope.sessionId}).checkpoint,f.original);
  assert.equal((await inspectPendingProjectTransitions({store:f.store,
    managedRoot:f.managedRoot}))[0].state,"host_points_previous");
  assert.equal(f.store.listProjectTransitionJournals().length,1);
  assert.equal(f.store.load(f.scope).checkpoint.project.descriptorHash,f.candidate.descriptorHash);
});

test("M4->M5 planner includes all distinct signed Sessions and preserves Collider, Hierarchy, Transform and foreign Projects",async t=>{
  const f=await fixture(t,{deferCommit:true});
  const prior=f.store.load(f.scope);
  const other={...f.scope,sessionId:"second-scene"};
  const independent={...f.scope,projectId:"not-part-of-transition",sessionId:"foreign"};
  const source={projectId:f.scope.projectId,projectUuid:f.scope.projectUuid,
    baselineRevision:1,manifestHash:f.prior.descriptor.manifestHash,
    descriptorHash:f.prior.descriptor.descriptorHash,ownerKeyId:f.prior.descriptor.ownerKeyId,
    sceneId:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",scenePath:"Assets/Scenes/Main.unity",
    sceneFileSha256:"b".repeat(64),sceneMetaSha256:"c".repeat(64)};
  const initial={...f.original,realtime:{revision:1,
    hierarchyObjects:[{id:"synced-mesh",name:"Real Blender Asset"}],
    transforms:[{position:{x:3,y:4,z:5}}]},
    components:{source,collider:{components:[{objectId:"synced-mesh",kind:"BoxCollider"}],
      properties:[{value:17}],tombstones:[]}}};
  const saved=f.store.commit({scope:other,epoch:randomUUID(),baseRevision:0,revision:1,
    checkpoint:initial,operation:null});
  const outsider=f.store.commit({scope:independent,epoch:randomUUID(),baseRevision:0,
    revision:1,checkpoint:{independent:true},operation:null});
  const planned=planSignedCheckpointTransition({store:f.store,projectId:f.scope.projectId,
    previousDescriptor:f.prior.descriptor,candidateDescriptor:f.candidate,
    publication:{publishedByUserId:"host",publishedByConnectionId:"connection1",publishedAtUnixMs:2000}});
  assert.equal(planned.status,"read_only_intent",JSON.stringify(planned));
  assert.equal(planned.sessionCount,2);
  const collider=planned.migrationInput.sessions.find(row=>row.scope.sessionId===other.sessionId);
  assert.equal(collider.expectedChecksum,saved.checksum);
  assert.deepEqual(collider.checkpoint.components.collider,initial.components.collider);
  assert.deepEqual(collider.checkpoint.realtime,initial.realtime);
  assert.equal(collider.checkpoint.components.source.sceneFileSha256,source.sceneFileSha256);
  assert.equal(collider.checkpoint.components.source.descriptorHash,f.candidate.descriptorHash);
  assert.equal(collider.checkpoint.components.source.baselineRevision,2);
  assert.deepEqual(f.store.load(independent).checkpoint,{independent:true});
  f.store.transitionProjectCheckpoints(planned.migrationInput);
  assert.deepEqual(f.store.load(independent).checkpoint,{independent:true});
  assert.equal(f.store.load(f.scope).revision,prior.revision);
  assert.deepEqual(f.store.load(other).checkpoint.realtime,initial.realtime);
  assert.deepEqual(f.store.readProjectTransitionBackup({projectId:f.scope.projectId,
    sessionId:other.sessionId}).checkpoint,initial);
});

test("M4->M5 planner refuses forged Owner, wrong Project, stale Session generation, replayed epochs and unresolved journals",async t=>{
  const f=await fixture(t,{deferCommit:true});
  const request=()=>({store:f.store,projectId:f.scope.projectId,
    previousDescriptor:f.prior.descriptor,candidateDescriptor:f.candidate,
    publication:{publishedByUserId:"host",publishedByConnectionId:"connection1",publishedAtUnixMs:2000}});
  for(const changed of [
    {candidateDescriptor:{...f.candidate,manifestHash:"f".repeat(64)}},
    {candidateDescriptor:{...f.candidate,baselineRevision:3}},
    {projectId:"other-project"},
    {publication:{publishedByUserId:"host",publishedByConnectionId:"connection1",publishedAtUnixMs:999}},
    {nextEpoch:()=>f.migration.sessions[0].previousEpoch},
    {nextEpoch:()=>"not-a-uuid"},
  ]) {
    const attempt=planSignedCheckpointTransition({...request(),...changed});
    assert.ok(attempt.error,JSON.stringify(attempt));
    assert.equal(attempt.commitPermitted,false);
    assert.deepEqual(f.store.listProjectTransitionJournals(),[]);
  }
  const stale=planSignedCheckpointTransition(request());
  assert.equal(stale.status,"read_only_intent",JSON.stringify(stale));
  const current=f.store.load(f.scope);
  f.store.commit({scope:f.scope,epoch:current.epoch,baseRevision:current.revision,
    revision:current.revision+1,
    operation:{operationId:randomUUID(),userId:"host",fingerprint:"a".repeat(64),
      result:{type:"hierarchy_applied",serverRevision:current.revision+1}},
    checkpoint:{...current.checkpoint,realtime:{...current.checkpoint.realtime,
      revision:current.revision+1,hierarchyObjects:[{id:"other",name:"Work after planning"}]}}});
  assert.throws(()=>f.store.transitionProjectCheckpoints(stale.migrationInput),
    e=>e.code==="REVISION_CONFLICT", "The actual SQLite CAS must reject edited M4 work after plan capture.");
  assert.deepEqual(f.store.listProjectTransitionJournals(),[]);
  assert.equal(f.store.load(f.scope).checkpoint.realtime.hierarchyObjects[0].name,"Work after planning");
  const newer=planSignedCheckpointTransition(request());
  assert.equal(newer.status,"read_only_intent",JSON.stringify(newer));
  f.store.transitionProjectCheckpoints(newer.migrationInput);
  assert.equal(planSignedCheckpointTransition(request()).error,"project_transition_recovery_required");
});

test("M4->M5 checkpoint plan refuses Collider source forged against the old signed Project pin",async t=>{
  const f=await fixture(t,{deferCommit:true});
  const damagedScope={...f.scope,sessionId:"collider-with-stale-source"};
  const forged={...f.original,components:{source:{
    projectId:f.scope.projectId,projectUuid:f.scope.projectUuid,
    baselineRevision:1,manifestHash:f.prior.descriptor.manifestHash,
    descriptorHash:"f".repeat(64),ownerKeyId:f.prior.descriptor.ownerKeyId,
    sceneId:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",scenePath:"Assets/Scenes/Main.unity",
    sceneFileSha256:"b".repeat(64),sceneMetaSha256:"c".repeat(64)},
    collider:{components:[{objectId:"box"}],properties:[{value:42}]}}};
  f.store.commit({scope:damagedScope,epoch:randomUUID(),baseRevision:0,
    revision:1,checkpoint:forged,operation:null});
  const before=f.store.load(damagedScope);
  const result=planSignedCheckpointTransition({store:f.store,projectId:f.scope.projectId,
    previousDescriptor:f.prior.descriptor,candidateDescriptor:f.candidate,
    publication:{publishedByUserId:"host",publishedByConnectionId:"connection1",publishedAtUnixMs:2000}});
  assert.equal(result.error,"project_transition_plan_checkpoint_conflict",JSON.stringify(result));
  assert.equal(result.commitPermitted,false);
  assert.deepEqual(f.store.load(damagedScope),before);
  assert.deepEqual(f.store.listProjectTransitionJournals(),[]);
});

test("M4->M5 planner invalidates a stale read when a concurrent accepted M4 edit commits before the second cursor scan",async t=>{
  const f=await fixture(t,{deferCommit:true});
  const before=f.store.load(f.scope);
  let reads=0;
  const observer={
    listProjectTransitionJournals:()=>f.store.listProjectTransitionJournals(),
    loadAll:()=>{
      if(++reads===2) {
        f.store.commit({scope:f.scope,epoch:before.epoch,baseRevision:before.revision,
          revision:before.revision+1,
          operation:{operationId:randomUUID(),userId:"host",fingerprint:"f".repeat(64),
            result:{type:"transform_applied",serverRevision:before.revision+1}},
          checkpoint:{...before.checkpoint,realtime:{...before.checkpoint.realtime,
            revision:before.revision+1,
            hierarchyObjects:[{id:"saved-after-read",name:"Must never disappear"}]}}});
      }
      return f.store.loadAll();
    },
  };
  const plan=planSignedCheckpointTransition({store:observer,projectId:f.scope.projectId,
    previousDescriptor:f.prior.descriptor,candidateDescriptor:f.candidate,
    publication:{publishedByUserId:"host",publishedByConnectionId:"connection1",publishedAtUnixMs:2000}});
  assert.equal(reads,2);
  assert.equal(plan.error,"project_transition_plan_checkpoint_changed",JSON.stringify(plan));
  assert.equal(plan.commitPermitted,false);
  assert.equal(f.store.load(f.scope).checkpoint.realtime.hierarchyObjects[0].name,"Must never disappear");
  assert.deepEqual(f.store.listProjectTransitionJournals(),[]);
});

test("SQLite rollback recovery reports actual restored M4 pin while Host remains at candidate; never resumes Editors",async t=>{
  const f=await fixture(t);
  const journal=f.store.listProjectTransitionJournals()[0];
  const {projectId,projectUuid,transitionId,previousDescriptorHash,candidateDescriptorHash}=journal;
  const request={projectId,projectUuid,transitionId,previousDescriptorHash,candidateDescriptorHash};
  await writeFile(f.pointers,JSON.stringify(f.pointer(f.candidate)));
  const pointerBefore=await readFile(f.pointers);
  const rollback=f.store.rollbackProjectTransitionCheckpoints(request);
  assert.equal(rollback.stage,"sqlite_rolled_back");
  assert.equal(rollback.editorResumePermitted,false);
  const reports=await inspectPendingProjectTransitions({store:f.store,managedRoot:f.managedRoot});
  assert.equal(reports.length,1);
  assert.equal(reports[0].state,"host_points_candidate");
  assert.equal(reports[0].sqliteStage,"sqlite_rolled_back");
  assert.equal(reports[0].currentDescriptorHash,f.prior.descriptor.descriptorHash);
  assert.equal(reports[0].candidateDescriptorHash,f.candidate.descriptorHash);
  assert.equal(reports[0].editorResumePermitted,false);
  assert.equal(reports[0].automaticPointerRepairPermitted,false);
  assert.deepEqual(await readFile(f.pointers),pointerBefore);
  assert.deepEqual(f.store.load(f.scope).checkpoint,f.original);
  f.store.close();
  const runtime=new DurableSessionRuntime({filePath:f.sqlitePath,managedRoot:f.managedRoot,
    authority:{sessions:new Map()},coordinator:{projects:new Map()},components:null});
  try {
    await assert.rejects(runtime.restore(),/unresolved/);
    await writeFile(f.pointers,JSON.stringify(f.pointer(f.prior.descriptor)));
    await assert.rejects(runtime.restore(),/unresolved/,
      "Matching M4 Host and SQLite does not establish Guest and Editor reconciliation.");
    assert.equal(runtime.ready,false);
    assert.equal(runtime.store.rollbackProjectTransitionCheckpoints(request).replayed,true);
  } finally {runtime.close();}
});

test("Recovery diagnostic invalidates stale SQLite stage if rollback occurs during signed content audit",async t=>{
  const f=await fixture(t);
  const {projectId,projectUuid,transitionId,previousDescriptorHash,candidateDescriptorHash}=
    f.store.listProjectTransitionJournals()[0];
  const original=ChunkStore.prototype.read;
  let rolled=false;
  ChunkStore.prototype.read=async function(...args) {
    const bytes=await original.apply(this,args);
    if(!rolled) {
      rolled=true;
      f.store.rollbackProjectTransitionCheckpoints({
        projectId,projectUuid,transitionId,previousDescriptorHash,candidateDescriptorHash});
    }
    return bytes;
  };
  try {
    const reports=await inspectPendingProjectTransitions({store:f.store,managedRoot:f.managedRoot});
    assert.equal(rolled,true);
    assert.equal(reports[0].state,"sqlite_transition_changed");
    assert.equal(reports[0].sqliteStage,"sqlite_rolled_back");
    assert.equal(reports[0].currentDescriptorHash,f.prior.descriptor.descriptorHash);
    assert.equal(reports[0].editorResumePermitted,false);
  } finally {ChunkStore.prototype.read=original;}
});

const hostRecoveryRequest=store=>{
  const {projectId,projectUuid,transitionId,previousDescriptorHash,candidateDescriptorHash}=
    store.listProjectTransitionJournals()[0];
  return {projectId,projectUuid,transitionId,previousDescriptorHash,candidateDescriptorHash};
};

test("Offline Host rollback actually reconciles published M5 pointer and SQLite M4 backup, fences ordinary publishing, and retries",async t=>{
  const f=await fixture(t);
  const request=hostRecoveryRequest(f.store);
  const oldM5=f.pointer(f.candidate);
  await writeFile(f.pointers,JSON.stringify(oldM5));
  const fencePath=path.join(f.metadata,HOST_RECOVERY_FENCE_NAME);
  const args={store:f.store,managedRoot:f.managedRoot,request};
  const first=await rollbackOfflineHostTransition(args);
  assert.equal(first.status,"host_sqlite_rolled_back");
  assert.equal(first.hostPointerChanged,true);
  assert.equal(first.sqliteReplayed,false);
  assert.equal(first.guestReconciliationRequired,true);
  assert.equal(first.editorResumePermitted,false);
  const fence=JSON.parse(await readFile(fencePath,"utf8"));
  assert.deepEqual(fence.before,oldM5);
  const restored=JSON.parse(await readFile(f.pointers,"utf8"));
  assert.deepEqual(restored,fence.target);
  assert.equal(restored.descriptorHash,f.prior.descriptor.descriptorHash);
  assert.equal(restored.baselineRevision,1);
  assert.equal(restored.approvedAtUnixMs,fence.recoveredAtUnixMs);
  assert.deepEqual(f.store.load(f.scope).checkpoint,f.original);
  assert.equal(f.store.listProjectTransitionJournals()[0].stage,"sqlite_rolled_back");
  await assert.rejects(assertNoPendingHostRecovery(f.metadata),{code:"host_transition_recovery_required"});
  const retry=await rollbackOfflineHostTransition(args);
  assert.equal(retry.sqliteReplayed,true);
  assert.equal(retry.hostPointerChanged,false);
  assert.deepEqual(JSON.parse(await readFile(fencePath,"utf8")),fence);
  assert.deepEqual(JSON.parse(await readFile(f.pointers,"utf8")),restored);
  assert.equal((await inspectPendingProjectTransitions({store:f.store,managedRoot:f.managedRoot}))[0].state,"host_points_previous");
});

test("Offline Host rollback retains an already approved M4 pointer exactly and refuses lock contention or unknown Host state",async t=>{
  const f=await fixture(t);
  const request=hostRecoveryRequest(f.store);
  const args={store:f.store,managedRoot:f.managedRoot,request};
  const originalBytes=await readFile(f.pointers);
  const fencePath=path.join(f.metadata,HOST_RECOVERY_FENCE_NAME);
  await withPublishedPointerLock(f.metadata,async ()=>{
    await assert.rejects(rollbackOfflineHostTransition(args),{code:"published_pointer_busy"});
  });
  assert.equal(f.store.listProjectTransitionJournals()[0].stage,"sqlite_committed");
  await assert.rejects(stat(fencePath),{code:"ENOENT"});
  await assert.rejects(rollbackOfflineHostTransition({...args,request:{...request,transitionId:randomUUID()}}),
    {code:"host_transition_recovery_conflict"});
  await writeFile(f.pointers,JSON.stringify({...f.pointer(f.candidate),descriptorHash:"d".repeat(64)}));
  await assert.rejects(rollbackOfflineHostTransition(args),{code:"host_transition_recovery_conflict"});
  assert.equal(f.store.listProjectTransitionJournals()[0].stage,"sqlite_committed");
  await assert.rejects(stat(fencePath),{code:"ENOENT"});
  await writeFile(f.pointers,originalBytes);
  const result=await rollbackOfflineHostTransition(args);
  assert.equal(result.hostPointerChanged,false);
  assert.deepEqual(await readFile(f.pointers),originalBytes);
  assert.equal(f.store.listProjectTransitionJournals()[0].stage,"sqlite_rolled_back");
});

test("Offline Host rollback survives an interruption after SQLite rollback before Host pointer write, and never overwrites an intervening pointer",async t=>{
  const f=await fixture(t);
  const request=hostRecoveryRequest(f.store);
  const before=f.pointer(f.candidate);
  await writeFile(f.pointers,JSON.stringify(before));
  const controller=new AbortController();
  const wrapper={
    readOnly:false,listProjectTransitionJournals:()=>f.store.listProjectTransitionJournals(),
    rollbackProjectTransitionCheckpoints:identity=>{
      const result=f.store.rollbackProjectTransitionCheckpoints(identity);
      controller.abort();
      return result;
    },
  };
  await assert.rejects(rollbackOfflineHostTransition({store:wrapper,managedRoot:f.managedRoot,
    request,signal:controller.signal}),{name:"AbortError"});
  const markerPath=path.join(f.metadata,HOST_RECOVERY_FENCE_NAME);
  const marker=await readFile(markerPath);
  assert.equal(f.store.listProjectTransitionJournals()[0].stage,"sqlite_rolled_back");
  assert.deepEqual(JSON.parse(await readFile(f.pointers,"utf8")),before);
  assert.deepEqual(f.store.load(f.scope).checkpoint,f.original);
  const changed={...before,approvedAtUnixMs:before.approvedAtUnixMs+1};
  await writeFile(f.pointers,JSON.stringify(changed));
  await assert.rejects(rollbackOfflineHostTransition({store:f.store,managedRoot:f.managedRoot,request}),
    {code:"host_transition_recovery_conflict"});
  assert.deepEqual(JSON.parse(await readFile(f.pointers,"utf8")),changed);
  assert.deepEqual(await readFile(markerPath),marker);
  await writeFile(f.pointers,JSON.stringify(before));
  const retry=await rollbackOfflineHostTransition({store:f.store,managedRoot:f.managedRoot,request});
  assert.equal(retry.sqliteReplayed,true);
  assert.equal(retry.hostPointerChanged,true);
  assert.equal(JSON.parse(await readFile(f.pointers,"utf8")).descriptorHash,f.prior.descriptor.descriptorHash);
  assert.deepEqual(await readFile(markerPath),marker);
});

test("Offline Host rollback refuses corrupted signed source and malformed recovery fence without overwriting pointers",async t=>{
  const f=await fixture(t);
  const request=hostRecoveryRequest(f.store);
  const before=await readFile(f.pointers);
  const marker=path.join(f.metadata,HOST_RECOVERY_FENCE_NAME);
  const oldChunks=new Set(f.prior.manifest.files.flatMap(file=>file.chunks).map(chunk=>chunk.hash));
  const chunk=f.candidateManifest.files.flatMap(file=>file.chunks).find(chunk=>!oldChunks.has(chunk.hash));
  const file=new ChunkStore(path.join(f.metadata,"chunks")).pathForHash(chunk.hash);
  const originalChunk=await readFile(file);
  await writeFile(file,"corrupt candidate bytes");
  await assert.rejects(rollbackOfflineHostTransition({store:f.store,managedRoot:f.managedRoot,request}),
    {code:"host_transition_recovery_conflict"});
  assert.equal(f.store.listProjectTransitionJournals()[0].stage,"sqlite_committed");
  await assert.rejects(stat(marker),{code:"ENOENT"});
  await writeFile(file,originalChunk);
  await writeFile(marker,"{bad fence");
  await assert.rejects(rollbackOfflineHostTransition({store:f.store,managedRoot:f.managedRoot,request}));
  assert.equal(f.store.listProjectTransitionJournals()[0].stage,"sqlite_committed");
  assert.deepEqual(await readFile(f.pointers),before);
  await assert.rejects(assertNoPendingHostRecovery(f.metadata),
    {code:"host_transition_recovery_required"});
});

test("Offline Host rollback SIGKILL after SQLite commit retains durable intent and recovers only a provably released lock",async t=>{
  if(process.platform==="win32") return t.skip("POSIX abrupt process termination at the cross-store boundary");
  const f=await fixture(t);
  const request=hostRecoveryRequest(f.store);
  const candidate=f.pointer(f.candidate);
  await writeFile(f.pointers,JSON.stringify(candidate));
  f.store.close();
  const storeUrl=new URL("../src/durable-session-store.mjs",import.meta.url).href;
  const rollbackUrl=new URL("../src/project-transition-host-rollback.mjs",import.meta.url).href;
  const source=`
    import {openDurableSessionStore} from ${JSON.stringify(storeUrl)};
    import {rollbackOfflineHostTransition} from ${JSON.stringify(rollbackUrl)};
    const store=openDurableSessionStore({filePath:process.argv[1]});
    const wrapped={readOnly:false,listProjectTransitionJournals:()=>store.listProjectTransitionJournals(),
      rollbackProjectTransitionCheckpoints:identity=>{
        const outcome=store.rollbackProjectTransitionCheckpoints(identity);
        process.send({phase:outcome.stage});
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
        return outcome;
      }};
    await rollbackOfflineHostTransition({store:wrapped,managedRoot:process.argv[2],
      request:JSON.parse(process.argv[3])});
  `;
  const child=spawn(process.execPath,["--input-type=module","-e",source,f.sqlitePath,
    f.managedRoot,JSON.stringify(request)],{stdio:["ignore","ignore","pipe","ipc"]});
  let stderr="";
  child.stderr.on("data",chunk=>{stderr+=chunk;});
  const exited=new Promise(resolve=>child.once("exit",resolve));
  t.after(async()=>{if(child.exitCode===null && child.signalCode===null) child.kill("SIGKILL");await exited;});
  let timer;
  const phase=await Promise.race([
    new Promise((resolve,reject)=>{
      child.once("message",resolve);
      child.once("error",reject);
      child.once("exit",()=>reject(new Error("child exited early: "+stderr)));
    }),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("child did not reach rollback commit")),10000);})
  ]).finally(()=>clearTimeout(timer));
  assert.deepEqual(phase,{phase:"sqlite_rolled_back"});
  child.kill("SIGKILL");
  await exited;
  const reopened=openDurableSessionStore({filePath:f.sqlitePath});
  f.stores.push(reopened);
  assert.equal(reopened.listProjectTransitionJournals()[0].stage,"sqlite_rolled_back");
  assert.deepEqual(reopened.load(f.scope).checkpoint,f.original);
  assert.deepEqual(JSON.parse(await readFile(f.pointers,"utf8")),candidate);
  const marker=await readFile(path.join(f.metadata,HOST_RECOVERY_FENCE_NAME));
  assert.match(await readFile(path.join(f.metadata,"published.lock"),"utf8"),/teamforge-process-bound-lock/u,
    "the killed owner left its lock file behind");
  if(process.platform!=="linux"){
    // No crash-released OS mutex here: the leftover lock stays ambiguous.
    await assert.rejects(rollbackOfflineHostTransition({store:reopened,managedRoot:f.managedRoot,request}),
      {code:"published_pointer_busy"});
    // Test-only explicit acknowledgement: this test owns the dead process
    // and isolated temporary root. Never do this automatically in production.
    await rm(path.join(f.metadata,"published.lock"));
  }
  // On Linux the lock is process-bound (#660): its recorded owner provably
  // exited, so the retry replaces it without any manual removal.
  const retry=await rollbackOfflineHostTransition({store:reopened,managedRoot:f.managedRoot,request});
  assert.equal(retry.sqliteReplayed,true);
  assert.equal(retry.hostPointerChanged,true);
  assert.equal(JSON.parse(await readFile(f.pointers,"utf8")).descriptorHash,f.prior.descriptor.descriptorHash);
  assert.deepEqual(await readFile(path.join(f.metadata,HOST_RECOVERY_FENCE_NAME)),marker);
});
