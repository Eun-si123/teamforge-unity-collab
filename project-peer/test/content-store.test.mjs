import assert from "node:assert/strict";
import test from "node:test";
import { lstat, mkdir, open, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { ChunkStore } from "../src/content-store.mjs";
import { MAXIMUM_CHUNK_SIZE } from "../src/constants.mjs";
import { sha256 } from "../src/hash.mjs";
import { cleanup, temporaryRoot } from "./helpers.mjs";

test("put atomically replaces a corrupt regular cache file with verified bytes", async () => {
  const root = await temporaryRoot();
  try {
    const store = new ChunkStore(path.join(root, "repair-cache"));
    const bytes = Buffer.from("verified bytes for corrupt-cache replacement");
    const hash = await store.put(bytes);
    const unrelated = Buffer.from("another verified chunk remains intact");
    const unrelatedHash = await store.put(unrelated);
    for (const corrupt of [Buffer.alloc(bytes.length, 0xff), Buffer.from("short corrupt file")]) {
      await writeFile(store.pathForHash(hash), corrupt);
      assert.equal(await store.has(hash, bytes.length, true), false);
      assert.equal(await store.put(bytes, hash), hash,
        "A valid retry must replace the corrupt regular destination without prior deletion.");
      assert.deepEqual(await store.read(hash, bytes.length), bytes);
      assert.deepEqual(await store.read(unrelatedHash), unrelated);
    }
    await assert.rejects(store.put(Buffer.alloc(bytes.length, 0xff), hash), { code: "chunk_hash_mismatch" });
    assert.deepEqual(await store.read(hash, bytes.length), bytes);
    assert.deepEqual((await readdir(store.root, { recursive: true })).filter(name => name.endsWith(".tmp")), []);
  } finally { await cleanup(root); }
});

for (const phase of ["write", "sync", "close", "write-and-close"]) {
  test(`failed Chunk ${phase} retires only its temporary file and preserves the first error`, async (t) => {
    const root = await temporaryRoot();
    try {
      const store = new ChunkStore(path.join(root, "cache"));
      const existing = Buffer.from("already verified content");
      const existingHash = await store.put(existing);
      const bytes = Buffer.from("new content that must not publish partially");
      const hash = sha256(bytes);
      const probe = await open(path.join(root, "probe"), "wx");
      const prototype = Object.getPrototypeOf(probe);
      await probe.close();
      const primary = Object.assign(new Error("synthetic storage failure"), {
        code: phase.startsWith("write") ? "ENOSPC" : "EIO",
      });
      const closeFailure = phase === "close" ? primary
        : Object.assign(new Error("secondary close failure"), { code: "EIO" });
      const writeFile = prototype.writeFile;
      t.mock.method(prototype, "writeFile", async function (value, ...args) {
        if (phase === "close" || phase === "write-and-close") {
          const close = this.close;
          this.close = async () => { await close(); throw closeFailure; };
        }
        if (phase.startsWith("write")) {
          await writeFile.call(this, value.subarray(0, 3), ...args);
          throw primary;
        }
        return writeFile.call(this, value, ...args);
      });
      if (phase === "sync") t.mock.method(prototype, "sync", async () => { throw primary; });
      await assert.rejects(store.put(bytes, hash), error => {
        assert.equal(error, primary, "cleanup must not replace the original storage failure");
        return true;
      });
      const leftovers = (await readdir(store.root, { recursive: true })).filter(name => name.endsWith(".tmp"));
      assert.deepEqual(leftovers, [], "partial writes must not accumulate temporary cache data");
      assert.equal(await store.has(hash), false);
      assert.deepEqual(await store.read(existingHash), existing);
      t.mock.restoreAll();
      assert.equal(await store.put(bytes, hash), hash, "a normal retry remains possible");
      assert.deepEqual(await store.read(hash), bytes);
    } finally {
      t.mock.restoreAll();
      await cleanup(root);
    }
  });
}

test("read refuses a symlinked chunk even when the target hashes correctly", async (t) => {
  const root = await temporaryRoot();
  try {
    const store = new ChunkStore(path.join(root, "cache"));
    const bytes = Buffer.from("verified bytes outside the chunk cache");
    const hash = sha256(bytes);
    const outside = path.join(root, "outside-cache");
    await writeFile(outside, bytes);
    await mkdir(path.dirname(store.pathForHash(hash)), { recursive: true });
    try {
      await symlink(outside, store.pathForHash(hash));
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
        t.skip(`Symlink creation unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    assert.equal(await store.has(hash, bytes.length, true), false);
    await assert.rejects(store.read(hash, bytes.length), { code: "invalid_stored_chunk" });
    await assert.rejects(store.size(hash), { code: "invalid_stored_chunk" });
    assert.equal(await store.put(bytes, hash), hash, "a verified retry replaces the unsafe link");
    assert.deepEqual(await store.read(hash, bytes.length), bytes);
    assert.deepEqual(await readFile(outside), bytes);
  } finally { await cleanup(root); }
});

// A verified lookup must read the already-opened inode, not resolve the
// cache path again after it has been replaced by another actor.
test("verified has pins its opened file across a final-path swap", async (t) => {
  if (process.platform === "win32") {
    t.skip("Windows cannot portably unlink an open cache file; separate Windows validation required");
    return;
  }
  const root = await temporaryRoot();
  try {
    const store = new ChunkStore(path.join(root, "cache"));
    const good = Buffer.from("valid cached content during path replacement");
    const hash = sha256(good);
    const entry = store.pathForHash(hash);
    const outside = path.join(root, "outside");
    await mkdir(path.dirname(entry), { recursive: true });
    await writeFile(entry, Buffer.alloc(good.length, 0x78));
    await writeFile(outside, good);
    const probe = await open(path.join(root, "probe"), "wx");
    const prototype = Object.getPrototypeOf(probe);
    await probe.close();
    const original = prototype.readFile;
    let swapped = false;
    t.mock.method(prototype, "readFile", async function (...args) {
      if (!swapped) {
        await rm(entry);
        await symlink(outside, entry);
        swapped = true;
      }
      return original.call(this, ...args);
    });
    assert.equal(await store.has(hash, good.length, true), false);
    assert.equal(swapped, true, "verified has must read through an opened file handle");
    assert.equal(await store.has(hash, good.length, true), false);
    assert.deepEqual(await readFile(outside), good);
  } finally {
    t.mock.restoreAll();
    await cleanup(root);
  }
});

// A failed read must not remove a different, valid inode installed at the same path.
test("corrupt read preserves a valid replacement installed during the read", async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX replacement of an open file; Windows needs a separate race fixture");
    return;
  }
  const root = await temporaryRoot();
  try {
    const store = new ChunkStore(path.join(root, "cache"));
    const good = Buffer.from("valid replacement during stale corrupt read");
    const hash = sha256(good);
    const entry = store.pathForHash(hash);
    const replacement = path.join(root, "replacement");
    await mkdir(path.dirname(entry), { recursive: true });
    await writeFile(entry, Buffer.alloc(good.length, 0x58));
    await writeFile(replacement, good);
    const probe = await open(path.join(root, "probe"), "wx");
    const prototype = Object.getPrototypeOf(probe);
    await probe.close();
    const original = prototype.readFile;
    let swapped = false;
    t.mock.method(prototype, "readFile", async function (...args) {
      if (!swapped) {
        await rename(replacement, entry);
        swapped = true;
      }
      return original.call(this, ...args);
    });
    await assert.rejects(store.read(hash, good.length), { code: "invalid_stored_chunk" });
    t.mock.restoreAll();
    assert.equal(swapped, true);
    assert.equal(await store.has(hash, good.length, true), true,
      "a stale corrupt read must not delete a newer valid cache entry");
    assert.deepEqual(await store.read(hash, good.length), good);
  } finally {
    t.mock.restoreAll();
    await cleanup(root);
  }
});

// A failed post-write verification must not unlink a different, valid inode
// installed after the verification observed a corrupt cache entry.
test("failed put verification preserves a concurrent valid replacement", async () => {
  const root = await temporaryRoot();
  try {
    const store = new ChunkStore(path.join(root, "cache"));
    const good = Buffer.from("valid replacement after a failed put verification");
    const hash = sha256(good);
    const entry = store.pathForHash(hash);
    const replacement = path.join(root, "replacement");
    await mkdir(path.dirname(entry), { recursive: true });
    await writeFile(replacement, good);
    const originalHas = store.has.bind(store);
    let checks = 0;
    store.has = async (...args) => {
      checks++;
      if (checks === 2) {
        await writeFile(entry, Buffer.alloc(good.length, 0x58));
        assert.equal(await originalHas(...args), false,
          "verification must observe the corrupt entry");
        await rename(replacement, entry);
        return false;
      }
      return originalHas(...args);
    };
    await assert.rejects(store.put(good, hash), { code: "chunk_store_write_failed" });
    assert.equal(checks, 2);
    assert.deepEqual(await store.read(hash, good.length), good,
      "failed verification must not delete a concurrently repaired entry");
  } finally { await cleanup(root); }
});

test("corrupt read remains repairable by verified put", async () => {
  const root = await temporaryRoot();
  try {
    const store = new ChunkStore(path.join(root, "cache"));
    const good = Buffer.from("valid replacement after a corrupt read");
    const hash = sha256(good);
    const entry = store.pathForHash(hash);
    await mkdir(path.dirname(entry), { recursive: true });
    await writeFile(entry, Buffer.alloc(good.length, 0x58));
    await assert.rejects(store.read(hash, good.length), { code: "invalid_stored_chunk" });
    assert.equal(await store.put(good, hash), hash);
    assert.deepEqual(await store.read(hash, good.length), good);
  } finally { await cleanup(root); }
});

test("chunk cache refuses a symlinked hash-prefix directory without touching its target", async (t) => {
  const root = await temporaryRoot();
  try {
    const store = new ChunkStore(path.join(root, "cache"));
    const outside = path.join(root, "outside-bucket");
    const bytes = Buffer.from("verified content in an outside hash bucket");
    const hash = sha256(bytes);
    const outsideEntry = path.join(outside, hash);
    await mkdir(store.root, { recursive: true });
    await mkdir(outside);
    try {
      // Windows junctions work without the Developer Mode symlink privilege.
      await symlink(outside, path.dirname(store.pathForHash(hash)),
        process.platform === "win32" ? "junction" : "dir");
      assert.equal((await lstat(path.dirname(store.pathForHash(hash)))).isSymbolicLink(), true);
    } catch (error) {
      if (process.platform !== "win32" && ["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
        t.skip(`Directory symlink creation unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    await assert.rejects(store.put(bytes, hash), { code: "invalid_chunk_store" });
    await assert.rejects(readFile(outsideEntry), { code: "ENOENT" },
      "put must not write through a symlinked cache bucket");
    await writeFile(outsideEntry, bytes);
    assert.equal(await store.has(hash, bytes.length, true), false);
    await assert.rejects(store.read(hash, bytes.length), { code: "invalid_stored_chunk" });
    await assert.rejects(store.size(hash), { code: "invalid_stored_chunk" });
    await assert.rejects(store.deleteInvalid(hash), { code: "invalid_stored_chunk" });
    assert.deepEqual(await readFile(outsideEntry), bytes,
      "a rejected cache operation must not remove the outside file");
  } finally { await cleanup(root); }
});

// A stable oversized cache entry should be rejected before allocating its
// contents, not only by the post-read integrity check.
test("read rejects oversized corrupt cache before loading its bytes", async (t) => {
  const root = await temporaryRoot();
  try {
    const store = new ChunkStore(path.join(root, "cache"));
    const good = Buffer.from("verified cache entry for bounded read");
    const hash = await store.put(good);
    await writeFile(store.pathForHash(hash), Buffer.alloc(good.length + 64 * 1024, 0x78));
    const probe = await open(path.join(root, "probe"), "wx");
    const prototype = Object.getPrototypeOf(probe);
    await probe.close();
    const original = prototype.readFile;
    let reads = 0;
    t.mock.method(prototype, "readFile", async function (...args) {
      reads++;
      return original.call(this, ...args);
    });
    await assert.rejects(store.read(hash, good.length), { code: "invalid_stored_chunk" });
    assert.equal(reads, 0, "Oversized cache entries must be rejected before readFile");
    t.mock.restoreAll();
    assert.equal(await store.put(good, hash), hash, "Verified put must repair a rejected entry");
    assert.deepEqual(await store.read(hash, good.length), good);
  } finally {
    t.mock.restoreAll();
    await cleanup(root);
  }
});

// Host-side inventory can verify cached hashes without manifest expectedSizes.
// A corrupted or maliciously oversized cache file must not be loaded into RAM.
test("unbounded cache lookup refuses oversized chunks before reading", async (t) => {
  const root = await temporaryRoot();
  try {
    const store = new ChunkStore(path.join(root, "cache"));
    const bytes = Buffer.from("valid chunk with an oversized corrupt cache replacement");
    const hash = await store.put(bytes);
    const entry = store.pathForHash(hash);
    const file = await open(entry, "r+");
    try { await file.truncate(MAXIMUM_CHUNK_SIZE + 1); } finally { await file.close(); }

    const probe = await open(path.join(root, "probe"), "wx");
    const prototype = Object.getPrototypeOf(probe);
    await probe.close();
    const original = prototype.readFile;
    let reads = 0;
    t.mock.method(prototype, "readFile", async function (...args) {
      reads += 1;
      return original.call(this, ...args);
    });
    assert.equal(await store.has(hash, undefined, true), false);
    assert.deepEqual(await store.inventory([hash]), []);
    await assert.rejects(store.read(hash), { code: "invalid_stored_chunk" });
    assert.equal(reads, 0, "No oversized cache bytes should be allocated or read");
    t.mock.restoreAll();
    assert.equal(await store.put(bytes, hash), hash, "Normal verified put repairs the cache entry");
    assert.deepEqual(await store.read(hash), bytes);
  } finally {
    t.mock.restoreAll();
    await cleanup(root);
  }
});

test("cache accepts a verified chunk at the manifest maximum size", async () => {
  const root = await temporaryRoot();
  try {
    const store = new ChunkStore(path.join(root, "cache"));
    const bytes = Buffer.alloc(MAXIMUM_CHUNK_SIZE, 0x5a);
    const hash = await store.put(bytes);
    assert.equal(await store.has(hash, undefined, true), true);
    assert.deepEqual(await store.inventory([hash]), [hash]);
    assert.deepEqual(await store.read(hash), bytes);
  } finally { await cleanup(root); }
});
