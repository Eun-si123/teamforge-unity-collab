import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createBootstrapInvite } from "../src/bootstrap-invite.mjs";
import { descriptorCoordinatorFields } from "../src/coordinator-client.mjs";
import { DirectTransferServer, createTransferToken } from "../src/direct-transfer-server.mjs";
import { TeamForgeGuestOrchestrator } from "../src/guest-orchestrator.mjs";
import { createInvite } from "../src/invite.mjs";
import { ProjectPeerEngine } from "../src/project-peer.mjs";
import { cleanup, createUnityProject, temporaryRoot } from "../test/helpers.mjs";

const outputRoot = path.resolve(process.cwd(), "test-results", "e2e");
const outputPath = path.join(outputRoot, "project-transfer-e2e.json");

function sessionCode({ projectId, projectUuid, sessionId, serverAddress, realtimePath }) {
  return `TF1.${Buffer.from(JSON.stringify({
    format: "teamforge-join-v1",
    productVersion: "0.5.1",
    serverAddress,
    realtimePath,
    projectId,
    projectUuid,
    sessionId,
    hostDisplayName: "CI Host",
    createdUtc: "2026-08-21T00:00:00.000Z",
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
    assetFiles: { "Assets/Revision.txt": "revision 0\n" },
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
    projectId: "ci-project-transfer-e2e",
    projectUuid: "",
  };
}

async function publish(host, baselineRevision, byteValue) {
  await writeFile(
    path.join(host.sourceRoot, "Assets", "Revision.txt"),
    `revision ${baselineRevision}\n`,
    "utf8",
  );
  for (let index = 0; index < 8; index += 1) {
    await writeFile(
      path.join(host.sourceRoot, "Assets", `Payload-${index}.bin`),
      Buffer.alloc(65_536, (byteValue + index) % 251),
    );
  }
  const publication = await host.engine.preparePublication({
    projectRoot: host.sourceRoot,
    projectId: host.projectId,
    ...(host.projectUuid ? { projectUuid: host.projectUuid } : {}),
    baselineRevision,
    chunkSize: 65_536,
  });
  host.projectUuid = publication.project.projectUuid;
  return publication;
}

async function sessionFixture(publication, sessionId, store = publication.store) {
  const serverAddress = "http://127.0.0.1:5080";
  const realtimePath = "ws";
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
  const transferToken = createTransferToken();
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
      publishedConnectionId: "ci-owner",
      publishedUserId: "ci-owner-user",
      publishedAtUnixMs: Date.now(),
    },
    peers: [{
      connectionId: `seed-${sessionId}`,
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
    bootstrapInvite,
    seed,
    coordinatorFactory: () => ({
      sessionId,
      async connect() { return snapshot; },
      async announce() { return {}; },
      close() {},
    }),
  };
}

function approveTrust(orchestrator, events) {
  orchestrator.on("guestEvent", (event) => {
    events.push(event);
    if (event.event === "trust") {
      orchestrator.trust({ challengeId: event.challengeId, approved: true });
    }
  });
}

async function receive({ session, managedRoot, stateRoot, syncOptions = undefined }) {
  const orchestrator = new TeamForgeGuestOrchestrator({
    coordinatorFactory: session.coordinatorFactory,
    ...(syncOptions ? { syncOptions } : {}),
  });
  const events = [];
  approveTrust(orchestrator, events);
  const result = await orchestrator.start({
    invite: JSON.stringify(session.bootstrapInvite),
    managedRoot,
    stateRoot,
  });
  return { result, events };
}

const root = await temporaryRoot("teamforge-ci-project-transfer-");
const seeds = [];
try {
  await mkdir(outputRoot, { recursive: true });
  const host = await createHost(root);
  const managedRoot = path.join(root, "TeamForge Projects");
  const stateRoot = path.join(root, "Launcher State");

  const revision1 = await publish(host, 1, 11);
  const revision1Session = await sessionFixture(revision1, "ci-revision-1");
  seeds.push(revision1Session.seed);
  const first = await receive({ session: revision1Session, managedRoot, stateRoot });
  assert.equal(
    await readFile(path.join(first.result.activePath, "Assets", "Revision.txt"), "utf8"),
    "revision 1\n",
  );
  assert.equal(first.events.filter((event) => event.event === "trust").length, 1);

  const pointerPath = path.join(managedRoot, host.projectUuid, "metadata", "current.json");
  const pointerBeforeFailure = await readFile(pointerPath, "utf8");
  const firstActivePath = first.result.activePath;

  const revision2 = await publish(host, 2, 29);
  const partiallyServedHashes = new Set();
  let successfulReads = 0;
  const partialFailureStore = {
    inventory: (...arguments_) => revision2.store.inventory(...arguments_),
    async read(hash, ...arguments_) {
      if (successfulReads >= 3) {
        throw new Error("intentional CI transfer interruption after three verified Chunks");
      }
      const payload = await revision2.store.read(hash, ...arguments_);
      partiallyServedHashes.add(hash);
      successfulReads += 1;
      return payload;
    },
  };
  const failedSession = await sessionFixture(revision2, "ci-revision-2-interrupted", partialFailureStore);
  seeds.push(failedSession.seed);

  const failedOrchestrator = new TeamForgeGuestOrchestrator({
    coordinatorFactory: failedSession.coordinatorFactory,
    syncOptions: { maxConcurrency: 1, retryRounds: 0 },
  });
  const failedEvents = [];
  approveTrust(failedOrchestrator, failedEvents);
  await assert.rejects(
    () => failedOrchestrator.start({
      invite: JSON.stringify(failedSession.bootstrapInvite),
      managedRoot,
      stateRoot,
    }),
    { code: "direct_transfer_unavailable" },
  );
  assert(partiallyServedHashes.size >= 2, "The interrupted transfer did not persist enough verified Chunks.");
  assert.equal(await readFile(pointerPath, "utf8"), pointerBeforeFailure);
  assert.equal(
    await readFile(path.join(firstActivePath, "Assets", "Revision.txt"), "utf8"),
    "revision 1\n",
  );
  assert.equal((await readdir(path.join(managedRoot, host.projectUuid, "active"))).length, 1);

  await failedSession.seed.stop();
  seeds.splice(seeds.indexOf(failedSession.seed), 1);

  const resumedReads = new Set();
  const healthyResumeStore = {
    inventory: (...arguments_) => revision2.store.inventory(...arguments_),
    async read(hash, ...arguments_) {
      resumedReads.add(hash);
      return revision2.store.read(hash, ...arguments_);
    },
  };
  const resumeSession = await sessionFixture(revision2, "ci-revision-2-resume", healthyResumeStore);
  seeds.push(resumeSession.seed);
  const resumed = await receive({
    session: resumeSession,
    managedRoot,
    stateRoot,
    syncOptions: { maxConcurrency: 2, retryRounds: 1 },
  });

  assert.notEqual(resumed.result.activePath, firstActivePath);
  assert.equal(
    await readFile(path.join(firstActivePath, "Assets", "Revision.txt"), "utf8"),
    "revision 1\n",
  );
  assert.equal(
    await readFile(path.join(resumed.result.activePath, "Assets", "Revision.txt"), "utf8"),
    "revision 2\n",
  );
  const current = JSON.parse(await readFile(pointerPath, "utf8"));
  assert.equal(current.baselineRevision, 2);
  assert.equal(current.manifestHash, revision2.manifest.manifestHash);
  assert.equal((await readdir(path.join(managedRoot, host.projectUuid, "active"))).length, 2);

  const reusedHashes = [...partiallyServedHashes].filter((hash) => !resumedReads.has(hash));
  assert.equal(
    reusedHashes.length,
    partiallyServedHashes.size,
    "Resume re-downloaded Chunks that had already been hash-verified before interruption.",
  );

  const result = {
    projectTransferE2E: true,
    projectUuid: host.projectUuid,
    revision1ActivePreserved: true,
    revision2Activated: true,
    interruptedVerifiedChunks: partiallyServedHashes.size,
    resumedWithoutRedownload: reusedHashes.length,
    activeRevisionCount: 2,
    finalBaselineRevision: current.baselineRevision,
    publisherTrustRepromptedOnResume: resumed.events.some((event) => event.event === "trust"),
  };
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.info(JSON.stringify(result, null, 2));
} finally {
  for (const seed of seeds) {
    await seed.stop().catch(() => {});
  }
  await cleanup(root);
}
