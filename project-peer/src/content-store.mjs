import { mkdir, lstat, open, rename, rm, stat } from "node:fs/promises";
import { constants } from "node:fs";
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
    let operationError;
    try {
      let writeError;
      try {
        await handle.writeFile(buffer);
        await handle.sync();
      } catch (error) {
        writeError = error;
        throw error;
      } finally {
        try {
          await handle.close();
        } catch (error) {
          if (!writeError) throw error;
        }
      }
      try {
        await rename(temporary, destination);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      if (!(await this.has(actualHash, buffer.length, true))) {
        // Another writer may have repaired this path since verification.
        // Removing it by pathname could delete that newer valid chunk.
        // A subsequent put() can atomically replace a corrupt entry.
        fail("chunk_store_write_failed", `Stored chunk failed verification: ${actualHash}.`);
      }
      return actualHash;
    } catch (error) {
      operationError = error;
      throw error;
    } finally {
      // This writer owns only its exclusive temporary file. Retire it after
      // write/sync/close failures too, without masking the first I/O error.
      try {
        await rm(temporary, { force: true });
      } catch (error) {
        if (!operationError) throw error;
      }
    }
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
    // Verify the opened inode, not a path that may have been replaced since
    // lstat. POSIX O_NOFOLLOW also rejects a final symlink swapped in before open.
    let handle;
    try {
      const flags = constants.O_RDONLY | (process.platform === "win32" ? 0 : (constants.O_NOFOLLOW ?? 0));
      handle = await open(filePath, flags);
      const opened = await handle.stat();
      if (!opened.isFile() || (expectedSize !== undefined && opened.size !== expectedSize)) {
        return false;
      }
      return sha256(await handle.readFile()) === hash;
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ELOOP") {
        return false;
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  async read(hash, expectedSize = undefined) {
    const filePath = this.pathForHash(hash);
    let information;
    try {
      information = await lstat(filePath);
    } catch (error) {
      if (error.code === "ENOENT") {
        fail("chunk_unavailable", `Chunk is not available: ${hash}.`);
      }
      throw error;
    }
    if (!information.isFile() || information.isSymbolicLink()) {
      fail("invalid_stored_chunk", `Stored chunk is not a regular file: ${hash}.`);
    }

    // On POSIX, O_NOFOLLOW closes the final-symlink swap window between
    // lstat and open. Windows still gets the lstat guard when this flag is
    // unavailable; the opened handle is also checked before reading bytes.
    let handle;
    let bytes;
    try {
      const flags = constants.O_RDONLY | (process.platform === "win32" ? 0 : (constants.O_NOFOLLOW ?? 0));
      handle = await open(filePath, flags);
      if (!(await handle.stat()).isFile()) {
        fail("invalid_stored_chunk", `Stored chunk is not a regular file: ${hash}.`);
      }
      bytes = await handle.readFile();
    } catch (error) {
      if (error.code === "ENOENT") {
        fail("chunk_unavailable", `Chunk is not available: ${hash}.`);
      }
      if (error.code === "ELOOP") {
        fail("invalid_stored_chunk", `Stored chunk is a symbolic link: ${hash}.`);
      }
      throw error;
    } finally {
      await handle?.close();
    }
    if ((expectedSize !== undefined && bytes.length !== expectedSize) || sha256(bytes) !== hash) {
      // A concurrent writer may already have replaced this path with a valid
      // inode. Do not unlink by pathname after verifying a stale open handle;
      // put() repairs corrupt entries through atomic replacement.
      fail("invalid_stored_chunk", `Stored chunk is corrupt: ${hash}.`);
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
