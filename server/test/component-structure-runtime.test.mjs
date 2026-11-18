import assert from "node:assert/strict";
import test from "node:test";
import { createSessionState } from "../src/session-authority.mjs";
import { prepareComponentIdentityBaseline } from "../src/component-foundation.mjs";
import { prepareComponentPropertySnapshot } from "../src/component-property-foundation.mjs";
import { ComponentCollaboration } from "../src/component-collaboration.mjs";
import { seedComponentPropertyTransaction, activateComponentPropertyRuntime,
  activateComponentStructureRuntime, commitComponentStructureTransaction,
  readComponentPropertyTransaction } from "../src/component-property-transaction.mjs";

const sceneId="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const owner=`GlobalObjectId_V1-2-${sceneId}-10-0`;
const component=`GlobalObjectId_V1-2-${sceneId}-20-0`;
const type="UnityEngine.BoxCollider";
const actor={userId:"editor-a",connectionId:"conn-a",supportsComponentStructureSync:true};
const lockKey=JSON.stringify([sceneId,owner]);
const now=20000;
function fixture() {
  const session=createSessionState();session.revision=7;
  session.hierarchySceneIds.add(sceneId);
  session.hierarchyObjects.set(lockKey,{sceneId,objectId:owner,createdRevision:0});
  session.members.set(actor.userId,{connectionId:actor.connectionId});
  session.componentPropertyConnections=new Set([actor.connectionId]);
  session.locks.set(lockKey,{sceneId,objectId:owner,ownerUserId:actor.userId,
    ownerConnectionId:actor.connectionId,expiresAtUnixMs:now+1000});
  const policy={maxProperties:1536,allowedProperties:new Map([[type,new Map([
    ["m_IsTrigger",{kind:"boolean"}],["m_Center",{kind:"vector3",maximumAbsolute:100}],
    ["m_Size",{kind:"vector3",maximumAbsolute:100}],
  ])]])};
  const identity=prepareComponentIdentityBaseline(session,{sceneId,baseRevision:7,
    components:[{objectId:owner,componentId:component,typeName:type}]},
    {maxComponents:512,supportedTypes:new Set([type])});
  assert.equal(identity.error,undefined);
  const snapshot=prepareComponentPropertySnapshot(session,identity,{sceneId,baseRevision:7,properties:[
    {objectId:owner,componentId:component,typeName:type,propertyPath:"m_IsTrigger",valueKind:"boolean",value:false},
    {objectId:owner,componentId:component,typeName:type,propertyPath:"m_Center",valueKind:"vector3",value:{x:0,y:0,z:0}},
    {objectId:owner,componentId:component,typeName:type,propertyPath:"m_Size",valueKind:"vector3",value:{x:1,y:1,z:1}},
  ]},policy);
  assert.equal(seedComponentPropertyTransaction(session,identity,snapshot,policy).error,undefined);
  assert.equal(activateComponentPropertyRuntime(session),true);
  assert.equal(activateComponentStructureRuntime(session,[owner]),true);
  return session;
}
function add(overrides={}) {
  return {sceneId,objectId:owner,componentId:"tf:c:0123456789abcdef0123456789abcdef",typeName:type,
    baseRevision:7,kind:"add_component",expectedComponentRevision:0,compensatesOperationId:"",...overrides};
}

test("M2 runtime refuses malformed or expired owned leases before touching topology/history",()=>{
  const session=fixture(),before=readComponentPropertyTransaction(session);
  for(const expiry of [undefined,NaN,Infinity,now,now-1,now+0.5]) {
    session.locks.get(lockKey).expiresAtUnixMs=expiry;
    const result=commitComponentStructureTransaction(session,add(),"expired",actor,now);
    assert.equal(result.error,"component_structure_lock_required");
    assert.equal(session.revision,7);assert.equal(session.operations.size,0);
    assert.deepEqual(readComponentPropertyTransaction(session),before);
  }
});

test("M2 runtime projection refusal or exception cannot expose partial catalog/property writes",()=>{
  const session=fixture(),before=readComponentPropertyTransaction(session);
  const refused=commitComponentStructureTransaction(session,add(),"projection-refused",actor,now,
    projected=>{
      assert.equal(projected.components.length,2);assert.equal(projected.properties.length,6);
      return {error:"component_snapshot_size_limit",reason:"fixture budget"};
    });
  assert.equal(refused.error,"component_snapshot_size_limit");
  const failed=commitComponentStructureTransaction(session,add(),"projection-threw",actor,now,
    ()=>{throw new Error("fixture encoder failure");});
  assert.equal(failed.error,"component_snapshot_size_limit");
  assert.equal(session.revision,7);assert.equal(session.operations.size,0);
  assert.deepEqual(readComponentPropertyTransaction(session),before);
});

test("M2 new logical owner must originate in a committed Hierarchy revision, never a seed declaration",()=>{
  const session=fixture();
  const logicalOwner="tf:0123456789abcdef0123456789abcdef";
  const key=JSON.stringify([sceneId,logicalOwner]);
  session.hierarchyObjects.set(key,{sceneId,objectId:logicalOwner,createdRevision:0});
  session.locks.set(key,{sceneId,objectId:logicalOwner,ownerUserId:actor.userId,
    ownerConnectionId:actor.connectionId,expiresAtUnixMs:now+1000});
  assert.equal(commitComponentStructureTransaction(session,add({objectId:logicalOwner}),"forged-seed",actor,now).error,
    "component_structure_owner_unverified");
  session.hierarchyObjects.get(key).createdRevision=8;session.revision=8;
  const result=commitComponentStructureTransaction(session,add({objectId:logicalOwner,baseRevision:8}),"created-owner",actor,now);
  assert.equal(result.error,undefined);assert.equal(session.revision,9);
  assert.equal(readComponentPropertyTransaction(session).components.find(row=>row.componentId===add().componentId).objectId,logicalOwner);
});

test("M2 structural validator refuses accessors and scalar lookalikes without running caller code",()=>{
  const session=fixture(),before=readComponentPropertyTransaction(session);let reads=0;
  const getter={...add()};Object.defineProperty(getter,"objectId",{enumerable:true,get(){reads++;throw new Error("getter");}});
  const objectOwner={...add(),objectId:{toJSON(){reads++;throw new Error("coercion");}}};
  for(const intent of [getter,objectOwner,{...add(),baseRevision:{valueOf(){reads++;return 7;}}}]) {
    assert.equal(commitComponentStructureTransaction(session,intent,"inert-input",actor,now).error,"component_structure_invalid");
  }
  assert.equal(reads,0);assert.equal(session.revision,7);
  assert.deepEqual(readComponentPropertyTransaction(session),before);
});

test("M2 property float growth cannot commit across the structural recovery-envelope ceiling",()=>{
  const session=fixture();
  const collaboration=new ComponentCollaboration({coordinator:{},authority:{},managedRoot:"",
    maximumBytes:1024*1024,maximumOperations:256,enableStructure:true});
  const state={session,sceneId,epoch:"11111111-1111-4111-8111-111111111111",results:new Map(),
    source:{projectUuid:"315b1ce0-5da1-4336-83ba-8ad070f38231",baselineRevision:1,
      manifestHash:"a".repeat(64),descriptorHash:"b".repeat(64),scenePath:"Assets/Shared.unity",
      sceneFileSha256:"c".repeat(64),sceneMetaSha256:"d".repeat(64)}};
  // Isolate the actual commit encoder after a trusted seed. Real signed-source
  // membership/lease/reconnect boundaries are exercised by the WebSocket suite.
  collaboration.requireJoined=()=>({session,state});
  let low=1024,high=20000;
  while(low<high) {
    const middle=Math.floor((low+high)/2);collaboration.maximumBytes=middle;
    if(collaboration.snapshot(state).error) low=middle+1; else high=middle;
  }
  collaboration.maximumBytes=low;
  const before=collaboration.snapshot(state);
  assert.equal(before.error,undefined);
  const result=collaboration.commit(actor,{type:"component_property_set",protocolVersion:1,requestId:"growth",
    operationId:"growth-operation",epoch:state.epoch,sceneId,objectId:owner,componentId:component,typeName:type,
    propertyPath:"m_Center",valueKind:"vector3",value:{x:0.1234567,y:1.234567,z:9.876543},
    baseRevision:7,expectedRevision:7,expectedValue:{x:0,y:0,z:0},compensatesOperationId:""},now);
  assert.equal(result.error,"component_snapshot_size_limit");
  assert.equal(session.revision,7);assert.equal(session.operations.size,0);
  const recovered=collaboration.snapshot(state);
  assert.equal(recovered.error,undefined);
  assert.equal(recovered.snapshotHash,before.snapshotHash);
  assert.deepEqual(recovered.properties,before.properties);
});
