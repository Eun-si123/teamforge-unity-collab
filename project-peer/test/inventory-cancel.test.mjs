import assert from "node:assert/strict";
import test from "node:test";
import { DirectTransferServer, createTransferToken } from "../src/direct-transfer-server.mjs";
import { uniqueManifestChunks } from "../src/manifest.mjs";
import { cleanup, publicationFixture, temporaryRoot } from "./helpers.mjs";

function within(promise, milliseconds, description) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(description)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

test("stopping a Direct Transfer inventory prevents subsequent chunk hash checks", async () => {
  const root = await temporaryRoot();
  let server;
  let releaseFirst;
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: {
        "Assets/First.bin": Buffer.from("first distinct asset"),
        "Assets/Second.bin": Buffer.from("second distinct asset"),
        "Assets/Third.bin": Buffer.from("third distinct asset"),
      },
    });
    assert(uniqueManifestChunks(fixture.manifest).length >= 3);
    let enterFirst;
    const firstEntered = new Promise((resolve) => { enterFirst = resolve; });
    const firstBarrier = new Promise((resolve) => { releaseFirst = resolve; });
    let inventoryFinished;
    const inventorySettled = new Promise((resolve) => { inventoryFinished = resolve; });
    const store = fixture.store;
    const originalHas = store.has.bind(store);
    const originalInventory = store.inventory.bind(store);
    const visited = [];
    store.has = async (hash, ...args) => {
      visited.push(hash);
      if (visited.length === 1) {
        enterFirst();
        await firstBarrier;
      }
      return originalHas(hash, ...args);
    };
    store.inventory = async (...args) => {
      try {
        return await originalInventory(...args);
      } finally {
        inventoryFinished();
      }
    };
    const transferToken = createTransferToken();
    server = new DirectTransferServer({
      host: "127.0.0.1", port: 0, projectUuid: fixture.projectUuid,
      sessionId: "editors", manifest: fixture.manifest,
      descriptor: fixture.descriptor, store, transferToken,
    });
    const { endpoint } = await server.start();
    const request = fetch(`${endpoint}/inventory/${fixture.manifest.manifestHash}`, {
      headers: {
        authorization: `Bearer ${transferToken}`,
        "x-teamforge-project-uuid": fixture.projectUuid,
        "x-teamforge-manifest-hash": fixture.manifest.manifestHash,
        "x-teamforge-session-id": "editors",
      },
    }).catch(() => {});
    await within(firstEntered, 2_000, "Inventory never began its first hash check.");
    await within(server.stop(), 2_000, "Server did not stop while inventory was waiting.");
    assert.equal(visited.length, 1, "Stop must not require all inventory hashes to finish.");
    releaseFirst();
    await within(inventorySettled, 2_000, "Cancelled inventory did not settle after the first hash check.");
    assert.equal(visited.length, 1, "Cancelled inventory continued hashing after server.stop().");
    await request;
  } finally {
    releaseFirst?.();
    await server?.stop();
    await cleanup(root);
  }
});

test("client-aborted inventory stops further hashes without stopping the seed", async () => {
  const root = await temporaryRoot();
  let server;
  let releaseFirst;
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: {
        "Assets/A.bin": Buffer.from("first distinct asset"),
        "Assets/B.bin": Buffer.from("second distinct asset"),
        "Assets/C.bin": Buffer.from("third distinct asset"),
      },
    });
    assert(uniqueManifestChunks(fixture.manifest).length >= 3);
    const store = fixture.store;
    const originalHas = store.has.bind(store);
    const originalInventory = store.inventory.bind(store);
    let enterFirst;
    let inventoryFinished;
    let signalAborted;
    const firstEntered = new Promise((resolve) => { enterFirst = resolve; });
    const firstBarrier = new Promise((resolve) => { releaseFirst = resolve; });
    const inventorySettled = new Promise((resolve) => { inventoryFinished = resolve; });
    const aborted = new Promise((resolve) => { signalAborted = resolve; });
    const visited = [];
    store.has = async (hash, ...args) => {
      visited.push(hash);
      if (visited.length === 1) {
        enterFirst();
        await firstBarrier;
      }
      return originalHas(hash, ...args);
    };
    store.inventory = async (hashes, options) => {
      options?.signal?.addEventListener("abort", signalAborted, { once: true });
      try {
        return await originalInventory(hashes, options);
      } finally {
        inventoryFinished();
      }
    };
    const transferToken = createTransferToken();
    server = new DirectTransferServer({
      host: "127.0.0.1", port: 0, projectUuid: fixture.projectUuid,
      sessionId: "editors", manifest: fixture.manifest,
      descriptor: fixture.descriptor, store, transferToken,
    });
    const { endpoint } = await server.start();
    const headers = {
      authorization: `Bearer ${transferToken}`,
      "x-teamforge-project-uuid": fixture.projectUuid,
      "x-teamforge-manifest-hash": fixture.manifest.manifestHash,
      "x-teamforge-session-id": "editors",
    };
    const controller = new AbortController();
    const request = fetch(`${endpoint}/inventory/${fixture.manifest.manifestHash}`, {
      headers, signal: controller.signal,
    }).then(() => false, () => true);
    await within(firstEntered, 2_000, "Inventory never began its first hash check.");
    controller.abort();
    assert.equal(await within(request, 2_000, "Client abort did not settle."), true);
    await within(aborted, 2_000, "Client disconnect did not cancel server inventory.");
    releaseFirst();
    await within(inventorySettled, 2_000, "Cancelled inventory did not settle.");
    assert.equal(visited.length, 1, "Client cancellation continued hashing.");

    const descriptor = await within(fetch(`${endpoint}/descriptor`, { headers }),
      2_000, "Seed stopped serving after client cancellation.");
    assert.equal(descriptor.status, 200);
    await descriptor.arrayBuffer();
  } finally {
    releaseFirst?.();
    await server?.stop();
    await cleanup(root);
  }
});
