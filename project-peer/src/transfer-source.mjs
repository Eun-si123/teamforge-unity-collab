import { TeamForgePeerError, fail } from "./errors.mjs";

export const PROJECT_TRANSFER_SOURCE_CONTRACT = Object.freeze({
  version: 1,
  methods: Object.freeze(["descriptor", "manifest", "inventory", "chunk"]),
});

export const MAXIMUM_SOURCE_RETRY_AFTER_MILLISECONDS = 60_000;

const RETRYABLE_ERROR_CODES = new Set([
  "peer_http_error",
  "peer_network_error",
  "peer_timeout",
]);
const NORMALIZED_SOURCE_ERROR = Symbol("teamforge.project-transfer-source-error");

function boundedRetryAfter(value) {
  return Number.isFinite(value)
    ? Math.min(
      MAXIMUM_SOURCE_RETRY_AFTER_MILLISECONDS,
      Math.max(0, Math.ceil(value)),
    )
    : 0;
}

function safeDiagnostics(value = {}) {
  return Object.freeze({
    httpStatus: Number.isInteger(value.httpStatus) ? value.httpStatus : 0,
    networkCode: typeof value.networkCode === "string" ? value.networkCode : "",
    serverErrorCode: typeof value.serverErrorCode === "string" ? value.serverErrorCode : "",
  });
}

export function assertProjectTransferSource(source) {
  if (!source || PROJECT_TRANSFER_SOURCE_CONTRACT.methods.some((method) =>
    typeof source[method] !== "function")) {
    fail(
      "invalid_transfer_source",
      "Project Transfer Source must provide descriptor, manifest, inventory, and chunk operations.",
    );
  }
  return source;
}

export function createTransferSourceError(code, message, {
  retryable = false,
  retryAfterMilliseconds = 0,
  diagnostics = undefined,
  legacyDetails = undefined,
} = {}) {
  const error = new TeamForgePeerError(code, message, legacyDetails);
  Object.defineProperty(error, NORMALIZED_SOURCE_ERROR, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      errorKind: code,
      retryable: retryable === true,
      retryAfterMilliseconds: boundedRetryAfter(retryAfterMilliseconds),
      diagnostics: safeDiagnostics(diagnostics),
    }),
  });
  return error;
}

export function transferSourceErrorInfo(error) {
  const normalized = error?.[NORMALIZED_SOURCE_ERROR];
  if (normalized) {
    return normalized;
  }
  const details = error?.details;
  const retryable = details?.retryable === true ||
    (RETRYABLE_ERROR_CODES.has(error?.code) && details?.retryable !== false);
  return Object.freeze({
    errorKind: typeof error?.code === "string" ? error.code : "peer_failure",
    retryable,
    retryAfterMilliseconds: boundedRetryAfter(details?.retryAfterMilliseconds),
    diagnostics: safeDiagnostics({
      httpStatus: details?.status,
      networkCode: details?.networkCode,
      serverErrorCode: details?.serverErrorCode,
    }),
  });
}
