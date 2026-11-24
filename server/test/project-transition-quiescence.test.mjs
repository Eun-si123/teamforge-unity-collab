import assert from "node:assert/strict";
import test from "node:test";
import { ProjectTransitionQuiescence } from "../src/project-transition-quiescence.mjs";

const projectId="m4-project";
const baseline=Object.freeze({projectUuid:"a8bc5df4-a5ab-45d0-93a4-b83c1a1f5b1d",
  baselineRevision:1,manifestHash:"c".repeat(64),descriptorHash:"d".repeat(64),
  ownerKeyId:"e".repeat(64),ownerPublicKey:"test-public-key"});
const request=(changes={})=>({projectId,connectedClientCount:0,sessionMemberCount:0,
  activeLockCount:0,approvedBaseline:baseline,...changes});

test("M4->M5 offline quiescence requires no connected clients, Session members or locks",()=>{
  for(const changes of [
    {connectedClientCount:1},{connectedClientCount:9},
    {sessionMemberCount:1},{sessionMemberCount:2},
    {activeLockCount:1},{activeLockCount:10},
  ]) {
    const barrier=new ProjectTransitionQuiescence();
    assert.deepEqual(barrier.beginOfflineFreeze(request(changes)),
      {error:"project_transition_not_quiescent"});
    assert.equal(barrier.isFrozen(projectId),false);
  }
});

test("M4->M5 offline freeze refuses outstanding asynchronous signed source admissions and is project-scoped",()=>{
  const barrier=new ProjectTransitionQuiescence();
  const release1=barrier.beginSourceAdmission(projectId);
  const release2=barrier.beginSourceAdmission(projectId);
  const another=barrier.beginSourceAdmission("unrelated-project");
  assert.equal(barrier.pendingCount(projectId),2);
  assert.deepEqual(barrier.beginOfflineFreeze(request()),
    {error:"project_transition_not_quiescent"});
  assert.equal(release1(),true);
  assert.equal(release1(),false,"Repeated Promise completion must never consume another in-flight lease.");
  assert.equal(barrier.pendingCount(projectId),1);
  assert.deepEqual(barrier.beginOfflineFreeze(request()),
    {error:"project_transition_not_quiescent"});
  assert.equal(release2(),true);
  const result=barrier.beginOfflineFreeze(request());
  assert.ok(result.ticket);
  assert.equal(barrier.isFrozen(projectId),true);
  assert.equal(barrier.beginSourceAdmission(projectId),null);
  assert.equal(typeof barrier.beginSourceAdmission("unrelated-project"),"function",
    "A frozen Project must not suppress another Project's source inspection.");
  assert.equal(barrier.matches(result.ticket,baseline.descriptorHash),true);
  assert.equal(barrier.matches(result.ticket,"f".repeat(64)),false);
  assert.equal(barrier.release(Object.freeze({...result.ticket})),false,
    "A forged or copied ticket must not thaw the Project.");
  assert.equal(barrier.release(result.ticket),true);
  assert.equal(barrier.release(result.ticket),false);
  assert.equal(another(),true);
  barrier.clear();
});

test("M4->M5 offline freeze refuses unapproved Projects and malformed IDs without acquiring authority",()=>{
  const barrier=new ProjectTransitionQuiescence();
  for (const invalid of ["", " wrong", "x".repeat(129), "a\u0000b", "lone\uD800"]) {
    assert.deepEqual(barrier.beginOfflineFreeze(request({projectId:invalid})),
      {error:"project_transition_invalid_freeze"});
    assert.equal(barrier.beginSourceAdmission(invalid),null);
  }
  assert.deepEqual(barrier.beginOfflineFreeze(request({approvedBaseline:null})),
    {error:"project_transition_signed_baseline_required"});
  assert.deepEqual(barrier.beginOfflineFreeze(request({approvedBaseline:{...baseline,descriptorHash:"f"}})),
    {error:"project_transition_signed_baseline_required"});
  assert.deepEqual(barrier.beginOfflineFreeze(request({activeLockCount:-1})),
    {error:"project_transition_invalid_freeze"});
  const result=barrier.beginOfflineFreeze(request());
  assert.deepEqual(barrier.beginOfflineFreeze(request()),
    {error:"project_transition_already_frozen"});
  barrier.clear();
  assert.equal(barrier.isFrozen(projectId),false);
  assert.equal(barrier.release(result.ticket),false,
    "Process shutdown clears any stale uncommitted freeze ticket.");
});
