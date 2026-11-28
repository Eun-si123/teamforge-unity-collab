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
// and still finds a version-2 record can therefore replace it. A legacy,
// version-1 or unrecognized file is never removed automatically because its
// owner may still hold only the file lock. Platforms without a crash-released
// mutex keep the previous file-only behaviour.
import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fail } from "./errors.mjs";

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
  // Keep the original mutex namespace so both record versions exclude each other.
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

async function createLockFile(lockPath, mutexHeld) {
  // A contender that can bind the mutex must treat a file-only owner as
  // ambiguous. Only a mutex owner can publish a reclaimable record.
  if (!mutexHeld) {
    try {
      await writeFile(lockPath, "", { flag: "wx", mode: 0o600 });
      return true;
    } catch (error) {
      if (error.code === "EEXIST") return false;
      throw error;
    }
  }

  const record = `${JSON.stringify({ ...OWNER_RECORD, pid: process.pid, acquiredAtUnixMs: Date.now() })}\n`;
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
    const bytes = await readFile(lockPath);
    if (bytes.length > MAX_OWNER_RECORD_BYTES) return false;
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    return false;
  }
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify(OWNER_RECORD_KEYS) &&
    value.schemaVersion === OWNER_RECORD.schemaVersion && value.kind === OWNER_RECORD.kind &&
    Number.isSafeInteger(value.pid) && Number.isSafeInteger(value.acquiredAtUnixMs);
}

export async function withProcessBoundLock(lockPath, work, { busyCode, busyMessage }) {
  if (typeof work !== "function") throw new TypeError("Process-bound lock work callback is required.");
  await mkdir(path.dirname(lockPath), { recursive: true });
  const name = await osMutexName(lockPath);
  let mutex = null;
  if (name) {
    try {
      mutex = await bindMutex(name);
    } catch (error) {
      if (error.code === "EADDRINUSE") fail(busyCode, busyMessage);
      // No crash-released mutex here: keep the previous file-only behaviour.
      mutex = null;
    }
  }
  try {
    if (!(await createLockFile(lockPath, Boolean(mutex)))) {
      // Only an owner that also held this mutex writes a record, and we hold
      // it now, so that owner has exited. Anything else stays ambiguous.
      if (!mutex || !(await holdsOwnerRecord(lockPath))) fail(busyCode, busyMessage);
      await rm(lockPath, { force: true });
      if (!(await createLockFile(lockPath, true))) fail(busyCode, busyMessage);
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
