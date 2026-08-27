import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DEFAULT_LAN_SEED_PORT } from "../src/host-orchestrator.mjs";

test("Host orchestration uses one stable narrow LAN Seed port", async () => {
  assert.equal(DEFAULT_LAN_SEED_PORT, 5091);

  const source = await readFile(new URL("../src/host-orchestrator.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /"--port",\s*"0"/u);
  assert.match(source, /seedPort:\s*DEFAULT_LAN_SEED_PORT/u);
  assert.match(source, /"--port",\s*String\(DEFAULT_LAN_SEED_PORT\)/u);
  assert.match(source, /port:\s*DEFAULT_LAN_SEED_PORT/u);
});
