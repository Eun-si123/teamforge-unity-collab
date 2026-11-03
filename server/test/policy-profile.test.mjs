import assert from "node:assert/strict";
import test from "node:test";
import { configFromEnv, DEFAULTS, normalizeHttpPath, profileFromEnv } from "../src/config.mjs";
import { LegacyPhase4Compatible, PROFILE_NAME } from "../src/policy-profile.mjs";

test("LegacyPhase4Compatible freezes every Phase 4 server default", () => {
  assert.equal(LegacyPhase4Compatible.name, PROFILE_NAME);
  assert.deepEqual({ ...LegacyPhase4Compatible.connectionPolicy }, DEFAULTS);
  assert(Object.isFrozen(LegacyPhase4Compatible));
  assert(Object.isFrozen(LegacyPhase4Compatible.connectionPolicy));
});

test("environment resolution preserves the legacy config surface and keeps credentials outside policy", () => {
  const env = {
    TEAMFORGE_HOST: " 0.0.0.0 ",
    TEAMFORGE_PORT: "5099",
    TEAMFORGE_WS_PATH: "/custom-ws/",
    TEAMFORGE_LOCK_LEASE_MS: "22000",
    TEAMFORGE_AUTH_TOKEN: "sentinel-secret",
  };
  const profile = profileFromEnv(env);
  const config = configFromEnv(env);

  assert.equal(profile.name, PROFILE_NAME);
  assert.equal(profile.connectionPolicy.host, "0.0.0.0");
  assert.equal(profile.connectionPolicy.port, 5099);
  assert.equal(profile.connectionPolicy.wsPath, "/custom-ws");
  assert.equal(profile.connectionPolicy.lockLeaseMilliseconds, 22_000);
  assert.equal("authToken" in profile.connectionPolicy, false);
  assert.deepEqual(
    { ...config, authToken: undefined },
    { ...profile.connectionPolicy, authToken: undefined },
  );
  assert.equal(config.authToken, "sentinel-secret");
});


test("whitespace-only port configuration fails instead of selecting an ephemeral port", () => {
  assert.throws(
    () => configFromEnv({ TEAMFORGE_PORT: "  \t  " }),
    /TEAMFORGE_PORT must be an integer between 0 and 65535/,
  );
  assert.equal(configFromEnv({ TEAMFORGE_PORT: "0" }).port, 0, "explicit port 0 remains supported");
  assert.equal(configFromEnv({ TEAMFORGE_PORT: " 5099 " }).port, 5099);
});

test("server endpoint configuration rejects paths rewritten by its request router", () => {
  for (const value of [
    "/a/../ws", "/a/./ws", "/a/%2E%2E/ws", "/a/%2e/ws",
    "/a\\\\ws", "/ws with space", "/a/\\tws", "/a/é",
  ]) {
    assert.throws(() => normalizeHttpPath(value, "/ws"),
      /Endpoint paths must not be rewritten by URL parsing/, JSON.stringify(value));
  }
  for (const [value, expected] of [
    ["/ws", "/ws"], ["/ws/", "/ws"], ["health", "/health"],
    ["/a//b", "/a//b"], ["/a/%2F/b", "/a/%2F/b"],
  ]) {
    assert.equal(normalizeHttpPath(value, "/ws"), expected, JSON.stringify(value));
    assert.equal(new URL(expected, "http://teamforge.invalid").pathname, expected);
  }
});
