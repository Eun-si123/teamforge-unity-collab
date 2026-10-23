import assert from "node:assert/strict";
import test from "node:test";
import { websocketUrl } from "../src/url-policy.mjs";

test("realtime paths preserve intended canonical endpoint segments", () => {
  assert.equal(websocketUrl("http://localhost:5080", "ws").href, "ws://localhost:5080/ws");
  assert.equal(websocketUrl("https://example.test/base", "rooms/live%20one").href,
    "wss://example.test/base/rooms/live%20one");
  // Interior spaces are a legitimate segment; only outer whitespace is ambiguous.
  assert.equal(websocketUrl("https://example.test/base", "rooms/live one").href,
    "wss://example.test/base/rooms/live%20one");
});

test("realtime paths reject dot-segment aliases and separator normalization before connecting", () => {
  for (const realtimePath of [
    "rooms/./ws", "rooms/%2e/ws", "rooms/%2E%2e/ws", "rooms/.%2e/ws",
    "rooms\\ws", "rooms//ws", "\\ws",
    "w\ts", "ws\n", "rooms/\rws", "ws\u0000", "ws\u007f",
    " ", " ws", "ws ", " ws ", "\u00a0ws", "ws\u00a0",
  ]) {
    assert.throws(
      () => websocketUrl("http://localhost:5080", realtimePath),
      (error) => error?.code === "invalid_realtime_path",
      `Expected early rejection of ${JSON.stringify(realtimePath)}`,
    );
  }
});
