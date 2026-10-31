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
