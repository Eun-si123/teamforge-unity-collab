import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { auditSignedAssetGuids } from "../src/signed-asset-guid-audit.mjs";
import { previewRetainedM4SourceChanges } from "../src/baseline-transition-source-preview.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const previousScene = {path:"Assets/Scenes/Main.unity",fileHash:"a".repeat(64)};
const newAsset = "Assets/Characters/Imported.fbx";
const text = guid => `fileFormatVersion: 2\nguid: ${guid}\n`;
const originalGuid = "12345678901234567890123456789012";
const changed = {added:[newAsset,`${newAsset}.meta`], changed:[], deleted:[]};

function fixture({oldMeta=text(originalGuid),newMeta=text(originalGuid),metaSize,
  extraMetaFiles=0,chunkAvailable=true,chunkWrong=false}={}) {
  const blobs = new Map();
  const metaFile = (path,contents) => {
    const bytes = Buffer.from(contents);
    const digest = hash(bytes);
    blobs.set(digest,bytes);
    return {path,fileHash:digest,size:metaSize ?? bytes.length,
      chunks:[{hash:digest,size:bytes.length,offset:0}]};
  };
  const before = {files:[previousScene,metaFile("Assets/Scenes/Main.unity.meta",oldMeta)]};
  const candidate = {files:[...before.files,metaFile(`${newAsset}.meta`,newMeta)]};
  for (let i=0;i<extraMetaFiles;i++) {
    candidate.files.push(metaFile(`Assets/More/${i}.prefab.meta`,text(i.toString(16).padStart(32,"0"))));
  }
  let readCalls = 0;
  const publication = {manifest:candidate,store:{
    async read(digest,expectedSize) {
      readCalls++;
      if (!chunkAvailable) throw Object.assign(new Error("unavailable"),{code:"chunk_unavailable"});
      const bytes = blobs.get(digest);
      assert(bytes);
      assert.equal(bytes.length,expectedSize);
      return chunkWrong ? Buffer.from(bytes).fill(0) : bytes;
    },
  }};
  return {publication,before,candidate,readCalls:()=>readCalls};
}

test("staged signed .meta content detects same GUID with distinct bytes and preserves old Scene pin",async()=>{
  const f = fixture({newMeta:`fileFormatVersion: 2\nassetBundleName: avatar\nguid: ${originalGuid}\n`});
  const r = await auditSignedAssetGuids(f.publication,changed);
  assert.equal(r.status,"verified");
  assert.equal(r.auditedMetadataFiles,2);
  assert.deepEqual(r.duplicateGuidPaths,[`${newAsset}.meta`]);
  assert.deepEqual(r.invalidGuidPaths,[]);
  const old = previewRetainedM4SourceChanges(f.before,f.candidate,changed);
  assert.equal(old.blockerCount,0,"Existing hash-only preflight misses a different-byte same-GUID imported Asset.");
  const fixed = previewRetainedM4SourceChanges(f.before,f.candidate,changed,[],r);
  assert.equal(fixed.status,"source_reconciliation_required");
  assert.equal(fixed.blockerCount,1);
  assert.equal(fixed.duplicateGuidCount,1);
  assert.deepEqual(fixed.blockersPreview,[`${newAsset}.meta`]);
});

test("staged signed .meta rejects invalid GUID but preserves no-op historical metadata",async()=>{
  const f = fixture({newMeta:"fileFormatVersion: 2\nguid: 00000000000000000000000000000000\n"});
  const r = await auditSignedAssetGuids(f.publication,changed);
  assert.equal(r.status,"verified");
  assert.deepEqual(r.invalidGuidPaths,[`${newAsset}.meta`]);
  assert.equal(previewRetainedM4SourceChanges(f.before,f.candidate,changed,[],r).invalidGuidCount,1);
  const old = fixture({oldMeta:"fileFormatVersion: 2\nunknown: x\n",newMeta:text("f".repeat(32))});
  const oldOnly = await auditSignedAssetGuids(old.publication,changed);
  assert.deepEqual(oldOnly.invalidGuidPaths,[],"Unchanged historic metadata is not a newly introduced problem.");
});

test("staged Unity imports detect GUID collisions with embedded Package metadata",async()=>{
  const f=fixture({oldMeta:text("a".repeat(32)),newMeta:text("b".repeat(32))});
  const packagePath="Packages/com.example.asset/Textures/Icon.png.meta";
  const bytes=Buffer.from(text("b".repeat(32)));
  const h=hash(bytes);
  f.publication.manifest.files.push({path:packagePath,fileHash:h,size:bytes.length,
    chunks:[{hash:h,size:bytes.length,offset:0}]});
  const read=f.publication.store.read;
  f.publication.store.read=async(digest,size)=>digest===h?bytes:read(digest,size);
  const audit=await auditSignedAssetGuids(f.publication,changed);
  assert.equal(audit.status,"verified");
  assert.equal(audit.auditedMetadataFiles,3);
  assert.deepEqual(audit.duplicateGuidPaths,[`${newAsset}.meta`]);
});

test("staged signed .meta never claims complete from budget-exceeded files or partial chunk reads",async()=>{
  for (const options of [
    {maxMetadataFiles:1,maxMetadataBytes:1024,maxIndividualMetadataBytes:1024,maxMetadataChunks:10},
    {maxMetadataFiles:100,maxMetadataBytes:1,maxIndividualMetadataBytes:1024,maxMetadataChunks:10},
    {maxMetadataFiles:100,maxMetadataBytes:1024,maxIndividualMetadataBytes:1,maxMetadataChunks:10},
    {maxMetadataFiles:100,maxMetadataBytes:1024,maxIndividualMetadataBytes:1024,maxMetadataChunks:1},
  ]) {
    const f=fixture();
    assert.deepEqual(await auditSignedAssetGuids(f.publication,changed,{limits:options}),
      {status:"resource_limit",auditedMetadataFiles:0,duplicateGuidPaths:[],invalidGuidPaths:[]});
    assert.equal(f.readCalls(),0,"Budget must be checked before reading any chunks.");
  }
  const f=fixture({chunkAvailable:false});
  await assert.rejects(auditSignedAssetGuids(f.publication,changed),/unavailable/);
  assert.equal(f.readCalls(),1);
});

test("staged signed .meta independently verifies reconstructed file SHA and aborts disconnected clients",async()=>{
  for(const extra of [{chunkWrong:true},{metaSize:99}]) {
    const f=fixture(extra);
    await assert.rejects(auditSignedAssetGuids(f.publication,changed),
      /hash|length/u);
  }
  const f=fixture();
  const controller=new AbortController();
  controller.abort();
  await assert.rejects(auditSignedAssetGuids(f.publication,changed,{signal:controller.signal}),
    {name:"AbortError"});
  assert.equal(f.readCalls(),0);
});
