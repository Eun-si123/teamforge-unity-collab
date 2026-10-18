#!/usr/bin/env node
// Source-level two-physical-Windows-PC LAN test. NOT full Unity/Launcher release field proof.
// SSH is the control plane; real TeamForge DirectTransferServer/SwarmDownloader carry payload.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { isIP } from "node:net";
import { hostname, networkInterfaces, tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { ChunkStore } from "../project-peer/src/content-store.mjs";
import { createDescriptor } from "../project-peer/src/descriptor.mjs";
import { DirectTransferClient } from "../project-peer/src/direct-transfer-client.mjs";
import { DirectTransferServer, createTransferToken } from "../project-peer/src/direct-transfer-server.mjs";
import { generateIdentity } from "../project-peer/src/identity.mjs";
import { buildManifest, uniqueManifestChunks } from "../project-peer/src/manifest.mjs";
import { SwarmDownloader } from "../project-peer/src/swarm-downloader.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function reject(code) { throw Object.assign(new Error(code), {code}); }
function gitHead() {
  try {
    const sha = execFileSync("git", ["rev-parse", "--verify", "HEAD"], {
      cwd: root, encoding: "utf8", timeout: 10000, windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (/^[0-9a-f]{40}$/u.test(sha)) return sha;
  } catch {}
  reject("source_head_unavailable");
}
function configFromEnv(env = process.env) {
  const guest = env.TEAMFORGE_FIELD_GUEST_SSH ?? "";
  const address = env.TEAMFORGE_FIELD_HOST_IPV4 ?? "";
  const script = env.TEAMFORGE_FIELD_GUEST_SCRIPT ?? "";
  const size = Number(env.TEAMFORGE_FIELD_SIZE_MIB ?? "2");
  if (!guest || !address || !script) reject("field_environment_missing");
  if (!/^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$/u.test(guest)) reject("invalid_ssh_target");
  if (!/^[A-Za-z]:\/[A-Za-z0-9_./-]+\.mjs$/u.test(script) || script.includes("..")) reject("invalid_remote_script");
  if (isIP(address) !== 4 || address === "0.0.0.0" || address.startsWith("127.")) reject("invalid_host_ipv4");
  const assigned = Object.values(networkInterfaces()).flat().filter(Boolean);
  if (!assigned.some(n => n.family === "IPv4" && !n.internal && n.address === address)) reject("host_ipv4_not_local");
  if (!Number.isInteger(size) || size < 1 || size > 8) reject("invalid_asset_size");
  return { guest, address, script, size };
}
async function fixture(size) {
  const dir = await mkdtemp(path.join(tmpdir(), "tf-field-"));
  try {
    const project = path.join(dir, "project");
    for (const name of ["Assets","Packages","ProjectSettings"]) await mkdir(path.join(project,name), {recursive:true});
    const data = Buffer.alloc(size * 1048576, 0x5a);
    for (let i=0; i<data.length; i+=65536) data.writeUInt32LE(i/65536,i);
    await writeFile(path.join(project,"Assets","Field.bin"),data);
    await writeFile(path.join(project,"Packages","manifest.json"),'{"dependencies":{}}\n');
    await writeFile(path.join(project,"Packages","packages-lock.json"),'{"dependencies":{}}\n');
    await writeFile(path.join(project,"ProjectSettings","ProjectVersion.txt"),"m_EditorVersion: 6000.3.21f1\n");
    const projectUuid = randomUUID(), store = new ChunkStore(path.join(dir,"chunks"));
    const {manifest} = await buildManifest({
      projectRoot:project, projectUuid, baselineRevision:1, chunkSize:65536, store,
    });
    const owner = generateIdentity("Temporary Test Lab source");
    const descriptor = createDescriptor({
      projectId:"field-two-pc",projectUuid,baselineRevision:1,
      manifestHash:manifest.manifestHash,unityVersion:"6000.3.21f1",ownerIdentity:owner,
    });
    return {dir,store,manifest,owner,descriptor,projectUuid};
  } catch (e) { await rm(dir,{recursive:true,force:true}); throw e; }
}
async function readFrame() {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk.toString("utf8");
    if (Buffer.byteLength(input,"utf8") > 8192) reject("field_frame_too_large");
  }
  try { return JSON.parse(input); } catch { reject("invalid_field_frame"); }
}
async function guestRun(frame) {
  if (process.platform !== "win32") reject("windows_guest_required");
  if (!frame || frame.version !== 1 || frame.head !== gitHead() ||
      !frame.hostName || frame.hostName.toLowerCase() === hostname().toLowerCase() ||
      typeof frame.token !== "string" || frame.token.length < 32) reject("field_peer_identity_mismatch");
  const dir = await mkdtemp(path.join(tmpdir(),"tf-guest-"));
  try {
    const store = new ChunkStore(path.join(dir,"chunks"));
    const source = new DirectTransferClient({
      endpoint:frame.endpoint,sessionId:frame.sessionId,transferToken:frame.token,
      projectUuid:frame.projectUuid,manifestHash:frame.manifestHash,timeoutMilliseconds:10000,
    });
    const signal = AbortSignal.timeout(90000), seeds=[{id:"host",client:source}];
    const denied = await fetch(frame.endpoint+"/descriptor", {
      headers:{authorization:"Bearer intentionally-invalid"},signal,
    });
    assert.equal(denied.status,401,"Anonymous transfer must be refused");
    await denied.body?.cancel();
    const loader=new SwarmDownloader({store});
    await loader.discover({
      seeds,projectId:"field-two-pc",projectUuid:frame.projectUuid,
      manifestHash:frame.manifestHash,sessionId:frame.sessionId,
      trustedOwnerKeyId:frame.ownerKeyId,signal,
    });
    const manifest=await source.manifest(signal), start=performance.now();
    const initial=await loader.download({manifest,seeds,sessionId:frame.sessionId,signal});
    const elapsedMs=Math.round(performance.now()-start), chunks=uniqueManifestChunks(manifest);
    for (const c of chunks) await store.read(c.hash,c.size);
    assert.ok(initial.transferredBytes>0 && initial.completedChunks===chunks.length);
    const replay=await new SwarmDownloader({store}).download({
      manifest,seeds,sessionId:frame.sessionId,signal,
    });
    assert.equal(replay.transferredBytes,0);
    assert.equal(replay.resumedBytes,initial.totalBytes);
    return {ok:true,head:gitHead(),hostName:frame.hostName,guestName:hostname(),
      transferredBytes:initial.transferredBytes,verifiedChunks:chunks.length,
      resumedBytes:replay.resumedBytes,elapsedMs};
  } finally {await rm(dir,{recursive:true,force:true});}
}
function sshGuest(config,frame) {
  return new Promise((resolve, rejectPromise)=>{
    // Requires pretrusted host key and non-interactive SSH; never prints the per-run token.
    const child=spawn("ssh",["-T","-o","BatchMode=yes","-o",
      "StrictHostKeyChecking=yes","-o","ConnectTimeout=15",config.guest,
      "node",config.script,"guest"],{windowsHide:true,stdio:["pipe","pipe","pipe"]});
    let stdout="", settled=false, bytes=0, excessive=false;
    const timer=setTimeout(()=>child.kill(),120000);
    child.stdin.on("error",()=>{});
    child.stdin.end(JSON.stringify(frame)+"\n"); // encrypted control channel
    child.stdout.setEncoding("utf8");
    child.stdout.on("data",chunk=>{
      bytes+=Buffer.byteLength(chunk,"utf8");
      if(bytes>16384){excessive=true;child.kill();} else stdout+=chunk;
    });
    child.stderr.resume(); // do not retain unredacted remote stderr
    child.on("error",e=>finish(e));
    child.on("close",code=>{
      if(settled)return;
      if(excessive)return finish(Object.assign(new Error("remote_output_too_large"),{code:"remote_output_too_large"}));
      const line=stdout.split(/\r?\n/u).find(s=>s.startsWith("TF_FIELD_RESULT "));
      if(!line)return finish(Object.assign(new Error("ssh_guest_no_result"),{code:"ssh_guest_no_result"}));
      let result;
      try {result=JSON.parse(line.slice("TF_FIELD_RESULT ".length));}
      catch {return finish(Object.assign(new Error("invalid_guest_result"),{code:"invalid_guest_result"}));}
      if(code!==0 || result.ok!==true)return finish(Object.assign(
        new Error(result.code??"guest_failed"),{code:result.code??"guest_failed"}));
      finish(null,result);
    });
    function finish(error,result){
      if(settled)return; settled=true;clearTimeout(timer);
      if(error)rejectPromise(error);else resolve(result);
    }
  });
}
async function runField(config) {
  if(process.platform!=="win32") reject("windows_host_required");
  const head=gitHead(), data=await fixture(config.size);
  let server;
  try {
    const token=createTransferToken(), sessionId=randomUUID();
    server=new DirectTransferServer({
      host:"0.0.0.0",port:0,sessionId,transferToken:token,
      projectUuid:data.projectUuid,manifest:data.manifest,descriptor:data.descriptor,store:data.store,
    });
    const bound=await server.start();
    const frame={
      version:1,head,hostName:hostname(),token,sessionId,
      endpoint:"http://"+config.address+":"+bound.port+bound.basePath,
      projectUuid:data.projectUuid,manifestHash:data.manifest.manifestHash,ownerKeyId:data.owner.keyId,
    };
    const result=await sshGuest(config,frame);
    assert.equal(result.head,head);
    assert.notEqual(result.guestName.toLowerCase(),hostname().toLowerCase());
    return {
      schemaVersion:1,scenario:"field-two-pc",status:"passed",sourceHead:head,
      fieldGateComplete:false,scope:"real two-PC source-level direct Peer transfer, integrity, auth and cache resume",
      host:{name:hostname(),ipv4:config.address,port:bound.port},
      guest:{name:result.guestName,sshTarget:config.guest},
      transferredBytes:result.transferredBytes,resumedBytes:result.resumedBytes,
      verifiedChunks:result.verifiedChunks,elapsedMs:result.elapsedMs,
    };
  } finally {
    if(server)await server.stop();
    await rm(data.dir,{recursive:true,force:true});
  }
}
async function main(){
  if(process.argv[2]==="guest"){
    try { console.log("TF_FIELD_RESULT "+JSON.stringify(await guestRun(await readFrame()))); }
    catch(e){console.log("TF_FIELD_RESULT "+JSON.stringify({ok:false,code:e?.code??"guest_failed"}));process.exitCode=1;}
    return;
  }
  if(process.argv[2]!=="run"){console.error("Use: node scripts/field-two-pc.mjs run");process.exitCode=2;return;}
  const startedAtUtc=new Date().toISOString();
  let report;
  try{report=await runField(configFromEnv());}
  catch(e){report={schemaVersion:1,scenario:"field-two-pc",status:"failed",
    fieldGateComplete:false,code:e?.code??"field_failed"};process.exitCode=1;}
  report.startedAtUtc=startedAtUtc;
  report.endedAtUtc=new Date().toISOString();
  const dir=path.join(root,"test-results","field-two-pc");
  await mkdir(dir,{recursive:true});
  const file=path.join(dir,new Date().toISOString().replace(/[-:.]/gu,"")+"-"+randomUUID()+".json");
  await writeFile(file,JSON.stringify(report,null,2)+"\n",{flag:"wx"});
  console.log("Two-PC source-level Project Peer test: "+report.status.toUpperCase());
  if(report.code)console.log("Stable error: "+report.code);
  console.log("Evidence: "+path.relative(root,file));
  console.log("Packaged Launcher / actual Unity collaboration field gate: NOT RUN");
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
export {configFromEnv,fixture};
