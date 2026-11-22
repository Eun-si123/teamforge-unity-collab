import assert from "node:assert/strict";
import test from "node:test";
import { SwarmDownloader } from "../src/swarm-downloader.mjs";

const store = Object.freeze({ has: async () => false, put: async () => {} });

test("Swarm retry jitter refuses NaN instead of disabling finite retry cooldowns", () => {
  for (const invalid of [NaN, Infinity, -Infinity, -0.1, 0.51, "0.2", null]) {
    assert.throws(() => new SwarmDownloader({ store, retryJitterRatio: invalid }),
      { code: "invalid_download_limits" }, `jitter=${String(invalid)}`);
  }
  for (const valid of [0, 0.2, 0.5]) {
    assert.doesNotThrow(() => new SwarmDownloader({ store, retryJitterRatio: valid }));
  }
});

test("Swarm request deadline uses the same strict bounds as DirectTransferClient", () => {
  for (const invalid of [NaN, Infinity, -Infinity, 0, 1, 99, 300001, 500.5, "10000", null, false]) {
    assert.throws(() => new SwarmDownloader({ store, timeoutMilliseconds: invalid }),
      { code: "invalid_download_limits" }, `timeout=${String(invalid)}`);
  }
  for (const valid of [100, 10_000, 300_000]) {
    assert.doesNotThrow(() => new SwarmDownloader({ store, timeoutMilliseconds: valid }));
  }
  assert.equal(new SwarmDownloader({ store }).timeoutMilliseconds, 10_000);
});