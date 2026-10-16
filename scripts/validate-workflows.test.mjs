import assert from "node:assert/strict";
import test from "node:test";
import { assertCacheAccessPolicy } from "./validate-workflows.mjs";

const guarded = "cache-mode: ${{ github.event_name == 'push' && 'write' || 'read' }}";
const mainPush = "on:\n  push:\n    branches: [main]\n  pull_request:\n";
const cachedJob = "jobs:\n  check:\n    steps:\n      - uses: actions/setup-node@fixed\n        with:\n          cache: npm\n";
const asWorkflow = (header = guarded, event = mainPush, jobs = cachedJob) =>
  event + "permissions:\n  contents: read\n" + header + "\n" + jobs;

test("npm caches stay read-only outside trusted main pushes", () => {
  assert.doesNotThrow(() => assertCacheAccessPolicy(asWorkflow(), "safe.yml"));
  assert.doesNotThrow(() => assertCacheAccessPolicy(
    asWorkflow(guarded, mainPush, cachedJob.replace("jobs:", "jobs:\n  # comment") ),
    "comment.yml"));
});

test("npm-cache workflows must explicitly bound writes", () => {
  for (const header of ["", "cache-mode: read", "cache-mode: write",
    "cache-mode: write-only", "cache-mode: ${{ 'write' }}"]) {
    assert.throws(() => assertCacheAccessPolicy(asWorkflow(header), "bad.yml"),
      /npm caching must allow write only on trusted main pushes/u);
  }
});

test("cache writer permission cannot broaden beyond main branch", () => {
  for (const event of [
    "on:\n  push:\n    branches: [develop]\n  pull_request:\n",
    "on:\n  pull_request:\n",
    "on:\n  workflow_dispatch:\n",
  ]) assert.throws(() => assertCacheAccessPolicy(asWorkflow(guarded, event), "unsafe.yml"),
    /requires push restricted to main/u);
});

test("a job-level override cannot bypass the trusted-push guard", () => {
  for (const mode of ["write", "write-only", "${{ 'write' }}"]) {
    assert.throws(() => assertCacheAccessPolicy(asWorkflow(
      guarded, mainPush, "jobs:\n  check:\n    cache-mode: " + mode + "\n    steps:\n      - with:\n          cache: npm\n",
    ), "override.yml"), /job-level cache overrides/u);
  }
  assert.doesNotThrow(() => assertCacheAccessPolicy(asWorkflow(
    guarded, mainPush, "jobs:\n  check:\n    cache-mode: read\n    steps:\n      - with:\n          cache: npm\n",
  ), "read-override.yml"));
});

test("workflows without npm caching cannot grant broad cache writes", () => {
  const withoutCache = "jobs:\n  check:\n    steps:\n      - run: echo ok\n";
  for (const mode of ["cache-mode: read", "cache-mode: none", ""]) {
    assert.doesNotThrow(() => assertCacheAccessPolicy(
      asWorkflow(mode, mainPush, withoutCache), "uncached.yml"));
  }
  assert.throws(() => assertCacheAccessPolicy(
    asWorkflow("cache-mode: write", mainPush, withoutCache), "uncached.yml"),
  /without npm cache must not grant cache writes/u);
});
