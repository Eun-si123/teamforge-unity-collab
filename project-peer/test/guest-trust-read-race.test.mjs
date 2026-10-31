import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { open, readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import { readGuestTrustPin, writeGuestTrustPin } from "../src/guest-trust.mjs";
import { cleanup, temporaryRoot } from "./helpers.mjs";

test("Guest trust rejects a shorter valid pin substituted after opening the file", async () => {
  const root = await temporaryRoot();
  let prototype;
  let originalRead;
  try {
    const projectUuid = randomUUID().toLowerCase();
    const { pin, destination } = await writeGuestTrustPin(root, {
      projectUuid,
      ownerKeyId: "a".repeat(64),
      publisherKeyId: "b".repeat(64),
    });
    const original = await readFile(destination, "utf8");
    const shorter = JSON.stringify(pin);
    assert.ok(Buffer.byteLength(shorter) < Buffer.byteLength(original));

    const probe = await open(destination, "r");
    prototype = Object.getPrototypeOf(probe);
    originalRead = prototype.read;
    await probe.close();
    let swapped = false;
    prototype.read = async function (...args) {
      if (!swapped) {
        swapped = true;
        // Same inode, shorter but still a valid saved Guest trust record.
        await writeFile(destination, shorter, "utf8");
      }
      return originalRead.apply(this, args);
    };

    const result = await readGuestTrustPin(root, projectUuid);
    assert.equal(swapped, true);
    assert.equal(result.state, "invalid");
    prototype.read = originalRead;
    originalRead = null;

    await writeFile(destination, original, "utf8");
    assert.equal((await readGuestTrustPin(root, projectUuid)).state, "valid");
  } finally {
    if (prototype && originalRead) prototype.read = originalRead;
    await cleanup(root);
  }
});

test("Guest trust rejects a FIFO swapped after lstat without blocking open", async (context) => {
  if (process.platform !== "linux") {
    context.skip("Linux FIFO/open behavior only; Windows reparse semantics require separate evidence.");
    return;
  }
  const childSource = `
    import fs from "node:fs";
    import path from "node:path";
    import { syncBuiltinESMExports } from "node:module";
    import { rename } from "node:fs/promises";
    import { readGuestTrustPin, writeGuestTrustPin } from ${JSON.stringify(new URL("../src/guest-trust.mjs", import.meta.url).href)};
    const [root, uuid] = process.argv.slice(1);
    const destination = path.join(root, "trust", uuid + ".json");
    await writeGuestTrustPin(root, { projectUuid: uuid, ownerKeyId: "a".repeat(64), publisherKeyId: "b".repeat(64) });
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
    const result = await readGuestTrustPin(root, uuid);
    if (!swapped || result.state !== "invalid") process.exitCode = 2;
  `;
  const root = await temporaryRoot();
  try {
    execFileSync("mkfifo", [path.join(root, "replacement.fifo")]);
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", childSource,
      root, randomUUID().toLowerCase()], { encoding: "utf8", timeout: 5_000 });
    assert.equal(child.status, 0,
      `FIFO-swap reader must return invalid promptly (signal=${child.signal}, error=${child.error?.code ?? "none"}): ${child.stderr}`);
  } finally {
    await cleanup(root);
  }
});


test("Guest trust cleans its temporary file when an interrupted write fails", () => {
  // Use a child process so the fs builtin injection cannot affect other tests.
  const childSource = `
    import assert from "node:assert/strict";
    import fs from "node:fs";
    import { randomUUID } from "node:crypto";
    import { syncBuiltinESMExports } from "node:module";
    import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
    import { tmpdir } from "node:os";
    import path from "node:path";
    import { readGuestTrustPin, writeGuestTrustPin } from ${JSON.stringify(new URL("../src/guest-trust.mjs", import.meta.url).href)};
    const root = await mkdtemp(path.join(tmpdir(), "tf-trust-write-failure-"));
    const projectUuid = randomUUID().toLowerCase();
    const ownerKeyId = "a".repeat(64);
    const originalWriteFile = fs.promises.writeFile;
    try {
      const { destination } = await writeGuestTrustPin(root, {
        projectUuid, ownerKeyId, publisherKeyId: "b".repeat(64),
      });
      const original = await readFile(destination, "utf8");
      let injected = false;
      fs.promises.writeFile = async (...args) => {
        if (String(args[0]).endsWith(".tmp")) {
          injected = true;
          await originalWriteFile(...args);
          throw Object.assign(new Error("synthetic interrupted write"), { code: "EIO" });
        }
        return originalWriteFile(...args);
      };
      syncBuiltinESMExports();
      await assert.rejects(
        () => writeGuestTrustPin(root, {
          projectUuid, ownerKeyId, publisherKeyId: "c".repeat(64),
        }),
        { code: "EIO" },
      );
      assert.equal(injected, true);
      assert.equal(await readFile(destination, "utf8"), original);
      assert.equal((await readGuestTrustPin(root, projectUuid)).state, "valid");
      assert.deepEqual(await readdir(path.join(root, "trust")), [projectUuid + ".json"]);
    } finally {
      fs.promises.writeFile = originalWriteFile;
      syncBuiltinESMExports();
      await rm(root, { recursive: true, force: true });
    }
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", childSource], {
    encoding: "utf8", timeout: 10_000,
  });
  assert.equal(child.status, 0,
    `Interrupted trust write must leave no temporary file (signal=${child.signal}, error=${child.error?.code ?? "none"}): ${child.stderr}`);
});

test("Guest trust rejects a different large-inode file despite rounded Number identities", () => {
  // Isolate fs builtin overrides from parallel test files and real filesystem state.
  const childSource = `
    import assert from "node:assert/strict";
    import fs from "node:fs";
    import { randomUUID } from "node:crypto";
    import { syncBuiltinESMExports } from "node:module";
    import { mkdtemp, open, rm } from "node:fs/promises";
    import { tmpdir } from "node:os";
    import path from "node:path";
    import { readGuestTrustPin, writeGuestTrustPin } from ${JSON.stringify(new URL("../src/guest-trust.mjs", import.meta.url).href)};
    const root = await mkdtemp(path.join(tmpdir(), "tf-trust-inode-"));
    const uuid = randomUUID().toLowerCase();
    const originalLstat = fs.promises.lstat;
    let prototype, originalStat;
    try {
      const { destination } = await writeGuestTrustPin(root, {
        projectUuid: uuid, ownerKeyId: "a".repeat(64), publisherKeyId: "b".repeat(64),
      });
      const handle = await open(destination, "r");
      prototype = Object.getPrototypeOf(handle);
      originalStat = prototype.stat;
      await handle.close();
      const first = 9007199254740992n;
      const second = first + 1n;
      assert.equal(Number(first), Number(second));
      let seenBigint = false;
      fs.promises.lstat = async (target, options) => {
        const result = await originalLstat(target, options);
        if (String(target) === destination) {
          if (options?.bigint) seenBigint = true;
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
      assert.equal((await readGuestTrustPin(root, uuid)).state, "invalid");
      assert.equal(seenBigint, true);
    } finally {
      fs.promises.lstat = originalLstat;
      if (prototype && originalStat) prototype.stat = originalStat;
      syncBuiltinESMExports();
      await rm(root, { recursive: true, force: true });
    }
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", childSource], {
    encoding: "utf8", timeout: 10_000,
  });
  assert.equal(child.status, 0,
    `Large-inode collision must fail closed (signal=${child.signal}, error=${child.error?.code ?? "none"}): ${child.stderr}`);
});
