import assert from "node:assert/strict";
import test from "node:test";
import { integerOption } from "../src/cli-numeric.mjs";

test("integer CLI options reject blank and valueless inputs", () => {
  for (const name of ["port", "retry-rounds"]) {
    for (const value of ["", " ", "\t", "\r\n", true]) {
      assert.throws(
        () => integerOption({ [name]: value }, name, 3, 0, 65_535),
        { code: "invalid_cli_option" },
        `${name}=${JSON.stringify(value)}`,
      );
    }
  }
});

test("integer CLI options retain fallback, explicit zero, bounded integers and error handling", () => {
  assert.equal(integerOption({}, "port", 5091, 0, 65_535), 5091);
  assert.equal(integerOption({ port: "0" }, "port", 5091, 0, 65_535), 0);
  assert.equal(integerOption({ port: " 5091 " }, "port", 0, 0, 65_535), 5091);
  assert.equal(integerOption({ concurrency: "4" }, "concurrency", 1, 1, 64), 4);
  for (const value of ["-1", "65536", "1.5", "Infinity", "not-a-number"]) {
    assert.throws(() => integerOption({ port: value }, "port", 5091, 0, 65_535), { code: "invalid_cli_option" });
  }
});
