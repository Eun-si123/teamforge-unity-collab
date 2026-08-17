import assert from "node:assert/strict";
import test from "node:test";
import { access, cp, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectPeerEngine } from "../src/project-peer.mjs";
import { DirectTransferServer, createTransferToken } from "../src/direct-transfer-server.mjs";
import { descriptorCoordinatorFields } from "../src/coordinator-client.mjs";
import { createInvite, saveInvite } from "../src/invite.mjs";
import { sha256 } from "../src/hash.mjs";
import { cleanup, createUnityProject, publicationFixture, temporaryRoot } from "./helpers.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));

async function treeHashes(root, relative = "", result = new Map()) {
  const entries = await readdir(path.join(root, ...relative.split("/").filter(Boolean)), {
    withFileTypes: true,
  });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await treeHashes(root, child, result);
    } else if (entry.isFile()) {
      result.set(child, sha256(await readFile(path.join(root, ...child.split("/")))));
    }
  }
  return result;
}

test("two direct seeds transfer and activate a baseline using coordinator metadata only", async () => {
  const root = await temporaryRoot();
  const servers = [];
  let partialServer;
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: Object.fromEntries(Array.from({ length: 6 }, (_, index) => [
        `Assets/Payload-${index}.bin`, Buffer.alloc(65_536, index + 10),
      ])),
    });
    const reads = [0, 0];
    const peers = [];
    for (let index = 0; index < 2; index += 1) {
      const store = {
        inventory: (...arguments_) => fixture.store.inventory(...arguments_),
        async read(...arguments_) {
          reads[index] += 1;
          return fixture.store.read(...arguments_);
        },
      };
      const transferToken = createTransferToken();
      const server = new DirectTransferServer({
        projectUuid: fixture.projectUuid,
        sessionId: "editors",
        manifest: fixture.manifest,
        descriptor: fixture.descriptor,
        store,
        transferToken,
      });
      const bound = await server.start();
      servers.push(server);
      peers.push({
        connectionId: `seed-${index}`,
        projectUuid: fixture.projectUuid,
        baselineRevision: fixture.baselineRevision,
        manifestHash: fixture.manifest.manifestHash,
        seedRank: index,
        endpoint: bound.endpoint,
        transferToken,
      });
    }

    const replicaRoot = path.join(root, "replica-managed");
    const engine = new ProjectPeerEngine({ managedRoot: replicaRoot });
    const invitePath = path.join(root, "invite.json");
    await saveInvite(invitePath, createInvite({
      serverAddress: "https://coordinator.invalid",
      realtimePath: "ws",
      projectId: fixture.projectId,
      projectUuid: fixture.projectUuid,
      sessionId: "editors",
      ownerIdentity: fixture.owner,
    }));
    await engine.importInvite({ invitePath });
    const snapshot = {
      type: "project_registry_snapshot",
      protocolVersion: 1,
      projectId: fixture.projectId,
      projectUuid: fixture.projectUuid,
      baseline: {
        ...descriptorCoordinatorFields(fixture.descriptor),
        projectId: fixture.projectId,
        publishedConnectionId: "owner",
        publishedUserId: "owner-user",
        publishedAtUnixMs: Date.now(),
      },
      peers,
      serverTimestampUnixMs: Date.now(),
    };
    const synced = await engine.syncFromSnapshot({
      projectId: fixture.projectId,
      snapshot,
      sessionId: "editors",
      maxConcurrency: 4,
      trustApproval: async (summary) => summary.ownerKeyId === fixture.owner.keyId,
    });
    partialServer = synced.partialServer;
    assert.equal(synced.activation.state, "Complete");
    assert.equal(synced.descriptor.baselineRevision, snapshot.baseline.baselineRevision);
    assert(reads[0] > 0 && reads[1] > 0, "Both direct peers should serve Project chunks.");
    const unityDescriptor = JSON.parse(await readFile(
      path.join(synced.activation.activePath, "ProjectSettings", "TeamForgeProject.json"), "utf8",
    ));
    assert.equal(unityDescriptor.projectUuid, fixture.projectUuid);
    assert.equal(unityDescriptor.manifestHash, fixture.manifest.manifestHash);
    assert.equal(await readFile(
      path.join(synced.activation.activePath, "Assets", "Payload-5.bin"),
    ).then((bytes) => bytes.length), 65_536);
  } finally {
    await partialServer?.stop();
    for (const server of servers) await server.stop();
    await cleanup(root);
  }
});

test("real Embedded TeamForge Package survives Publish to Sync and Active activation", async () => {
  const root = await temporaryRoot();
  let seedServer;
  let partialServer;
  try {
    const sourceRoot = path.join(root, "source");
    const ownerManaged = path.join(root, "owner-managed");
    const receiverManaged = path.join(root, "receiver-managed");
    await createUnityProject(sourceRoot, {
      assetFiles: { "Assets/SampleScene.unity": "--- !u!1 &1\nGameObject:\n  m_Name: Cube\n" },
    });
    const packageSource = path.resolve(testDirectory, "..", "..", "unity-package", "com.eunsung.teamforge");
    const sourcePackage = path.join(sourceRoot, "Packages", "com.eunsung.teamforge");
    await cp(
      packageSource,
      sourcePackage,
      { recursive: true },
    );
    const expectedPackage = await treeHashes(packageSource);
    const ownerEngine = new ProjectPeerEngine({ managedRoot: ownerManaged });
    const publication = await ownerEngine.preparePublication({
      projectRoot: sourceRoot,
      projectId: "embedded-teamforge-regression",
      baselineRevision: 1,
    });
    assert(publication.embeddedPackages.some((candidate) =>
      candidate.name === "com.eunsung.teamforge" && candidate.version === "0.5.1"));
    const packageEntry = publication.manifest.files.find((file) =>
      file.path === "Packages/com.eunsung.teamforge/package.json");
    assert(packageEntry, "Publish Manifest must include the real Embedded TeamForge package.json.");
    const manifestPackage = new Set(publication.manifest.files
      .filter((file) => file.path.startsWith("Packages/com.eunsung.teamforge/"))
      .map((file) => file.path.slice("Packages/com.eunsung.teamforge/".length)));
    assert.deepEqual([...manifestPackage].sort(), [...expectedPackage.keys()].sort());

    const transferToken = createTransferToken();
    seedServer = new DirectTransferServer({
      projectUuid: publication.project.projectUuid,
      sessionId: "editors",
      manifest: publication.manifest,
      descriptor: publication.descriptor,
      store: publication.store,
      transferToken,
    });
    const bound = await seedServer.start();
    const receiver = new ProjectPeerEngine({ managedRoot: receiverManaged });
    const invitePath = path.join(root, "embedded-invite.json");
    await saveInvite(invitePath, createInvite({
      serverAddress: "https://coordinator.invalid",
      realtimePath: "ws",
      projectId: publication.project.projectId,
      projectUuid: publication.project.projectUuid,
      sessionId: "editors",
      ownerIdentity: publication.ownerIdentity,
    }));
    await receiver.importInvite({ invitePath });
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
    const synced = await receiver.syncFromSnapshot({
      projectId: publication.project.projectId,
      snapshot,
      sessionId: "editors",
      trustApproval: async (summary) => summary.publisherFingerprint === publication.descriptor.publisherKeyId,
    });
    partialServer = synced.partialServer;
    assert.equal(synced.activation.state, "Complete");
    const activePackage = JSON.parse(await readFile(
      path.join(synced.activation.activePath, "Packages", "com.eunsung.teamforge", "package.json"),
      "utf8",
    ));
    assert.equal(activePackage.name, "com.eunsung.teamforge");
    assert.equal(activePackage.version, "0.5.1");
    assert.deepEqual(
      [...await treeHashes(path.join(synced.activation.activePath, "Packages", "com.eunsung.teamforge"))],
      [...expectedPackage],
    );
    assert.match(await readFile(path.join(synced.activation.activePath, "Assets", "SampleScene.unity"), "utf8"), /Cube/u);
    for (const excluded of ["Library", "UserSettings", ".env"]) {
      await assert.rejects(() => access(path.join(synced.activation.activePath, excluded)));
    }
  } finally {
    await partialServer?.stop();
    await seedServer?.stop();
    await cleanup(root);
  }
});
