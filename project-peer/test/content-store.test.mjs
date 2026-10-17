import assert from "node:assert/strict";
import test from "node:test";
import { open, readdir } from "node:fs/promises";
import path from "node:path";
import { ChunkStore } from "../src/content-store.mjs";
import { sha256 } from "../src/hash.mjs";
import { cleanup, temporaryRoot } from "./helpers.mjs";

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
