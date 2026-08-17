import { DirectTransferClient } from "./direct-transfer-client.mjs";
import { validateDescriptor } from "./descriptor.mjs";
import { uniqueManifestChunks, validateManifest } from "./manifest.mjs";
import { sha256 } from "./hash.mjs";
import { fail, TeamForgePeerError } from "./errors.mjs";
import { DOWNLOAD_STATES, SHA256_PATTERN } from "./constants.mjs";
import {
  assertProjectTransferSource,
  MAXIMUM_SOURCE_RETRY_AFTER_MILLISECONDS,
  transferSourceErrorInfo,
} from "./transfer-source.mjs";
import { LEGACY_TRANSFER_DEFAULTS } from "./policy-profile.mjs";

function seedId(seed, index) {
  return seed.id ?? seed.connectionId ?? seed.endpoint ?? `seed-${index}`;
}

function makeClient(seed, options) {
  return assertProjectTransferSource(seed.client ?? new DirectTransferClient({
    endpoint: seed.endpoint,
    transferToken: seed.transferToken,
    sessionId: options.sessionId,
    projectUuid: options.projectUuid,
    manifestHash: options.manifestHash,
    timeoutMilliseconds: options.timeoutMilliseconds,
  }));
}

function safeEndpoint(seed, client) {
  const source = seed.endpoint ?? client?.endpoint?.toString?.() ?? "";
  try {
    const url = new URL(source);
    if (!/^https?:$/u.test(url.protocol) || url.username || url.password) {
      return "";
    }
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function validateInventory(inventory, projectUuid, manifestHash, allowed) {
  if (!inventory || inventory.projectUuid !== projectUuid || inventory.manifestHash !== manifestHash ||
      !Array.isArray(inventory.chunks)) {
    fail("invalid_peer_inventory", "Peer inventory identity is invalid.");
  }
  const result = new Set();
  for (const hash of inventory.chunks) {
    if (!SHA256_PATTERN.test(hash) || !allowed.has(hash)) {
      fail("invalid_peer_inventory", "Peer inventory contains an invalid or foreign chunk hash.");
    }
    result.add(hash);
  }
  return result;
}

function isRetryable(error) {
  return transferSourceErrorInfo(error).retryable;
}

function errorRecord(error, { peer, attempt, operation, chunkHash = "" }) {
  const sourceError = transferSourceErrorInfo(error);
  return {
    operation,
    chunkHashPrefix: chunkHash.slice(0, 12),
    peerId: peer.id,
    peerEndpoint: peer.endpoint,
    errorKind: sourceError.errorKind,
    ...sourceError.diagnostics,
    retryable: sourceError.retryable,
    attempt,
  };
}

function peerScore(peer, rotation, peerCount, now) {
  const cooling = peer.cooldownUntil > now ? 1 : 0;
  const score = peer.failures * 1_000_000 + peer.inFlight * 100_000 + peer.latencyMilliseconds;
  const tie = (peer.index - rotation + peerCount) % peerCount;
  return { score, tie, cooling, cooldownUntil: peer.cooldownUntil };
}

function orderedPeers(candidates, rotation, peerCount) {
  const now = Date.now();
  return [...candidates].sort((left, right) => {
    const leftValue = peerScore(left, rotation, peerCount, now);
    const rightValue = peerScore(right, rotation, peerCount, now);
    if (leftValue.cooling !== rightValue.cooling) {
      return leftValue.cooling - rightValue.cooling;
    }
    if (leftValue.cooling && leftValue.cooldownUntil !== rightValue.cooldownUntil) {
      return leftValue.cooldownUntil - rightValue.cooldownUntil;
    }
    return leftValue.score - rightValue.score || leftValue.tie - rightValue.tie;
  });
}

export class SwarmDownloader {
  constructor({
    store,
    maxConcurrency = LEGACY_TRANSFER_DEFAULTS.maxConcurrency,
    timeoutMilliseconds = LEGACY_TRANSFER_DEFAULTS.timeoutMilliseconds,
    retryRounds = LEGACY_TRANSFER_DEFAULTS.retryRounds,
    retryBaseMilliseconds = LEGACY_TRANSFER_DEFAULTS.retryBaseMilliseconds,
    retryMaximumMilliseconds = LEGACY_TRANSFER_DEFAULTS.retryMaximumMilliseconds,
    retryJitterRatio = LEGACY_TRANSFER_DEFAULTS.retryJitterRatio,
    minimumPeerIntervalMilliseconds = LEGACY_TRANSFER_DEFAULTS.minimumPeerIntervalMilliseconds,
    onProgress = () => {},
    onDiagnostic = () => {},
    onPartialSeed = () => {},
    random = Math.random,
    sleep = undefined,
  }) {
    if (!store || typeof store.put !== "function" || typeof store.has !== "function") {
      fail("invalid_chunk_store", "Swarm downloader requires a ChunkStore.");
    }
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 64 ||
        !Number.isInteger(retryRounds) || retryRounds < 0 || retryRounds > 10 ||
        !Number.isInteger(retryBaseMilliseconds) || retryBaseMilliseconds < 1 || retryBaseMilliseconds > 60_000 ||
        !Number.isInteger(retryMaximumMilliseconds) || retryMaximumMilliseconds < retryBaseMilliseconds ||
        retryMaximumMilliseconds > 60_000 ||
        typeof retryJitterRatio !== "number" || retryJitterRatio < 0 || retryJitterRatio > 0.5 ||
        !Number.isInteger(minimumPeerIntervalMilliseconds) || minimumPeerIntervalMilliseconds < 0 ||
        minimumPeerIntervalMilliseconds > 1_000 || typeof random !== "function" ||
        (sleep !== undefined && typeof sleep !== "function")) {
      fail("invalid_download_limits", "Swarm concurrency, pacing, or retry limits are invalid.");
    }
    this.store = store;
    this.maxConcurrency = maxConcurrency;
    this.timeoutMilliseconds = timeoutMilliseconds;
    this.retryRounds = retryRounds;
    this.maxAttempts = retryRounds + 1;
    this.retryBaseMilliseconds = retryBaseMilliseconds;
    this.retryMaximumMilliseconds = retryMaximumMilliseconds;
    this.retryJitterRatio = retryJitterRatio;
    this.minimumPeerIntervalMilliseconds = minimumPeerIntervalMilliseconds;
    this.onProgress = onProgress;
    this.onDiagnostic = onDiagnostic;
    this.onPartialSeed = onPartialSeed;
    this.random = random;
    this.customSleep = sleep;
  }

  #peer(seed, index, options) {
    const client = makeClient(seed, options);
    return {
      id: seedId(seed, index),
      endpoint: safeEndpoint(seed, client),
      index,
      client,
      inventory: null,
      inventoryFailure: null,
      permanentFailure: false,
      successes: 0,
      failures: 0,
      inFlight: 0,
      latencyMilliseconds: 0,
      cooldownUntil: 0,
      nextRequestAt: 0,
      pacingTail: Promise.resolve(),
    };
  }

  async #sleep(milliseconds, signal = undefined) {
    const wait = Math.max(0, Math.ceil(milliseconds));
    if (wait === 0) {
      return;
    }
    if (signal?.aborted) {
      throw new TeamForgePeerError("download_cancelled", "Project download was cancelled.");
    }
    if (this.customSleep) {
      await this.customSleep(wait);
      if (signal?.aborted) {
        throw new TeamForgePeerError("download_cancelled", "Project download was cancelled.");
      }
      return;
    }
    await new Promise((resolve, reject) => {
      const timer = setTimeout(finish, wait);
      function finish() {
        signal?.removeEventListener("abort", abort);
        resolve();
      }
      function abort() {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        reject(new TeamForgePeerError("download_cancelled", "Project download was cancelled."));
      }
      signal?.addEventListener("abort", abort, { once: true });
    });
  }

  async #reservePeer(peer, signal = undefined) {
    const previous = peer.pacingTail;
    let release;
    peer.pacingTail = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      const waitUntil = Math.max(peer.cooldownUntil, peer.nextRequestAt);
      await this.#sleep(Math.max(0, waitUntil - Date.now()), signal);
      peer.nextRequestAt = Date.now() + this.minimumPeerIntervalMilliseconds;
    } finally {
      release();
    }
  }

  #retryDelay(error, attempt) {
    const exponential = Math.min(
      this.retryMaximumMilliseconds,
      this.retryBaseMilliseconds * (2 ** Math.max(0, attempt - 1)),
    );
    const jitter = exponential * this.retryJitterRatio * ((this.random() * 2) - 1);
    const backoff = Math.min(
      this.retryMaximumMilliseconds,
      Math.max(1, Math.round(exponential + jitter)),
    );
    const retryAfter = Math.min(
      MAXIMUM_SOURCE_RETRY_AFTER_MILLISECONDS,
      transferSourceErrorInfo(error).retryAfterMilliseconds,
    );
    return Math.max(backoff, retryAfter);
  }

  #diagnostic(value) {
    try {
      this.onDiagnostic(Object.freeze({ ...value }));
    } catch {
      // Diagnostics must never alter transfer correctness.
    }
  }

  #recordFailure(error, context) {
    const record = errorRecord(error, context);
    this.#diagnostic(record);
    return record;
  }

  async #singlePeerOperation(peer, operation, callback, signal = undefined) {
    let lastError;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        await this.#reservePeer(peer, signal);
        return await callback();
      } catch (error) {
        if (error?.code === "download_cancelled") throw error;
        lastError = error;
        peer.failures += 1;
        const retryable = isRetryable(error);
        const retryInMilliseconds = retryable && attempt < this.maxAttempts
          ? this.#retryDelay(error, attempt)
          : 0;
        if (retryInMilliseconds > 0) {
          peer.cooldownUntil = Math.max(peer.cooldownUntil, Date.now() + retryInMilliseconds);
        }
        this.#diagnostic({
          ...errorRecord(error, { peer, attempt, operation }),
          maxAttempts: this.maxAttempts,
          retryInMilliseconds,
          switchedPeer: false,
          resumedChunks: 0,
          remainingBytes: 0,
        });
        if (!retryable || attempt >= this.maxAttempts) {
          throw error;
        }
      }
    }
    throw lastError;
  }

  async discover({
    seeds, projectId, projectUuid, manifestHash, sessionId, trustedOwnerKeyId = undefined, signal = undefined,
  }) {
    if (!Array.isArray(seeds) || seeds.length === 0) {
      throw new TeamForgePeerError("baseline_unavailable", "No direct Project Peer is available.");
    }
    const peers = seeds.map((seed, index) => this.#peer(seed, index, {
      projectUuid, manifestHash, sessionId, timeoutMilliseconds: this.timeoutMilliseconds,
    }));
    const attempts = new Map(peers.map((peer) => [peer.id, 0]));
    const exhausted = new Set();
    const failures = [];
    while (exhausted.size < peers.length) {
      const candidates = peers
        .filter((peer) => !exhausted.has(peer.id))
        .sort((left, right) => left.cooldownUntil - right.cooldownUntil || left.index - right.index);
      const peer = candidates.find((candidate) => candidate.cooldownUntil <= Date.now()) ?? candidates[0];
      const attempt = (attempts.get(peer.id) ?? 0) + 1;
      attempts.set(peer.id, attempt);
      try {
        await this.#reservePeer(peer, signal);
        const descriptor = await peer.client.descriptor(signal);
        validateDescriptor(descriptor, {
          expectedProjectId: projectId,
          expectedProjectUuid: projectUuid,
          expectedManifestHash: manifestHash,
          trustedOwnerKeyId,
        });
        await this.#reservePeer(peer, signal);
        const manifest = await peer.client.manifest(signal);
        validateManifest(manifest, { expectedProjectUuid: projectUuid, expectedManifestHash: manifestHash });
        if (manifest.baselineRevision !== descriptor.baselineRevision) {
          fail("baseline_revision_mismatch", "Descriptor and manifest revisions differ.");
        }
        return { descriptor, manifest, sourceSeed: peer.id, client: peer.client };
      } catch (error) {
        if (error?.code === "download_cancelled") throw error;
        peer.failures += 1;
        const retryable = isRetryable(error);
        const canRetry = retryable && attempt < this.maxAttempts;
        const retryInMilliseconds = canRetry ? this.#retryDelay(error, attempt) : 0;
        if (canRetry) {
          peer.cooldownUntil = Math.max(peer.cooldownUntil, Date.now() + retryInMilliseconds);
        } else {
          exhausted.add(peer.id);
        }
        const switchedPeer = peers.some((candidate) =>
          candidate.id !== peer.id && !exhausted.has(candidate.id) && candidate.cooldownUntil <= Date.now());
        const record = {
          ...errorRecord(error, { peer, attempt, operation: "baseline_metadata" }),
          maxAttempts: this.maxAttempts,
          retryInMilliseconds,
          switchedPeer,
          resumedChunks: 0,
          remainingBytes: 0,
        };
        failures.push(record);
        this.#diagnostic(record);
      }
    }
    throw new TeamForgePeerError(
      "direct_transfer_unavailable",
      "No direct peer returned a valid signed baseline.",
      { failures },
    );
  }

  async download({ manifest, seeds, sessionId, signal = undefined }) {
    validateManifest(manifest);
    if (!Array.isArray(seeds) || seeds.length === 0) {
      throw new TeamForgePeerError("baseline_unavailable", "No direct Project Peer is available.");
    }
    const uniqueChunks = uniqueManifestChunks(manifest);
    const chunkMap = new Map(uniqueChunks.map((chunk) => [chunk.hash, chunk]));
    const peers = seeds.map((seed, index) => this.#peer(seed, index, {
      projectUuid: manifest.projectUuid,
      manifestHash: manifest.manifestHash,
      sessionId,
      timeoutMilliseconds: this.timeoutMilliseconds,
    }));
    await Promise.all(peers.map(async (peer) => {
      try {
        peer.inventory = await this.#singlePeerOperation(peer, "inventory", async () => validateInventory(
          await peer.client.inventory(signal),
          manifest.projectUuid,
          manifest.manifestHash,
          chunkMap,
        ), signal);
      } catch (error) {
        peer.inventoryFailure = error;
        peer.permanentFailure = !isRetryable(error);
        peer.inventory = null;
      }
    }));

    let completedBytes = 0;
    let completedChunks = 0;
    let resumedChunks = 0;
    let resumedBytes = 0;
    const totalBytes = uniqueChunks.reduce((sum, chunk) => sum + chunk.size, 0);
    const pending = [];
    for (const chunk of uniqueChunks) {
      if (await this.store.has(chunk.hash, chunk.size, true)) {
        completedBytes += chunk.size;
        completedChunks += 1;
        resumedChunks += 1;
        resumedBytes += chunk.size;
      } else {
        await this.store.deleteInvalid(chunk.hash);
        pending.push(chunk);
      }
    }

    const progress = (state, activeSeed = "", currentChunk = "") => {
      const snapshot = {
        state,
        completedBytes,
        remainingBytes: Math.max(0, totalBytes - completedBytes),
        totalBytes,
        completedChunks,
        totalChunks: uniqueChunks.length,
        resumedChunks,
        resumedBytes,
        transferredChunks: Math.max(0, completedChunks - resumedChunks),
        transferredBytes: Math.max(0, completedBytes - resumedBytes),
        activeSeed,
        currentChunk: currentChunk.slice(0, 12),
      };
      this.onProgress(snapshot);
      return snapshot;
    };
    progress(DOWNLOAD_STATES.Downloading);

    let cursor = 0;
    let stopped = false;
    let firstError = null;
    const failures = [];
    const worker = async () => {
      while (true) {
        if (stopped) {
          return;
        }
        if (signal?.aborted) {
          throw new TeamForgePeerError("download_cancelled", "Project download was cancelled.");
        }
        const itemIndex = cursor;
        cursor += 1;
        if (itemIndex >= pending.length) {
          return;
        }
        const chunk = pending[itemIndex];
        const attempts = new Map();
        const unavailable = new Set();
        let accepted = false;
        while (!accepted) {
          if (stopped) {
            return;
          }
          const baseCandidates = peers.filter((peer) => !peer.permanentFailure &&
            !unavailable.has(peer.id) && (peer.inventory === null || peer.inventory.has(chunk.hash)));
          if (baseCandidates.length === 0) {
            break;
          }
          const rotation = itemIndex % peers.length;
          const candidates = orderedPeers(baseCandidates, rotation, peers.length);
          const peer = candidates[0];
          const attempt = (attempts.get(peer.id) ?? 0) + 1;
          attempts.set(peer.id, attempt);
          const startedAt = Date.now();
          peer.inFlight += 1;
          try {
            await this.#reservePeer(peer, signal);
            progress(DOWNLOAD_STATES.Downloading, peer.id, chunk.hash);
            const bytes = await peer.client.chunk(chunk.hash, chunk.size, signal);
            if (stopped) {
              return;
            }
            if (bytes.length !== chunk.size || sha256(bytes) !== chunk.hash) {
              throw new TeamForgePeerError(
                "peer_chunk_invalid",
                "A direct peer returned content that failed Chunk Hash verification.",
                { retryable: false },
              );
            }
            await this.store.put(bytes, chunk.hash);
            if (stopped) {
              return;
            }
            peer.successes += 1;
            const latency = Math.max(1, Date.now() - startedAt);
            peer.latencyMilliseconds = peer.latencyMilliseconds === 0
              ? latency
              : Math.round(peer.latencyMilliseconds * 0.75 + latency * 0.25);
            completedBytes += chunk.size;
            completedChunks += 1;
            accepted = true;
            try {
              await this.onPartialSeed({
                hash: chunk.hash,
                size: chunk.size,
                sourceSeed: peer.id,
                completedChunks,
                totalChunks: uniqueChunks.length,
                completedBytes,
                totalBytes,
              });
            } catch (error) {
              failures.push({
                operation: "partial_seed_announce",
                chunkHashPrefix: chunk.hash.slice(0, 12),
                peerId: peer.id,
                errorKind: "partial_seed_announce_failed",
              });
            }
            progress(DOWNLOAD_STATES.Downloading, peer.id, chunk.hash);
          } catch (error) {
            if (error?.code === "download_cancelled") throw error;
            peer.failures += 1;
            await this.store.deleteInvalid(chunk.hash);
            const retryable = isRetryable(error);
            const canRetryPeer = retryable && attempt < this.maxAttempts;
            const retryInMilliseconds = canRetryPeer ? this.#retryDelay(error, attempt) : 0;
            if (canRetryPeer) {
              peer.cooldownUntil = Math.max(peer.cooldownUntil, Date.now() + retryInMilliseconds);
            } else {
              unavailable.add(peer.id);
            }
            const nextCandidates = baseCandidates.filter((candidate) =>
              !candidate.permanentFailure && !unavailable.has(candidate.id));
            const nextPeer = orderedPeers(nextCandidates, rotation, peers.length)[0];
            const switchedPeer = Boolean(nextPeer && nextPeer.id !== peer.id);
            const record = {
              ...errorRecord(error, { peer, attempt, operation: "chunk", chunkHash: chunk.hash }),
              maxAttempts: this.maxAttempts,
              retryInMilliseconds,
              switchedPeer,
              resumedChunks,
              remainingBytes: Math.max(0, totalBytes - completedBytes),
            };
            failures.push(record);
            this.#diagnostic(record);
          } finally {
            peer.inFlight -= 1;
          }
        }
        if (!accepted) {
          throw new TeamForgePeerError(
            "direct_transfer_unavailable",
            `All direct peers failed to provide chunk ${chunk.hash.slice(0, 12)}.`,
            {
              chunkHashPrefix: chunk.hash.slice(0, 12),
              resumedChunks,
              remainingBytes: Math.max(0, totalBytes - completedBytes),
              failures: failures.filter((failure) => failure.chunkHashPrefix === chunk.hash.slice(0, 12)),
            },
          );
        }
      }
    };

    const workers = Array.from(
      { length: Math.min(this.maxConcurrency, Math.max(1, pending.length)) },
      () => (async () => {
        try {
          await worker();
        } catch (error) {
          if (!firstError) {
            firstError = error;
          }
          stopped = true;
        }
      })(),
    );
    await Promise.allSettled(workers);
    if (firstError) {
      progress(DOWNLOAD_STATES.DirectTransferUnavailable);
      throw firstError;
    }
    for (const chunk of uniqueChunks) {
      if (!(await this.store.has(chunk.hash, chunk.size, true))) {
        fail("download_verification_failed", `Downloaded chunk failed final verification: ${chunk.hash.slice(0, 12)}.`);
      }
    }
    const finalProgress = progress(DOWNLOAD_STATES.Verifying);
    return {
      ...finalProgress,
      failures,
      peers: peers.map(({ id, endpoint, successes, failures: peerFailures, inventoryFailure, latencyMilliseconds }) => ({
        id,
        endpoint,
        successes,
        failures: peerFailures,
        latencyMilliseconds,
        inventoryError: inventoryFailure?.code ?? "",
      })),
    };
  }
}
