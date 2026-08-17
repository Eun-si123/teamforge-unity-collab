import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createBootstrapInvite } from "../src/bootstrap-invite.mjs";
import { descriptorCoordinatorFields } from "../src/coordinator-client.mjs";
import { DirectTransferServer, createTransferToken } from "../src/direct-transfer-server.mjs";
import { TeamForgeGuestOrchestrator } from "../src/guest-orchestrator.mjs";
import { readGuestTrustPin } from "../src/guest-trust.mjs";
import { createInvite } from "../src/invite.mjs";
import { generateIdentity } from "../src/identity.mjs";
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
    createdUtc: "2026-08-14T08:00:00.000Z",
    sceneBaseline: {
      scenePath: "Assets/Scenes/Main.unity",
      sceneGuid: "1".repeat(32),
      sha256: "2".repeat(64),
    },
  }), "utf8").toString("base64url")}`;
}

async function transferFixture(root, { large = false, maxBytesPerSecond = 0 } = {}) {
  const sourceRoot = path.join(root, "source");
  const assets = large
    ? Object.fromEntries(Array.from({ length: 6 }, (_, index) => [
        `Assets/Payload-${index}.bin`, Buffer.alloc(65_536, index + 1),
      ]))
    : { "Assets/Guest.txt": "safe guest project\n" };
  await createUnityProject(sourceRoot, {
    assetFiles: assets,
    dependencies: { "com.eunsung.teamforge": "file:com.eunsung.teamforge" },
  });
  const packageRoot = path.join(sourceRoot, "Packages", "com.eunsung.teamforge");
  await mkdir(packageRoot, { recursive: true });
  await writeFile(path.join(packageRoot, "package.json"), `${JSON.stringify({
    name: "com.eunsung.teamforge", version: "0.5.1",
  })}\n`);
  const ownerEngine = new ProjectPeerEngine({ managedRoot: path.join(root, "owner-managed") });
  const publication = await ownerEngine.preparePublication({
    projectRoot: sourceRoot,
    projectId: "guest-bootstrap-project",
    baselineRevision: 1,
    chunkSize: 65_536,
  });
  const sessionId = "editors";
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
    store: publication.store,
    transferToken,
    maxBytesPerSecond,
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
      baselineRevision: 1,
      manifestHash: publication.manifest.manifestHash,
      seedRank: 0,
      endpoint: bound.endpoint,
      transferToken,
    }],
    serverTimestampUnixMs: Date.now(),
  };
  const coordinatorFactory = () => ({
    sessionId,
    async connect() { return snapshot; },
    async announce() { return {}; },
    close() {},
  });
  return { publication, projectInvite, bootstrapInvite, seed, snapshot, coordinatorFactory };
}

function approveTrust(orchestrator, events) {
  orchestrator.on("guestEvent", (event) => {
    events.push(event);
    if (event.event === "trust") {
      orchestrator.trust({ challengeId: event.challengeId, approved: true });
    }
  });
}

test("Guest bootstrap pins signed invite first, explicitly trusts, atomically activates, and writes state-only handoff", async () => {
  const root = await temporaryRoot();
  let fixture;
  try {
    fixture = await transferFixture(root);
    const managedRoot = path.join(root, "TeamForge Projects");
    const stateRoot = path.join(root, "LocalAppData", "TeamForge", "Launcher");
    const orchestrator = new TeamForgeGuestOrchestrator({ coordinatorFactory: fixture.coordinatorFactory });
    const inspected = await orchestrator.inspect({
      invite: JSON.stringify(fixture.bootstrapInvite), managedRoot, stateRoot,
    });
    assert.equal(inspected.destinationState, "available");
    assert.equal(inspected.includesRealtimeSession, true);
    await assert.rejects(() => access(managedRoot));
    await assert.rejects(() => access(stateRoot));

    const events = [];
    approveTrust(orchestrator, events);
    const result = await orchestrator.start({
      invite: JSON.stringify(fixture.bootstrapInvite),
      managedRoot,
      stateRoot,
      authenticationToken: "stdin-only-secret",
    });
    assert.equal(result.unityVersion, "6000.3.21f1");
    assert.equal(result.activePath.startsWith(`${managedRoot}${path.sep}`), true);
    assert.equal(result.handoffPath.startsWith(`${stateRoot}${path.sep}`), true);
    assert.equal(result.handoffPath.startsWith(`${result.activePath}${path.sep}`), false);
    const handoffBytes = await readFile(result.handoffPath);
    assert.equal(createHash("sha256").update(handoffBytes).digest("hex"), result.handoffSha256);
    const handoff = JSON.parse(handoffBytes.toString("utf8"));
    assert.deepEqual(Object.keys(handoff).sort(), [
      "activeProjectPath", "baselineRevision", "createdAtUnixMs", "descriptorHash", "manifestHash",
      "ownerKeyId", "projectUuid", "publisherKeyId", "schemaVersion", "sessionJoinCode",
    ]);
    assert.equal(handoff.activeProjectPath, result.activePath);
    assert.equal(handoff.ownerKeyId, fixture.projectInvite.ownerKeyId);
    assert.equal(JSON.stringify(handoff).includes("stdin-only-secret"), false);
    const storedInvite = JSON.parse(await readFile(path.join(
      managedRoot, fixture.projectInvite.projectUuid, "metadata", "invite.json",
    ), "utf8"));
    assert.deepEqual(storedInvite, fixture.projectInvite);
    const guestStateRoot = path.join(stateRoot, "guest-core");
    const trust = await readGuestTrustPin(guestStateRoot, fixture.projectInvite.projectUuid);
    assert.equal(trust.state, "valid");
    assert.equal(trust.pin.ownerKeyId, fixture.projectInvite.ownerKeyId);
    assert.equal(trust.pin.publisherKeyId, fixture.publication.descriptor.publisherKeyId);
    assert.equal(events.filter((event) => event.event === "trust").length, 1);

    const trustedRepeat = new TeamForgeGuestOrchestrator({ coordinatorFactory: fixture.coordinatorFactory });
    const repeatEvents = [];
    trustedRepeat.on("guestEvent", (event) => repeatEvents.push(event));
    await trustedRepeat.start({
      invite: JSON.stringify(fixture.bootstrapInvite), managedRoot, stateRoot,
    });
    assert.equal(repeatEvents.some((event) => event.event === "trust"), false);

    await writeFile(trust.destination, "{damaged", "utf8");
    const corruptRepeat = new TeamForgeGuestOrchestrator({ coordinatorFactory: fixture.coordinatorFactory });
    const corruptEvents = [];
    approveTrust(corruptRepeat, corruptEvents);
    await corruptRepeat.start({
      invite: JSON.stringify(fixture.bootstrapInvite), managedRoot, stateRoot,
    });
    assert.equal(corruptEvents.some((event) => event.event === "trust" && event.reason === "invalid"), true);
    assert.equal((await readGuestTrustPin(guestStateRoot, fixture.projectInvite.projectUuid)).state, "valid");

    const legacyRoot = path.join(root, "legacy-projects");
    const legacyState = path.join(root, "legacy-state");
    const legacy = new TeamForgeGuestOrchestrator({ coordinatorFactory: fixture.coordinatorFactory });
    approveTrust(legacy, []);
    const legacyResult = await legacy.start({
      invite: JSON.stringify(fixture.projectInvite), managedRoot: legacyRoot, stateRoot: legacyState,
    });
    assert.equal(legacyResult.handoffPath, "");
    assert.equal(legacyResult.handoffSha256, "");
    await assert.rejects(() => access(path.join(legacyState, "guest-core", "handoff")));
  } finally {
    await fixture?.seed.stop();
    await cleanup(root);
  }
});

test("Guest pause reconnects and resumes verified chunks without activating a partial Project", async () => {
  const root = await temporaryRoot();
  let fixture;
  try {
    fixture = await transferFixture(root, { large: true, maxBytesPerSecond: 131_072 });
    const managedRoot = path.join(root, "projects");
    const stateRoot = path.join(root, "state");
    const orchestrator = new TeamForgeGuestOrchestrator({
      coordinatorFactory: fixture.coordinatorFactory,
      syncOptions: { maxConcurrency: 1 },
    });
    const events = [];
    let pauseSent = false;
    orchestrator.on("guestEvent", (event) => {
      events.push(event);
      if (!pauseSent && event.event === "progress" && event.completedChunks >= 1 && event.remainingBytes > 0) {
        pauseSent = true;
        orchestrator.pause();
      } else if (event.event === "paused") {
        orchestrator.resume();
      } else if (event.event === "trust") {
        orchestrator.trust({ challengeId: event.challengeId, approved: true });
      }
    });
    const result = await orchestrator.start({
      invite: JSON.stringify(fixture.bootstrapInvite), managedRoot, stateRoot,
    });
    assert.equal(pauseSent, true);
    assert(events.some((event) => event.event === "paused"), true);
    assert(events.some((event) => event.event === "resumed"), true);
    assert(events.some((event) => event.event === "progress" && event.resumedChunks >= 1), true);
    assert.equal(await readFile(path.join(result.activePath, "Assets", "Payload-5.bin")).then((value) => value.length), 65_536);
  } finally {
    await fixture?.seed.stop();
    await cleanup(root);
  }
});

test("Guest cancel leaves verified chunks resumable and never creates an Active pointer", async () => {
  const root = await temporaryRoot();
  let fixture;
  try {
    fixture = await transferFixture(root, { large: true, maxBytesPerSecond: 131_072 });
    const managedRoot = path.join(root, "projects");
    const stateRoot = path.join(root, "state");
    const first = new TeamForgeGuestOrchestrator({
      coordinatorFactory: fixture.coordinatorFactory,
      syncOptions: { maxConcurrency: 1 },
    });
    let cancelled = false;
    first.on("guestEvent", (event) => {
      if (!cancelled && event.event === "progress" && event.completedChunks >= 1 && event.remainingBytes > 0) {
        cancelled = true;
        first.cancel();
      }
    });
    await assert.rejects(() => first.start({
      invite: JSON.stringify(fixture.bootstrapInvite), managedRoot, stateRoot,
    }), { code: "guest_cancelled" });
    assert.equal(cancelled, true);
    const metadataRoot = path.join(managedRoot, fixture.projectInvite.projectUuid, "metadata");
    await assert.rejects(() => access(path.join(metadataRoot, "current.json")));
    const chunksRoot = path.join(metadataRoot, "chunks");
    const storedChunkDirectories = await readdir(chunksRoot);
    assert(storedChunkDirectories.length > 0);

    const resumed = new TeamForgeGuestOrchestrator({
      coordinatorFactory: fixture.coordinatorFactory,
      syncOptions: { maxConcurrency: 1 },
    });
    const events = [];
    approveTrust(resumed, events);
    const result = await resumed.start({
      invite: JSON.stringify(fixture.bootstrapInvite), managedRoot, stateRoot,
    });
    assert(events.some((event) => event.event === "progress" && event.resumedChunks >= 1));
    assert.equal(await access(result.activePath).then(() => true), true);
  } finally {
    await fixture?.seed.stop();
    await cleanup(root);
  }
});

test("Guest cancel during local preparation prevents any Coordinator connection", async () => {
  const root = await temporaryRoot();
  try {
    const owner = generateIdentity("Owner");
    const invite = createInvite({
      serverAddress: "https://coordinator.invalid",
      realtimePath: "ws",
      projectId: "cancel-before-connect",
      projectUuid: randomUUID().toLowerCase(),
      sessionId: "editors",
      ownerIdentity: owner,
    });
    let releaseImport;
    let importStarted;
    const started = new Promise((resolve) => { importStarted = resolve; });
    const gate = new Promise((resolve) => { releaseImport = resolve; });
    let coordinatorConnections = 0;
    const orchestrator = new TeamForgeGuestOrchestrator({
      engineFactory: () => ({
        async importInviteValue() {
          importStarted();
          await gate;
          return { project: { projectId: invite.projectId, projectUuid: invite.projectUuid } };
        },
      }),
      coordinatorFactory: () => {
        coordinatorConnections += 1;
        throw new Error("must not connect");
      },
    });
    const operation = orchestrator.start({
      invite: JSON.stringify(invite),
      managedRoot: path.join(root, "projects"),
      stateRoot: path.join(root, "state"),
    });
    await started;
    orchestrator.cancel();
    releaseImport();
    await assert.rejects(() => operation, { code: "guest_cancelled" });
    assert.equal(coordinatorConnections, 0);
  } finally {
    await cleanup(root);
  }
});

test("Guest cancel during final handoff never completes and removes only the new handoff", async () => {
  const root = await temporaryRoot();
  let fixture;
  try {
    fixture = await transferFixture(root);
    const managedRoot = path.join(root, "projects");
    const stateRoot = path.join(root, "state");
    let handoffStarted;
    let releaseHandoff;
    const started = new Promise((resolve) => { handoffStarted = resolve; });
    const gate = new Promise((resolve) => { releaseHandoff = resolve; });
    let createdHandoffPath = "";
    const handoffWriter = async (guestStateRoot, value) => {
      const handoffRoot = path.join(guestStateRoot, "handoff");
      await mkdir(handoffRoot, { recursive: true });
      createdHandoffPath = path.join(handoffRoot, `${randomUUID().toLowerCase()}.json`);
      const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      await writeFile(createdHandoffPath, bytes, { flag: "wx", mode: 0o600 });
      handoffStarted();
      await gate;
      return {
        handoffPath: createdHandoffPath,
        handoffSha256: createHash("sha256").update(bytes).digest("hex"),
      };
    };
    const orchestrator = new TeamForgeGuestOrchestrator({
      coordinatorFactory: fixture.coordinatorFactory,
      handoffWriter,
    });
    const events = [];
    approveTrust(orchestrator, events);
    const operation = orchestrator.start({
      invite: JSON.stringify(fixture.bootstrapInvite), managedRoot, stateRoot,
    });

    await started;
    assert.deepEqual(orchestrator.cancel(), { accepted: true, state: "Cancelling" });
    releaseHandoff();
    await assert.rejects(() => operation, { code: "guest_cancelled" });
    assert.equal(events.some((event) => event.event === "state" && event.state === "Complete"), false);
    await assert.rejects(() => access(createdHandoffPath));
    assert.deepEqual(await readdir(path.dirname(createdHandoffPath)), []);

    // Cancellation arrived after atomic activation. Keep the fully verified Active
    // pointer reusable, but never expose a Unity handoff or a successful result.
    await access(path.join(managedRoot, fixture.projectInvite.projectUuid, "metadata", "current.json"));
  } finally {
    await fixture?.seed.stop();
    await cleanup(root);
  }
});

test("Guest pause during final handoff removes it before a verified resume completes", async () => {
  const root = await temporaryRoot();
  let fixture;
  try {
    fixture = await transferFixture(root);
    const managedRoot = path.join(root, "projects");
    const stateRoot = path.join(root, "state");
    let firstHandoffStarted;
    let releaseFirstHandoff;
    let pausedEvent;
    const firstStarted = new Promise((resolve) => { firstHandoffStarted = resolve; });
    const firstGate = new Promise((resolve) => { releaseFirstHandoff = resolve; });
    const paused = new Promise((resolve) => { pausedEvent = resolve; });
    const createdHandoffPaths = [];
    const handoffWriter = async (guestStateRoot, value) => {
      const handoffRoot = path.join(guestStateRoot, "handoff");
      await mkdir(handoffRoot, { recursive: true });
      const destination = path.join(handoffRoot, `${randomUUID().toLowerCase()}.json`);
      const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      await writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
      createdHandoffPaths.push(destination);
      if (createdHandoffPaths.length === 1) {
        firstHandoffStarted();
        await firstGate;
      }
      return {
        handoffPath: destination,
        handoffSha256: createHash("sha256").update(bytes).digest("hex"),
      };
    };
    const orchestrator = new TeamForgeGuestOrchestrator({
      coordinatorFactory: fixture.coordinatorFactory,
      handoffWriter,
    });
    const events = [];
    approveTrust(orchestrator, events);
    orchestrator.on("guestEvent", (event) => {
      if (event.event === "paused") pausedEvent();
    });
    const operation = orchestrator.start({
      invite: JSON.stringify(fixture.bootstrapInvite), managedRoot, stateRoot,
    });

    await firstStarted;
    assert.deepEqual(orchestrator.pause(), { accepted: true, state: "Pausing" });
    releaseFirstHandoff();
    await paused;
    await assert.rejects(() => access(createdHandoffPaths[0]));
    assert.equal(events.some((event) => event.event === "state" && event.state === "Complete"), false);

    assert.deepEqual(orchestrator.resume(), { accepted: true, state: "Resuming" });
    const result = await operation;
    assert.equal(createdHandoffPaths.length, 2);
    assert.equal(result.handoffPath, createdHandoffPaths[1]);
    await access(result.handoffPath);
    assert.equal(events.some((event) => event.event === "state" && event.state === "Complete"), true);
  } finally {
    await fixture?.seed.stop();
    await cleanup(root);
  }
});
