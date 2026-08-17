import { mkdir, lstat, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { requireSha256, sha256 } from "./hash.mjs";
import { fail } from "./errors.mjs";

export class ChunkStore {
  constructor(root) {
    if (typeof root !== "string" || root.trim().length === 0) {
      fail("invalid_chunk_store", "Chunk store root is required.");
    }
    this.root = path.resolve(root);
  }

  pathForHash(hash) {
    requireSha256(hash, "chunkHash");
    return path.join(this.root, hash.slice(0, 2), hash);
  }

  async put(bytes, expectedHash = undefined) {
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const actualHash = sha256(buffer);
    if (expectedHash !== undefined && requireSha256(expectedHash, "expectedHash") !== actualHash) {
      fail("chunk_hash_mismatch", `Chunk hash mismatch: expected ${expectedHash}, received ${actualHash}.`);
    }
    const destination = this.pathForHash(actualHash);
    await mkdir(path.dirname(destination), { recursive: true });
    if (await this.has(actualHash, buffer.length, true)) {
      return actualHash;
    }
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(buffer);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, destination);
    } catch (error) {
      if (error.code !== "EEXIST") {
        await rm(temporary, { force: true });
        throw error;
      }
      await rm(temporary, { force: true });
    }
    if (!(await this.has(actualHash, buffer.length, true))) {
      await rm(destination, { force: true });
      fail("chunk_store_write_failed", `Stored chunk failed verification: ${actualHash}.`);
    }
    return actualHash;
  }

  async has(hash, expectedSize = undefined, verify = false) {
    const filePath = this.pathForHash(hash);
    let info;
    try {
      info = await lstat(filePath);
    } catch (error) {
      if (error.code === "ENOENT") {
        return false;
      }
      throw error;
    }
    if (!info.isFile() || info.isSymbolicLink() ||
        (expectedSize !== undefined && info.size !== expectedSize)) {
      return false;
    }
    if (!verify) {
      return true;
    }
    return sha256(await readFile(filePath)) === hash;
  }

  async read(hash, expectedSize = undefined) {
    const filePath = this.pathForHash(hash);
    const bytes = await readFile(filePath).catch((error) => {
      if (error.code === "ENOENT") {
        fail("chunk_unavailable", `Chunk is not available: ${hash}.`);
      }
      throw error;
    });
    if ((expectedSize !== undefined && bytes.length !== expectedSize) || sha256(bytes) !== hash) {
      await this.deleteInvalid(hash);
      fail("invalid_stored_chunk", `Stored chunk is corrupt and was discarded: ${hash}.`);
    }
    return bytes;
  }

  async deleteInvalid(hash) {
    await rm(this.pathForHash(hash), { force: true });
  }

  async inventory(hashes) {
    const available = [];
    for (const hash of hashes) {
      if (await this.has(hash, undefined, true)) {
        available.push(hash);
      }
    }
    return available.sort();
  }

  async size(hash) {
    return (await stat(this.pathForHash(hash))).size;
  }
}
