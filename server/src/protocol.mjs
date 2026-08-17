export const PROTOCOL_VERSION = 1;
export const SERVER_VERSION = "0.5.1";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const HTML_COLOR = /^#[0-9a-fA-F]{6}$/;

export function validateText(value, name, maximumLength) {
  if (typeof value !== "string") {
    return `${name} must be a string.`;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maximumLength || CONTROL_CHARACTERS.test(trimmed)) {
    return `${name} must contain 1-${maximumLength} printable characters.`;
  }

  return null;
}

export function validateTextOrEmpty(value, name, maximumLength) {
  if (typeof value !== "string") {
    return `${name} must be a string.`;
  }

  const trimmed = value.trim();
  if (trimmed.length > maximumLength || CONTROL_CHARACTERS.test(trimmed)) {
    return `${name} must contain at most ${maximumLength} printable characters.`;
  }

  return null;
}

export function validateHtmlColor(value, name = "userColor") {
  return typeof value === "string" && HTML_COLOR.test(value)
    ? null
    : `${name} must use the #RRGGBB format.`;
}

export function validateVector3(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return `${name} must be a vector object.`;
  }

  for (const axis of ["x", "y", "z"]) {
    if (!Number.isFinite(value[axis]) || Math.abs(value[axis]) > 1_000_000_000) {
      return `${name}.${axis} must be a finite coordinate within the safety limit.`;
    }
  }

  return null;
}

export function validateQuaternion(value, name) {
  const vectorError = validateVector3(value, name);
  if (vectorError) {
    return vectorError;
  }

  if (!Number.isFinite(value.w) || Math.abs(value.w) > 1_000_000_000) {
    return `${name}.w must be finite and within the safety limit.`;
  }

  return null;
}

export function deterministicColor(seed) {
  const palette = [
    "#E57373",
    "#64B5F6",
    "#81C784",
    "#FFD54F",
    "#BA68C8",
    "#4DD0E1",
    "#FF8A65",
    "#A1887F",
  ];
  let hash = 2166136261;
  for (const character of String(seed)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return palette[(hash >>> 0) % palette.length];
}

export function validateEnvelope(message) {
  if (message === null || typeof message !== "object" || Array.isArray(message)) {
    return "Message must be a JSON object.";
  }

  if (typeof message.type !== "string" || message.type.length === 0 || message.type.length > 64) {
    return "Message type is invalid.";
  }

  if (message.protocolVersion !== PROTOCOL_VERSION) {
    return `Unsupported protocol version. Expected ${PROTOCOL_VERSION}.`;
  }

  return null;
}

export function errorMessage(code, message, requestId = "") {
  return {
    type: "error",
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    code,
    message,
  };
}
