import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ManagedProjectStore } from "../src/managed-project.mjs";
import { calculateManifestHash } from "../src/manifest.mjs";
import { createDescriptor } from "../src/descriptor.mjs";
import { cleanup, publicationFixture, temporaryRoot } from "./helpers.mjs";

function withoutFile(fixture, relativePath, revision) {
  const manifest = structuredClone(fixture.manifest);
  manifest.baselineRevision = revision;
  manifest.files = manifest.files.filter((file) => file.path !== relativePath);
  manifest.totalFiles = manifest.files.length;
  manifest.totalBytes = manifest.files.reduce((total, file) => total + file.size, 0);
  manifest.totalChunks = manifest.files.reduce((total, file) => total + file.chunks.length, 0);
  manifest.manifestHash = calculateManifestHash(manifest);
  const descriptor = createDescriptor({
    projectId: fixture.projectId,
    projectUuid: fixture.projectUuid,
    baselineRevision: revision,
    manifestHash: manifest.manifestHash,
    unityVersion: fixture.descriptor.unityVersion,
    ownerIdentity: fixture.owner,
  });
  return { manifest, descriptor };
}

test("managed activation retains AwaitingTrust, then atomically activates with a secret-free Unity descriptor", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root);
    const managedRoot = path.join(root, "managed");
    const managed = new ManagedProjectStore({
      managedRoot, projectUuid: fixture.projectUuid, chunkStore: fixture.store,
    });
    const awaiting = await managed.activate({
      descriptor: fixture.descriptor,
      manifest: fixture.manifest,
      trustApproval: async () => false,
      sourcePeers: ["seed-a"],
    });
    assert.equal(awaiting.state, "AwaitingTrust");
    assert.equal((await managed.current()), null);
    assert.equal(JSON.parse(await readFile(path.join(awaiting.stagingPath, "status.json"), "utf8")).state, "AwaitingTrust");

    const activated = await managed.activate({
      descriptor: fixture.descriptor,
      manifest: fixture.manifest,
      trustApproval: async () => true,
      sourcePeers: ["seed-a"],
    });
    assert.equal(activated.state, "Complete");
    const current = await managed.current();
    assert.equal(current.manifestHash, fixture.manifest.manifestHash);
    assert.equal(current.activePath, activated.activePath);
    const unityDescriptor = JSON.parse(await readFile(
      path.join(activated.activePath, "ProjectSettings", "TeamForgeProject.json"), "utf8",
    ));
    assert.deepEqual(Object.keys(unityDescriptor).sort(), [
      "baselineRevision", "descriptorHash", "manifestHash", "manifestSchemaVersion", "projectUuid",
      "realtimeProtocolVersion", "schemaVersion", "teamForgePackageVersion", "transferProtocolVersion",
      "unityVersion",
    ]);
    assert.equal(unityDescriptor.projectUuid, fixture.projectUuid);
    assert.equal(unityDescriptor.baselineRevision, 1);
    const serialized = JSON.stringify(unityDescriptor).toLowerCase();
    for (const forbidden of ["private", "token", "authorization", "activepath", root.toLowerCase()]) {
      assert.equal(serialized.includes(forbidden), false);
    }

    const repeated = await managed.activate({
      descriptor: fixture.descriptor,
      manifest: fixture.manifest,
      trustApproval: async () => { throw new Error("should not prompt"); },
    });
    assert.equal(repeated.alreadyActive, true);
  } finally {
    await cleanup(root);
  }
});

test("failed verification retains staging and preserves the prior Active pointer", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root);
    const managed = new ManagedProjectStore({
      managedRoot: path.join(root, "managed"), projectUuid: fixture.projectUuid, chunkStore: fixture.store,
    });
    const first = await managed.activate({
      descriptor: fixture.descriptor,
      manifest: fixture.manifest,
      trustApproval: async () => true,
    });
    const invalid = withoutFile(fixture, "Packages/manifest.json", 2);
    let failure;
    await assert.rejects(async () => {
      try {
        await managed.activate({ ...invalid, trustApproval: async () => true });
      } catch (error) {
        failure = error;
        throw error;
      }
    }, { code: "invalid_unity_project" });
    assert(failure.details.stagingPath);
    assert.equal(JSON.parse(await readFile(
      path.join(failure.details.stagingPath, "status.json"), "utf8",
    )).state, "Rejected");
    const current = await managed.current();
    assert.equal(current.activePath, first.activePath);
    assert.equal(current.baselineRevision, 1);

    const missingLock = withoutFile(fixture, "Packages/packages-lock.json", 3);
    let lockFailure;
    await assert.rejects(async () => {
      try {
        await managed.activate({ ...missingLock, trustApproval: async () => true });
      } catch (error) {
        lockFailure = error;
        throw error;
      }
    }, { code: "invalid_unity_project" });
    assert(lockFailure.details.stagingPath);
    assert.equal((await managed.current()).activePath, first.activePath);
  } finally {
    await cleanup(root);
  }
});

test("activation never overwrites a pre-existing Active revision directory", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root);
    const managedRoot = path.join(root, "managed");
    const activeName = `1-${fixture.manifest.manifestHash.slice(0, 12)}`;
    const preexisting = path.join(managedRoot, fixture.projectUuid, "active", activeName);
    await mkdir(preexisting, { recursive: true });
    const managed = new ManagedProjectStore({ managedRoot, projectUuid: fixture.projectUuid, chunkStore: fixture.store });
    await assert.rejects(() => managed.activate({
      descriptor: fixture.descriptor,
      manifest: fixture.manifest,
      trustApproval: async () => true,
    }), { code: "active_revision_exists" });
    assert.equal(await managed.current(), null);
  } finally {
    await cleanup(root);
  }
});
