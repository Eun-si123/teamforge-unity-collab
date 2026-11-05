import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, open, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { ManagedProjectStore } from "../src/managed-project.mjs";
import { cleanup, temporaryRoot } from "./helpers.mjs";

async function pointerFixture() {
  const root = await temporaryRoot();
  const projectUuid = randomUUID();
  const managed = new ManagedProjectStore({
    managedRoot: root,
    projectUuid,
    chunkStore: { async read() { throw new Error("not needed"); } },
  });
  const pointer = {
    projectUuid,
    baselineRevision: 1,
    manifestHash: "a".repeat(64),
    activeRelativePath: "active/1-example",
  };
  await mkdir(path.join(managed.activeRoot, "1-example"), { recursive: true });
  await mkdir(managed.metadataRoot, { recursive: true });
  return { root, managed, pointer };
}

test("current pointer accepts exactly 64 KiB and rejects one byte beyond the validatedCurrent budget", async () => {
  const { root, managed, pointer } = await pointerFixture();
  try {
    const encoded = JSON.stringify(pointer);
    const exact = `${encoded}${" ".repeat(65_536 - Buffer.byteLength(encoded))}`;
    assert.equal(Buffer.byteLength(exact), 65_536);
    await writeFile(managed.currentPath, exact);
    assert.equal((await managed.current()).manifestHash, pointer.manifestHash);

    await writeFile(managed.currentPath, `${exact} `);
    await assert.rejects(() => managed.current(), { code: "active_metadata_unsafe" });
  } finally {
    await cleanup(root);
  }
});

test("current pointer refuses a symlink to an otherwise valid external JSON file", async (t) => {
  const { root, managed, pointer } = await pointerFixture();
  try {
    const outside = path.join(root, "unrelated-pointer.json");
    await writeFile(outside, JSON.stringify(pointer));
    try {
      await symlink(outside, managed.currentPath, "file");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
        t.skip("Creating file symlinks is not supported in this test environment.");
        return;
      }
      throw error;
    }
    await assert.rejects(() => managed.current(), { code: "active_metadata_unsafe" });
  } finally {
    await cleanup(root);
  }
});

test("missing current pointer remains absent and null JSON fails with a stable code", async () => {
  const { root, managed } = await pointerFixture();
  try {
    assert.equal(await managed.current(), null);
    await writeFile(managed.currentPath, "null");
    await assert.rejects(() => managed.current(), { code: "invalid_current_pointer" });
  } finally {
    await cleanup(root);
  }
});


test("current pointer uses exact BigInt filesystem identities across read boundaries", async (t) => {
  const { root, managed, pointer } = await pointerFixture();
  try {
    await writeFile(managed.currentPath, JSON.stringify(pointer));
    const probe = await open(path.join(root, "probe"), "wx");
    const prototype = Object.getPrototypeOf(probe);
    await probe.close();
    const originalStat = prototype.stat;
    let checked = 0;
    t.mock.method(prototype, "stat", async function (options) {
      assert.equal(options?.bigint, true);
      const result = await originalStat.call(this, options);
      assert.equal(typeof result.ino, "bigint");
      assert.equal(typeof result.mtimeNs, "bigint");
      checked += 1;
      return result;
    });
    assert.equal((await managed.current()).manifestHash, pointer.manifestHash);
    assert.equal(checked, 2);
  } finally {
    t.mock.restoreAll();
    await cleanup(root);
  }
});
