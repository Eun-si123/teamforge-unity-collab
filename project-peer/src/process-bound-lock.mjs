// Exclusive metadata lock files whose ownership ends with the owning process.
//
// A plain `open(path, "wx")` lock survives a crash of its owner, so one killed
// activation or publication blocked every retry until someone deleted the
// file by hand (#648, #660). Removing such a file by age alone is unsafe.
//
// Here the lock file is additionally guarded by an OS-held mutex that the
// kernel releases when the process exits: a named pipe on Windows (as the
// Project identity lock already does) and an abstract Unix socket on Linux.
// The file records that its owner held that mutex. Whoever holds the mutex
// and still finds such a record therefore knows the recorded owner has
// exited, and may replace it. A legacy empty or unrecognized file is never
// removed automatically: an older TeamForge process that does not take the
// mutex could still own it. Version 1 records are likewise ambiguous because
// the former fallback could emit them without a mutex. Unsupported platforms
// use a non-reclaimable file-only record; supported platforms fail closed if
// the mutex cannot be established.
import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fail } from "./errors.mjs";
import { readStoredMetadataJson } from "./stored-metadata-reader.mjs";

const OWNER_RECORD = Object.freeze({ schemaVersion: 2, kind: "teamforge-process-bound-lock" });
const OWNER_RECORD_KEYS = Object.freeze(["acquiredAtUnixMs", "kind", "pid", "schemaVersion"]);
const MAX_OWNER_RECORD_BYTES = 4096;

async function osMutexName(lockPath) {
  if (process.platform !== "win32" && process.platform !== "linux") return null;
  // Bind to the directory's filesystem identity, not its spelling, so path
  // aliases of one metadata directory share one mutex.
  const details = await stat(path.dirname(lockPath), { bigint: true });
  if (details.ino === 0n) return null;
  const identity = `${details.dev}\n${details.ino}\n${path.basename(lockPath)}`;
  const digest = createHash("sha256").update(identity, "utf8").digest("hex");
  return process.platform === "win32"
    ? `\\\\.\\pipe\\teamforge-process-lock-v1-${digest}`
    : `\0teamforge-process-lock-v1-${digest}`;
}

function bindMutex(name) {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => socket.destroy());
    server.once("error", reject);
    server.listen(name, () => {
      server.removeListener("error", reject);
      server.unref();
      resolve(server);
    });
  });
}

function closeMutex(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function createWithRecord(lockPath, recoverable) {
  // File-only ownership must never look like proof of an OS mutex.
  const record = `${JSON.stringify({
    ...OWNER_RECORD, kind: recoverable ? OWNER_RECORD.kind : "teamforge-file-only-lock",
    pid: process.pid, acquiredAtUnixMs: Date.now(),
  })}\n`;
  // Write the record first and link it into place, so a crash can never leave
  // a lock file without its owner record.
  const temporary = `${lockPath}.${randomUUID()}.tmp`;
  await writeFile(temporary, record, { flag: "wx", mode: 0o600 });
  try {
    await link(temporary, lockPath);
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
    if (!["EPERM", "ENOTSUP", "EOPNOTSUPP", "EXDEV"].includes(error.code)) throw error;
    // Filesystems without hard links: exclusive create, then write.
    const handle = await open(lockPath, "wx", 0o600).catch((openError) => {
      if (openError.code === "EEXIST") return null;
      throw openError;
    });
    if (!handle) return false;
    try { await handle.writeFile(record); } finally { await handle.close(); }
    return true;
  } finally {
    await rm(temporary, { force: true });
  }
}

async function holdsOwnerRecord(lockPath) {
  let value;
  try {
    value = await readStoredMetadataJson(lockPath, MAX_OWNER_RECORD_BYTES);
  } catch {
    return false;
  }
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify(OWNER_RECORD_KEYS) &&
    value.schemaVersion === OWNER_RECORD.schemaVersion && value.kind === OWNER_RECORD.kind &&
    Number.isSafeInteger(value.pid) && value.pid > 0 &&
    Number.isSafeInteger(value.acquiredAtUnixMs) && value.acquiredAtUnixMs > 0;
}

export async function withProcessBoundLock(lockPath, work, { busyCode, busyMessage }) {
  if (typeof work !== "function") throw new TypeError("Process-bound lock work callback is required.");
  await mkdir(path.dirname(lockPath), { recursive: true });
  const name = await osMutexName(lockPath);
  let mutex = null;
  const needsMutex = process.platform === "linux" || process.platform === "win32";
  if (needsMutex && !name)
    fail(busyCode, "Cannot prove exclusive process-bound lock ownership. No changes were made.");
  if (name) {
    try {
      mutex = await bindMutex(name);
    } catch (error) {
      if (error.code === "EADDRINUSE") fail(busyCode, busyMessage);
      // Never fall back to file-only ownership on a mutex-capable OS.
      // Otherwise another process could acquire the OS mutex and reclaim
      // a live owner's file while it is in the critical section.
      fail(busyCode, "Cannot establish the process-bound lock. No changes were made.");
    }
  }
  try {
    if (!(await createWithRecord(lockPath, Boolean(mutex)))) {
      // Version 1 records could also be emitted by an earlier unsafe
      // file-only fallback. Only v2 mutex-backed records can be reclaimed.
      // Legacy or unrecognized files remain ambiguous and untouched.
      if (!mutex || !(await holdsOwnerRecord(lockPath))) fail(busyCode, busyMessage);
      await rm(lockPath, { force: true });
      if (!(await createWithRecord(lockPath, Boolean(mutex)))) fail(busyCode, busyMessage);
    }
    try {
      return await work();
    } finally {
      await rm(lockPath, { force: true });
    }
  } finally {
    if (mutex) await closeMutex(mutex);
  }
}
