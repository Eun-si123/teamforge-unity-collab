import assert from "node:assert/strict";
import test from "node:test";
import { assertCacheAccessPolicy } from "./validate-workflows.mjs";

const path = ".github/workflows/authority-chaos-stress.yml";
const fixture = (mode = "cache-mode: read", job = "") =>
  "on:\n  push:\n    branches: [main]\n  pull_request:\n" + mode +
  "\npermissions:\n  contents: read\njobs:\n  stress:\n" + job +
  "    steps:\n      - with:\n          cache: npm\n";

test("chaos stress is explicitly read-only even on trusted pushes", () => {
  assert.doesNotThrow(() => assertCacheAccessPolicy(fixture(), path));
  assert.throws(() => assertCacheAccessPolicy(fixture(""), path), /must prevent cache saves/u);
  assert.throws(() => assertCacheAccessPolicy(fixture("cache-mode: none"), path),
    /must prevent cache saves/u);
});

test("a cache-mode override must not bypass the low-trust default", () => {
  for (const mode of ["write", "write-only", "${{ github.event_name == 'push' && 'write' || 'read' }}"]) {
    assert.throws(() => assertCacheAccessPolicy(fixture("cache-mode: " + mode), "unsafe.yml"),
      /must not explicitly bypass/u);
    assert.throws(() => assertCacheAccessPolicy(fixture("cache-mode: read",
      "    cache-mode: " + mode + "\n"), "unsafe.yml"), /must not explicitly bypass/u);
  }
});

test("omitted cache-mode retains GitHub trigger-derived secure defaults", () => {
  assert.doesNotThrow(() => assertCacheAccessPolicy(fixture(""), "ordinary.yml"));
  assert.doesNotThrow(() => assertCacheAccessPolicy(fixture("cache-mode: read"), "ordinary.yml"));
  assert.doesNotThrow(() => assertCacheAccessPolicy(fixture("cache-mode: none"), "ordinary.yml"));
  assert.doesNotThrow(() => assertCacheAccessPolicy(fixture("cache-mode: read",
    "    cache-mode: none\n"), "ordinary.yml"));
});

test("commented-out or malformed overrides cannot satisfy explicit read-only policy", () => {
  assert.throws(() => assertCacheAccessPolicy(fixture("# cache-mode: read"), path),
    /must prevent cache saves/u);
  assert.throws(() => assertCacheAccessPolicy(fixture("cache-mode: write\ncache-mode: read"), path),
    /must not explicitly bypass/u);
});
