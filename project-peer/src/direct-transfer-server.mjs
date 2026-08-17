import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import {
  DEFAULT_TRANSFER_BASE_PATH,
  MAXIMUM_CHUNK_SIZE,
  TRANSFER_PROTOCOL_VERSION,
  UUID_PATTERN,
} from "./constants.mjs";
import { uniqueManifestChunks, validateManifest } from "./manifest.mjs";
import { validateDescriptor } from "./descriptor.mjs";
import { requireSha256, safeTokenEqual } from "./hash.mjs";
import { fail } from "./errors.mjs";
import { LEGACY_TRANSFER_DEFAULTS } from "./policy-profile.mjs";

function normalizeBasePath(value) {
  const candidate = value ?? DEFAULT_TRANSFER_BASE_PATH;
  if (typeof candidate !== "string" || !candidate.startsWith("/") ||
      candidate.includes("?") || candidate.includes("#") || candidate.includes("..")) {
    fail("invalid_transfer_path", "Direct transfer base path must be an absolute HTTP path.");
  }
  return candidate.replace(/\/+$/u, "");
}

function writeResponse(response, status, contentType, bytes, extraHeaders = {}) {
  response.writeHead(status, {
    "content-type": contentType,
    "content-length": bytes.length,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  });
  response.end(bytes);
}

function writeJson(response, status, body, extraHeaders = {}) {
  writeResponse(
    response,
    status,
    "application/json; charset=utf-8",
    Buffer.from(JSON.stringify(body), "utf8"),
    extraHeaders,
  );
}

function retryHeaders(milliseconds) {
  const bounded = Math.max(1, Math.ceil(milliseconds));
  return {
    "retry-after": String(Math.max(1, Math.ceil(bounded / 1_000))),
    "x-teamforge-retry-after-ms": String(bounded),
  };
}

function abortError(signal) {
  if (signal?.reason instanceof Error) {
    return signal.reason;
  }
  const error = new Error("Direct transfer operation was aborted.");
  error.name = "AbortError";
  return error;
}

function abortableDelay(milliseconds, signal) {
  if (signal.aborted) {
    return Promise.reject(abortError(signal));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject, abortError(signal));
    timer = setTimeout(() => finish(resolve), milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function raceWithAbort(operation, signal) {
  if (signal.aborted) {
    return Promise.reject(abortError(signal));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject, abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(operation).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
  });
}

export function createTransferToken(byteLength = 32) {
  if (!Number.isInteger(byteLength) || byteLength < 16 || byteLength > 128) {
    fail("invalid_token_size", "Transfer token entropy must be between 16 and 128 bytes.");
  }
  return randomBytes(byteLength).toString("base64url");
}

export class DirectTransferServer {
  constructor({
    host = LEGACY_TRANSFER_DEFAULTS.host,
    port = LEGACY_TRANSFER_DEFAULTS.port,
    basePath = LEGACY_TRANSFER_DEFAULTS.basePath,
    sessionId,
    projectUuid,
    manifest,
    descriptor,
    store,
    transferToken,
    maxJsonBytes = LEGACY_TRANSFER_DEFAULTS.maxJsonBytes,
    maxChunkBytes = LEGACY_TRANSFER_DEFAULTS.maxChunkBytes,
    maxConcurrentRequests = LEGACY_TRANSFER_DEFAULTS.maxConcurrentRequests,
    rateLimitPerSecond = LEGACY_TRANSFER_DEFAULTS.rateLimitPerSecond,
    maxBytesPerSecond = LEGACY_TRANSFER_DEFAULTS.maxBytesPerSecond,
  }) {
    if (!UUID_PATTERN.test(projectUuid ?? "")) {
      fail("invalid_project_uuid", "Direct transfer Project UUID is invalid.");
    }
    if (typeof sessionId !== "string" || sessionId.trim().length === 0 || sessionId.length > 128 ||
        /[\u0000-\u001f\u007f]/u.test(sessionId)) {
      fail("invalid_session_id", "Direct transfer Session ID is invalid.");
    }
    validateManifest(manifest, { expectedProjectUuid: projectUuid });
    validateDescriptor(descriptor, {
      expectedProjectUuid: projectUuid,
      expectedManifestHash: manifest.manifestHash,
    });
    if (!store || typeof store.read !== "function") {
      fail("invalid_chunk_store", "Direct transfer server requires a ChunkStore.");
    }
    if (typeof transferToken !== "string" || transferToken.length < 16 || transferToken.length > 512) {
      fail("invalid_transfer_token", "Direct transfer token must contain 16-512 characters.");
    }
    for (const [name, value, minimum, maximum] of [
      ["port", port, 0, 65_535],
      ["maxJsonBytes", maxJsonBytes, 1_024, 16_777_216],
      ["maxChunkBytes", maxChunkBytes, 65_536, MAXIMUM_CHUNK_SIZE],
      ["maxConcurrentRequests", maxConcurrentRequests, 1, 256],
      ["rateLimitPerSecond", rateLimitPerSecond, 1, 10_000],
    ]) {
      if (!Number.isInteger(value) || value < minimum || value > maximum) {
        fail("invalid_transfer_limit", `${name} must be an integer between ${minimum} and ${maximum}.`);
      }
    }
    if (!Number.isInteger(maxBytesPerSecond) || maxBytesPerSecond < 0 ||
        (maxBytesPerSecond > 0 && maxBytesPerSecond < 65_536) || maxBytesPerSecond > 1_073_741_824) {
      fail(
        "invalid_transfer_limit",
        "maxBytesPerSecond must be 0 (unlimited) or an integer between 65536 and 1073741824.",
      );
    }

    this.host = host;
    this.port = port;
    this.basePath = normalizeBasePath(basePath);
    this.projectUuid = projectUuid.toLowerCase();
    this.sessionId = sessionId.trim();
    this.manifest = manifest;
    this.descriptor = descriptor;
    this.store = store;
    this.transferToken = transferToken;
    this.maxJsonBytes = maxJsonBytes;
    this.maxChunkBytes = maxChunkBytes;
    this.maxConcurrentRequests = maxConcurrentRequests;
    this.rateLimitPerSecond = rateLimitPerSecond;
    this.maxBytesPerSecond = maxBytesPerSecond;
    this.nextTransferAt = 0;
    this.allowedChunks = new Map(uniqueManifestChunks(manifest).map((chunk) => [chunk.hash, chunk.size]));
    this.activeRequests = 0;
    this.rateWindows = new Map();
    this.handlerPromises = new Set();
    this.requestContexts = new Set();
    this.sockets = new Set();
    this.socketContexts = new Map();
    this.stopPromise = null;
    this.stopping = false;
    this.httpServer = createServer((request, response) => this.#dispatch(request, response));
    this.httpServer.on("connection", (socket) => {
      this.sockets.add(socket);
      const contexts = new Set();
      let cleaned = false;
      const abortContexts = () => {
        for (const context of contexts) {
          context.abort();
        }
      };
      const onError = () => abortContexts();
      const cleanup = () => {
        if (cleaned) {
          return;
        }
        cleaned = true;
        abortContexts();
        socket.off("close", cleanup);
        socket.off("error", onError);
        this.socketContexts.delete(socket);
        this.sockets.delete(socket);
      };
      this.socketContexts.set(socket, { contexts, abort: abortContexts, cleanup });
      socket.on("error", onError);
      socket.once("close", cleanup);
    });
    this.httpServer.on("clientError", (_error, socket) => {
      if (socket.writable) {
        socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      }
    });
  }

  #dispatch(request, response) {
    const handler = this.#handle(request, response);
    this.handlerPromises.add(handler);
    void handler.then(
      () => this.handlerPromises.delete(handler),
      (error) => {
        this.handlerPromises.delete(handler);
        if (!response.destroyed) {
          response.destroy(error);
        }
      },
    );
  }

  #requestContext(request, response) {
    const controller = new AbortController();
    const socketState = this.socketContexts.get(request.socket);
    let cleaned = false;
    const abort = () => {
      if (!controller.signal.aborted) {
        controller.abort();
      }
    };
    const onRequestClose = () => {
      if (request.aborted || !request.complete) {
        abort();
      }
    };
    const onResponseClose = () => {
      if (!response.writableFinished) {
        abort();
      }
    };
    request.once("aborted", abort);
    request.once("close", onRequestClose);
    request.once("error", abort);
    response.once("close", onResponseClose);
    response.once("error", abort);
    const context = {
      controller,
      request,
      response,
      abort,
      cleanup: () => {
        if (cleaned) {
          return;
        }
        cleaned = true;
        request.off("aborted", abort);
        request.off("close", onRequestClose);
        request.off("error", abort);
        response.off("close", onResponseClose);
        response.off("error", abort);
        socketState?.contexts.delete(context);
      },
    };
    socketState?.contexts.add(context);
    this.requestContexts.add(context);
    if (request.aborted || request.socket.destroyed || this.stopping) {
      abort();
    }
    return context;
  }

  #authorized(request) {
    const authorization = request.headers.authorization;
    const token = typeof authorization === "string" && authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";
    return safeTokenEqual(token, this.transferToken) &&
      request.headers["x-teamforge-project-uuid"] === this.projectUuid &&
      request.headers["x-teamforge-manifest-hash"] === this.manifest.manifestHash &&
      request.headers["x-teamforge-session-id"] === this.sessionId;
  }

  #rateLimit(request) {
    const key = request.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    let window = this.rateWindows.get(key);
    if (!window || now - window.startedAt >= 1_000) {
      window = { startedAt: now, count: 0 };
      this.rateWindows.set(key, window);
    }
    window.count += 1;
    if (this.rateWindows.size > 1024) {
      for (const [address, candidate] of this.rateWindows) {
        if (now - candidate.startedAt >= 60_000) {
          this.rateWindows.delete(address);
        }
      }
    }
    return {
      allowed: window.count <= this.rateLimitPerSecond,
      retryAfterMilliseconds: Math.max(1, 1_000 - (now - window.startedAt)),
    };
  }

  async #handle(request, response) {
    const context = this.#requestContext(request, response);
    const { signal } = context.controller;
    let counted = false;
    try {
      if (signal.aborted) {
        throw abortError(signal);
      }
      const rateLimit = this.#rateLimit(request);
      if (!rateLimit.allowed) {
        writeJson(
          response,
          429,
          { error: "rate_limited" },
          retryHeaders(rateLimit.retryAfterMilliseconds),
        );
        return;
      }
      if (this.activeRequests >= this.maxConcurrentRequests) {
        writeJson(response, 503, { error: "transfer_busy" }, retryHeaders(100));
        return;
      }
      this.activeRequests += 1;
      counted = true;
      if (request.method !== "GET") {
        writeJson(response, 405, { error: "method_not_allowed" });
        return;
      }
      if (!this.#authorized(request)) {
        writeJson(response, 401, { error: "unauthorized" });
        return;
      }
      const pathname = new URL(request.url ?? "/", "http://teamforge.invalid").pathname;
      const descriptorPath = `${this.basePath}/descriptor`;
      const manifestPath = `${this.basePath}/manifests/${this.manifest.manifestHash}`;
      const inventoryPath = `${this.basePath}/inventory/${this.manifest.manifestHash}`;
      if (pathname === descriptorPath) {
        this.#sendBoundedJson(response, this.descriptor);
        return;
      }
      if (pathname === manifestPath) {
        this.#sendBoundedJson(response, this.manifest);
        return;
      }
      if (pathname === inventoryPath) {
        const chunks = await raceWithAbort(this.store.inventory(this.allowedChunks.keys()), signal);
        this.#sendBoundedJson(response, {
          transferProtocolVersion: TRANSFER_PROTOCOL_VERSION,
          projectUuid: this.projectUuid,
          manifestHash: this.manifest.manifestHash,
          complete: chunks.length === this.allowedChunks.size,
          availableChunkCount: chunks.length,
          totalChunkCount: this.allowedChunks.size,
          chunks,
        });
        return;
      }
      const prefix = `${this.basePath}/chunks/`;
      if (pathname.startsWith(prefix)) {
        const hash = pathname.slice(prefix.length);
        if (!/^[0-9a-f]{64}$/u.test(hash) || !this.allowedChunks.has(hash)) {
          writeJson(response, 404, { error: "chunk_not_found" });
          return;
        }
        requireSha256(hash, "chunkHash");
        const expectedSize = this.allowedChunks.get(hash);
        if (expectedSize > this.maxChunkBytes) {
          writeJson(response, 413, { error: "chunk_too_large" });
          return;
        }
        let bytes;
        try {
          bytes = await raceWithAbort(this.store.read(hash, expectedSize), signal);
        } catch {
          if (signal.aborted) {
            throw abortError(signal);
          }
          writeJson(response, 404, { error: "chunk_not_available" });
          return;
        }
        await this.#sendChunk(response, bytes, hash, signal);
        return;
      }
      writeJson(response, 404, { error: "not_found" });
    } catch (error) {
      if (signal.aborted) {
        if (!response.destroyed) {
          response.destroy();
        }
      } else if (!response.headersSent && !response.destroyed) {
        writeJson(response, 500, { error: "transfer_error" });
      } else if (!response.destroyed) {
        response.destroy(error);
      }
    } finally {
      if (counted) {
        this.activeRequests -= 1;
      }
      context.cleanup();
      this.requestContexts.delete(context);
    }
  }

  #sendBoundedJson(response, value) {
    const bytes = Buffer.from(JSON.stringify(value), "utf8");
    if (bytes.length > this.maxJsonBytes) {
      writeJson(response, 413, { error: "metadata_too_large" });
      return;
    }
    writeResponse(response, 200, "application/json; charset=utf-8", bytes);
  }

  async #reserveBandwidth(byteCount, signal) {
    if (this.maxBytesPerSecond === 0) {
      return;
    }
    const reservationMilliseconds = byteCount * 1_000 / this.maxBytesPerSecond;
    while (true) {
      if (signal.aborted) {
        throw abortError(signal);
      }
      const now = Date.now();
      const delay = this.nextTransferAt - now;
      if (delay > 0) {
        await abortableDelay(delay, signal);
        continue;
      }
      const claimedAt = Date.now();
      if (this.nextTransferAt > claimedAt) {
        continue;
      }
      this.nextTransferAt = claimedAt + reservationMilliseconds;
      return;
    }
  }

  async #sendChunk(response, bytes, hash, signal) {
    response.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": bytes.length,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-teamforge-chunk-hash": hash,
    });
    if (this.maxBytesPerSecond === 0) {
      if (signal.aborted || response.destroyed) {
        throw abortError(signal);
      }
      response.end(bytes);
      await this.#waitForResponseCompletion(response, signal);
      return;
    }
    const sliceSize = Math.max(1, Math.min(65_536, Math.floor(this.maxBytesPerSecond / 10)));
    for (let offset = 0; offset < bytes.length; offset += sliceSize) {
      if (signal.aborted || response.destroyed) {
        throw abortError(signal);
      }
      const slice = bytes.subarray(offset, Math.min(bytes.length, offset + sliceSize));
      await this.#reserveBandwidth(slice.length, signal);
      if (signal.aborted || response.destroyed) {
        throw abortError(signal);
      }
      if (!response.write(slice)) {
        await this.#waitForDrain(response, signal);
      }
    }
    if (signal.aborted || response.destroyed) {
      throw abortError(signal);
    }
    response.end();
    await this.#waitForResponseCompletion(response, signal);
  }

  async #waitForDrain(response, signal) {
    if (signal.aborted || response.destroyed) {
      throw abortError(signal);
    }
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        response.off("drain", onDrain);
        response.off("close", onClose);
        response.off("error", onError);
        signal.removeEventListener("abort", onAbort);
        callback(value);
      };
      const onDrain = () => finish(resolve);
      const onClose = () => finish(reject, abortError(signal));
      const onError = (error) => finish(reject, error);
      const onAbort = () => finish(reject, abortError(signal));
      response.once("drain", onDrain);
      response.once("close", onClose);
      response.once("error", onError);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  async #waitForResponseCompletion(response, signal) {
    if (response.writableFinished) {
      return;
    }
    if (signal.aborted || response.destroyed) {
      throw abortError(signal);
    }
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        response.off("finish", onFinish);
        response.off("close", onClose);
        response.off("error", onError);
        signal.removeEventListener("abort", onAbort);
        callback(value);
      };
      const onFinish = () => finish(resolve);
      const onClose = () => finish(reject, abortError(signal));
      const onError = (error) => finish(reject, error);
      const onAbort = () => finish(reject, abortError(signal));
      response.once("finish", onFinish);
      response.once("close", onClose);
      response.once("error", onError);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  async start() {
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        this.httpServer.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.httpServer.off("error", onError);
        resolve();
      };
      this.httpServer.once("error", onError);
      this.httpServer.once("listening", onListening);
      this.httpServer.listen(this.port, this.host);
    });
    const address = this.httpServer.address();
    if (!address || typeof address === "string") {
      fail("transfer_bind_failed", "Could not resolve the direct transfer listen address.");
    }
    const displayHost = this.host === "0.0.0.0" || this.host === "::" ? "127.0.0.1" : this.host;
    return {
      host: this.host,
      port: address.port,
      basePath: this.basePath,
      endpoint: `http://${displayHost.includes(":") ? `[${displayHost}]` : displayHost}:${address.port}${this.basePath}`,
    };
  }

  async #shutdown() {
    this.stopping = true;
    try {
      const closePromise = new Promise((resolve, reject) => {
        this.httpServer.close((error) => error ? reject(error) : resolve());
      });
      for (const context of this.requestContexts) {
        context.abort();
      }
      this.httpServer.closeAllConnections?.();
      for (const socket of Array.from(this.sockets)) {
        const socketState = this.socketContexts.get(socket);
        socketState?.abort();
        socket.destroy();
        socketState?.cleanup();
      }
      const [closeResult] = await Promise.all([
        closePromise.then(
          () => ({ ok: true }),
          (error) => ({ ok: false, error }),
        ),
        Promise.allSettled(Array.from(this.handlerPromises)),
      ]);
      if (!closeResult.ok) {
        throw closeResult.error;
      }
      this.rateWindows.clear();
      this.nextTransferAt = 0;
    } finally {
      this.stopping = false;
    }
  }

  stop() {
    if (this.stopPromise) {
      return this.stopPromise;
    }
    if (!this.httpServer.listening) {
      return Promise.resolve();
    }
    const operation = this.#shutdown();
    const tracked = operation.finally(() => {
      if (this.stopPromise === tracked) {
        this.stopPromise = null;
      }
    });
    this.stopPromise = tracked;
    return tracked;
  }
}
