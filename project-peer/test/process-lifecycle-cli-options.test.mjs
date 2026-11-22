import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { TeamForgeProcessLifecycleManager } from "../src/process-lifecycle.mjs";

const workspaceRoot = path.resolve(".");
const absoluteRoot = path.resolve("safe-root");
const absoluteLaunch = path.resolve("safe-launch.json");
const expectedIdentity = {
  projectId: "lifecycle-validation",
  projectUuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  sessionId: "validation",
  baselineRevision: 1,
  manifestHash: "b".repeat(64),
};

function rejectingManager() {
  return new TeamForgeProcessLifecycleManager({
    workspaceRoot,
    // Invalid argv must be rejected before any preflight, fork, or disk work.
    preflight: () => { throw new Error("unsafe arguments reached preflight"); },
  });
}

test("lifecycle Seed rejects options that differ between validation and CLI execution", async () => {
  const cases = [
    ["seed", "--port", "0", "--port", "5081"],
    ["seed", "--port=0", "--port=5081"],
    ["seed", "--port", "0", `--managed-root=${absoluteRoot}`, "--managed-root=relative"],
    ["seed", "--port", "0", "--once=true"],
    ["seed", "--port", "0", "--once=false"],
    ["seed", "--port", "0", "--once="],
    ["seed", "--port", "0", "--managed-root"],
    ["seed", "--port", "0", "unexpected-positional"],
  ];
  for (const args of cases) {
    await assert.rejects(
      rejectingManager().ensureSeed({ arguments: args, expectedIdentity }),
      { code: "invalid_seed_lifecycle_command" },
      args.join(" "),
    );
  }
});

test("lifecycle Publish rejects duplicate and equals-form restricted options", async () => {
  const base = ["publish", "--port", "0", `--launch-settings=${absoluteLaunch}`];
  const cases = [
    [...base, "--port=5081"],
    [...base, "--launch-settings=relative"],
    [...base, "--once=true"],
    [...base, "--confirm-publish=true"],
    [...base, "--confirm-publish=false"],
    [...base, "unexpected-positional"],
  ];
  for (const args of cases) {
    await assert.rejects(
      rejectingManager().ensurePublishingSeed({
        arguments: args,
        expectedIdentity,
        publishReviewFingerprint: "a".repeat(64),
      }),
      { code: "invalid_seed_lifecycle_command" },
      args.join(" "),
    );
  }
});

test("well-formed Seed and Publish lifecycle arguments reach runtime preflight", async () => {
  const seed = ["seed", "--port", "0", `--managed-root=${absoluteRoot}`];
  const publish = ["publish", "--port=0", `--launch-settings=${absoluteLaunch}`];
  await assert.rejects(rejectingManager().ensureSeed({
    arguments: seed, expectedIdentity,
  }), /unsafe arguments reached preflight/);
  await assert.rejects(rejectingManager().ensurePublishingSeed({
    arguments: publish, expectedIdentity, publishReviewFingerprint: "a".repeat(64),
  }), /unsafe arguments reached preflight/);
});