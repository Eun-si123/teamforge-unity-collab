import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyLauncherRuntime } from "../runtime-loader.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "teamforge-launcher-runtime-"));
  const files = new Map([
    ["backend/project-peer/src/guest-orchestrator-cli.mjs", Buffer.from("export async function runGuestBridge() {}\n")],
    ["platforms/win-x64/node.exe", Buffer.from("test-node-placeholder\n")],
  ]);
  for (const [relative, bytes] of files) {
    const destination = path.join(root, ...relative.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
  const manifest = {
    schemaVersion: 1,
    backendContractVersion: 1,
    guestBridgeRelativePath: "backend/project-peer/src/guest-orchestrator-cli.mjs",
    files: [...files].map(([relative, bytes]) => ({ path: relative, size: bytes.length, sha256: sha(bytes) })),
  };
  const manifestPath = path.join(root, "runtime-manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  return { root, manifest, manifestPath, manifestHash: sha(await readFile(manifestPath)) };
}

test("WP4 Launcher loader accepts only a complete manifest-pinned app-owned Runtime", async () => {
  const source = await fixture();
  try {
    const verified = await verifyLauncherRuntime(source.root, source.manifestHash);
    assert.equal(verified.root, source.root);
    assert.equal(verified.manifest.guestBridgeRelativePath, source.manifest.guestBridgeRelativePath);
  } finally {
    await rm(source.root, { recursive: true, force: true });
  }
});

test("WP4 Launcher loader rejects corrupt, missing, unmanifested, and traversal Runtime content", async () => {
  for (const mutate of [
    async ({ root }) => writeFile(path.join(root, "platforms", "win-x64", "node.exe"), "tampered\n"),
    async ({ root }) => rm(path.join(root, "platforms", "win-x64", "node.exe")),
    async ({ root }) => writeFile(path.join(root, "unexpected.js"), "unmanifested\n"),
    async ({ manifest, manifestPath }) => {
      manifest.files[0].path = "../guest-orchestrator-cli.mjs";
      await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
    },
  ]) {
    const source = await fixture();
    try {
      await mutate(source);
      const expectedHash = sha(await readFile(source.manifestPath));
      await assert.rejects(
        () => verifyLauncherRuntime(source.root, expectedHash),
        { code: "runtime_verification_failed" },
      );
    } finally {
      await rm(source.root, { recursive: true, force: true });
    }
  }
});

test("WP4 Launcher loader rejects a manifest that differs from the compiled product pin", async () => {
  const source = await fixture();
  try {
    await assert.rejects(
      () => verifyLauncherRuntime(source.root, "0".repeat(64)),
      { code: "runtime_verification_failed" },
    );
  } finally {
    await rm(source.root, { recursive: true, force: true });
  }
});

test("WP4 Launcher loader normalizes missing or malformed arguments", async () => {
  for (const [runtimeRoot, expectedHash] of [
    [undefined, undefined],
    ["relative-runtime", "0".repeat(64)],
    [path.resolve("Runtime"), "not-a-hash"],
  ]) {
    await assert.rejects(
      () => verifyLauncherRuntime(runtimeRoot, expectedHash),
      { code: "runtime_verification_failed", message: "Launcher runtime arguments are invalid." },
    );
  }
});
