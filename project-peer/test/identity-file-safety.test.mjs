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

test("Owner identity loader rejects a FIFO swapped after lstat without hanging", async (t) => {
  if (process.platform !== "linux") {
    t.skip("Linux FIFO swap only; Windows reparse semantics require separate testing.");
    return;
  }
  const { execFileSync, spawnSync } = await import("node:child_process");
  const { randomUUID } = await import("node:crypto");
  const root = await temporaryRoot();
  try {
    execFileSync("mkfifo", [path.join(root, "replacement.fifo")]);
    const source = `
      import fs from "node:fs";
      import path from "node:path";
      import { syncBuiltinESMExports } from "node:module";
      import { rename } from "node:fs/promises";
      import { generateIdentity, loadIdentity, saveIdentity } from ${JSON.stringify(new URL("../src/identity.mjs", import.meta.url).href)};
      const root = process.argv[1];
      const destination = path.join(root, "owner.json");
      await saveIdentity(destination, generateIdentity("Owner"));
      const originalLstat = fs.promises.lstat;
      let swapped = false;
      fs.promises.lstat = async (...args) => {
        const result = await originalLstat(...args);
        if (!swapped && args[0] === destination) {
          swapped = true;
          await rename(destination, destination + ".saved");
          await rename(path.join(root, "replacement.fifo"), destination);
        }
        return result;
      };
      syncBuiltinESMExports();
      try {
        await loadIdentity(destination);
        process.exitCode = 2;
      } catch (error) {
        if (!swapped || error.code !== "identity_load_failed" || error.message.includes(root)) process.exitCode = 3;
      }
    `;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", source, root], {
      encoding: "utf8", timeout: 3_000,
    });
    assert.equal(child.status, 0,
      `FIFO swap must reject promptly (signal=${child.signal}, error=${child.error?.code ?? "none"}): ${child.stderr}`);
  } finally {
    await cleanup(root);
  }
});

test("Owner identity loader distinguishes large inode values without Number rounding", async () => {
  const { spawnSync } = await import("node:child_process");
  const source = `
    import fs from "node:fs";
    import { syncBuiltinESMExports } from "node:module";
    import { mkdtemp, open, rm } from "node:fs/promises";
    import { tmpdir } from "node:os";
    import path from "node:path";
    import { generateIdentity, loadIdentity, saveIdentity } from ${JSON.stringify(new URL("../src/identity.mjs", import.meta.url).href)};
    const root = await mkdtemp(path.join(tmpdir(), "tf-owner-inode-"));
    const destination = path.join(root, "owner.json");
    const originalLstat = fs.promises.lstat;
    let prototype, originalStat;
    try {
      await saveIdentity(destination, generateIdentity("Owner"));
      const probe = await open(destination, "r");
      prototype = Object.getPrototypeOf(probe);
      originalStat = prototype.stat;
      await probe.close();
      const first = 9007199254740992n;
      const second = first + 1n;
      if (Number(first) !== Number(second)) process.exit(4);
      let sawBigint = false;
      fs.promises.lstat = async (target, options) => {
        const result = await originalLstat(target, options);
        if (target === destination) {
          if (options?.bigint) sawBigint = true;
          result.ino = options?.bigint ? first : Number(first);
        }
        return result;
      };
      prototype.stat = async function(options) {
        const result = await originalStat.call(this, options);
        result.ino = options?.bigint ? second : Number(second);
        return result;
      };
      syncBuiltinESMExports();
      try {
        await loadIdentity(destination);
        process.exitCode = 2;
      } catch (error) {
        if (error.code !== "identity_load_failed" || !sawBigint) process.exitCode = 3;
      }
    } finally {
      fs.promises.lstat = originalLstat;
      if (prototype && originalStat) prototype.stat = originalStat;
      syncBuiltinESMExports();
      await rm(root, { recursive: true, force: true });
    }
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    encoding: "utf8", timeout: 8_000,
  });
  assert.equal(child.status, 0,
    `Large inode swap must reject (signal=${child.signal}, error=${child.error?.code ?? "none"}): ${child.stderr}`);
});
