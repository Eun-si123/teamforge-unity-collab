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

test("Owner identity saver refuses to save an identity too large to reload", async () => {
  const root = await temporaryRoot();
  try {
    const destination = path.join(root, "owner.json");
    const { readdir } = await import("node:fs/promises");
    for (const note of ["x".repeat(70_000), "가".repeat(24_000)]) {
      const identity = { ...generateIdentity("Owner"), note };
      await assert.rejects(() => saveIdentity(destination, identity), { code: "invalid_identity" });
      await assert.rejects(() => loadIdentity(destination), { code: "identity_load_failed" });
      assert.deepEqual(await readdir(root), [], "rejected save must leave no unreadable identity or temporary file");
    }
  } finally {
    await cleanup(root);
  }
});

test("Owner identity saver cleans partial temporary key material after a write failure", async () => {
  const { spawnSync } = await import("node:child_process");
  const source = `
    import fs from "node:fs";
    import { syncBuiltinESMExports } from "node:module";
    import { mkdtemp, readdir, rm } from "node:fs/promises";
    import { tmpdir } from "node:os";
    import path from "node:path";
    import { generateIdentity, saveIdentity } from ${JSON.stringify(new URL("../src/identity.mjs", import.meta.url).href)};
    const root = await mkdtemp(path.join(tmpdir(), "tf-owner-partial-write-"));
    const originalWriteFile = fs.promises.writeFile;
    try {
      fs.promises.writeFile = async (filePath, data, options) => {
        await originalWriteFile(filePath, "partial key data", options);
        const error = new Error("simulated write failure");
        error.code = "EIO";
        throw error;
      };
      syncBuiltinESMExports();
      let failedAsExpected = false;
      try {
        await saveIdentity(path.join(root, "owner.json"), generateIdentity("Owner"));
      } catch (error) {
        failedAsExpected = error.code === "EIO";
      }
      if (!failedAsExpected) process.exitCode = 2;
      else if ((await readdir(root)).length !== 0) process.exitCode = 3;
    } finally {
      fs.promises.writeFile = originalWriteFile;
      syncBuiltinESMExports();
      await rm(root, { recursive: true, force: true });
    }
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    encoding: "utf8", timeout: 8_000,
  });
  assert.equal(child.status, 0,
    `Failed key writes must leave no temporary file (exit=${child.status}, signal=${child.signal}, error=${child.error?.code ?? "none"}): ${child.stderr}`);
});

test("Owner identity saver preserves a loadable compact identity near the byte budget", async () => {
  const root = await temporaryRoot();
  try {
    const source = path.join(root, "compact-source.json");
    const backup = path.join(root, "backup.json");
    const identity = { ...generateIdentity("Owner"), note: "" };
    const baseBytes = Buffer.byteLength(`${JSON.stringify(identity)}\n`, "utf8");
    const noteLength = 65_536 - baseBytes - 1;
    assert.ok(noteLength > 0);
    identity.note = "x".repeat(noteLength);
    const compact = `${JSON.stringify(identity)}\n`;
    const pretty = `${JSON.stringify(identity, null, 2)}\n`;
    assert.ok(Buffer.byteLength(compact, "utf8") <= 65_536);
    assert.ok(Buffer.byteLength(pretty, "utf8") > 65_536);
    await writeFile(source, compact, "utf8");
    const loaded = await loadIdentity(source);
    await saveIdentity(backup, loaded);
    assert.deepEqual(await loadIdentity(backup), identity);
    const { readFile } = await import("node:fs/promises");
    assert.equal(await readFile(backup, "utf8"), compact);
  } finally {
    await cleanup(root);
  }
});

test("Owner identity saver round-trips a compact identity at exactly 65,536 bytes", async () => {
  const root = await temporaryRoot();
  try {
    const source = path.join(root, "compact-limit-source.json");
    const backup = path.join(root, "compact-limit-backup.json");
    const identity = { ...generateIdentity("Owner"), note: "" };
    const remaining = 65_536 - Buffer.byteLength(JSON.stringify(identity), "utf8");
    assert.ok(remaining > 0);
    identity.note = "x".repeat(remaining);
    const compact = JSON.stringify(identity);
    assert.equal(Buffer.byteLength(compact, "utf8"), 65_536);
    await writeFile(source, compact, "utf8");
    await saveIdentity(backup, await loadIdentity(source));
    const { readFile } = await import("node:fs/promises");
    assert.equal(await readFile(backup, "utf8"), compact,
      "exact-limit compact identity must be saved without a trailing newline");
    assert.deepEqual(await loadIdentity(backup), identity);
    const oversized = { ...identity, note: `${identity.note}x` };
    assert.equal(Buffer.byteLength(JSON.stringify(oversized), "utf8"), 65_537);
    await assert.rejects(() => saveIdentity(path.join(root, "oversized.json"), oversized),
      { code: "invalid_identity" });
  } finally {
    await cleanup(root);
  }
});

test("Owner identity saver does not disclose private key path on existing destination", async () => {
  const root = await temporaryRoot();
  try {
    const destination = path.join(root, "private-owner-key-that-must-not-leak.json");
    await saveIdentity(destination, generateIdentity("Owner"));
    await assert.rejects(() => saveIdentity(destination, generateIdentity("Other Owner")), (error) => {
      assert.equal(error?.code, "identity_exists");
      assert.equal(error.message.includes(root), false);
      assert.equal(error.message.includes("private-owner-key-that-must-not-leak"), false);
      return true;
    });
    assert.equal((await loadIdentity(destination)).label, "Owner", "existing key must remain unchanged");
  } finally {
    await cleanup(root);
  }
});


test("Owner identity backup preserves a valid compact JSON number representation", async () => {
  const root = await temporaryRoot();
  try {
    const source = path.join(root, "compact-number-source.json");
    const backup = path.join(root, "compact-number-backup.json");
    const identity = generateIdentity("Owner");
    const serialized = JSON.stringify(identity).slice(0, -1) +
      ',"metadata":[' + Array(4200).fill("1e20").join(",") + "]}";
    assert.ok(Buffer.byteLength(serialized, "utf8") < 65_536);
    assert.ok(Buffer.byteLength(JSON.stringify(JSON.parse(serialized)), "utf8") > 65_536);
    await writeFile(source, serialized, "utf8");
    const loaded = await loadIdentity(source);
    await saveIdentity(backup, loaded);
    const { readFile } = await import("node:fs/promises");
    assert.equal(await readFile(backup, "utf8"), serialized);
    assert.deepEqual(await loadIdentity(backup), loaded);
  } finally {
    await cleanup(root);
  }
});

test("Owner identity backup serializes modified loaded identities instead of stale source bytes", async () => {
  const root = await temporaryRoot();
  try {
    const source = path.join(root, "source.json");
    const backup = path.join(root, "modified-backup.json");
    const identity = generateIdentity("Owner");
    await writeFile(source, JSON.stringify(identity), "utf8");
    const loaded = await loadIdentity(source);
    loaded.label = "Renamed Owner";
    await saveIdentity(backup, loaded);
    assert.equal((await loadIdentity(backup)).label, "Renamed Owner");
  } finally {
    await cleanup(root);
  }
});
