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
  assert.equal(barrier.matchesOffline(result.ticket,baseline.descriptorHash),true);
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

test("online editor pause requires every registered Editor cursor; only all ACKs make in-process freeze ready",()=>{
  const barrier=new ProjectTransitionQuiescence();
  const now=Date.now();
  const editors=["a","b"].map((connectionId,i)=>({connectionId,sessionId:"scene-session",
    authorityEpoch:`00000000-0000-4000-8000-00000000000${i}`,
    durableSessionId:"11111111-1111-4111-8111-111111111111",serverRevision:10}));
  const input={...request(),editors,sessionMemberCount:2,nowUnixMs:now};
  const opening=barrier.beginOnlinePause(input);
  assert.ok(opening.pauseId && opening.ticket);
  assert.equal(barrier.isFrozen(projectId),true);
  assert.equal(barrier.matches(opening.ticket,baseline.descriptorHash),false,
    "A pause request is not yet an Editor ACK or a freeze authority ticket.");
  assert.equal(barrier.beginSourceAdmission(projectId),null);
  assert.deepEqual(barrier.beginOfflineFreeze(request()),{error:"project_transition_already_frozen"});
  const ack=(editor,i,override={})=>barrier.acknowledgeOnlinePause({
    projectId,connectionId:editor.connectionId,pauseId:opening.pauseId,status:"ready",
    serverRevision:editor.serverRevision,authorityEpoch:editor.authorityEpoch,
    durableSessionId:editor.durableSessionId,nowUnixMs:now+i,...override});
  assert.deepEqual(ack(editors[0],1),{accepted:true,ready:false,confirmedCount:1,expectedCount:2});
  assert.equal(barrier.matches(opening.ticket,baseline.descriptorHash),false);
  assert.deepEqual(ack(editors[0],2),{error:"project_transition_pause_unexpected_ack"});
  assert.deepEqual(ack(editors[1],3),{accepted:true,ready:true,confirmedCount:2,expectedCount:2});
  assert.equal(barrier.matches(opening.ticket,baseline.descriptorHash),true);
  assert.equal(barrier.matchesOffline(opening.ticket,baseline.descriptorHash),false,
    "An online Editor ACK must never impersonate an offline zero-Editor freeze.");
  const state=barrier.onlineStatus(projectId,opening.pauseId,now+4);
  assert.equal(state.ready,true);
  assert.equal(state.ticket,opening.ticket);
  assert.equal(barrier.cancelOnlinePause(projectId,"wrong-pause"),false);
  assert.equal(barrier.cancelOnlinePause(projectId,opening.pauseId),true);
  assert.equal(barrier.matches(opening.ticket,baseline.descriptorHash),false);
  assert.equal(barrier.isFrozen(projectId),false);
});

test("online editor pause fails closed for missing capability roster, concurrent source reads, busy/stale ACK, disconnect and expiry",()=>{
  const now=Date.now();
  const editor={connectionId:"first-editor",sessionId:"work",
    authorityEpoch:"00000000-0000-4000-8000-000000000001",
    durableSessionId:"11111111-1111-4111-8111-111111111111",serverRevision:2};
  const input={...request(),editors:[editor],sessionMemberCount:1,nowUnixMs:now};
  for(const changed of [{editors:[]},{sessionMemberCount:2},{activeLockCount:1},
      {editors:[editor,{...editor}]},{editors:[{...editor,authorityEpoch:"bad"}]}]) {
    const barrier=new ProjectTransitionQuiescence();
    assert.ok(barrier.beginOnlinePause({...input,...changed}).error);
    assert.equal(barrier.isFrozen(projectId),false);
  }
  for(const changed of [{status:"busy"},{status:"ready",serverRevision:3},
      {status:"ready",authorityEpoch:"wrong"}]) {
    const barrier=new ProjectTransitionQuiescence();
    const opened=barrier.beginOnlinePause(input);
    const response=barrier.acknowledgeOnlinePause({projectId,connectionId:editor.connectionId,
      pauseId:opened.pauseId,serverRevision:editor.serverRevision,
      authorityEpoch:editor.authorityEpoch,durableSessionId:editor.durableSessionId,
      nowUnixMs:now+1,...changed});
    assert.ok(response.aborted);
    assert.equal(barrier.isFrozen(projectId),false);
  }
  const barrier=new ProjectTransitionQuiescence();
  const release=barrier.beginSourceAdmission(projectId);
  assert.deepEqual(barrier.beginOnlinePause(input),{error:"project_transition_not_quiescent"});
  release();
  const opened=barrier.beginOnlinePause(input);
  assert.equal(barrier.onlineConnectionLost(projectId,"outside"),null);
  assert.deepEqual(barrier.onlineConnectionLost(projectId,editor.connectionId),
    {error:"project_transition_editor_disconnected",pauseId:opened.pauseId});
  assert.equal(barrier.isFrozen(projectId),false);
  const renewed=barrier.beginOnlinePause(input);
  assert.equal(barrier.onlineStatus(projectId,renewed.pauseId,now+15_001).expired,true);
  assert.equal(barrier.isFrozen(projectId),false);
  const third=barrier.beginOnlinePause(input);
  assert.deepEqual(barrier.expiredOnlinePauses(now+15_001),[{projectId,pauseId:third.pauseId}]);
  assert.equal(barrier.isFrozen(projectId),false);
});
