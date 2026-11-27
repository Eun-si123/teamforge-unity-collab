import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { auditSignedCandidateContents } from "../src/signed-candidate-content-audit.mjs";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
function fixture({corrupt = false, wrongFileHash = false, abortAfterFirstRead = false} = {}) {
  const bytes = new Map();
  function file(path, chunks) {
    const content = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
    const entries = chunks.map((chunk, i) => {
      const buffer = Buffer.from(chunk);
      bytes.set(sha256(buffer), buffer);
      return {hash:sha256(buffer),size:buffer.length,offset:chunks.slice(0,i).reduce((n,c)=>n+Buffer.byteLength(c),0)};
    });
    return {path,size:content.length,fileHash:wrongFileHash && path.endsWith(".fbx")
      ? "f".repeat(64) : sha256(content),chunks:entries,kind:"asset",executable:false,script:false};
  }
  const files = [file("Assets/Models/Avatar.fbx",["mesh-", "body-bytes"]),
    file("Assets/Models/Avatar.fbx.meta",["guid: 12345678901234567890123456789012\n"]),
    file("Assets/Empty.txt",[])];
  let reads = 0;
  const controller = new AbortController();
  const store = {async read(hash,size) {
    reads++;
    const item = bytes.get(hash);
    if (!item) throw Object.assign(new Error("missing"),{code:"chunk_unavailable"});
    assert.equal(item.length,size);
    if (abortAfterFirstRead) controller.abort();
    return corrupt && reads === 2 ? Buffer.alloc(item.length,0) : Buffer.from(item);
  }};
  const manifest = {files,totalFiles:files.length,
    totalBytes:files.reduce((n,file)=>n+file.size,0),
    totalChunks:files.reduce((n,file)=>n+file.chunks.length,0)};
  return {manifest,store,controller,reads:()=>reads};
}

test("signed M5 candidate verifies all FBX body, .meta and empty-file SHA-256 with bounded memory",async()=>{
  const f=fixture();
  const result=await auditSignedCandidateContents(f);
  assert.deepEqual(result,{status:"verified",verifiedFiles:3,verifiedBytes:f.manifest.totalBytes,
    verifiedChunks:3});
  assert.equal(f.reads(),3);
});

test("signed M5 candidate refuses corrupt/missing chunks, signed file hash mismatches and mismatched inventory totals",async()=>{
  for(const inputs of [{corrupt:true},{wrongFileHash:true}]) {
    const f=fixture(inputs);
    await assert.rejects(auditSignedCandidateContents(f),/digest|reconstruct/u);
  }
  const absent=fixture();
  absent.store.read=async()=>{throw Object.assign(new Error("missing"),{code:"chunk_unavailable"});};
  await assert.rejects(auditSignedCandidateContents(absent),{code:"chunk_unavailable"});
  const counted=fixture();
  counted.manifest.totalFiles++;
  await assert.rejects(auditSignedCandidateContents(counted),/totals/);
});

test("signed M5 candidate checks all budgets before any content read and never reports partial success",async()=>{
  const base={maxFiles:100,maxBytes:1024,maxChunks:100};
  const f=fixture();
  for(const budget of [
    {...base,maxFiles:2},
    {...base,maxBytes:1},
    {...base,maxChunks:2},
  ]) {
    assert.deepEqual(await auditSignedCandidateContents(f,{budget}),
      {status:"resource_limit",verifiedFiles:0,verifiedBytes:0,verifiedChunks:0});
    assert.equal(f.reads(),0);
  }
});

test("signed M5 candidate stops on explicit cancellation between exact chunk reads",async()=>{
  const f=fixture({abortAfterFirstRead:true});
  await assert.rejects(auditSignedCandidateContents(f,{signal:f.controller.signal}),
    {name:"AbortError"});
  assert.equal(f.reads(),1);
  const before=fixture();
  before.controller.abort();
  await assert.rejects(auditSignedCandidateContents(before,{signal:before.controller.signal}),
    {name:"AbortError"});
  assert.equal(before.reads(),0);
});
