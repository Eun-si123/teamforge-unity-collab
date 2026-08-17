import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  ChunkStore,
  DirectTransferServer,
  buildManifest,
  createDescriptor,
  generateIdentity,
} from "../src/project-peer.mjs";
import { DirectTransferClient } from "../src/direct-transfer-client.mjs";

const root = await mkdtemp(path.join(tmpdir(), "teamforge-peer-smoke-"));
try {
  const projectRoot = path.join(root, "project");
  await mkdir(path.join(projectRoot, "Assets"), { recursive: true });
  await mkdir(path.join(projectRoot, "Packages"), { recursive: true });
  await mkdir(path.join(projectRoot, "ProjectSettings"), { recursive: true });
  await writeFile(path.join(projectRoot, "Assets", "Smoke.txt"), "direct-project-payload\n");
  await writeFile(path.join(projectRoot, "Packages", "manifest.json"), '{"dependencies":{}}\n');
  await writeFile(path.join(projectRoot, "Packages", "packages-lock.json"), '{"dependencies":{}}\n');
  await writeFile(path.join(projectRoot, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.3.21f1\n");
  const projectUuid = randomUUID();
  const store = new ChunkStore(path.join(root, "chunks"));
  const { manifest } = await buildManifest({ projectRoot, projectUuid, baselineRevision: 1, store });
  const owner = generateIdentity("Smoke Owner");
  const descriptor = createDescriptor({
    projectId: "smoke-project",
    projectUuid,
    baselineRevision: 1,
    manifestHash: manifest.manifestHash,
    unityVersion: "6000.3.21f1",
    ownerIdentity: owner,
  });
  const token = "smoke-transfer-token-32-characters";
  const sessionId = "smoke-session";
  const server = new DirectTransferServer({
    host: "127.0.0.1", port: 0, sessionId, projectUuid, manifest, descriptor, store, transferToken: token,
  });
  const endpoint = await server.start();
  try {
    const client = new DirectTransferClient({
      endpoint: endpoint.endpoint,
      transferToken: token,
      sessionId,
      projectUuid,
      manifestHash: manifest.manifestHash,
    });
    const receivedDescriptor = await client.descriptor();
    const receivedManifest = await client.manifest();
    const inventory = await client.inventory();
    const chunk = manifest.files.find((file) => file.path === "Assets/Smoke.txt").chunks[0];
    const payload = await client.chunk(chunk.hash, chunk.size);
    console.info(JSON.stringify({
      directTransfer: true,
      descriptorHash: receivedDescriptor.descriptorHash === descriptor.descriptorHash,
      manifestHash: receivedManifest.manifestHash === manifest.manifestHash,
      inventoryChunks: inventory.availableChunkCount,
      payload: payload.toString("utf8").trim(),
      serverRelayUsed: false,
    }, null, 2));
  } finally {
    await server.stop();
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
