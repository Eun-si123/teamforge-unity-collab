import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
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
