import assert from "node:assert/strict";
import test from "node:test";
import { classifyUnityProjectVersion } from "../src/unity-version-policy.mjs";

test("released baseline and LTS patch keep their existing source compatibility classification", () => {
  for (const version of ["6000.3.21f1", "6000.3.27f2"]) {
    assert.equal(classifyUnityProjectVersion(version), "lts", version);
  }
});

test("stable Unity 6.6 tokens are explicitly experimental, not promoted to the LTS line", () => {
  assert.equal(classifyUnityProjectVersion("6000.6.7f1"), "experimental");
  assert.notEqual(classifyUnityProjectVersion("6000.6.7f1"), "lts");
});

test("other historical and future Editor lines fail closed", () => {
  for (const version of [
    "2022.3.62f3", "2023.2.1f1", "6000.0.85f1", "6000.2.7f1",
    "6000.4.7f1", "6000.5.1f1", "6000.7.1f1", "6000.60.7f1",
    "6001.6.7f1", "7000.0.1f1",
  ]) assert.equal(classifyUnityProjectVersion(version), null, version);
});

test("source admission remains stable-f-only for both admitted lines", () => {
  for (const line of ["6000.3", "6000.6"]) {
    for (const suffix of ["a1", "b1", "p1", "rc1", "F1", "f1c1"]) {
      const version = `${line}.7${suffix}`;
      assert.equal(classifyUnityProjectVersion(version), null, version);
    }
  }
});

test("tokens are not normalized and malformed or padded versions are refused", () => {
  const valid = "6000.6.7f1";
  for (const padding of [" ", "\t", "\r", "\n", "\r\n", "\0", "\v", "\f", "\u00a0", "\u200b", "\u2028", "\ufeff"]) {
    assert.equal(classifyUnityProjectVersion(valid + padding), null, JSON.stringify(valid + padding));
    assert.equal(classifyUnityProjectVersion(padding + valid), null, JSON.stringify(padding + valid));
  }
  for (const version of [
    "", "6000.6.7", "6000.6.7f", "6000.6.f1", "6000.6.7f1-extra",
    "v6000.6.7f1", "6000.6.7f1/", "6000.6.7f1\nextra", "6000.6.7\nf1",
    "6000.6.٧f1", "6000.6.7f١", "6000.6.7f1+suffix",
  ]) assert.equal(classifyUnityProjectVersion(version), null, version);
});

test("format admission is bounded to 64 characters without truncation", () => {
  const boundary = `6000.6.${"9".repeat(55)}f1`;
  assert.equal(boundary.length, 64);
  // Synthetic grammar boundary, not a claim that this Editor exists or was tested.
  assert.equal(classifyUnityProjectVersion(boundary), "experimental");
  assert.equal(classifyUnityProjectVersion(`6000.6.${"9".repeat(56)}f1`), null);
  assert.equal(classifyUnityProjectVersion(boundary + "1"), null);
});

test("non-string inputs are refused without invoking object coercion", () => {
  let coerced = false;
  const hostile = { toString() { coerced = true; throw new Error("Unexpected coercion"); } };
  for (const value of [null, undefined, true, false, 6000.6, 1n, [], {}, Object.create(null),
    new String("6000.6.7f1"), Symbol("6000.6.7f1"), hostile, () => "6000.6.7f1"]) {
    assert.equal(classifyUnityProjectVersion(value), null);
  }
  assert.equal(coerced, false);
});
