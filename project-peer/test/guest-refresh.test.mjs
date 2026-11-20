import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { createTeamForgeServer } from "../../server/src/teamforge-server.mjs";
import { createBootstrapInvite } from "../src/bootstrap-invite.mjs";
import { CoordinatorClient, descriptorCoordinatorFields } from "../src/coordinator-client.mjs";
import { DirectTransferServer, createTransferToken } from "../src/direct-transfer-server.mjs";
import { TeamForgeGuestOrchestrator } from "../src/guest-orchestrator.mjs";
import { readGuestTrustPin } from "../src/guest-trust.mjs";
import { createInvite } from "../src/invite.mjs";
import { generateIdentity, saveIdentity } from "../src/identity.mjs";
import { ProjectPeerEngine } from "../src/project-peer.mjs";
import { cleanup, createUnityProject, temporaryRoot } from "./helpers.mjs";

function sessionCode({ projectId, projectUuid, sessionId, serverAddress, realtimePath }) {
  return `TF1.${Buffer.from(JSON.stringify({
    format: "teamforge-join-v1",
    productVersion: "0.5.1",
    serverAddress,
    realtimePath,
    projectId,
    projectUuid,
    sessionId,
    hostDisplayName: "Host",
    createdUtc: "2026-08-15T09:00:00.000Z",
    sceneBaseline: {
      scenePath: "Assets/Scenes/Main.unity",
      sceneGuid: "1".repeat(32),
      sha256: "2".repeat(64),
    },
  }), "utf8").toString("base64url")}`;
}

async function createHost(root) {
  const sourceRoot = path.join(root, "host-source");
  await createUnityProject(sourceRoot, {
    assetFiles: { "Assets/Guest.txt": "revision 1\n" },
    dependencies: { "com.eunsung.teamforge": "file:com.eunsung.teamforge" },
  });
  const packageRoot = path.join(sourceRoot, "Packages", "com.eunsung.teamforge");
  await mkdir(packageRoot, { recursive: true });
  await writeFile(path.join(packageRoot, "package.json"), `${JSON.stringify({
    name: "com.eunsung.teamforge",
    version: "0.5.1",
  })}\n`);
  return {
    sourceRoot,
    engine: new ProjectPeerEngine({ managedRoot: path.join(root, "host-managed") }),
    projectId: "guest-refresh-project",
    projectUuid: "",
  };
}

async function publish(host, baselineRevision, text, publisherIdentity = null) {
  await writeFile(path.join(host.sourceRoot, "Assets", "Guest.txt"), text, "utf8");
  let publisherKeyPath;
  if (publisherIdentity) {
    publisherKeyPath = path.join(
      path.dirname(host.sourceRoot),
      `publisher-${baselineRevision}-${publisherIdentity.keyId.slice(0, 12)}.json`,
    );
    await saveIdentity(publisherKeyPath, publisherIdentity);
  }
  const publication = await host.engine.preparePublication({
    projectRoot: host.sourceRoot,
    projectId: host.projectId,
    ...(host.projectUuid ? { projectUuid: host.projectUuid } : {}),
    baselineRevision,
    chunkSize: 65_536,
    ...(publisherKeyPath ? { publisherKeyPath } : {}),
  });
  host.projectUuid = publication.project.projectUuid;
  return publication;
}

function signedSessionInvite(publication, sessionId, serverAddress, realtimePath) {
  const projectInvite = createInvite({
    serverAddress,
    realtimePath,
    projectId: publication.project.projectId,
    projectUuid: publication.project.projectUuid,
    sessionId,
    ownerIdentity: publication.ownerIdentity,
  });
  const bootstrapInvite = createBootstrapInvite({
    projectInvite,
    sessionJoinCode: sessionCode({
      projectId: publication.project.projectId,
      projectUuid: publication.project.projectUuid,
      sessionId,
      serverAddress,
      realtimePath,
    }),
    ownerIdentity: publication.ownerIdentity,
  });
  return { projectInvite, bootstrapInvite };
}

async function sessionFixture(publication, sessionId, { failChunks = false, onChunkRead, onConnect } = {}) {
  const { projectInvite, bootstrapInvite } = signedSessionInvite(publication, sessionId, "http://127.0.0.1:5080", "ws");
  const transferToken = createTransferToken();
  const store = failChunks || onChunkRead
    ? {
        inventory: (...arguments_) => publication.store.inventory(...arguments_),
        async read(hash, size) {
          if (failChunks) throw new Error("intentional rev2 chunk failure");
          onChunkRead(hash);
          return publication.store.read(hash, size);
        },
      }
    : publication.store;
  const seed = new DirectTransferServer({
    projectUuid: publication.project.projectUuid,
    sessionId,
    manifest: publication.manifest,
    descriptor: publication.descriptor,
    store,
    transferToken,
  });
  const bound = await seed.start();
  const snapshot = {
    type: "project_registry_snapshot",
    protocolVersion: 1,
    projectId: publication.project.projectId,
    projectUuid: publication.project.projectUuid,
    baseline: {
      ...descriptorCoordinatorFields(publication.descriptor),
      projectId: publication.project.projectId,
      publishedConnectionId: "owner",
      publishedUserId: "owner-user",
      publishedAtUnixMs: Date.now(),
    },
    peers: [{
      connectionId: "owner-seed",
      projectUuid: publication.project.projectUuid,
      baselineRevision: publication.descriptor.baselineRevision,
      manifestHash: publication.manifest.manifestHash,
      seedRank: 0,
      endpoint: bound.endpoint,
      transferToken,
    }],
    serverTimestampUnixMs: Date.now(),
  };
  return {
    projectInvite,
    bootstrapInvite,
    seed,
    snapshot,
    coordinatorFactory: () => {
      let connectCount = 0;
      return {
        sessionId,
        async connect() {
          await onConnect?.(++connectCount);
          return snapshot;
        },
        async announce() { return {}; },
        close() {},
      };
    },
  };
}

function trustDecision(orchestrator, events, approved = true) {
  orchestrator.on("guestEvent", (event) => {
    events.push(event);
    if (event.event === "trust") {
      orchestrator.trust({ challengeId: event.challengeId, approved });
    }
  });
}

async function receive({ session, managedRoot, stateRoot, approved = true, reviewProjectUpdate = false }) {
  const orchestrator = new TeamForgeGuestOrchestrator({ coordinatorFactory: session.coordinatorFactory });
  const events = [];
  trustDecision(orchestrator, events, approved);
  const result = await orchestrator.start({
    invite: JSON.stringify(session.bootstrapInvite),
    managedRoot,
    stateRoot, reviewProjectUpdate,
  });
  return { result, events };
}

async function updateFixture(t, { publisher = null, onConnect } = {}) {
  const root = await temporaryRoot();
  const seeds = [];
  t.after(async () => {
    for (const seed of seeds) await seed.stop();
    await cleanup(root);
  });
  const host = await createHost(root);
  const assets = path.join(host.sourceRoot, "Assets");
  await writeFile(path.join(assets, "Removed.txt"), "retired asset\n");
  const managedRoot = path.join(root, "TeamForge Projects");
  const stateRoot = path.join(root, "Launcher State");
  const revision1 = await publish(host, 1, "revision 1\n");
  const firstSession = await sessionFixture(revision1, "session-one");
  seeds.push(firstSession.seed);
  const first = await receive({ session: firstSession, managedRoot, stateRoot, reviewProjectUpdate: true });
  assert.equal(first.events.some((event) => event.event === "project_update_review"), false);

  await writeFile(path.join(first.result.activePath, "Assets", "Guest.txt"), "guest's unsent local changes\n");
  await writeFile(path.join(first.result.activePath, "Assets", "LocalOnly.txt"), "guest's new local asset\n");
  await rm(path.join(assets, "Removed.txt"));
  await writeFile(path.join(assets, "Added.txt"), "new approved Asset\n");
  await writeFile(path.join(assets, "Added.txt.meta"), "fileFormatVersion: 2\nguid: 33333333333333333333333333333333\n");
  const revision2 = await publish(host, 2, "revision 2\n", publisher);
  const chunkReads = new Set();
  const secondSession = await sessionFixture(revision2, "session-two", {
    onChunkRead: (hash) => chunkReads.add(hash), onConnect,
  });
  seeds.push(secondSession.seed);
  const metadataRoot = path.join(managedRoot, host.projectUuid, "metadata");
  const currentPath = path.join(metadataRoot, "current.json");
  const publishedPath = new ProjectPeerEngine({ managedRoot }).publishedPointerPath(host.projectUuid);
  const currentBefore = await readFile(currentPath);
  const publishedBefore = await readFile(publishedPath);
  return {
    seeds, host, revision1, revision2, first, secondSession, chunkReads, managedRoot, stateRoot,
    metadataRoot, currentPath, publishedPath, currentBefore, publishedBefore,
  };
}

async function startUpdate(t, fixture) {
  const orchestrator = new TeamForgeGuestOrchestrator({ coordinatorFactory: fixture.secondSession.coordinatorFactory });
  t.after(() => orchestrator.cancel());
  const events = [];
  trustDecision(orchestrator, events);
  const waiting = new Promise((resolve) => {
    orchestrator.on("guestEvent", (event) => {
      if (event.event === "project_update_review") resolve(event);
    });
  });
  const completion = orchestrator.start({
    invite: JSON.stringify(fixture.secondSession.bootstrapInvite),
    managedRoot: fixture.managedRoot,
    stateRoot: fixture.stateRoot,
    reviewProjectUpdate: true,
  });
  const review = await Promise.race([
    waiting, completion.then(() => assert.fail("The update finished without a review.")),
  ]);
  return { orchestrator, events, review, completion };
}

async function assertNoUpdateWrites(fixture) {
  assert.equal(fixture.chunkReads.size, 0);
  assert.deepEqual(await readFile(fixture.currentPath), fixture.currentBefore);
  assert.deepEqual(await readFile(fixture.publishedPath), fixture.publishedBefore);
  await assert.rejects(access(path.join(fixture.metadataRoot, "manifests", `${fixture.revision2.manifest.manifestHash}.json`)), {
    code: "ENOENT",
  });
}

test("signed Project invite refresh accepts only the same Project UUID and Owner", async () => {
  const root = await temporaryRoot();
  try {
    const managedRoot = path.join(root, "projects");
    const engine = new ProjectPeerEngine({ managedRoot });
    const owner = generateIdentity("Pinned Owner");
    const projectUuid = randomUUID().toLowerCase();
    const first = createInvite({
      serverAddress: "http://127.0.0.1:5080",
      projectId: "refresh-project",
      projectUuid,
      sessionId: "session-one",
      ownerIdentity: owner,
    });
    await engine.importInviteValue({ invite: first });

    const refreshed = createInvite({
      serverAddress: "http://192.168.1.20:5080",
      projectId: first.projectId,
      projectUuid,
      sessionId: "session-two",
      ownerIdentity: owner,
    });
    await engine.importInviteValue({ invite: refreshed });
    const invitePath = path.join(managedRoot, projectUuid, "metadata", "invite.json");
    assert.deepEqual(JSON.parse(await readFile(invitePath, "utf8")), refreshed);

    const otherOwner = generateIdentity("Other Owner");
    const changedOwner = createInvite({
      ...refreshed,
      sessionId: "changed-owner",
      ownerIdentity: otherOwner,
    });
    await assert.rejects(() => engine.importInviteValue({ invite: changedOwner }), { code: "untrusted_owner" });
    assert.deepEqual(JSON.parse(await readFile(invitePath, "utf8")), refreshed);

    const tampered = { ...refreshed, sessionId: "tampered-without-resigning" };
    await assert.rejects(() => engine.importInviteValue({ invite: tampered }), { code: "invalid_invite" });
    assert.deepEqual(JSON.parse(await readFile(invitePath, "utf8")), refreshed);

    const changedUuid = randomUUID().toLowerCase();
    const changedProject = createInvite({
      ...refreshed,
      projectUuid: changedUuid,
      sessionId: "changed-project",
      ownerIdentity: owner,
    });
    await assert.rejects(() => engine.importInviteValue({ invite: changedProject }), {
      code: "project_uuid_conflict",
    });
    await assert.rejects(() => access(path.join(managedRoot, changedUuid)));
    assert.deepEqual(JSON.parse(await readFile(invitePath, "utf8")), refreshed);
  } finally {
    await cleanup(root);
  }
});

test("rev1 Fresh Guest rejoins a restarted Host session in the same managed root", async () => {
  const root = await temporaryRoot();
  const seeds = [];
  try {
    const host = await createHost(root);
    const revision1 = await publish(host, 1, "revision 1\n");
    const managedRoot = path.join(root, "TeamForge Projects");
    const stateRoot = path.join(root, "Launcher State");
    const firstSession = await sessionFixture(revision1, "session-one");
    seeds.push(firstSession.seed);
    const first = await receive({ session: firstSession, managedRoot, stateRoot });
    assert.equal(first.events.filter((event) => event.event === "trust").length, 1);
    const pointerPath = path.join(managedRoot, host.projectUuid, "metadata", "current.json");
    const pointerBefore = await readFile(pointerPath, "utf8");
    const activeBefore = (await readdir(path.join(managedRoot, host.projectUuid, "active"))).sort();

    const restartedSession = await sessionFixture(revision1, "session-two");
    seeds.push(restartedSession.seed);
    const rejoined = await receive({ session: restartedSession, managedRoot, stateRoot });
    assert.equal(rejoined.result.activePath, first.result.activePath);
    assert.equal(rejoined.events.some((event) => event.event === "trust"), false);
    assert.equal(await readFile(pointerPath, "utf8"), pointerBefore);
    assert.deepEqual((await readdir(path.join(managedRoot, host.projectUuid, "active"))).sort(), activeBefore);
    const handoff = JSON.parse(await readFile(rejoined.result.handoffPath, "utf8"));
    assert.equal(handoff.baselineRevision, 1);
    assert.equal(handoff.sessionJoinCode, restartedSession.bootstrapInvite.sessionJoinCode);
    const stored = JSON.parse(await readFile(path.join(
      managedRoot, host.projectUuid, "metadata", "invite.json",
    ), "utf8"));
    assert.equal(stored.sessionId, "session-two");
  } finally {
    for (const seed of seeds) await seed.stop();
    await cleanup(root);
  }
});

test("rev2 signed refresh activates a new immutable Active and preserves rev1", async () => {
  const root = await temporaryRoot();
  const seeds = [];
  try {
    const host = await createHost(root);
    const revision1 = await publish(host, 1, "revision 1\n");
    const managedRoot = path.join(root, "TeamForge Projects");
    const stateRoot = path.join(root, "Launcher State");
    const firstSession = await sessionFixture(revision1, "session-one");
    seeds.push(firstSession.seed);
    const first = await receive({ session: firstSession, managedRoot, stateRoot });

    const revision2 = await publish(host, 2, "revision 2\n");
    const secondSession = await sessionFixture(revision2, "session-two");
    seeds.push(secondSession.seed);
    const second = await receive({ session: secondSession, managedRoot, stateRoot });
    assert.notEqual(second.result.activePath, first.result.activePath);
    assert.equal(await readFile(path.join(first.result.activePath, "Assets", "Guest.txt"), "utf8"), "revision 1\n");
    assert.equal(await readFile(path.join(second.result.activePath, "Assets", "Guest.txt"), "utf8"), "revision 2\n");
    assert.equal(second.events.some((event) => event.event === "trust"), false);
    const pointer = JSON.parse(await readFile(path.join(
      managedRoot, host.projectUuid, "metadata", "current.json",
    ), "utf8"));
    assert.equal(pointer.baselineRevision, 2);
    assert.equal(pointer.manifestHash, revision2.manifest.manifestHash);
    assert.equal((await readdir(path.join(managedRoot, host.projectUuid, "active"))).length, 2);
    const handoff = JSON.parse(await readFile(second.result.handoffPath, "utf8"));
    assert.equal(handoff.baselineRevision, 2);
    assert.equal(handoff.activeProjectPath, second.result.activePath);
    assert.equal(handoff.sessionJoinCode, secondSession.bootstrapInvite.sessionJoinCode);
  } finally {
    for (const seed of seeds) await seed.stop();
    await cleanup(root);
  }
});

test("reviewed refresh shows signed changes, reuses verified chunks and keeps local edits in the old Active", { timeout: 10_000 }, async (t) => {
  const fixture = await updateFixture(t);
  const { orchestrator, review, completion } = await startUpdate(t, fixture);
  assert.equal(review.currentRevision, 1);
  assert.equal(review.proposedRevision, 2);
  assert.equal(review.currentManifestHash, fixture.revision1.manifest.manifestHash);
  assert.equal(review.proposedManifestHash, fixture.revision2.manifest.manifestHash);
  assert.deepEqual([review.addedCount, review.modifiedCount, review.removedCount], [2, 1, 1]);
  assert.deepEqual(review.changes, [
    { kind: "added", path: "Assets/Added.txt" },
    { kind: "added", path: "Assets/Added.txt.meta" },
    { kind: "modified", path: "Assets/Guest.txt" },
    { kind: "removed", path: "Assets/Removed.txt" },
  ]);
  await assertNoUpdateWrites(fixture);
  assert.throws(() => orchestrator.reviewProjectUpdate({ challengeId: "older-run", approved: true }), {
    code: "invalid_project_update_decision",
  });
  assert.deepEqual(orchestrator.reviewProjectUpdate({ challengeId: review.challengeId, approved: true }), {
    accepted: true, approved: true,
  });
  assert.throws(() => orchestrator.reviewProjectUpdate({ challengeId: review.challengeId, approved: false }), {
    code: "invalid_project_update_decision",
  });
  const fresh = await completion;
  assert.equal(fresh.baselineRevision, 2);
  const oldChunks = new Set(fixture.revision1.manifest.files.flatMap((file) => file.chunks.map((chunk) => chunk.hash)));
  const missingChunks = new Set(fixture.revision2.manifest.files
    .flatMap((file) => file.chunks.map((chunk) => chunk.hash)).filter((hash) => !oldChunks.has(hash)));
  assert(missingChunks.size > 0, "actual new chunks are required");
  assert.deepEqual(fixture.chunkReads, missingChunks);
  assert.equal(await readFile(path.join(fresh.activePath, "Assets", "Guest.txt"), "utf8"), "revision 2\n");
  assert.equal(await readFile(path.join(fresh.activePath, "Assets", "Added.txt.meta"), "utf8"),
    "fileFormatVersion: 2\nguid: 33333333333333333333333333333333\n");
  await assert.rejects(access(path.join(fresh.activePath, "Assets", "Removed.txt")), { code: "ENOENT" });
  assert.equal(await readFile(path.join(fixture.first.result.activePath, "Assets", "Guest.txt"), "utf8"),
    "guest's unsent local changes\n");
  assert.equal(await readFile(path.join(fixture.first.result.activePath, "Assets", "LocalOnly.txt"), "utf8"),
    "guest's new local asset\n");
});

test("declining a revision review after trusting a replacement Publisher keeps the prior pin and Active", { timeout: 10_000 }, async (t) => {
  const fixture = await updateFixture(t, { publisher: generateIdentity("Replacement Publisher") });
  const { orchestrator, events, review, completion } = await startUpdate(t, fixture);
  assert.deepEqual(events.filter((event) => ["trust", "project_update_review"].includes(event.event)).map((event) => event.event),
    ["trust", "project_update_review"]);
  orchestrator.reviewProjectUpdate({ challengeId: review.challengeId, approved: false });
  await assert.rejects(completion, { code: "project_update_declined" });
  await assertNoUpdateWrites(fixture);
  const trust = await readGuestTrustPin(path.join(fixture.stateRoot, "guest-core"), fixture.host.projectUuid);
  assert.equal(trust.pin.publisherKeyId, fixture.revision1.descriptor.publisherKeyId);
  assert.equal(await readFile(path.join(fixture.first.result.activePath, "Assets", "LocalOnly.txt"), "utf8"),
    "guest's new local asset\n");
});

test("cancelling during revision review invalidates the challenge before any Project update writes", { timeout: 10_000 }, async (t) => {
  const fixture = await updateFixture(t);
  const { orchestrator, review, completion } = await startUpdate(t, fixture);
  orchestrator.cancel();
  assert.throws(() => orchestrator.reviewProjectUpdate({ challengeId: review.challengeId, approved: true }), {
    code: "invalid_project_update_decision",
  });
  await assert.rejects(completion, { code: "guest_cancelled" });
  await assertNoUpdateWrites(fixture);
});

test("pausing a revision review retires its challenge and resume offers a fresh decision", { timeout: 10_000 }, async (t) => {
  const fixture = await updateFixture(t);
  const { orchestrator, review, completion } = await startUpdate(t, fixture);
  function nextEvent(type) {
    return new Promise((resolve) => {
      function listener(event) {
        if (event.event !== type) return;
        orchestrator.off("guestEvent", listener);
        resolve(event);
      }
      orchestrator.on("guestEvent", listener);
    });
  }
  const paused = nextEvent("paused");
  orchestrator.pause();
  await paused;
  assert.throws(() => orchestrator.reviewProjectUpdate({ challengeId: review.challengeId, approved: true }), {
    code: "invalid_project_update_decision",
  });
  const nextReview = nextEvent("project_update_review");
  orchestrator.resume();
  const fresh = await nextReview;
  assert.equal(fresh.operationId, review.operationId);
  assert.notEqual(fresh.challengeId, review.challengeId);
  assert.equal(fresh.proposedManifestHash, review.proposedManifestHash);
  orchestrator.reviewProjectUpdate({ challengeId: fresh.challengeId, approved: false });
  await assert.rejects(completion, { code: "project_update_declined" });
  await assertNoUpdateWrites(fixture);
});

test("review does not proceed if the Coordinator advances past the exact signed revision being reviewed", { timeout: 10_000 }, async (t) => {
  const fixture = await updateFixture(t);
  const { orchestrator, review, completion } = await startUpdate(t, fixture);
  const revision3 = await publish(fixture.host, 3, "revision 3\n");
  fixture.secondSession.snapshot.baseline = descriptorCoordinatorFields(revision3.descriptor);
  orchestrator.reviewProjectUpdate({ challengeId: review.challengeId, approved: true });
  await assert.rejects(completion, { code: "project_update_stale" });
  await assertNoUpdateWrites(fixture);
});

test("real Coordinator publication changes invalidate update review before download and before activation", { timeout: 15_000 }, async (t) => {
  for (const phase of ["review", "staging"]) {
    await t.test(phase, async (context) => {
      const root = await temporaryRoot();
      const server = createTeamForgeServer({
        host: "127.0.0.1", port: 0, logger: { info() {}, warn() {}, error() {} },
      });
      const seeds = [];
      context.after(async () => {
        for (const seed of seeds.reverse()) await seed.stop();
        await server.stop();
        await cleanup(root);
      });
      const endpoint = await server.start();
      const serverAddress = `http://127.0.0.1:${endpoint.port}`;
      const realtimePath = endpoint.wsPath;
      const sessionId = "revision-review";
      const host = await createHost(root);
      const publishLive = async (revision) => {
        const publication = await publish(host, revision, `revision ${revision}\n`);
        seeds.push(await host.engine.startSeed({
          publication, sessionId, publish: true,
          coordinatorOptions: {
            serverAddress, realtimePath, projectId: host.projectId, sessionId,
            userId: `host-${revision}`, userName: "Host",
          },
        }));
        return publication;
      };
      const managedRoot = path.join(root, "Projects");
      const stateRoot = path.join(root, "State");
      const revision1 = await publishLive(1);
      const first = await receive({
        session: signedSessionInvite(revision1, sessionId, serverAddress, realtimePath),
        managedRoot, stateRoot, reviewProjectUpdate: true,
      });
      const priorActiveAsset = path.join(first.result.activePath, "Assets", "Guest.txt");
      await writeFile(priorActiveAsset, "locally edited\n");
      const metadataRoot = path.join(managedRoot, host.projectUuid, "metadata");
      const currentPath = path.join(metadataRoot, "current.json");
      const pointerBefore = await readFile(currentPath);
      const revision2 = await publishLive(2);
      let coordinator;
      async function advanceHost() {
        const changed = once(coordinator, "project_baseline_changed");
        const next = await publishLive(3);
        const [message] = await changed;
        assert.equal(message.baseline.descriptorHash, next.descriptor.descriptorHash);
      }
      const secondSession = {
        ...signedSessionInvite(revision2, sessionId, serverAddress, realtimePath),
        coordinatorFactory: (options) => {
          coordinator = new CoordinatorClient(options);
          const connect = coordinator.connect.bind(coordinator);
          let snapshots = 0;
          coordinator.connect = async () => {
            // The third read occurs after materializing the staged Project.
            if (++snapshots === 3 && phase === "staging") await advanceHost();
            return connect();
          };
          return coordinator;
        },
      };
      const { orchestrator, review, completion } = await startUpdate(context, { secondSession, managedRoot, stateRoot });
      assert.equal(review.proposedManifestHash, revision2.manifest.manifestHash);
      if (phase === "review") await advanceHost();
      orchestrator.reviewProjectUpdate({ challengeId: review.challengeId, approved: true });
      await assert.rejects(completion, { code: "project_update_stale" });
      assert.deepEqual(await readFile(currentPath), pointerBefore);
      assert.equal(await readFile(priorActiveAsset, "utf8"), "locally edited\n");
      assert.equal((await readdir(path.join(managedRoot, host.projectUuid, "active"))).length, 1);
      if (phase === "review") {
        await assert.rejects(access(path.join(metadataRoot, "manifests", `${revision2.manifest.manifestHash}.json`)), {
          code: "ENOENT",
        });
      }
    });
  }
});

test("reviewed refresh cannot replace a newer Active committed by a second receive during staging", { timeout: 10_000 }, async (t) => {
  let concurrentUpdate;
  const fixture = await updateFixture(t, {
    onConnect: async (connectionRead) => {
      if (connectionRead === 3) await concurrentUpdate();
    },
  });
  const revision3 = await publish(fixture.host, 3, "revision 3\n");
  const thirdSession = await sessionFixture(revision3, "session-three");
  fixture.seeds.push(thirdSession.seed);
  concurrentUpdate = () => receive({ session: thirdSession, managedRoot: fixture.managedRoot, stateRoot: fixture.stateRoot });

  const { orchestrator, review, completion } = await startUpdate(t, fixture);
  orchestrator.reviewProjectUpdate({ challengeId: review.challengeId, approved: true });
  await assert.rejects(completion, { code: "project_update_stale" });
  assert(fixture.chunkReads.size > 0, "Concurrent receive must commit after rev2 starts staging");
  const current = JSON.parse(await readFile(fixture.currentPath, "utf8"));
  assert.equal(current.manifestHash, revision3.manifest.manifestHash);
  const revision2Name = `2-${fixture.revision2.manifest.manifestHash.slice(0, 12)}`;
  await assert.rejects(access(path.join(fixture.managedRoot, fixture.host.projectUuid, "active", revision2Name)), { code: "ENOENT" });
  assert.equal(await readFile(path.join(fixture.first.result.activePath, "Assets", "Guest.txt"), "utf8"),
    "guest's unsent local changes\n");
});

test("changed Publisher requires explicit trust and a decline preserves rev1", async () => {
  const root = await temporaryRoot();
  const seeds = [];
  try {
    const host = await createHost(root);
    const revision1 = await publish(host, 1, "revision 1\n");
    const managedRoot = path.join(root, "TeamForge Projects");
    const stateRoot = path.join(root, "Launcher State");
    const firstSession = await sessionFixture(revision1, "session-one");
    seeds.push(firstSession.seed);
    const first = await receive({ session: firstSession, managedRoot, stateRoot });
    const pointerPath = path.join(managedRoot, host.projectUuid, "metadata", "current.json");
    const pointerBefore = await readFile(pointerPath, "utf8");

    const replacementPublisher = generateIdentity("Replacement Publisher");
    const revision2 = await publish(host, 2, "publisher revision 2\n", replacementPublisher);
    const secondSession = await sessionFixture(revision2, "publisher-session");
    seeds.push(secondSession.seed);
    const declined = new TeamForgeGuestOrchestrator({ coordinatorFactory: secondSession.coordinatorFactory });
    const declinedEvents = [];
    trustDecision(declined, declinedEvents, false);
    await assert.rejects(() => declined.start({
      invite: JSON.stringify(secondSession.bootstrapInvite), managedRoot, stateRoot,
    }), { code: "publisher_not_trusted" });
    assert.equal(declinedEvents.some((event) => event.event === "trust" && event.reason === "mismatch"), true);
    assert.equal(await readFile(pointerPath, "utf8"), pointerBefore);
    assert.equal(await readFile(path.join(first.result.activePath, "Assets", "Guest.txt"), "utf8"), "revision 1\n");

    const approved = await receive({ session: secondSession, managedRoot, stateRoot });
    assert.equal(approved.events.some((event) => event.event === "trust" && event.reason === "mismatch"), true);
    const trust = await readGuestTrustPin(path.join(stateRoot, "guest-core"), host.projectUuid);
    assert.equal(trust.pin.publisherKeyId, replacementPublisher.keyId);
    assert.equal(await readFile(path.join(approved.result.activePath, "Assets", "Guest.txt"), "utf8"),
      "publisher revision 2\n");
  } finally {
    for (const seed of seeds) await seed.stop();
    await cleanup(root);
  }
});

test("failed rev2 transfer retains failure staging and preserves verified rev1 Active", async () => {
  const root = await temporaryRoot();
  const seeds = [];
  try {
    const host = await createHost(root);
    const revision1 = await publish(host, 1, "revision 1\n");
    const managedRoot = path.join(root, "TeamForge Projects");
    const stateRoot = path.join(root, "Launcher State");
    const firstSession = await sessionFixture(revision1, "session-one");
    seeds.push(firstSession.seed);
    const first = await receive({ session: firstSession, managedRoot, stateRoot });
    const metadataRoot = path.join(managedRoot, host.projectUuid, "metadata");
    const pointerBefore = await readFile(path.join(metadataRoot, "current.json"), "utf8");

    const revision2 = await publish(host, 2, "failed revision 2\n");
    const failedSession = await sessionFixture(revision2, "failed-session", { failChunks: true });
    seeds.push(failedSession.seed);
    const failed = new TeamForgeGuestOrchestrator({
      coordinatorFactory: failedSession.coordinatorFactory,
      syncOptions: { retryRounds: 0 },
    });
    await assert.rejects(() => failed.start({
      invite: JSON.stringify(failedSession.bootstrapInvite), managedRoot, stateRoot,
    }), { code: "direct_transfer_unavailable" });

    assert.equal(await readFile(path.join(metadataRoot, "current.json"), "utf8"), pointerBefore);
    assert.equal(await readFile(path.join(first.result.activePath, "Assets", "Guest.txt"), "utf8"), "revision 1\n");
    const activeEntries = await readdir(path.join(managedRoot, host.projectUuid, "active"));
    assert.equal(activeEntries.length, 1);
    const stagingRoot = path.join(managedRoot, host.projectUuid, "staging");
    const failedStaging = await readdir(stagingRoot);
    assert(failedStaging.length >= 1);
    const states = await Promise.all(failedStaging.map(async (entry) => JSON.parse(await readFile(
      path.join(stagingRoot, entry, "status.json"), "utf8",
    ))));
    assert(states.some((status) => status.baselineRevision === 2 &&
      ["DirectTransferUnavailable", "Rejected"].includes(status.state)));
  } finally {
    for (const seed of seeds) await seed.stop();
    await cleanup(root);
  }
});
