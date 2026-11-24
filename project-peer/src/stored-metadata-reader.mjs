// Read one managed, locally stored Project metadata file through a bounded
// pinned handle. This protects Host M4 recovery and signed M5 candidate review
// from truncated files, redirected paths and unbounded readFile allocations.
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { assertNoRedirectedDirectorySegments } from "./filesystem-safety.mjs";
import { TeamForgePeerError, fail } from "./errors.mjs";

export const STORED_MANIFEST_MAX_BYTES = 64 * 1024 * 1024;
export const STORED_DESCRIPTOR_MAX_BYTES = 256 * 1024;
export const STORED_POINTER_MAX_BYTES = 16 * 1024;
export const STORED_PROJECT_MAX_BYTES = 64 * 1024;

const sameFile = (a, b) => a.isFile() && b.isFile() && !b.isSymbolicLink() &&
  a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
  a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;

export async function readStoredMetadataJson(filePath, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 ||
      maxBytes > STORED_MANIFEST_MAX_BYTES || !path.isAbsolute(filePath))
    fail("invalid_stored_metadata_read", "A bounded absolute Project metadata path is required.");
  try {
    // Exact leaf protection is insufficient if metadata/manifests is a link
    // to another directory. Refuse redirected ancestors before opening.
    await assertNoRedirectedDirectorySegments(path.dirname(filePath), {
      code:"unsafe_stored_metadata",message:"Managed Project metadata path contains a redirected directory.",
    });
    const before = await lstat(filePath,{bigint:true});
    if (!before.isFile() || before.isSymbolicLink())
      fail("unsafe_stored_metadata", "Managed Project metadata must be a regular file, not a link or device.");
    if (before.size <= 0n || before.size > BigInt(maxBytes))
      fail("stored_metadata_size_limit", "Managed Project metadata exceeds its bounded read budget.");

    // O_NONBLOCK avoids hanging on a FIFO swapped after lstat on POSIX.
    const flags = constants.O_RDONLY | (process.platform === "win32" ? 0 :
      ((constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)));
    const handle = await open(filePath,flags);
    try {
      const opened = await handle.stat({bigint:true});
      if (!sameFile(before,opened))
        fail("stored_metadata_changed", "Managed Project metadata was replaced while opening.");
      const buffer = Buffer.alloc(Number(before.size) + 1);
      let count = 0;
      while (count < buffer.length) {
        const {bytesRead} = await handle.read(buffer,count,buffer.length-count,count);
        if (bytesRead === 0) break;
        count += bytesRead;
      }
      const after = await handle.stat({bigint:true});
      const current = await lstat(filePath,{bigint:true});
      if (BigInt(count) !== before.size || !sameFile(opened,after) ||
          !sameFile(opened,current))
        fail("stored_metadata_changed", "Managed Project metadata changed during verification.");
      // The filesystem path may have become redirected while the handle was
      // held. This is a detection fence, not a cross-process namespace lock.
      await assertNoRedirectedDirectorySegments(path.dirname(filePath), {
        code:"unsafe_stored_metadata",message:"Managed Project metadata directory changed during read.",
      });
      return JSON.parse(buffer.toString("utf8",0,count));
    } finally { await handle.close(); }
  } catch (error) {
    if (error instanceof TeamForgePeerError || error instanceof SyntaxError) throw error;
    if (error.code === "ENOENT")
      throw new TeamForgePeerError("ENOENT", "Selected managed Project metadata is missing.");
    fail("stored_metadata_unavailable", "Managed Project metadata could not be safely read.");
  }
}
