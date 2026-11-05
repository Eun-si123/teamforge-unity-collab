import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { mkdir, open, rename, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  MANIFEST_SCHEMA_VERSION,
  PRODUCT_VERSION,
  REALTIME_PROTOCOL_VERSION,
  TRANSFER_PROTOCOL_VERSION,
} from "../src/constants.mjs";
import { sha256 } from "../src/hash.mjs";
import {
  assertUnityProjectDescriptorUnchanged,
  readUnityProjectDescriptor,
  UNITY_DESCRIPTOR_RELATIVE_PATH,
} from "../src/unity-project-descriptor.mjs";
import { cleanup, temporaryRoot } from "./helpers.mjs";

function descriptor() {
  return {
    schemaVersion: 1,
    projectUuid: randomUUID(),
    baselineRevision: 0,
    manifestHash: "",
    descriptorHash: "",
    unityVersion: "6000.3.21f1",
    teamForgePackageVersion: PRODUCT_VERSION,
    realtimeProtocolVersion: REALTIME_PROTOCOL_VERSION,
    transferProtocolVersion: TRANSFER_PROTOCOL_VERSION,
    manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
  };
}

async function fixture(root) {
  const destination = path.join(root, ...UNITY_DESCRIPTOR_RELATIVE_PATH.split("/"));
  await mkdir(path.dirname(destination), { recursive: true });
  const bytes = Buffer.from(JSON.stringify(descriptor()));
  await writeFile(destination, bytes);
  return { destination, bytes };
}

async function fileHandlePrototype(root) {
  const handle = await open(path.join(root, "probe"), "wx");
  const prototype = Object.getPrototypeOf(handle);
  await handle.close();
  return prototype;
}

test("Unity descriptor rejects a final-path replacement after the original file was opened", async (t) => {
  if (process.platform === "win32") return t.skip("POSIX symlink replacement fixture");
  const root = await temporaryRoot();
  try {
    const { destination } = await fixture(root);
    const alternate = path.join(root, "alternate.json");
    const moved = path.join(root, "moved.json");
    await writeFile(alternate, JSON.stringify(descriptor()));
    const prototype = await fileHandlePrototype(root);
    const originalStat = prototype.stat;
    let swapped = false;
    t.mock.method(prototype, "stat", async function (...args) {
      const information = await originalStat.call(this, ...args);
      if (!swapped && information.isFile()) {
        swapped = true;
        await rename(destination, moved);
        await symlink(alternate, destination);
      }
      return information;
    });
    await assert.rejects(readUnityProjectDescriptor(root, { required: true }), {
      code: "invalid_unity_descriptor_file",
    });
    assert.equal(swapped, true, "must exercise the opened-file boundary");
  } finally {
    t.mock.restoreAll();
    await cleanup(root);
  }
});

test("Unity descriptor rejects growth after the opened-file size check", async (t) => {
  const root = await temporaryRoot();
  try {
    const { destination } = await fixture(root);
    const prototype = await fileHandlePrototype(root);
    const originalStat = prototype.stat;
    let grew = false;
    t.mock.method(prototype, "stat", async function (...args) {
      const information = await originalStat.call(this, ...args);
      if (!grew && information.isFile()) {
        grew = true;
        await writeFile(destination, Buffer.alloc(65_537, 0x20));
      }
      return information;
    });
    await assert.rejects(readUnityProjectDescriptor(root, { required: true }), {
      code: "unity_descriptor_changed",
    });
    assert.equal(grew, true, "must exercise the post-open size check");
  } finally {
    t.mock.restoreAll();
    await cleanup(root);
  }
});

test("Unity descriptor supports short file-handle reads and preserves digest checks", async (t) => {
  const root = await temporaryRoot();
  try {
    const { bytes } = await fixture(root);
    const prototype = await fileHandlePrototype(root);
    const originalRead = prototype.read;
    let reads = 0;
    t.mock.method(prototype, "read", async function (buffer, offset, length, position) {
      reads += 1;
      return originalRead.call(this, buffer, offset, Math.min(length, 7), position);
    });
    const result = await readUnityProjectDescriptor(root, { required: true });
    assert.equal(result.digest, sha256(bytes));
    assert.equal(result.descriptor.baselineRevision, 0);
    assert.equal(await assertUnityProjectDescriptorUnchanged({
      projectRoot: root, expectedDigest: sha256(bytes),
    }), true);
    assert.ok(reads > 1, "must exercise repeated short reads");
  } finally {
    t.mock.restoreAll();
    await cleanup(root);
  }
});

test("Unity descriptor accepts the exact 64 KiB file limit and rejects one extra byte", async () => {
  const root = await temporaryRoot();
  try {
    const { destination, bytes } = await fixture(root);
    const padded = Buffer.concat([bytes, Buffer.alloc(65_536 - bytes.length, 0x20)]);
    await writeFile(destination, padded);
    const result = await readUnityProjectDescriptor(root, { required: true });
    assert.equal(result.digest, sha256(padded));
    await writeFile(destination, Buffer.concat([padded, Buffer.from(" ")]));
    await assert.rejects(readUnityProjectDescriptor(root, { required: true }), {
      code: "invalid_unity_descriptor_file",
    });
  } finally {
    await cleanup(root);
  }
});


test("Unity descriptor keeps exact large file identity during pinned reads", async (t) => {
  const root = await temporaryRoot();
  try {
    const { destination } = await fixture(root);
    const originalLstat = fs.promises.lstat;
    const first = 9007199254740992n;
    const second = first + 1n;
    assert.equal(Number(first), Number(second), "must model rounded Number inodes");
    let sawBigint = false;
    t.mock.method(fs.promises, "lstat", async (candidate, options) => {
      const info = await originalLstat(candidate, options);
      if (candidate === destination) {
        if (options?.bigint === true) sawBigint = true;
        info.ino = options?.bigint === true ? first : Number(first);
      }
      return info;
    });
    syncBuiltinESMExports();
    const prototype = await fileHandlePrototype(root);
    const originalStat = prototype.stat;
    t.mock.method(prototype, "stat", async function (options) {
      const info = await originalStat.call(this, options);
      if (info.isFile()) info.ino = options?.bigint === true ? second : Number(second);
      return info;
    });
    await assert.rejects(readUnityProjectDescriptor(root, { required: true }), {
      code: "invalid_unity_descriptor_file",
    });
    assert.equal(sawBigint, true);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    await cleanup(root);
  }
});

test("Unity descriptor refuses blocking FIFO opens after an lstat check", async (t) => {
  if (process.platform === "win32") return t.skip("POSIX O_NONBLOCK only");
  const root = await temporaryRoot();
  try {
    const { destination } = await fixture(root);
    const originalOpen = fs.promises.open;
    let inspected = false;
    t.mock.method(fs.promises, "open", async (candidate, flags, ...args) => {
      if (candidate === destination) {
        inspected = true;
        assert.ok((flags & fs.constants.O_NONBLOCK) !== 0,
          "regular-file-to-FIFO replacements must be nonblocking");
      }
      return originalOpen(candidate, flags, ...args);
    });
    syncBuiltinESMExports();
    await readUnityProjectDescriptor(root, { required: true });
    assert.equal(inspected, true);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    await cleanup(root);
  }
});


test("Unity descriptor rejects FIFO swap without waiting for a writer", async (t) => {
  if (process.platform === "win32" || fs.constants.O_NONBLOCK === undefined) {
    return t.skip("POSIX nonblocking FIFO replacement fixture");
  }
  const root = await temporaryRoot();
  try {
    const { destination } = await fixture(root);
    const fifo = path.join(root, "replacement.fifo");
    const created = spawnSync("mkfifo", [fifo], {
      encoding: "utf8", timeout: 4_000, killSignal: "SIGKILL",
    });
    if (created.error || created.status !== 0) {
      return t.skip("mkfifo unavailable for POSIX regression fixture");
    }

    // Child process plus an external deadline makes a missing O_NONBLOCK fail
    // safely even if libuv cannot interrupt a FIFO open from this test worker.
    const moduleUrl = JSON.stringify(new URL("../src/unity-project-descriptor.mjs", import.meta.url).href);
    const worker = [
      'import filesystem from "node:fs/promises";',
      'import { syncBuiltinESMExports } from "node:module";',
      'const [root, destination, fifo] = process.argv.slice(1);',
      'const original = filesystem.lstat;',
      'let swapped = false;',
      'filesystem.lstat = async (...args) => {',
      '  const info = await original(...args);',
      '  if (!swapped && args[0] === destination) {',
      '    swapped = true;',
      '    await filesystem.rename(destination, destination + ".old");',
      '    await filesystem.rename(fifo, destination);',
      '  }',
      '  return info;',
      '};',
      'syncBuiltinESMExports();',
      'const { readUnityProjectDescriptor } = await import(' + moduleUrl + ');',
      'try {',
      '  await readUnityProjectDescriptor(root, { required: true });',
      '  process.exitCode = 2;',
      '} catch (error) {',
      '  console.log(JSON.stringify({ code: error.code, swapped }));',
      '  if (error.code !== "invalid_unity_descriptor_file" || !swapped) process.exitCode = 3;',
      '}',
    ].join("\n");
    const result = spawnSync(process.execPath, [
      "--input-type=module", "-e", worker, root, destination, fifo,
    ], {
      encoding: "utf8", timeout: 5_000, killSignal: "SIGKILL", maxBuffer: 65_536,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      code: "invalid_unity_descriptor_file", swapped: true,
    });
  } finally {
    await cleanup(root);
  }
});
