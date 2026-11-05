import assert from "node:assert/strict";
import test from "node:test";
import { createTransferSourceError, transferSourceErrorInfo } from "../src/transfer-source.mjs";

test("normalized transfer diagnostics reject untrusted oversized and control-character codes", () => {
  const malicious = `secret-token-${"X".repeat(16_384)}\nsecond-line`;
  const info = transferSourceErrorInfo(createTransferSourceError(malicious, "ignored", {
    retryable: true,
    diagnostics: { networkCode: malicious, serverErrorCode: malicious, httpStatus: 503 },
  }));
  assert.equal(info.errorKind, "peer_failure");
  assert.equal(info.diagnostics.networkCode, "");
  assert.equal(info.diagnostics.serverErrorCode, "");
  assert.equal(info.diagnostics.httpStatus, 503);
  assert.equal(info.retryable, true);
});

test("legacy transfer errors do not copy arbitrary codes into public diagnostics", () => {
  const info = transferSourceErrorInfo({
    code: "sensitive\r\nheader: value",
    details: { retryable: true, networkCode: "ECONNRESET\nspoof", serverErrorCode: "token=secret" },
  });
  assert.equal(info.errorKind, "peer_failure");
  assert.equal(info.diagnostics.networkCode, "");
  assert.equal(info.diagnostics.serverErrorCode, "");
  assert.equal(info.retryable, true);
});

test("valid transfer diagnostic codes and retry classifications are unchanged", () => {
  const info = transferSourceErrorInfo(createTransferSourceError("peer_http_error", "HTTP 503", {
    retryable: true,
    retryAfterMilliseconds: 200,
    diagnostics: { httpStatus: 503, networkCode: "ECONNRESET", serverErrorCode: "transfer_busy" },
  }));
  assert.equal(info.errorKind, "peer_http_error");
  assert.deepEqual(info.diagnostics, { httpStatus: 503, networkCode: "ECONNRESET", serverErrorCode: "transfer_busy" });
  assert.equal(info.retryAfterMilliseconds, 200);
  assert.equal(transferSourceErrorInfo({ code: "ENOSPC" }).errorKind, "ENOSPC");
});


test("valid digit- and underscore-prefixed server diagnostics survive normalization", () => {
  for (const code of ["0_busy", "_busy", "9", "_"]) {
    const info = transferSourceErrorInfo(createTransferSourceError("peer_http_error", "HTTP error", {
      diagnostics: { serverErrorCode: code },
    }));
    assert.equal(info.diagnostics.serverErrorCode, code);
  }
  for (const code of ["Bad", "-busy", "a".repeat(65), "line\nbreak"]) {
    const info = transferSourceErrorInfo(createTransferSourceError("peer_http_error", "HTTP error", {
      diagnostics: { serverErrorCode: code },
    }));
    assert.equal(info.diagnostics.serverErrorCode, "");
  }
});


test("valid digit- and underscore-prefixed network diagnostic codes survive normalization", () => {
  for (const code of ["0_NETWORK", "_NETWORK", "9", "_"]) {
    const info = transferSourceErrorInfo(createTransferSourceError("peer_network_error", "Network error", {
      diagnostics: { networkCode: code },
    }));
    assert.equal(info.diagnostics.networkCode, code);
  }
  for (const code of ["lower", "-BAD", "A".repeat(65), "line\nbreak"]) {
    const info = transferSourceErrorInfo(createTransferSourceError("peer_network_error", "Network error", {
      diagnostics: { networkCode: code },
    }));
    assert.equal(info.diagnostics.networkCode, "");
  }
});
