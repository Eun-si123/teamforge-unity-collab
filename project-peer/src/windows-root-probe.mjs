const WINDOWS_ROOT_PROBE_CAUSES = new Map([
  [22, "windows_root_unavailable"],
  [23, "windows_root_drive_not_fixed"],
  [24, "windows_root_filesystem_unsupported"],
]);

export function windowsRootProbeFailureCause(error) {
  const exitCode = typeof error?.code === "number" ? error.code : Number(error?.code);
  if (Number.isInteger(exitCode) && WINDOWS_ROOT_PROBE_CAUSES.has(exitCode)) {
    return WINDOWS_ROOT_PROBE_CAUSES.get(exitCode);
  }
  return typeof error?.code === "string" && error.code.length > 0
    ? error.code
    : "windows_root_probe_failed";
}
