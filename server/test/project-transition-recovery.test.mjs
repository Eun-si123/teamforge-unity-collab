import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import {cp,mkdir,rm,writeFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {ChunkStore} from "../../project-peer/src/content-store.mjs";
import {PRODUCT_VERSION} from "../../project-peer/src/constants.mjs";
import {createDescriptor} from "../../project-peer/src/descriptor.mjs";
import {buildManifest} from "../../project-peer/src/manifest.mjs";
import {publicationFixture,temporaryRoot,cleanup} from "../../project-peer/test/helpers.mjs";
import {openDurableSessionStore} from "../src/durable-session-store.mjs";
import {DurableSessionRuntime} from "../src/durable-session-runtime.mjs";
import {inspectPendingProjectTransitions} from "../src/project-transition-recovery.mjs";

async function fixture(t,{deferCommit=false}={}) {
  const root=await temporaryRoot("teamforge-transition-recovery-");
  t.after(()=>cleanup(root));
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
  t.after(()=>store.close());
  const scope={projectId:prior.projectId,projectUuid:prior.projectUuid,sessionId:"saved-editor-session"};
  const oldEpoch=randomUUID(), nextEpoch=randomUUID(),lineage=randomUUID();
  const original={version:1,lineageId:lineage,project:prior.descriptor,
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
    store,scope,sqlitePath,original,migration};
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
  t.after(()=>runtime.close());
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
  t.after(()=>reopened.close());
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
