import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { TeamForgeHostOrchestrator, resolveCoordinatorEndpoint } from "../src/host-orchestrator.mjs";
import { endpointWithAdvertisedHost } from "../src/project-peer.mjs";
import { validateBootstrapInvite } from "../src/bootstrap-invite.mjs";
import { validateInvite } from "../src/invite.mjs";
import { cleanup, createUnityProject, temporaryRoot } from "./helpers.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function hostFixture(root) {
  const projectRoot = path.join(root, "UnityHost");
  const projectUuid = randomUUID();
  const projectId = "wp3-host";
  const sessionId = "host-session";
  const serverPort = await unusedPort();
  await createUnityProject(projectRoot, {
    assetFiles: {
      "Assets/Host.txt": "host baseline\n",
      "Assets/Scene.unity": "saved scene\n",
    },
  });
  await writeFile(
    path.join(projectRoot, "ProjectSettings", "TeamForgeProject.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      projectUuid,
      baselineRevision: 0,
      manifestHash: "",
      descriptorHash: "",
      unityVersion: "6000.3.21f1",
      teamForgePackageVersion: "0.5.1",
      realtimeProtocolVersion: 1,
      transferProtocolVersion: 1,
      manifestSchemaVersion: 1,
    }, null, 2)}\n`,
  );
  const launchPath = path.join(projectRoot, "teamforge-project-peer.launch.json");
  await writeFile(launchPath, `${JSON.stringify({
    schemaVersion: 1,
    serverAddress: `http://127.0.0.1:${serverPort}`,
    coordinatorListenHost: "127.0.0.1",
    realtimePath: "ws",
    projectId,
    sessionId,
    projectUuid,
    sourceProjectRelativePath: ".",
    projectDescriptorRelativePath: "ProjectSettings/TeamForgeProject.json",
    managedProjectsRelativePath: "TeamForgeProjects",
    realtimeProtocolVersion: 1,
    transferProtocolVersion: 1,
    manifestSchemaVersion: 1,
    authenticationTokenEnvironmentVariable: "TEAMFORGE_AUTH_TOKEN",
    ownerKeyEnvironmentVariable: "TEAMFORGE_OWNER_PRIVATE_KEY",
    allowCurrentProjectAsSeedSource: true,
  }, null, 2)}\n`);
  return { projectRoot, projectUuid, projectId, sessionId, serverPort, launchPath };
}

function sessionJoinCode(fixture, {
  scenePath = "Assets/Scene.unity",
  sceneSha256 = createHash("sha256").update("saved scene\n", "utf8").digest("hex"),
} = {}) {
  const payload = {
    format: "teamforge-join-v1",
    serverAddress: `http://127.0.0.1:${fixture.serverPort}`,
    realtimePath: "ws",
    projectId: fixture.projectId,
    sessionId: fixture.sessionId,
    projectUuid: fixture.projectUuid,
    productVersion: "0.5.1",
    hostDisplayName: "WP4 Host Test",
    createdUtc: "2026-08-14T00:00:00.0000000Z",
    sceneBaseline: {
      scenePath,
      sceneGuid: "0123456789abcdef0123456789abcdef",
      sha256: sceneSha256,
    },
  };
  return `TF1.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
}

test("WP3 plans, explicitly commits through the WP2 manager, returns a signed invite, and stops owned processes", async () => {
  const root = await temporaryRoot("teamforge-wp3-host-");
  const orchestrator = new TeamForgeHostOrchestrator({ workspaceRoot });
  try {
    const fixture = await hostFixture(root);
    const plan = await orchestrator.planHost({ launchSettingsPath: fixture.launchPath });
    assert.equal(plan.state, "awaiting_publish_confirmation");
    assert.match(plan.reviewFingerprint, /^[0-9a-f]{64}$/u);
    assert.equal(plan.review.firstPublish, true);
    assert(plan.review.added > 0);

    const missingConfirmation = await orchestrator.commitHost({
      planId: plan.planId,
      reviewFingerprint: plan.reviewFingerprint,
      confirmation: "",
    });
    assert.equal(missingConfirmation.failure.rawCode, "publish_cancelled");

    const missingRealtime = await orchestrator.commitHost({
      planId: plan.planId,
      reviewFingerprint: plan.reviewFingerprint,
      confirmation: "PUBLISH",
      requireRealtimeBootstrap: true,
    });
    assert.equal(missingRealtime.state, "needs_action");
    assert.equal(missingRealtime.failure.kind, "realtime_session_missing");
    assert.equal(missingRealtime.failure.action, "restart_host_from_unity");
    assert.equal(missingRealtime.failure.rawCode, "realtime_session_missing");
    assert.equal(orchestrator.coordinatorHandle, null);
    assert.equal(orchestrator.seedHandle, null);

    const replanned = await orchestrator.planHost({ launchSettingsPath: fixture.launchPath });
    const ready = await orchestrator.commitHost({
      planId: replanned.planId,
      reviewFingerprint: replanned.reviewFingerprint,
      confirmation: "PUBLISH",
      realtimeJoinCode: sessionJoinCode(fixture),
      requireRealtimeBootstrap: true,
    });
    assert.equal(ready.state, "host_ready");
    assert.equal(ready.server.ready, true);
    assert.equal(ready.seed.ready, true);
    assert.equal(ready.baseline.revision, 1);
    const invite = validateInvite(JSON.parse(ready.invite));
    assert.equal(invite.projectUuid, fixture.projectUuid);
    assert.equal(invite.sessionId, fixture.sessionId);
    const bootstrap = validateBootstrapInvite(JSON.parse(ready.bootstrapInvite));
    assert.equal(bootstrap.projectInvite.projectUuid, fixture.projectUuid);
    assert.equal(bootstrap.projectInvite.ownerKeyId, invite.ownerKeyId);
    assert.equal(bootstrap.envelope.sessionJoinCode, sessionJoinCode(fixture));
    assert(!ready.invite.includes("TEAMFORGE_AUTH_TOKEN"));
    assert(!ready.bootstrapInvite.includes("TEAMFORGE_AUTH_TOKEN"));
    assert.equal(JSON.parse(await readFile(
      path.join(fixture.projectRoot, "ProjectSettings", "TeamForgeProject.json"),
      "utf8",
    )).baselineRevision, 1);

    const stopped = await orchestrator.stop();
    assert.equal(stopped.state, "idle");
    assert.equal(stopped.stopped.length, 2);
    assert(stopped.stopped.every((item) => item.stopped && item.graceful));
  } finally {
    await orchestrator.stop().catch(() => {});
    await cleanup(root);
  }
});

test("Host falls back from an occupied preferred Seed port and reuses the remembered fallback", async () => {
  const root = await temporaryRoot("teamforge-seed-port-fallback-");
  const occupied = net.createServer();
  await new Promise((resolve, reject) => {
    occupied.once("error", reject);
    occupied.listen(0, "127.0.0.1", resolve);
  });
  const preferredPort = occupied.address().port;
  let orchestrator = new TeamForgeHostOrchestrator({ workspaceRoot });
  try {
    const fixture = await hostFixture(root);
    const plan = await orchestrator.planHost({ launchSettingsPath: fixture.launchPath });
    const first = await orchestrator.commitHost({
      planId: plan.planId,
      reviewFingerprint: plan.reviewFingerprint,
      confirmation: "PUBLISH",
      preferredSeedPort: preferredPort,
    });
    assert.equal(first.state, "host_ready");
    assert(first.seed.port > 0 && first.seed.port <= 65_535);
    assert.notEqual(first.seed.port, preferredPort);
    assert.equal(occupied.listening, true, "an unrelated listener must never be killed or adopted");
    const rememberedPort = first.seed.port;

    const stopped = await orchestrator.stop();
    assert.equal(stopped.state, "idle");
    assert.equal(occupied.listening, true);

    orchestrator = new TeamForgeHostOrchestrator({ workspaceRoot });
    const resumePlan = await orchestrator.planHost({ launchSettingsPath: fixture.launchPath });
    assert.equal(resumePlan.review.reuseExistingBaseline, true);
    const resumed = await orchestrator.commitHost({
      planId: resumePlan.planId,
      reviewFingerprint: resumePlan.reviewFingerprint,
      confirmation: "PUBLISH",
      preferredSeedPort: rememberedPort,
    });
    assert.equal(resumed.state, "host_ready");
    assert.equal(resumed.seed.port, rememberedPort);
  } finally {
    await orchestrator.stop().catch(() => {});
    await new Promise((resolve) => occupied.close(() => resolve()));
    await cleanup(root);
  }
});

test("WP4 separates listen and advertised LAN endpoints, requires auth, and preserves explicit local-only mode", () => {
  const lan = resolveCoordinatorEndpoint({
    serverAddress: "http://192.168.10.25:5080",
    coordinatorListenHost: "0.0.0.0",
    realtimePath: "ws",
  }, "separately-shared-access-code");
  assert.equal(lan.host, "0.0.0.0");
  assert.equal(lan.advertisedHost, "192.168.10.25");
  assert.equal(lan.port, 5080);
  assert.equal(
    endpointWithAdvertisedHost("http://127.0.0.1:43123/teamforge-transfer/v1", lan.advertisedHost),
    "http://192.168.10.25:43123/teamforge-transfer/v1",
  );

  assert.throws(() => resolveCoordinatorEndpoint({
    serverAddress: "http://127.0.0.1:5080",
    coordinatorListenHost: "0.0.0.0",
    realtimePath: "ws",
  }, "separately-shared-access-code"), { code: "invalid_launch_settings" });
  assert.throws(() => resolveCoordinatorEndpoint({
    serverAddress: "http://192.168.10.25:5080",
    coordinatorListenHost: "0.0.0.0",
    realtimePath: "ws",
  }), { code: "invalid_launch_settings" });
  for (const serverAddress of ["http://0.0.0.0:5080", "http://[::]:5080"]) {
    assert.throws(() => resolveCoordinatorEndpoint({
      serverAddress,
      coordinatorListenHost: "0.0.0.0",
      realtimePath: "ws",
    }, "separately-shared-access-code"), { code: "invalid_launch_settings" });
  }
  assert.throws(
    () => endpointWithAdvertisedHost("http://127.0.0.1:43123/teamforge-transfer/v1", "0.0.0.0"),
    { code: "invalid_peer_endpoint" },
  );

  const localOnly = resolveCoordinatorEndpoint({
    serverAddress: "http://127.0.0.1:5080",
    coordinatorListenHost: "127.0.0.1",
    realtimePath: "ws",
  });
  assert.equal(localOnly.host, "127.0.0.1");
  assert.equal(localOnly.advertisedHost, "127.0.0.1");
});

test("WP3 rejects a source change after review and never reports Host Ready", async () => {
  const root = await temporaryRoot("teamforge-wp3-rereview-");
  const orchestrator = new TeamForgeHostOrchestrator({ workspaceRoot });
  try {
    const fixture = await hostFixture(root);
    const plan = await orchestrator.planHost({ launchSettingsPath: fixture.launchPath });
    assert.equal(plan.state, "awaiting_publish_confirmation");
    await writeFile(path.join(fixture.projectRoot, "Assets", "Host.txt"), "changed after review\n");
    const result = await orchestrator.commitHost({
      planId: plan.planId,
      reviewFingerprint: plan.reviewFingerprint,
      confirmation: "PUBLISH",
    });
    assert.equal(result.state, "needs_action");
    assert.equal(result.failure.kind, "source_changed");
    assert.equal(result.failure.action, "review_source_and_replan");
    assert.equal(JSON.parse(await readFile(
      path.join(fixture.projectRoot, "ProjectSettings", "TeamForgeProject.json"),
      "utf8",
    )).baselineRevision, 0);
  } finally {
    await orchestrator.stop().catch(() => {});
    await cleanup(root);
  }
});

test("WP4 Host rejects stale cached Scene hash or path before Coordinator start and Publish", async () => {
  for (const [label, joinOptions] of [
    ["hash", { sceneSha256: "a".repeat(64) }],
    ["path", { scenePath: "Assets/MissingScene.unity" }],
  ]) {
    const root = await temporaryRoot(`teamforge-wp4-stale-scene-${label}-`);
    const orchestrator = new TeamForgeHostOrchestrator({ workspaceRoot });
    try {
      const fixture = await hostFixture(root);
      const plan = await orchestrator.planHost({ launchSettingsPath: fixture.launchPath });
      assert.equal(plan.state, "awaiting_publish_confirmation");
      const result = await orchestrator.commitHost({
        planId: plan.planId,
        reviewFingerprint: plan.reviewFingerprint,
        confirmation: "PUBLISH",
        realtimeJoinCode: sessionJoinCode(fixture, joinOptions),
      });
      assert.equal(result.state, "needs_action");
      assert.equal(result.failure.kind, "source_changed");
      assert.equal(result.failure.action, "review_source_and_replan");
      assert.equal(orchestrator.coordinatorHandle, null);
      assert.equal(orchestrator.seedHandle, null);
      assert.equal(JSON.parse(await readFile(
        path.join(fixture.projectRoot, "ProjectSettings", "TeamForgeProject.json"),
        "utf8",
      )).baselineRevision, 0);
    } finally {
      await orchestrator.stop().catch(() => {});
      await cleanup(root);
    }
  }
});

test("WP4 Host rejects a prior cached Scene fingerprint after a reviewed Scene source change", async () => {
  const root = await temporaryRoot("teamforge-wp4-scene-source-change-");
  let orchestrator = new TeamForgeHostOrchestrator({ workspaceRoot });
  try {
    const fixture = await hostFixture(root);
    const staleJoinCode = sessionJoinCode(fixture);
    const firstPlan = await orchestrator.planHost({ launchSettingsPath: fixture.launchPath });
    const firstReady = await orchestrator.commitHost({
      planId: firstPlan.planId,
      reviewFingerprint: firstPlan.reviewFingerprint,
      confirmation: "PUBLISH",
      realtimeJoinCode: staleJoinCode,
    });
    assert.equal(firstReady.state, "host_ready");
    assert.equal(firstReady.baseline.revision, 1);
    await orchestrator.stop();

    await writeFile(path.join(fixture.projectRoot, "Assets", "Scene.unity"), "revision two saved scene\n");
    orchestrator = new TeamForgeHostOrchestrator({ workspaceRoot });
    const changedPlan = await orchestrator.planHost({ launchSettingsPath: fixture.launchPath });
    assert.equal(changedPlan.state, "awaiting_publish_confirmation");
    assert.equal(changedPlan.review.changed, 1);
    const rejected = await orchestrator.commitHost({
      planId: changedPlan.planId,
      reviewFingerprint: changedPlan.reviewFingerprint,
      confirmation: "PUBLISH",
      realtimeJoinCode: staleJoinCode,
    });
    assert.equal(rejected.state, "needs_action");
    assert.equal(rejected.failure.kind, "source_changed");
    assert.equal(orchestrator.coordinatorHandle, null);
    assert.equal(orchestrator.seedHandle, null);
    assert.equal(JSON.parse(await readFile(
      path.join(fixture.projectRoot, "ProjectSettings", "TeamForgeProject.json"),
      "utf8",
    )).baselineRevision, 1);
  } finally {
    await orchestrator.stop().catch(() => {});
    await cleanup(root);
  }
});

test("WP3 re-arms an empty Coordinator from revision 2, publishes only changed source, and resumes no-op Host without revision 3", async () => {
  const root = await temporaryRoot("teamforge-wp3-registry-rearm-");
  let orchestrator = new TeamForgeHostOrchestrator({ workspaceRoot });
  try {
    const fixture = await hostFixture(root);

    const firstPlan = await orchestrator.planHost({ launchSettingsPath: fixture.launchPath });
    const firstReady = await orchestrator.commitHost({
      planId: firstPlan.planId,
      reviewFingerprint: firstPlan.reviewFingerprint,
      confirmation: "PUBLISH",
    });
    assert.equal(firstReady.state, "host_ready");
    assert.equal(firstReady.baseline.revision, 1);
    assert.equal(firstReady.bootstrapInvite, undefined);
    await orchestrator.stop();

    await writeFile(path.join(fixture.projectRoot, "Assets", "Host.txt"), "revision two\n");
    orchestrator = new TeamForgeHostOrchestrator({ workspaceRoot });
    const secondPlan = await orchestrator.planHost({ launchSettingsPath: fixture.launchPath });
    assert.equal(secondPlan.state, "awaiting_publish_confirmation");
    assert.equal(secondPlan.review.reuseExistingBaseline, false);
    assert.equal(secondPlan.review.changed, 1);
    const secondReady = await orchestrator.commitHost({
      planId: secondPlan.planId,
      reviewFingerprint: secondPlan.reviewFingerprint,
      confirmation: "PUBLISH",
    });
    assert.equal(secondReady.state, "host_ready");
    assert.equal(secondReady.baseline.revision, 2);
    assert.equal(validateInvite(JSON.parse(secondReady.invite)).projectUuid, fixture.projectUuid);
    assert.equal(JSON.parse(await readFile(
      path.join(fixture.projectRoot, "ProjectSettings", "TeamForgeProject.json"),
      "utf8",
    )).baselineRevision, 2);
    await orchestrator.stop();

    orchestrator = new TeamForgeHostOrchestrator({ workspaceRoot });
    const resumePlan = await orchestrator.planHost({ launchSettingsPath: fixture.launchPath });
    assert.equal(resumePlan.state, "awaiting_publish_confirmation");
    assert.equal(resumePlan.review.reuseExistingBaseline, true);
    assert.equal(resumePlan.review.added, 0);
    assert.equal(resumePlan.review.changed, 0);
    assert.equal(resumePlan.review.deleted, 0);
    const resumed = await orchestrator.commitHost({
      planId: resumePlan.planId,
      reviewFingerprint: resumePlan.reviewFingerprint,
      confirmation: "PUBLISH",
    });
    assert.equal(resumed.state, "host_ready");
    assert.equal(resumed.baseline.revision, 2);
    assert.equal(validateInvite(JSON.parse(resumed.invite)).projectUuid, fixture.projectUuid);
    assert.equal(JSON.parse(await readFile(
      path.join(fixture.projectRoot, "ProjectSettings", "TeamForgeProject.json"),
      "utf8",
    )).baselineRevision, 2);
    const stopped = await orchestrator.stop();
    assert.equal(stopped.state, "idle");
    assert.equal(stopped.stopped.length, 2);
    assert(stopped.stopped.every((item) => item.stopped && item.graceful));
  } finally {
    await orchestrator.stop().catch(() => {});
    await cleanup(root);
  }
});

test("WP3 existing-Baseline resume rechecks saved source after review and never reports stale Host Ready", async () => {
  const root = await temporaryRoot("teamforge-wp3-resume-rereview-");
  let orchestrator = new TeamForgeHostOrchestrator({ workspaceRoot });
  try {
    const fixture = await hostFixture(root);
    const firstPlan = await orchestrator.planHost({ launchSettingsPath: fixture.launchPath });
    const firstReady = await orchestrator.commitHost({
      planId: firstPlan.planId,
      reviewFingerprint: firstPlan.reviewFingerprint,
      confirmation: "PUBLISH",
    });
    assert.equal(firstReady.state, "host_ready");
    assert.equal(firstReady.baseline.revision, 1);
    await orchestrator.stop();

    orchestrator = new TeamForgeHostOrchestrator({ workspaceRoot });
    const resumePlan = await orchestrator.planHost({ launchSettingsPath: fixture.launchPath });
    assert.equal(resumePlan.review.reuseExistingBaseline, true);
    await writeFile(path.join(fixture.projectRoot, "Assets", "Host.txt"), "changed after resume review\n");
    const result = await orchestrator.commitHost({
      planId: resumePlan.planId,
      reviewFingerprint: resumePlan.reviewFingerprint,
      confirmation: "PUBLISH",
    });
    assert.equal(result.state, "needs_action");
    assert.equal(result.failure.kind, "source_changed");
    assert.equal(JSON.parse(await readFile(
      path.join(fixture.projectRoot, "ProjectSettings", "TeamForgeProject.json"),
      "utf8",
    )).baselineRevision, 1);
  } finally {
    await orchestrator.stop().catch(() => {});
    await cleanup(root);
  }
});
