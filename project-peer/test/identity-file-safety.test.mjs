import assert from "node:assert/strict";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { generateIdentity, loadIdentity, saveIdentity } from "../src/identity.mjs";
import { cleanup, temporaryRoot } from "./helpers.mjs";

test("Owner identity loader rejects oversized otherwise valid JSON before parsing", async () => {
  const root = await temporaryRoot();
  try {
    const destination = path.join(root, "owner.json");
    const identity = generateIdentity("Owner");
    await writeFile(destination, `${JSON.stringify(identity)}${" ".repeat(70_000)}`, "utf8");
    await assert.rejects(() => loadIdentity(destination), { code: "identity_load_failed" });
  } finally {
    await cleanup(root);
  }
});

test("Owner identity loader refuses a symbolic link even when target is valid", async (t) => {
  const root = await temporaryRoot();
  try {
    const real = path.join(root, "real-owner.json");
    const linked = path.join(root, "linked-owner.json");
    await saveIdentity(real, generateIdentity("Owner"));
    try {
      await symlink(real, linked, "file");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS"].includes(error?.code)) {
        t.skip("symlink creation unavailable");
        return;
      }
      throw error;
    }
    await assert.rejects(() => loadIdentity(linked), { code: "identity_load_failed" });
  } finally {
    await cleanup(root);
  }
});

test("Owner identity loader does not expose local file paths in read errors", async () => {
  const root = await temporaryRoot();
  try {
    const missing = path.join(root, "private-owner-key-that-must-not-leak.json");
    await assert.rejects(() => loadIdentity(missing), (error) => {
      assert.equal(error?.code, "identity_load_failed");
      assert.equal(error.message.includes(root), false);
      assert.equal(error.message.includes("private-owner-key-that-must-not-leak"), false);
      return true;
    });
    const directory = path.join(root, "identity-is-directory");
    await mkdir(directory);
    await assert.rejects(() => loadIdentity(directory), { code: "identity_load_failed" });
  } finally {
    await cleanup(root);
  }
});
