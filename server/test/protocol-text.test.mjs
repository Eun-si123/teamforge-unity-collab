import assert from "node:assert/strict";
import { test } from "node:test";
import { validateText, validateTextOrEmpty } from "../src/protocol.mjs";

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
