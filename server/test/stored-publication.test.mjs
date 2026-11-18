import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { loadStoredPublication, readPublishedBaseline } from "../../project-peer/src/stored-publication.mjs";
import { PRODUCT_VERSION } from "../../project-peer/src/constants.mjs";
import { cleanup, publicationFixture, temporaryRoot } from "../../project-peer/test/helpers.mjs";

async function storedFixture(t) {
  const root = await temporaryRoot("teamforge-publication-reader-");
  t.after(()=>cleanup(root));
  const publication = await publicationFixture(root);
  const managedRoot = path.join(root,"managed");
  const metadataRoot = path.join(managedRoot,publication.projectUuid,"metadata");
  await mkdir(path.join(metadataRoot,"manifests"),{recursive:true});
  await mkdir(path.join(metadataRoot,"descriptors"),{recursive:true});
  const metadata = {schemaVersion:1,productVersion:PRODUCT_VERSION,
    projectId:publication.projectId,projectUuid:publication.projectUuid,createdAtUnixMs:Date.now()};
  const published = {schemaVersion:1,projectUuid:publication.projectUuid,baselineRevision:1,
    manifestHash:publication.manifest.manifestHash,descriptorHash:publication.descriptor.descriptorHash,
    ownerKeyId:publication.descriptor.ownerKeyId,approvedAtUnixMs:Date.now()};
  const projectPath = path.join(metadataRoot,"project.json");
  const pointerPath = path.join(metadataRoot,"published.json");
  const descriptorPath = path.join(metadataRoot,"descriptors",published.descriptorHash+".json");
  await writeFile(projectPath,JSON.stringify(metadata));
  await writeFile(pointerPath,JSON.stringify(published));
  await writeFile(descriptorPath,JSON.stringify(publication.descriptor));
  await writeFile(path.join(metadataRoot,"manifests",published.manifestHash+".json"),JSON.stringify(publication.manifest));
  const options = {managedRoot,projectId:publication.projectId,projectUuid:publication.projectUuid,
    manifestHash:published.manifestHash,requireApproved:true};
  return {publication,metadata,published,projectPath,pointerPath,descriptorPath,options};
}

test("transport-free stored publication reader preserves approved exact descriptor selection", async t=>{
  const f = await storedFixture(t);
  // An unrelated corrupt draft must not replace or block the approved file.
  await writeFile(path.join(path.dirname(f.descriptorPath),"0".repeat(64)+".json"),"{");
  const loaded = await loadStoredPublication(f.options);
  assert.equal(loaded.project.projectUuid,f.publication.projectUuid);
  assert.equal(loaded.manifest.manifestHash,f.published.manifestHash);
  assert.equal(loaded.descriptor.descriptorHash,f.published.descriptorHash);
  assert.deepEqual(await readPublishedBaseline(f.options),f.published);
  await rm(f.descriptorPath);
  await assert.rejects(loadStoredPublication(f.options),{code:"descriptor_unavailable"});
});

test("transport-free publication reader binds stored metadata to the selected Project identity", async t=>{
  const f = await storedFixture(t);
  await assert.rejects(loadStoredPublication({...f.options,projectId:"different-project"}),{code:"project_id_mismatch"});
  await writeFile(f.projectPath,JSON.stringify({...f.metadata,projectUuid:"315b1ce0-5da1-4336-83ba-8ad070f38231"}));
  await assert.rejects(loadStoredPublication(f.options),{code:"invalid_project_metadata"});
  await assert.rejects(loadStoredPublication({...f.options,projectUuid:"../escape"}),{code:"invalid_project_uuid"});
});

test("transport-free publication reader refuses unapproved pointers and invalid signed descriptor bytes", async t=>{
  const f = await storedFixture(t);
  await rm(f.pointerPath);
  await assert.rejects(loadStoredPublication(f.options),{code:"baseline_not_approved"});
  await writeFile(f.pointerPath,JSON.stringify({...f.published,ownerKeyId:"not-an-owner"}));
  await assert.rejects(loadStoredPublication(f.options),{code:"invalid_published_pointer"});
  await writeFile(f.pointerPath,JSON.stringify(f.published));
  await writeFile(f.descriptorPath,JSON.stringify({...f.publication.descriptor,unityVersion:"6000.3.99f1"}));
  await assert.rejects(loadStoredPublication(f.options),error=>typeof error.code==="string" && /descriptor|signature/.test(error.code));
});
