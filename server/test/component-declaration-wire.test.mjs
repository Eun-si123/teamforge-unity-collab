import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import { createTeamForgeServer } from "../src/teamforge-server.mjs";

const logger = { info() {}, warn() {}, error() {} };
const sceneId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const objectId = `GlobalObjectId_V1-2-${sceneId}-10-0`;
const componentId = `GlobalObjectId_V1-2-${sceneId}-20-0`;
const typeName = "UnityEngine.BoxCollider";
const vec = (x,y,z) => ({x,y,z});
const rotation = {x:0,y:0,z:0,w:1};
const sessionId = "wp6-seed-wire";
function hello(userId = "editor-a", extra = {}) {
  return {
    type:"hello",protocolVersion:1,requestId:"hello-"+userId,
    userId,userName:userId,userColor:"#00AABB",
    projectId:"wp6-project",sessionId,
    supportsPresence:true,supportsTransformSync:true,supportsHierarchySync:true,
    supportsComponentRecoveryPreview:true,
    supportsComponentDeclarationPreview: true,...extra,
  };
}
function declaration(extra = {}) {
  return {
    type:"component_declaration_preview_seed",protocolVersion:1,
    requestId:"seed-one", userId:"editor-a",
    sceneId,baseRevision:0,objectId,componentId,typeName,sceneDirty:false,
    properties:[
      {propertyPath:"m_IsTrigger",valueKind:"boolean",value:false},
      {propertyPath:"m_Center",valueKind:"vector3",value:vec(0,0,0)},
      {propertyPath:"m_Size",valueKind:"vector3",value:vec(1,1,1)},
    ],
    ...extra,
  };
}
async function withServer(flags, fn) {
  const app = createTeamForgeServer({
    host:"127.0.0.1", port:0, logger,
    enableComponentRecoveryPreview:flags.recovery,
    enableComponentDeclarationPreview:flags.declaration,
  });
  const endpoint = await app.start();
  const sockets = [];
  async function connect() {
    const socket = new WebSocket(`ws://127.0.0.1:${endpoint.port}${endpoint.wsPath}`);
    sockets.push(socket);
    const received = [], waiters = [], trace = [];
    socket.on("close", code => trace.push("closed:" + code));
    socket.on("message", bytes => {
      const item = JSON.parse(bytes.toString("utf8"));
      trace.push("recv:" + item.type + (item.code ? ":" + item.code : ""));
      const waiter = waiters.shift();
      if (waiter) { clearTimeout(waiter.timer); waiter.resolve(item); }
      else received.push(item);
    });
    await new Promise((resolve,reject) => {
      const timer = setTimeout(() => reject(new Error("WebSocket connection timeout")), 2000);
      socket.once("open",() => {clearTimeout(timer);resolve();});
      socket.once("error",error => {clearTimeout(timer);reject(error);});
    });
    return {
      send(value) {
        trace.push("sent:" + value.type);
        socket.send(JSON.stringify(value));
      },
      close() { socket.terminate(); },
      next() {
        if (received.length) return Promise.resolve(received.shift());
        return new Promise((resolve,reject) => {
          const w={resolve,timer:setTimeout(() => {
            const i=waiters.indexOf(w);
            if(i>=0)waiters.splice(i,1);
            reject(new Error("No WebSocket response: " + trace.slice(-16).join(", ")));
          },2000)};
          waiters.push(w);
        });
      },
    };
  }
  try { await fn(connect); }
  finally { sockets.forEach(s=>s.terminate());await app.stop(); }
}
async function register(connect, user="editor-a", extra={}) {
  const ws = await connect();
  ws.send(hello(user,extra));
  const ack=await ws.next();
  assert.equal(ack.type,"hello_ack");
  assert.equal((await ws.next()).type,"presence_snapshot");
  assert.equal((await ws.next()).type,"hierarchy_snapshot");
  assert.equal((await ws.next()).type,"transform_snapshot");
  return {ws,ack};
}
async function readyOwner(ws, includeLock=true) {
  ws.send({
    type:"hierarchy_seed",protocolVersion:1,requestId:"scene",
    userId:"editor-a",sceneId,baseRevision:0,
    objects:[{
      objectId,name:"SavedCollider",parentObjectId:"",siblingIndex:0,
      localPosition:vec(0,0,0),localRotation:rotation,localScale:vec(1,1,1),
    }],
  });
  assert.equal((await ws.next()).type,"hierarchy_seed_accepted");
  if(includeLock){
    ws.send({
      type:"lock_request",protocolVersion:1,requestId:"lock",
      userId:"editor-a",sceneId,objectId,
    });
    assert.equal((await ws.next()).type,"lock_granted");
    // lock_state_changed is broadcast to OTHER members only, not the owner.
  }
}
const request = () => ({
  type:"component_recovery_preview_request",protocolVersion:1,
  requestId:"read",sceneId,knownRevision:0,knownFingerprint:"",
});

test("WP6 real WebSocket records a single first-Editor Collider declaration and exposes only an opted-in read-only observation",async()=>{
  await withServer({recovery:true,declaration:true},async connect=>{
    const {ws,ack}=await register(connect);
    assert.equal(ack.componentRecoveryPreviewEnabled,true);
    assert.equal(ack.componentDeclarationPreviewEnabled,true);
    await readyOwner(ws);
    ws.send(declaration());
    const accepted=await ws.next();
    assert.equal(accepted.type,"component_declaration_preview_accepted");
    assert.equal(accepted.status,"first_editor_declaration_recorded_unverified");
    assert.equal(accepted.recordedProperties,3);
    assert.equal(accepted.serverRevision,0);
    ws.send(request());
    const observed=await ws.next();
    assert.equal(observed.type,"component_recovery_preview");
    assert.equal(observed.status,"local_preview_resnapshot");
    assert.equal(observed.observedProperties.length,3);
    assert.deepEqual(
      observed.observedProperties.map(x=>x.propertyPath).sort(),
      ["m_Center","m_IsTrigger","m_Size"],
    );
    const {ws:guest,ack:guestAck}=await register(connect,"editor-b",{
      supportsComponentDeclarationPreview:false,
    });
    assert.equal(guestAck.componentRecoveryPreviewEnabled,true);
    assert.equal(guestAck.componentDeclarationPreviewEnabled,undefined);
    guest.send(request());
    const late=await guest.next();
    assert.equal(late.status,"local_preview_resnapshot");
    assert.equal(late.fingerprint,observed.fingerprint);
    ws.send(declaration({requestId:"seed-again"}));
    // Guest Presence is broadcast to the original Editor before its error.
    assert.equal((await ws.next()).type,"user_joined");
    const denied=await ws.next();
    assert.equal(denied.code,"component_declaration_owner_required");
    // Neither a legacy client nor a read-only observer can mutate property state.
    guest.send({type:"component_property_update",protocolVersion:1,requestId:"bad-write"});
    assert.equal((await guest.next()).code,"unsupported_message");
  });
});

test("WP6 declaration requires two independent server flags and an explicit client opt-in",async()=>{
  for(const flags of [
    {recovery:false,declaration:true},
    {recovery:true,declaration:false},
  ]){
    await withServer(flags,async connect=>{
      const {ws,ack}=await register(connect);
      assert.equal(ack.componentDeclarationPreviewEnabled,false);
      ws.send(declaration());
      assert.equal((await ws.next()).code,"unsupported_message");
    });
  }
  await withServer({recovery:true,declaration:true},async connect=>{
    const {ws,ack}=await register(connect,"editor-a",{
      supportsComponentDeclarationPreview:false,
    });
    assert.equal(ack.componentDeclarationPreviewEnabled,undefined);
    await readyOwner(ws);
    ws.send(declaration());
    assert.equal((await ws.next()).code,"unsupported_message");
  });
});

test("WP6 missing saved Scene/lock or non-pristine first member fails without installing any Collider observation",async()=>{
  await withServer({recovery:true,declaration:true},async connect=>{
    const {ws}=await register(connect);
    ws.send(declaration());
    assert.equal((await ws.next()).code,"component_declaration_hierarchy_missing");
    await readyOwner(ws,false);
    ws.send(declaration());
    assert.equal((await ws.next()).code,"component_declaration_lock_required");
    ws.send({type:"lock_request",protocolVersion:1,requestId:"lock",
      userId:"editor-a",sceneId,objectId});
    assert.equal((await ws.next()).type,"lock_granted");
    // lock_state_changed is broadcast to OTHER members only, not the owner.
    const badPackets=[
      declaration({sceneDirty:true}),
      declaration({componentId:componentId.replace(sceneId,"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")}),
      declaration({componentId:objectId}),
      declaration({typeName:"UnityEngine.MonoBehaviour"}),
      declaration({properties:declaration().properties.slice(1)}),
      declaration({properties:declaration().properties.map(x=>
        x.propertyPath==="m_Size" ? {...x,value:vec(-1,1,1)} : x)}),
      declaration({properties:declaration().properties.map(x=>
        x.propertyPath==="m_IsTrigger" ? {...x,valueKind:"int32",value:1} : x)}),
      declaration({properties:declaration().properties.map(x=>
        x.propertyPath==="m_Size" ? {...x,value:vec(999,1,1)} : x)}),
      declaration({userId:"forged"}),
      declaration({extraField:"attack"}),
    ];
    for(const bad of badPackets){
      ws.send(bad);
      const reply=await ws.next();
      assert.equal(reply.type,"error");
      assert.notEqual(reply.code,"component_transaction_already_seeded");
    }
    ws.send(request());
    assert.equal((await ws.next()).code,"component_transaction_unseeded");
  });
});

test("WP6 a second participating Editor permanently closes the initial declaration window",async()=>{
  await withServer({recovery:true,declaration:true},async connect=>{
    const {ws}=await register(connect);
    await readyOwner(ws);
    const {ws:survivor}=await register(connect,"editor-b");
    ws.send(declaration());
    // A broadcast user_joined arrives at the first Editor before its rejection.
    const joined=await ws.next();
    assert.equal(joined.type,"user_joined");
    assert.equal((await ws.next()).code,"component_declaration_owner_required");
    // Even if the original first Editor leaves, the remaining Editor must not
    // inherit the initial declaration authority merely from being alone.
    ws.close();
    assert.equal((await survivor.next()).type,"lock_released");
    assert.equal((await survivor.next()).type,"user_left");
    survivor.send(declaration({userId:"editor-b",requestId:"survivor-seed"}));
    assert.equal((await survivor.next()).code,"component_declaration_owner_required");
  });
});

const compare = (userId="editor-b", extra={})=> ({
  ...declaration(),
  type:"component_recovery_compare_request",
  requestId:"compare-"+userId,
  userId,
  ...extra,
});

test("WP6 late read-only Editor compares selected Collider against an unverified first-Editor declaration without applying changes",async()=>{
  await withServer({recovery:true,declaration:true},async connect=>{
    const {ws:owner}=await register(connect);
    await readyOwner(owner);
    owner.send(declaration());
    assert.equal((await owner.next()).status,"first_editor_declaration_recorded_unverified");
    const {ws:guest,ack}=await register(connect,"editor-b",{
      supportsComponentDeclarationPreview:false,
    });
    assert.equal(ack.componentRecoveryPreviewEnabled,true);
    assert.equal(ack.componentDeclarationPreviewEnabled,undefined);

    guest.send(compare());
    const equal=await guest.next();
    assert.equal(equal.type,"component_recovery_compare_result");
    assert.equal(equal.status,"observations_match");
    assert.equal(equal.comparedProperties,3);
    assert.deepEqual(equal.differingPaths,[]);
    assert.equal(equal.serverRevision,0);
    assert.equal(equal.observedProperties,undefined);
    assert.equal(equal.repair,undefined);

    const changed=declaration().properties.map(row =>
      row.propertyPath==="m_IsTrigger" ? {...row,value:true} : row);
    guest.send(compare("editor-b",{
      requestId:"compare-difference",properties:changed,
    }));
    const different=await guest.next();
    assert.equal(different.type,"component_recovery_compare_result");
    assert.equal(different.status,"observations_differ");
    assert.deepEqual(different.differingPaths,["m_IsTrigger"]);
    assert.equal(different.observedProperties,undefined);

    // A compare is read-only: original declaration remains untouched and no
    // Session revision/operation history is created by a late guest.
    owner.send(request());
    assert.equal((await owner.next()).type,"user_joined");
    const stillOriginal=await owner.next();
    assert.equal(stillOriginal.type,"component_recovery_preview");
    assert.equal(stillOriginal.serverRevision,0);
    assert.equal(stillOriginal.observedProperties.find(x =>
      x.propertyPath==="m_IsTrigger").value,false);
  });
});

test("WP6 comparison strictly refuses missing identity, extra fields, dirty Scene, invalid values and stale revision",async()=>{
  await withServer({recovery:true,declaration:true},async connect=>{
    const {ws:owner}=await register(connect);
    await readyOwner(owner);
    owner.send(declaration());
    assert.equal((await owner.next()).type,"component_declaration_preview_accepted");
    const {ws:guest}=await register(connect,"editor-b",{
      supportsComponentDeclarationPreview:false,
    });
    const missing=[
      compare("editor-b",{baseRevision:1}),
      compare("editor-b",{sceneDirty:true}),
      compare("editor-b",{componentId:objectId}),
      compare("editor-b",{componentId:`GlobalObjectId_V1-2-${sceneId}-21-0`}),
      compare("editor-b",{typeName:"UnityEngine.MonoBehaviour"}),
      compare("editor-b",{extraField:"forged"}),
      compare("editor-b",{properties:declaration().properties.slice(1)}),
      compare("editor-b",{properties:declaration().properties.map(row =>
        row.propertyPath==="m_Size" ? {...row,value:vec(-1,1,1)} : row)}),
      compare("editor-b",{properties:declaration().properties.map(row =>
        row.propertyPath==="m_Center" ? {...row,value:vec(101,0,0)} : row)}),
      compare("editor-b",{properties:declaration().properties.map(row =>
        row.propertyPath==="m_IsTrigger" ? {...row,valueKind:"float",value:1} : row)}),
      compare("editor-b",{properties:declaration().properties.map(row =>
        row.propertyPath==="m_IsTrigger" ? {...row,propertyPath:"m_Size"} : row)}),
      compare("editor-b",{userId:"editor-a"}),
    ];
    for(const candidate of missing){
      guest.send(candidate);
      const response=await guest.next();
      assert.equal(response.type,"error");
      assert.notEqual(response.code,"", "Malformed compare may never become an observation");
    }
    guest.send(compare());
    const still=await guest.next();
    assert.equal(still.status,"observations_match");
    assert.deepEqual(still.differingPaths,[]);
  });
});

test("WP6 comparison is denied to legacy/no-preview Hello and cannot seed a Component ledger",async()=>{
  await withServer({recovery:false,declaration:false},async connect=>{
    const {ws}=await register(connect,"editor-a",{
      supportsComponentRecoveryPreview:false,
      supportsComponentDeclarationPreview:false,
    });
    ws.send(compare("editor-a"));
    const refused=await ws.next();
    assert.equal(refused.code,"unsupported_message");
  });
  await withServer({recovery:true,declaration:false},async connect=>{
    const {ws}=await register(connect,"editor-a",{
      supportsComponentDeclarationPreview:false,
    });
    await readyOwner(ws,false);
    ws.send(compare("editor-a"));
    assert.equal((await ws.next()).code,"component_transaction_unseeded");
    ws.send(request());
    assert.equal((await ws.next()).code,"component_transaction_unseeded");
  });
});
