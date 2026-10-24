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
    const received = [], waiters = [];
    socket.on("message", bytes => {
      const item = JSON.parse(bytes.toString("utf8"));
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
      send(value) {socket.send(JSON.stringify(value));},
      next() {
        if (received.length) return Promise.resolve(received.shift());
        return new Promise((resolve,reject) => {
          const w={resolve,timer:setTimeout(() => {
            const i=waiters.indexOf(w);
            if(i>=0)waiters.splice(i,1);
            reject(new Error("No WebSocket response"));
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
    assert.equal((await ws.next()).type,"lock_state_changed");
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
    assert.equal((await ws.next()).type,"lock_state_changed");
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
    await register(connect,"editor-b",{supportsComponentDeclarationPreview:false});
    ws.send(declaration());
    // A broadcast user_joined arrives at the first Editor before its rejection.
    const joined=await ws.next();
    assert.equal(joined.type,"user_joined");
    assert.equal((await ws.next()).code,"component_declaration_owner_required");
  });
});
