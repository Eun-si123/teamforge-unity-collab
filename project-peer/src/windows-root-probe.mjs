const WINDOWS_ROOT_PROBE_CAUSES = new Map([
  [22, "windows_root_unavailable"],
  [23, "windows_root_drive_not_fixed"],
  [24, "windows_root_filesystem_unsupported"],
]);

// Error.code can come from Windows/process APIs. Do not return unknown strings
// verbatim: diagnostics must never echo paths, executable messages or secrets.
const SAFE_SPAWN_ERRORS = new Set([
  "ENOENT", "EACCES", "EPERM", "ETIMEDOUT", "EAGAIN", "UNKNOWN",
  "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
]);
const SAFE_SIGNALS = new Set(["SIGTERM", "SIGKILL", "SIGINT"]);

function safeExitCode(raw) {
  if (typeof raw === "number") {
    return Number.isInteger(raw) && raw >= 0 && raw <= 255 ? raw : null;
  }
  if (typeof raw === "string" && /^(?:0|[1-9][0-9]{0,2})$/u.test(raw)) {
    const numeric = Number(raw);
    return numeric <= 255 ? numeric : null;
  }
  return null;
}

export function windowsRootProbeFailureCause(error) {
  const exitCode = safeExitCode(error?.code);
  if (exitCode !== null && WINDOWS_ROOT_PROBE_CAUSES.has(exitCode)) {
    return WINDOWS_ROOT_PROBE_CAUSES.get(exitCode);
  }
  return SAFE_SPAWN_ERRORS.has(error?.code)
    ? error.code
    : "windows_root_probe_failed";
}

// Bounded, public-safe details let CI distinguish an unexpected PowerShell
// exit (e.g. 1), a forcibly terminated probe and a legitimate fixed-drive
// rejection. No stdout/stderr, paths, command line, stack or raw error.message.
export function windowsRootProbeFailureDetails(error, elapsedMs) {
  const details = { cause: windowsRootProbeFailureCause(error) };
  const exitCode = safeExitCode(error?.code);
  if (exitCode !== null) details.probeExitCode = exitCode;
  if (error?.killed === true) details.probeTerminated = true;
  if (SAFE_SIGNALS.has(error?.signal)) details.probeSignal = error.signal;
  if (Number.isSafeInteger(elapsedMs) && elapsedMs >= 0 && elapsedMs <= 60000) {
    details.probeElapsedMs = elapsedMs;
  }
  return details;
}
