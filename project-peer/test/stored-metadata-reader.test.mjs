import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {mkdtemp,mkdir,readFile,rename,rm,symlink,writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {readStoredMetadataJson,STORED_DESCRIPTOR_MAX_BYTES} from "../src/stored-metadata-reader.mjs";

async function fixture(t) {
  const root=await mkdtemp(path.join(os.tmpdir(),"teamforge-signed-metadata-read-"));
  t.after(async()=>await rm(root,{recursive:true,force:true}));
  const metadata=path.join(root,"metadata");
  await mkdir(metadata);
  const selected=path.join(metadata,"selected.json");
  return {root,metadata,selected};
}

test("signed metadata read accepts a regular bounded file and refuses oversized or empty sources",async t=>{
  const f=await fixture(t);
  const value={id:"example",revision:2,objects:[{name:"Collider"}]};
  await writeFile(f.selected,JSON.stringify(value));
  assert.deepEqual(await readStoredMetadataJson(f.selected,4096),value);
  await writeFile(f.selected," ".repeat(4097));
  await assert.rejects(readStoredMetadataJson(f.selected,4096),{code:"stored_metadata_size_limit"});
  await writeFile(f.selected,"");
  await assert.rejects(readStoredMetadataJson(f.selected,4096),{code:"stored_metadata_size_limit"});
  assert.ok(STORED_DESCRIPTOR_MAX_BYTES < 1024 * 1024);
});

test("signed metadata reader blocks final-file and ancestor symlinks instead of following a matching signed file",async t=>{
  const f=await fixture(t);
  const outside=path.join(f.root,"outside.json");
  await writeFile(outside,JSON.stringify({signed:true}));
  try {await symlink(outside,f.selected);} catch(error) {
    if(process.platform==="win32" && ["EPERM","EACCES"].includes(error.code)) return;
    throw error;
  }
  await assert.rejects(readStoredMetadataJson(f.selected,2048),{code:"unsafe_stored_metadata"});
  await rm(f.selected);
  await rm(f.metadata,{recursive:true});
  await symlink(f.root,f.metadata,process.platform==="win32" ? "junction":"dir");
  await assert.rejects(readStoredMetadataJson(path.join(f.metadata,"outside.json"),2048),{code:"unsafe_stored_metadata"});
  assert.deepEqual(JSON.parse(await readFile(outside,"utf8")),{signed:true});
});

test("signed metadata read rejects a file replacement during open without leaking source paths",async t=>{
  const f=await fixture(t);
  await writeFile(f.selected,JSON.stringify({first:1}));
  const replacement=path.join(f.metadata,"replacement.json");
  await writeFile(replacement,JSON.stringify({second:2}));
  const helperUrl=new URL("../src/stored-metadata-reader.mjs",import.meta.url).href;
  const source=`import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
    import {rename} from 'node:fs/promises';
    import {readStoredMetadataJson} from ${JSON.stringify(helperUrl)};
    const file=process.argv[1],replacement=process.argv[2];
    const previous=fs.promises.lstat;
    let changed=false;
    fs.promises.lstat=async (target,options)=>{
      const info=await previous(target,options);
      if(!changed && target===file){changed=true;await rename(replacement,file);}
      return info;
    };
    syncBuiltinESMExports();
    try {await readStoredMetadataJson(file,4096);process.exitCode=2;}
    catch(e) {if(!changed || e.code!=='stored_metadata_changed' || e.message.includes(file))process.exitCode=3;}
    finally {fs.promises.lstat=previous;syncBuiltinESMExports();}`;
  const result=spawnSync(process.execPath,["--input-type=module","-e",source,f.selected,replacement],{encoding:"utf8",timeout:5000});
  assert.equal(result.status,0,`Expected replacement guard (${result.stderr})`);
});

test("FIFO swapped after preflight lstat cannot stall managed-source inspection",async t=>{
  if(process.platform!=="linux") return t.skip("Linux mkfifo path race only");
  const f=await fixture(t);
  await writeFile(f.selected,JSON.stringify({first:1}));
  const fifo=path.join(f.metadata,`replacement-${randomUUID()}.fifo`);
  const {execFileSync}=await import("node:child_process");
  execFileSync("mkfifo",[fifo]);
  const helperUrl=new URL("../src/stored-metadata-reader.mjs",import.meta.url).href;
  const source=`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
    import {rename} from 'node:fs/promises';
    import {readStoredMetadataJson} from ${JSON.stringify(helperUrl)};
    const file=process.argv[1],fifo=process.argv[2];
    const previous=fs.promises.lstat; let changed=false;
    fs.promises.lstat=async(target,options)=>{
      const info=await previous(target,options);
      if(!changed&&target===file){changed=true;await rename(fifo,file);}
      return info;
    };syncBuiltinESMExports();
    try{await readStoredMetadataJson(file,4096);process.exitCode=2;}
    catch(e){if(!changed||!['stored_metadata_unavailable','stored_metadata_changed'].includes(e.code))process.exitCode=3;}`;
  const result=spawnSync(process.execPath,["--input-type=module","-e",source,f.selected,fifo],{encoding:"utf8",timeout:3000});
  assert.equal(result.status,0,`FIFO must fail promptly without hanging (${result.signal},${result.stderr})`);
});


test("missing signed source never exposes a private managed-root pathname",async t=>{
  const f=await fixture(t);
  await assert.rejects(readStoredMetadataJson(f.selected,4096),error=>{
    assert.equal(error.code,"ENOENT");
    assert.equal(error.message.includes(f.root),false);
    return true;
  });
});
