#!/usr/bin/env node
// Physical Windows Host Unity EditMode vs remote real-LAN Node authority peer.
// This is stronger than a loopback CI test, but NOT two Unity Editors or packaged Launcher proof.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import { isIP } from "node:net";
import { hostname, networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const scenarios=Object.freeze({
  authority:{
    test:"EunSung.TeamForge.Tests.TeamForgeRealServerE2ETests.RealServer_RealObjectLockHandoffAndTransformAuthorityRoundTrip",
    required:["peer-ready.json","peer-saw-unity.json","peer-target.json",
      "peer-saw-unity-transform-before-takeover.json","peer-applied-transform.json",
      "peer-saw-unity-transform-after-takeover.json"],
  },
  contention:{
    test:"EunSung.TeamForge.Tests.TeamForgeLockContentionE2ETests.RemoteLock_BlocksTransformAndHierarchyThrash_ThenRecoversCleanly",
    required:["peer-ready.json","peer-target.json","peer-authoritative-transform.json",
      "peer-release.json","peer-saw-unity-recovery-transform.json"],
  },
});
function fail(code){throw Object.assign(new Error(code),{code});}
function head(){
  try {
    const result=execFileSync("git",["rev-parse","--verify","HEAD"],{
      cwd:repoRoot,encoding:"utf8",timeout:10000,windowsHide:true,stdio:["ignore","pipe","ignore"],
    }).trim();
    if(/^[0-9a-f]{40}$/u.test(result))return result;
  }catch{}
  fail("source_head_unavailable");
}
export function parseConfig(env=process.env,ips=networkInterfaces()){
  const ssh=env.TEAMFORGE_FIELD_GUEST_SSH??"",ipv4=env.TEAMFORGE_FIELD_HOST_IPV4??"",
    script=env.TEAMFORGE_FIELD_GUEST_REALTIME_SCRIPT??"",
    unity=env.TEAMFORGE_FIELD_UNITY_EDITOR??"";
  if(!ssh||!ipv4||!script||!unity)fail("field_environment_missing");
  if(!/^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$/u.test(ssh))fail("invalid_ssh_target");
  if(!/^[A-Za-z]:\/[A-Za-z0-9_./-]+\.mjs$/u.test(script)||script.includes(".."))
    fail("invalid_guest_script");
  if(isIP(ipv4)!==4||ipv4.startsWith("127.")||ipv4==="0.0.0.0")fail("invalid_host_ipv4");
  if(!Object.values(ips).flat().filter(Boolean).some(x=>
    x.family==="IPv4"&&!x.internal&&x.address===ipv4))fail("host_ipv4_not_local");
  if(!path.win32.isAbsolute(unity)||path.win32.basename(unity).toLowerCase()!=="unity.exe")fail("invalid_unity_editor");
  return {ssh,ipv4,script,unity};
}
export function readNunitResult(xml){
  const match=xml.match(/<test-run\b([^>]*)>/u);
  if(!match)fail("unity_test_result_missing");
  const attrs=Object.fromEntries([...match[1].matchAll(/([a-zA-Z]+)="([^"]*)"/gu)].map(v=>[v[1],v[2]]));
  for(const name of ["result","total","passed","failed","skipped","inconclusive"])
    if(!(name in attrs))fail("unity_test_result_invalid");
  const count=Object.fromEntries(["total","passed","failed","skipped","inconclusive"].map(k=>[k,Number(attrs[k])]));
  if(Object.values(count).some(v=>!Number.isSafeInteger(v)||v<0))fail("unity_test_result_invalid");
  if(count.total!==1||count.passed!==1||count.failed!==0||count.skipped!==0||
    count.inconclusive!==0||attrs.result!=="Passed")fail("unity_field_assertions_failed");
  return {result:"Passed",...count};
}
function session(config,mode,frame){
  const child=spawn("ssh",["-T","-o","BatchMode=yes","-o","StrictHostKeyChecking=yes",
    "-o","ConnectTimeout=15",config.ssh,"node",config.script],{
    shell:false,windowsHide:true,stdio:["pipe","pipe","pipe"],
  });
  let pending="",outputBytes=0,done=false,ready=false,machine=null,final=null;
  const events=new Set();
  let readyResolve,readyReject,exitResolve,exitReject;
  const readyPromise=new Promise((r,j)=>{readyResolve=r;readyReject=j;});
  const exitPromise=new Promise((r,j)=>{exitResolve=r;exitReject=j;});
  // Handle rejection synchronously even when startup fails before caller awaits close.
  exitPromise.catch(()=>{});
  const startup=setTimeout(()=>readyReject(failObject("guest_ready_timeout")),30000);
  const failAll=e=>{
    clearTimeout(startup);
    if(!done){done=true;readyReject(e);exitReject(e);}
  };
  child.on("error",e=>failAll(failObject(e?.code??"ssh_spawn_failed")));
  child.stdin.on("error",()=>{});
  child.stderr.resume(); // never write remote stderr to public evidence
  child.stdout.setEncoding("utf8");
  child.stdout.on("data",chunk=>{
    outputBytes+=Buffer.byteLength(chunk,"utf8");
    if(outputBytes>131072){child.kill();failAll(failObject("guest_output_limit"));return;}
    pending+=chunk;
    let index;
    while((index=pending.indexOf("\n"))!==-1){
      const line=pending.slice(0,index).trim();pending=pending.slice(index+1);
      if(line.startsWith("TF_FIELD_MACHINE ")){
        try{
          machine=JSON.parse(line.slice(17));
          if(machine.head!==frame.head||
            machine.name?.toLowerCase()===frame.hostName.toLowerCase()||
            machine.mode!==mode)throw Error("mismatch");
        }catch{child.kill();failAll(failObject("guest_machine_identity_mismatch"));}
      }else if(line.startsWith("TF_FIELD_EVENT ")){
        const name=line.slice(15);
        if(/^[a-z0-9-]+\.json$/u.test(name))events.add(name);
        if(machine&&events.has("peer-ready.json")&&!ready){
          ready=true;clearTimeout(startup);readyResolve();
        }
      }else if(line.startsWith("TF_FIELD_FINAL ")){
        try{final=JSON.parse(line.slice(15));}catch{final={complete:false,code:"invalid_guest_final"};}
      }
    }
  });
  child.on("close",code=>{
    clearTimeout(startup);
    if(done)return;
    done=true;
    if(!ready)readyReject(failObject("guest_exited_before_ready"));
    if(code!==0||!final?.complete)return exitReject(failObject(final?.code??"guest_peer_failed"));
    if(!machine||machine.head!==frame.head||!scenarios[mode].required.every(k=>events.has(k))||
      !scenarios[mode].required.every(k=>final.evidenceFiles?.includes(k))||
      events.has("unexpected-unity-transform-during-peer-lock.json")){
      exitReject(failObject("guest_evidence_incomplete"));return;
    }
    exitResolve({name:machine.name,events:[...events].sort()});
  });
  child.stdin.write(JSON.stringify(frame)+"\n");
  return {ready:readyPromise,finish:async()=>{
    if(!child.stdin.destroyed)child.stdin.end();
    const timer=setTimeout(()=>child.kill(),12000);
    try{return await exitPromise;}finally{clearTimeout(timer);}
  },kill:()=>{child.kill();},child};
}
function failObject(code){return Object.assign(new Error(code),{code});}
async function runUnity(editor,mode,httpPort,token,dir){
  if(!fs.existsSync(editor))fail("unity_editor_missing");
  const scene=scenarios[mode],testResults=path.join(dir,"unity-"+mode+".xml"),
    logFile=path.join(dir,"unity-"+mode+".log");
  for(const file of [testResults,logFile])fs.rmSync(file,{force:true});
  const args=["-batchmode","-nographics","-projectPath",path.join(repoRoot,"unity-project"),
    "-runTests","-testPlatform","EditMode","-testFilter",scene.test,
    "-testResults",testResults,"-logFile",logFile,"-teamforgeFieldE2E"];
  const child=spawn(editor,args,{shell:false,windowsHide:true,
    env:{...process.env,
      TEAMFORGE_FIELD_SERVER_HTTP:"http://127.0.0.1:"+httpPort,
      TEAMFORGE_FIELD_AUTH_TOKEN:token},
    stdio:"ignore"});
  let spawned=false;
  const exit=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(failObject("unity_timeout"));},420000);
    child.once("spawn",()=>{spawned=true;});
    child.once("error",e=>{clearTimeout(timer);reject(failObject(e?.code??"unity_spawn_failed"));});
    child.once("close",code=>{clearTimeout(timer);resolve(code);});
  });
  if(!spawned||exit!==0)fail("unity_process_failed");
  if(!fs.existsSync(testResults))fail("unity_result_file_missing");
  return readNunitResult(fs.readFileSync(testResults,"utf8"));
}
async function runOne(config,mode,dir){
  const token=randomBytes(32).toString("base64url"),id=head();
  const {createTeamForgeServer}=await import("../server/src/teamforge-server.mjs");
  const coordinator=createTeamForgeServer({host:"0.0.0.0",port:0,authToken:token});
  let guest;
  try{
    const bind=await coordinator.start();
    const frame={version:1,mode,head:id,hostName:hostname(),token,
      endpoint:"ws://"+config.ipv4+":"+bind.port+"/ws"};
    guest=session(config,mode,frame);
    await guest.ready;
    const unity=await runUnity(config.unity,mode,bind.port,token,dir);
    const evidence=await guest.finish();
    return {mode,status:"passed",unity,evidenceFiles:evidence.events,
      physicalGuestName:evidence.name,coordinatorPort:bind.port};
  }finally{
    if(guest){
      try{await guest.finish();}catch{guest.kill();}
    }
    await coordinator.stop();
  }
}
async function main(){
  if(process.platform!=="win32")fail("windows_host_required");
  const config=parseConfig(),root=path.join(repoRoot,"test-results","field-realtime");
  fs.mkdirSync(root,{recursive:true});
  const dir=path.join(root,new Date().toISOString().replace(/[-:.]/gu,"")+"-"+randomUUID());
  fs.mkdirSync(dir,{recursive:true});
  const results=[],started=new Date().toISOString();
  let status="passed",error=null;
  try{
    for(const mode of Object.keys(scenarios)){
      // Stop on the first failed exact scenario, never report later lanes as PASS.
      results.push(await runOne(config,mode,dir));
    }
  }catch(e){status="failed";error=e?.code??"field_realtime_failed";process.exitCode=1;}
  const summary={schemaVersion:1,scenario:"field-realtime-two-pc",
    sourceHead:head(),status,startedAtUtc:started,endedAtUtc:new Date().toISOString(),
    scope:"Host Windows Unity EditMode vs physical remote Node peer over authenticated LAN",
    fieldGateComplete:false,physicalGuestUnityEditor:false,packagedLauncher:false,
    results,error};
  fs.writeFileSync(path.join(dir,"summary.json"),JSON.stringify(summary,null,2)+"\n");
  console.log("Two-PC Unity-vs-Node realtime E2E: "+status.toUpperCase());
  if(error)console.log("Stable failure: "+error);
  console.log("Local evidence: "+path.relative(repoRoot,dir));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(e=>{console.error("Field harness startup failed: "+(e?.code??"startup_failed"));process.exitCode=1;});
}
