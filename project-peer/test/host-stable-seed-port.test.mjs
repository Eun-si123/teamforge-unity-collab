import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DEFAULT_LAN_SEED_PORT } from "../src/host-orchestrator.mjs";

test("Host orchestration prefers one remembered Seed port and falls back through OS allocation", async () => {
  assert.equal(DEFAULT_LAN_SEED_PORT, 5091);

  const source = await readFile(new URL("../src/host-orchestrator.mjs", import.meta.url), "utf8");
  assert.match(source, /preferredSeedPort\s*=\s*DEFAULT_LAN_SEED_PORT/u);
  assert.match(source, /startWithPreferredSeedPort/u);
  assert.match(source, /return start\(0\)/u);
  assert.match(source, /seedPort:\s*0/u);
  assert.match(source, /port:\s*this\.seedHandle\.endpoint\.port/u);

  const cliSource = await readFile(new URL("../src/cli.mjs", import.meta.url), "utf8");
  assert.match(cliSource, /typeof error\?\.code === "string"/u);

  const firewallSource = await readFile(
    new URL("../../unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeWindowsFirewall.cs", import.meta.url),
    "utf8",
  );
  assert.match(firewallSource, /DefaultSeedPort\s*=\s*5091/u);
  assert.match(firewallSource, /Remove-NetFirewallRule/u);
});
