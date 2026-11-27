import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdir, readFile } from "node:fs/promises";
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

test("cancelled activation preserves prior Active and can resume after materialization or trust", async (t) => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root);
    const next = withoutFile(fixture, "Assets/Test.txt", 2);
    for (const phase of ["materializing", "trust"]) {
      await t.test(phase, async () => {
        const managedRoot = path.join(root, phase);
        const controller = new AbortController();
        let reads = 0;
        let cancelReads = false;
        let trustCalls = 0;
        const managed = new ManagedProjectStore({
          managedRoot, projectUuid: fixture.projectUuid,
          chunkStore: {
            read: async (...args) => {
              const bytes = await fixture.store.read(...args);
              if (cancelReads && phase === "materializing" && ++reads === 1) controller.abort();
              return bytes;
            },
          },
        });
        const first = await managed.activate({ ...fixture, trustApproval: async () => true });
        const pointerBefore = await readFile(managed.currentPath);
        cancelReads = true;
        let failure;
        await assert.rejects(managed.activate({
          ...next, signal: controller.signal,
          trustApproval: async () => {
            trustCalls += 1;
            if (phase === "trust") controller.abort();
            return true;
          },
        }).catch(error => { failure = error; throw error; }), { code: "download_cancelled" });
        assert.equal((await managed.current()).activePath, first.activePath);
        assert.deepEqual(await readFile(managed.currentPath), pointerBefore);
        assert.equal(trustCalls, phase === "trust" ? 1 : 0);
        if (phase === "materializing") assert.equal(reads, 1, "stop reading after cancellation");
        const status = JSON.parse(await readFile(path.join(failure.details.stagingPath, "status.json"), "utf8"));
        assert.equal(status.code, "download_cancelled");
        const nextActivePath = path.join(managed.activeRoot, `2-${next.manifest.manifestHash.slice(0, 12)}`);
        await assert.rejects(access(nextActivePath), { code: "ENOENT" });
        cancelReads = false;
        const resumed = await managed.activate({ ...next, trustApproval: async () => true });
        assert.equal(resumed.state, "Complete");
        assert.equal((await managed.current()).baselineRevision, 2);
      });
    }
  } finally {
    await cleanup(root);
  }
});

test("an already cancelled activation does not create managed directories or prompt for trust", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root);
    const managed = new ManagedProjectStore({
      managedRoot: path.join(root, "cancel-before-start"),
      projectUuid: fixture.projectUuid, chunkStore: fixture.store,
    });
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(managed.activate({
      ...fixture, signal: controller.signal,
      trustApproval: async () => { assert.fail("cancelled work cannot ask for trust"); },
    }), { code: "download_cancelled" });
    await assert.rejects(access(managed.root), { code: "ENOENT" });
  } finally {
    await cleanup(root);
  }
});

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

test("Guest uncertain filesystem result after Active move is never mislabeled Rejected or silently rolled back", async () => {
  const root=await temporaryRoot();
  try {
    const fixture=await publicationFixture(root);
    const next=withoutFile(fixture,"Assets/Test.txt",2);
    const managed=new ManagedProjectStore({managedRoot:path.join(root,"uncertain-guest"),
      projectUuid:fixture.projectUuid,chunkStore:fixture.store});
    const first=await managed.activate({...fixture,trustApproval:async()=>true});
    const before=await readFile(managed.currentPath);
    const fs=await import("node:fs");
    const {syncBuiltinESMExports}=await import("node:module");
    const originalRename=fs.promises.rename;
    let injected=false;
    try {
      await assert.rejects(managed.activate({...next,trustApproval:async()=>true,
        onActivationCommitStart:()=>{
          fs.promises.rename=async (...args)=>{
            await originalRename(...args);
            if (args[1] === path.join(managed.activeRoot,`2-${next.manifest.manifestHash.slice(0,12)}`)) {
              injected=true;
              const error=new Error("simulated filesystem failure after Active move");
              error.code="EIO";
              throw error;
            }
          };
          syncBuiltinESMExports();
        },
      }),{code:"EIO"});
    } finally {
      fs.promises.rename=originalRename;
      syncBuiltinESMExports();
    }
    assert.equal(injected,true,"fault must occur after the real Active directory move");
    assert.deepEqual(await readFile(managed.currentPath),before,
      "an uncertain move must not silently replace the previous verified current pointer");
    assert.equal((await managed.current()).activePath,first.activePath);
    const {readdir}=await import("node:fs/promises");
    const states=await Promise.all((await readdir(managed.stagingRoot)).map(async folder=>
      JSON.parse(await readFile(path.join(managed.stagingRoot,folder,"status.json"),"utf8"))));
    const status=states.find(value=>value.code==="EIO");
    assert.ok(status,"the uncertain activation must retain a durable diagnostic status");
    assert.equal(status.state,"Activating");
    assert.equal(status.recoveryRequired,true);
    assert.equal(status.code,"EIO");
    await assert.rejects(managed.activate({...next,trustApproval:async()=>true}),{code:"active_revision_exists"});
    assert.equal((await managed.current()).activePath,first.activePath);
  } finally {await cleanup(root);}
});

test("unreviewed activation is a monotonic compare-and-swap: a paused older revision cannot replace a newer one (#651)", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root);
    const managed = new ManagedProjectStore({
      managedRoot: path.join(root, "managed"), projectUuid: fixture.projectUuid, chunkStore: fixture.store,
    });
    await managed.activate({ ...fixture, trustApproval: async () => true });
    const two = withoutFile(fixture, "Assets/Test.txt", 2);
    const three = withoutFile(fixture, "Assets/Test.txt", 3);
    let release;
    const paused = new Promise((resolve) => { release = resolve; });
    let reachedTrust;
    const atTrust = new Promise((resolve) => { reachedTrust = resolve; });
    // Revision 2 pauses at its trust callback without any expectedCurrent.
    const late = managed.activate({ ...two, trustApproval: async () => { reachedTrust(); await paused; return true; } });
    await atTrust;
    const newer = await managed.activate({ ...three, trustApproval: async () => true });
    assert.equal(newer.state, "Complete");
    release();
    await assert.rejects(late, (error) => error.code === "project_update_stale");
    const current = JSON.parse(await readFile(managed.currentPath, "utf8"));
    assert.equal(current.baselineRevision, 3);

    // A direct older or same-revision-different-content activation is refused too.
    await assert.rejects(managed.activate({ ...two, trustApproval: async () => true }),
      (error) => error.code === "project_update_stale");
    const otherThree = withoutFile(fixture, "Packages/manifest.json", 3);
    if (otherThree.manifest.manifestHash !== three.manifest.manifestHash) {
      await assert.rejects(managed.activate({ ...otherThree, trustApproval: async () => true }),
        (error) => error.code === "project_update_stale");
    }
    // The exact same revision stays idempotent.
    const again = await managed.activate({ ...three, trustApproval: async () => true });
    assert.equal(again.alreadyActive, true);
  } finally {
    await cleanup(root);
  }
});

test("competing first activations cannot both become current (#651)", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root);
    const managed = new ManagedProjectStore({
      managedRoot: path.join(root, "managed"), projectUuid: fixture.projectUuid, chunkStore: fixture.store,
    });
    const two = withoutFile(fixture, "Assets/Test.txt", 2);
    let release;
    const paused = new Promise((resolve) => { release = resolve; });
    let reachedTrust;
    const atTrust = new Promise((resolve) => { reachedTrust = resolve; });
    const first = managed.activate({ ...fixture, trustApproval: async () => { reachedTrust(); await paused; return true; } });
    await atTrust;
    assert.equal((await managed.activate({ ...two, trustApproval: async () => true })).baselineRevision, 2);
    release();
    await assert.rejects(first, (error) => error.code === "project_update_stale");
    assert.equal(JSON.parse(await readFile(managed.currentPath, "utf8")).baselineRevision, 2);
  } finally {
    await cleanup(root);
  }
});

test("an incompatible embedded TeamForge Package is refused before it replaces a working Active (#651)", async () => {
  const root = await temporaryRoot();
  try {
    const embedded = (version) => JSON.stringify({ name: "com.eunsung.teamforge", version });
    const { PRODUCT_VERSION } = await import("../src/constants.mjs");
    const first = await publicationFixture(path.join(root, "one"), {
      assetFiles: { "Assets/Test.txt": "one\n", "Packages/com.eunsung.teamforge/package.json": embedded(PRODUCT_VERSION) },
    });
    const second = await publicationFixture(path.join(root, "two"), {
      projectUuid: first.projectUuid, baselineRevision: 2,
      assetFiles: { "Assets/Test.txt": "two\n", "Packages/com.eunsung.teamforge/package.json": embedded("0.5.0") },
    });
    second.descriptor = createDescriptor({ projectId: first.projectId, projectUuid: first.projectUuid, baselineRevision: 2,
      manifestHash: second.manifest.manifestHash, unityVersion: first.descriptor.unityVersion, ownerIdentity: first.owner });
    const chunkStore = { read: (hash, size) => first.store.read(hash, size).catch(() => second.store.read(hash, size)) };
    const managed = new ManagedProjectStore({ managedRoot: path.join(root, "managed"), projectUuid: first.projectUuid, chunkStore });
    await managed.activate({ ...first, trustApproval: async () => true });
    const pointerBefore = await readFile(managed.currentPath);
    const activeBefore = JSON.parse(pointerBefore.toString("utf8")).activeRelativePath;
    let trustPrompted = false;
    await assert.rejects(managed.activate({ ...second, trustApproval: async () => { trustPrompted = true; return true; } }),
      (error) => error.code === "active_teamforge_package_incompatible");
    assert.equal(trustPrompted, false, "an incompatible revision is refused before trust review");
    assert.deepEqual(await readFile(managed.currentPath), pointerBefore);
    await access(path.join(managed.root, ...activeBefore.split("/"))); // previous Active is retained
  } finally {
    await cleanup(root);
  }
});
