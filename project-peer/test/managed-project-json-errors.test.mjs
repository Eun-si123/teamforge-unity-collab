import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ManagedProjectStore } from "../src/managed-project.mjs";
import { buildManifest, calculateManifestHash } from "../src/manifest.mjs";
import { createDescriptor } from "../src/descriptor.mjs";
import { cleanup, publicationFixture, temporaryRoot } from "./helpers.mjs";

const marker = "PRIVATE_MARKER_NOT_JSON"; // Synthetic only, never real credentials.

for (const packageFile of ["manifest.json", "packages-lock.json"]) {
  const relativePath = `Packages/${packageFile}`;

  test(`publishing malformed ${relativePath} does not echo source bytes`, async () => {
    const root = await temporaryRoot();
    try {
      const fixture = await publicationFixture(root);
      await writeFile(path.join(fixture.projectRoot, relativePath), marker);
      let failure;
      await assert.rejects(buildManifest({
        projectRoot: fixture.projectRoot,
        projectUuid: fixture.projectUuid,
        baselineRevision: 2,
        store: fixture.store,
      }).catch(error => { failure = error; throw error; }), {
        code: packageFile === "manifest.json" ? "invalid_packages_manifest" : "invalid_packages_lock",
      });
      assert.equal(failure.message.includes("PRIVATE"), false, "parser text must not escape");
    } finally {
      await cleanup(root);
    }
  });

  test(`activating malformed ${relativePath} does not echo source bytes or change Active`, async () => {
    const root = await temporaryRoot();
    try {
      const fixture = await publicationFixture(root);
      const managed = new ManagedProjectStore({
        managedRoot: path.join(root, "managed"),
        projectUuid: fixture.projectUuid,
        chunkStore: fixture.store,
      });
      const first = await managed.activate({ ...fixture, trustApproval: async () => true });
      const pointerBefore = await readFile(managed.currentPath);
      // Simulate an authenticated, content-hashed baseline carrying malformed JSON.
      // The publisher normally rejects it, but the receiving boundary must still fail safely.
      const bytes = Buffer.from(marker);
      const hash = createHash("sha256").update(bytes).digest("hex");
      await fixture.store.put(bytes, hash);
      const manifest = structuredClone(fixture.manifest);
      manifest.baselineRevision = 2;
      const file = manifest.files.find(entry => entry.path === relativePath);
      assert(file, "fixture must contain target file");
      file.size = bytes.length;
      file.fileHash = hash;
      file.chunks = [{ hash, size: bytes.length, offset: 0 }];
      manifest.totalBytes = manifest.files.reduce((total, entry) => total + entry.size, 0);
      manifest.totalChunks = manifest.files.reduce((total, entry) => total + entry.chunks.length, 0);
      manifest.manifestHash = calculateManifestHash(manifest);
      const descriptor = createDescriptor({
        projectId: fixture.projectId,
        projectUuid: fixture.projectUuid,
        baselineRevision: 2,
        manifestHash: manifest.manifestHash,
        unityVersion: fixture.descriptor.unityVersion,
        ownerIdentity: fixture.owner,
      });
      let failure;
      await assert.rejects(managed.activate({
        descriptor, manifest,
        trustApproval: async () => assert.fail("invalid package metadata must fail before trust"),
      }).catch(error => { failure = error; throw error; }), { code: "invalid_unity_packages" });
      assert.equal(failure.message.includes("PRIVATE"), false, "parser text must not escape in error");
      const statusText = await readFile(path.join(failure.details.stagingPath, "status.json"), "utf8");
      assert.equal(statusText.includes("PRIVATE"), false, "rejected staging status must not persist parser text");
      assert.equal(JSON.parse(statusText).code, "invalid_unity_packages");
      assert.deepEqual(await readFile(managed.currentPath), pointerBefore);
      assert.equal((await managed.current()).activePath, first.activePath);
    } finally {
      await cleanup(root);
    }
  });
}


test("malformed embedded Packages package.json does not echo source bytes", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root);
    const embeddedRoot = path.join(fixture.projectRoot, "Packages", "com.example.test");
    await mkdir(embeddedRoot, { recursive: true });
    await writeFile(path.join(embeddedRoot, "package.json"), marker);
    let failure;
    await assert.rejects(buildManifest({
      projectRoot: fixture.projectRoot,
      projectUuid: fixture.projectUuid,
      baselineRevision: 2,
      store: fixture.store,
    }).catch(error => { failure = error; throw error; }), { code: "invalid_embedded_package" });
    assert.equal(failure.message.includes("PRIVATE"), false, "embedded parser text must not escape");
  } finally {
    await cleanup(root);
  }
});
