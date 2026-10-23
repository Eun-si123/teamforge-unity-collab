import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { createServer } from "node:http";
import { getEventListeners } from "node:events";
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

test("local ChunkStore write failures preserve their original error without retrying healthy peers", async (t) => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root);
    const bytes = await bytesByHash(fixture);
    for (const code of ["ENOSPC", "EACCES", "peer_network_error", "direct_transfer_unavailable"]) {
      await t.test(code, async () => {
        const failure = Object.assign(new Error("local cache publication failed"), {
          code, details: { retryable: true },
        });
        const store = new ChunkStore(path.join(root, `local-${code}`));
        const diagnostics = [];
        const states = [];
        let requests = 0, writes = 0;
        store.put = async () => { writes += 1; throw failure; };
        const downloader = new SwarmDownloader({
          store, maxConcurrency: 1, retryRounds: 1,
          retryBaseMilliseconds: 1, retryMaximumMilliseconds: 1,
          retryJitterRatio: 0, minimumPeerIntervalMilliseconds: 0,
          onDiagnostic: value => diagnostics.push(value),
          onProgress: value => states.push(value.state),
        });
        await assert.rejects(downloader.download({
          manifest: fixture.manifest, sessionId: "local-store-failure",
          seeds: ["a", "b"].map(id => ({
            id, client: fakeClient(fixture, bytes, {
              chunk: async hash => { requests += 1; return bytes.get(hash); },
            }),
          })),
        }), error => error === failure);
        assert.equal(requests, 1);
        assert.equal(writes, 1);
        assert.deepEqual(diagnostics, [], "a local fault must not penalize a healthy source");
        assert.equal(states.includes("DirectTransferUnavailable"), false);
        assert.equal(states.includes("Verifying"), false);
      });
    }
  } finally { await cleanup(root); }
});

test("local write failure cancels and settles sibling requests while preserving verified cache", {
  timeout: 10_000,
}, async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root);
    const bytes = await bytesByHash(fixture);
    const chunks = uniqueManifestChunks(fixture.manifest);
    const store = new ChunkStore(path.join(root, "concurrent-local-failure"));
    const put = store.put.bind(store);
    const cached = chunks.at(-1);
    await store.put(bytes.get(cached.hash), cached.hash);
    const failure = Object.assign(new Error("disk full"), { code: "ENOSPC" });
    let siblingStarted;
    const siblingReady = new Promise(resolve => { siblingStarted = resolve; });
    let requests = 0, writes = 0, aborted = 0, siblingSettled = false;
    const diagnostics = [];
    const caller = new AbortController();
    store.put = async () => { writes += 1; throw failure; };
    const client = fakeClient(fixture, bytes, {
      chunk: async (hash, _size, signal) => {
        requests += 1;
        if (hash === chunks[0].hash) {
          await siblingReady;
          return bytes.get(hash);
        }
        siblingStarted();
        try {
          return await new Promise(resolve => signal.addEventListener("abort", () => {
            aborted += 1;
            // Even a source that returns bytes after cancellation cannot publish them.
            resolve(bytes.get(hash));
          }, { once: true }));
        } finally { siblingSettled = true; }
      },
    });
    const downloader = new SwarmDownloader({
      store, maxConcurrency: 2, retryRounds: 0, minimumPeerIntervalMilliseconds: 0,
      onDiagnostic: value => diagnostics.push(value),
    });
    await assert.rejects(downloader.download({
      manifest: fixture.manifest, seeds: [{ id: "a", client }],
      sessionId: "concurrent-local-failure", signal: caller.signal,
    }), error => error === failure);
    assert.equal(requests, 2);
    assert.equal(writes, 1);
    assert.equal(aborted, 1);
    assert.equal(siblingSettled, true, "the operation must settle all owned requests before returning");
    assert.equal(caller.signal.aborted, false);
    assert.deepEqual(diagnostics, []);
    assert.equal(await store.has(cached.hash, cached.size, true), true);
    store.put = put;
    const resumedRequests = [];
    const resumed = await downloader.download({
      manifest: fixture.manifest, sessionId: "concurrent-local-failure", signal: caller.signal,
      seeds: [{ id: "repaired", client: fakeClient(fixture, bytes, {
        chunk: async hash => { resumedRequests.push(hash); return bytes.get(hash); },
      }) }],
    });
    assert.equal(resumed.resumedChunks, 1);
    assert.equal(resumed.completedChunks, chunks.length);
    assert.equal(resumedRequests.length, chunks.length - 1);
    assert.equal(resumedRequests.includes(cached.hash), false);
    assert.equal(caller.signal.aborted, false);
    for (const chunk of chunks) assert.ok(await store.has(chunk.hash, chunk.size, true));
  } finally { await cleanup(root); }
});

test("cache inspection, cleanup and final verification preserve local failures without chunk requests", async (t) => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root);
    const bytes = await bytesByHash(fixture);
    const chunks = uniqueManifestChunks(fixture.manifest);
    for (const phase of ["inspection", "cleanup", "verification"]) {
      await t.test(phase, async () => {
        const store = new ChunkStore(path.join(root, `cache-${phase}`));
        if (phase === "verification") {
          for (const [hash, value] of bytes) await store.put(value, hash);
        }
        const failure = Object.assign(new Error("cache unavailable"), { code: "EIO" });
        const has = store.has.bind(store);
        let checks = 0, requests = 0;
        store.has = async (...args) => {
          checks += 1;
          if (phase === "inspection" || (phase === "verification" && checks > chunks.length)) throw failure;
          return has(...args);
        };
        if (phase === "cleanup") store.deleteInvalid = async () => { throw failure; };
        await assert.rejects(new SwarmDownloader({ store }).download({
          manifest: fixture.manifest, sessionId: "cache-local-failure",
          seeds: [{ id: "source", client: fakeClient(fixture, bytes, {
            chunk: async hash => { requests += 1; return bytes.get(hash); },
          }) }],
        }), error => error === failure);
        assert.equal(requests, 0);
      });
    }
  } finally { await cleanup(root); }
});

test("the same storage-like error from a source still fails over to a healthy peer", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root);
    const bytes = await bytesByHash(fixture);
    let failedRequests = 0, healthyRequests = 0;
    const failure = Object.assign(new Error("remote source unavailable"), { code: "ENOSPC" });
    const store = new ChunkStore(path.join(root, "remote-storage-failure"));
    const result = await new SwarmDownloader({
      store, maxConcurrency: 1, retryRounds: 0, minimumPeerIntervalMilliseconds: 0,
    }).download({
      manifest: fixture.manifest, sessionId: "remote-storage-failure",
      seeds: [
        { id: "failed", client: fakeClient(fixture, bytes, {
          chunk: async () => { failedRequests += 1; throw failure; },
        }) },
        { id: "healthy", client: fakeClient(fixture, bytes, {
          chunk: async hash => { healthyRequests += 1; return bytes.get(hash); },
        }) },
      ],
    });
    assert.ok(failedRequests > 0);
    assert.equal(healthyRequests, uniqueManifestChunks(fixture.manifest).length);
    assert.ok(result.failures.some(value => value.errorKind === "ENOSPC" && value.peerId === "failed"));
    for (const chunk of uniqueManifestChunks(fixture.manifest)) assert.ok(await store.has(chunk.hash, chunk.size, true));
  } finally { await cleanup(root); }
});

test("a verified hedge winner's local write failure is terminal and written only once", {
  timeout: 10_000,
}, async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root);
    const bytes = await bytesByHash(fixture);
    const store = new ChunkStore(path.join(root, "hedged-local-failure"));
    const chunks = uniqueManifestChunks(fixture.manifest);
    for (const chunk of chunks.slice(1)) await store.put(bytes.get(chunk.hash), chunk.hash);
    const failure = Object.assign(new Error("disk full"), { code: "ENOSPC" });
    let requests = 0, aborted = 0, writes = 0;
    store.put = async () => { writes += 1; throw failure; };
    const client = fakeClient(fixture, bytes, {
      chunk: async (hash, _size, signal) => {
        requests += 1;
        if (requests > 1) return bytes.get(hash);
        return new Promise((_resolve, reject) => signal.addEventListener("abort", () => {
          aborted += 1;
          reject(new TeamForgePeerError("download_cancelled", "hedge loser aborted"));
        }, { once: true }));
      },
    });
    await assert.rejects(new SwarmDownloader({
      store, maxConcurrency: 1, retryRounds: 0, minimumPeerIntervalMilliseconds: 0,
      endgameMode: "hedged", sleep: async () => {},
    }).download({
      manifest: fixture.manifest, sessionId: "hedged-local-failure",
      seeds: [{ id: "a", client }, { id: "b", client }],
    }), error => error === failure);
    assert.equal(requests, 2);
    assert.equal(aborted, 1);
    assert.equal(writes, 1);
  } finally { await cleanup(root); }
});

test("duplicate peer labels do not share discovery failure or retry budgets", async (t) => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root);
    const bytes = await bytesByHash(fixture);
    for (const healthyFallback of [false, true]) {
      await t.test(healthyFallback ? "healthy fallback" : "all sources exhausted", async () => {
        const calls = [0, 0];
        const seeds = calls.map((_, index) => ({
          id: "same-label",
          client: fakeClient(fixture, bytes, {
            descriptor: async () => {
              calls[index] += 1;
              if (healthyFallback && index === 1) return fixture.descriptor;
              throw new TeamForgePeerError("peer_network_error", "offline", { retryable: true });
            },
          }),
        }));
        const downloader = new SwarmDownloader({
          store: new ChunkStore(path.join(root, "discovery-duplicate-labels")),
          retryRounds: 1, retryBaseMilliseconds: 1, retryMaximumMilliseconds: 1,
          retryJitterRatio: 0, minimumPeerIntervalMilliseconds: 0,
        });
        const pending = downloader.discover({
          seeds, projectId: fixture.projectId, projectUuid: fixture.projectUuid,
          manifestHash: fixture.manifest.manifestHash, sessionId: "editors",
        });
        if (healthyFallback) {
          assert.equal((await pending).descriptor.descriptorHash, fixture.descriptor.descriptorHash);
          assert.equal(calls[1], 1);
        } else {
          await assert.rejects(pending, error => {
            assert.equal(error.code, "direct_transfer_unavailable");
            assert.equal(error.details.failures.length, 4);
            return true;
          });
          assert.deepEqual(calls, [2, 2], "each actual source gets its own bounded retry budget");
        }
      });
    }
  } finally {
    await cleanup(root);
  }
});

test("a failed Chunk source cannot suppress a healthy source with the same label", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root);
    const bytes = await bytesByHash(fixture);
    const calls = [0, 0];
    const seeds = calls.map((_, index) => ({
      id: "same-label",
      client: fakeClient(fixture, bytes, {
        chunk: async hash => {
          calls[index] += 1;
          if (index === 0) throw new TeamForgePeerError("peer_chunk_invalid", "invalid source");
          return bytes.get(hash);
        },
      }),
    }));
    const store = new ChunkStore(path.join(root, "duplicate-labels"));
    const result = await new SwarmDownloader({ store, maxConcurrency: 1, minimumPeerIntervalMilliseconds: 0 })
      .download({ manifest: fixture.manifest, seeds, sessionId: "editors" });
    assert.equal(result.completedChunks, uniqueManifestChunks(fixture.manifest).length);
    assert.ok(calls.every(count => count > 0));
    assert.equal(result.peerInventoryHealth.multipleAdvertiserChunks, 0,
      "a repeated label must still not be counted as an independent replica");
  } finally {
    await cleanup(root);
  }
});

test("a failed source cannot delete verified content stored concurrently by another operation", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root);
    const bytes = await bytesByHash(fixture);
    const chunks = uniqueManifestChunks(fixture.manifest);
    const target = chunks[0];
    const store = new ChunkStore(path.join(root, "shared-cache"));
    for (const chunk of chunks.slice(1)) await store.put(bytes.get(chunk.hash), chunk.hash);
    let requests = 0;
    const client = fakeClient(fixture, bytes, {
      chunk: async hash => {
        requests += 1;
        // A second local writer finishes while this source request is in flight.
        await store.put(bytes.get(hash), hash);
        return Buffer.alloc(bytes.get(hash).length, 0xff);
      },
    });
    const downloader = new SwarmDownloader({ store, retryRounds: 0, minimumPeerIntervalMilliseconds: 0 });
    const input = { manifest: fixture.manifest, seeds: [{ id: "bad-source", client }], sessionId: "editors" };
    await assert.rejects(downloader.download(input), { code: "direct_transfer_unavailable" });
    assert.equal(await store.has(target.hash, target.size, true), true,
      "source failure owns no already-verified shared cache entry");
    const resumed = await downloader.download(input);
    assert.equal(requests, 1);
    assert.equal(resumed.transferredChunks, 0);
    assert.equal(resumed.resumedChunks, chunks.length);
  } finally {
    await cleanup(root);
  }
});

test("cancellation during cached or final verification never reports download success", async (t) => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root);
    const bytes = await bytesByHash(fixture);
    const chunks = uniqueManifestChunks(fixture.manifest);
    for (const phase of ["cached", "final", "verifying-progress"]) {
      await t.test(phase, async () => {
        const controller = new AbortController();
        const store = new ChunkStore(path.join(root, `cancel-${phase}`));
        for (const [hash, value] of bytes) await store.put(value, hash);
        const originalHas = store.has.bind(store);
        let checks = 0;
        store.has = async (...args) => {
          const result = await originalHas(...args);
          checks += 1;
          if ((phase === "cached" && checks === 1) ||
              (phase === "final" && checks === chunks.length + 1)) controller.abort();
          return result;
        };
        let chunkRequests = 0;
        const client = fakeClient(fixture, bytes, {
          chunk: async hash => { chunkRequests += 1; return bytes.get(hash); },
        });
        const downloader = new SwarmDownloader({
          store,
          onProgress: progress => {
            if (phase === "verifying-progress" && progress.state === "Verifying") controller.abort();
          },
        });
        await assert.rejects(downloader.download({
          manifest: fixture.manifest, seeds: [{ id: "cached", client }],
          sessionId: "editors", signal: controller.signal,
        }), { code: "download_cancelled" });
        assert.equal(chunkRequests, 0);
        if (phase === "cached") assert.equal(checks, 1, "stop scanning cached files after cancellation");
        if (phase === "final") assert.equal(checks, chunks.length + 1);
        assert.equal((await store.inventory(chunks.map(chunk => chunk.hash))).length, chunks.length,
          "cancellation must preserve every verified cached Chunk for resume");
      });
    }
  } finally {
    await cleanup(root);
  }
});

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

test("terminal failure cancels sibling requests and cooldowns without masking the cause", async (t) => {
  for (const mode of ["request", "cooldown"]) {
    await t.test(mode, { timeout: 10_000 }, async () => {
      const root = await temporaryRoot();
      const caller = new AbortController();
      let outcome;
      let guard;
      try {
        const fixture = await publicationFixture(root, {
          assetFiles: {
            "Assets/A.bin": Buffer.alloc(65_536, 1),
            "Assets/B.bin": Buffer.alloc(65_536, 2),
          },
        });
        const bytes = await bytesByHash(fixture);
        const chunks = uniqueManifestChunks(fixture.manifest);
        const store = new ChunkStore(path.join(root, "destination"));
        const diagnostics = [];
        let siblingSignal;
        let siblingStarted;
        const started = new Promise((resolve) => { siblingStarted = resolve; });
        const inventory = (hashes) => async () => ({
          projectUuid: fixture.projectUuid,
          manifestHash: fixture.manifest.manifestHash,
          chunks: hashes,
        });
        const slow = fakeClient(fixture, bytes, {
          inventory: inventory([chunks[0].hash]),
          chunk: async (_hash, _size, signal) => {
            siblingSignal = signal;
            if (mode === "cooldown") {
              throw new TeamForgePeerError("peer_http_error", "busy Seed", {
                retryable: true, status: 429, retryAfterMilliseconds: 60_000,
              });
            }
            siblingStarted();
            return new Promise((_resolve, reject) => {
              signal.addEventListener("abort", () => reject(
                new TeamForgePeerError("download_cancelled", "request aborted"),
              ), { once: true });
            });
          },
        });
        const fatal = fakeClient(fixture, bytes, {
          inventory: inventory(chunks.slice(1).map((chunk) => chunk.hash)),
          chunk: async () => {
            await started;
            throw new TeamForgePeerError("peer_chunk_invalid", "invalid content", { retryable: false });
          },
        });
        const downloader = new SwarmDownloader({
          store,
          maxConcurrency: 2,
          retryRounds: 1,
          minimumPeerIntervalMilliseconds: 0,
          onDiagnostic: (value) => {
            diagnostics.push(value);
            if (value.peerId === "slow") siblingStarted();
          },
        });
        outcome = downloader.download({
          manifest: fixture.manifest,
          seeds: [{ id: "slow", client: slow }, { id: "fatal", client: fatal }],
          sessionId: "editors",
          signal: caller.signal,
        }).then(() => assert.fail("Download should fail"), (error) => error);
        const error = await Promise.race([
          outcome,
          new Promise((resolve) => { guard = setTimeout(() => resolve(null), 1_500); }),
        ]);
        assert.ok(error, "A terminal failure must settle without waiting for a sibling's request deadline or cooldown");
        assert.equal(error.code, "direct_transfer_unavailable");
        assert.equal(error.details.failures.at(-1).errorKind, "peer_chunk_invalid");
        assert.equal(siblingSignal.aborted, true);
        assert.equal(caller.signal.aborted, false, "Cleanup must not abort the caller's controller");
        assert.equal(getEventListeners(caller.signal, "abort").length, 0, "Caller relay must be detached");
        assert.equal(diagnostics.some((value) => value.errorKind === "download_cancelled"), false);
        for (const chunk of chunks) assert.equal(await store.has(chunk.hash), false);
      } finally {
        clearTimeout(guard);
        caller.abort();
        await outcome;
        await cleanup(root);
      }
    });
  }
});

test("terminal HTTP failure aborts simultaneous real requests without listener warnings", { timeout: 10_000 }, async () => {
  const root = await temporaryRoot();
  const warnings = [];
  const onWarning = (warning) => {
    if (warning.name === "MaxListenersExceededWarning") warnings.push(warning.message);
  };
  process.on("warning", onWarning);
  let server;
  let outcome;
  let guard;
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: Object.fromEntries(Array.from({ length: 16 }, (_, index) => [
        `Assets/Concurrent-${index}.bin`, Buffer.alloc(65_536, index + 1),
      ])),
    });
    const chunks = uniqueManifestChunks(fixture.manifest);
    const held = [];
    let failingResponse;
    let started = 0;
    let closed = 0;
    server = createServer((request, response) => {
      if (request.url.includes("/inventory/")) {
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
          projectUuid: fixture.projectUuid,
          manifestHash: fixture.manifest.manifestHash,
          chunks: chunks.map((chunk) => chunk.hash),
        }));
        return;
      }
      started += 1;
      if (request.url.endsWith(chunks[15].hash)) failingResponse = response;
      else {
        held.push(response);
        response.on("close", () => { closed += 1; });
      }
      if (started === 16) failingResponse.writeHead(403, { "content-type": "application/json" }).end("{}");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const caller = new AbortController();
    const store = new ChunkStore(path.join(root, "destination"));
    const downloader = new SwarmDownloader({
      store, maxConcurrency: 16, retryRounds: 0, minimumPeerIntervalMilliseconds: 0,
      timeoutMilliseconds: 30_000,
    });
    outcome = downloader.download({
      manifest: fixture.manifest,
      seeds: [{ id: "http", endpoint: `http://127.0.0.1:${server.address().port}`, transferToken: createTransferToken() }],
      sessionId: "editors",
      signal: caller.signal,
    }).then(() => assert.fail("Download should fail"), (error) => error);
    const error = await Promise.race([
      outcome,
      new Promise((resolve) => { guard = setTimeout(() => resolve(null), 2_000); }),
    ]);
    assert.equal(error?.code, "direct_transfer_unavailable");
    assert.equal(error.details.failures.at(-1).httpStatus, 403);
    assert.equal(started, 16);
    assert.equal(getEventListeners(caller.signal, "abort").length, 0);
    for (let attempt = 0; closed < 15 && attempt < 50; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(closed, 15, "Every held HTTP response must close after sibling cancellation");
    assert.deepEqual(warnings, []);
    for (const chunk of chunks) assert.equal(await store.has(chunk.hash), false);
  } finally {
    clearTimeout(guard);
    server?.closeAllConnections();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await outcome;
    process.removeListener("warning", onWarning);
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


test("session-local peer measurements exclude resume, pacing and storage", async (t) => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: Object.fromEntries(Array.from({ length: 6 }, (_, index) => [
        `Assets/Metrics-${index}.bin`, Buffer.alloc(65_536, index + 41),
      ])),
    });
    const bytes = await bytesByHash(fixture);
    const chunks = uniqueManifestChunks(fixture.manifest);
    const destination = new ChunkStore(path.join(root, "destination"));
    await destination.put(bytes.get(chunks[0].hash), chunks[0].hash);
    let now = 0;
    const expected = [{ bytes: 0, attempts: 0 }, { bytes: 0, attempts: 0 }];
    const seeds = [20, 80].map((serviceMs, index) => ({
      id: `peer-${index}`,
      client: fakeClient(fixture, bytes, {
        inventory: async () => {
          now += 2_000; // Metadata is not payload service time.
          return {
            projectUuid: fixture.projectUuid,
            manifestHash: fixture.manifest.manifestHash,
            chunks: chunks.filter((_, ordinal) => ordinal % 2 === index).map((chunk) => chunk.hash),
          };
        },
        chunk: async (hash) => {
          now += serviceMs;
          expected[index].bytes += bytes.get(hash).length;
          expected[index].attempts += 1;
          return bytes.get(hash);
        },
      }),
    }));
    const downloader = new SwarmDownloader({
      store: {
        has: (...args) => destination.has(...args),
        deleteInvalid: (...args) => destination.deleteInvalid(...args),
        put: async (...args) => {
          now += 500; // Storage must not inflate request service time.
          return destination.put(...args);
        },
      },
      maxConcurrency: 1,
      minimumPeerIntervalMilliseconds: 5,
      monotonicNow: () => now,
      sleep: async () => { now += 1_000; },
      onPartialSeed: async () => { now += 700; },
    });
    const result = await downloader.download({ manifest: fixture.manifest, seeds, sessionId: "editors" });
    assert.equal(result.resumedChunks, 1);
    assert.equal(result.resumedBytes, chunks[0].size);
    for (const [index, peer] of result.peers.entries()) {
      const serviceMs = [20, 80][index];
      assert(expected[index].attempts > 0);
      assert.equal(peer.chunkAttempts, expected[index].attempts);
      assert.equal(peer.successes, expected[index].attempts);
      assert.equal(peer.verifiedBytes, expected[index].bytes);
      assert.equal(peer.successfulRequestMilliseconds, serviceMs * expected[index].attempts);
      assert.equal(peer.requestServiceBytesPerSecond,
        Math.round(expected[index].bytes * 1_000 / (serviceMs * expected[index].attempts)));
    }
    assert.equal(result.peers.reduce((sum, peer) => sum + peer.verifiedBytes, 0), result.transferredBytes);
    t.diagnostic(JSON.stringify(result.peers.map(({ id, verifiedBytes, successfulRequestMilliseconds,
      requestServiceBytesPerSecond }) => ({ id, verifiedBytes, successfulRequestMilliseconds,
      requestServiceBytesPerSecond }))));

    const resumed = await downloader.download({ manifest: fixture.manifest, seeds, sessionId: "editors" });
    assert.equal(resumed.resumedChunks, chunks.length);
    for (const peer of resumed.peers) {
      assert.equal(peer.chunkAttempts, 0);
      assert.equal(peer.verifiedBytes, 0);
      assert.equal(peer.successfulRequestMilliseconds, 0);
      assert.equal(peer.requestServiceBytesPerSecond, 0);
    }
  } finally {
    await cleanup(root);
  }
});

test("corrupt source attempts never earn verified bytes or service-rate credit", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root);
    const bytes = await bytesByHash(fixture);
    const chunks = uniqueManifestChunks(fixture.manifest);
    let now = 0;
    const corrupt = fakeClient(fixture, bytes, {
      inventory: async () => ({
        projectUuid: fixture.projectUuid,
        manifestHash: fixture.manifest.manifestHash,
        chunks: [chunks[0].hash],
      }),
      chunk: async (hash) => {
        now += 1;
        const broken = Buffer.from(bytes.get(hash));
        broken[0] ^= 0xff;
        return broken;
      },
    });
    const good = fakeClient(fixture, bytes, {
      chunk: async (hash) => { now += 50; return bytes.get(hash); },
    });
    const result = await new SwarmDownloader({
      store: new ChunkStore(path.join(root, "destination")),
      maxConcurrency: 1,
      retryRounds: 0,
      minimumPeerIntervalMilliseconds: 0,
      monotonicNow: () => now,
    }).download({
      manifest: fixture.manifest,
      seeds: [{ id: "corrupt", client: corrupt }, { id: "verified", client: good }],
      sessionId: "editors",
    });
    assert.equal(result.peers[0].chunkAttempts, 1);
    assert.equal(result.peers[0].verifiedBytes, 0);
    assert.equal(result.peers[0].successfulRequestMilliseconds, 0);
    assert.equal(result.peers[0].requestServiceBytesPerSecond, 0);
    assert.equal(result.peers[1].verifiedBytes, result.totalBytes);
    assert.equal(result.peers[1].successfulRequestMilliseconds, chunks.length * 50);
    assert(result.failures.some((failure) => failure.errorKind === "peer_chunk_invalid"));
  } finally {
    await cleanup(root);
  }
});

test("zero measured request duration reports a finite zero rate", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root);
    const bytes = await bytesByHash(fixture);
    const result = await new SwarmDownloader({
      store: new ChunkStore(path.join(root, "destination")),
      minimumPeerIntervalMilliseconds: 0,
      monotonicNow: () => 0,
    }).download({ manifest: fixture.manifest, seeds: [{ client: fakeClient(fixture, bytes) }], sessionId: "editors" });
    assert.equal(result.peers[0].verifiedBytes, result.totalBytes);
    assert.equal(result.peers[0].successfulRequestMilliseconds, 0);
    assert.equal(result.peers[0].requestServiceBytesPerSecond, 0);
  } finally {
    await cleanup(root);
  }
});


test("swarm inventory health reports advertised coverage and single-source exposure", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: {
        "Assets/A.bin": Buffer.alloc(65_536, 1),
        "Assets/B.bin": Buffer.alloc(65_536, 2),
        "Assets/C.bin": Buffer.alloc(65_536, 3),
      },
    });
    const bytes = await bytesByHash(fixture);
    const hashes = [...bytes.keys()];
    assert(hashes.length >= 3);
    const downloader = new SwarmDownloader({
      store: new ChunkStore(path.join(root, "health-destination")),
      retryRounds: 0,
    });
    const result = await downloader.download({
      manifest: fixture.manifest, sessionId: "health",
      seeds: [
        { id: "seed-all", client: fakeClient(fixture, bytes) },
        { id: "seed-one", client: fakeClient(fixture, bytes, {
          inventory: async () => ({
            projectUuid: fixture.projectUuid,
            manifestHash: fixture.manifest.manifestHash,
            chunks: [hashes[0]],
          }),
        }) },
        { id: "seed-inventory-unknown", client: fakeClient(fixture, bytes, {
          inventory: async () => {
            throw new TeamForgePeerError("peer_http_error", "temporary inventory outage", { retryable: true });
          },
        }) },
      ],
    });
    const totalBytes = [...bytes.values()].reduce((sum, value) => sum + value.length, 0);
    assert.deepEqual(result.peerInventoryHealth, {
      totalUniqueChunks: hashes.length,
      totalUniqueBytes: totalBytes,
      validatedInventories: 2,
      unknownInventories: 1,
      advertisedChunks: hashes.length,
      advertisedBytes: totalBytes,
      unadvertisedByKnownPeersChunks: 0,
      unadvertisedByKnownPeersBytes: 0,
      singleAdvertiserChunks: hashes.length - 1,
      singleAdvertiserBytes: totalBytes - bytes.get(hashes[0]).length,
      multipleAdvertiserChunks: 1,
      multipleAdvertiserBytes: bytes.get(hashes[0]).length,
      advertisedCoveragePercent: 100,
      advertisedByteCoveragePercent: 100,
    });
    assert(Object.isFrozen(result.peerInventoryHealth));
    assert.equal(result.completedChunks, hashes.length);
  } finally {
    await cleanup(root);
  }
});

test("swarm inventory health never treats unknown inventory as absent content", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root);
    const bytes = await bytesByHash(fixture);
    const downloader = new SwarmDownloader({
      store: new ChunkStore(path.join(root, "unknown-inventory")),
      retryRounds: 0,
    });
    const result = await downloader.download({
      manifest: fixture.manifest, sessionId: "health",
      seeds: [{ id: "inventory-unavailable", client: fakeClient(fixture, bytes, {
        inventory: async () => {
          throw new TeamForgePeerError("peer_http_error", "temporary inventory outage", { retryable: true });
        },
      }) }],
    });
    const health = result.peerInventoryHealth;
    assert.equal(health.validatedInventories, 0);
    assert.equal(health.unknownInventories, 1);
    assert.equal(health.advertisedChunks, 0);
    assert.equal(health.unadvertisedByKnownPeersChunks, health.totalUniqueChunks);
    assert.equal(health.advertisedCoveragePercent, 0);
    assert.equal(health.totalUniqueBytes, result.totalBytes);
    assert.equal(health.advertisedBytes, 0);
    assert.equal(health.unadvertisedByKnownPeersBytes, result.totalBytes);
    assert.equal(health.advertisedByteCoveragePercent, 0);
    assert.equal(result.completedChunks, health.totalUniqueChunks,
      "unadvertised-by-known-peers is not proof that chunk download fails");
  } finally {
    await cleanup(root);
  }
});

test("swarm inventory health does not mistake duplicate peer labels for replicas", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root);
    const bytes = await bytesByHash(fixture);
    const result = await new SwarmDownloader({
      store: new ChunkStore(path.join(root, "duplicate-peer-health")),
    }).download({
      manifest: fixture.manifest, sessionId: "health",
      seeds: [
        { id: "same-label", client: fakeClient(fixture, bytes) },
        { id: "same-label", client: fakeClient(fixture, bytes) },
      ],
    });
    assert.equal(result.peerInventoryHealth.validatedInventories, 2);
    assert.equal(result.peerInventoryHealth.singleAdvertiserChunks, result.peerInventoryHealth.totalUniqueChunks);
    assert.equal(result.peerInventoryHealth.multipleAdvertiserChunks, 0);
    assert.equal(result.peerInventoryHealth.singleAdvertiserBytes, result.totalBytes);
    assert.equal(result.peerInventoryHealth.multipleAdvertiserBytes, 0);
  } finally {
    await cleanup(root);
  }
});


test("swarm byte coverage distinguishes known tiny chunks from unknown larger chunks", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: { "Assets/Large.bin": Buffer.alloc(65_536, 44) },
    });
    const bytes = await bytesByHash(fixture);
    const chunks = uniqueManifestChunks(fixture.manifest);
    const smallest = [...chunks].sort((left, right) => left.size - right.size)[0];
    assert(chunks.some(chunk => chunk.size > smallest.size));
    const known = fakeClient(fixture, bytes, {
      inventory: async () => ({
        projectUuid: fixture.projectUuid, manifestHash: fixture.manifest.manifestHash,
        chunks: [smallest.hash],
      }),
    });
    const unknown = fakeClient(fixture, bytes, {
      inventory: async () => {
        throw new TeamForgePeerError("peer_http_error", "unknown inventory", { retryable: true });
      },
    });
    const result = await new SwarmDownloader({
      store: new ChunkStore(path.join(root, "bytes-destination")),
      retryRounds: 0,
    }).download({
      manifest: fixture.manifest, sessionId: "byte-health",
      seeds: [{ id: "small-advertiser", client: known }, { id: "unknown", client: unknown }],
    });
    const health = result.peerInventoryHealth;
    assert.equal(health.advertisedChunks, 1);
    assert.equal(health.advertisedBytes, smallest.size);
    assert.equal(health.singleAdvertiserBytes, smallest.size);
    assert.equal(health.multipleAdvertiserBytes, 0);
    assert.equal(health.totalUniqueBytes, result.totalBytes);
    assert.equal(health.unadvertisedByKnownPeersBytes, result.totalBytes - smallest.size);
    assert.equal(health.advertisedByteCoveragePercent,
      Math.round(100 * smallest.size / result.totalBytes));
    assert(health.advertisedByteCoveragePercent < health.advertisedCoveragePercent);
    assert.equal(result.completedBytes, result.totalBytes,
      "unknown inventory must not prevent an authorized verified transfer");
  } finally {
    await cleanup(root);
  }
});


test("opt-in verified-throughput scheduling learns from hash-verified chunk service time", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: Object.fromEntries(Array.from({ length: 20 }, (_, index) => [
        `Assets/Measured-${index}.bin`, Buffer.alloc(65_536, index + 1),
      ])),
    });
    const bytes = await bytesByHash(fixture);
    let monotonic = 0;
    const calls = { slow: 0, fast: 0 };
    const makeMeasured = (id, serviceMilliseconds) => fakeClient(fixture, bytes, {
      chunk: async (hash) => {
        calls[id] += 1;
        monotonic += serviceMilliseconds;
        return bytes.get(hash);
      },
    });
    const result = await new SwarmDownloader({
      store: new ChunkStore(path.join(root, "measured-destination")),
      peerSelectionMode: "verified-throughput",
      maxConcurrency: 1,
      retryRounds: 0,
      monotonicNow: () => monotonic,
    }).download({
      manifest: fixture.manifest,
      sessionId: "verified-service-test",
      seeds: [
        { id: "slow", client: makeMeasured("slow", 90) },
        { id: "fast", client: makeMeasured("fast", 5) },
      ],
    });
    assert.equal(result.completedChunks, result.totalChunks);
    assert(calls.slow >= 1, "every eligible source should be sampled or explored");
    assert(calls.fast > calls.slow, "verified service rate must influence future chunk placement");
    assert(result.peers[1].requestServiceBytesPerSecond >
      result.peers[0].requestServiceBytesPerSecond);
    assert.equal(result.peers.reduce((total, peer) => total + peer.verifiedBytes, 0),
      result.transferredBytes);
    for (const chunk of uniqueManifestChunks(fixture.manifest)) {
      assert(await new ChunkStore(path.join(root, "measured-destination")).has(chunk.hash, chunk.size, true));
    }
  } finally {
    await cleanup(root);
  }
});

test("verified-throughput scheduling still fails over from a corrupt first source", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: Object.fromEntries(Array.from({ length: 12 }, (_, index) => [
        `Assets/Failover-${index}.bin`, Buffer.alloc(65_536, index + 2),
      ])),
    });
    const bytes = await bytesByHash(fixture);
    let monotonic = 0;
    const destination = new ChunkStore(path.join(root, "measured-failover"));
    const result = await new SwarmDownloader({
      store: destination,
      maxConcurrency: 1,
      retryRounds: 0,
      monotonicNow: () => monotonic,
      peerSelectionMode: "verified-throughput",
    }).download({
      manifest: fixture.manifest,
      sessionId: "measured-failover",
      seeds: [
        { id: "corrupt", client: fakeClient(fixture, bytes, {
          chunk: async (hash) => {
            monotonic += 1;
            return Buffer.alloc(bytes.get(hash).length, 0xff);
          },
        }) },
        { id: "verified", client: fakeClient(fixture, bytes, {
          chunk: async (hash) => {
            monotonic += 60;
            return bytes.get(hash);
          },
        }) },
      ],
    });
    assert.equal(result.completedChunks, result.totalChunks);
    assert(result.peers[0].failures >= 1);
    assert.equal(result.peers[0].verifiedBytes, 0);
    assert.equal(result.peers[0].requestServiceBytesPerSecond, 0);
    assert.equal(result.peers[1].verifiedBytes, result.totalBytes);
    assert(result.failures.some(item => item.errorKind === "peer_chunk_invalid"));
  } finally {
    await cleanup(root);
  }
});

test("peer selection mode is explicit and fail-closed", async () => {
  const store = { has() {}, put() {} };
  assert.equal(new SwarmDownloader({ store }).peerSelectionMode, "balanced");
  assert.equal(new SwarmDownloader({ store, peerSelectionMode: "verified-throughput" }).peerSelectionMode,
    "verified-throughput");
  for (const mode of ["", "adaptive", "random", null, 7]) {
    assert.throws(() => new SwarmDownloader({ store, peerSelectionMode: mode }),
      { code: "invalid_download_limits" });
  }
});

// Inventory hints may affect scheduling only when explicitly enabled.
// No request may bypass the usual trusted Manifest and chunk hash verification.
test("opt-in rarest-first prioritizes singly advertised chunk without changing manifest default", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: Object.fromEntries(Array.from({ length: 5 }, (_, index) => [
        `Assets/Rarity-${index}.bin`, Buffer.alloc(65_536, index + 41),
      ])),
    });
    const bytes = await bytesByHash(fixture);
    const chunks = uniqueManifestChunks(fixture.manifest);
    const rare = chunks.at(-1).hash;
    const run = async (chunkOrder) => {
      const requested = [];
      const seeds = ["all", "others"].map((id) => ({
        id, client: fakeClient(fixture, bytes, {
          inventory: async () => ({
            projectUuid: fixture.projectUuid, manifestHash: fixture.manifest.manifestHash,
            chunks: chunks.filter(chunk => id === "all" || chunk.hash !== rare).map(chunk => chunk.hash),
          }),
          chunk: async hash => { requested.push(hash); return bytes.get(hash); },
        }),
      }));
      const destination = new ChunkStore(path.join(root, `destination-${chunkOrder}`));
      const result = await new SwarmDownloader({
        store: destination, chunkOrder, maxConcurrency: 1, retryRounds: 0,
      }).download({ manifest: fixture.manifest, sessionId: "rarity-test", seeds });
      assert.equal(result.completedChunks, chunks.length);
      for (const chunk of chunks) assert(await destination.has(chunk.hash, chunk.size, true));
      return requested;
    };
    const original = await run("manifest");
    const reordered = await run("rarest-first");
    assert.equal(original[0], chunks[0].hash);
    assert.equal(reordered[0], rare);
    assert.deepEqual(new Set(original), new Set(reordered));
  } finally {
    await cleanup(root);
  }
});

test("rarest-first never classifies unknown inventories as absent and skips resumed chunks", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: Object.fromEntries(Array.from({ length: 4 }, (_, index) => [
        `Assets/Unknown-${index}.bin`, Buffer.alloc(65_536, 71 + index),
      ])),
    });
    const bytes = await bytesByHash(fixture);
    const chunks = uniqueManifestChunks(fixture.manifest);
    const known = chunks.at(-1);
    const resumed = chunks[0];
    const destination = new ChunkStore(path.join(root, "unknown-rarity"));
    await destination.put(bytes.get(resumed.hash), resumed.hash);
    const requested = [];
    const seed = {
      id: "known", client: fakeClient(fixture, bytes, {
        inventory: async () => ({
          projectUuid: fixture.projectUuid, manifestHash: fixture.manifest.manifestHash,
          chunks: [known.hash],
        }),
        chunk: async hash => { requested.push(hash); return bytes.get(hash); },
      }),
    };
    const unknown = {
      id: "unknown", client: fakeClient(fixture, bytes, {
        inventory: async () => {
          throw new TeamForgePeerError("peer_http_error", "inventory temporarily unavailable", { retryable: true });
        },
        chunk: async hash => { requested.push(hash); return bytes.get(hash); },
      }),
    };
    const result = await new SwarmDownloader({
      store: destination, chunkOrder: "rarest-first", maxConcurrency: 1, retryRounds: 0,
    }).download({ manifest: fixture.manifest, sessionId: "unknown-rarity", seeds: [seed, unknown] });
    assert.equal(requested[0], known.hash, "known unique advertiser is a hint, not a guarantee");
    assert(!requested.includes(resumed.hash), "already verified content is never fetched again");
    assert.equal(result.resumedChunks, 1);
    assert.equal(result.completedChunks, chunks.length);
    assert.equal(result.peerInventoryHealth.unknownInventories, 1);
  } finally {
    await cleanup(root);
  }
});

test("rarest-first deduplicates repeated peer labels and rejects unsupported modes", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: Object.fromEntries(Array.from({ length: 3 }, (_, index) => [
        `Assets/Duplicate-${index}.bin`, Buffer.alloc(65_536, 91 + index),
      ])),
    });
    const bytes = await bytesByHash(fixture);
    const chunks = uniqueManifestChunks(fixture.manifest);
    const rare = chunks.at(-1).hash;
    const requested = [];
    const duplicate = () => ({
      id: "same-label", client: fakeClient(fixture, bytes, {
        chunk: async hash => { requested.push(hash); return bytes.get(hash); },
      }),
    });
    const result = await new SwarmDownloader({
      store: new ChunkStore(path.join(root, "dedupe")),
      chunkOrder: "rarest-first", maxConcurrency: 1,
    }).download({
      manifest: fixture.manifest, sessionId: "dedupe-rarity",
      seeds: [duplicate(), duplicate(), {
        id: "other-label", client: fakeClient(fixture, bytes, {
          inventory: async () => ({
            projectUuid: fixture.projectUuid, manifestHash: fixture.manifest.manifestHash,
            chunks: chunks.filter(chunk => chunk.hash !== rare).map(chunk => chunk.hash),
          }),
          chunk: async hash => { requested.push(hash); return bytes.get(hash); },
        }),
      }],
    });
    assert.equal(requested[0], rare);
    assert.equal(result.completedChunks, chunks.length);
  } finally {
    await cleanup(root);
  }
  const store = { has() {}, put() {} };
  assert.equal(new SwarmDownloader({ store }).chunkOrder, "manifest");
  for (const chunkOrder of ["", "rarest", "random", null, true]) {
    assert.throws(() => new SwarmDownloader({ store, chunkOrder }), { code: "invalid_download_limits" });
  }
});

// Admission control is deliberately bounded and per-download. A temporary
// source failure reduces future job admission, not the integrity criteria.
test("adaptive concurrency grows on verified chunks, backs off on failure and completes safely", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: Object.fromEntries(Array.from({ length: 30 }, (_, index) => [
        `Assets/Adaptive-${index}.bin`, Buffer.alloc(65_536, index + 17),
      ])),
    });
    const bytes = await bytesByHash(fixture);
    let active = 0, peakObserved = 0, callCount = 0, injectedFailures = 0;
    const store = new ChunkStore(path.join(root, "adaptive"));
    const client = fakeClient(fixture, bytes, {
      chunk: async (hash) => {
        active += 1;
        peakObserved = Math.max(active, peakObserved);
        callCount += 1;
        try {
          await new Promise(resolve => setTimeout(resolve, 4));
          if (callCount >= 12 && injectedFailures === 0) {
            injectedFailures += 1;
            throw new TeamForgePeerError("peer_http_error", "transient saturated peer", { retryable: true });
          }
          return bytes.get(hash);
        } finally {
          active -= 1;
        }
      },
    });
    const download = () => new SwarmDownloader({
      store, concurrencyMode: "adaptive", maxConcurrency: 4,
      retryRounds: 1, retryBaseMilliseconds: 1,
      minimumPeerIntervalMilliseconds: 0,
    }).download({
      manifest: fixture.manifest, seeds: [{ id: "source", client }], sessionId: "adaptive",
    });
    const result = await download();
    assert.equal(result.completedChunks, result.totalChunks);
    assert.equal(result.concurrencyControl.mode, "adaptive");
    assert.equal(result.concurrencyControl.startingLimit, 1);
    assert.equal(result.concurrencyControl.ceiling, 4);
    assert(result.concurrencyControl.peakLimit >= 2);
    assert(result.concurrencyControl.peakLimit <= 4);
    assert(result.concurrencyControl.reductions >= 1);
    assert(peakObserved >= 2 && peakObserved <= 4);
    assert.equal(injectedFailures, 1);
    assert(result.failures.some(failure => failure.operation === "chunk"));
    for (const chunk of uniqueManifestChunks(fixture.manifest)) {
      assert(await store.has(chunk.hash, chunk.size, true));
    }
    const resumed = await download();
    assert.equal(resumed.resumedChunks, result.totalChunks);
    assert.equal(resumed.transferredChunks, 0);
    assert.deepEqual(resumed.concurrencyControl, {
      mode: "adaptive", ceiling: 1, startingLimit: 1,
      finalLimit: 1, peakLimit: 1, reductions: 0,
    });
  } finally {
    await cleanup(root);
  }
});

test("fixed concurrency remains default and adaptive option fails closed", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: { "Assets/Control.bin": Buffer.alloc(65_536, 32) },
    });
    const bytes = await bytesByHash(fixture);
    const store = new ChunkStore(path.join(root, "fixed"));
    const defaultMode = new SwarmDownloader({ store, maxConcurrency: 3 });
    assert.equal(defaultMode.concurrencyMode, "fixed");
    const result = await defaultMode.download({
      manifest: fixture.manifest, sessionId: "fixed", seeds: [{ client: fakeClient(fixture, bytes) }],
    });
    assert.deepEqual(result.concurrencyControl, {
      mode: "fixed", ceiling: Math.min(3, result.totalChunks),
      startingLimit: Math.min(3, result.totalChunks),
      finalLimit: Math.min(3, result.totalChunks),
      peakLimit: Math.min(3, result.totalChunks), reductions: 0,
    });
    assert(Object.isFrozen(result.concurrencyControl));
    for (const invalid of ["", null, "network-auto", false, 1]) {
      assert.throws(() => new SwarmDownloader({ store, concurrencyMode: invalid }), {
        code: "invalid_download_limits",
      });
    }
  } finally {
    await cleanup(root);
  }
});

test("adaptive admission waiters cancel without launching more requests after abort", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: {
        "Assets/First.bin": Buffer.alloc(65_536, 1),
        "Assets/Second.bin": Buffer.alloc(65_536, 2),
      },
    });
    const bytes = await bytesByHash(fixture);
    const abort = new AbortController();
    let requested = 0, startRequest;
    const started = new Promise(resolve => { startRequest = resolve; });
    const client = fakeClient(fixture, bytes, {
      chunk: async (hash, size, signal) => {
        requested += 1;
        startRequest();
        return new Promise((_resolve, reject) => {
          if (signal.aborted) {
            reject(new TeamForgePeerError("download_cancelled", "cancelled"));
          } else {
            signal.addEventListener("abort", () =>
              reject(new TeamForgePeerError("download_cancelled", "cancelled")), { once: true });
          }
        });
      },
    });
    const pending = new SwarmDownloader({
      store: new ChunkStore(path.join(root, "abort-adaptive")),
      maxConcurrency: 4, concurrencyMode: "adaptive",
    }).download({
      manifest: fixture.manifest, sessionId: "abort-adaptive",
      seeds: [{ id: "source", client }], signal: abort.signal,
    });
    await started;
    abort.abort();
    await assert.rejects(pending, { code: "download_cancelled" });
    assert.equal(requested, 1, "waiting workers must not admit more chunks after abort");
  } finally {
    await cleanup(root);
  }
});

test("hedged Endgame stores one verified fast winner and cancels slow primary", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: Object.fromEntries(Array.from({ length: 5 }, (_, i) =>
        ["Assets/Endgame-" + i + ".bin", Buffer.alloc(65_536, i + 100)])),
    });
    const bytes = await bytesByHash(fixture);
    const chunks = uniqueManifestChunks(fixture.manifest);
    const tail = chunks.at(-1).hash;
    let blocked = false, slowAborted = 0, stored = 0, announced = 0;
    const destination = new ChunkStore(path.join(root, "endgame-winner"));
    const result = await new SwarmDownloader({
      store: {
        has: (...a) => destination.has(...a),
        deleteInvalid: (...a) => destination.deleteInvalid(...a),
        async put(...a) { stored += 1; return destination.put(...a); },
      },
      endgameMode: "hedged", maxConcurrency: 1, retryRounds: 0,
      onPartialSeed: () => { announced += 1; },
    }).download({
      manifest: fixture.manifest, sessionId: "endgame-winner",
      signal: AbortSignal.timeout(6_000),
      seeds: ["one", "two"].map(id => ({
        id,
        client: fakeClient(fixture, bytes, {
          chunk: (hash, _size, signal) => {
            if (hash !== tail || blocked) return Promise.resolve(bytes.get(hash));
            blocked = true;
            return new Promise((_resolve, reject) => {
              signal.addEventListener("abort", () => {
                slowAborted += 1;
                reject(new TeamForgePeerError("download_cancelled", "hedge loser aborted"));
              }, { once: true });
            });
          },
        }),
      })),
    });
    assert.equal(result.completedChunks, chunks.length);
    assert.equal(result.endgame.mode, "hedged");
    assert.equal(result.endgame.speculativeRequests, 1);
    assert.equal(result.endgame.speculativeWins, 1);
    assert.equal(slowAborted, 1);
    assert.equal(stored, chunks.length);
    assert.equal(announced, chunks.length);
    assert.equal(result.peers.reduce((sum, p) => sum + p.verifiedBytes, 0), result.transferredBytes);
    for (const chunk of chunks) assert(await destination.has(chunk.hash, chunk.size, true));
  } finally { await cleanup(root); }
});

test("hedged Endgame rejects a corrupt secondary and accepts valid slow primary", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: Object.fromEntries(Array.from({ length: 4 }, (_, i) =>
        ["Assets/CorruptHedge-" + i + ".bin", Buffer.alloc(65_536, i + 130)])),
    });
    const bytes = await bytesByHash(fixture);
    const chunks = uniqueManifestChunks(fixture.manifest);
    const tail = chunks.at(-1).hash;
    let calls = 0;
    const result = await new SwarmDownloader({
      store: new ChunkStore(path.join(root, "corrupt-hedge")),
      endgameMode: "hedged", maxConcurrency: 1, retryRounds: 0,
    }).download({
      manifest: fixture.manifest, sessionId: "corrupt-hedge",
      seeds: ["a", "b"].map(id => ({
        id, client: fakeClient(fixture, bytes, {
          chunk: async hash => {
            if (hash !== tail) return bytes.get(hash);
            calls += 1;
            if (calls === 1) {
              await new Promise(resolve => setTimeout(resolve, 300));
              return bytes.get(hash);
            }
            return Buffer.alloc(bytes.get(hash).length, 0xff);
          },
        }),
      })),
    });
    assert.equal(result.completedChunks, chunks.length);
    assert.equal(result.endgame.speculativeRequests, 1);
    assert.equal(result.endgame.speculativeWins, 0);
    assert.equal(result.failures.length, 0);
    assert.equal(result.peers.reduce((sum, p) => sum + p.verifiedBytes, 0), result.transferredBytes);
  } finally { await cleanup(root); }
});

test("Endgame is off by default and never duplicates single-source or fully resumed content", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: Object.fromEntries(Array.from({ length: 3 }, (_, i) =>
        ["Assets/OneSource-" + i + ".bin", Buffer.alloc(65_536, i + 160)])),
    });
    const bytes = await bytesByHash(fixture);
    const chunks = uniqueManifestChunks(fixture.manifest);
    let calls = 0;
    const store = new ChunkStore(path.join(root, "single-endgame"));
    const client = fakeClient(fixture, bytes, {
      chunk: async hash => { calls += 1; return bytes.get(hash); },
    });
    const downloader = new SwarmDownloader({ store, endgameMode: "hedged", maxConcurrency: 1 });
    const sources = [{ id: "same", client }, { id: "same", client }];
    const first = await downloader.download({ manifest: fixture.manifest, sessionId: "single", seeds: sources });
    assert.equal(first.endgame.speculativeRequests, 0);
    assert.equal(calls, chunks.length);
    const resumed = await downloader.download({ manifest: fixture.manifest, sessionId: "single", seeds: sources });
    assert.equal(resumed.resumedChunks, chunks.length);
    assert.equal(resumed.endgame.speculativeRequests, 0);
    assert.equal(calls, chunks.length);
    assert.equal(new SwarmDownloader({ store }).endgameMode, "off");
    for (const mode of ["", "fast", null, false]) {
      assert.throws(() => new SwarmDownloader({ store, endgameMode: mode }),
        { code: "invalid_download_limits" });
    }
  } finally { await cleanup(root); }
});

test("Endgame cancellation settles both requests without storing the tail", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: { "Assets/EndgameCancel.bin": Buffer.alloc(65_536, 191) },
    });
    const bytes = await bytesByHash(fixture);
    const tail = uniqueManifestChunks(fixture.manifest).at(-1).hash;
    let startedHedge;
    const hedgeStarted = new Promise(resolve => { startedHedge = resolve; });
    let requests = 0, writes = 0;
    const store = new ChunkStore(path.join(root, "cancel-endgame"));
    const abort = new AbortController();
    const download = new SwarmDownloader({
      store: {
        has: (...a) => store.has(...a),
        deleteInvalid: (...a) => store.deleteInvalid(...a),
        async put(...a) { writes += 1; return store.put(...a); },
      },
      endgameMode: "hedged", maxConcurrency: 1, retryRounds: 0,
    }).download({
      manifest: fixture.manifest, sessionId: "cancel-endgame", signal: abort.signal,
      seeds: ["a", "b"].map(id => ({
        id, client: fakeClient(fixture, bytes, {
          chunk: (hash, _size, signal) => {
            if (hash !== tail) return Promise.resolve(bytes.get(hash));
            requests += 1;
            if (requests === 2) startedHedge();
            return new Promise((_resolve, reject) => {
              signal.addEventListener("abort", () => reject(
                new TeamForgePeerError("download_cancelled", "Endgame cancelled")),
              { once: true });
            });
          },
        }),
      })),
    });
    try {
      await Promise.race([hedgeStarted, new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error("No hedge started")), 5_000))]);
      abort.abort();
      await assert.rejects(download, { code: "download_cancelled" });
      assert.equal(requests, 2);
      const atReturn = writes;
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(writes, atReturn);
      assert.equal(await store.has(tail), false);
    } finally {
      abort.abort();
      await download.catch(() => {});
    }
  } finally { await cleanup(root); }
});

test("Endgame accounts for failed hedges and falls back to another verified source", async () => {
  const root = await temporaryRoot();
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: Object.fromEntries(Array.from({ length: 3 }, (_, i) =>
        ["Assets/FallbackHedge-" + i + ".bin", Buffer.alloc(65_536, i + 210)])),
    });
    const bytes = await bytesByHash(fixture);
    const tail = uniqueManifestChunks(fixture.manifest).at(-1).hash;
    let tailCalls = 0;
    const result = await new SwarmDownloader({
      store: new ChunkStore(path.join(root, "failed-hedge")),
      maxConcurrency: 1, retryRounds: 0, endgameMode: "hedged",
    }).download({
      manifest: fixture.manifest, sessionId: "failed-hedge",
      seeds: ["one", "two"].map(id => ({
        id, client: fakeClient(fixture, bytes, {
          chunk: async hash => {
            if (hash !== tail) return bytes.get(hash);
            tailCalls += 1;
            if (tailCalls === 1) {
              await new Promise(resolve => setTimeout(resolve, 260));
              return Buffer.alloc(bytes.get(hash).length, 0xff);
            }
            if (tailCalls === 2) return Buffer.alloc(bytes.get(hash).length, 0xff);
            return bytes.get(hash);
          },
        }),
      })),
    });
    assert.equal(result.completedChunks, result.totalChunks);
    assert.equal(tailCalls, 3);
    assert.equal(result.endgame.speculativeRequests, 1);
    assert.equal(result.endgame.speculativeWins, 0);
    assert.equal(result.failures.filter(failure => failure.operation === "chunk").length, 1);
    assert.equal(result.peers.reduce((sum, peer) => sum + peer.verifiedBytes, 0),
      result.transferredBytes);
  } finally {
    await cleanup(root);
  }
});
