import assert from "node:assert/strict";
import test from "node:test";
import { createSessionState, makeSessionKey } from "../src/session-authority.mjs";
import { captureProjectTransitionSessions, sameProjectTransitionSessions }
  from "../src/project-transition-preflight.mjs";

const projectId = "shared-project";
const projectUuid = "11111111-2222-4333-8444-555555555555";
const baseline = {projectUuid,baselineRevision:1,manifestHash:"a".repeat(64),
  descriptorHash:"b".repeat(64)};

function fixture() {
  const active = createSessionState();
  active.revision = 5;
  active.durableEpoch = "active-epoch";
  active.durableLineageId = "active-lineage";
  const hierarchyOnly = createSessionState();
  hierarchyOnly.revision = 2;
  hierarchyOnly.durableEpoch = "hierarchy-epoch";
  hierarchyOnly.durableLineageId = "hierarchy-lineage";
  const activeKey = makeSessionKey(projectId,"with-collider");
  const hierarchyKey = makeSessionKey(projectId,"with-hierarchy-only");
  const authority = {sessions:new Map([[activeKey,active],[hierarchyKey,hierarchyOnly]])};
  const scope = sessionId => ({projectId,projectUuid,sessionId});
  const durable = {checkpoints:new Map([
    [activeKey,{scope:scope("with-collider"),revision:5}],
    [hierarchyKey,{scope:scope("with-hierarchy-only"),revision:2}],
  ])};
  const components = {ledgers:new Map([[active,{
    pin:{projectId,...baseline},sceneId:"1234",epoch:"component-epoch",
  }]])};
  const capture = () => captureProjectTransitionSessions({authority,durable,components,
    projectId,projectUuid,baseline});
  return {active,hierarchyOnly,activeKey,hierarchyKey,authority,durable,components,capture};
}

test("M4->M5 snapshot covers Collider and independent durable Transform/Hierarchy Sessions", () => {
  const f = fixture();
  const first = f.capture();
  assert.ok(first);
  assert.equal(first.sessions.size,2);
  assert.equal(first.ledgers.size,1);
  assert.equal(first.checkpoints.size,2);
  assert.equal(sameProjectTransitionSessions(first,f.capture()),true);
  const unrelated = createSessionState();
  f.authority.sessions.set(makeSessionKey("another-project","another-session"),unrelated);
  assert.equal(sameProjectTransitionSessions(first,f.capture()),true,
    "An unrelated Project's changes do not invalidate this Project's preview.");
});

test("M4->M5 snapshot rejects changed saved revision, connection, lease, epoch and checkpoint", () => {
  for (const mutate of [
    f => { f.hierarchyOnly.revision++; },
    f => { f.hierarchyOnly.members.set("editor",{connectionId:"reconnected"}); },
    f => {
      f.hierarchyOnly.members.set("editor",{connectionId:"original"});
      const previous = f.capture();
      f.hierarchyOnly.members.set("editor",{connectionId:"replacement"});
      assert.equal(sameProjectTransitionSessions(previous,f.capture()),false,
        "Replacing a member with the same user ID and count still invalidates the review.");
    },
    f => { f.hierarchyOnly.locks.set("scene/object", {ownerConnectionId:"editor",expiresAtUnixMs:999}); },
    f => { f.hierarchyOnly.durableEpoch = "replacement-epoch"; },
    f => { f.hierarchyOnly.durableLineageId = "replacement-lineage"; },
    f => { f.durable.checkpoints.get(f.hierarchyKey).revision++; },
    f => { f.authority.sessions.delete(f.hierarchyKey); },
    f => { f.authority.sessions.set(makeSessionKey(projectId,"new-session"),createSessionState()); },
    f => { f.components.ledgers.get(f.active).epoch="replacement-component-epoch"; },
    f => { f.components.ledgers.delete(f.active); },
  ]) {
    const f = fixture();
    const first = f.capture();
    mutate(f);
    assert.equal(sameProjectTransitionSessions(first,f.capture()),false,
      `A modified M4 generation cannot yield a current-looking M5 preview: ${mutate}`);
  }
});

test("M4->M5 snapshot refuses orphaned persisted checkpoint and wrong retained Collider source", () => {
  const f = fixture();
  f.durable.checkpoints.get(f.hierarchyKey).scope.projectUuid = "00000000-0000-0000-0000-000000000000";
  assert.equal(f.capture(),null);
  const other = fixture();
  other.components.ledgers.get(other.active).pin.descriptorHash = "f".repeat(64);
  assert.equal(other.capture(),null);
  const wrongCursor = fixture();
  wrongCursor.durable.checkpoints.get(wrongCursor.hierarchyKey).scope.sessionId = "wrong-session";
  assert.equal(wrongCursor.capture(),null);
  const cursorLag = fixture();
  cursorLag.durable.checkpoints.get(cursorLag.hierarchyKey).revision = 1;
  assert.equal(cursorLag.capture(),null);
  const third = fixture();
  third.components.ledgers.set(createSessionState(),{
    pin:{projectId,...baseline},sceneId:"orphan",epoch:"old",
  });
  assert.equal(third.capture(),null);
});
