// Shared Host publication/recovery fence. The existing exclusive lock name
// is preserved for compatibility with older writers. A leftover lock is
// ambiguous after a crash: do NOT remove it automatically.
import { lstat, mkdir, open, rm } from "node:fs/promises";
import path from "node:path";
import { fail } from "./errors.mjs";
import { assertNoRedirectedDirectorySegments } from "./filesystem-safety.mjs";

export const HOST_RECOVERY_FENCE_NAME="host-transition-recovery.json";

export async function assertNoPendingHostRecovery(metadataRoot) {
  await assertNoRedirectedDirectorySegments(metadataRoot);
  try {
    await lstat(path.join(metadataRoot,HOST_RECOVERY_FENCE_NAME));
  } catch(error) {
    if(error.code==="ENOENT") return;
    throw error;
  }
  // Even damaged, linked or unexpected fence contents require reconciliation.
  fail("host_transition_recovery_required",
    "A Host Baseline transition recovery is unresolved. Reconcile the saved Project before publishing, seeding or syncing.");
}

export async function withPublishedPointerLock(metadataRoot,work) {
  await assertNoRedirectedDirectorySegments(metadataRoot);
  await mkdir(metadataRoot,{recursive:true});
  await assertNoRedirectedDirectorySegments(metadataRoot);
  const lockPath=path.join(metadataRoot,"published.lock");
  const lock=await open(lockPath,"wx",0o600).catch(error=>{
    if(error.code==="EEXIST")
      fail("published_pointer_busy","Another Baseline pointer update or unresolved recovery lock exists.");
    throw error;
  });
  try {return await work();}
  finally {
    await lock.close();
    await rm(lockPath,{force:true});
  }
}
