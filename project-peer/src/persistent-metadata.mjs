// Publish signed Project metadata without exposing partial final JSON files.
// A content-addressed name is immutable: create a fully flushed temporary
// file first, then hard-link it into place without replacing an existing one.
// Approved pointers instead use a flushed temporary file and atomic rename.
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fail } from "./errors.mjs";

export async function syncMetadataDirectory(directory) {
  // Windows does not expose a portable directory fsync FileHandle. File data
  // is still flushed before the rename/link; do not assert power-cut safety
  // beyond the filesystem/OS guarantees on that platform.
  if (process.platform === "win32") return;
  const handle = await open(directory, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
  try { await handle.sync(); }
  finally { await handle.close(); }
}

async function createFlushedTemporary(destination, json) {
  const temporary = `${destination}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(json, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    return temporary;
  } catch (error) {
    try { await handle?.close(); } finally { await rm(temporary, {force:true}).catch(() => {}); }
    throw error;
  }
}

const serialize = value => `${JSON.stringify(value, null, 2)}\n`;

export async function writeJsonAtomic(destination, value) {
  const directory = path.dirname(destination);
  await mkdir(directory, { recursive: true });
  const temporary = await createFlushedTemporary(destination,serialize(value));
  try {
    await rename(temporary,destination);
    // A returned success on POSIX means the rename's directory entry has
    // also been flushed. A failure after rename is an UNCERTAIN publication,
    // not an invitation to overwrite or to claim a rollback.
    try { await syncMetadataDirectory(directory); }
    catch {
      fail("metadata_durability_unconfirmed",
        "Metadata was renamed but directory durability could not be confirmed. Inspect the existing approved state before retrying.");
    }
  } finally {
    await rm(temporary,{force:true}).catch(() => {});
  }
}


async function sameExistingMetadata(destination,serialized) {
  const expected = Buffer.from(serialized,"utf8");
  const before = await lstat(destination,{bigint:true});
  if (!before.isFile() || before.isSymbolicLink() || before.size !== BigInt(expected.length))
    return false;
  const noFollow = process.platform === "win32" ? 0 : (constants.O_NOFOLLOW ?? 0);
  const nonblock = process.platform === "win32" ? 0 : (constants.O_NONBLOCK ?? 0);
  const handle = await open(destination,constants.O_RDONLY | noFollow | nonblock);
  try {
    const opened = await handle.stat({bigint:true});
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino ||
        opened.size !== before.size) return false;
    // A file can grow after stat. Read at most one byte beyond the expected
    // complete JSON; never allow a malicious competing writer an unbounded read.
    const received = Buffer.alloc(expected.length + 1);
    let total = 0;
    while (total < received.length) {
      const {bytesRead} = await handle.read(received,total,received.length-total,total);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    const after = await handle.stat({bigint:true});
    const pathAfter = await lstat(destination,{bigint:true});
    return total === expected.length && received.subarray(0,total).equals(expected) &&
      after.size === opened.size && after.dev === opened.dev && after.ino === opened.ino &&
      pathAfter.isFile() && !pathAfter.isSymbolicLink() &&
      pathAfter.dev === opened.dev && pathAfter.ino === opened.ino &&
      pathAfter.size === opened.size && after.mtimeNs === opened.mtimeNs &&
      pathAfter.mtimeNs === opened.mtimeNs && after.ctimeNs === opened.ctimeNs;
  } finally { await handle.close(); }
}

// Exclusive creation preserves Project UUID identity: another owner or an
// already present file must not be silently replaced.
export async function writeJsonExclusive(destination, value) {
  const directory = path.dirname(destination);
  await mkdir(directory, {recursive:true});
  const temporary = await createFlushedTemporary(destination,serialize(value));
  try {
    await link(temporary,destination);
    try { await syncMetadataDirectory(directory); }
    catch {
      fail("metadata_durability_unconfirmed",
        "Metadata identity was installed but directory durability could not be confirmed. Inspect the existing state before retrying.");
    }
  } finally {
    await rm(temporary,{force:true}).catch(() => {});
  }
}

export async function writeJsonContentAddressed(destination,value) {
  const directory = path.dirname(destination);
  await mkdir(directory,{recursive:true});
  const serialized = serialize(value);
  const temporary = await createFlushedTemporary(destination,serialized);
  try {
    try {
      await link(temporary,destination);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      // Another process won the immutable destination. Never overwrite it,
      // and never accept a truncated file left by a previous crashed writer.
      if (!(await sameExistingMetadata(destination,serialized))) {
        fail("metadata_hash_collision", "Content-addressed metadata differs from the selected signed identity.");
      }
      return;
    }
    try { await syncMetadataDirectory(directory); }
    catch {
      fail("metadata_durability_unconfirmed",
        "Signed metadata was installed but directory durability could not be confirmed. Inspect the existing state before retrying.");
    }
  } finally {
    await rm(temporary,{force:true}).catch(() => {});
  }
}
