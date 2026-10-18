import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { networkInterfaces } from "node:os";
import { rm } from "node:fs/promises";
import { configFromEnv, fixture } from "./field-two-pc.mjs";

const valid={TEAMFORGE_FIELD_GUEST_SSH:"tester@guest-pc",
  TEAMFORGE_FIELD_HOST_IPV4:"192.168.219.5",
  TEAMFORGE_FIELD_GUEST_SCRIPT:"C:/TeamForge/scripts/field-two-pc.mjs"};

test("required configuration and remote shell arguments fail closed",()=>{
  assert.throws(()=>configFromEnv({}),{code:"field_environment_missing"});
  assert.throws(()=>configFromEnv({...valid,TEAMFORGE_FIELD_GUEST_SSH:"user@pc;whoami"}),{code:"invalid_ssh_target"});
  assert.throws(()=>configFromEnv({...valid,TEAMFORGE_FIELD_GUEST_SCRIPT:"C:/Program Files/code.mjs"}),{code:"invalid_remote_script"});
  assert.throws(()=>configFromEnv({...valid,TEAMFORGE_FIELD_GUEST_SCRIPT:"C:/../evil.mjs"}),{code:"invalid_remote_script"});
  assert.throws(()=>configFromEnv({...valid,TEAMFORGE_FIELD_HOST_IPV4:"192.168.219."}),{code:"invalid_host_ipv4"});
  assert.throws(()=>configFromEnv({...valid,TEAMFORGE_FIELD_HOST_IPV4:"127.0.0.1"}),{code:"invalid_host_ipv4"});
  assert.throws(()=>configFromEnv({...valid,TEAMFORGE_FIELD_HOST_IPV4:"198.51.100.7"}),{code:"host_ipv4_not_local"});
});

test("a valid local interface is accepted with bounded fixture size",()=>{
  const nic=Object.values(networkInterfaces()).flat().find(n=>n && n.family==="IPv4" && !n.internal);
  if(!nic)return;
  const env={...valid,TEAMFORGE_FIELD_HOST_IPV4:nic.address};
  assert.equal(configFromEnv(env).size,2);
  assert.throws(()=>configFromEnv({...env,TEAMFORGE_FIELD_SIZE_MIB:"999"}),{code:"invalid_asset_size"});
});

test("generated project fixture retains signed descriptor/manifest identities",async()=>{
  const data=await fixture(1);
  try{
    assert.equal(data.manifest.projectUuid,data.projectUuid);
    assert.equal(data.descriptor.manifestHash,data.manifest.manifestHash);
    assert.match(data.manifest.manifestHash,/^[0-9a-f]{64}$/u);
  }finally{await rm(data.dir,{recursive:true,force:true});}
});

test("invalid remote frame does not produce a passing field result",()=>{
  const result=spawnSync(process.execPath,["scripts/field-two-pc.mjs","guest"],{
    input:"{}\n",encoding:"utf8",timeout:10000,
  });
  assert.notEqual(result.status,0);
  const line=result.stdout.split(/\r?\n/u).find(s=>s.startsWith("TF_FIELD_RESULT "));
  assert.ok(line);
  assert.equal(JSON.parse(line.slice("TF_FIELD_RESULT ".length)).ok,false);
});
