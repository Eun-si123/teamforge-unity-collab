import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { UUID_PATTERN } from "./constants.mjs";
import { keyIdFromPublicKey, signText, verifyText } from "./identity.mjs";
import { fail } from "./errors.mjs";
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

export async function loadInvite(filePath) {
  let invite;
  try {
    invite = JSON.parse(await readFile(path.resolve(filePath), "utf8"));
  } catch (error) {
    // Node's JSON parser may echo excerpts of a malformed invite (including
    // private fields). Preserve filesystem diagnostics but not input bytes.
    if (error instanceof SyntaxError) {
      fail("invite_load_failed", "Could not load project invite: invalid JSON.");
    }
    fail("invite_load_failed", `Could not load project invite: ${error.message}`);
  }
  return validateInvite(invite);
}
