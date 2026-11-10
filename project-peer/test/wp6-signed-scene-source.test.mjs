import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { cleanup, publicationFixture, temporaryRoot } from "./helpers.mjs";
import { verifyWp6PublishedSceneSource } from "../src/wp6-signed-scene-source.mjs";

const sceneGuid = "f0e1d2c3b4a5968776655443322110aa";
const otherGuid = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const scenePath = "Assets/Scenes/Prototype.unity";
const sceneText = "%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!1 &42\nGameObject:\n  m_Name: Sample\n";
const metaText = `fileFormatVersion: 2\nguid: ${sceneGuid}\nDefaultImporter:\n  externalObjects: {}\n`;
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const expectedSourceStatus = "signed_manifest_scene_bytes_verified_unparsed";

function pin(fixture) {
  const { descriptor } = fixture;
  return {
    projectId: descriptor.projectId,
    projectUuid: descriptor.projectUuid,
    baselineRevision: descriptor.baselineRevision,
    manifestHash: descriptor.manifestHash,
    descriptorHash: descriptor.descriptorHash,
    ownerKeyId: descriptor.ownerKeyId,
  };
}
async function fixture({
  sceneBytes = sceneText, metaBytes = metaText, includeMeta = true,
} = {}) {
  const root = await temporaryRoot("teamforge-wp6-source-");
  const assetFiles = { [scenePath]: sceneBytes };
  if (includeMeta) assetFiles[scenePath + ".meta"] = metaBytes;
  const publication = await publicationFixture(root, { assetFiles });
  const expectedBaseline = pin(publication);
  const args = { publication, expectedBaseline, scenePath, sceneGuid };
  const verify = (changes = {}) => verifyWp6PublishedSceneSource({ ...args, ...changes });
  return { root, ...publication, expectedBaseline, verify };
}
function errorCode(code) {
  return error => {
    assert.equal(error?.code, code, error?.message);
    assert.equal(error?.message?.includes(path.join(tmpdir(), "teamforge-wp6-source-")), false);
    return true;
  };
}

test("WP6 reconstructed Scene and .meta bytes match an Owner-pinned signed Manifest and exact GUID", async () => {
  const f = await fixture();
  try {
    const source = await f.verify();
    assert.equal(source.status, expectedSourceStatus);
    assert.equal(source.projectUuid, f.projectUuid);
    assert.equal(source.baselineRevision, 1);
    assert.equal(source.manifestHash, f.manifest.manifestHash);
    assert.equal(source.descriptorHash, f.descriptor.descriptorHash);
    assert.equal(source.scenePath, scenePath);
    assert.equal(source.sceneGuid, sceneGuid);
    assert.equal(source.sceneFileSha256, sha256(sceneText));
    assert.equal(source.sceneMetaSha256, sha256(metaText));
    assert.equal(source.sceneFileBytes, Buffer.byteLength(sceneText));
    assert(Object.isFrozen(source));
    assert.equal(Object.hasOwn(source, "propertyValues"), false);
    assert.equal(Object.hasOwn(source, "verifiedColliderValues"), false);
  } finally { await cleanup(f.root); }
});

test("WP6 source verification reconstructs a multi-chunk Scene without a full Scene buffer", async () => {
  const bytes = Buffer.from(sceneText + "x".repeat(96_000), "utf8");
  const f = await fixture({ sceneBytes: bytes });
  try {
    const entry = f.manifest.files.find(file => file.path === scenePath);
    assert.equal(entry.chunks.length, 2);
    const source = await f.verify();
    assert.equal(source.sceneFileSha256, sha256(bytes));
    assert.equal(source.sceneFileBytes, bytes.length);
    await assert.rejects(f.verify({ maxSceneBytes: bytes.length - 1 }),
      errorCode("wp6_scene_source_limit"));
    await assert.rejects(f.verify({ maxSceneBytes: 128 * 1024 * 1024 + 1 }),
      errorCode("wp6_scene_source_config_invalid"));
  } finally { await cleanup(f.root); }
});

test("WP6 no .meta entry, wrong GUID, duplicate GUID and malformed metadata all reject", async () => {
  const cases = [
    { input: { includeMeta: false }, code: "wp6_scene_source_missing" },
    { input: { metaBytes: metaText.replace(sceneGuid, otherGuid) }, code: "wp6_scene_guid_mismatch" },
    { input: { metaBytes: metaText + `guid: ${sceneGuid}\n` },
      code: "wp6_scene_meta_invalid" },
    { input: { metaBytes: metaText.replace("fileFormatVersion: 2", "fileFormatVersion: 1") },
      code: "wp6_scene_meta_invalid" },
    { input: { metaBytes: metaText.replace("guid: ", "guid: WRONG_") },
      code: "wp6_scene_meta_invalid" },
    { input: { metaBytes: Buffer.from([0xff, 0xfe, 0xfd]) },
      code: "wp6_scene_meta_invalid" },
  ];
  for (const { input, code } of cases) {
    const f = await fixture(input);
    try { await assert.rejects(f.verify(), errorCode(code)); }
    finally { await cleanup(f.root); }
  }
});

test("WP6 verifier refuses different pinned Owner/Project UUID/Manifest/Descriptor and signed revision", async () => {
  const f = await fixture();
  try {
    const changed = [
      [{ ownerKeyId: "b".repeat(64) }, "untrusted_owner"],
      [{ projectUuid: "d3b67aa1-524b-4d69-b7f3-82448f45770c" }, "project_uuid_mismatch"],
      [{ projectId: "wrong-project" }, "project_id_mismatch"],
      [{ manifestHash: "d".repeat(64) }, "manifest_hash_mismatch"],
      [{ descriptorHash: "a".repeat(64) }, "wp6_scene_baseline_mismatch"],
      [{ baselineRevision: 2 }, "wp6_scene_baseline_mismatch"],
      // An empty UUID previously bypassed equality checks in shared validators.
      [{ projectUuid: "" }, "wp6_scene_baseline_untrusted"],
      [{ projectUuid: "not-a-uuid" }, "wp6_scene_baseline_untrusted"],
    ];
    for (const [patch, code] of changed) {
      await assert.rejects(f.verify({
        expectedBaseline: { ...f.expectedBaseline, ...patch },
      }), errorCode(code));
    }
    await assert.rejects(f.verify({ expectedBaseline: f.descriptor }),
      errorCode("wp6_scene_baseline_untrusted"));
    await assert.rejects(f.verify({ expectedBaseline: {
      ...f.expectedBaseline, extraField: "unexpected",
    } }), errorCode("wp6_scene_baseline_untrusted"));
    await assert.rejects(f.verify({ expectedBaseline: new Proxy(f.expectedBaseline, {}) }),
      errorCode("wp6_scene_baseline_untrusted"));
    const malicious = { ...f.expectedBaseline };
    Object.defineProperty(malicious, "ownerKeyId", {
      enumerable: true, get() { throw Error("owner getter should never run"); },
    });
    await assert.rejects(f.verify({ expectedBaseline: malicious }),
      errorCode("wp6_scene_baseline_untrusted"));
  } finally { await cleanup(f.root); }
});

test("WP6 source input path and Scene GUID are canonical and never used as arbitrary paths", async () => {
  const f = await fixture();
  try {
    for (const badPath of [
      "../private.unity", "Assets/../Outside.unity", "/etc/private.unity",
      "C:\\Windows\\Private.unity", "Assets/Scenes/Prototype.unity/other",
      "Assets//Scenes/Prototype.unity", "Assets/Scenes/prototype.UNITY",
    ]) {
      await assert.rejects(f.verify({ scenePath: badPath }),
        errorCode("wp6_scene_identity_invalid"));
    }
    for (const guid of [otherGuid.toUpperCase(), "0".repeat(32), "", "../foo", undefined]) {
      await assert.rejects(f.verify({ sceneGuid: guid }),
        errorCode("wp6_scene_identity_invalid"));
    }
    await assert.rejects(f.verify({ scenePath: "Assets/Scenes/Another.unity" }),
      errorCode("wp6_scene_source_missing"));
  } finally { await cleanup(f.root); }
});

test("WP6 modified manifest entries or signed descriptor fields cannot launder a different Scene", async () => {
  const f = await fixture();
  try {
    const modifiedSceneFile = structuredClone(f.manifest);
    modifiedSceneFile.files.find(file => file.path === scenePath).fileHash = "c".repeat(64);
    await assert.rejects(f.verify({
      publication: { ...f, manifest: modifiedSceneFile },
    }), errorCode("manifest_hash_mismatch"));
    const changedDescriptor = { ...f.descriptor,
      manifestHash: "e".repeat(64) };
    await assert.rejects(f.verify({
      publication: { ...f, descriptor: changedDescriptor },
    }), errorCode("manifest_hash_mismatch"));
  } finally { await cleanup(f.root); }
});

test("WP6 chunk corruption and missing stored chunks fail rather than reading local source file", async () => {
  const f = await fixture();
  try {
    const scene = f.manifest.files.find(file => file.path === scenePath);
    const chunkPath = f.store.pathForHash(scene.chunks[0].hash);
    await writeFile(chunkPath, Buffer.from("tampered chunk"));
    await assert.rejects(f.verify(), errorCode("invalid_stored_chunk"));
  } finally { await cleanup(f.root); }
  const other = await fixture();
  try {
    const scene = other.manifest.files.find(file => file.path === scenePath);
    await rm(other.store.pathForHash(scene.chunks[0].hash));
    await assert.rejects(other.verify(), errorCode("chunk_unavailable"));
  } finally { await cleanup(other.root); }
});

test("WP6 a rewritten live source Scene does not masquerade as the signed immutable stored baseline", async () => {
  const f = await fixture();
  try {
    // A source workspace may change after publishing. This helper validates
    // published content-addressed bytes, NOT the current editable working file.
    await writeFile(path.join(f.projectRoot, ...scenePath.split("/")),
      "the developer modified the working Scene after publishing");
    const source = await f.verify();
    assert.equal(source.sceneFileSha256, sha256(sceneText));
  } finally { await cleanup(f.root); }
});

test("WP6 untrusted ChunkStore adapters and unsupported Scene sizes cannot bypass verification", async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.verify({ publication: { ...f, store: { read: async () => Buffer.alloc(0) } } }),
      errorCode("wp6_scene_source_config_invalid"));
    await assert.rejects(f.verify({ maxSceneBytes: 0 }),
      errorCode("wp6_scene_source_config_invalid"));
    await assert.rejects(f.verify({ maxSceneBytes: NaN }),
      errorCode("wp6_scene_source_config_invalid"));
    await assert.rejects(f.verify({ publication: new Proxy(f, {}) }),
      errorCode("wp6_scene_source_config_invalid"));
    const accessor = { ...f };
    Object.defineProperty(accessor, "store", { enumerable: true,
      get() { throw Error("do not invoke publication getter"); } });
    await assert.rejects(f.verify({ publication: accessor }),
      errorCode("wp6_scene_source_config_invalid"));
  } finally { await cleanup(f.root); }
});
