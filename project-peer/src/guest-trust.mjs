import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { SHA256_PATTERN, UUID_PATTERN } from "./constants.mjs";
import { fail } from "./errors.mjs";
import { assertNoRedirectedDirectorySegments } from "./filesystem-safety.mjs";

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

async function assertSafeTrustDirectory(destination) {
  await assertNoRedirectedDirectorySegments(path.dirname(destination), {
    code: "unsafe_guest_trust_root",
    message: "Guest trust storage must not use redirected directories.",
  });
}

export async function readGuestTrustPin(stateRoot, projectUuid) {
  const destination = trustPath(stateRoot, projectUuid);
  const invalid = () => ({ state: "invalid", pin: null, destination });
  let information;
  try {
    await assertSafeTrustDirectory(destination);
    // Preserve full filesystem IDs; Windows inode values can exceed Number precision.
    information = await lstat(destination, { bigint: true });
  } catch (error) {
    if (error.code === "ENOENT") return { state: "missing", pin: null, destination };
    // A non-directory trust store or inaccessible path is not a missing pin.
    return invalid();
  }
  if (!information.isFile() || information.isSymbolicLink() ||
      information.size <= 0n || information.size > BigInt(MAXIMUM_TRUST_BYTES)) {
    return invalid();
  }
  let pin;
  let handle;
  try {
    // Keep the opened inode pinned. Never follow a final symlink swapped in
    // between lstat and open, or allocate beyond the serialized pin budget.
    // O_NONBLOCK also prevents a swapped FIFO from hanging before stat().
    handle = await open(destination, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0));
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.dev !== information.dev || opened.ino !== information.ino ||
        opened.size <= 0n || opened.size > BigInt(MAXIMUM_TRUST_BYTES)) return invalid();
    const buffer = Buffer.alloc(MAXIMUM_TRUST_BYTES + 1);
    let count = 0;
    while (count < buffer.length) {
      const { bytesRead } = await handle.read(buffer, count, buffer.length - count, null);
      if (bytesRead === 0) break;
      count += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const atPath = await lstat(destination, { bigint: true });
    if (count === 0 || count > MAXIMUM_TRUST_BYTES ||
        opened.size !== information.size || after.size !== opened.size || after.size !== BigInt(count) ||
        after.dev !== opened.dev || after.ino !== opened.ino ||
        !atPath.isFile() || atPath.isSymbolicLink() ||
        atPath.dev !== opened.dev || atPath.ino !== opened.ino || atPath.size !== BigInt(count)) return invalid();
    pin = validateGuestTrustPin(JSON.parse(buffer.subarray(0, count).toString("utf8")));
  } catch {
    return invalid();
  } finally {
    await handle?.close();
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
  // The Guest state root may have been prepared earlier; reject any trust
  // directory redirected since that inspection, before creating or writing.
  await assertSafeTrustDirectory(destination);
  await mkdir(path.dirname(destination), { recursive: true });
  await assertSafeTrustDirectory(destination);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    // A failed or interrupted write may have already created the temporary
    // file. Keep its cleanup in the same failure path as the final rename.
    await writeFile(temporary, `${JSON.stringify(pin, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await chmod(temporary, 0o600).catch(() => {});
    await assertSafeTrustDirectory(destination);
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return { pin, destination };
}
