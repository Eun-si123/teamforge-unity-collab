import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createTeamForgeServer } from "../../server/src/teamforge-server.mjs";
import { CoordinatorClient } from "../src/coordinator-client.mjs";
import { ProjectPeerEngine } from "../src/project-peer.mjs";
import { cleanup, createUnityProject, temporaryRoot } from "./helpers.mjs";

const silentLogger = { info() {}, warn() {}, error() {} };

function connection(serverAddress, realtimePath, projectId, suffix) {
  return {
    serverAddress,
    realtimePath,
    userId: `sidecar-${suffix}`,
    userName: `Project Peer ${suffix}`,
    projectId,
    sessionId: "editors",
  };
}

test("real TeamForge Server accepts publish+announce fields, excludes Sidecar Presence, and advances approved revisions", async () => {
  const root = await temporaryRoot();
  const server = createTeamForgeServer({ host: "127.0.0.1", port: 0, logger: silentLogger });
  const runningSeeds = [];
  let observer;
  try {
    const endpoint = await server.start();
    const serverAddress = `http://127.0.0.1:${endpoint.port}`;
    const projectId = "real-server-project";
    const sourceRoot = path.join(root, "source");
    await createUnityProject(sourceRoot, {
      assetFiles: { "Assets/Shared.txt": "revision one\n" },
    });
    const engine = new ProjectPeerEngine({ managedRoot: path.join(root, "managed") });
    const source = await engine.resolveSourceProject({ projectRoot: sourceRoot, projectId });
    await engine.validatePublishBase({ projectId, source, coordinatorBaseline: null });
    const first = await engine.preparePublication({
      projectRoot: sourceRoot,
      projectId,
      projectUuid: source.project.projectUuid,
      baselineRevision: 1,
    });
    const firstSeed = await engine.startSeed({
      publication: first,
      sessionId: "editors",
      coordinatorOptions: connection(serverAddress, endpoint.wsPath, projectId, "one"),
      publish: true,
    });
    runningSeeds.push(firstSeed);
    assert.equal(server.projectRegistryCount, 1);
    assert.equal(server.projectPeerCount, 1);
    assert.equal(server.presenceMemberCount, 0, "File Sidecar must not appear in Team Members Presence.");
    assert.equal((await engine.publishedBaseline(first.project.projectUuid)).baselineRevision, 1);
    assert.equal((await engine.loadPublication({ projectId, requireApproved: true })).descriptor.baselineRevision, 1);

    observer = new CoordinatorClient(connection(serverAddress, endpoint.wsPath, projectId, "observer"));
    const snapshot = await observer.connect();
    assert.equal(snapshot.baseline.baselineRevision, 1);
    const refreshedSource = await engine.resolveSourceProject({ projectRoot: sourceRoot, projectId });
    const base = await engine.validatePublishBase({
      projectId,
      source: refreshedSource,
      coordinatorBaseline: snapshot.baseline,
    });
    assert.equal(base.previousPublication.descriptor.baselineRevision, 1);
    observer.close();
    observer = null;

    await writeFile(path.join(sourceRoot, "Assets", "Shared.txt"), "revision two\n");
    const second = await engine.preparePublication({
      projectRoot: sourceRoot,
      projectId,
      projectUuid: first.project.projectUuid,
      baselineRevision: 2,
      expectedOwnerKeyId: snapshot.baseline.ownerKeyId,
    });
    const review = engine.summarizePublicationChanges(second.manifest, base.previousPublication.manifest);
    assert.equal(review.changed.includes("Assets/Shared.txt"), true);
    const secondSeed = await engine.startSeed({
      publication: second,
      sessionId: "editors",
      coordinatorOptions: connection(serverAddress, endpoint.wsPath, projectId, "two"),
      publish: true,
    });
    runningSeeds.push(secondSeed);
    const published = await engine.publishedBaseline(first.project.projectUuid);
    assert.equal(published.baselineRevision, 2);
    assert.equal((await engine.loadPublication({ projectId, requireApproved: true })).descriptor.baselineRevision, 2);
    const unityDescriptor = JSON.parse(await readFile(
      path.join(sourceRoot, "ProjectSettings", "TeamForgeProject.json"), "utf8",
    ));
    assert.equal(unityDescriptor.baselineRevision, 2);
    assert.equal(server.presenceMemberCount, 0);
  } finally {
    observer?.close();
    for (const seed of runningSeeds.reverse()) await seed.stop();
    await server.stop();
    await cleanup(root);
  }
});

test("long-running Seed reconnects and re-advertises after Coordinator restart", async () => {
  const root = await temporaryRoot();
  let firstServer = createTeamForgeServer({ host: "127.0.0.1", port: 0, logger: silentLogger });
  let secondServer;
  let seed;
  try {
    const firstEndpoint = await firstServer.start();
    const serverAddress = `http://127.0.0.1:${firstEndpoint.port}`;
    const projectId = "restart-recovery";
    const sourceRoot = path.join(root, "source");
    await createUnityProject(sourceRoot);
    const engine = new ProjectPeerEngine({ managedRoot: path.join(root, "managed") });
    const source = await engine.resolveSourceProject({ projectRoot: sourceRoot, projectId });
    const publication = await engine.preparePublication({
      projectRoot: sourceRoot,
      projectId,
      projectUuid: source.project.projectUuid,
      baselineRevision: 1,
    });
    seed = await engine.startSeed({
      publication,
      sessionId: "editors",
      coordinatorOptions: connection(serverAddress, firstEndpoint.wsPath, projectId, "restart"),
      publish: true,
    });
    assert.equal(firstServer.projectPeerCount, 1);
    await firstServer.stop();
    firstServer = null;

    secondServer = createTeamForgeServer({
      host: "127.0.0.1", port: firstEndpoint.port, logger: silentLogger,
    });
    await secondServer.start();
    const deadline = Date.now() + 6_000;
    while ((secondServer.projectPeerCount !== 1 || seed.reconnectState.attempts !== 0 ||
        seed.reconnectState.lastError !== "") && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(secondServer.projectRegistryCount, 1);
    assert.equal(secondServer.projectPeerCount, 1);
    assert.equal(secondServer.presenceMemberCount, 0);
    assert.equal(seed.reconnectState.attempts, 0);
    assert.equal(seed.reconnectState.lastError, "");
  } finally {
    await seed?.stop();
    await firstServer?.stop();
    await secondServer?.stop();
    await cleanup(root);
  }
});
