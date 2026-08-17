import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { SHA256_PATTERN, UUID_PATTERN } from "./constants.mjs";
import { fail } from "./errors.mjs";

export const GUEST_TRUST_FORMAT = "teamforge-guest-trust-v1";

const TRUST_KEYS = Object.freeze([
  "approvedAtUnixMs",
  "format",
  "ownerKeyId",
  "projectUuid",
  "publisherKeyId",
  "schemaVersion",
]);
const MAXIMUM_TRUST_BYTES = 16_384;

function exactKeys(value) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...TRUST_KEYS].sort());
}

export function validateGuestTrustPin(value) {
  if (!exactKeys(value) || value.schemaVersion !== 1 || value.format !== GUEST_TRUST_FORMAT ||
      !UUID_PATTERN.test(value.projectUuid ?? "") || value.projectUuid !== value.projectUuid.toLowerCase() ||
      !SHA256_PATTERN.test(value.ownerKeyId ?? "") || !SHA256_PATTERN.test(value.publisherKeyId ?? "") ||
      !Number.isSafeInteger(value.approvedAtUnixMs) || value.approvedAtUnixMs < 1) {
    fail("invalid_guest_trust_record", "Stored Guest Publisher trust is invalid.");
  }
  return value;
}

function trustPath(stateRoot, projectUuid) {
  if (!UUID_PATTERN.test(projectUuid ?? "") || projectUuid !== projectUuid.toLowerCase()) {
    fail("invalid_project_uuid", "Guest trust Project UUID is invalid.");
  }
  return path.join(path.resolve(stateRoot), "trust", `${projectUuid}.json`);
}

export async function readGuestTrustPin(stateRoot, projectUuid) {
  const destination = trustPath(stateRoot, projectUuid);
  let information;
  try {
    information = await lstat(destination);
  } catch (error) {
    if (error.code === "ENOENT") return { state: "missing", pin: null, destination };
    throw error;
  }
  if (!information.isFile() || information.isSymbolicLink() ||
      information.size <= 0 || information.size > MAXIMUM_TRUST_BYTES) {
    return { state: "invalid", pin: null, destination };
  }
  let pin;
  try {
    pin = validateGuestTrustPin(JSON.parse(await readFile(destination, "utf8")));
  } catch {
    return { state: "invalid", pin: null, destination };
  }
  if (pin.projectUuid !== projectUuid) {
    fail("guest_trust_project_conflict", "Stored Guest trust is bound to a different Project UUID.");
  }
  return { state: "valid", pin, destination };
}

export function compareGuestTrustPin(record, { projectUuid, ownerKeyId, publisherKeyId }) {
  if (record?.state !== "valid") return record?.state ?? "missing";
  const pin = record.pin;
  if (pin.projectUuid !== projectUuid) {
    fail("guest_trust_project_conflict", "Stored Guest trust is bound to a different Project UUID.");
  }
  if (pin.ownerKeyId !== ownerKeyId) {
    fail("untrusted_owner", "Stored Guest trust conflicts with the signed invite Owner identity.");
  }
  return pin.publisherKeyId === publisherKeyId ? "match" : "mismatch";
}

export async function writeGuestTrustPin(stateRoot, { projectUuid, ownerKeyId, publisherKeyId }) {
  const destination = trustPath(stateRoot, projectUuid);
  const pin = validateGuestTrustPin({
    schemaVersion: 1,
    format: GUEST_TRUST_FORMAT,
    projectUuid,
    ownerKeyId,
    publisherKeyId,
    approvedAtUnixMs: Date.now(),
  });
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(pin, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  await chmod(temporary, 0o600).catch(() => {});
  try {
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return { pin, destination };
}
