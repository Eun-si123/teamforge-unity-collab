import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { ChunkStore } from "../src/content-store.mjs";
import { DirectTransferClient } from "../src/direct-transfer-client.mjs";
import { DirectTransferServer, createTransferToken } from "../src/direct-transfer-server.mjs";
import {
  PROJECT_PEER_STABLE_BACKEND,
  ProjectPeerEngine,
} from "../src/project-peer.mjs";
import { SwarmDownloader } from "../src/swarm-downloader.mjs";
import {
  PROJECT_TRANSFER_SOURCE_CONTRACT,
  assertProjectTransferSource,
} from "../src/transfer-source.mjs";
import { uniqueManifestChunks } from "../src/manifest.mjs";
import { cleanup, publicationFixture, temporaryRoot } from "./helpers.mjs";

async function fixtureBytes(fixture) {
  const result = new Map();
  for (const chunk of uniqueManifestChunks(fixture.manifest)) {
    result.set(chunk.hash, await fixture.store.read(chunk.hash, chunk.size));
  }
  return result;
}

async function fakeSource(fixture, { corruptHash = "" } = {}) {
  const bytes = await fixtureBytes(fixture);
  const chunkCalls = [];
  return {
    name: "fake",
    chunkCalls,
    source: {
      async descriptor() { return fixture.descriptor; },
      async manifest() { return fixture.manifest; },
      async inventory() {
        return {
          projectUuid: fixture.projectUuid,
          manifestHash: fixture.manifest.manifestHash,
          chunks: [...bytes.keys()],
        };
      },
      async chunk(hash) {
        chunkCalls.push(hash);
        const value = bytes.get(hash);
        return hash === corruptHash ? Buffer.alloc(value.length, 0xff) : value;
      },
    },
    async close() {},
  };
}

async function directHttpSource(fixture, { corruptHash = "" } = {}) {
  const transferToken = createTransferToken();
  const server = new DirectTransferServer({
    projectUuid: fixture.projectUuid,
    sessionId: "editors",
    manifest: fixture.manifest,
    descriptor: fixture.descriptor,
    store: fixture.store,
    transferToken,
  });
  const bound = await server.start();
  const chunkCalls = [];
  const fetchImplementation = async (input, options) => {
    const url = new URL(input);
    const hash = url.pathname.match(/\/chunks\/([0-9a-f]{64})$/u)?.[1] ?? "";
    if (hash) chunkCalls.push(hash);
    const response = await fetch(input, options);
    if (!response.ok || !corruptHash || hash !== corruptHash) {
      return response;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    bytes[0] ^= 0xff;
    return new Response(bytes, { status: response.status, headers: response.headers });
  };
  return {
    name: "direct-http",
    chunkCalls,
    source: new DirectTransferClient({
      endpoint: bound.endpoint,
      transferToken,
      sessionId: "editors",
      projectUuid: fixture.projectUuid,
      manifestHash: fixture.manifest.manifestHash,
      fetchImplementation,
    }),
    async close() { await server.stop(); },
  };
}

const SOURCE_VARIANTS = [
  ["fake", fakeSource],
  ["direct HTTP", directHttpSource],
];

for (const [name, createSource] of SOURCE_VARIANTS) {
  test(`${name} source conforms to descriptor/manifest/inventory/chunk contract`, async () => {
    const root = await temporaryRoot();
    let running;
    try {
      const fixture = await publicationFixture(root);
      running = await createSource(fixture);
      assert.strictEqual(assertProjectTransferSource(running.source), running.source);
      assert.equal((await running.source.descriptor()).descriptorHash, fixture.descriptor.descriptorHash);
      assert.equal((await running.source.manifest()).manifestHash, fixture.manifest.manifestHash);
      const inventory = await running.source.inventory();
      const chunk = uniqueManifestChunks(fixture.manifest)[0];
      assert(inventory.chunks.includes(chunk.hash));
      assert.equal((await running.source.chunk(chunk.hash, chunk.size)).length, chunk.size);
    } finally {
      await running?.close();
      await cleanup(root);
    }
  });

  test(`${name} source preserves verified Chunk resume through the shared Transfer Core`, async () => {
    const root = await temporaryRoot();
    let running;
    try {
      const fixture = await publicationFixture(root, {
        assetFiles: {
          "Assets/A.bin": Buffer.alloc(65_536, 1),
          "Assets/B.bin": Buffer.alloc(65_536, 2),
          "Assets/C.bin": Buffer.alloc(65_536, 3),
        },
      });
      const bytes = await fixtureBytes(fixture);
      const chunks = uniqueManifestChunks(fixture.manifest);
      const resumed = chunks[0];
      const destination = new ChunkStore(path.join(root, `resume-${name.replaceAll(" ", "-")}`));
      await destination.put(bytes.get(resumed.hash), resumed.hash);
      running = await createSource(fixture);
      const result = await new SwarmDownloader({
        store: destination,
        maxConcurrency: 2,
        minimumPeerIntervalMilliseconds: 0,
      }).download({
        manifest: fixture.manifest,
        seeds: [{ id: running.name, client: running.source }],
        sessionId: "editors",
      });
      assert.equal(result.resumedChunks, 1);
      assert.equal(result.completedChunks, chunks.length);
      assert.equal(running.chunkCalls.includes(resumed.hash), false);
      for (const chunk of chunks) {
        assert.equal(await destination.has(chunk.hash, chunk.size, true), true);
      }
    } finally {
      await running?.close();
      await cleanup(root);
    }
  });

  test(`${name} source cannot bypass expected-size and SHA-256 verification`, async () => {
    const root = await temporaryRoot();
    let running;
    try {
      const fixture = await publicationFixture(root);
      const corrupt = uniqueManifestChunks(fixture.manifest)[0];
      running = await createSource(fixture, { corruptHash: corrupt.hash });
      const destination = new ChunkStore(path.join(root, `corrupt-${name.replaceAll(" ", "-")}`));
      await assert.rejects(() => new SwarmDownloader({
        store: destination,
        maxConcurrency: 1,
        retryRounds: 0,
        minimumPeerIntervalMilliseconds: 0,
      }).download({
        manifest: fixture.manifest,
        seeds: [{ id: running.name, client: running.source }],
        sessionId: "editors",
      }), { code: "direct_transfer_unavailable" });
      assert.equal(await destination.has(corrupt.hash, corrupt.size, true), false);
    } finally {
      await running?.close();
      await cleanup(root);
    }
  });
}

test("ProjectPeerEngine is the stable backend with Direct HTTP as its only real source adapter", () => {
  assert.equal(PROJECT_TRANSFER_SOURCE_CONTRACT.version, 1);
  assert.deepEqual(PROJECT_TRANSFER_SOURCE_CONTRACT.methods, [
    "descriptor", "manifest", "inventory", "chunk",
  ]);
  assert.equal(PROJECT_PEER_STABLE_BACKEND.id, "project-peer");
  assert.equal(PROJECT_PEER_STABLE_BACKEND.protocolVersion, 1);
  assert.strictEqual(PROJECT_PEER_STABLE_BACKEND.engine, ProjectPeerEngine);
  assert.deepEqual(PROJECT_PEER_STABLE_BACKEND.transferSourceAdapters, [DirectTransferClient]);
});
