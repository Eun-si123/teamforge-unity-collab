import { fail } from "./errors.mjs";

function normalize(value, stack) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail("invalid_canonical_number", "Canonical JSON cannot contain NaN or Infinity.");
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (stack.has(value)) {
      fail("canonical_cycle", "Canonical JSON cannot contain reference cycles.");
    }
    stack.add(value);
    const result = value.map((entry) => {
      if (entry === undefined || typeof entry === "function" || typeof entry === "symbol") {
        fail("invalid_canonical_value", "Canonical JSON arrays cannot contain unsupported values.");
      }
      return normalize(entry, stack);
    });
    stack.delete(value);
    return result;
  }
  if (typeof value === "object") {
    if (stack.has(value)) {
      fail("canonical_cycle", "Canonical JSON cannot contain reference cycles.");
    }
    stack.add(value);
    const result = {};
    for (const key of Object.keys(value).sort()) {
      const entry = value[key];
      if (entry === undefined || typeof entry === "function" || typeof entry === "symbol") {
        continue;
      }
      result[key] = normalize(entry, stack);
    }
    stack.delete(value);
    return result;
  }
  fail("invalid_canonical_value", `Canonical JSON cannot encode ${typeof value}.`);
}

export function canonicalJson(value) {
  return JSON.stringify(normalize(value, new Set()));
}
