import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  access,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { createBootstrapInvite } from "../src/bootstrap-invite.mjs";
import { descriptorCoordinatorFields } from "../src/coordinator-client.mjs";
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

async function sessionFixture(publication, sessionId, { failChunks = false } = {}) {
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
  const store = failChunks
    ? {
        inventory: (...arguments_) => publication.store.inventory(...arguments_),
        async read() { throw new Error("intentional rev2 chunk failure"); },
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
    coordinatorFactory: () => ({
      sessionId,
      async connect() { return snapshot; },
      async announce() { return {}; },
      close() {},
    }),
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

async function receive({ session, managedRoot, stateRoot, approved = true }) {
  const orchestrator = new TeamForgeGuestOrchestrator({ coordinatorFactory: session.coordinatorFactory });
  const events = [];
  trustDecision(orchestrator, events, approved);
  const result = await orchestrator.start({
    invite: JSON.stringify(session.bootstrapInvite),
    managedRoot,
    stateRoot,
  });
  return { result, events };
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
