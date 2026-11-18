import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { lstat, mkdir, readFile, rename, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { ManagedProjectStore } from "../src/managed-project.mjs";
import { inspectWp6ActiveSceneProvenance } from "../src/wp6-active-scene-provenance.mjs";
import { cleanup, publicationFixture, temporaryRoot } from "./helpers.mjs";

const scenePath = "Assets/Scenes/Proof.unity";
const sceneGuid = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const scene = Buffer.from("%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!1 &123\nGameObject:\n  m_Name: Active\n");
const meta = Buffer.from("fileFormatVersion: 2\nguid: " + sceneGuid + "\nDefaultImporter:\n  externalObjects: {}\n");
const sha256 = data => createHash("sha256").update(data).digest("hex");

async function fixture(assetFiles = { [scenePath]: scene, [scenePath + ".meta"]: meta }) {
  const root = await temporaryRoot("teamforge-wp6-active-");
  const publication = await publicationFixture(root, { assetFiles: {
    ...assetFiles,
    "Packages/com.eunsung.teamforge/package.json": JSON.stringify({
      name: "com.eunsung.teamforge", version: "0.5.1",
    }),
  } });
  const managedRoot = path.join(root, "managed");
  const managed = new ManagedProjectStore({
    managedRoot, projectUuid: publication.projectUuid,
    chunkStore: publication.store,
  });
  await managed.activate({ ...publication, trustApproval: async () => true });
  // The real Project Peer engine persists independently signed, content-
  // addressed Descriptor/Manifest metadata before activating a project;
  // the bare ManagedProjectStore test fixture does not do so by itself.
  const descriptorDir = path.join(managed.metadataRoot, "descriptors");
  const manifestDir = path.join(managed.metadataRoot, "manifests");
  await mkdir(descriptorDir, { recursive: true });
  await mkdir(manifestDir, { recursive: true });
  await writeFile(path.join(descriptorDir, publication.descriptor.descriptorHash + ".json"),
    JSON.stringify(publication.descriptor));
  await writeFile(path.join(manifestDir, publication.manifest.manifestHash + ".json"),
    JSON.stringify(publication.manifest));
  return { root, managedRoot, managed, publication };
}
function summary(f) {
  return inspectWp6ActiveSceneProvenance({
    managed: f.managed, scenePath, sceneGuid,
  });
}

test("WP6 Active source reads actual complete signed Project Peer Scene and .meta without editing", async () => {
  const f = await fixture();
  try {
    const active = await f.managed.validatedCurrent();
    const oldScene = await readFile(path.join(active.activePath, scenePath));
    const oldMeta = await readFile(path.join(active.activePath, scenePath + ".meta"));
    const result = await summary(f);
    assert(Object.isFrozen(result));
    assert.equal(result.status, "signed_active_scene_file_bytes_verified_local");
    assert.equal(result.projectUuid, f.publication.projectUuid);
    assert.equal(result.baselineRevision, 1);
    assert.equal(result.manifestHash, f.publication.manifest.manifestHash);
    assert.equal(result.descriptorHash, f.publication.descriptor.descriptorHash);
    assert.equal(result.ownerKeyId, f.publication.descriptor.ownerKeyId);
    assert.equal(result.publisherKeyId, f.publication.descriptor.publisherKeyId);
    assert.equal(result.scenePath, scenePath);
    assert.equal(result.sceneFileSha256, sha256(scene));
    assert.equal(result.sceneMetaSha256, sha256(meta));
    assert.equal(result.sceneFileBytes, scene.length);
    assert.equal(result.manifestMembershipVerified, true);
    assert.equal(result.signedActiveFileBytesVerified, true);
    for (const key of ["inspectorValuesVerified", "currentServerSessionVerified",
      "editorApplyVerified", "networkWriteAuthorized"])
      assert.equal(result[key], false);
    assert.deepEqual(await readFile(path.join(active.activePath, scenePath)), oldScene);
    assert.deepEqual(await readFile(path.join(active.activePath, scenePath + ".meta")), oldMeta);
    assert.equal((await lstat(active.activePath)).isDirectory(), true);
  } finally { await cleanup(f.root); }
});

test("WP6 real CLI prints only local read-only source summary and no client identity", async () => {
  const f = await fixture();
  try {
    const cli = fileURLToPath(new URL("../src/cli.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [
      cli, "wp6-scene-source", "--managed-root", f.managedRoot,
      "--project-uuid", f.publication.projectUuid,
      "--scene-path", scenePath, "--scene-guid", sceneGuid,
    ], { encoding: "utf8", timeout: 20_000 });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "signed_active_scene_file_bytes_verified_local");
    assert.equal(output.sceneFileSha256, sha256(scene));
    assert.equal(output.networkWriteAuthorized, false);
    const identity = path.join(f.managedRoot, "peer-client.json");
    await assert.rejects(readFile(identity), { code: "ENOENT" });
    assert(!result.stdout.includes("privateKey"));
    assert(!result.stdout.includes(f.managedRoot));
  } finally { await cleanup(f.root); }
});

test("WP6 changed Active Scene bytes or metadata cannot receive a valid source summary", async () => {
  for (const file of [scenePath, scenePath + ".meta"]) {
    const f = await fixture();
    try {
      const active = await f.managed.validatedCurrent();
      const target = path.join(active.activePath, file);
      await writeFile(target, Buffer.from("spoofed bytes\n"));
      await assert.rejects(summary(f), { code: "wp6_active_scene_source_invalid" });
    } finally { await cleanup(f.root); }
  }
});

test("WP6 Scene path, GUID, absent signed Meta or an unpublished Active Project fail closed", async () => {
  const f = await fixture();
  try {
    for (const invalid of [
      "../Assets/Scenes/Proof.unity", "/etc/passwd", "Assets/../Scenes/Proof.unity",
      "Assets/Scenes/Proof.unity.meta", "Assets\\Scenes\\Proof.unity",
      "Assets/Scenes/Other.unity",
    ]) {
      await assert.rejects(
        inspectWp6ActiveSceneProvenance({
          managed: f.managed, scenePath: invalid, sceneGuid,
        }), { code: "wp6_active_scene_source_invalid" });
    }
    for (const invalid of [sceneGuid.toUpperCase(), "00000000000000000000000000000000", "z".repeat(32)]) {
      await assert.rejects(
        inspectWp6ActiveSceneProvenance({
          managed: f.managed, scenePath, sceneGuid: invalid,
        }), { code: "wp6_active_scene_source_invalid" });
    }
  } finally { await cleanup(f.root); }
  const root = await temporaryRoot();
  try {
    const pub = await publicationFixture(root);
    const managed = new ManagedProjectStore({
      managedRoot: path.join(root, "managed"), projectUuid: pub.projectUuid,
      chunkStore: pub.store,
    });
    await assert.rejects(inspectWp6ActiveSceneProvenance({
      managed, scenePath, sceneGuid,
    }), { code: "wp6_active_scene_source_invalid" });
  } finally { await cleanup(root); }
});

test("WP6 signed but missing, forged or duplicate Unity .meta GUID is rejected", async () => {
  for (const invalidMeta of [
    "fileFormatVersion: 2\n",
    "guid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n",
    "guid: " + sceneGuid + "\nguid: " + sceneGuid + "\n",
    "guid: " + sceneGuid + "\n  guid: " + sceneGuid + "\n",
    "guid: " + sceneGuid.toUpperCase() + "\n",
  ]) {
    const f = await fixture({
      [scenePath]: scene,
      [scenePath + ".meta"]: Buffer.from(invalidMeta),
    });
    try {
      await assert.rejects(summary(f), { code: "wp6_active_scene_source_invalid" });
    } finally { await cleanup(f.root); }
  }
});

test("WP6 Active Scene symlink replacement cannot escape Active Project", async () => {
  const f = await fixture();
  try {
    const active = await f.managed.validatedCurrent();
    const target = path.join(active.activePath, scenePath);
    await rename(target, target + ".saved");
    await symlink(path.join(f.root, "source-project", scenePath), target);
    await assert.rejects(summary(f), { code: "wp6_active_scene_source_invalid" });
  } finally { await cleanup(f.root); }
});

test("WP6 signed but binary or unsupported Unity Scene bytes do not become source proof", async () => {
  for (const bad of [Buffer.from("not a Unity Scene"), Buffer.from([0, 255, 0, 65])]) {
    const f = await fixture({ [scenePath]: bad, [scenePath + ".meta"]: meta });
    try { await assert.rejects(summary(f), { code: "wp6_active_scene_source_invalid" }); }
    finally { await cleanup(f.root); }
  }
});

test("WP6 changed signed Descriptor metadata invalidates active source provenance", async () => {
  const f = await fixture();
  try {
    const metadata = path.join(f.managed.metadataRoot, "descriptors",
      f.publication.descriptor.descriptorHash + ".json");
    const tampered = { ...f.publication.descriptor, manifestHash: "f".repeat(64) };
    await writeFile(metadata, JSON.stringify(tampered));
    await assert.rejects(summary(f), { code: "wp6_active_scene_source_invalid" });
  } finally { await cleanup(f.root); }
});

test("WP6 Active pointer rotation between reads refuses stale signed file hashes", async () => {
  const f = await fixture();
  try {
    const original = f.managed.validatedCurrent.bind(f.managed);
    let calls = 0;
    f.managed.validatedCurrent = async () => {
      const current = await original();
      if (++calls === 2) return {
        ...current, baselineRevision: current.baselineRevision + 1,
      };
      return current;
    };
    await assert.rejects(summary(f), { code: "wp6_active_scene_source_invalid" });
  } finally { await cleanup(f.root); }
});
