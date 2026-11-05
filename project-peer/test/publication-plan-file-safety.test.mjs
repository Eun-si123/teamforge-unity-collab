import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFile, open, rename, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { launchSettingsDigest } from "../src/publication-plan.mjs";
import { cleanup, temporaryRoot } from "./helpers.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function fileHandlePrototype(root) {
  const probe = await open(path.join(root, "probe"), "wx");
  const prototype = Object.getPrototypeOf(probe);
  await probe.close();
  return prototype;
}

test("publish review hashes unchanged launch settings bytes exactly", async () => {
  const root = await temporaryRoot();
  try {
    const file = path.join(root, "launch.json");
    const bytes = Buffer.from("{\"example\":\"safe\"}\n");
    await writeFile(file, bytes);
    assert.equal(await launchSettingsDigest(file), sha256(bytes));
  } finally {
    await cleanup(root);
  }
});

test("publish review refuses an oversized launch file substituted after the initial load", async () => {
  const root = await temporaryRoot();
  try {
    const file = path.join(root, "launch.json");
    await writeFile(file, "{}");
    await writeFile(file, Buffer.alloc(65_537, 0x20));
    await assert.rejects(launchSettingsDigest(file), { code: "invalid_launch_settings_file" });
  } finally {
    await cleanup(root);
  }
});

test("publish review refuses a symbolic-link replacement", async (t) => {
  if (process.platform === "win32") return t.skip("Windows symlink creation needs special permissions");
  const root = await temporaryRoot();
  try {
    const file = path.join(root, "launch.json");
    const target = path.join(root, "alternate.json");
    await writeFile(target, "{}");
    await symlink(target, file);
    await assert.rejects(launchSettingsDigest(file), { code: "invalid_launch_settings_file" });
  } finally {
    await cleanup(root);
  }
});

test("publish review refuses an opened-file path replacement before hashing", async (t) => {
  if (process.platform === "win32") return t.skip("POSIX path replacement fixture");
  const root = await temporaryRoot();
  try {
    const file = path.join(root, "launch.json");
    const alternate = path.join(root, "alternate.json");
    const moved = path.join(root, "moved.json");
    await writeFile(file, "{\"project\":\"original\"}");
    await writeFile(alternate, "{\"project\":\"changed\"}");
    const prototype = await fileHandlePrototype(root);
    const originalStat = prototype.stat;
    let replaced = false;
    t.mock.method(prototype, "stat", async function (...args) {
      const result = await originalStat.call(this, ...args);
      if (!replaced && result.isFile()) {
        replaced = true;
        await rename(file, moved);
        await symlink(alternate, file);
      }
      return result;
    });
    await assert.rejects(launchSettingsDigest(file), { code: "invalid_launch_settings_file" });
    assert.equal(replaced, true);
  } finally {
    t.mock.restoreAll();
    await cleanup(root);
  }
});

test("publish review rejects file growth after the opened-file size check", async (t) => {
  const root = await temporaryRoot();
  try {
    const file = path.join(root, "launch.json");
    await writeFile(file, "{}");
    const prototype = await fileHandlePrototype(root);
    const originalStat = prototype.stat;
    let grew = false;
    t.mock.method(prototype, "stat", async function (...args) {
      const result = await originalStat.call(this, ...args);
      if (!grew && result.isFile()) {
        grew = true;
        await appendFile(file, Buffer.alloc(65_537, 0x20));
      }
      return result;
    });
    await assert.rejects(launchSettingsDigest(file), { code: "invalid_launch_settings_file" });
    assert.equal(grew, true);
  } finally {
    t.mock.restoreAll();
    await cleanup(root);
  }
});

test("publish review hashes correctly across short file reads", async (t) => {
  const root = await temporaryRoot();
  try {
    const file = path.join(root, "launch.json");
    const bytes = Buffer.from("{\"project\":\"short-read-fixture\"}\n");
    await writeFile(file, bytes);
    const prototype = await fileHandlePrototype(root);
    const originalRead = prototype.read;
    let reads = 0;
    t.mock.method(prototype, "read", async function (buffer, offset, length, position) {
      reads += 1;
      return originalRead.call(this, buffer, offset, Math.min(length, 3), position);
    });
    assert.equal(await launchSettingsDigest(file), sha256(bytes));
    assert.ok(reads > 2);
  } finally {
    t.mock.restoreAll();
    await cleanup(root);
  }
});

test("publish review does not expose private filesystem paths in read errors", async () => {
  const root = await temporaryRoot();
  try {
    const canary = "SYNTHETIC_PRIVATE_PATH_CANARY";
    await assert.rejects(launchSettingsDigest(path.join(root, canary)), (error) => {
      assert.equal(error.code, "launch_settings_load_failed");
      assert.equal(error.message.includes(root), false);
      assert.equal(error.message.includes(canary), false);
      return true;
    });
  } finally {
    await cleanup(root);
  }
});


test("publish review digest retains exact BigInt inode and nanosecond metadata", async (t) => {
  const root = await temporaryRoot();
  try {
    const file = path.join(root, "launch.json");
    const bytes = Buffer.from("{\"project\":\"bigint-identity\"}");
    await writeFile(file, bytes);
    const prototype = await fileHandlePrototype(root);
    const originalStat = prototype.stat;
    let inspected = 0;
    t.mock.method(prototype, "stat", async function (options) {
      assert.equal(options?.bigint, true);
      const result = await originalStat.call(this, options);
      assert.equal(typeof result.ino, "bigint");
      assert.equal(typeof result.mtimeNs, "bigint");
      inspected += 1;
      return result;
    });
    assert.equal(await launchSettingsDigest(file), sha256(bytes));
    assert.equal(inspected, 2);
  } finally {
    t.mock.restoreAll();
    await cleanup(root);
  }
});
