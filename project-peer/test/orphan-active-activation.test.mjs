import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import filesystem, { cp, link, lstat, readFile, readdir, rename, symlink, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import test from "node:test";
import { createDescriptor } from "../src/descriptor.mjs";
import { ManagedProjectStore } from "../src/managed-project.mjs";
import { buildManifest } from "../src/manifest.mjs";
import { cleanup, publicationFixture, temporaryRoot } from "./helpers.mjs";

const approve = async () => true;
const localWork = "existing local changes\n";
const nextAsset = "next signed baseline\n";
const crashReleased = process.platform === "linux" || process.platform === "win32";

async function publishRevision(fixture, baselineRevision) {
  const { manifest } = await buildManifest({
    projectRoot: fixture.projectRoot,
    projectUuid: fixture.projectUuid,
    baselineRevision,
    chunkSize: fixture.manifest.chunkSize,
    store: fixture.store,
  });
  const descriptor = createDescriptor({
    projectId: fixture.projectId,
    projectUuid: fixture.projectUuid,
    baselineRevision,
    manifestHash: manifest.manifestHash,
    unityVersion: fixture.descriptor.unityVersion,
    ownerIdentity: fixture.owner,
  });
  return { manifest, descriptor };
}

async function activationFixture(t, { interruption = "after rename" } = {}) {
  const root = await temporaryRoot("teamforge-orphan-active-");
  t.after(() => cleanup(root));
  const fixture = await publicationFixture(root);
  const managedRoot = path.join(root, "managed");
  const managed = new ManagedProjectStore({
    managedRoot, projectUuid: fixture.projectUuid, chunkStore: fixture.store,
  });
  const first = await managed.activate({ ...fixture, trustApproval: approve });
  const priorPointer = await readFile(managed.currentPath);
  const priorAssetPath = path.join(first.activePath, "Assets", "Test.txt");
  await writeFile(priorAssetPath, localWork);
  await writeFile(path.join(fixture.projectRoot, "Assets", "Test.txt"), nextAsset);
  const next = await publishRevision(fixture, 2);
  const activeName = `2-${next.manifest.manifestHash.slice(0, 12)}`;
  const activePath = path.join(managed.activeRoot, activeName);
  const assetPath = path.join(activePath, "Assets", "Test.txt");
  const intentPath = path.join(managed.metadataRoot, `activation-${activeName}.json`);

  if (interruption === "legacy restored pointer") {
    // Reproduce the original simulated report without an interrupted transaction.
    await managed.activate({ ...next, trustApproval: approve });
    await writeFile(managed.currentPath, priorPointer);
  } else if (interruption === "after rename") {
    // Model interrupted completion while running the actual rename and normal
    // exception unwinding. A separate test kills the process at this boundary.
    const realRename = filesystem.rename;
    const mocked = t.mock.method(filesystem, "rename", async (source, destination) => {
      await realRename(source, destination);
      if (destination === activePath) {
        throw Object.assign(new Error("Injected error immediately after Active rename"), { code: "EIO" });
      }
    });
    syncBuiltinESMExports();
    try {
      await assert.rejects(managed.activate({ ...next, trustApproval: approve }), { code: "EIO" });
    } finally {
      mocked.mock.restore();
      syncBuiltinESMExports();
    }
  }

  let cacheReads = 0;
  const retry = new ManagedProjectStore({
    managedRoot, projectUuid: fixture.projectUuid,
    chunkStore: { read: async () => { cacheReads += 1; assert.fail("orphan retry must not read chunks"); } },
  });
  return {
    root, fixture, managedRoot, managed, next, activePath, assetPath, intentPath, priorAssetPath, priorPointer, retry,
    cacheReads: () => cacheReads,
  };
}

async function assertPriorActive(fixture) {
  assert.deepEqual(await readFile(fixture.managed.currentPath), fixture.priorPointer);
  assert.equal(await readFile(fixture.priorAssetPath, "utf8"), localWork);
}

async function assertNoStagedProject(fixture) {
  assert.equal(fixture.cacheReads(), 0);
  for (const entry of await readdir(fixture.retry.stagingRoot)) {
    await assert.rejects(lstat(path.join(fixture.retry.stagingRoot, entry, "project")), { code: "ENOENT" });
  }
}

async function killAtRename(fixture, stopPath, afterRename) {
  const { managedRoot, next, root } = fixture;
  const inputPath = path.join(root, "child-input.json");
  await writeFile(inputPath, JSON.stringify({
    managedRoot, next, stopPath, afterRename, chunkRoot: fixture.fixture.store.root,
  }));
  const managedModule = new URL("../src/managed-project.mjs", import.meta.url).href;
  const chunksModule = new URL("../src/content-store.mjs", import.meta.url).href;
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import filesystem from "node:fs/promises";
    import { syncBuiltinESMExports } from "node:module";
    const { managedRoot, next, stopPath, afterRename, chunkRoot } = JSON.parse(await filesystem.readFile(process.argv[1]));
    const rename = filesystem.rename;
    filesystem.rename = async (source, destination) => {
      if (destination !== stopPath || afterRename) await rename(source, destination);
      if (destination !== stopPath) return;
      process.send({ source, destination });
      await new Promise(() => setInterval(() => {}, 1000));
    };
    syncBuiltinESMExports();
    const { ManagedProjectStore } = await import(${JSON.stringify(managedModule)});
    const { ChunkStore } = await import(${JSON.stringify(chunksModule)});
    const managed = new ManagedProjectStore({
      managedRoot, projectUuid: next.descriptor.projectUuid, chunkStore: new ChunkStore(chunkRoot),
    });
    await managed.activate({ ...next, trustApproval: async () => true });
  `, inputPath], { stdio: ["ignore", "ignore", "inherit", "ipc"] });
  const exited = once(child, "exit");
  try {
    const [message] = await Promise.race([
      once(child, "message", { signal: AbortSignal.timeout(15_000) }),
      exited.then(([code, signal]) => assert.fail(`activation stopped before the planned boundary (${code}, ${signal})`)),
    ]);
    assert.equal(message.destination, stopPath);
    assert.equal(child.kill("SIGKILL"), true);
    assert.deepEqual(await exited, [null, "SIGKILL"]);
    return message.source;
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
  }
}

test("a proven signed orphan becomes current without replacing either Active tree (#648)", async (t) => {
  const fixture = await activationFixture(t);
  const { retry, next, activePath, assetPath, priorAssetPath } = fixture;
  const before = await lstat(assetPath, { bigint: true });
  const activeEntries = (await readdir(retry.activeRoot)).sort();
  const events = [];
  const activation = await retry.activate({
    ...next,
    expectedCurrent: JSON.parse(fixture.priorPointer),
    trustApproval: async (summary) => {
      assert.equal(summary.manifestHash, next.manifest.manifestHash);
      assert.equal(summary.publisherKeyId, next.descriptor.publisherKeyId);
      events.push("approved");
      return true;
    },
    verifyActivationPublication: () => events.push("publication checked"),
    onActivationCommitStart: () => events.push("commit started"),
  });
  assert.equal(activation.state, "Complete");
  assert.equal(activation.activePath, activePath);
  assert.equal((await retry.current()).descriptorHash, next.descriptor.descriptorHash);
  assert.deepEqual(events, ["approved", "publication checked", "commit started"]);
  assert.deepEqual((await readdir(retry.activeRoot)).sort(), activeEntries);
  const after = await lstat(assetPath, { bigint: true });
  assert.equal(after.dev, before.dev);
  assert.equal(after.ino, before.ino);
  assert.equal(after.mtimeNs, before.mtimeNs);
  assert.equal(await readFile(assetPath, "utf8"), nextAsset);
  assert.equal(await readFile(priorAssetPath, "utf8"), localWork);
  await assertNoStagedProject(fixture);
});

test("a pristine legacy Active revision without an interrupted transaction stays untouched (#648)", async (t) => {
  const fixture = await activationFixture(t, { interruption: "legacy restored pointer" });
  const { retry, next, assetPath } = fixture;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(retry.activate({ ...next, trustApproval: approve }), { code: "active_revision_exists" });
  }
  await assertPriorActive(fixture);
  assert.equal(await readFile(assetPath, "utf8"), nextAsset);
  await assertNoStagedProject(fixture);
});

test("an ENOSPC pointer commit preserves the prior Active and leaves the signed candidate recoverable (#648)", async (t) => {
  const fixture = await activationFixture(t, { interruption: "pointer I/O failure" });
  const { managed, next, assetPath, intentPath, retry } = fixture;
  const realRename = filesystem.rename;
  const mocked = t.mock.method(filesystem, "rename", async (source, destination) => {
    if (destination === managed.currentPath) {
      throw Object.assign(new Error("Injected full filesystem at pointer commit"), { code: "ENOSPC" });
    }
    await realRename(source, destination);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(managed.activate({ ...next, trustApproval: approve }), { code: "ENOSPC" });
  } finally {
    mocked.mock.restore();
    syncBuiltinESMExports();
  }
  await assertPriorActive(fixture);
  assert.equal(await readFile(assetPath, "utf8"), nextAsset);
  assert.equal((await lstat(intentPath)).isFile(), true);
  assert.equal((await readdir(managed.metadataRoot)).some((name) => name.startsWith("current.json.")), false);

  await retry.activate({ ...next, trustApproval: approve });
  assert.equal((await retry.current()).descriptorHash, next.descriptor.descriptorHash);
  await assert.rejects(lstat(intentPath), { code: "ENOENT" });
  await assertNoStagedProject(fixture);
});

test("an edited, augmented, or redirected Active candidate stays untouched (#648)", async (t) => {
  const cases = {
    "same-size edit": async ({ assetPath }) => {
      const edited = Buffer.from(nextAsset);
      edited[0] = "N".charCodeAt(0);
      await writeFile(assetPath, edited);
      return async () => assert.deepEqual(await readFile(assetPath), edited);
    },
    "extra local file": async ({ activePath }) => {
      const extra = path.join(activePath, "Assets", "Unsynced.txt");
      await writeFile(extra, localWork);
      return async () => assert.equal(await readFile(extra, "utf8"), localWork);
    },
    "hard link to a signed file outside Active": async ({ root, assetPath }) => {
      const externalAsset = path.join(root, "external.txt");
      await rename(assetPath, externalAsset);
      await link(externalAsset, assetPath);
      return async () => {
        assert.equal(await readFile(externalAsset, "utf8"), nextAsset);
        assert.equal((await lstat(assetPath)).nlink, 2);
      };
    },
    "redirected Active directory": async ({ root, activePath }) => {
      const externalProject = path.join(root, "external-project");
      await rename(activePath, externalProject);
      await symlink(externalProject, activePath, "junction");
      return async () => assert.equal((await lstat(activePath)).isSymbolicLink(), true);
    },
    "a replacement directory with identical contents": async ({ root, activePath, assetPath }) => {
      const original = path.join(root, "original-project");
      await rename(activePath, original);
      await cp(original, activePath, { recursive: true, preserveTimestamps: true });
      return async () => assert.equal(await readFile(assetPath, "utf8"), nextAsset);
    },
    "corrupt interrupted transaction metadata": async ({ intentPath }) => {
      const corrupt = "{ malformed json\n";
      await writeFile(intentPath, corrupt);
      return async () => assert.equal(await readFile(intentPath, "utf8"), corrupt);
    },
    "transaction references a missing staging attempt": async ({ intentPath }) => {
      const intent = JSON.parse(await readFile(intentPath, "utf8"));
      const changed = JSON.stringify({ ...intent, downloadId: randomUUID() });
      await writeFile(intentPath, changed);
      return async () => assert.equal(await readFile(intentPath, "utf8"), changed);
    },
  };
  for (const [name, change] of Object.entries(cases)) {
    await t.test(name, async (t) => {
      const fixture = await activationFixture(t);
      const assertUnchanged = await change(fixture);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await assert.rejects(fixture.retry.activate({ ...fixture.next, trustApproval: approve }),
          { code: "active_revision_exists" });
      }
      await assertPriorActive(fixture);
      await assertUnchanged();
      await assertNoStagedProject(fixture);
    });
  }
});

test("trust denial, cancellation, and stale publication preserve the candidate and prior pointer (#648)", async (t) => {
  const fixture = await activationFixture(t);
  const { retry, next, assetPath } = fixture;
  const beforeCommit = () => assert.fail("unapproved or stale recovery cannot start its commit");
  const denied = await retry.activate({
    ...next, trustApproval: async () => false, onActivationCommitStart: beforeCommit,
  });
  assert.equal(denied.state, "AwaitingTrust");
  assert.equal(denied.approved, false);
  await assertPriorActive(fixture);

  const controller = new AbortController();
  await assert.rejects(retry.activate({
    ...next, signal: controller.signal, onActivationCommitStart: beforeCommit,
    trustApproval: async () => { controller.abort(); return true; },
  }), { code: "download_cancelled" });
  await assertPriorActive(fixture);

  await assert.rejects(retry.activate({
    ...next, trustApproval: approve, onActivationCommitStart: beforeCommit,
    verifyActivationPublication: () => {
      throw Object.assign(new Error("The Host published another revision"), { code: "project_update_stale" });
    },
  }), { code: "project_update_stale" });
  await assertPriorActive(fixture);
  assert.equal(await readFile(assetPath, "utf8"), nextAsset);
  await assertNoStagedProject(fixture);
});

test("a file changed during approval prevents orphan recovery (#648)", async (t) => {
  const fixture = await activationFixture(t);
  const { retry, next, assetPath } = fixture;
  const edited = nextAsset.replace("next", "Next");
  await assert.rejects(retry.activate({
    ...next,
    trustApproval: async () => { await writeFile(assetPath, edited); return true; },
    onActivationCommitStart: () => assert.fail("modified candidate cannot start its commit"),
  }), { code: "active_revision_exists" });
  await assertPriorActive(fixture);
  assert.equal(await readFile(assetPath, "utf8"), edited);
  await assertNoStagedProject(fixture);
});

test("orphan recovery cannot replace a newer revision activated during approval (#648)", async (t) => {
  const fixture = await activationFixture(t);
  const third = await publishRevision(fixture.fixture, 3);
  await assert.rejects(fixture.retry.activate({
    ...fixture.next,
    trustApproval: async () => {
      await fixture.managed.activate({ ...third, trustApproval: approve });
      return true;
    },
    onActivationCommitStart: () => assert.fail("stale candidate cannot start its commit"),
  }), { code: "project_update_stale" });
  assert.equal((await fixture.managed.current()).descriptorHash, third.descriptor.descriptorHash);
  assert.equal(await readFile(fixture.assetPath, "utf8"), nextAsset);
  assert.equal(await readFile(fixture.priorAssetPath, "utf8"), localWork);
  await assertNoStagedProject(fixture);
});

test("a retry recovers after a real subprocess kill following the Active rename (#648)",
  { skip: !crashReleased && "no crash-released OS mutex on this platform" }, async (t) => {
    const fixture = await activationFixture(t, { interruption: "kill from child" });
    const { managed, next, activePath, assetPath, retry } = fixture;
    await killAtRename(fixture, activePath, true);
    assert.equal(await readFile(assetPath, "utf8"), nextAsset);
    await assertPriorActive(fixture);
    assert.match(await readFile(managed.activationLockPath, "utf8"), /teamforge-process-bound-lock/u);
    const recovered = await retry.activate({ ...next, trustApproval: approve });
    assert.equal(recovered.state, "Complete");
    assert.equal(recovered.activePath, activePath);
    assert.equal((await retry.current()).descriptorHash, next.descriptor.descriptorHash);
    assert.equal(await readFile(fixture.priorAssetPath, "utf8"), localWork);
    await assert.rejects(lstat(managed.activationLockPath), { code: "ENOENT" });
    await assertNoStagedProject(fixture);
  });

test("a retry can activate again after a subprocess kill before the Active rename (#648)",
  { skip: !crashReleased && "no crash-released OS mutex on this platform" }, async (t) => {
    const fixture = await activationFixture(t, { interruption: "kill from child" });
    const { managed, next, activePath, assetPath, intentPath } = fixture;
    const stage = await killAtRename(fixture, activePath, false);
    const retainedAsset = path.join(stage, "Assets", "Test.txt");
    assert.equal(await readFile(retainedAsset, "utf8"), nextAsset);
    assert.equal((await lstat(intentPath)).isFile(), true);
    await assert.rejects(lstat(activePath), { code: "ENOENT" });
    await assertPriorActive(fixture);

    const recovered = await managed.activate({ ...next, trustApproval: approve });
    assert.equal(recovered.state, "Complete");
    assert.equal((await managed.current()).descriptorHash, next.descriptor.descriptorHash);
    assert.equal(await readFile(assetPath, "utf8"), nextAsset);
    assert.equal(await readFile(retainedAsset, "utf8"), nextAsset);
    assert.equal(await readFile(fixture.priorAssetPath, "utf8"), localWork);
    await assert.rejects(lstat(managed.activationLockPath), { code: "ENOENT" });
  });

test("retrying the same revision after a subprocess kill following the pointer rename is idempotent (#648)",
  { skip: !crashReleased && "no crash-released OS mutex on this platform" }, async (t) => {
    const fixture = await activationFixture(t, { interruption: "kill from child" });
    const { managed, next, assetPath, activePath, retry } = fixture;
    await killAtRename(fixture, managed.currentPath, true);
    const committedPointer = await readFile(managed.currentPath);
    assert.equal(JSON.parse(committedPointer).descriptorHash, next.descriptor.descriptorHash);

    const repeated = await retry.activate({
      ...next,
      trustApproval: async () => assert.fail("already committed revision cannot ask for trust again"),
      onActivationCommitStart: () => assert.fail("already committed revision cannot start another commit"),
    });
    assert.equal(repeated.state, "Complete");
    assert.equal(repeated.alreadyActive, true);
    assert.equal(repeated.activePath, activePath);
    assert.deepEqual(await readFile(managed.currentPath), committedPointer);
    assert.equal(await readFile(assetPath, "utf8"), nextAsset);
    assert.equal(await readFile(fixture.priorAssetPath, "utf8"), localWork);
    await assertNoStagedProject(fixture);
  });
