import { randomUUID } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  MANIFEST_SCHEMA_VERSION,
  PRODUCT_VERSION,
  REALTIME_PROTOCOL_VERSION,
  SHA256_PATTERN,
  TRANSFER_PROTOCOL_VERSION,
  UUID_PATTERN,
} from "./constants.mjs";
import { sha256 } from "./hash.mjs";
import { fail } from "./errors.mjs";

export const UNITY_DESCRIPTOR_RELATIVE_PATH = "ProjectSettings/TeamForgeProject.json";
const MAXIMUM_DESCRIPTOR_BYTES = 65_536;
const DESCRIPTOR_FIELDS = new Set([
  "schemaVersion",
  "projectUuid",
  "baselineRevision",
  "manifestHash",
  "descriptorHash",
  "unityVersion",
  "teamForgePackageVersion",
  "realtimeProtocolVersion",
  "transferProtocolVersion",
  "manifestSchemaVersion",
]);

function canonicalUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value) && value === value.toLowerCase();
}

function validVersion(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 64 &&
    !/[\u0000-\u001f\u007f]/u.test(value);
}

export function validateUnityProjectDescriptor(descriptor, {
  expectedProjectUuid = undefined,
  expectedUnityVersion = undefined,
} = {}) {
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor) ||
      Object.getPrototypeOf(descriptor) !== Object.prototype) {
    fail("invalid_unity_descriptor", "Unity Project descriptor must be a JSON object.");
  }
  const keys = Object.keys(descriptor);
  if (keys.some((key) => !DESCRIPTOR_FIELDS.has(key)) || keys.length !== DESCRIPTOR_FIELDS.size) {
    fail(
      "invalid_unity_descriptor",
      "Unity Project descriptor contains missing, unknown, or potentially secret-bearing fields.",
    );
  }
  if (descriptor.schemaVersion !== 1 || !canonicalUuid(descriptor.projectUuid) ||
      !Number.isSafeInteger(descriptor.baselineRevision) || descriptor.baselineRevision < 0 ||
      !validVersion(descriptor.unityVersion) || descriptor.teamForgePackageVersion !== PRODUCT_VERSION ||
      descriptor.realtimeProtocolVersion !== REALTIME_PROTOCOL_VERSION ||
      descriptor.transferProtocolVersion !== TRANSFER_PROTOCOL_VERSION ||
      descriptor.manifestSchemaVersion !== MANIFEST_SCHEMA_VERSION) {
    fail("invalid_unity_descriptor", "Unity Project descriptor metadata is invalid or incompatible.");
  }
  if (descriptor.baselineRevision === 0) {
    if (descriptor.manifestHash !== "" || descriptor.descriptorHash !== "") {
      fail("invalid_unity_descriptor", "An unpublished Unity Project descriptor cannot contain Baseline hashes.");
    }
  } else if (!SHA256_PATTERN.test(descriptor.manifestHash ?? "") ||
      !SHA256_PATTERN.test(descriptor.descriptorHash ?? "")) {
    fail("invalid_unity_descriptor", "A published Unity Project descriptor requires valid Baseline hashes.");
  }
  if (expectedProjectUuid && descriptor.projectUuid !== expectedProjectUuid.toLowerCase()) {
    fail("project_uuid_conflict", "Unity Project descriptor UUID conflicts with the managed Project identity.");
  }
  if (expectedUnityVersion && descriptor.unityVersion !== expectedUnityVersion) {
    fail("unity_version_mismatch", "Unity Project descriptor version differs from ProjectVersion.txt.");
  }
  return descriptor;
}

export function unityProjectDescriptorFromBaseline(descriptor) {
  return validateUnityProjectDescriptor({
    schemaVersion: 1,
    projectUuid: descriptor.projectUuid,
    baselineRevision: descriptor.baselineRevision,
    manifestHash: descriptor.manifestHash,
    descriptorHash: descriptor.descriptorHash,
    unityVersion: descriptor.unityVersion,
    teamForgePackageVersion: descriptor.teamForgePackageVersion,
    realtimeProtocolVersion: descriptor.realtimeProtocolVersion,
    transferProtocolVersion: descriptor.transferProtocolVersion,
    manifestSchemaVersion: descriptor.manifestSchemaVersion,
  });
}

function descriptorPath(projectRoot, explicitPath = undefined) {
  const root = path.resolve(projectRoot);
  const destination = explicitPath
    ? path.resolve(explicitPath)
    : path.join(root, ...UNITY_DESCRIPTOR_RELATIVE_PATH.split("/"));
  const relative = path.relative(root, destination);
  if (relative !== UNITY_DESCRIPTOR_RELATIVE_PATH.replaceAll("/", path.sep)) {
    fail(
      "invalid_unity_descriptor_path",
      `Unity descriptor must be exactly ${UNITY_DESCRIPTOR_RELATIVE_PATH} inside the source Project.`,
    );
  }
  return destination;
}

async function readRegularBounded(destination) {
  let information;
  try {
    information = await lstat(destination);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  if (!information.isFile() || information.isSymbolicLink() ||
      information.size <= 0 || information.size > MAXIMUM_DESCRIPTOR_BYTES) {
    fail("invalid_unity_descriptor_file", "Unity Project descriptor must be a bounded regular file, not a link.");
  }
  const bytes = await readFile(destination);
  if (bytes.length !== information.size || bytes.length > MAXIMUM_DESCRIPTOR_BYTES) {
    fail("unity_descriptor_changed", "Unity Project descriptor changed while it was being read.");
  }
  return bytes;
}

export async function readUnityProjectDescriptor(projectRoot, {
  explicitPath = undefined,
  expectedProjectUuid = undefined,
  expectedUnityVersion = undefined,
  required = false,
} = {}) {
  const destination = descriptorPath(projectRoot, explicitPath);
  const bytes = await readRegularBounded(destination);
  if (!bytes) {
    if (required) {
      fail("unity_descriptor_missing", `Unity Project descriptor is missing at ${UNITY_DESCRIPTOR_RELATIVE_PATH}.`);
    }
    return { descriptor: null, destination, digest: null };
  }
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail("invalid_unity_descriptor", `Unity Project descriptor is not valid JSON: ${error.message}`);
  }
  return {
    descriptor: validateUnityProjectDescriptor(parsed, { expectedProjectUuid, expectedUnityVersion }),
    destination,
    digest: sha256(bytes),
  };
}

export async function assertUnityProjectDescriptorUnchanged({
  projectRoot,
  explicitPath = undefined,
  expectedDigest,
}) {
  const destination = descriptorPath(projectRoot, explicitPath);
  const bytes = await readRegularBounded(destination);
  const actualDigest = bytes ? sha256(bytes) : null;
  if (actualDigest !== expectedDigest) {
    fail("unity_descriptor_changed", "Unity Project descriptor changed during publication; Publish was not sent.");
  }
  return true;
}

async function createNewFromTemporary(temporary, destination) {
  try {
    await link(temporary, destination);
  } catch (error) {
    if (error.code === "EEXIST") {
      fail("unity_descriptor_changed", "Unity Project descriptor appeared while publication was in progress.");
    }
    throw error;
  }
}

export async function writeUnityProjectDescriptor({
  projectRoot,
  baselineDescriptor,
  explicitPath = undefined,
  expectedDigest = undefined,
}) {
  const destination = descriptorPath(projectRoot, explicitPath);
  const descriptor = unityProjectDescriptorFromBaseline(baselineDescriptor);
  const bytes = Buffer.from(`${JSON.stringify(descriptor, null, 2)}\n`, "utf8");
  const lockPath = `${destination}.lock`;
  await mkdir(path.dirname(destination), { recursive: true });
  const lock = await open(lockPath, "wx", 0o600).catch((error) => {
    if (error.code === "EEXIST") {
      fail("unity_descriptor_busy", "Another Unity descriptor update is already in progress.");
    }
    throw error;
  });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    const current = await readRegularBounded(destination);
    const currentDigest = current ? sha256(current) : null;
    if (expectedDigest !== undefined && currentDigest !== expectedDigest) {
      fail("unity_descriptor_changed", "Unity Project descriptor changed during publication; it was not overwritten.");
    }
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o644 });
    await chmod(temporary, 0o644).catch(() => {});
    if (current === null) {
      await createNewFromTemporary(temporary, destination);
    } else {
      await rename(temporary, destination);
    }
    const verified = await readUnityProjectDescriptor(projectRoot, {
      explicitPath: destination,
      expectedProjectUuid: descriptor.projectUuid,
      expectedUnityVersion: descriptor.unityVersion,
      required: true,
    });
    if (verified.descriptor.baselineRevision !== descriptor.baselineRevision ||
        verified.descriptor.manifestHash !== descriptor.manifestHash ||
        verified.descriptor.descriptorHash !== descriptor.descriptorHash) {
      fail("unity_descriptor_write_failed", "Unity Project descriptor did not verify after its atomic update.");
    }
    return { descriptor, destination, digest: verified.digest };
  } finally {
    await lock.close();
    await rm(temporary, { force: true });
    await rm(lockPath, { force: true });
  }
}
