import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { loadIdentity } from "../src/identity.mjs";
import { loadLaunchSettings } from "../src/launch-settings.mjs";
import { cleanup, temporaryRoot } from "./helpers.mjs";

const syntheticCanary = "S3CRET42_SYNTHETIC_NOT_A_REAL_SECRET";
for (const [filename, loader, code] of [
  ["owner.json", loadIdentity, "identity_load_failed"],
  ["launch.json", loadLaunchSettings, "launch_settings_load_failed"],
]) {
  test(`${filename} malformed JSON cannot echo private input in error message`, async () => {
    const root = await temporaryRoot();
    try {
      const filePath = path.join(root, filename);
      await writeFile(filePath, `{"secret":${syntheticCanary}}`);
      await assert.rejects(loader(filePath), (error) => {
        assert.equal(error?.code, code);
        assert.equal(error.message.includes(syntheticCanary.slice(0, 8)), false);
        assert.match(error.message, /invalid JSON/u);
        return true;
      });
    } finally {
      await cleanup(root);
    }
  });
}
