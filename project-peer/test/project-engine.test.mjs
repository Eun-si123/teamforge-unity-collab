import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { ProjectPeerEngine } from "../src/project-peer.mjs";
import { descriptorCoordinatorFields } from "../src/coordinator-client.mjs";
import { loadLaunchSettings } from "../src/launch-settings.mjs";
import { cleanup, createUnityProject, temporaryRoot } from "./helpers.mjs";

function unityDescriptor(projectUuid, {
  baselineRevision = 0,
  manifestHash = "",
  descriptorHash = "",
} = {}) {
  return {
    schemaVersion: 1,
    projectUuid,
    baselineRevision,
    manifestHash,
    descriptorHash,
    unityVersion: "6000.3.21f1",
    teamForgePackageVersion: "0.5.1",
    realtimeProtocolVersion: 1,
    transferProtocolVersion: 1,
    manifestSchemaVersion: 1,
  };
}

async function writeUnityDescriptor(projectRoot, value, trailing = "\n") {
  const destination = path.join(projectRoot, "ProjectSettings", "TeamForgeProject.json");
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(value, null, 2)}${trailing}`);
  return destination;
}

async function acceptingCoordinator(projectId, projectUuid) {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  server.on("connection", (socket) => {
    socket.on("message", (bytes) => {
      const message = JSON.parse(bytes.toString("utf8"));
      if (message.type === "hello") {
        socket.send(JSON.stringify({
          type: "hello_ack", protocolVersion: 1, requestId: message.requestId,
          connectionId: randomUUID(), projectTransferEnabled: true,
        }));
        socket.send(JSON.stringify({
          type: "project_registry_snapshot", protocolVersion: 1, projectId, projectUuid,
          baseline: null, peers: [], serverTimestampUnixMs: Date.now(),
        }));
      } else if (message.type === "project_baseline_publish") {
        socket.send(JSON.stringify({
          type: "project_baseline_changed", protocolVersion: 1, requestId: message.requestId,
          baseline: { ...descriptorCoordinatorFields(message), projectId },
          idempotent: false, serverTimestampUnixMs: Date.now(),
        }));
      } else if (message.type === "project_peer_announce") {
        socket.send(JSON.stringify({
          type: "project_peer_joined", protocolVersion: 1, requestId: message.requestId,
          peer: {
            connectionId: "seed-connection",
            projectUuid: message.projectUuid,
            baselineRevision: message.baselineRevision,
            manifestHash: message.manifestHash,
            endpoint: message.endpoint,
            transferToken: message.transferToken,
          },
          serverTimestampUnixMs: Date.now(),
        }));
      }
    });
  });
  const address = server.address();
  return {
    address: `ws://127.0.0.1:${address.port}`,
    async stop() {
      for (const client of server.clients) client.terminate();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function coordinatorOptions(serverAddress, projectId) {
  return {
    serverAddress,
    realtimePath: "ws",
    userId: "owner-peer",
    userName: "Owner Peer",
    projectId,
    sessionId: "editors",
  };
}

test("Source descriptor pins UUID, is excluded from Manifest, and updates only after Coordinator approval", async () => {
  const root = await temporaryRoot();
  let coordinator;
  let running;
  try {
    const source = path.join(root, "source");
    const managedRoot = path.join(root, "managed");
    const projectId = "source-pinned";
    const projectUuid = randomUUID();
    await createUnityProject(source);
    const descriptorPath = await writeUnityDescriptor(source, unityDescriptor(projectUuid));
    const engine = new ProjectPeerEngine({ managedRoot });
    const publication = await engine.preparePublication({
      projectRoot: source,
      projectId,
      baselineRevision: 1,
    });
    assert.equal(publication.project.projectUuid, projectUuid);
    assert.equal(publication.manifest.files.some((file) => file.path.endsWith("TeamForgeProject.json")), false);
    assert.equal(JSON.parse(await readFile(descriptorPath, "utf8")).baselineRevision, 0);

    coordinator = await acceptingCoordinator(projectId, projectUuid);
    running = await engine.startSeed({
      publication,
      sessionId: "editors",
      coordinatorOptions: coordinatorOptions(coordinator.address, projectId),
      publish: true,
    });
    const updated = JSON.parse(await readFile(descriptorPath, "utf8"));
    assert.equal(updated.projectUuid, projectUuid);
    assert.equal(updated.baselineRevision, 1);
    assert.equal(updated.manifestHash, publication.manifest.manifestHash);
    assert.equal(updated.descriptorHash, publication.descriptor.descriptorHash);
    assert.equal(Object.hasOwn(updated, "ownerPublicKey"), false);
    assert.equal(Object.hasOwn(updated, "transferToken"), false);
  } finally {
    await running?.stop();
    await coordinator?.stop();
    await cleanup(root);
  }
});

test("first Publish without a source descriptor creates it only after approval and never overwrites a concurrent edit", async () => {
  const root = await temporaryRoot();
  let coordinator;
  try {
    const projectId = "create-new-source";
    const source = path.join(root, "source");
    await createUnityProject(source);
    const engine = new ProjectPeerEngine({ managedRoot: path.join(root, "managed") });
    const publication = await engine.preparePublication({ projectRoot: source, projectId, baselineRevision: 1 });
    const descriptorPath = path.join(source, "ProjectSettings", "TeamForgeProject.json");
    await assert.rejects(() => readFile(descriptorPath), { code: "ENOENT" });
    coordinator = await acceptingCoordinator(projectId, publication.project.projectUuid);
    const running = await engine.startSeed({
      publication, sessionId: "editors",
      coordinatorOptions: coordinatorOptions(coordinator.address, projectId), publish: true,
    });
    assert.equal(JSON.parse(await readFile(descriptorPath, "utf8")).projectUuid, publication.project.projectUuid);
    await running.stop();

    const second = await engine.preparePublication({
      projectRoot: source, projectId, projectUuid: publication.project.projectUuid, baselineRevision: 2,
    });
    const concurrentlyEdited = `${JSON.stringify(unityDescriptor(publication.project.projectUuid), null, 2)}  \n`;
    await writeFile(descriptorPath, concurrentlyEdited);
    await assert.rejects(() => engine.startSeed({
      publication: second, sessionId: "editors",
      coordinatorOptions: coordinatorOptions(coordinator.address, projectId), publish: true,
    }), { code: "unity_descriptor_changed" });
    assert.equal(await readFile(descriptorPath, "utf8"), concurrentlyEdited);
  } finally {
    await coordinator?.stop();
    await cleanup(root);
  }
});

test("UUID mismatch and Owner-key loss fail closed instead of silently changing ownership", async () => {
  const root = await temporaryRoot();
  try {
    const managedRoot = path.join(root, "managed");
    const source = path.join(root, "source");
    const projectId = "owner-loss";
    const firstUuid = randomUUID();
    await createUnityProject(source);
    await writeUnityDescriptor(source, unityDescriptor(firstUuid));
    const engine = new ProjectPeerEngine({ managedRoot });
    const publication = await engine.preparePublication({
      projectRoot: source, projectId, projectUuid: firstUuid, baselineRevision: 1,
    });
    await rm(engine.ownerKeyPath(firstUuid));
    await assert.rejects(() => engine.preparePublication({
      projectRoot: source, projectId, projectUuid: firstUuid, baselineRevision: 2,
    }), { code: "owner_key_missing" });

    const otherSource = path.join(root, "other-source");
    await createUnityProject(otherSource);
    await writeUnityDescriptor(otherSource, unityDescriptor(randomUUID()));
    await assert.rejects(() => engine.resolveSourceProject({
      projectRoot: otherSource, projectId,
    }), { code: "project_uuid_conflict" });

    const publishedOnly = path.join(root, "published-only");
    await createUnityProject(publishedOnly);
    await writeUnityDescriptor(publishedOnly, unityDescriptor(randomUUID(), {
      baselineRevision: 4, manifestHash: "a".repeat(64), descriptorHash: "b".repeat(64),
    }));
    const isolated = new ProjectPeerEngine({ managedRoot: path.join(root, "isolated") });
    await assert.rejects(() => isolated.preparePublication({
      projectRoot: publishedOnly, projectId: "published-without-key", baselineRevision: 5,
    }), { code: "owner_key_missing" });
    assert(publication.descriptor.ownerKeyId);
  } finally {
    await cleanup(root);
  }
});

test("Unity launch settings are strict, path-relative, and UUID-pinned without credentials", async () => {
  const root = await temporaryRoot();
  try {
    const source = path.join(root, "source");
    await createUnityProject(source);
    const projectUuid = randomUUID();
    await writeUnityDescriptor(source, unityDescriptor(projectUuid));
    const launchPath = path.join(root, "launch.json");
    const settings = {
      schemaVersion: 1,
      serverAddress: "https://teamforge.example.com/base",
      coordinatorListenHost: "0.0.0.0",
      realtimePath: "ws",
      projectId: "launch-project",
      sessionId: "editors",
      projectUuid,
      sourceProjectRelativePath: "source",
      projectDescriptorRelativePath: "source/ProjectSettings/TeamForgeProject.json",
      managedProjectsRelativePath: "managed",
      realtimeProtocolVersion: 1,
      transferProtocolVersion: 1,
      manifestSchemaVersion: 1,
      authenticationTokenEnvironmentVariable: "TEAMFORGE_AUTH_TOKEN",
      ownerKeyEnvironmentVariable: "TEAMFORGE_OWNER_PRIVATE_KEY",
      allowCurrentProjectAsSeedSource: true,
    };
    await writeFile(launchPath, JSON.stringify(settings));
    const loaded = await loadLaunchSettings(launchPath, { requireSeedSource: true });
    assert.equal(loaded.sourceProjectRoot, source);
    assert.equal(loaded.managedRoot, path.join(root, "managed"));
    assert.equal(loaded.settings.projectUuid, projectUuid);
    assert.equal(loaded.settings.coordinatorListenHost, "0.0.0.0");

    const legacySettings = { ...settings };
    delete legacySettings.coordinatorListenHost;
    await writeFile(launchPath, JSON.stringify(legacySettings));
    const legacyLoaded = await loadLaunchSettings(launchPath, { requireSeedSource: true });
    assert.equal(legacyLoaded.settings.coordinatorListenHost, undefined);

    await writeFile(launchPath, JSON.stringify({ ...settings, authenticationToken: "secret" }));
    await assert.rejects(() => loadLaunchSettings(launchPath), { code: "invalid_launch_settings" });
  } finally {
    await cleanup(root);
  }
});

test("cancelled Publish drafts remain retryable but can never be selected by Seed", async () => {
  const root = await temporaryRoot();
  try {
    const sourceRoot = path.join(root, "source");
    const projectUuid = randomUUID();
    const projectId = "cancelled-draft";
    await createUnityProject(sourceRoot);
    await writeUnityDescriptor(sourceRoot, unityDescriptor(projectUuid));
    const engine = new ProjectPeerEngine({ managedRoot: path.join(root, "managed") });
    const firstDraft = await engine.preparePublication({
      projectRoot: sourceRoot, projectId, projectUuid, baselineRevision: 1,
    });
    assert.equal(await engine.publishedBaseline(projectUuid), null);
    await assert.rejects(() => engine.loadPublication({ projectId, requireApproved: true }), {
      code: "baseline_selection_required",
    });
    const source = await engine.resolveSourceProject({ projectRoot: sourceRoot, projectId });
    assert.equal((await engine.validatePublishBase({
      projectId, source, coordinatorBaseline: null,
    })).previousPublication, null);
    const retryDraft = await engine.preparePublication({
      projectRoot: sourceRoot, projectId, projectUuid, baselineRevision: 1,
    });
    assert.equal(retryDraft.descriptor.descriptorHash, firstDraft.descriptor.descriptorHash);
    await assert.rejects(() => engine.loadPublication({
      projectId,
      manifestHash: retryDraft.manifest.manifestHash,
      requireApproved: true,
    }), { code: "baseline_not_approved" });
  } finally {
    await cleanup(root);
  }
});

test("Publish review reports deterministic added, changed, and deleted paths", async () => {
  const root = await temporaryRoot();
  try {
    const sourceRoot = path.join(root, "source");
    const projectUuid = randomUUID();
    const projectId = "publish-review";
    await createUnityProject(sourceRoot, {
      assetFiles: { "Assets/A.txt": "one\n", "Assets/B.txt": "delete me\n" },
    });
    await writeUnityDescriptor(sourceRoot, unityDescriptor(projectUuid));
    const engine = new ProjectPeerEngine({ managedRoot: path.join(root, "managed") });
    const before = await engine.preparePublication({
      projectRoot: sourceRoot, projectId, projectUuid, baselineRevision: 1,
    });
    await writeFile(path.join(sourceRoot, "Assets", "A.txt"), "two\n");
    await rm(path.join(sourceRoot, "Assets", "B.txt"));
    await writeFile(path.join(sourceRoot, "Assets", "C.txt"), "new\n");
    const after = await engine.preparePublication({
      projectRoot: sourceRoot, projectId, projectUuid, baselineRevision: 2,
    });
    const review = engine.summarizePublicationChanges(after.manifest, before.manifest);
    assert.deepEqual(review.added, ["Assets/C.txt"]);
    assert.deepEqual(review.changed, ["Assets/A.txt"]);
    assert.deepEqual(review.deleted, ["Assets/B.txt"]);
    assert.equal(review.firstPublish, false);
  } finally {
    await cleanup(root);
  }
});

test("explicit descriptor repair restores an already-approved revision without creating a new Baseline", async () => {
  const root = await temporaryRoot();
  let coordinator;
  let running;
  try {
    const sourceRoot = path.join(root, "source");
    const projectUuid = randomUUID();
    const projectId = "descriptor-repair";
    await createUnityProject(sourceRoot);
    await writeUnityDescriptor(sourceRoot, unityDescriptor(projectUuid));
    const engine = new ProjectPeerEngine({ managedRoot: path.join(root, "managed") });
    const publication = await engine.preparePublication({
      projectRoot: sourceRoot, projectId, projectUuid, baselineRevision: 1,
    });
    coordinator = await acceptingCoordinator(projectId, projectUuid);
    running = await engine.startSeed({
      publication,
      sessionId: "editors",
      coordinatorOptions: coordinatorOptions(coordinator.address, projectId),
      publish: true,
    });
    await running.stop();
    running = null;
    const baseline = { ...descriptorCoordinatorFields(publication.descriptor), projectId };
    const currentSource = await engine.resolveSourceProject({ projectRoot: sourceRoot, projectId });
    await assert.rejects(() => engine.validatePublishBase({
      projectId, source: currentSource, coordinatorBaseline: null,
    }), { code: "coordinator_registry_empty" });
    await assert.rejects(() => engine.validatePublishBase({
      projectId,
      source: currentSource,
      coordinatorBaseline: {
        ...baseline,
        baselineRevision: 2,
        manifestHash: "c".repeat(64),
        descriptorHash: "d".repeat(64),
      },
    }), { code: "owner_sync_required" });

    await writeUnityDescriptor(sourceRoot, unityDescriptor(projectUuid));
    const stale = await engine.resolveSourceProject({ projectRoot: sourceRoot, projectId });
    await assert.rejects(() => engine.validatePublishBase({
      projectId, source: stale, coordinatorBaseline: baseline,
    }), { code: "owner_sync_required" });
    const repaired = await engine.repairSourceDescriptor({
      projectId, source: stale, coordinatorBaseline: baseline,
    });
    assert.equal(repaired.baselineRevision, 1);
    const refreshed = await engine.resolveSourceProject({ projectRoot: sourceRoot, projectId });
    const base = await engine.validatePublishBase({
      projectId, source: refreshed, coordinatorBaseline: baseline,
    });
    assert.equal(base.previousPublication.descriptor.baselineRevision, 1);
    assert.equal((await engine.publishedBaseline(projectUuid)).baselineRevision, 1);
    assert.equal(JSON.parse(await readFile(
      path.join(sourceRoot, "ProjectSettings", "TeamForgeProject.json"), "utf8",
    )).baselineRevision, 1);
  } finally {
    await running?.stop();
    await coordinator?.stop();
    await cleanup(root);
  }
});
