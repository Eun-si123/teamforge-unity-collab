import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import {
  MANIFEST_SCHEMA_VERSION,
  REALTIME_PROTOCOL_VERSION,
  TRANSFER_PROTOCOL_VERSION,
  UUID_PATTERN,
} from "./constants.mjs";
import { websocketUrl } from "./url-policy.mjs";
import { normalizeRelativePath } from "./path-policy.mjs";
import { fail } from "./errors.mjs";

const MAXIMUM_LAUNCH_SETTINGS_BYTES = 65_536;
const REQUIRED_LAUNCH_FIELDS = new Set([
  "schemaVersion",
  "serverAddress",
  "realtimePath",
  "projectId",
  "sessionId",
  "projectUuid",
  "sourceProjectRelativePath",
  "projectDescriptorRelativePath",
  "managedProjectsRelativePath",
  "realtimeProtocolVersion",
  "transferProtocolVersion",
  "manifestSchemaVersion",
  "authenticationTokenEnvironmentVariable",
  "ownerKeyEnvironmentVariable",
  "allowCurrentProjectAsSeedSource",
]);
const OPTIONAL_LAUNCH_FIELDS = new Set([
  // This is an operational listener setting, not part of either Protocol v1
  // invite. Older launch files omit it and keep their legacy local-only bind.
  "coordinatorListenHost",
]);

function validText(value, maximum) {
  return typeof value === "string" && value.trim() === value && value.length > 0 &&
    value.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(value);
}

function validListenHost(value) {
  if (!validText(value, 253)) return false;
  const authority = value.includes(":") ? `[${value}]` : value;
  try {
    const url = new URL(`http://${authority}/`);
    return !url.username && !url.password && !url.port && url.pathname === "/" &&
      !url.search && !url.hash;
  } catch {
    return false;
  }
}

function relativePath(value, allowDot = false, allowEmpty = false) {
  if (allowEmpty && value === "") {
    return "";
  }
  if (allowDot && value === ".") {
    return value;
  }
  return normalizeRelativePath(value);
}

function resolveWithin(base, relative, label) {
  const destination = path.resolve(base, ...relative.split("/"));
  const back = path.relative(base, destination);
  if (back === ".." || back.startsWith(`..${path.sep}`) || path.isAbsolute(back)) {
    fail("launch_path_escape", `${label} escapes the launch-settings directory.`);
  }
  return destination;
}

export function validateLaunchSettings(settings) {
  const keys = settings && typeof settings === "object" && !Array.isArray(settings)
    ? Object.keys(settings)
    : [];
  if (!settings || typeof settings !== "object" || Array.isArray(settings) ||
      Object.getPrototypeOf(settings) !== Object.prototype ||
      [...REQUIRED_LAUNCH_FIELDS].some((key) => !Object.hasOwn(settings, key)) ||
      keys.some((key) => !REQUIRED_LAUNCH_FIELDS.has(key) && !OPTIONAL_LAUNCH_FIELDS.has(key))) {
    fail("invalid_launch_settings", "Launch settings contain missing, unknown, or secret-bearing fields.");
  }
  if (settings.schemaVersion !== 1 ||
      settings.realtimeProtocolVersion !== REALTIME_PROTOCOL_VERSION ||
      settings.transferProtocolVersion !== TRANSFER_PROTOCOL_VERSION ||
      settings.manifestSchemaVersion !== MANIFEST_SCHEMA_VERSION ||
      !validText(settings.projectId, 128) || !validText(settings.sessionId, 128) ||
      !UUID_PATTERN.test(settings.projectUuid ?? "") || settings.projectUuid !== settings.projectUuid.toLowerCase() ||
      typeof settings.allowCurrentProjectAsSeedSource !== "boolean" ||
      (settings.coordinatorListenHost !== undefined &&
        !validListenHost(settings.coordinatorListenHost)) ||
      !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u.test(settings.authenticationTokenEnvironmentVariable ?? "") ||
      !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u.test(settings.ownerKeyEnvironmentVariable ?? "")) {
    fail("invalid_launch_settings", "Launch settings metadata is invalid or protocol-incompatible.");
  }
  websocketUrl(settings.serverAddress, settings.realtimePath);
  relativePath(settings.managedProjectsRelativePath);
  if (settings.allowCurrentProjectAsSeedSource) {
    relativePath(settings.sourceProjectRelativePath, true);
    relativePath(settings.projectDescriptorRelativePath);
  } else if (settings.sourceProjectRelativePath !== "" || settings.projectDescriptorRelativePath !== "") {
    fail("invalid_launch_settings", "Download-only launch settings cannot name a source Project.");
  }
  return settings;
}

export async function loadLaunchSettings(filePath, { requireSeedSource = false } = {}) {
  const destination = path.resolve(filePath);
  let information;
  try {
    information = await lstat(destination);
  } catch (error) {
    fail("launch_settings_load_failed", `Could not inspect launch settings: ${error.message}`);
  }
  if (!information.isFile() || information.isSymbolicLink() || information.size <= 0 ||
      information.size > MAXIMUM_LAUNCH_SETTINGS_BYTES) {
    fail("invalid_launch_settings_file", "Launch settings must be a bounded regular file, not a link.");
  }
  let settings;
  try {
    settings = JSON.parse(await readFile(destination, "utf8"));
  } catch (error) {
    fail("launch_settings_load_failed", `Could not parse launch settings: ${error.message}`);
  }
  validateLaunchSettings(settings);
  if (requireSeedSource && !settings.allowCurrentProjectAsSeedSource) {
    fail("source_project_not_authorized", "Launch settings do not explicitly authorize the current Project as a seed source.");
  }
  const base = path.dirname(destination);
  const sourceProjectRoot = settings.allowCurrentProjectAsSeedSource
    ? resolveWithin(base, settings.sourceProjectRelativePath === "." ? "." : settings.sourceProjectRelativePath, "Source Project")
    : "";
  const projectDescriptorPath = settings.allowCurrentProjectAsSeedSource
    ? resolveWithin(base, settings.projectDescriptorRelativePath, "Project descriptor")
    : "";
  const managedRoot = resolveWithin(base, settings.managedProjectsRelativePath, "Managed Projects root");
  if (settings.allowCurrentProjectAsSeedSource) {
    const expectedDescriptor = path.join(sourceProjectRoot, "ProjectSettings", "TeamForgeProject.json");
    if (projectDescriptorPath !== expectedDescriptor) {
      fail(
        "invalid_launch_settings_path",
        "Launch descriptor path must resolve to ProjectSettings/TeamForgeProject.json inside the source Project.",
      );
    }
  }
  return { settings, filePath: destination, base, sourceProjectRoot, projectDescriptorPath, managedRoot };
}
