import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
