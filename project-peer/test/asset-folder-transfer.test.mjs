import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { ChunkStore } from "../src/content-store.mjs";
import { buildManifest, validateManifest } from "../src/manifest.mjs";
import { cleanup, createUnityProject, temporaryRoot } from "./helpers.mjs";

// Some imported Unity Asset Store packages contain source directories named
// Library, Build, or Temp. The presence of a corresponding Unity folder .meta
// is evidence that the directory is a managed Asset, not a root build cache.
test("imported Unity folders with regular .meta preserve nested Prefabs and textures", async () => {
  const root = await temporaryRoot("tf-imported-folder-");
  try {
    const source = path.join(root, "source");
    const prefab = "%YAML 1.1\nGameObject: ImportedCharacter\n";
    const texture = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    await createUnityProject(source, { assetFiles: {
      "Assets/Vendor/Library/Characters/Imported.prefab": prefab,
      "Assets/Vendor/Library/Characters/Imported.prefab.meta": "fileFormatVersion: 2\nguid: abc123\n",
      "Assets/Vendor/Build/Textures/Skin.png": texture,
      "Assets/Vendor/Temp/generated.bin": "unmanaged output must remain excluded",
      "Assets/Vendor/Library/.env": "SYNTHETIC_DO_NOT_TRANSFER",
      "Assets/Vendor/Library/node_modules/unsafe.txt": "SYNTHETIC_DO_NOT_TRANSFER",
    } });
    await writeFile(path.join(source, "Assets", "Vendor", "Library.meta"), "fileFormatVersion: 2\nguid: library123\n");
    await writeFile(path.join(source, "Assets", "Vendor", "Build.meta"), "fileFormatVersion: 2\nguid: build123\n");
    const store = new ChunkStore(path.join(root, "chunks"));
    const { manifest } = await buildManifest({
      projectRoot: source, projectUuid: randomUUID(), baselineRevision: 1, store,
    });
    validateManifest(manifest, { expectedManifestHash: manifest.manifestHash });
    const names = new Set(manifest.files.map(file => file.path));
    for (const expected of [
      "Assets/Vendor/Library.meta", "Assets/Vendor/Build.meta",
      "Assets/Vendor/Library/Characters/Imported.prefab",
      "Assets/Vendor/Library/Characters/Imported.prefab.meta",
      "Assets/Vendor/Build/Textures/Skin.png",
    ]) assert(names.has(expected), `Unity imported Asset missing: ${expected}`);
    for (const forbidden of [
      "Assets/Vendor/Temp/generated.bin", "Assets/Vendor/Library/.env",
      "Assets/Vendor/Library/node_modules/unsafe.txt",
    ]) assert.equal(names.has(forbidden), false, `Unexpected publication of ${forbidden}`);
    const prefabFile = manifest.files.find(file => file.path.endsWith("/Imported.prefab"));
    const textureFile = manifest.files.find(file => file.path.endsWith("/Skin.png"));
    assert.equal((await store.read(prefabFile.chunks[0].hash, prefabFile.size)).toString("utf8"), prefab);
    assert.deepEqual(await store.read(textureFile.chunks[0].hash, textureFile.size), texture);
  } finally { await cleanup(root); }
});

test("generated-name directories without Unity folder metadata stay excluded", async () => {
  const root = await temporaryRoot("tf-unmanaged-folder-");
  try {
    const source = path.join(root, "source");
    await createUnityProject(source, { assetFiles: {
      "Assets/Vendor/Library/Unmanaged.bin": "must not publish without folder metadata",
      "Assets/Vendor/Build/Output.bin": "must not publish without folder metadata",
      "Assets/Ordinary/Normal.prefab": "safe normal prefab",
    } });
    const { manifest } = await buildManifest({
      projectRoot: source, projectUuid: randomUUID(), baselineRevision: 1,
      store: new ChunkStore(path.join(root, "chunks")),
    });
    const names = manifest.files.map(file => file.path);
    assert(names.includes("Assets/Ordinary/Normal.prefab"));
    assert(!names.includes("Assets/Vendor/Library/Unmanaged.bin"));
    assert(!names.includes("Assets/Vendor/Build/Output.bin"));
  } finally { await cleanup(root); }
});