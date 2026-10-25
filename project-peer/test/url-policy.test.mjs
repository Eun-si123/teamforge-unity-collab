import assert from "node:assert/strict";
import test from "node:test";
import { websocketUrl } from "../src/url-policy.mjs";

test("server addresses reject URL-parser-stripped ASCII controls before connecting", () => {
  for (const serverAddress of [
    "\nhttps://example.test:5080", "https://example.test:5080\r",
    "https://example.test\n:5080", "https://example.test\t:5080",
  ]) {
    assert.throws(
      () => websocketUrl(serverAddress, "ws"),
      { code: "invalid_server_address" },
      JSON.stringify(serverAddress),
    );
  }
});

test("server addresses reject empty query and fragment delimiters", () => {
  for (const serverAddress of [
    "https://example.test/base?", "https://example.test/base#",
    "https://example.test/base?#", "https://example.test/?",
    "https://example.test/#",
  ]) {
    assert.throws(() => websocketUrl(serverAddress, "ws"),
      { code: "invalid_server_address" }, JSON.stringify(serverAddress));
  }
  assert.equal(websocketUrl("https://example.test/base", "ws").href,
    "wss://example.test/base/ws");
});

test("server addresses reject WHATWG authority separator repair", () => {
  for (const serverAddress of [
    "http:example.test:5080/base",
    "http:/example.test:5080/base",
    "http:////example.test:5080/base",
    "http:\\\\example.test:5080/base",
    "http://example.test\\base",
  ]) {
    assert.throws(() => websocketUrl(serverAddress, "ws"),
      { code: "invalid_server_address" }, JSON.stringify(serverAddress));
  }
  assert.equal(websocketUrl("HTTP://example.test:5080/base", "ws").href,
    "ws://example.test:5080/base/ws");
  assert.equal(websocketUrl("ws://[::1]:5080", "ws").href, "ws://[::1]:5080/ws");
});

test("server base paths reject interior repeated separators that Unity preserves", () => {
  for (const serverAddress of [
    "https://example.test/a//b",
    "https://example.test/a///b",
    "https://example.test/a//b/",
  ]) {
    assert.throws(() => websocketUrl(serverAddress, "ws"),
      { code: "invalid_server_address" }, serverAddress);
  }
  // Preserve existing forms that already produce the same route in both runtimes.
  assert.equal(websocketUrl("https://example.test//base", "ws").pathname, "/base/ws");
  assert.equal(websocketUrl("https://example.test/a//", "ws").pathname, "/a/ws");
  assert.equal(websocketUrl("https://example.test/a/%2F/b", "ws").pathname,
    "/a/%2F/b/ws");
});

test("realtime paths preserve intended canonical endpoint segments", () => {
  assert.equal(websocketUrl("http://localhost:5080", "ws").href, "ws://localhost:5080/ws");
  assert.equal(websocketUrl(new URL("https://example.test/base"), "ws").href,
    "wss://example.test/base/ws");
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


test("realtime paths reject percent escapes that Unity canonicalizes differently", () => {
  for (const realtimePath of [
    "rooms/%41", "rooms/%7E", "rooms/%2D", "rooms/%2e%2f",
    "rooms/%", "rooms/%G0", "rooms/%2", "rooms/%e2%98%83",
  ]) {
    assert.throws(
      () => websocketUrl("https://example.test/base", realtimePath),
      { code: "invalid_realtime_path" },
      `Expected rejection of ${JSON.stringify(realtimePath)}`,
    );
  }
  assert.equal(websocketUrl("https://example.test/base", "rooms/live%20one").pathname,
    "/base/rooms/live%20one");
  assert.equal(websocketUrl("https://example.test/base", "rooms/%C3%A9").pathname,
    "/base/rooms/%C3%A9");
});


test("server base paths reject percent escapes that Unity canonicalizes differently", () => {
  for (const serverAddress of [
    "https://example.test/base/%41", "https://example.test/base/%7e",
    "https://example.test/base/%2E/ws",
    "https://example.test/base/%", "https://example.test/base/%e2%98%83",
  ]) {
    assert.throws(() => websocketUrl(serverAddress, "ws"),
      { code: "invalid_server_address" }, serverAddress);
  }
  assert.equal(websocketUrl("https://example.test/base/live%20one", "ws").pathname,
    "/base/live%20one/ws");
  assert.equal(websocketUrl("https://example.test/base/%C3%A9", "ws").pathname,
    "/base/%C3%A9/ws");
});
