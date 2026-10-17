import { performance } from "node:perf_hooks";

const ENDGAME_HEDGE_DELAY_MILLISECONDS = 180;
import { DirectTransferClient } from "./direct-transfer-client.mjs";
import { validateDescriptor } from "./descriptor.mjs";
import { uniqueManifestChunks, validateManifest } from "./manifest.mjs";
import { sha256 } from "./hash.mjs";
import { fail, TeamForgePeerError, throwIfDownloadCancelled } from "./errors.mjs";
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

// Inventory is untrusted advertisement, not proof of retrievable or verified
// content. This read-only summary is for operator diagnosis, not scheduling
// authority or a guarantee that a download will complete.
function summarizeAdvertisedInventory(uniqueChunks, peers) {
  const known = peers.filter(peer => peer.inventory instanceof Set);
  let advertisedChunks = 0;
  let singleAdvertiserChunks = 0;
  let multipleAdvertiserChunks = 0;
  let totalUniqueBytes = 0;
  let advertisedBytes = 0;
  let singleAdvertiserBytes = 0;
  let multipleAdvertiserBytes = 0;
  for (const chunk of uniqueChunks) {
    // Validated Manifest bytes are a better indicator of potential transfer
    // exposure than chunk counts when chunks have very different sizes.
    totalUniqueBytes += chunk.size;
    // Identical peer labels do not establish independent replicas.
    const advertisers = new Set(known.filter(peer => peer.inventory.has(chunk.hash))
      .map(peer => peer.id));
    if (advertisers.size > 0) {
      advertisedChunks += 1;
      advertisedBytes += chunk.size;
    }
    if (advertisers.size === 1) {
      singleAdvertiserChunks += 1;
      singleAdvertiserBytes += chunk.size;
    }
    if (advertisers.size > 1) {
      multipleAdvertiserChunks += 1;
      multipleAdvertiserBytes += chunk.size;
    }
  }
  return Object.freeze({
    totalUniqueChunks: uniqueChunks.length,
    totalUniqueBytes,
    validatedInventories: known.length,
    unknownInventories: peers.length - known.length,
    advertisedChunks,
    advertisedBytes,
    unadvertisedByKnownPeersChunks: uniqueChunks.length - advertisedChunks,
    unadvertisedByKnownPeersBytes: totalUniqueBytes - advertisedBytes,
    singleAdvertiserChunks,
    singleAdvertiserBytes,
    multipleAdvertiserChunks,
    multipleAdvertiserBytes,
    advertisedCoveragePercent: uniqueChunks.length
      ? Math.round(advertisedChunks * 100 / uniqueChunks.length) : 100,
    advertisedByteCoveragePercent: totalUniqueBytes
      ? Math.round(advertisedBytes * 100 / totalUniqueBytes) : 100,
  });
}

// Experimental scheduling *hint* only: validated inventory is still an
// untrusted advertisement, never a guarantee of retrievable content.
// Zero known owners with a still-eligible unknown-inventory peer is unknown,
// not a zero-replica emergency. Distinct labels are not physical proof.
function pendingRarestFirst(pending, peers) {
  const countKnownAdvertisers = (chunk) => {
    const eligible = peers.filter(peer => !peer.permanentFailure);
    const advertisers = new Set(eligible
      .filter(peer => peer.inventory instanceof Set && peer.inventory.has(chunk.hash))
      .map(peer => peer.id));
    if (advertisers.size > 0) return advertisers.size;
    // Prompt failure if no *eligible* source can possibly be queried;
    // otherwise retain original order for unknown inventory coverage.
    return eligible.some(peer => peer.inventory === null)
      ? Number.POSITIVE_INFINITY : 0;
  };
  return pending.map((chunk, index) => ({ chunk, index, count: countKnownAdvertisers(chunk) }))
    .sort((left, right) => left.count - right.count || left.index - right.index)
    .map(item => item.chunk);
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

function verifiedRequestRate(peer) {
  // Only hash-verified, stored chunk bytes earn credit. The rate is a
  // session-local service-time signal, not observed link capacity.
  return peer.successfulRequestMilliseconds > 0 && peer.verifiedBytes > 0
    ? Math.min(Number.MAX_SAFE_INTEGER, peer.verifiedBytes * 1_000 / peer.successfulRequestMilliseconds)
    : 0;
}

function orderedPeers(candidates, rotation, peerCount, mode = "balanced", chunkIndex = 0) {
  const now = Date.now();
  // Give the legacy ordering one slot in eight, preventing a previously fast
  // peer from permanently hiding a recovered slower/unknown source.
  const explore = mode !== "verified-throughput" || chunkIndex % 8 === 0;
  return [...candidates].sort((left, right) => {
    const leftValue = peerScore(left, rotation, peerCount, now);
    const rightValue = peerScore(right, rotation, peerCount, now);
    if (leftValue.cooling !== rightValue.cooling) {
      return leftValue.cooling - rightValue.cooling;
    }
    if (leftValue.cooling && leftValue.cooldownUntil !== rightValue.cooldownUntil) {
      return leftValue.cooldownUntil - rightValue.cooldownUntil;
    }
    if (!explore && left.failures === right.failures && left.inFlight === right.inFlight) {
      // Each eligible source gets an initial attempt before its service rate
      // can steer later chunks. Failure/backoff and busy-peer bounds still win.
      if ((left.chunkAttempts === 0) !== (right.chunkAttempts === 0)) {
        return left.chunkAttempts === 0 ? -1 : 1;
      }
      const leftRate = verifiedRequestRate(left);
      const rightRate = verifiedRequestRate(right);
      if (leftRate > 0 && rightRate > 0 &&
          Math.max(leftRate, rightRate) >= 1.2 * Math.min(leftRate, rightRate)) {
        return rightRate - leftRate;
      }
    }
    return leftValue.score - rightValue.score || leftValue.tie - rightValue.tie;
  });
}

export class SwarmDownloader {
  constructor({
    store,
    maxConcurrency = LEGACY_TRANSFER_DEFAULTS.maxConcurrency,
    peerSelectionMode = "balanced",
    chunkOrder = "manifest",
    concurrencyMode = "fixed",
    endgameMode = "off",
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
    monotonicNow = () => performance.now(),
    sleep = undefined,
  }) {
    if (!store || typeof store.put !== "function" || typeof store.has !== "function") {
      fail("invalid_chunk_store", "Swarm downloader requires a ChunkStore.");
    }
    if (!["balanced", "verified-throughput"].includes(peerSelectionMode) ||
        !["manifest", "rarest-first"].includes(chunkOrder) ||
        !["fixed", "adaptive"].includes(concurrencyMode) ||
        !["off", "hedged"].includes(endgameMode) ||
        !Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 64 ||
        !Number.isInteger(retryRounds) || retryRounds < 0 || retryRounds > 10 ||
        !Number.isInteger(retryBaseMilliseconds) || retryBaseMilliseconds < 1 || retryBaseMilliseconds > 60_000 ||
        !Number.isInteger(retryMaximumMilliseconds) || retryMaximumMilliseconds < retryBaseMilliseconds ||
        retryMaximumMilliseconds > 60_000 ||
        typeof retryJitterRatio !== "number" || retryJitterRatio < 0 || retryJitterRatio > 0.5 ||
        !Number.isInteger(minimumPeerIntervalMilliseconds) || minimumPeerIntervalMilliseconds < 0 ||
        minimumPeerIntervalMilliseconds > 1_000 || typeof random !== "function" ||
        typeof monotonicNow !== "function" ||
        (sleep !== undefined && typeof sleep !== "function")) {
      fail("invalid_download_limits", "Swarm concurrency, pacing, or retry limits are invalid.");
    }
    this.store = store;
    this.maxConcurrency = maxConcurrency;
    this.peerSelectionMode = peerSelectionMode;
    this.chunkOrder = chunkOrder;
    this.concurrencyMode = concurrencyMode;
    this.endgameMode = endgameMode;
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
    this.monotonicNow = monotonicNow;
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
      chunkAttempts: 0,
      verifiedBytes: 0,
      successfulRequestMilliseconds: 0,
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
      if (signal?.aborted) {
        throw new TeamForgePeerError("download_cancelled", "Project download was cancelled.");
      }
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
    throwIfDownloadCancelled(signal);
    if (!Array.isArray(seeds) || seeds.length === 0) {
      throw new TeamForgePeerError("baseline_unavailable", "No direct Project Peer is available.");
    }
    const peers = seeds.map((seed, index) => this.#peer(seed, index, {
      projectUuid, manifestHash, sessionId, timeoutMilliseconds: this.timeoutMilliseconds,
    }));
    // Labels are diagnostics, not unique source identities. Keep budgets local
    // to each source even when two advertisements have the same display ID.
    const attempts = new Map(peers.map((peer) => [peer, 0]));
    const exhausted = new Set();
    const failures = [];
    while (exhausted.size < peers.length) {
      const candidates = peers
        .filter((peer) => !exhausted.has(peer))
        .sort((left, right) => left.cooldownUntil - right.cooldownUntil || left.index - right.index);
      const peer = candidates.find((candidate) => candidate.cooldownUntil <= Date.now()) ?? candidates[0];
      const attempt = (attempts.get(peer) ?? 0) + 1;
      attempts.set(peer, attempt);
      try {
        await this.#reservePeer(peer, signal);
        const descriptor = await peer.client.descriptor(signal);
        throwIfDownloadCancelled(signal);
        validateDescriptor(descriptor, {
          expectedProjectId: projectId,
          expectedProjectUuid: projectUuid,
          expectedManifestHash: manifestHash,
          trustedOwnerKeyId,
        });
        await this.#reservePeer(peer, signal);
        const manifest = await peer.client.manifest(signal);
        throwIfDownloadCancelled(signal);
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
          exhausted.add(peer);
        }
        const switchedPeer = peers.some((candidate) =>
          candidate !== peer && !exhausted.has(candidate) && candidate.cooldownUntil <= Date.now());
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

  // One optional speculative request for the final two *pending* unique
  // chunks. The first SHA-256-valid answer wins; the losing request is
  // aborted and settled before returning, so only one store write follows.
  async #fetchEndgameChunk(primary, alternative, chunk, workerSignal, onHedgeStarted) {
    const primaryAbort = new AbortController();
    const alternativeAbort = new AbortController();
    const delayAbort = new AbortController();
    const abortAll = () => {
      primaryAbort.abort();
      alternativeAbort.abort();
      delayAbort.abort();
    };
    if (workerSignal.aborted) {
      throw new TeamForgePeerError("download_cancelled", "Project download was cancelled.");
    }
    workerSignal.addEventListener("abort", abortAll, { once: true });
    let hedgeStarted = false;
    let hedgeWon = false;
    let hedgeTask;
    const validRequest = async (peer, localSignal, paced) => {
      if (paced) {
        peer.inFlight += 1;
      }
      try {
        if (paced) await this.#reservePeer(peer, localSignal);
        if (localSignal.aborted) {
          throw new TeamForgePeerError("download_cancelled", "Project download was cancelled.");
        }
        peer.chunkAttempts += 1;
        const startedAt = this.monotonicNow();
        const bytes = await peer.client.chunk(chunk.hash, chunk.size, localSignal);
        const requestMilliseconds = Math.max(0, this.monotonicNow() - startedAt);
        if (localSignal.aborted) {
          throw new TeamForgePeerError("download_cancelled", "Project download was cancelled.");
        }
        if (bytes.length !== chunk.size || sha256(bytes) !== chunk.hash) {
          throw new TeamForgePeerError(
            "peer_chunk_invalid",
            "A direct peer returned content that failed Chunk Hash verification.",
            { retryable: false },
          );
        }
        return { peer, bytes, requestMilliseconds };
      } finally {
        if (paced) peer.inFlight -= 1;
      }
    };
    const primaryTask = validRequest(primary, primaryAbort.signal, false);
    try {
      // Observe the primary promise immediately so a quick rejection is never
      // unhandled while the delayed hedge is waiting.
      const first = await Promise.race([
        primaryTask.then(value => ({ type: "success", value }),
          error => ({ type: "error", error })),
        this.#sleep(ENDGAME_HEDGE_DELAY_MILLISECONDS, delayAbort.signal)
          .then(() => ({ type: "delay" }), error => ({ type: "error", error })),
      ]);
      if (first.type === "success") {
        return { ...first.value, hedgeStarted, hedgeWon };
      }
      if (first.type === "error") throw first.error;
      // After the grace period, an alternate *distinct source* may serve the
      // same trusted hash. No extra retry rounds or global concurrency change.
      hedgeStarted = true;
      onHedgeStarted();
      hedgeTask = validRequest(alternative, alternativeAbort.signal, true);
      let winner;
      try {
        winner = await Promise.any([primaryTask, hedgeTask]);
      } catch (aggregate) {
        // Preserve the existing primary failure semantics and bounded fallback.
        throw aggregate.errors?.[0] ?? aggregate;
      }
      hedgeWon = winner.peer === alternative;
      return { ...winner, hedgeStarted, hedgeWon };
    } finally {
      abortAll();
      await Promise.allSettled([primaryTask, hedgeTask].filter(Boolean));
      workerSignal.removeEventListener("abort", abortAll);
    }
  }

  async download({ manifest, seeds, sessionId, signal = undefined }) {
    throwIfDownloadCancelled(signal);
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
    let inventoryCancellation = null;
    await Promise.all(peers.map(async (peer) => {
      try {
        peer.inventory = await this.#singlePeerOperation(peer, "inventory", async () => validateInventory(
          await peer.client.inventory(signal),
          manifest.projectUuid,
          manifest.manifestHash,
          chunkMap,
        ), signal);
      } catch (error) {
        if (error?.code === "download_cancelled") inventoryCancellation ??= error;
        peer.inventoryFailure = error;
        peer.permanentFailure = !isRetryable(error);
        peer.inventory = null;
      }
    }));
    throwIfDownloadCancelled(signal);
    if (inventoryCancellation) throw inventoryCancellation;

    const peerInventoryHealth = summarizeAdvertisedInventory(uniqueChunks, peers);

    let completedBytes = 0;
    let completedChunks = 0;
    let resumedChunks = 0;
    let resumedBytes = 0;
    const totalBytes = uniqueChunks.reduce((sum, chunk) => sum + chunk.size, 0);
    const pending = [];
    for (const chunk of uniqueChunks) {
      throwIfDownloadCancelled(signal);
      const cached = await this.store.has(chunk.hash, chunk.size, true);
      throwIfDownloadCancelled(signal);
      if (cached) {
        completedBytes += chunk.size;
        completedChunks += 1;
        resumedChunks += 1;
        resumedBytes += chunk.size;
      } else {
        await this.store.deleteInvalid(chunk.hash);
        pending.push(chunk);
      }
    }

    // Only reorders the missing unique chunks. Existing manifest, source
    // authorization, chunk verification and activation remain authoritative.
    const scheduled = this.chunkOrder === "rarest-first"
      ? pendingRarestFirst(pending, peers) : pending;

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

    // A terminal worker failure must cancel outstanding requests and pacing waits,
    // while all workers still settle before this operation returns.
    // A session-local adaptive limiter controls only admission of NEW chunk
    // jobs: existing requests settle via their original retry/hash/abort path.
    const workerController = new AbortController();
    const workerSignal = workerController.signal;
    const adaptive = this.concurrencyMode === "adaptive";
    const ceiling = Math.min(this.maxConcurrency, Math.max(1, scheduled.length));
    let targetConcurrency = adaptive ? 1 : ceiling;
    let peakConcurrency = targetConcurrency;
    let reductions = 0;
    let successesSinceIncrease = 0;
    let activeJobs = 0;
    const waitingForAdmission = new Set();
    const wakeWaiters = () => {
      const waiters = [...waitingForAdmission];
      waitingForAdmission.clear();
      for (const wake of waiters) wake();
    };
    const cancelWorkers = () => {
      workerController.abort();
      wakeWaiters();
    };
    if (signal?.aborted) cancelWorkers();
    else signal?.addEventListener("abort", cancelWorkers, { once: true });

    let cursor = 0;
    let stopped = false;
    let firstError = null;
    const failures = [];
    const endgame = { mode: this.endgameMode, speculativeRequests: 0, speculativeWins: 0 };
    const hedgedChunkHashes = new Set();
    const completedJob = () => {
      if (!adaptive || targetConcurrency >= ceiling) return;
      successesSinceIncrease += 1;
      if (successesSinceIncrease >= 2 * targetConcurrency) {
        targetConcurrency += 1;
        peakConcurrency = Math.max(peakConcurrency, targetConcurrency);
        successesSinceIncrease = 0;
        wakeWaiters();
      }
    };
    const failedAttempt = () => {
      if (!adaptive) return;
      const reduced = Math.max(1, Math.ceil(targetConcurrency / 2));
      if (reduced < targetConcurrency) reductions += 1;
      targetConcurrency = reduced;
      successesSinceIncrease = 0;
    };
    const claimJob = async () => {
      while (true) {
        if (stopped) return -1;
        if (workerSignal.aborted) {
          throw new TeamForgePeerError("download_cancelled", "Project download was cancelled.");
        }
        if (cursor >= scheduled.length) return -1;
        if (activeJobs < targetConcurrency) {
          activeJobs += 1;
          return cursor++;
        }
        // No polling or per-waiter AbortSignal listeners: completion, growth
        // and the shared abort handler all wake this bounded worker set.
        await new Promise(resolve => waitingForAdmission.add(resolve));
      }
    };
    const worker = async () => {
      while (true) {
        const itemIndex = await claimJob();
        if (itemIndex < 0) return;
        try {
          await transferChunk(itemIndex);
        } finally {
          activeJobs -= 1;
          wakeWaiters();
        }
      }
    };
    const transferChunk = async (itemIndex) => {
        const chunk = scheduled[itemIndex];
        const attempts = new Map();
        const unavailable = new Set();
        let accepted = false;
        while (!accepted) {
          if (stopped) {
            return;
          }
          const baseCandidates = peers.filter((peer) => !peer.permanentFailure &&
            !unavailable.has(peer) && (peer.inventory === null || peer.inventory.has(chunk.hash)));
          if (baseCandidates.length === 0) {
            break;
          }
          const rotation = itemIndex % peers.length;
          const candidates = orderedPeers(baseCandidates, rotation, peers.length, this.peerSelectionMode, itemIndex);
          const peer = candidates[0];
          const attempt = (attempts.get(peer) ?? 0) + 1;
          attempts.set(peer, attempt);
          const startedAt = Date.now();
          peer.inFlight += 1;
          try {
            await this.#reservePeer(peer, workerSignal);
            if (stopped) return;
            if (workerSignal.aborted) {
              throw new TeamForgePeerError("download_cancelled", "Project download was cancelled.");
            }
            progress(DOWNLOAD_STATES.Downloading, peer.id, chunk.hash);
            const alternative = this.endgameMode === "hedged" &&
              itemIndex >= scheduled.length - 2 &&
              !hedgedChunkHashes.has(chunk.hash)
              ? candidates.find(candidate => candidate !== peer && candidate.id !== peer.id)
              : null;
            let sourcePeer = peer;
            let bytes, requestMilliseconds;
            if (alternative) {
              const winning = await this.#fetchEndgameChunk(
                peer, alternative, chunk, workerSignal,
                () => { hedgedChunkHashes.add(chunk.hash); endgame.speculativeRequests += 1; },
              );
              sourcePeer = winning.peer;
              bytes = winning.bytes;
              requestMilliseconds = winning.requestMilliseconds;
              if (winning.hedgeWon) endgame.speculativeWins += 1;
            } else {
              const requestStartedAt = this.monotonicNow();
              peer.chunkAttempts += 1;
              bytes = await peer.client.chunk(chunk.hash, chunk.size, workerSignal);
              requestMilliseconds = Math.max(0, this.monotonicNow() - requestStartedAt);
              if (bytes.length !== chunk.size || sha256(bytes) !== chunk.hash) {
                throw new TeamForgePeerError(
                  "peer_chunk_invalid",
                  "A direct peer returned content that failed Chunk Hash verification.",
                  { retryable: false },
                );
              }
            }
            if (stopped || workerSignal.aborted) return;
            await this.store.put(bytes, chunk.hash);
            if (stopped || workerSignal.aborted) return;
            sourcePeer.successes += 1;
            sourcePeer.verifiedBytes += chunk.size;
            sourcePeer.successfulRequestMilliseconds += requestMilliseconds;
            const latency = Math.max(1, Date.now() - startedAt);
            sourcePeer.latencyMilliseconds = sourcePeer.latencyMilliseconds === 0
              ? latency
              : Math.round(sourcePeer.latencyMilliseconds * 0.75 + latency * 0.25);
            completedBytes += chunk.size;
            completedChunks += 1;
            accepted = true;
            completedJob();
            try {
              await this.onPartialSeed({
                hash: chunk.hash,
                size: chunk.size,
                sourceSeed: sourcePeer.id,
                completedChunks,
                totalChunks: uniqueChunks.length,
                completedBytes,
                totalBytes,
              });
            } catch (error) {
              failures.push({
                operation: "partial_seed_announce",
                chunkHashPrefix: chunk.hash.slice(0, 12),
                peerId: sourcePeer.id,
                errorKind: "partial_seed_announce_failed",
              });
            }
            progress(DOWNLOAD_STATES.Downloading, sourcePeer.id, chunk.hash);
          } catch (error) {
            if (error?.code === "download_cancelled") throw error;
            peer.failures += 1;
            failedAttempt();
            // A source/transport failure owns no cache entry. Another operation
            // may have stored this trusted hash while the request was in flight.
            const retryable = isRetryable(error);
            const canRetryPeer = retryable && attempt < this.maxAttempts;
            const retryInMilliseconds = canRetryPeer ? this.#retryDelay(error, attempt) : 0;
            if (canRetryPeer) {
              peer.cooldownUntil = Math.max(peer.cooldownUntil, Date.now() + retryInMilliseconds);
            } else {
              unavailable.add(peer);
            }
            const nextCandidates = baseCandidates.filter((candidate) =>
              !candidate.permanentFailure && !unavailable.has(candidate));
            const nextPeer = orderedPeers(nextCandidates, rotation, peers.length, this.peerSelectionMode, itemIndex)[0];
            const switchedPeer = Boolean(nextPeer && nextPeer !== peer);
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
    };

    const workers = Array.from(
      { length: Math.min(this.maxConcurrency, Math.max(1, scheduled.length)) },
      () => (async () => {
        try {
          await worker();
        } catch (error) {
          if (!firstError) {
            firstError = error;
          }
          stopped = true;
          cancelWorkers();
        }
      })(),
    );
    try {
      await Promise.allSettled(workers);
    } finally {
      signal?.removeEventListener("abort", cancelWorkers);
    }
    if (firstError) {
      if (firstError.code !== "download_cancelled") progress(DOWNLOAD_STATES.DirectTransferUnavailable);
      throw firstError;
    }
    for (const chunk of uniqueChunks) {
      throwIfDownloadCancelled(signal);
      const verified = await this.store.has(chunk.hash, chunk.size, true);
      throwIfDownloadCancelled(signal);
      if (!verified) {
        fail("download_verification_failed", `Downloaded chunk failed final verification: ${chunk.hash.slice(0, 12)}.`);
      }
    }
    throwIfDownloadCancelled(signal);
    const finalProgress = progress(DOWNLOAD_STATES.Verifying);
    throwIfDownloadCancelled(signal);
    return {
      ...finalProgress,
      failures,
      endgame: Object.freeze({ ...endgame }),
      concurrencyControl: Object.freeze({
        mode: this.concurrencyMode,
        ceiling,
        startingLimit: adaptive ? 1 : ceiling,
        finalLimit: targetConcurrency,
        peakLimit: peakConcurrency,
        reductions,
      }),
      peerInventoryHealth,
      peers: peers.map((peer) => ({
        id: peer.id,
        endpoint: peer.endpoint,
        successes: peer.successes,
        failures: peer.failures,
        latencyMilliseconds: peer.latencyMilliseconds,
        inventoryError: peer.inventoryFailure?.code ?? "",
        chunkAttempts: peer.chunkAttempts,
        verifiedBytes: peer.verifiedBytes,
        successfulRequestMilliseconds: peer.successfulRequestMilliseconds,
        // Sum of successful request service times; overlapping requests are not
        // aggregate link bandwidth. Resume, pacing and disk time are excluded.
        requestServiceBytesPerSecond: peer.successfulRequestMilliseconds > 0
          ? Math.round(peer.verifiedBytes * 1_000 / peer.successfulRequestMilliseconds)
          : 0,
      })),
    };
  }
}
