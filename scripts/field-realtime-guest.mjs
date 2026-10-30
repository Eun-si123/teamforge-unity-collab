#!/usr/bin/env node
// Physical-PC Guest adapter for existing, unmodified-in-purpose CI authority peers.
// A dedicated SSH login transports only startup configuration and filenames.
// Real collaboration messages travel directly over the Host LAN WebSocket.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { isIP } from "node:net";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const modes=Object.freeze({
  authority:"../server/scripts/ci-presence-peer.mjs",
  contention:"../server/scripts/ci-lock-contention-peer.mjs",
});
const required=Object.freeze({
  authority:["peer-ready.json","peer-saw-unity.json","peer-target.json",
    "peer-saw-unity-transform-before-takeover.json",
    "peer-applied-transform.json","peer-saw-unity-transform-after-takeover.json"],
  contention:["peer-ready.json","peer-target.json","peer-authoritative-transform.json",
    "peer-release.json","peer-saw-unity-recovery-transform.json"],
});
function fieldFailure(code){return Object.assign(new Error(code),{code});}
function sourceHead(){
  try {
    const sha=execFileSync("git",["rev-parse","--verify","HEAD"],{
      cwd:repoRoot,encoding:"utf8",timeout:10000,windowsHide:true,stdio:["ignore","pipe","ignore"],
    }).trim();
    if(/^[0-9a-f]{40}$/u.test(sha))return sha;
  }catch{}
  throw fieldFailure("source_head_unavailable");
}
export function validateFieldFrame(frame,localName=hostname(),head=sourceHead()){
  if(!frame||frame.version!==1||!Object.hasOwn(modes,frame.mode)||
    typeof frame.head!=="string"||frame.head!==head||
    typeof frame.hostName!=="string"||!frame.hostName.trim()||
    frame.hostName.toLowerCase()===localName.toLowerCase()||
    typeof frame.token!=="string"||frame.token.length<32||frame.token.length>512||
    !/^[A-Za-z0-9_-]+$/u.test(frame.token)){
    throw fieldFailure("field_peer_identity_mismatch");
  }
  let url;
  try{url=new URL(frame.endpoint);}catch{throw fieldFailure("invalid_realtime_endpoint");}
  if(url.protocol!=="ws:"||isIP(url.hostname)!==4||
    !url.port||url.pathname!=="/ws"||url.search||url.hash||url.username||url.password){
    throw fieldFailure("invalid_realtime_endpoint");
  }
  return frame;
}
const names=Object.values(required).flat();
function summarizeEvidence(mode,dir){
  const all=fs.readdirSync(dir);
  if(!required[mode].every(name=>all.includes(name))) throw fieldFailure("peer_evidence_incomplete");
  if(all.includes("unexpected-unity-transform-during-peer-lock.json")){
    throw fieldFailure("unauthorized_unity_transform");
  }
  for(const name of required[mode]){
    const data=JSON.parse(fs.readFileSync(path.join(dir,name),"utf8"));
    if(!data || typeof data!=="object" || Array.isArray(data))throw fieldFailure("peer_evidence_invalid");
  }
  return {complete:true,mode,evidenceFiles:required[mode]};
}
// The SSH control frame is a single bounded JSON line. Do not let readline
// buffer an unbounded unterminated line before enforcing the byte ceiling.
export function readGuestFrame(input){
  return new Promise((resolve,reject)=>{
    const chunks=[];
    let bytes=0,settled=false;
    function finish(error,frame){
      if(settled)return;
      settled=true;
      input.off("data",onData);
      input.off("end",onEnd);
      input.off("error",onError);
      if(error)reject(error);else resolve(frame);
    }
    function onData(raw){
      const chunk=Buffer.isBuffer(raw)?raw:Buffer.from(raw);
      const newline=chunk.indexOf(10);
      const part=newline<0?chunk:chunk.subarray(0,newline);
      if(bytes+part.length>4096)return finish(fieldFailure("field_frame_too_large"));
      bytes+=part.length;
      chunks.push(part);
      if(newline<0)return;
      if(newline!==chunk.length-1)return finish(fieldFailure("multiple_guest_frames"));
      let frame;
      try{frame=JSON.parse(Buffer.concat(chunks,bytes).toString("utf8").replace(/\r$/u,""));}
      catch{return finish(fieldFailure("invalid_field_frame"));}
      finish(null,frame);
    }
    function onEnd(){finish(fieldFailure("field_frame_missing"));}
    function onError(){finish(fieldFailure("field_frame_read_failed"));}
    input.on("data",onData);
    input.once("end",onEnd);
    input.once("error",onError);
  });
}
export async function runFieldGuest(input=process.stdin,output=process.stdout){
  if(process.platform!=="win32")throw fieldFailure("windows_guest_required");
  let started=false,dir="",mode="",complete=false,inputEnded=false;
  function finish(){
    if(complete)return;
    complete=true;
    let result;
    try{
      result=started?summarizeEvidence(mode,dir):{complete:false,code:"guest_never_started"};
    }catch(e){result={complete:false,code:e?.code??"peer_evidence_invalid"};}
    output.write("TF_FIELD_FINAL "+JSON.stringify(result)+"\n");
    if(!result.complete)process.exitCode=1;
    if(dir) fs.rmSync(dir,{recursive:true,force:true});
    // Legacy CI peers intentionally hold a process alive; the SSH adapter owns teardown.
    process.exit(result.complete?0:1);
  }
  // EOF before a complete frame belongs to the parser, not the field-result reporter.
  input.on("end",()=>{inputEnded=true;if(started)finish();});
  try{
    const frame=validateFieldFrame(await readGuestFrame(input));
    mode=frame.mode;
    dir=fs.mkdtempSync(path.join(tmpdir(),"tf-field-realtime-"));
    process.env.TEAMFORGE_CI_WS_URL=frame.endpoint;
    process.env.TEAMFORGE_CI_AUTH_TOKEN=frame.token;
    process.env.TEAMFORGE_CI_FIELD_EVENTS="1";
    process.env.TEAMFORGE_CI_EVIDENCE_DIR=dir;
    // No shell arguments or logs contain the token.
    output.write("TF_FIELD_MACHINE "+JSON.stringify({name:hostname(),head:sourceHead(),mode})+"\n");
    started=true;
    if(inputEnded)finish();
    await import(modes[mode]);
  }catch(e){
    if(!complete){
      output.write("TF_FIELD_FINAL "+JSON.stringify({complete:false,code:e?.code??"guest_launch_failed"})+"\n");
      if(dir)fs.rmSync(dir,{recursive:true,force:true});
      process.exitCode=1;
    }
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runFieldGuest().catch(e=>{console.log("TF_FIELD_FINAL "+JSON.stringify({complete:false,code:e?.code??"guest_failed"}));process.exitCode=1;});
}
