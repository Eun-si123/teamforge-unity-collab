import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ChunkStore } from "../src/content-store.mjs";
import { createDescriptor } from "../src/descriptor.mjs";
import { generateIdentity } from "../src/identity.mjs";
import { ManagedProjectStore } from "../src/managed-project.mjs";
import { buildManifest } from "../src/manifest.mjs";
import { cleanup, createUnityProject, temporaryRoot } from "./helpers.mjs";

async function activeFixture(root) {
  const source = path.join(root, "source");
  const projectUuid = randomUUID().toLowerCase();
  await createUnityProject(source, {
    dependencies: { "com.eunsung.teamforge": "file:com.eunsung.teamforge" },
  });
  const packageRoot = path.join(source, "Packages", "com.eunsung.teamforge");
  await mkdir(packageRoot, { recursive: true });
  await writeFile(path.join(packageRoot, "package.json"), `${JSON.stringify({
    name: "com.eunsung.teamforge", version: "0.5.1",
  })}\n`);
  const store = new ChunkStore(path.join(root, "source-chunks"));
  const { manifest } = await buildManifest({
    projectRoot: source,
    projectUuid,
    baselineRevision: 1,
    chunkSize: 65_536,
    store,
  });
  const owner = generateIdentity("Owner");
  const descriptor = createDescriptor({
    projectId: "validated-active",
    projectUuid,
    baselineRevision: 1,
    manifestHash: manifest.manifestHash,
    unityVersion: "6000.3.21f1",
    ownerIdentity: owner,
  });
  const managedRoot = path.join(root, "managed");
  const managed = new ManagedProjectStore({ managedRoot, projectUuid, chunkStore: store });
  const activated = await managed.activate({
    descriptor,
    manifest,
    trustApproval: async () => true,
  });
  const metadataRoot = path.join(managedRoot, projectUuid, "metadata");
  await mkdir(path.join(metadataRoot, "descriptors"), { recursive: true });
  await mkdir(path.join(metadataRoot, "manifests"), { recursive: true });
  await writeFile(
    path.join(metadataRoot, "descriptors", `${descriptor.descriptorHash}.json`),
    `${JSON.stringify(descriptor, null, 2)}\n`,
  );
  await writeFile(
    path.join(metadataRoot, "manifests", `${manifest.manifestHash}.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return { managed, activated, descriptor, manifest, metadataRoot };
}

test("validated Active resolver binds pointer, signed metadata, Unity version, and TeamForge Package", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await activeFixture(root);
    const current = await fixture.managed.validatedCurrent();
    assert.equal(current.activePath, fixture.activated.activePath);
    assert.equal(current.unityVersion, "6000.3.21f1");
    assert.equal(current.descriptor.descriptorHash, fixture.descriptor.descriptorHash);
    assert.equal(current.manifest.manifestHash, fixture.manifest.manifestHash);

    const pointerPath = path.join(fixture.metadataRoot, "current.json");
    const pointer = JSON.parse(await readFile(pointerPath, "utf8"));
    pointer.activeRelativePath = "active/not-content-bound";
    await writeFile(pointerPath, `${JSON.stringify(pointer, null, 2)}\n`);
    await assert.rejects(() => fixture.managed.validatedCurrent(), { code: "invalid_current_pointer" });
  } finally {
    await cleanup(root);
  }
});

test("validated Active resolver rejects a changed embedded TeamForge Package identity", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await activeFixture(root);
    await writeFile(
      path.join(fixture.activated.activePath, "Packages", "com.eunsung.teamforge", "package.json"),
      `${JSON.stringify({ name: "com.eunsung.teamforge", version: "99.0.0" })}\n`,
    );
    await assert.rejects(
      () => fixture.managed.validatedCurrent(),
      { code: "active_teamforge_package_incompatible" },
    );
  } finally {
    await cleanup(root);
  }
});

test("validated Active resolver rejects an intermediate redirected managed-root segment", async (context) => {
  const root = await temporaryRoot();
  try {
    const target = path.join(root, "actual-parent");
    const redirected = path.join(root, "redirected-parent");
    await mkdir(target);
    try {
      await symlink(target, redirected, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
        context.skip(`Filesystem link creation unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    const nestedRoot = path.join(root, "nested-fixture");
    const fixture = await activeFixture(nestedRoot);
    const copiedPointer = JSON.parse(await readFile(path.join(fixture.metadataRoot, "current.json"), "utf8"));
    // Reconstructing the full fixture through a junction keeps the leaf directories ordinary.
    const junctionFixtureRoot = path.join(redirected, "fixture");
    const actualFixtureRoot = path.join(target, "fixture");
    await mkdir(actualFixtureRoot, { recursive: true });
    const sourceFixture = path.dirname(path.dirname(fixture.metadataRoot));
    await cp(sourceFixture, actualFixtureRoot, { recursive: true });
    const projectUuid = copiedPointer.projectUuid;
    const managed = new ManagedProjectStore({
      managedRoot: junctionFixtureRoot,
      projectUuid,
      chunkStore: { async read() { throw new Error("not used"); } },
    });
    await assert.rejects(() => managed.validatedCurrent(), { code: "active_project_reparse_point" });
  } finally {
    await cleanup(root);
  }
});
