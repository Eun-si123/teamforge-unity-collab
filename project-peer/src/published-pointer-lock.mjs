// Shared Host publication/recovery fence. The existing exclusive lock name
// is preserved for compatibility with older writers. The lock is
// process-bound (#660): one whose recorded owner provably exited is replaced,
// while a legacy or otherwise ambiguous leftover lock is never removed.
import { lstat, mkdir } from "node:fs/promises";
import path from "node:path";
import { fail } from "./errors.mjs";
import { assertNoRedirectedDirectorySegments } from "./filesystem-safety.mjs";
import { withProcessBoundLock } from "./process-bound-lock.mjs";

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
  return await withProcessBoundLock(path.join(metadataRoot,"published.lock"),work,{
    busyCode:"published_pointer_busy",
    busyMessage:"Another Baseline pointer update or unresolved recovery lock exists.",
  });
}
