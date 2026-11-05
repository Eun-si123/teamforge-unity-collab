import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { appendFile, mkdir, open, readFile, rename, symlink, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import test from "node:test";
import {
  GUEST_MANAGED_ROOT_MARKER,
  inspectGuestDestination,
  prepareGuestDestination,
} from "../src/guest-destination.mjs";
import { PROJECT_IDENTITY_LOCK_NAME } from "../src/project-identity-lock.mjs";
import { cleanup, temporaryRoot } from "./helpers.mjs";

async function createFixture(root, kind) {
  const destination = path.join(root, "projects");
  await prepareGuestDestination({ destinationRoot: destination });
  if (kind === "marker") {
    return { destination, target: path.join(destination, GUEST_MANAGED_ROOT_MARKER) };
  }
  if (kind === "fence") {
    const target = path.join(destination, PROJECT_IDENTITY_LOCK_NAME);
    await writeFile(target, JSON.stringify({
      schemaVersion: 2,
      kind: "teamforge-project-identity-lock-fence",
      mechanism: "windows-named-pipe",
    }));
    return { destination, target };
  }
  const projectUuid = randomUUID().toLowerCase();
  const metadataRoot = path.join(destination, projectUuid, "metadata");
  await mkdir(metadataRoot, { recursive: true });
  const target = path.join(metadataRoot, "project.json");
  await writeFile(target, JSON.stringify({
    schemaVersion: 1,
    productVersion: "0.5.1",
    projectId: "race-test-project",
    projectUuid,
    createdAtUnixMs: Date.now(),
  }));
  return { destination, target };
}

test("Guest destination refuses files replaced with symlinks after lstat", async (t) => {
  if (process.platform === "win32") return t.skip("POSIX symlink replacement fixture");
  for (const [kind, code] of [
    ["marker", "invalid_guest_destination_marker"],
    ["fence", "destination_contains_unmanaged_content"],
    ["metadata", "destination_contains_unmanaged_content"],
  ]) {
    await t.test(kind, async (subtest) => {
      const root = await temporaryRoot();
      try {
        const { destination, target } = await createFixture(root, kind);
        const alternate = path.join(root, `alternate-${kind}.json`);
        await writeFile(alternate, await readFile(target));
        const originalLstat = fs.promises.lstat;
        let swapped = false;
        subtest.mock.method(fs.promises, "lstat", async (candidate, ...args) => {
          const information = await originalLstat(candidate, ...args);
          if (!swapped && candidate === target) {
            swapped = true;
            await rename(target, path.join(root, `old-${kind}.json`));
            await symlink(alternate, target);
          }
          return information;
        });
        syncBuiltinESMExports();
        await assert.rejects(
          () => inspectGuestDestination({ destinationRoot: destination }),
          { code },
        );
        assert.equal(swapped, true, "the post-lstat replacement must be exercised");
      } finally {
        subtest.mock.restoreAll();
        syncBuiltinESMExports();
        await cleanup(root);
      }
    });
  }
});


test("Guest marker refuses growth after its opened-file size check", async (t) => {
  const root = await temporaryRoot();
  try {
    const { destination, target } = await createFixture(root, "marker");
    const probe = await open(path.join(root, "file-handle-probe"), "wx");
    const prototype = Object.getPrototypeOf(probe);
    await probe.close();
    const originalStat = prototype.stat;
    let grew = false;
    t.mock.method(prototype, "stat", async function (...args) {
      const information = await originalStat.call(this, ...args);
      if (!grew) {
        grew = true;
        await appendFile(target, Buffer.alloc(70_000, 0x20));
      }
      return information;
    });
    await assert.rejects(
      () => inspectGuestDestination({ destinationRoot: destination }),
      { code: "invalid_guest_destination_marker" },
    );
    assert.equal(grew, true, "the opened-file growth boundary must be exercised");
  } finally {
    t.mock.restoreAll();
    await cleanup(root);
  }
});


test("Guest marker metadata checks request exact BigInt file identities", async (t) => {
  const root = await temporaryRoot();
  try {
    const { destination, target } = await createFixture(root, "marker");
    const originalLstat = fs.promises.lstat;
    const seenLstat = [];
    t.mock.method(fs.promises, "lstat", async (candidate, options) => {
      if (candidate === target) seenLstat.push(options?.bigint === true);
      return originalLstat(candidate, options);
    });
    syncBuiltinESMExports();
    const probe = await open(path.join(root, "file-handle-probe"), "wx");
    const prototype = Object.getPrototypeOf(probe);
    await probe.close();
    const originalStat = prototype.stat;
    const seenHandleStat = [];
    t.mock.method(prototype, "stat", async function (options) {
      const info = await originalStat.call(this, options);
      if (info.isFile() && info.size > 0) seenHandleStat.push(options?.bigint === true);
      return info;
    });
    const inspected = await inspectGuestDestination({ destinationRoot: destination });
    assert.equal(inspected.destination, destination);
    assert.deepEqual(seenLstat, [true, true]);
    assert.deepEqual(seenHandleStat, [true, true]);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    await cleanup(root);
  }
});
