import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { open, rename, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { loadLaunchSettings } from "../src/launch-settings.mjs";
import { cleanup, temporaryRoot } from "./helpers.mjs";

function launchSettings(projectId = "original-project") {
  return {
    schemaVersion: 1,
    serverAddress: "https://teamforge.example.com/base",
    realtimePath: "ws",
    projectId,
    sessionId: "session",
    projectUuid: randomUUID(),
    sourceProjectRelativePath: "",
    projectDescriptorRelativePath: "",
    managedProjectsRelativePath: "managed",
    realtimeProtocolVersion: 1,
    transferProtocolVersion: 1,
    manifestSchemaVersion: 1,
    authenticationTokenEnvironmentVariable: "TEAMFORGE_AUTH_TOKEN",
    ownerKeyEnvironmentVariable: "TEAMFORGE_OWNER_PRIVATE_KEY",
    allowCurrentProjectAsSeedSource: false,
  };
}

// A path replacement after the file has been opened must not redirect its read.
test("launch settings reject a final-path swap after opening the original file", async (t) => {
  if (process.platform === "win32") {
    t.skip("Symlink replacement fixture is POSIX-only");
    return;
  }
  const root = await temporaryRoot();
  try {
    const destination = path.join(root, "launch.json");
    const alternate = path.join(root, "alternate.json");
    const moved = path.join(root, "moved.json");
    await writeFile(destination, JSON.stringify(launchSettings()));
    await writeFile(alternate, JSON.stringify(launchSettings("swapped-project")));
    const probe = await open(path.join(root, "probe"), "wx");
    const prototype = Object.getPrototypeOf(probe);
    await probe.close();
    const originalStat = prototype.stat;
    let swapped = false;
    t.mock.method(prototype, "stat", async function (...args) {
      const info = await originalStat.call(this, ...args);
      if (!swapped && info.isFile()) {
        swapped = true;
        await rename(destination, moved);
        await symlink(alternate, destination);
      }
      return info;
    });
    await assert.rejects(loadLaunchSettings(destination), { code: "invalid_launch_settings_file" });
    assert.equal(swapped, true, "Fixture must replace path after open and before read");
  } finally {
    t.mock.restoreAll();
    await cleanup(root);
  }
});

test("launch settings reject file growth after the opened-file size check", async (t) => {
  const root = await temporaryRoot();
  try {
    const destination = path.join(root, "launch.json");
    await writeFile(destination, JSON.stringify(launchSettings()));
    const probe = await open(path.join(root, "probe"), "wx");
    const prototype = Object.getPrototypeOf(probe);
    await probe.close();
    const originalStat = prototype.stat;
    let grew = false;
    t.mock.method(prototype, "stat", async function (...args) {
      const info = await originalStat.call(this, ...args);
      if (!grew && info.isFile()) {
        grew = true;
        await writeFile(destination, Buffer.alloc(65_537, 0x20));
      }
      return info;
    });
    await assert.rejects(loadLaunchSettings(destination), { code: "invalid_launch_settings_file" });
    assert.equal(grew, true, "Fixture must grow the file after the size check");
  } finally {
    t.mock.restoreAll();
    await cleanup(root);
  }
});

test("launch settings inspection errors never expose a private file path", async () => {
  const root = await temporaryRoot();
  try {
    const canary = "PRIVATE_PATH_SYNTHETIC_CANARY";
    const missing = path.join(root, canary, "launch.json");
    await assert.rejects(loadLaunchSettings(missing), (error) => {
      assert.equal(error.code, "launch_settings_load_failed");
      assert.equal(error.message.includes(canary), false);
      return true;
    });
  } finally {
    await cleanup(root);
  }
});

test("launch settings preserve valid JSON across short file reads", async (t) => {
  const root = await temporaryRoot();
  try {
    const destination = path.join(root, "launch.json");
    await writeFile(destination, JSON.stringify(launchSettings()));
    const probe = await open(path.join(root, "probe"), "wx");
    const prototype = Object.getPrototypeOf(probe);
    await probe.close();
    const originalRead = prototype.read;
    let reads = 0;
    t.mock.method(prototype, "read", async function (buffer, offset, length, position) {
      reads += 1;
      return originalRead.call(this, buffer, offset, Math.min(length, 7), position);
    });
    const result = await loadLaunchSettings(destination);
    assert.equal(result.settings.projectId, "original-project");
    assert.ok(reads > 2, "Fixture must exercise multiple short reads");
  } finally {
    t.mock.restoreAll();
    await cleanup(root);
  }
});

test("launch settings reject an existing symlink without reading its target", async (t) => {
  if (process.platform === "win32") {
    t.skip("Windows CI may not permit symlink creation without Developer Mode");
    return;
  }
  const root = await temporaryRoot();
  try {
    const target = path.join(root, "target.json");
    const destination = path.join(root, "launch.json");
    await writeFile(target, JSON.stringify(launchSettings()));
    await symlink(target, destination);
    await assert.rejects(loadLaunchSettings(destination), { code: "invalid_launch_settings_file" });
  } finally {
    await cleanup(root);
  }
});
