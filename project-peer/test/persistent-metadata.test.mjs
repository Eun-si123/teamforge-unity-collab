import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtemp,readFile,readdir,rm,stat,symlink,writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {writeJsonAtomic,writeJsonContentAddressed,writeJsonExclusive} from "../src/persistent-metadata.mjs";

async function fixture(t) {
  const directory=await mkdtemp(path.join(os.tmpdir(),"teamforge-persistent-metadata-"));
  t.after(async()=>await rm(directory,{force:true,recursive:true}));
  const file=path.join(directory,"metadata.json");
  return {directory,file};
}

const serialized = value => `${JSON.stringify(value,null,2)}\n`;

test("signed content-addressed metadata installs complete flushed JSON and keeps a stable immutable destination",async t=>{
  const f=await fixture(t);
  const metadata={schemaVersion:1,manifestHash:"a".repeat(64),files:[{path:"Assets/Example.unity"}]};
  await writeJsonContentAddressed(f.file,metadata);
  const original=await stat(f.file,{bigint:true});
  assert.equal(await readFile(f.file,"utf8"),serialized(metadata));
  assert.equal(original.size,BigInt(Buffer.byteLength(serialized(metadata))));
  await Promise.all(Array.from({length:8},()=>writeJsonContentAddressed(f.file,metadata)));
  const after=await stat(f.file,{bigint:true});
  assert.equal(after.ino,original.ino,"identical concurrent writers must not replace a signed artifact");
  assert.equal(after.nlink,1n);
  assert.deepEqual(await readdir(f.directory),["metadata.json"]);
  if(process.platform!=="win32") assert.equal(Number(after.mode & 0o777n),0o600);
});

test("existing corrupt, truncated and mutated content-addressed metadata fail closed without overwriting",async t=>{
  const f=await fixture(t);
  const source={manifestHash:"a".repeat(64),files:[{path:"Assets/One.prefab"}]};
  const corrupt=serialized({...source,manifestHash:"b".repeat(64)});
  await writeFile(f.file,corrupt);
  await assert.rejects(writeJsonContentAddressed(f.file,source),{code:"metadata_hash_collision"});
  assert.equal(await readFile(f.file,"utf8"),corrupt);
  await writeFile(f.file,"{\"partial\":");
  await assert.rejects(writeJsonContentAddressed(f.file,source),{code:"metadata_hash_collision"});
  assert.equal(await readFile(f.file,"utf8"),"{\"partial\":");
  assert.deepEqual(await readdir(f.directory),["metadata.json"]);
});

test("a matching symlink never substitutes for a canonical signed metadata artifact",async t=>{
  const f=await fixture(t);
  const source={schemaVersion:1,manifestHash:"b".repeat(64)};
  const outside=path.join(f.directory,"other.json");
  await writeFile(outside,serialized(source));
  try {await symlink(outside,f.file);} catch(error) {
    if(process.platform==="win32" && ["EPERM","EACCES"].includes(error.code)) return;
    throw error;
  }
  await assert.rejects(writeJsonContentAddressed(f.file,source),{code:"metadata_hash_collision"});
  assert.equal(await readFile(outside,"utf8"),serialized(source));
});

test("Project UUID identity uses exclusive fully written creation and cannot be replaced by a second writer",async t=>{
  const f=await fixture(t);
  const source={projectUuid:"11111111-1111-4111-8111-111111111111",schemaVersion:1};
  const outcome=await Promise.allSettled([
    writeJsonExclusive(f.file,source),
    writeJsonExclusive(f.file,{...source,projectUuid:"22222222-2222-4222-8222-222222222222"}),
  ]);
  assert.equal(outcome.filter(item=>item.status==="fulfilled").length,1);
  assert.equal(outcome.filter(item=>item.status==="rejected" && item.reason.code==="EEXIST").length,1);
  const actual=await readFile(f.file,"utf8");
  assert.ok([serialized(source),serialized({...source,projectUuid:"22222222-2222-4222-8222-222222222222"})].includes(actual));
  await assert.rejects(writeJsonExclusive(f.file,source),{code:"EEXIST"});
  assert.equal(await readFile(f.file,"utf8"),actual);
  assert.deepEqual(await readdir(f.directory),["metadata.json"]);
});

test("approved pointer replace keeps valid full JSON; orphaned partial temp never becomes canonical",async t=>{
  const f=await fixture(t);
  const first={schemaVersion:1,baselineRevision:1,descriptorHash:"c".repeat(64)};
  const next={...first,baselineRevision:2,descriptorHash:"d".repeat(64)};
  await writeJsonAtomic(f.file,first);
  await writeFile(`${f.file}.orphaned.tmp`,"{\"partial\":");
  await writeJsonAtomic(f.file,next);
  assert.deepEqual(JSON.parse(await readFile(f.file,"utf8")),next);
  assert.equal(await readFile(`${f.file}.orphaned.tmp`,"utf8"),"{\"partial\":");
  await writeJsonContentAddressed(path.join(f.directory,"other-signed.json"),first);
  assert.deepEqual((await readdir(f.directory)).sort(),["metadata.json","metadata.json.orphaned.tmp","other-signed.json"]);
});

test("child SIGKILL after durable signed metadata commit reopens complete JSON and no in-progress temporary",async t=>{
  const f=await fixture(t);
  const expected={schemaVersion:1,baselineRevision:1,descriptorHash:"e".repeat(64)};
  const moduleUrl=new URL("../src/persistent-metadata.mjs",import.meta.url).href;
  const source=`import {writeJsonContentAddressed,writeJsonAtomic} from ${JSON.stringify(moduleUrl)};
    await writeJsonContentAddressed(process.argv[1],JSON.parse(process.argv[2]));
    await writeJsonAtomic(process.argv[3],JSON.parse(process.argv[2]));
    process.send({phase:'metadata-committed'});setInterval(()=>{},1000);`;
  const pointer=path.join(f.directory,"approved.json");
  const child=spawn(process.execPath,["--input-type=module","-e",source,f.file,JSON.stringify(expected),pointer],{
    stdio:["ignore","ignore","pipe","ipc"]});
  let diagnostics="";
  child.stderr.on("data",bytes=>{diagnostics+=bytes.toString("utf8");});
  const exited=new Promise(resolve=>child.once("exit",(code,signal)=>resolve({code,signal})));
  t.after(async()=>{if(child.exitCode===null && child.signalCode===null)child.kill("SIGKILL");await exited;});
  const phase=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error(`metadata child timed out: ${diagnostics}`)),10000);
    child.once("message",value=>{clearTimeout(timer);resolve(value);});
    child.once("error",error=>{clearTimeout(timer);reject(error);});
    child.once("exit",code=>{clearTimeout(timer);reject(new Error(`metadata child failed (${code}): ${diagnostics}`));});
  });
  assert.deepEqual(phase,{phase:"metadata-committed"});
  child.kill("SIGKILL");
  await exited;
  for(const item of [f.file,pointer])
    assert.equal(await readFile(item,"utf8"),serialized(expected));
  assert.deepEqual((await readdir(f.directory)).sort(),["approved.json","metadata.json"]);
});
