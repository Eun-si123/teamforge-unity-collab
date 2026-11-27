import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile, lstat, symlink, rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ManagedProjectStore } from "../src/managed-project.mjs";
import { withProcessBoundLock } from "../src/process-bound-lock.mjs";
import { cleanup, publicationFixture, temporaryRoot } from "./helpers.mjs";

const lockModule = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src",
  "process-bound-lock.mjs")).href;
const options = { busyCode: "test_busy", busyMessage: "busy" };
const crashReleased = process.platform === "linux" || process.platform === "win32";

// Start a real child that takes the lock, reports it, and then waits forever.
async function childHoldingLock(lockPath) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    const { withProcessBoundLock } = await import(${JSON.stringify(lockModule)});
    await withProcessBoundLock(${JSON.stringify(lockPath)}, async () => {
      process.stdout.write("locked\\n");
      await new Promise(() => setInterval(() => {}, 1000));
    }, { busyCode: "child_busy", busyMessage: "busy" });
  `], { stdio: ["ignore", "pipe", "inherit"] });
  let output = "";
  for await (const chunk of child.stdout) {
    output += chunk;
    if (output.includes("locked")) break;
  }
  return child;
}

test("a live owner, a legacy empty file and an unrecognized file all stay busy", async () => {
  const root = await temporaryRoot("teamforge-bound-lock-");
  try {
    const lockPath = path.join(root, "work.lock");
    await withProcessBoundLock(lockPath, async () => {
      await assert.rejects(withProcessBoundLock(lockPath, async () => {}, options), (error) => error.code === "test_busy");
    }, options);
    for (const content of ["", "{\"kind\":\"something-else\"}\n"]) {
      await writeFile(lockPath, content);
      await assert.rejects(withProcessBoundLock(lockPath, async () => {}, options), (error) => error.code === "test_busy");
      assert.equal(await readFile(lockPath, "utf8"), content, "an ambiguous lock is never removed");
    }
  } finally {
    await cleanup(root);
  }
});

test("a live child owner blocks, and its lock is recoverable once the child is killed (#648, #660)",
  { skip: !crashReleased && "no crash-released OS mutex on this platform" }, async () => {
    const root = await temporaryRoot("teamforge-bound-lock-kill-");
    try {
      const lockPath = path.join(root, "work.lock");
      const child = await childHoldingLock(lockPath);
      await assert.rejects(withProcessBoundLock(lockPath, async () => {}, options), (error) => error.code === "test_busy");
      child.kill("SIGKILL");
      await once(child, "exit");
      assert.match(await readFile(lockPath, "utf8"), /teamforge-process-bound-lock/u, "the killed owner left its lock file");
      assert.equal(await withProcessBoundLock(lockPath, async () => "reacquired", options), "reacquired");
      await assert.rejects(readFile(lockPath), (error) => error.code === "ENOENT");
    } finally {
      await cleanup(root);
    }
  });

test("a Guest activation can be retried after the activating process was killed holding the lock (#648)",
  { skip: !crashReleased && "no crash-released OS mutex on this platform" }, async () => {
    const root = await temporaryRoot("teamforge-bound-lock-activation-");
    try {
      const fixture = await publicationFixture(root);
      const managed = new ManagedProjectStore({
        managedRoot: path.join(root, "managed"), projectUuid: fixture.projectUuid, chunkStore: fixture.store,
      });
      await managed.initialize();
      const child = await childHoldingLock(managed.activationLockPath);
      await assert.rejects(managed.activate({ ...fixture, trustApproval: async () => true }),
        (error) => error.code === "activation_busy");
      child.kill("SIGKILL");
      await once(child, "exit");
      const activated = await managed.activate({ ...fixture, trustApproval: async () => true });
      assert.equal(activated.state, "Complete");
      assert.equal(activated.baselineRevision, 1);
    } finally {
      await cleanup(root);
    }
  });


test("a failed OS mutex bind must not enter the protected callback or create a reclaimable record",
  { skip: !crashReleased && "no crash-released OS mutex on this platform" }, async () => {
    const root = await temporaryRoot("teamforge-bound-lock-bind-error-");
    const lockPath = path.join(root, "work.lock");
    const listen = net.Server.prototype.listen;
    let entered = false;
    try {
      // Simulate a non-contention bind failure. Previously the fallback
      // still emitted the same record that permits another owner to reclaim.
      net.Server.prototype.listen = function () {
        const error = Object.assign(new Error("injected mutex bind failure"), { code: "EACCES" });
        queueMicrotask(() => this.emit("error", error));
        return this;
      };
      try {
        await assert.rejects(withProcessBoundLock(lockPath, async () => {
          entered = true;
        }, options), { code: "test_busy" });
      } finally {
        net.Server.prototype.listen = listen;
      }
      assert.equal(entered, false);
      await assert.rejects(lstat(lockPath), { code: "ENOENT" });
      assert.equal(await withProcessBoundLock(lockPath, async () => {
        const record = JSON.parse(await readFile(lockPath, "utf8"));
        assert.equal(record.schemaVersion, 2);
        assert.equal(record.kind, "teamforge-process-bound-lock");
        return "recovered";
      }, options), "recovered");
    } finally {
      net.Server.prototype.listen = listen;
      await cleanup(root);
    }
  });

test("legacy fallback-compatible and file-only records cannot authorize automatic lock removal",
  { skip: !crashReleased && "no crash-released OS mutex on this platform" }, async () => {
    const root = await temporaryRoot("teamforge-bound-lock-ambiguous-");
    try {
      const lockPath = path.join(root, "work.lock");
      for (const record of [
        { schemaVersion: 1, kind: "teamforge-process-bound-lock", pid: process.pid, acquiredAtUnixMs: Date.now() },
        { schemaVersion: 2, kind: "teamforge-file-only-lock", pid: process.pid, acquiredAtUnixMs: Date.now() },
        { schemaVersion: 2, kind: "teamforge-process-bound-lock", pid: 0, acquiredAtUnixMs: Date.now() },
        { schemaVersion: 2, kind: "teamforge-process-bound-lock", pid: process.pid, acquiredAtUnixMs: 0 },
      ]) {
        const bytes = JSON.stringify(record);
        await writeFile(lockPath, bytes);
        await assert.rejects(withProcessBoundLock(lockPath, async () => {
          assert.fail("ambiguous owner must not be replaced");
        }, options), { code: "test_busy" });
        assert.equal(await readFile(lockPath, "utf8"), bytes);
      }
    } finally { await cleanup(root); }
  });

test("oversized and redirected lock records stay untouched",
  { skip: !crashReleased && "no crash-released OS mutex on this platform" }, async () => {
    const root = await temporaryRoot("teamforge-bound-lock-unsafe-");
    try {
      const lockPath = path.join(root, "work.lock");
      const large = "x".repeat(4097);
      await writeFile(lockPath, large);
      await assert.rejects(withProcessBoundLock(lockPath, async () => {
        assert.fail("oversized lock must not be replaced");
      }, options), { code: "test_busy" });
      assert.equal(await readFile(lockPath, "utf8"), large);
      // Creating symbolic links can require privileges on Windows.
      if (process.platform === "win32") return;
      await rm(lockPath);
      const target = path.join(root, "other.json");
      const record = JSON.stringify({ schemaVersion: 2, kind: "teamforge-process-bound-lock",
        pid: process.pid, acquiredAtUnixMs: Date.now() });
      await writeFile(target, record);
      await symlink(target, lockPath);
      await assert.rejects(withProcessBoundLock(lockPath, async () => {
        assert.fail("redirected lock must not be replaced");
      }, options), { code: "test_busy" });
      assert.equal((await lstat(lockPath)).isSymbolicLink(), true);
      assert.equal(await readFile(target, "utf8"), record);
    } finally { await cleanup(root); }
  });
