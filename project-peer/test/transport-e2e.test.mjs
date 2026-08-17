import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ChunkStore } from "../src/content-store.mjs";
import { DirectTransferServer, createTransferToken } from "../src/direct-transfer-server.mjs";
import { uniqueManifestChunks } from "../src/manifest.mjs";
import { SwarmDownloader } from "../src/swarm-downloader.mjs";
import { cleanup, publicationFixture, temporaryRoot } from "./helpers.mjs";

const childFixture = fileURLToPath(new URL("../support/download-child.mjs", import.meta.url));

function requestHeaders(fixture, transferToken) {
  return {
    authorization: `Bearer ${transferToken}`,
    "x-teamforge-project-uuid": fixture.projectUuid,
    "x-teamforge-manifest-hash": fixture.manifest.manifestHash,
    "x-teamforge-session-id": "editors",
  };
}

async function startSeed(fixture, { store = fixture.store, ...overrides } = {}) {
  const transferToken = createTransferToken();
  const server = new DirectTransferServer({
    projectUuid: fixture.projectUuid,
    sessionId: "editors",
    manifest: fixture.manifest,
    descriptor: fixture.descriptor,
    store,
    transferToken,
    ...overrides,
  });
  const bound = await server.start();
  return { server, transferToken, endpoint: bound.endpoint };
}

async function within(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function spawnDownloadChild(configurationPath) {
  const child = fork(childFixture, [configurationPath], {
    cwd: path.dirname(configurationPath),
    execPath: process.execPath,
    execArgv: [],
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (value) => { output += value; });
  child.stderr.on("data", (value) => { output += value; });
  return { child, output: () => output.trim() };
}

function waitForChildMessage(running, predicate, milliseconds, description) {
  const { child } = running;
  return within(new Promise((resolve, reject) => {
    const finish = (callback, value) => {
      child.off("message", onMessage);
      child.off("error", onError);
      child.off("exit", onExit);
      callback(value);
    };
    const onMessage = (message) => {
      if (message?.type === "error") {
        finish(reject, new Error(`Download child failed (${message.code}): ${message.message}`));
      } else if (predicate(message)) {
        finish(resolve, message);
      }
    };
    const onError = (error) => finish(reject, error);
    const onExit = (code, signal) => finish(
      reject,
      new Error(`Download child exited before ${description}: code=${code} signal=${signal} ${running.output()}`),
    );
    child.on("message", onMessage);
    child.once("error", onError);
    child.once("exit", onExit);
  }), milliseconds, `Timed out waiting for download child to ${description}.`);
}

async function terminateChild(running) {
  if (!running || running.child.exitCode !== null || running.child.signalCode !== null) {
    return;
  }
  const exited = once(running.child, "exit");
  running.child.kill();
  await within(exited, 2_000, `Download child did not terminate. ${running.output()}`);
}

test("real HTTP 503 transfer_busy is retried for a Chunk on one loopback Seed", { timeout: 5_000 }, async () => {
  const root = await temporaryRoot();
  let seed;
  let releaseHeldRead;
  let heldRequest;
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: { "Assets/Busy.bin": Buffer.alloc(65_536, 41) },
    });
    const destination = new ChunkStore(path.join(root, "destination"));
    let heldReadStarted;
    const heldRead = new Promise((resolve) => { heldReadStarted = resolve; });
    const release = new Promise((resolve) => { releaseHeldRead = resolve; });
    let reads = 0;
    const blockingStore = {
      inventory: (...arguments_) => fixture.store.inventory(...arguments_),
      async read(...arguments_) {
        reads += 1;
        if (reads === 1) {
          heldReadStarted();
          await release;
        }
        return fixture.store.read(...arguments_);
      },
    };
    seed = await startSeed(fixture, { store: blockingStore, maxConcurrentRequests: 1 });
    const heldChunk = uniqueManifestChunks(fixture.manifest)[0];
    let startedHold = false;
    const triggeringDestination = {
      async has(...arguments_) {
        if (!startedHold) {
          startedHold = true;
          heldRequest = fetch(`${seed.endpoint}/chunks/${heldChunk.hash}`, {
            headers: requestHeaders(fixture, seed.transferToken),
          });
          await heldRead;
        }
        return destination.has(...arguments_);
      },
      put: (...arguments_) => destination.put(...arguments_),
      deleteInvalid: (...arguments_) => destination.deleteInvalid(...arguments_),
    };
    const diagnostics = [];
    const result = await new SwarmDownloader({
      store: triggeringDestination,
      maxConcurrency: 1,
      retryRounds: 2,
      retryBaseMilliseconds: 5,
      retryMaximumMilliseconds: 500,
      retryJitterRatio: 0,
      minimumPeerIntervalMilliseconds: 0,
      onDiagnostic: (value) => {
        diagnostics.push(value);
        if (value.operation === "chunk" && value.httpStatus === 503) {
          releaseHeldRead();
        }
      },
    }).download({
      manifest: fixture.manifest,
      seeds: [{ id: "busy-seed", endpoint: seed.endpoint, transferToken: seed.transferToken }],
      sessionId: "editors",
    });
    const heldResponse = await heldRequest;
    assert.equal(heldResponse.status, 200);
    await heldResponse.arrayBuffer();
    const busy = diagnostics.find((value) =>
      value.operation === "chunk" && value.httpStatus === 503);
    assert.equal(busy?.serverErrorCode, "transfer_busy");
    assert.equal(busy?.retryable, true);
    assert.equal(busy?.retryInMilliseconds, 100);
    assert.equal(result.completedChunks, uniqueManifestChunks(fixture.manifest).length);
  } finally {
    releaseHeldRead?.();
    await heldRequest?.catch(() => {});
    await seed?.server.stop();
    await cleanup(root);
  }
});

test("real TCP RST during a Chunk is classified and retried on loopback", { timeout: 5_000 }, async () => {
  const root = await temporaryRoot();
  let seed;
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: { "Assets/Reset.bin": Buffer.alloc(65_536, 42) },
    });
    seed = await startSeed(fixture);
    let resetCount = 0;
    const resetFirstChunk = (request) => {
      const pathname = new URL(request.url ?? "/", "http://teamforge.invalid").pathname;
      if (resetCount === 0 && pathname.includes("/chunks/")) {
        resetCount += 1;
        request.socket.resetAndDestroy();
      }
    };
    seed.server.httpServer.prependListener("request", resetFirstChunk);
    const diagnostics = [];
    const result = await new SwarmDownloader({
      store: new ChunkStore(path.join(root, "destination")),
      maxConcurrency: 1,
      retryRounds: 1,
      retryBaseMilliseconds: 5,
      retryMaximumMilliseconds: 50,
      retryJitterRatio: 0,
      minimumPeerIntervalMilliseconds: 0,
      onDiagnostic: (value) => diagnostics.push(value),
    }).download({
      manifest: fixture.manifest,
      seeds: [{ id: "reset-seed", endpoint: seed.endpoint, transferToken: seed.transferToken }],
      sessionId: "editors",
    });
    seed.server.httpServer.off("request", resetFirstChunk);
    const reset = diagnostics.find((value) =>
      value.operation === "chunk" && value.errorKind === "peer_network_error");
    assert.equal(resetCount, 1);
    assert(["ECONNRESET", "UND_ERR_SOCKET"].includes(reset?.networkCode),
      `Expected a reset network code, received ${reset?.networkCode}.`);
    assert.equal(reset.retryable, true);
    assert.equal(result.completedChunks, uniqueManifestChunks(fixture.manifest).length);
  } finally {
    await seed?.server.stop();
    await cleanup(root);
  }
});

test("real stalled Chunk response times out and succeeds on the retry", { timeout: 5_000 }, async () => {
  const root = await temporaryRoot();
  let seed;
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: { "Assets/Timeout.bin": Buffer.alloc(65_536, 43) },
    });
    let readCalls = 0;
    const stallingStore = {
      inventory: (...arguments_) => fixture.store.inventory(...arguments_),
      async read(...arguments_) {
        readCalls += 1;
        if (readCalls === 1) {
          await new Promise(() => {});
        }
        return fixture.store.read(...arguments_);
      },
    };
    seed = await startSeed(fixture, { store: stallingStore });
    const diagnostics = [];
    const result = await new SwarmDownloader({
      store: new ChunkStore(path.join(root, "destination")),
      maxConcurrency: 1,
      timeoutMilliseconds: 100,
      retryRounds: 1,
      retryBaseMilliseconds: 5,
      retryMaximumMilliseconds: 50,
      retryJitterRatio: 0,
      minimumPeerIntervalMilliseconds: 0,
      onDiagnostic: (value) => diagnostics.push(value),
    }).download({
      manifest: fixture.manifest,
      seeds: [{ id: "timeout-seed", endpoint: seed.endpoint, transferToken: seed.transferToken }],
      sessionId: "editors",
    });
    const timeout = diagnostics.find((value) =>
      value.operation === "chunk" && value.errorKind === "peer_timeout");
    assert(timeout, "The real stalled response was not classified as a peer timeout.");
    assert.equal(timeout.retryable, true);
    assert(readCalls >= 2, "The timed-out Chunk was not requested again.");
    assert.equal(result.completedChunks, uniqueManifestChunks(fixture.manifest).length);
  } finally {
    await seed?.server.stop();
    await cleanup(root);
  }
});

test("Seed A actually stops mid-download and Seed B completes the remaining Chunks", { timeout: 5_000 }, async () => {
  const root = await temporaryRoot();
  let seedA;
  let seedB;
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: Object.fromEntries(Array.from({ length: 6 }, (_, index) => [
        `Assets/Failover-${index}.bin`, Buffer.alloc(65_536, index + 51),
      ])),
    });
    const chunks = uniqueManifestChunks(fixture.manifest);
    assert(chunks.length >= 6);
    let readsA = 0;
    let readsB = 0;
    seedA = await startSeed(fixture, {
      store: {
        inventory: (...arguments_) => fixture.store.inventory(...arguments_),
        async read(...arguments_) {
          readsA += 1;
          return fixture.store.read(...arguments_);
        },
      },
    });
    seedB = await startSeed(fixture, {
      store: {
        inventory: (...arguments_) => fixture.store.inventory(...arguments_),
        async read(...arguments_) {
          readsB += 1;
          await new Promise((resolve) => setTimeout(resolve, 20));
          return fixture.store.read(...arguments_);
        },
      },
    });
    let stoppedA = false;
    const diagnostics = [];
    const result = await new SwarmDownloader({
      store: new ChunkStore(path.join(root, "destination")),
      maxConcurrency: 1,
      timeoutMilliseconds: 500,
      retryRounds: 0,
      retryBaseMilliseconds: 5,
      retryMaximumMilliseconds: 50,
      retryJitterRatio: 0,
      minimumPeerIntervalMilliseconds: 0,
      onDiagnostic: (value) => diagnostics.push(value),
      onPartialSeed: async ({ sourceSeed }) => {
        if (sourceSeed === "A" && !stoppedA) {
          stoppedA = true;
          await seedA.server.stop();
        }
      },
    }).download({
      manifest: fixture.manifest,
      seeds: [
        { id: "A", endpoint: seedA.endpoint, transferToken: seedA.transferToken },
        { id: "B", endpoint: seedB.endpoint, transferToken: seedB.transferToken },
      ],
      sessionId: "editors",
    });
    const failover = diagnostics.find((value) =>
      value.operation === "chunk" && value.peerId === "A" && value.switchedPeer);
    assert.equal(stoppedA, true);
    assert.equal(seedA.server.httpServer.listening, false);
    assert(readsA >= 1, "Seed A did not serve an initial verified Chunk.");
    assert(readsB >= 1, "Seed B did not serve the remaining Chunks.");
    assert.equal(failover?.errorKind, "peer_network_error");
    assert.equal(result.completedChunks, chunks.length);
  } finally {
    await seedA?.server.stop();
    await seedB?.server.stop();
    await cleanup(root);
  }
});

test("terminated receiver process restarts and reuses its three verified Chunks", { timeout: 10_000 }, async () => {
  const root = await temporaryRoot();
  let seed;
  let interrupted;
  let restarted;
  try {
    const fixture = await publicationFixture(root, {
      assetFiles: Object.fromEntries(Array.from({ length: 8 }, (_, index) => [
        `Assets/Process-Resume-${index}.bin`, Buffer.alloc(65_536, index + 61),
      ])),
    });
    const chunks = uniqueManifestChunks(fixture.manifest);
    const reads = new Map();
    seed = await startSeed(fixture, {
      store: {
        inventory: (...arguments_) => fixture.store.inventory(...arguments_),
        async read(hash, ...arguments_) {
          reads.set(hash, (reads.get(hash) ?? 0) + 1);
          return fixture.store.read(hash, ...arguments_);
        },
      },
    });
    const destinationRoot = path.join(root, "receiver-chunks");
    const commonConfiguration = {
      destinationRoot,
      endpoint: seed.endpoint,
      transferToken: seed.transferToken,
      sessionId: "editors",
      manifest: fixture.manifest,
    };
    const interruptedConfiguration = path.join(root, "interrupted.json");
    await writeFile(interruptedConfiguration, JSON.stringify({
      ...commonConfiguration,
      pauseAfterNewChunks: 3,
    }));
    interrupted = spawnDownloadChild(interruptedConfiguration);
    const paused = await waitForChildMessage(
      interrupted,
      (message) => message?.type === "paused",
      4_000,
      "persist three verified Chunks",
    );
    assert.equal(paused.hashes.length, 3);
    const destination = new ChunkStore(destinationRoot);
    for (const hash of paused.hashes) {
      const chunk = chunks.find((candidate) => candidate.hash === hash);
      assert(chunk);
      assert.equal(await destination.has(hash, chunk.size, true), true);
    }
    const readsAtTermination = new Map(paused.hashes.map((hash) => [hash, reads.get(hash)]));
    await terminateChild(interrupted);
    assert.equal(interrupted.child.killed, true);
    interrupted = null;

    const restartedConfiguration = path.join(root, "restarted.json");
    await writeFile(restartedConfiguration, JSON.stringify({
      ...commonConfiguration,
      pauseAfterNewChunks: 0,
    }));
    restarted = spawnDownloadChild(restartedConfiguration);
    const exited = once(restarted.child, "exit");
    const completed = await waitForChildMessage(
      restarted,
      (message) => message?.type === "completed",
      6_000,
      "complete the resumed download",
    );
    const [exitCode] = await within(exited, 2_000, `Restarted child did not exit. ${restarted.output()}`);
    assert.equal(exitCode, 0, restarted.output());
    assert.equal(completed.resumedChunks, 3);
    assert.equal(completed.completedChunks, chunks.length);
    for (const hash of paused.hashes) {
      assert.equal(reads.get(hash), readsAtTermination.get(hash),
        `Restarted receiver downloaded verified Chunk ${hash.slice(0, 12)} again.`);
    }
    restarted = null;
  } finally {
    await terminateChild(interrupted).catch(() => {});
    await terminateChild(restarted).catch(() => {});
    await seed?.server.stop();
    await cleanup(root);
  }
});
