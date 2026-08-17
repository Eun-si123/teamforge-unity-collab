import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.mjs";
import { PRODUCT_VERSION, UUID_PATTERN } from "./constants.mjs";
import { fail } from "./errors.mjs";
import { keyIdFromPublicKey, signText, verifyText } from "./identity.mjs";
import { validateInvite } from "./invite.mjs";

export const BOOTSTRAP_INVITE_FORMAT = "teamforge-bootstrap-invite-v1";
export const SESSION_JOIN_CODE_FORMAT = "teamforge-join-v1";
export const SESSION_JOIN_CODE_PREFIX = "TF1.";
export const MAXIMUM_BOOTSTRAP_INVITE_BYTES = 65_536;

const PROJECT_INVITE_KEYS = Object.freeze([
  "format", "ownerKeyId", "ownerPublicKey", "ownerSignature", "projectId", "projectUuid",
  "realtimePath", "serverAddress", "sessionId",
]);
const BOOTSTRAP_INVITE_KEYS = Object.freeze([
  "format", "ownerKeyId", "ownerPublicKey", "ownerSignature", "projectInvite", "sessionJoinCode",
]);
const SESSION_JOIN_KEYS = Object.freeze([
  "createdUtc", "format", "hostDisplayName", "productVersion", "projectId", "projectUuid",
  "realtimePath", "sceneBaseline", "serverAddress", "sessionId",
]);
const SCENE_BASELINE_KEYS = Object.freeze(["sceneGuid", "scenePath", "sha256"]);

function exactKeys(value, expected, code) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    fail(code, "Invite contains missing or unsupported fields.");
  }
}

function safeText(value, maximum) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/u.test(value);
}

function canonicalServer(value) {
  let url;
  try { url = new URL(value); } catch { fail("invalid_join_code", "Session server address is invalid."); }
  if (!/^https?:$|^wss?:$/u.test(url.protocol) || url.username || url.password || url.search || url.hash) {
    fail("invalid_join_code", "Session server address is unsafe.");
  }
  return url.toString().replace(/\/$/u, "");
}

function decodeBase64UrlCanonical(value) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value) || value.length % 4 === 1) {
    fail("invalid_join_code", "Realtime join encoding is invalid.");
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length === 0 || bytes.toString("base64url") !== value) {
    fail("invalid_join_code", "Realtime join encoding is not canonical.");
  }
  return bytes;
}

export function validateStrictProjectInvite(invite) {
  exactKeys(invite, PROJECT_INVITE_KEYS, "invalid_invite");
  if (invite.projectUuid !== String(invite.projectUuid).toLowerCase()) {
    fail("invalid_invite", "Project UUID must be canonical lowercase.");
  }
  return validateInvite(invite);
}

export function parseSessionJoinCode(code, { expectedProductVersion = PRODUCT_VERSION } = {}) {
  if (typeof code !== "string" || !code.startsWith(SESSION_JOIN_CODE_PREFIX) || code.length > 8_192) {
    fail("invalid_join_code", "Realtime session join information is invalid.");
  }
  const encoded = code.slice(SESSION_JOIN_CODE_PREFIX.length);
  let payload;
  try {
    const source = decodeBase64UrlCanonical(encoded).toString("utf8");
    payload = JSON.parse(source);
  } catch {
    fail("invalid_join_code", "Realtime session join information is damaged.");
  }
  exactKeys(payload, SESSION_JOIN_KEYS, "invalid_join_code");
  if (payload.productVersion !== expectedProductVersion) {
    fail(
      "teamforge_version_mismatch",
      `Invite requires TeamForge ${payload.productVersion}; this runtime is TeamForge ${expectedProductVersion}.`,
      { inviteProductVersion: payload.productVersion, runtimeProductVersion: expectedProductVersion },
    );
  }
  if (payload.format !== SESSION_JOIN_CODE_FORMAT ||
      !safeText(payload.projectId, 128) || !safeText(payload.sessionId, 128) ||
      !UUID_PATTERN.test(payload.projectUuid ?? "") || payload.projectUuid !== payload.projectUuid.toLowerCase() ||
      !safeText(payload.realtimePath, 128) || payload.realtimePath.startsWith("/") ||
      /[\\?#]/u.test(payload.realtimePath) || payload.realtimePath.split("/").includes("..") ||
      typeof payload.hostDisplayName !== "string" || payload.hostDisplayName.length > 128 ||
      !safeText(payload.createdUtc, 64) || !Number.isFinite(Date.parse(payload.createdUtc))) {
    fail("invalid_join_code", "Realtime session identity is incompatible.");
  }
  canonicalServer(payload.serverAddress);
  if (payload.sceneBaseline != null) {
    const scene = payload.sceneBaseline;
    exactKeys(scene, SCENE_BASELINE_KEYS, "invalid_join_code");
    if (!safeText(scene.scenePath, 1_024) || pathIsUnsafe(scene.scenePath) ||
        !/^[0-9a-f]{32}$/u.test(scene.sceneGuid ?? "") ||
        !/^[0-9a-f]{64}$/u.test(scene.sha256 ?? "")) {
      fail("invalid_join_code", "Realtime Scene baseline is invalid.");
    }
  }
  return payload;
}

function pathIsUnsafe(value) {
  return value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:/u.test(value) ||
    value.includes("\\") || value.split("/").some((part) => part === ".." || part === ".");
}

function envelopePayload(value) {
  const digest = createHash("sha256").update(canonicalJson(value.projectInvite), "utf8").digest("hex");
  return [BOOTSTRAP_INVITE_FORMAT, digest, value.sessionJoinCode, value.ownerKeyId].join("\n");
}

export function createBootstrapInvite({ projectInvite, sessionJoinCode, ownerIdentity }) {
  const validated = validateStrictProjectInvite(projectInvite);
  const session = parseSessionJoinCode(sessionJoinCode);
  if (validated.ownerKeyId !== ownerIdentity?.keyId || validated.ownerPublicKey !== ownerIdentity?.publicKey ||
      session.projectId !== validated.projectId || session.projectUuid !== validated.projectUuid ||
      session.sessionId !== validated.sessionId || session.realtimePath !== validated.realtimePath ||
      canonicalServer(session.serverAddress) !== canonicalServer(validated.serverAddress)) {
    fail("bootstrap_invite_mismatch", "Project and realtime invite identities do not match.");
  }
  const base = {
    format: BOOTSTRAP_INVITE_FORMAT,
    projectInvite: validated,
    sessionJoinCode,
    ownerKeyId: ownerIdentity.keyId,
    ownerPublicKey: ownerIdentity.publicKey,
  };
  return { ...base, ownerSignature: signText(ownerIdentity, envelopePayload(base)) };
}

export function validateBootstrapInvite(value) {
  exactKeys(value, BOOTSTRAP_INVITE_KEYS, "invalid_bootstrap_invite");
  const projectInvite = validateStrictProjectInvite(value.projectInvite);
  const session = parseSessionJoinCode(value.sessionJoinCode);
  if (value.format !== BOOTSTRAP_INVITE_FORMAT || value.ownerKeyId !== projectInvite.ownerKeyId ||
      value.ownerPublicKey !== projectInvite.ownerPublicKey || keyIdFromPublicKey(value.ownerPublicKey) !== value.ownerKeyId ||
      !verifyText(value.ownerPublicKey, envelopePayload(value), value.ownerSignature) ||
      session.projectId !== projectInvite.projectId || session.projectUuid !== projectInvite.projectUuid ||
      session.sessionId !== projectInvite.sessionId || session.realtimePath !== projectInvite.realtimePath ||
      canonicalServer(session.serverAddress) !== canonicalServer(projectInvite.serverAddress)) {
    fail("invalid_bootstrap_invite", "Bootstrap invite signature or bound identities are invalid.");
  }
  return { envelope: value, projectInvite, sessionJoin: session };
}

export function parseGuestInvite(source) {
  if (typeof source !== "string" || Buffer.byteLength(source, "utf8") === 0 ||
      Buffer.byteLength(source, "utf8") > MAXIMUM_BOOTSTRAP_INVITE_BYTES) {
    fail("invalid_bootstrap_invite", "Invite must be a bounded UTF-8 JSON document.");
  }
  let value;
  try { value = JSON.parse(source); } catch { fail("invalid_bootstrap_invite", "Invite JSON is damaged."); }
  if (value?.format === BOOTSTRAP_INVITE_FORMAT) return validateBootstrapInvite(value);
  return { envelope: null, projectInvite: validateStrictProjectInvite(value), sessionJoin: null };
}
