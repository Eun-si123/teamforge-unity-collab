import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ChunkStore } from "../src/content-store.mjs";
import { buildManifest } from "../src/manifest.mjs";
import { createDescriptor } from "../src/descriptor.mjs";
import { generateIdentity } from "../src/identity.mjs";

export async function temporaryRoot(label = "teamforge-peer-test-") {
  return mkdtemp(path.join(tmpdir(), label));
}

export async function cleanup(root) {
  await rm(root, { recursive: true, force: true });
}

export async function createUnityProject(root, {
  unityVersion = "6000.3.21f1",
  assetFiles = { "Assets/Test.txt": "hello teamforge\n" },
  dependencies = {},
} = {}) {
  await mkdir(path.join(root, "Assets"), { recursive: true });
  await mkdir(path.join(root, "Packages"), { recursive: true });
  await mkdir(path.join(root, "ProjectSettings"), { recursive: true });
  for (const [relative, value] of Object.entries(assetFiles)) {
    const destination = path.join(root, ...relative.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, value);
  }
  await writeFile(
    path.join(root, "Packages", "manifest.json"),
    `${JSON.stringify({ dependencies }, null, 2)}\n`,
  );
  await writeFile(
    path.join(root, "Packages", "packages-lock.json"),
    `${JSON.stringify({ dependencies: {} }, null, 2)}\n`,
  );
  await writeFile(
    path.join(root, "ProjectSettings", "ProjectVersion.txt"),
    `m_EditorVersion: ${unityVersion}\n`,
  );
}

export async function publicationFixture(root, {
  projectId = "test-project",
  projectUuid = randomUUID(),
  baselineRevision = 1,
  chunkSize = 65_536,
  assetFiles = undefined,
} = {}) {
  const projectRoot = path.join(root, "source-project");
  await createUnityProject(projectRoot, { assetFiles });
  const store = new ChunkStore(path.join(root, "chunks"));
  const { manifest } = await buildManifest({
    projectRoot,
    projectUuid,
    baselineRevision,
    chunkSize,
    store,
  });
  const owner = generateIdentity("Test Owner");
  const descriptor = createDescriptor({
    projectId,
    projectUuid,
    baselineRevision,
    manifestHash: manifest.manifestHash,
    unityVersion: "6000.3.21f1",
    ownerIdentity: owner,
  });
  return { projectRoot, projectId, projectUuid, baselineRevision, store, manifest, descriptor, owner };
}
