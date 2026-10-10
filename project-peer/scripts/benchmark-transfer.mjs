import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { ChunkStore } from "../src/content-store.mjs";
import { createDescriptor } from "../src/descriptor.mjs";
import { DirectTransferClient } from "../src/direct-transfer-client.mjs";
import { DirectTransferServer, createTransferToken } from "../src/direct-transfer-server.mjs";
import { TeamForgePeerError } from "../src/errors.mjs";
import { generateIdentity } from "../src/identity.mjs";
import { buildManifest, uniqueManifestChunks } from "../src/manifest.mjs";
import { SwarmDownloader } from "../src/swarm-downloader.mjs";

const MIB = 1_048_576;
const AGGREGATE_BYTES_PER_SECOND = 8 * MIB;
const CASES = [
  { name: "single-seed", seeds: 1 },
  { name: "two-seeds", seeds: 2 },
  { name: "two-seeds-resume", seeds: 2, resume: true },
  { name: "two-seeds-source-loss", seeds: 2, sourceLoss: true },
];

async function createFixture(root, assetBytes) {
  const projectRoot = path.join(root, "project");
  for (const directory of ["Assets", "Packages", "ProjectSettings"]) {
    await mkdir(path.join(projectRoot, directory), { recursive: true });
  }
  const payload = Buffer.alloc(assetBytes, 0x5a);
  for (let offset = 0; offset < payload.length; offset += 65_536) {
    payload.writeUInt32LE(offset / 65_536, offset);
  }
  await writeFile(path.join(projectRoot, "Assets", "Benchmark.bin"), payload);
  await writeFile(path.join(projectRoot, "Packages", "manifest.json"), '{"dependencies":{}}\n');
  await writeFile(path.join(projectRoot, "Packages", "packages-lock.json"), '{"dependencies":{}}\n');
  await writeFile(path.join(projectRoot, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.3.21f1\n");
  const projectUuid = randomUUID();
  const store = new ChunkStore(path.join(root, "source-chunks"));
  const { manifest } = await buildManifest({
    projectRoot, projectUuid, baselineRevision: 1, chunkSize: 65_536, store,
  });
  const owner = generateIdentity("Loopback Benchmark");
  const descriptor = createDescriptor({
    projectId: "loopback-benchmark", projectUuid, baselineRevision: 1,
    manifestHash: manifest.manifestHash, unityVersion: "6000.3.21f1", ownerIdentity: owner,
  });
  return { store, manifest, descriptor, projectUuid, owner };
}

async function runCase(root, fixture, scenario, iteration) {
  const sessionId = "loopback-benchmark";
  const transferToken = createTransferToken();
  const servers = [];
  const destination = new ChunkStore(path.join(root, "destination"));
  let injectedFailures = 0;
  try {
    const seeds = [];
    for (let index = 0; index < scenario.seeds; index += 1) {
      const server = new DirectTransferServer({
        host: "127.0.0.1", port: 0, sessionId, transferToken,
        projectUuid: fixture.projectUuid, manifest: fixture.manifest,
        descriptor: fixture.descriptor, store: fixture.store,
        rateLimitPerSecond: 10_000,
        maxBytesPerSecond: AGGREGATE_BYTES_PER_SECOND / scenario.seeds,
      });
      servers.push(server);
      const address = await server.start();
      const client = new DirectTransferClient({
        endpoint: address.endpoint, sessionId, transferToken,
        projectUuid: fixture.projectUuid, manifestHash: fixture.manifest.manifestHash,
      });
      if (scenario.sourceLoss && index === 0) {
        // Metadata uses real HTTP; only this source's chunk availability is injected.
        client.chunk = async () => {
          injectedFailures += 1;
          throw new TeamForgePeerError("benchmark_source_unavailable", "Injected source loss.");
        };
      }
      seeds.push({ id: "seed-" + (index + 1), client });
    }
    const signal = AbortSignal.timeout(30_000);
    const downloader = new SwarmDownloader({ store: destination });
    await downloader.discover({
      seeds, projectId: "loopback-benchmark", projectUuid: fixture.projectUuid,
      manifestHash: fixture.manifest.manifestHash, sessionId,
      trustedOwnerKeyId: fixture.owner.keyId, signal,
    });
    const chunks = uniqueManifestChunks(fixture.manifest);
    if (scenario.resume) {
      for (const chunk of chunks.slice(0, Math.floor(chunks.length / 4))) {
        await destination.put(await fixture.store.read(chunk.hash, chunk.size), chunk.hash);
      }
    }
    const started = performance.now();
    const result = await downloader.download({ manifest: fixture.manifest, seeds, sessionId, signal });
    const elapsedMilliseconds = performance.now() - started;
    for (const chunk of chunks) await destination.read(chunk.hash, chunk.size);
    assert.equal(result.completedChunks, chunks.length);
    assert.equal(result.transferredBytes + result.resumedBytes, result.totalBytes);
    assert.equal(result.peers.reduce((sum, peer) => sum + peer.verifiedBytes, 0), result.transferredBytes);
    if (scenario.sourceLoss) assert.ok(injectedFailures > 0);
    return {
      scenario: scenario.name, iteration, elapsedMilliseconds,
      transferredBytesPerSecond: elapsedMilliseconds > 0
        ? Math.round(result.transferredBytes * 1_000 / elapsedMilliseconds) : 0,
      transferredBytes: result.transferredBytes, resumedBytes: result.resumedBytes,
      uniqueBytes: result.totalBytes, verifiedChunks: result.completedChunks,
      failureCount: result.failures.length, injectedFailures,
      integrityVerified: true,
      peers: result.peers.map(({ id, chunkAttempts, verifiedBytes,
        successfulRequestMilliseconds, requestServiceBytesPerSecond }) => ({
        id, chunkAttempts, verifiedBytes, successfulRequestMilliseconds, requestServiceBytesPerSecond,
      })),
    };
  } finally {
    await Promise.all(servers.map((server) => server.stop()));
    await rm(destination.root, { recursive: true, force: true });
  }
}

export async function runTransferBenchmark({ assetBytes = 8 * MIB, iterations = 3 } = {}) {
  assert.ok(Number.isInteger(assetBytes) && assetBytes >= 262_144 && assetBytes <= 32 * MIB,
    "assetBytes must be an integer between 256 KiB and 32 MiB");
  assert.ok(Number.isInteger(iterations) && iterations >= 1 && iterations <= 5,
    "iterations must be an integer between 1 and 5");
  const root = await mkdtemp(path.join(tmpdir(), "teamforge-transfer-benchmark-"));
  try {
    const fixture = await createFixture(root, assetBytes);
    const runs = [];
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      // Rotate order to reduce systematic first-run/cache bias; no performance pass threshold.
      for (let offset = 0; offset < CASES.length; offset += 1) {
        runs.push(await runCase(root, fixture, CASES[(offset + iteration) % CASES.length], iteration + 1));
      }
    }
    return {
      schemaVersion: 1, scope: "loopback-diagnostic",
      environment: { node: process.version, platform: process.platform, architecture: process.arch },
      configuration: {
        assetBytes, iterations, chunkBytes: 65_536, concurrency: 4,
        aggregateOfferedBytesPerSecond: AGGREGATE_BYTES_PER_SECOND,
        resumePreload: "first quarter of unique chunks",
        sourceLoss: "client-injected chunk unavailability; surviving source uses real HTTP",
      },
      runs,
      summary: CASES.map(({ name }) => {
        const times = runs.filter((run) => run.scenario === name)
          .map((run) => run.elapsedMilliseconds).sort((left, right) => left - right);
        const middle = Math.floor(times.length / 2);
        const median = times.length % 2 ? times[middle] : (times[middle - 1] + times[middle]) / 2;
        return { scenario: name, medianElapsedMilliseconds: median };
      }),
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    let assetBytes = 8 * MIB;
    let iterations = 3;
    for (let index = 0; index < args.length; index += 1) {
      const option = args[index];
      if (option === "--smoke") { assetBytes = 262_144; iterations = 1; }
      else if (option === "--size-mib") assetBytes = Number(args[++index]) * MIB;
      else if (option === "--iterations") iterations = Number(args[++index]);
      else if (option === "--help") {
        console.info("Usage: npm run benchmark:transfer -- [--smoke] [--size-mib 1..32] [--iterations 1..5]");
        process.exit(0);
      } else throw new Error("Unknown benchmark option: " + option);
    }
    console.info(JSON.stringify(await runTransferBenchmark({ assetBytes, iterations }), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
