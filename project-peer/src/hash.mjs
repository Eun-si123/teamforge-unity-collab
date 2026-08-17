import { createHash, timingSafeEqual } from "node:crypto";
import { SHA256_PATTERN } from "./constants.mjs";
import { fail } from "./errors.mjs";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function requireSha256(value, name = "hash") {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail("invalid_hash", `${name} must be a lowercase SHA-256 hex string.`);
  }
  return value;
}

export function safeTokenEqual(supplied, expected) {
  if (typeof supplied !== "string" || typeof expected !== "string") {
    return false;
  }
  const left = Buffer.from(supplied, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
