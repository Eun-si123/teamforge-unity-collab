import assert from "node:assert/strict";
import {mkdir,writeFile,readFile,stat} from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";
import test from "node:test";
import {ProjectPeerEngine} from "../src/project-peer.mjs";
import {HOST_RECOVERY_FENCE_NAME,withPublishedPointerLock}
  from "../src/published-pointer-lock.mjs";
import {temporaryRoot,cleanup} from "./helpers.mjs";

test("Host recovery marker refuses new seed, publish validation, descriptor repair and sync before touching pointers",async t=>{
  const managedRoot=await temporaryRoot("teamforge-host-recovery-fence-");
  t.after(()=>cleanup(managedRoot));
  const engine=new ProjectPeerEngine({managedRoot});
  const projectId="recovery-fence-project";
  const projectUuid=randomUUID();
  const project=await engine.ensureProject({projectId,projectUuid});
  const metadata=engine.metadataRoot(projectUuid);
  await mkdir(metadata,{recursive:true});
  const marker=path.join(metadata,HOST_RECOVERY_FENCE_NAME);
  // A damaged marker also fences the normal path; it cannot be treated as absent.
  await writeFile(marker,"{damaged recovery marker");
  const refusal={code:"host_transition_recovery_required"};
  await assert.rejects(engine.startSeed({publication:{project}}),refusal);
  await assert.rejects(engine.validatePublishBase({projectId,source:{project},coordinatorBaseline:null}),refusal);
  await assert.rejects(engine.repairSourceDescriptor({projectId,source:{project},
    coordinatorBaseline:{projectUuid}}),refusal);
  await assert.rejects(engine.syncFromSnapshot({projectId,snapshot:{baseline:{projectUuid},peers:[]}}),refusal);
  await assert.rejects(stat(engine.publishedPointerPath(projectUuid)),{code:"ENOENT"});
  assert.equal(await readFile(marker,"utf8"),"{damaged recovery marker");
});

test("shared published pointer lock fails closed instead of replacing an existing lock",async t=>{
  const root=await temporaryRoot("teamforge-shared-published-lock-");
  t.after(()=>cleanup(root));
  const lock=path.join(root,"published.lock");
  await writeFile(lock,"existing owner");
  let attempted=false;
  await assert.rejects(withPublishedPointerLock(root,()=>{attempted=true;}),
    {code:"published_pointer_busy"});
  assert.equal(attempted,false);
  assert.equal(await readFile(lock,"utf8"),"existing owner");
});
