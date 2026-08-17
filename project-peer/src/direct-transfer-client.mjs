import { MAXIMUM_CHUNK_SIZE, SHA256_PATTERN, UUID_PATTERN } from "./constants.mjs";
import { sha256 } from "./hash.mjs";
import { fail, TeamForgePeerError } from "./errors.mjs";
import {
  assertProjectTransferSource,
  createTransferSourceError,
  MAXIMUM_SOURCE_RETRY_AFTER_MILLISECONDS,
} from "./transfer-source.mjs";
import { LEGACY_TRANSFER_DEFAULTS } from "./policy-profile.mjs";

const TRANSIENT_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "ENETDOWN", "ENETRESET",
  "ENETUNREACH", "EHOSTDOWN", "EHOSTUNREACH", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET",
]);

function normalizeEndpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("invalid_peer_endpoint", `Direct peer endpoint is not a valid URL: ${value}`);
  }
  if (!/^https?:$/u.test(url.protocol) || url.username || url.password || url.search || url.hash) {
    fail("invalid_peer_endpoint", "Direct peer endpoint must be an HTTP(S) URL without credentials/query/fragment.");
  }
  url.pathname = url.pathname.replace(/\/+$/u, "");
  return url;
}

async function readBounded(response, maximumBytes) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    await response.body?.cancel().catch(() => {});
    fail("peer_response_too_large", `Peer response exceeds ${maximumBytes} bytes.`);
  }
  if (!response.body) {
    return Buffer.alloc(0);
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > maximumBytes) {
      await response.body.cancel().catch(() => {});
      fail("peer_response_too_large", `Peer response exceeds ${maximumBytes} bytes.`);
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, total);
}

function parseRetryAfter(response) {
  const preciseHeader = response.headers.get("x-teamforge-retry-after-ms");
  const preciseText = preciseHeader?.trim() ?? "";
  const precise = Number(preciseText);
  if (/^\d+(?:\.\d+)?$/u.test(preciseText) && Number.isFinite(precise)) {
    return Math.min(MAXIMUM_SOURCE_RETRY_AFTER_MILLISECONDS, Math.ceil(precise));
  }
  const value = response.headers.get("retry-after");
  if (!value) {
    return 0;
  }
  const deltaText = value.trim();
  const deltaSeconds = Number(deltaText);
  if (/^\d+$/u.test(deltaText) && Number.isFinite(deltaSeconds)) {
    return Math.min(MAXIMUM_SOURCE_RETRY_AFTER_MILLISECONDS, Math.ceil(deltaSeconds * 1_000));
  }
  const date = Date.parse(deltaText);
  if (!Number.isFinite(date)) {
    return 0;
  }
  return Math.min(MAXIMUM_SOURCE_RETRY_AFTER_MILLISECONDS, Math.max(0, date - Date.now()));
}

function responseErrorCode(bytes) {
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    return typeof value?.error === "string" && /^[a-z0-9_]{1,64}$/u.test(value.error)
      ? value.error
      : "";
  } catch {
    return "";
  }
}

function networkCode(error) {
  for (const value of [error?.code, error?.cause?.code]) {
    if (typeof value === "string" && /^[A-Z0-9_]{1,64}$/u.test(value)) {
      return value;
    }
  }
  return "";
}

export class DirectTransferClient {
  constructor({
    endpoint,
    transferToken,
    sessionId,
    projectUuid,
    manifestHash,
    timeoutMilliseconds = LEGACY_TRANSFER_DEFAULTS.timeoutMilliseconds,
    maxJsonBytes = LEGACY_TRANSFER_DEFAULTS.maxJsonBytes,
    maxChunkBytes = LEGACY_TRANSFER_DEFAULTS.maxChunkBytes,
    fetchImplementation = globalThis.fetch,
  }) {
    if (typeof fetchImplementation !== "function") {
      fail("fetch_unavailable", "Node.js fetch implementation is unavailable.");
    }
    if (typeof transferToken !== "string" || transferToken.length < 16 || transferToken.length > 512 ||
        typeof sessionId !== "string" || sessionId.trim().length === 0 || sessionId.length > 128 ||
        /[\u0000-\u001f\u007f]/u.test(sessionId) ||
        !UUID_PATTERN.test(projectUuid ?? "") || !SHA256_PATTERN.test(manifestHash ?? "") ||
        !Number.isInteger(timeoutMilliseconds) || timeoutMilliseconds < 100 || timeoutMilliseconds > 300_000) {
      fail("invalid_peer_configuration", "Direct transfer peer configuration is invalid.");
    }
    this.endpoint = normalizeEndpoint(endpoint);
    this.transferToken = transferToken;
    this.sessionId = sessionId.trim();
    this.projectUuid = projectUuid.toLowerCase();
    this.manifestHash = manifestHash;
    this.timeoutMilliseconds = timeoutMilliseconds;
    this.maxJsonBytes = maxJsonBytes;
    this.maxChunkBytes = maxChunkBytes;
    this.fetchImplementation = fetchImplementation;
    assertProjectTransferSource(this);
  }

  async #request(suffix, maximumBytes, signal = undefined) {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = () => {
      timedOut = true;
      controller.abort();
    };
    const cancelled = () => controller.abort();
    const timer = setTimeout(timeout, this.timeoutMilliseconds);
    if (signal?.aborted) cancelled();
    else signal?.addEventListener?.("abort", cancelled, { once: true });
    try {
      const response = await this.fetchImplementation(`${this.endpoint.toString()}${suffix}`, {
        method: "GET",
        headers: {
          authorization: `Bearer ${this.transferToken}`,
          "x-teamforge-project-uuid": this.projectUuid,
          "x-teamforge-manifest-hash": this.manifestHash,
          "x-teamforge-session-id": this.sessionId,
        },
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await readBounded(response, Math.min(65_536, maximumBytes)).catch(() => Buffer.alloc(0));
        const retryable = TRANSIENT_HTTP_STATUS.has(response.status);
        const retryAfterMilliseconds = parseRetryAfter(response);
        const serverErrorCode = responseErrorCode(body);
        throw createTransferSourceError(
          "peer_http_error",
          `Direct peer returned HTTP ${response.status}.`,
          {
            retryable,
            retryAfterMilliseconds,
            diagnostics: {
              httpStatus: response.status,
              serverErrorCode,
            },
            legacyDetails: {
              status: response.status,
              serverErrorCode,
              retryable,
              retryAfterMilliseconds,
            },
          },
        );
      }
      return { response, bytes: await readBounded(response, maximumBytes) };
    } catch (error) {
      if (error?.name === "AbortError") {
        if (signal?.aborted && !timedOut) {
          throw new TeamForgePeerError("download_cancelled", "Project download was cancelled.");
        }
        throw createTransferSourceError(
          "peer_timeout",
          "Direct peer request timed out.",
          {
            retryable: true,
            legacyDetails: { retryable: true, retryAfterMilliseconds: 0 },
          },
        );
      }
      if (error instanceof TeamForgePeerError) {
        throw error;
      }
      const code = networkCode(error);
      if (error instanceof TypeError || TRANSIENT_NETWORK_CODES.has(code)) {
        throw createTransferSourceError(
          "peer_network_error",
          "Direct peer request failed because of a transient network error.",
          {
            retryable: true,
            diagnostics: { networkCode: code },
            legacyDetails: { retryable: true, retryAfterMilliseconds: 0, networkCode: code },
          },
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", cancelled);
    }
  }

  async #json(suffix, signal = undefined) {
    const { response, bytes } = await this.#request(suffix, this.maxJsonBytes, signal);
    if (!(response.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      fail("peer_content_type", "Peer metadata response is not JSON.");
    }
    try {
      return JSON.parse(bytes.toString("utf8"));
    } catch (error) {
      fail("peer_invalid_json", `Peer returned invalid JSON: ${error.message}`);
    }
  }

  descriptor(signal = undefined) {
    return this.#json("/descriptor", signal);
  }

  manifest(signal = undefined) {
    return this.#json(`/manifests/${this.manifestHash}`, signal);
  }

  inventory(signal = undefined) {
    return this.#json(`/inventory/${this.manifestHash}`, signal);
  }

  async chunk(hash, expectedSize, signal = undefined) {
    if (!SHA256_PATTERN.test(hash ?? "") || !Number.isInteger(expectedSize) ||
        expectedSize < 1 || expectedSize > this.maxChunkBytes) {
      fail("invalid_chunk_request", "Chunk request hash or size is invalid.");
    }
    const { response, bytes } = await this.#request(`/chunks/${hash}`, this.maxChunkBytes, signal);
    if (!(response.headers.get("content-type") ?? "").toLowerCase().startsWith("application/octet-stream")) {
      fail("peer_content_type", "Peer chunk response is not application/octet-stream.");
    }
    if (bytes.length !== expectedSize || sha256(bytes) !== hash) {
      fail("peer_chunk_invalid", `Peer returned an invalid chunk for ${hash}.`);
    }
    return bytes;
  }
}

export const DIRECT_TRANSFER_RETRY_POLICY = Object.freeze({
  transientHttpStatus: Array.from(TRANSIENT_HTTP_STATUS).sort((left, right) => left - right),
  maximumRetryAfterMilliseconds: MAXIMUM_SOURCE_RETRY_AFTER_MILLISECONDS,
});
