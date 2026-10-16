import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
const script = fileURLToPath(new URL("../scripts/benchmark-transfer.mjs", import.meta.url));

test("loopback benchmark verifies real transfers, resume, failover and bounded JSON evidence", async () => {
  const { stdout, stderr } = await execute(process.execPath, [script, "--smoke"], { timeout: 45_000 });
  assert.equal(stderr, "");
  const report = JSON.parse(stdout);
  assert.equal(report.scope, "loopback-diagnostic");
  assert.equal(report.configuration.peerSelectionMode, "balanced");
  assert.equal(report.configuration.chunkOrder, "manifest");
  assert.equal(report.runs.length, 4);
  assert.equal(report.summary.length, 4);
  for (const run of report.runs) {
    assert.equal(run.integrityVerified, true);
    assert.ok(run.elapsedMilliseconds > 0);
    assert.equal(run.transferredBytes + run.resumedBytes, run.uniqueBytes);
    assert.equal(run.peers.reduce((sum, peer) => sum + peer.verifiedBytes, 0), run.transferredBytes);
    assert.ok(Number.isFinite(run.transferredBytesPerSecond));
    assert.ok(run.peers.every((peer) => Number.isFinite(peer.requestServiceBytesPerSecond)));
  }
  const resumed = report.runs.find((run) => run.scenario === "two-seeds-resume");
  assert.ok(resumed.resumedBytes > 0);
  const failed = report.runs.find((run) => run.scenario === "two-seeds-source-loss");
  assert.ok(failed.injectedFailures > 0);
  assert.ok(failed.failureCount > 0);
  assert.equal(failed.peers[0].verifiedBytes, 0);
  assert.ok(failed.peers[1].verifiedBytes > 0);
  assert.equal(stdout.includes("127.0.0.1"), false);
  assert.equal(stdout.includes("transferToken"), false);
});

test("benchmark rejects an excessive work budget before starting", async () => {
  await assert.rejects(execute(process.execPath, [script, "--size-mib", "10000"]), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /assetBytes must be/);
    return true;
  });
});


test("benchmark can compare opt-in verified-throughput under the same bounded scenarios", async () => {
  const { stdout, stderr } = await execute(process.execPath,
    [script, "--smoke", "--peer-selection", "verified-throughput"], { timeout: 45_000 });
  assert.equal(stderr, "");
  const report = JSON.parse(stdout);
  assert.equal(report.configuration.peerSelectionMode, "verified-throughput");
  assert.equal(report.runs.length, 4);
  assert.ok(report.runs.every(run => run.integrityVerified &&
    run.transferredBytes + run.resumedBytes === run.uniqueBytes));
  assert.equal(stdout.includes("transferToken"), false);
});

test("benchmark rejects unsupported peer scheduling without producing a fixture", async () => {
  await assert.rejects(execute(process.execPath, [script, "--smoke", "--peer-selection", "guess"]), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /peerSelectionMode must be balanced or verified-throughput/);
    return true;
  });
});

test("benchmark compares rarest-first with verified-throughput mode in bounded loopback", async () => {
  const { stdout, stderr } = await execute(process.execPath, [
    script, "--smoke", "--chunk-order", "rarest-first",
    "--peer-selection", "verified-throughput",
  ], { timeout: 45_000 });
  assert.equal(stderr, "");
  const report = JSON.parse(stdout);
  assert.equal(report.configuration.peerSelectionMode, "verified-throughput");
  assert.equal(report.configuration.chunkOrder, "rarest-first");
  assert.equal(report.runs.length, 4);
  assert(report.runs.every(run => run.integrityVerified &&
    run.transferredBytes + run.resumedBytes === run.uniqueBytes));
});

test("benchmark refuses unsupported chunk priority before any transfer begins", async () => {
  await assert.rejects(execute(process.execPath,
    [script, "--smoke", "--chunk-order", "untrusted-order"]), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /chunkOrder must be manifest or rarest-first/);
    return true;
  });
});
