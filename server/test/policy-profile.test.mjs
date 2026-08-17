import assert from "node:assert/strict";
import test from "node:test";
import { configFromEnv, DEFAULTS, profileFromEnv } from "../src/config.mjs";
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
