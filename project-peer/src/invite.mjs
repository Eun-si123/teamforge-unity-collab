import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, writeFile } from "node:fs/promises";
import path from "node:path";
import { UUID_PATTERN } from "./constants.mjs";
import { keyIdFromPublicKey, signText, verifyText } from "./identity.mjs";
import { fail, TeamForgePeerError } from "./errors.mjs";
import { hasMalformedNumericIpv4Host, hasUnsafeServerAddressCharacters, websocketUrl } from "./url-policy.mjs";

function invitePayload(invite) {
  return [
    "teamforge-project-invite-v1",
    invite.serverAddress,
    invite.realtimePath,
    invite.projectId,
    invite.projectUuid,
    invite.sessionId,
    invite.ownerKeyId,
  ].join("\n");
}

export function createInvite({
  serverAddress,
  realtimePath = "ws",
  projectId,
  projectUuid,
  sessionId,
  ownerIdentity,
}) {
  const base = {
    format: "teamforge-project-invite-v1",
    serverAddress,
    realtimePath,
    projectId,
    projectUuid: projectUuid?.toLowerCase(),
    sessionId,
    ownerKeyId: ownerIdentity?.keyId,
    ownerPublicKey: ownerIdentity?.publicKey,
  };
  const invite = { ...base, ownerSignature: signText(ownerIdentity, invitePayload(base)) };
  return validateInvite(invite);
}

export function validateInvite(invite) {
  // Reject numeric IPv4 shorthand before URL normalization can silently retarget it.
  if (hasUnsafeServerAddressCharacters(invite?.serverAddress)) {
    fail("invalid_invite", "Invite server address cannot contain control characters.");
  }
  if (hasMalformedNumericIpv4Host(invite?.serverAddress)) {
    fail("invalid_invite", "Invite server IPv4 address must contain four canonical decimal octets.");
  }
  let server;
  try {
    server = new URL(invite?.serverAddress);
  } catch {
    fail("invalid_invite", "Invite server address is invalid.");
  }
  if (invite?.format !== "teamforge-project-invite-v1" ||
      !/^https?:$|^wss?:$/u.test(server.protocol) || server.username || server.password ||
      server.search || server.hash || !UUID_PATTERN.test(invite.projectUuid ?? "") ||
      typeof invite.realtimePath !== "string" || invite.realtimePath.length === 0 ||
      typeof invite.projectId !== "string" || invite.projectId.trim().length === 0 || invite.projectId.length > 128 ||
      typeof invite.sessionId !== "string" || invite.sessionId.trim().length === 0 || invite.sessionId.length > 128 ||
      !/^[0-9a-f]{64}$/u.test(invite.ownerKeyId ?? "") ||
      keyIdFromPublicKey(invite.ownerPublicKey) !== invite.ownerKeyId ||
      !verifyText(invite.ownerPublicKey, invitePayload(invite), invite.ownerSignature)) {
    fail("invalid_invite", "Project invite identity or Owner signature is invalid.");
  }
  // Keep signed Project Invites consistent with the actual Peer endpoint
  // policy; never accept a path that later normalizes to another route.
  try {
    websocketUrl(invite.serverAddress, invite.realtimePath);
  } catch {
    fail("invalid_invite", "Project invite realtime endpoint is invalid.");
  }
  return invite;
}

export async function saveInvite(filePath, invite) {
  validateInvite(invite);
  const destination = path.resolve(filePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(invite, null, 2)}\n`, { flag: "wx", mode: 0o600 });
}

// Saved Project Invites are small signed JSON documents. Do not allow a
// damaged or replaced file to allocate unbounded memory before validation.
const MAXIMUM_SAVED_INVITE_BYTES = 65_536;

async function readBoundedInvite(filePath) {
  const destination = path.resolve(filePath);
  const before = await lstat(destination, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size <= 0n) {
    fail("invite_load_failed", "Could not load project invite: unsafe file.");
  }
  if (before.size > BigInt(MAXIMUM_SAVED_INVITE_BYTES)) {
    fail("invite_load_failed", "Could not load project invite: file exceeds size limit.");
  }
  // Refuse final symlink swaps on POSIX, and never block on a file swapped
  // for a FIFO between lstat and open. Windows needs separate field checks.
  const flags = constants.O_RDONLY | (process.platform === "win32"
    ? 0 : ((constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)));
  const handle = await open(destination, flags);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino ||
        opened.size !== before.size) {
      fail("invite_load_failed", "Could not load project invite: file changed during open.");
    }
    const buffer = Buffer.alloc(MAXIMUM_SAVED_INVITE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const atPath = await lstat(destination, { bigint: true });
    if (length > MAXIMUM_SAVED_INVITE_BYTES || BigInt(length) !== before.size ||
        after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size ||
        !atPath.isFile() || atPath.isSymbolicLink() || atPath.dev !== before.dev ||
        atPath.ino !== before.ino || atPath.size !== before.size) {
      fail("invite_load_failed", "Could not load project invite: file changed during read.");
    }
    return buffer.toString("utf8", 0, length);
  } finally {
    await handle.close();
  }
}

export async function loadInvite(filePath) {
  let invite;
  try {
    invite = JSON.parse(await readBoundedInvite(filePath));
  } catch (error) {
    if (error instanceof TeamForgePeerError) throw error;
    // JSON errors can echo invite bytes; filesystem errors can echo local paths.
    if (error instanceof SyntaxError) {
      fail("invite_load_failed", "Could not load project invite: invalid JSON.");
    }
    const code = typeof error?.code === "string" && /^[A-Z0-9_]+$/u.test(error.code)
      ? error.code : "read error";
    fail("invite_load_failed", `Could not load project invite: ${code}.`);
  }
  return validateInvite(invite);
}
