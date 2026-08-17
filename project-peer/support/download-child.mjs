import { readFile } from "node:fs/promises";
import { ChunkStore } from "../src/content-store.mjs";
import { SwarmDownloader } from "../src/swarm-downloader.mjs";

if (typeof process.send !== "function") {
  throw new Error("The download child fixture requires an IPC channel.");
}

const configurationPath = process.argv[2];
const configuration = JSON.parse(await readFile(configurationPath, "utf8"));
const newHashes = [];

async function send(message) {
  await new Promise((resolve, reject) => {
    process.send(message, (error) => error ? reject(error) : resolve());
  });
}

try {
  const result = await new SwarmDownloader({
    store: new ChunkStore(configuration.destinationRoot),
    maxConcurrency: 1,
    timeoutMilliseconds: 1_000,
    retryRounds: 1,
    retryBaseMilliseconds: 5,
    retryMaximumMilliseconds: 50,
    retryJitterRatio: 0,
    minimumPeerIntervalMilliseconds: 0,
    onPartialSeed: async ({ hash }) => {
      newHashes.push(hash);
      await send({ type: "partial", hash, count: newHashes.length });
      if (configuration.pauseAfterNewChunks > 0 &&
          newHashes.length === configuration.pauseAfterNewChunks) {
        await send({ type: "paused", hashes: [...newHashes] });
        setInterval(() => {}, 1_000);
        await new Promise(() => {});
      }
    },
  }).download({
    manifest: configuration.manifest,
    seeds: [{
      id: "loopback-seed",
      endpoint: configuration.endpoint,
      transferToken: configuration.transferToken,
    }],
    sessionId: configuration.sessionId,
  });
  await send({
    type: "completed",
    completedChunks: result.completedChunks,
    resumedChunks: result.resumedChunks,
    newHashes,
  });
  process.disconnect();
} catch (error) {
  await send({
    type: "error",
    code: error?.code ?? "child_failure",
    message: error?.message ?? String(error),
  }).catch(() => {});
  process.exitCode = 1;
  process.disconnect();
}
