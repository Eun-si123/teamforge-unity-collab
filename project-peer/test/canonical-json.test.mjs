import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson } from "../src/canonical-json.mjs";
import { calculateManifestHash, validateManifest } from "../src/manifest.mjs";

test("canonical JSON includes own __proto__ keys instead of dropping them", () => {
  const parsed = JSON.parse('{"z":1,"__proto__":{"flag":true},"nested":[{"__proto__":"kept","a":2}]}');
  assert.equal(
    canonicalJson(parsed),
    '{"__proto__":{"flag":true},"nested":[{"__proto__":"kept","a":2}],"z":1}',
  );
  assert.equal(Object.hasOwn(parsed, "__proto__"), true);
  assert.equal(Object.hasOwn(Object.prototype, "flag"), false);
});

test("manifest hashes bind own __proto__ metadata and reject a mismatched declared hash", () => {
  const base = {
    manifestSchemaVersion: 1,
    projectUuid: "00000000-0000-4000-8000-000000000000",
    baselineRevision: 1,
    chunkSize: 1_048_576,
    totalFiles: 0,
    totalBytes: 0,
    totalChunks: 0,
    files: [],
  };
  const extra = JSON.parse(JSON.stringify(base));
  Object.defineProperty(extra, "__proto__", {
    value: { unexpected: "unbound metadata" }, enumerable: true,
  });
  const originalHash = calculateManifestHash(base);
  assert.notEqual(calculateManifestHash(extra), originalHash);
  assert.throws(
    () => validateManifest({ ...extra, manifestHash: originalHash }),
    { code: "manifest_hash_mismatch" },
  );
});

test("ordinary canonical JSON ordering and invalid values remain unchanged", () => {
  assert.equal(canonicalJson({ b: 2, a: { z: true, c: null } }), '{"a":{"c":null,"z":true},"b":2}');
  assert.throws(() => canonicalJson({ n: Number.POSITIVE_INFINITY }), { code: "invalid_canonical_number" });
  const cycle = {};
  cycle.self = cycle;
  assert.throws(() => canonicalJson(cycle), { code: "canonical_cycle" });
});
