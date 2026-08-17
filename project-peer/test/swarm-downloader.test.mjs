import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { ChunkStore } from "../src/content-store.mjs";
import { SwarmDownloader } from "../src/swarm-downloader.mjs";
import { DirectTransferServer, createTransferToken } from "../src/direct-transfer-server.mjs";
import { uniqueManifestChunks } from "../src/manifest.mjs";
import { TeamForgePeerError } from "../src/errors.mjs";
import { cleanup, publicationFixture, temporaryRoot } from "./helpers.mjs";

async function bytesByHash(fixture) {
  const result = new Map();
  for (const chunk of uniqueManifestChunks(fixture.manifest)) {
    result.set(chunk.hash, await fixture.store.read(chunk.hash, chunk.size));
  }
  return result;
}

function fakeClient(fixture, bytes, {
  chunk = async (hash) => bytes.get(hash),
  inventory = undefined,
  descriptor = undefined,
  manifest = undefined,
} = {}) {
  return {
    descriptor: descriptor ?? (async () => fixture.descriptor),
    manifest: manifest ?? (async () => fixture.manifest),
    inventory: inventory ?? (async () => ({
      projectUuid: fixture.projectUuid,
      manifestHash: fixture.manifest.manifestHash,
      chunks: [...bytes.keys()],
    })),
    chunk,
  };
}

test("discovery rejects invalid metadata and fails over to a valid signed seed", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root);
    const bytes = await bytesByHash(fixture);
    const downloader = new SwarmDownloader({ store: new ChunkStore(path.join(root, "destination")) });
    const result = await downloader.discover({
      seeds: [
        { id: "bad", client: fakeClient(fixture, bytes, {
          descriptor: async () => ({ ...fixture.descriptor, baselineRevision: 99 }),
        }) },
        { id: "good", client: fakeClient(fixture, bytes) },
      ],
      projectId: fixture.projectId,
      projectUuid: fixture.projectUuid,
      manifestHash: fixture.manifest.manifestHash,
      sessionId: "editors",
      trustedOwnerKeyId: fixture.owner.keyId,
    });
    assert.equal(result.sourceSeed, "good");
    assert.equal(result.descriptor.descriptorHash, fixture.descriptor.descriptorHash);
  } finally {
    await cleanup(root);
  }
});

test("discovery and inventory retry transient metadata failures", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root);
    const bytes = await bytesByHash(fixture);
    let descriptorCalls = 0;
    let inventoryCalls = 0;
    const client = fakeClient(fixture, bytes, {
      descriptor: async () => {
        descriptorCalls += 1;
        if (descriptorCalls === 1) {
          throw new TeamForgePeerError("peer_http_error", "temporary metadata failure", {
            status: 503, retryable: true, retryAfterMilliseconds: 1,
          });
        }
        return fixture.descriptor;
      },
      inventory: async () => {
        inventoryCalls += 1;
        if (inventoryCalls === 1) {
          throw new TeamForgePeerError("peer_http_error", "temporary inventory failure", {
            status: 429, retryable: true, retryAfterMilliseconds: 1,
          });
        }
        return {
          projectUuid: fixture.projectUuid,
          manifestHash: fixture.manifest.manifestHash,
          chunks: [...bytes.keys()],
        };
      },
    });
    const downloader = new SwarmDownloader({
      store: new ChunkStore(path.join(root, "destination")),
      retryBaseMilliseconds: 1,
      retryMaximumMilliseconds: 5,
      retryJitterRatio: 0,
      minimumPeerIntervalMilliseconds: 0,
    });
    const discovered = await downloader.discover({
      seeds: [{ id: "metadata", client }],
      projectId: fixture.projectId,
      projectUuid: fixture.projectUuid,
      manifestHash: fixture.manifest.manifestHash,
      sessionId: "editors",
      trustedOwnerKeyId: fixture.owner.keyId,
    });
    assert.equal(discovered.sourceSeed, "metadata");
    const result = await downloader.download({
      manifest: fixture.manifest,
      seeds: [{ id: "metadata", client }],
      sessionId: "editors",
    });
    assert.equal(result.completedChunks, uniqueManifestChunks(fixture.manifest).length);
    assert.equal(descriptorCalls, 2);
    assert.equal(inventoryCalls, 2);
  } finally {
    await cleanup(root);
  }
});

test("swarm discards an invalid chunk, retries another seed, resumes verified chunks, and deduplicates content", async () => {
  const root = await temporaryRoot();
  try {
    const shared = Buffer.alloc(65_536, 5);
    const fixture = await publicationFixture(root, {
      assetFiles: {
        "Assets/A.bin": shared,
        "Assets/B.bin": shared,
        "Assets/C.bin": Buffer.alloc(65_536, 9),
      },
    });
    const bytes = await bytesByHash(fixture);
    const chunks = uniqueManifestChunks(fixture.manifest);
    const destination = new ChunkStore(path.join(root, "destination"));
    const resumed = chunks[0];
    await destination.put(bytes.get(resumed.hash), resumed.hash);
    const calls = new Map();
    const invalidHash = chunks.find((candidate) => candidate.hash !== resumed.hash).hash;
    const bad = fakeClient(fixture, bytes, {
      chunk: async (hash) => {
        calls.set(`bad:${hash}`, (calls.get(`bad:${hash}`) ?? 0) + 1);
        return hash === invalidHash ? Buffer.alloc(bytes.get(hash).length, 0xff) : bytes.get(hash);
      },
    });
    const good = fakeClient(fixture, bytes, {
      chunk: async (hash) => {
        calls.set(`good:${hash}`, (calls.get(`good:${hash}`) ?? 0) + 1);
        return bytes.get(hash);
      },
    });
    const partial = [];
    const downloader = new SwarmDownloader({
      store: destination,
      maxConcurrency: 1,
      retryRounds: 0,
      onPartialSeed: (event) => partial.push(event.hash),
    });
    const result = await downloader.download({
      manifest: fixture.manifest,
      seeds: [{ id: "bad", client: bad }, { id: "good", client: good }],
      sessionId: "editors",
    });
    assert.equal(result.resumedChunks, 1);
    assert.equal(result.transferredChunks, result.totalChunks - 1);
    assert.ok(result.resumedBytes > 0);
    assert.equal(result.transferredBytes + result.resumedBytes, result.totalBytes);
    assert.equal(result.completedChunks, chunks.length);
    assert.equal(calls.has(`bad:${resumed.hash}`), false);
    assert((calls.get(`bad:${invalidHash}`) ?? 0) >= 1);
    assert((calls.get(`good:${invalidHash}`) ?? 0) >= 1);
    assert.equal(partial.length, chunks.length - 1);
    const sharedHash = fixture.manifest.files.find((file) => file.path === "Assets/A.bin").chunks[0].hash;
    const sharedFetches = (calls.get(`bad:${sharedHash}`) ?? 0) + (calls.get(`good:${sharedHash}`) ?? 0);
    assert(sharedFetches <= 1, "Duplicate file content should be downloaded once by chunk hash.");
  } finally {
    await cleanup(root);
  }
});

test("WP4 pause aborts transfer and restart reuses only the completed verified Chunks", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: Object.fromEntries(Array.from({ length: 4 }, (_, index) => [
        `Assets/Pause-${index}.bin`, Buffer.alloc(65_536, index + 30),
      ])),
    });
    const bytes = await bytesByHash(fixture);
    const store = new ChunkStore(path.join(root, "destination"));
    const client = fakeClient(fixture, bytes);
    const controller = new AbortController();
    let completedBeforePause = 0;
    const interrupted = new SwarmDownloader({
      store,
      maxConcurrency: 1,
      retryRounds: 0,
      onPartialSeed: () => {
        completedBeforePause += 1;
        controller.abort();
      },
    });
    await assert.rejects(
      () => interrupted.download({
        manifest: fixture.manifest,
        seeds: [{ id: "host", client }],
        sessionId: "editors",
        signal: controller.signal,
      }),
      { code: "download_cancelled" },
    );
    assert.equal(completedBeforePause, 1);

    const resumed = await new SwarmDownloader({ store, maxConcurrency: 1, retryRounds: 0 }).download({
      manifest: fixture.manifest,
      seeds: [{ id: "host", client }],
      sessionId: "editors",
    });
    assert.equal(resumed.resumedChunks, 1);
    assert.equal(resumed.completedChunks, resumed.totalChunks);
  } finally {
    await cleanup(root);
  }
});

test("parallel swarm distributes new work and dynamically deprioritizes a failed/slow peer without cancelling valid work", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: Object.fromEntries(Array.from({ length: 8 }, (_, index) => [
        `Assets/${index}.bin`, Buffer.alloc(65_536, index + 1),
      ])),
    });
    const bytes = await bytesByHash(fixture);
    const calls = { slow: 0, fast: 0 };
    let firstSlow = true;
    const slow = fakeClient(fixture, bytes, {
      chunk: async (hash) => {
        calls.slow += 1;
        await new Promise((resolve) => setTimeout(resolve, 35));
        if (firstSlow) {
          firstSlow = false;
          const error = new Error("simulated timeout");
          error.code = "peer_timeout";
          throw error;
        }
        return bytes.get(hash);
      },
    });
    const fast = fakeClient(fixture, bytes, {
      chunk: async (hash) => {
        calls.fast += 1;
        await new Promise((resolve) => setTimeout(resolve, 2));
        return bytes.get(hash);
      },
    });
    const destination = new ChunkStore(path.join(root, "destination"));
    const downloader = new SwarmDownloader({ store: destination, maxConcurrency: 3, retryRounds: 0 });
    const result = await downloader.download({
      manifest: fixture.manifest,
      seeds: [{ id: "slow", client: slow }, { id: "fast", client: fast }],
      sessionId: "editors",
    });
    assert.equal(result.completedChunks, uniqueManifestChunks(fixture.manifest).length);
    assert(calls.slow > 0 && calls.fast > 0, "Both seeds should receive initial work.");
    assert(calls.fast > calls.slow, "Failed/slow seed should be deprioritized for later chunks.");
    assert(result.peers.find((peer) => peer.id === "slow").failures >= 1);
  } finally {
    await cleanup(root);
  }
});

test("a failed parallel download settles workers and emits no writes or progress after rejection", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: {
        "Assets/A.bin": Buffer.alloc(65_536, 1),
        "Assets/B.bin": Buffer.alloc(65_536, 2),
      },
    });
    const bytes = await bytesByHash(fixture);
    const chunks = uniqueManifestChunks(fixture.manifest);
    const target = new ChunkStore(path.join(root, "destination"));
    let writes = 0;
    const recordingStore = {
      has: (...arguments_) => target.has(...arguments_),
      deleteInvalid: (...arguments_) => target.deleteInvalid(...arguments_),
      async put(...arguments_) {
        writes += 1;
        return target.put(...arguments_);
      },
    };
    const progress = [];
    let requestIndex = 0;
    const client = fakeClient(fixture, bytes, {
      chunk: async (hash) => {
        requestIndex += 1;
        if (requestIndex === 1) {
          await new Promise((resolve) => setTimeout(resolve, 5));
          throw new Error("fatal peer failure");
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        return bytes.get(hash);
      },
    });
    const downloader = new SwarmDownloader({
      store: recordingStore,
      maxConcurrency: 2,
      retryRounds: 0,
      onProgress: (value) => progress.push(value),
    });
    await assert.rejects(() => downloader.download({
      manifest: fixture.manifest,
      seeds: [{ id: "only", client }],
      sessionId: "editors",
    }), { code: "direct_transfer_unavailable" });
    const writesAtReturn = writes;
    const progressAtReturn = progress.length;
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(writes, writesAtReturn);
    assert.equal(progress.length, progressAtReturn);
    assert.equal(writes, 0);
    assert.equal(await target.has(chunks[0].hash), false);
  } finally {
    await cleanup(root);
  }
});

test("single Seed retries 429, 503, reset, and timeout failures with bounded backoff", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: { "Assets/Retry.bin": Buffer.alloc(65_536, 71) },
    });
    const bytes = await bytesByHash(fixture);
    const diagnostics = [];
    let failuresRemaining = 4;
    const errors = [
      () => new TeamForgePeerError("peer_http_error", "429", {
        status: 429, retryable: true, retryAfterMilliseconds: 37, serverErrorCode: "rate_limited",
      }),
      () => new TeamForgePeerError("peer_http_error", "503", {
        status: 503, retryable: true, retryAfterMilliseconds: 5, serverErrorCode: "transfer_busy",
      }),
      () => new TeamForgePeerError("peer_network_error", "reset", {
        retryable: true, networkCode: "ECONNRESET",
      }),
      () => new TeamForgePeerError("peer_timeout", "timeout", { retryable: true }),
    ];
    let errorIndex = 0;
    const client = fakeClient(fixture, bytes, {
      chunk: async (hash) => {
        if (failuresRemaining > 0) {
          failuresRemaining -= 1;
          throw errors[errorIndex++]();
        }
        return bytes.get(hash);
      },
    });
    const downloader = new SwarmDownloader({
      store: new ChunkStore(path.join(root, "destination")),
      maxConcurrency: 1,
      retryRounds: 4,
      retryBaseMilliseconds: 2,
      retryMaximumMilliseconds: 100,
      retryJitterRatio: 0,
      minimumPeerIntervalMilliseconds: 0,
      sleep: async () => {},
      onDiagnostic: (value) => diagnostics.push(value),
    });
    const result = await downloader.download({
      manifest: fixture.manifest,
      seeds: [{ id: "only-seed", client }],
      sessionId: "editors",
    });
    assert.equal(result.completedChunks, uniqueManifestChunks(fixture.manifest).length);
    assert(diagnostics.some((value) => value.httpStatus === 429 && value.retryInMilliseconds >= 37));
    assert(diagnostics.some((value) => value.httpStatus === 503));
    assert(diagnostics.some((value) => value.networkCode === "ECONNRESET"));
    assert(diagnostics.some((value) => value.errorKind === "peer_timeout"));
  } finally {
    await cleanup(root);
  }
});

test("Retry-After overrides the exponential cap but remains bounded", async () => {
  const root = await temporaryRoot();
  const originalNow = Date.now;
  let now = Date.UTC(2030, 0, 2);
  Date.now = () => now;
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: { "Assets/RetryAfter.bin": Buffer.alloc(65_536, 72) },
    });
    const bytes = await bytesByHash(fixture);
    let failed = false;
    const client = fakeClient(fixture, bytes, {
      chunk: async (hash) => {
        if (!failed) {
          failed = true;
          throw new TeamForgePeerError("peer_http_error", "rate limited", {
            status: 429,
            retryable: true,
            retryAfterMilliseconds: 30_000,
          });
        }
        return bytes.get(hash);
      },
    });
    const sleeps = [];
    const diagnostics = [];
    const result = await new SwarmDownloader({
      store: new ChunkStore(path.join(root, "destination")),
      maxConcurrency: 1,
      retryRounds: 1,
      retryBaseMilliseconds: 100,
      retryMaximumMilliseconds: 5_000,
      retryJitterRatio: 0,
      minimumPeerIntervalMilliseconds: 0,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        now += milliseconds;
      },
      onDiagnostic: (value) => diagnostics.push(value),
    }).download({
      manifest: fixture.manifest,
      seeds: [{ id: "rate-limited", client }],
      sessionId: "editors",
    });
    assert.equal(result.completedChunks, uniqueManifestChunks(fixture.manifest).length);
    const retry = diagnostics.find((value) => value.httpStatus === 429);
    assert.equal(retry.retryInMilliseconds, 30_000);
    assert.equal(sleeps[0], 30_000);
  } finally {
    Date.now = originalNow;
    await cleanup(root);
  }
});

test("exponential retry jitter is exact, capped, and terminal attempts do not sleep", async () => {
  const root = await temporaryRoot();
  const originalNow = Date.now;
  let now = Date.UTC(2030, 0, 2);
  Date.now = () => now;
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: { "Assets/Backoff.bin": Buffer.alloc(65_536, 73) },
    });
    const bytes = await bytesByHash(fixture);
    let calls = 0;
    const client = fakeClient(fixture, bytes, {
      chunk: async () => {
        calls += 1;
        throw new TeamForgePeerError("peer_network_error", "reset", {
          retryable: true,
          networkCode: "ECONNRESET",
        });
      },
    });
    const randomValues = [0, 0.5, 1];
    const sleeps = [];
    const diagnostics = [];
    await assert.rejects(() => new SwarmDownloader({
      store: new ChunkStore(path.join(root, "destination")),
      maxConcurrency: 1,
      retryRounds: 3,
      retryBaseMilliseconds: 100,
      retryMaximumMilliseconds: 250,
      retryJitterRatio: 0.2,
      minimumPeerIntervalMilliseconds: 0,
      random: () => randomValues.shift(),
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        now += milliseconds;
      },
      onDiagnostic: (value) => diagnostics.push(value),
    }).download({
      manifest: fixture.manifest,
      seeds: [{ id: "resetting", client }],
      sessionId: "editors",
    }), { code: "direct_transfer_unavailable" });
    assert.equal(calls, 4);
    assert.deepEqual(sleeps, [80, 200, 250]);
    assert.deepEqual(
      diagnostics.filter((value) => value.operation === "chunk")
        .map((value) => value.retryInMilliseconds),
      [80, 200, 250, 0],
    );
  } finally {
    Date.now = originalNow;
    await cleanup(root);
  }
});

test("an available peer always replaces a cooling peer after extensive prior failures", async () => {
  const root = await temporaryRoot();
  const originalNow = Date.now;
  let now = Date.UTC(2030, 0, 2);
  Date.now = () => now;
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: Object.fromEntries(Array.from({ length: 16 }, (_, index) => [
        `Assets/Failover-${String(index).padStart(2, "0")}.bin`,
        Buffer.alloc(65_536, index + 91),
      ])),
    });
    const bytes = await bytesByHash(fixture);
    const chunks = uniqueManifestChunks(fixture.manifest);
    assert(chunks.length >= 13);
    const preliminary = new Set(chunks.slice(0, 11).map((chunk) => chunk.hash));
    const target = chunks[11];
    const failedPreliminary = new Set();
    const targetOrder = [];
    const seedB = fakeClient(fixture, bytes, {
      inventory: async () => ({
        projectUuid: fixture.projectUuid,
        manifestHash: fixture.manifest.manifestHash,
        chunks: [...bytes.keys()],
      }),
      chunk: async (hash) => {
        if (hash === target.hash) targetOrder.push("B");
        if (preliminary.has(hash) && !failedPreliminary.has(hash)) {
          failedPreliminary.add(hash);
          throw new TeamForgePeerError("peer_network_error", "reset", {
            retryable: true,
            networkCode: "ECONNRESET",
          });
        }
        return bytes.get(hash);
      },
    });
    let targetFailed = false;
    const seedA = fakeClient(fixture, bytes, {
      inventory: async () => ({
        projectUuid: fixture.projectUuid,
        manifestHash: fixture.manifest.manifestHash,
        chunks: [...bytes.keys()].filter((hash) => !preliminary.has(hash)),
      }),
      chunk: async (hash) => {
        if (hash === target.hash) {
          targetOrder.push("A");
          if (!targetFailed) {
            targetFailed = true;
            throw new TeamForgePeerError("peer_http_error", "rate limited", {
              status: 429,
              retryable: true,
              retryAfterMilliseconds: 30_000,
            });
          }
        }
        return bytes.get(hash);
      },
    });
    const diagnostics = [];
    const result = await new SwarmDownloader({
      store: new ChunkStore(path.join(root, "destination")),
      maxConcurrency: 1,
      retryRounds: 1,
      retryBaseMilliseconds: 1,
      retryMaximumMilliseconds: 5,
      retryJitterRatio: 0,
      minimumPeerIntervalMilliseconds: 0,
      sleep: async (milliseconds) => { now += milliseconds; },
      onDiagnostic: (value) => diagnostics.push(value),
    }).download({
      manifest: fixture.manifest,
      seeds: [{ id: "A", client: seedA }, { id: "B", client: seedB }],
      sessionId: "editors",
    });
    assert.equal(result.completedChunks, chunks.length);
    assert.equal(failedPreliminary.size, 11);
    assert.deepEqual(targetOrder.slice(0, 2), ["A", "B"]);
    const failover = diagnostics.find((value) =>
      value.peerId === "A" && value.chunkHashPrefix === target.hash.slice(0, 12));
    assert.equal(failover?.retryInMilliseconds, 30_000);
    assert.equal(failover?.switchedPeer, true);
    assert.deepEqual(Object.keys(failover).sort(), [
      "attempt",
      "chunkHashPrefix",
      "errorKind",
      "httpStatus",
      "maxAttempts",
      "networkCode",
      "operation",
      "peerEndpoint",
      "peerId",
      "remainingBytes",
      "resumedChunks",
      "retryInMilliseconds",
      "retryable",
      "serverErrorCode",
      "switchedPeer",
    ]);
  } finally {
    Date.now = originalNow;
    await cleanup(root);
  }
});

test("timeout Seed is replaced, permanent peers fail safely, and diagnostics expose no secrets", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root);
    const bytes = await bytesByHash(fixture);
    const calls = { timeout: 0, good: 0 };
    const timeout = fakeClient(fixture, bytes, {
      chunk: async () => {
        calls.timeout += 1;
        throw new TeamForgePeerError("peer_timeout", "Bearer sentinel-transfer-token", { retryable: true });
      },
    });
    const good = fakeClient(fixture, bytes, {
      chunk: async (hash) => {
        calls.good += 1;
        return bytes.get(hash);
      },
    });
    const diagnostics = [];
    const complete = await new SwarmDownloader({
      store: new ChunkStore(path.join(root, "failover")),
      maxConcurrency: 1,
      retryBaseMilliseconds: 1,
      retryMaximumMilliseconds: 5,
      retryJitterRatio: 0,
      minimumPeerIntervalMilliseconds: 0,
      onDiagnostic: (value) => diagnostics.push(value),
    }).download({
      manifest: fixture.manifest,
      seeds: [{ id: "timeout", client: timeout }, { id: "good", client: good }],
      sessionId: "editors",
    });
    assert.equal(complete.completedChunks, uniqueManifestChunks(fixture.manifest).length);
    assert(calls.timeout > 0 && calls.good > 0);
    assert(diagnostics.some((value) => value.switchedPeer));
    assert(!JSON.stringify(diagnostics).includes("sentinel-transfer-token"));

    const permanent = fakeClient(fixture, bytes, {
      chunk: async () => {
        throw new TeamForgePeerError("peer_http_error", "Bearer sentinel-transfer-token", {
          status: 401,
          retryable: false,
          body: "privateKey=sentinel-private-key",
        });
      },
    });
    let rejected;
    try {
      await new SwarmDownloader({
        store: new ChunkStore(path.join(root, "permanent")),
        maxConcurrency: 1,
        retryRounds: 3,
        minimumPeerIntervalMilliseconds: 0,
      }).download({
        manifest: fixture.manifest,
        seeds: [{ id: "permanent", endpoint: "http://127.0.0.1:5091/private?token=hidden", client: permanent }],
        sessionId: "editors",
      });
    } catch (error) {
      rejected = error;
    }
    assert.equal(rejected?.code, "direct_transfer_unavailable");
    assert.equal(rejected.details.failures.length, 1, "Permanent peer must not be retried for the same Chunk.");
    const serialized = JSON.stringify(rejected.details);
    assert(!serialized.includes("sentinel-transfer-token"));
    assert(!serialized.includes("sentinel-private-key"));
    assert(!serialized.includes("token=hidden"));
  } finally {
    await cleanup(root);
  }
});

test("verified Chunk resume avoids re-download after an interrupted process-equivalent attempt", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: Object.fromEntries(Array.from({ length: 8 }, (_, index) => [
        `Assets/Resume-${index}.bin`, Buffer.alloc(65_536, index + 31),
      ])),
    });
    const bytes = await bytesByHash(fixture);
    const chunks = uniqueManifestChunks(fixture.manifest);
    const destination = new ChunkStore(path.join(root, "destination"));
    let firstCalls = 0;
    const interrupted = fakeClient(fixture, bytes, {
      chunk: async (hash) => {
        firstCalls += 1;
        if (firstCalls > 3) {
          throw new TeamForgePeerError("peer_http_error", "seed stopped", { status: 401, retryable: false });
        }
        return bytes.get(hash);
      },
    });
    await assert.rejects(() => new SwarmDownloader({
      store: destination,
      maxConcurrency: 1,
      retryRounds: 0,
      minimumPeerIntervalMilliseconds: 0,
    }).download({ manifest: fixture.manifest, seeds: [{ id: "stopped", client: interrupted }], sessionId: "editors" }), {
      code: "direct_transfer_unavailable",
    });
    const verifiedBeforeResume = [];
    for (const chunk of chunks) {
      if (await destination.has(chunk.hash, chunk.size, true)) verifiedBeforeResume.push(chunk.hash);
    }
    assert.equal(verifiedBeforeResume.length, 3);

    const resumedCalls = new Set();
    const replacement = fakeClient(fixture, bytes, {
      chunk: async (hash) => {
        resumedCalls.add(hash);
        return bytes.get(hash);
      },
    });
    const resumed = await new SwarmDownloader({
      store: destination,
      maxConcurrency: 4,
      minimumPeerIntervalMilliseconds: 0,
    }).download({ manifest: fixture.manifest, seeds: [{ id: "replacement", client: replacement }], sessionId: "editors" });
    assert.equal(resumed.resumedChunks, 3);
    assert(verifiedBeforeResume.every((hash) => !resumedCalls.has(hash)));
    assert.equal(resumed.completedChunks, chunks.length);
  } finally {
    await cleanup(root);
  }
});

test("150+ unique small Chunks complete from one rate-limited HTTP Seed at high concurrency", async () => {
  const root = await temporaryRoot();
  let server;
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: Object.fromEntries(Array.from({ length: 150 }, (_, index) => [
        `Assets/Small-${String(index).padStart(3, "0")}.bin`, Buffer.alloc(65_536, index + 1),
      ])),
    });
    const chunks = uniqueManifestChunks(fixture.manifest);
    assert(chunks.length >= 150);
    const transferToken = createTransferToken();
    server = new DirectTransferServer({
      projectUuid: fixture.projectUuid,
      sessionId: "editors",
      manifest: fixture.manifest,
      descriptor: fixture.descriptor,
      store: fixture.store,
      transferToken,
      rateLimitPerSecond: 120,
      maxConcurrentRequests: 8,
    });
    const bound = await server.start();
    const seed = {
      id: "single-http-seed",
      endpoint: bound.endpoint,
      transferToken,
    };
    const downloader = new SwarmDownloader({
      store: new ChunkStore(path.join(root, "destination")),
      maxConcurrency: 12,
    });
    const discovered = await downloader.discover({
      seeds: [seed],
      projectId: fixture.projectId,
      projectUuid: fixture.projectUuid,
      manifestHash: fixture.manifest.manifestHash,
      sessionId: "editors",
      trustedOwnerKeyId: fixture.owner.keyId,
    });
    assert.equal(discovered.manifest.manifestHash, fixture.manifest.manifestHash);
    const result = await downloader.download({ manifest: fixture.manifest, seeds: [seed], sessionId: "editors" });
    assert.equal(result.completedChunks, chunks.length);
    assert.equal(result.state, "Verifying");
  } finally {
    await server?.stop();
    await cleanup(root);
  }
});

test("actual HTTP 429 Retry-After cooldown completes with a single Seed", async () => {
  const root = await temporaryRoot();
  let server;
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: Object.fromEntries(Array.from({ length: 5 }, (_, index) => [
        `Assets/Rate-${index}.bin`, Buffer.alloc(65_536, index + 81),
      ])),
    });
    const transferToken = createTransferToken();
    server = new DirectTransferServer({
      projectUuid: fixture.projectUuid,
      sessionId: "editors",
      manifest: fixture.manifest,
      descriptor: fixture.descriptor,
      store: fixture.store,
      transferToken,
      rateLimitPerSecond: 3,
    });
    const bound = await server.start();
    const diagnostics = [];
    const result = await new SwarmDownloader({
      store: new ChunkStore(path.join(root, "destination")),
      maxConcurrency: 1,
      retryRounds: 3,
      retryBaseMilliseconds: 10,
      retryMaximumMilliseconds: 2_000,
      retryJitterRatio: 0,
      minimumPeerIntervalMilliseconds: 0,
      onDiagnostic: (value) => diagnostics.push(value),
    }).download({
      manifest: fixture.manifest,
      seeds: [{ id: "rate-limited", endpoint: bound.endpoint, transferToken }],
      sessionId: "editors",
    });
    assert.equal(result.completedChunks, uniqueManifestChunks(fixture.manifest).length);
    assert(diagnostics.some((value) => value.httpStatus === 429 && value.retryInMilliseconds > 0));
  } finally {
    await server?.stop();
    await cleanup(root);
  }
});
