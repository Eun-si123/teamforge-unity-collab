import assert from "node:assert/strict";
import { test } from "node:test";
import { validateEnvelope, validateText, validateTextOrEmpty } from "../src/protocol.mjs";

test("required text rejects excessive raw whitespace padding", () => {
  assert.match(validateText("req" + " ".repeat(129), "requestId", 128), /1-128/);
  assert.match(validateText(" ".repeat(129) + "req", "requestId", 128), /1-128/);
});

test("optional text rejects oversized raw whitespace-only input", () => {
  assert.match(validateTextOrEmpty(" ".repeat(129), "activity", 128), /at most 128/);
});

test("normal bounded text and optional empty values remain accepted", () => {
  assert.equal(validateText(" req ", "requestId", 128), null);
  assert.equal(validateText("a".repeat(128), "requestId", 128), null);
  assert.equal(validateTextOrEmpty("", "activity", 128), null);
  assert.equal(validateTextOrEmpty("  hello  ", "activity", 128), null);
  assert.match(validateText(" ", "requestId", 128), /1-128/);
  assert.match(validateText("a\u0000b", "requestId", 128), /1-128/);
});

test("required text rejects raw controls before trimming", () => {
  for (const value of ["\nreq", "req\r", "\treq\n", "req\u0000", "req\u007f", "req\u0080", "req\u0085", "req\u009f", "req\u2028", "req\u2029"]) {
    assert.match(validateText(value, "requestId", 128), /1-128/, `Accepted ${JSON.stringify(value)}`);
  }
});

test("optional text rejects raw controls but preserves ordinary printable Unicode", () => {
  for (const value of ["\n", " \t ", "req\r", "req\u0080", "req\u0085", "req\u009f", "req\u2028", "req\u2029"]) {
    assert.match(validateTextOrEmpty(value, "activity", 128), /at most 128/, `Accepted ${JSON.stringify(value)}`);
  }

  for (const value of ["", "  ", "  hello  ", "한글 🚀", "👩‍💻 ZWJ", "a".repeat(128)]) {
    assert.equal(validateTextOrEmpty(value, "activity", 128), null);
  }
  assert.equal(validateText(" 한글 🚀 ", "requestId", 128), null);
});


test("envelope rejects control characters in message type without changing valid types", () => {
  assert.equal(validateEnvelope({ type: "join", protocolVersion: 1 }), null);
  for (const type of ["join\n", "join\u0000", "join\u0085", "join\u2028", "join\u2029"]) {
    assert.equal(validateEnvelope({ type, protocolVersion: 1 }), "Message type is invalid.");
  }
});
