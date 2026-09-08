import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, realpath, rm, stat } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import { fail } from "./errors.mjs";

const execFileAsync = promisify(execFile);
const LEGACY_LOCK_NAME = "project-identity.lock";
const WINDOWS_FENCE = Object.freeze({
  schemaVersion: 2,
  kind: "teamforge-project-identity-lock-fence",
  mechanism: "windows-named-pipe",
});
const WINDOWS_LOCK_WAIT_MS = 1500;
const WINDOWS_LOCK_RETRY_MS = 50;
const WINDOWS_ROOT_PROBE_TIMEOUT_MS = 5000;
const verifiedWindowsRoots = new Set();

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function busy(message = "Another TeamForge process is initializing Project identity.") {
  fail("project_identity_busy", message);
}

function legacyBusy() {
  busy(
    "Another TeamForge process may be initializing Project identity. " +
    "If this persists after all TeamForge processes have stopped, an abnormal termination may have left project-identity.lock. " +
    "TeamForge will not remove an ambiguous legacy lock automatically because Project identity safety cannot be proven.",
  );
}

function validWindowsFence(value) {
  return value?.schemaVersion === WINDOWS_FENCE.schemaVersion &&
    value?.kind === WINDOWS_FENCE.kind &&
    value?.mechanism === WINDOWS_FENCE.mechanism;
}

async function readFenceState(lockPath) {
  let source;
  try {
    source = await readFile(lockPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "missing";
    if (error.code === "EACCES" || error.code === "EPERM" || error.code === "EISDIR") return "ambiguous";
    throw error;
  }
  try {
    return validWindowsFence(JSON.parse(source)) ? "v2" : "ambiguous";
  } catch {
    return "ambiguous";
  }
}

async function installWindowsCompatibilityFence(managedRoot) {
  const lockPath = path.join(managedRoot, LEGACY_LOCK_NAME);
  const state = await readFenceState(lockPath);
  if (state === "v2") return;
  if (state === "ambiguous") legacyBusy();

  const temporary = path.join(managedRoot, `.project-identity-fence-${randomUUID()}.tmp`);
  let handle = null;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(WINDOWS_FENCE, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    try {
      await link(temporary, lockPath);
    } catch (error) {
      if (error.code === "EEXIST") {
        const winner = await readFenceState(lockPath);
        if (winner === "v2") return;
        legacyBusy();
      }
      if (error.code === "EPERM" || error.code === "EOPNOTSUPP" || error.code === "ENOTSUP") {
        fail(
          "project_identity_lock_unsupported",
          "This managed root cannot publish the atomic Project identity compatibility fence required for crash-safe locking.",
        );
      }
      throw error;
    }
  } finally {
    if (handle) await handle.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
  }
}

async function assertSupportedWindowsManagedRoot(canonicalRoot) {
  const key = canonicalRoot.toLowerCase();
  if (verifiedWindowsRoots.has(key)) return;

  const systemRoot = process.env.SystemRoot;
  if (typeof systemRoot !== "string" || !path.win32.isAbsolute(systemRoot)) {
    fail(
      "project_identity_lock_unsupported",
      "Windows Project identity crash recovery could not locate the built-in Windows system tools required to verify the managed root.",
    );
  }
  const powershell = path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const probe = [
    "$ErrorActionPreference='Stop'",
    "$root=[System.IO.Path]::GetPathRoot($env:TEAMFORGE_IDENTITY_ROOT)",
    "if ([string]::IsNullOrWhiteSpace($root)) { exit 22 }",
    "$drive=[System.IO.DriveInfo]::new($root)",
    "if ($drive.DriveType -ne [System.IO.DriveType]::Fixed) { exit 23 }",
    "if ($drive.DriveFormat -notin @('NTFS','ReFS')) { exit 24 }",
  ].join("; ");
  try {
    await execFileAsync(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", probe], {
      env: { ...process.env, TEAMFORGE_IDENTITY_ROOT: canonicalRoot },
      timeout: WINDOWS_ROOT_PROBE_TIMEOUT_MS,
      windowsHide: true,
    });
  } catch (error) {
    fail(
      "project_identity_lock_unsupported",
      "Crash-safe Project identity locking requires a local fixed NTFS/ReFS managed root on Windows. Network, unavailable, or unverified roots remain fail-closed.",
      { cause: error.code ?? "windows_root_probe_failed" },
    );
  }
  verifiedWindowsRoots.add(key);
}

async function windowsPipeName(canonicalRoot) {
  const details = await stat(canonicalRoot, { bigint: true });
  const identity = `${canonicalRoot.toLowerCase()}\n${details.dev.toString()}\n${details.ino.toString()}`;
  const digest = createHash("sha256").update(identity, "utf8").digest("hex");
  return `\\\\.\\pipe\\teamforge-project-identity-v2-${digest}`;
}

function tryBindWindowsPipe(pipeName) {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => socket.destroy());
    const onError = (error) => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve(server);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(pipeName);
  });
}

async function acquireWindowsPipe(pipeName, waitMs) {
  const deadline = Date.now() + waitMs;
  while (true) {
    try {
      return await tryBindWindowsPipe(pipeName);
    } catch (error) {
      if (error.code !== "EADDRINUSE") {
        fail(
          "project_identity_lock_unavailable",
          "Windows could not establish the OS-owned Project identity lock.",
          { cause: error.code ?? "named_pipe_bind_failed" },
        );
      }
      if (Date.now() >= deadline) {
        busy("Another TeamForge process is still initializing Project identity after the bounded wait period.");
      }
      await delay(WINDOWS_LOCK_RETRY_MS);
    }
  }
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function withWindowsIdentityLock(managedRoot, work, waitMs) {
  const canonicalRoot = await realpath(managedRoot);
  await assertSupportedWindowsManagedRoot(canonicalRoot);
  await installWindowsCompatibilityFence(managedRoot);
  const pipeName = await windowsPipeName(canonicalRoot);
  const server = await acquireWindowsPipe(pipeName, waitMs);
  try {
    return await work();
  } finally {
    await closeServer(server);
  }
}

async function withLegacyIdentityLock(managedRoot, work) {
  const lockPath = path.join(managedRoot, LEGACY_LOCK_NAME);
  const lock = await open(lockPath, "wx", 0o600).catch((error) => {
    if (error.code === "EEXIST") legacyBusy();
    throw error;
  });
  try {
    return await work();
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

export async function withProjectIdentityLock(managedRoot, work, { waitMs = WINDOWS_LOCK_WAIT_MS } = {}) {
  if (typeof work !== "function") throw new TypeError("Project identity lock work callback is required.");
  if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 30000) {
    throw new RangeError("Project identity lock wait must be an integer from 0 through 30000 milliseconds.");
  }
  await mkdir(managedRoot, { recursive: true });
  if (process.platform === "win32") {
    return await withWindowsIdentityLock(managedRoot, work, waitMs);
  }
  return await withLegacyIdentityLock(managedRoot, work);
}
