import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  GUEST_MANAGED_ROOT_MARKER,
  inspectGuestDestination,
  prepareGuestDestination,
} from "../src/guest-destination.mjs";
import { inspectGuestStateRoot, prepareGuestStateRoot } from "../src/guest-state.mjs";
import {
  compareGuestTrustPin,
  readGuestTrustPin,
  writeGuestTrustPin,
} from "../src/guest-trust.mjs";
import { generateIdentity } from "../src/identity.mjs";
import { cleanup, temporaryRoot } from "./helpers.mjs";

test("Guest inspect is read-only and prepare claims only an empty absolute destination", async () => {
  const root = await temporaryRoot();
  try {
    const destination = path.join(root, "TeamForge Projects");
    const inspected = await inspectGuestDestination({ destinationRoot: destination });
    assert.equal(inspected.state, "available");
    await assert.rejects(() => readFile(path.join(destination, GUEST_MANAGED_ROOT_MARKER)));

    const prepared = await prepareGuestDestination({ destinationRoot: destination });
    assert.equal(prepared.state, "managed");
    assert.equal(prepared.projects.length, 0);
    assert.equal(JSON.parse(await readFile(path.join(destination, GUEST_MANAGED_ROOT_MARKER), "utf8")).schemaVersion, 1);

    const unrelated = path.join(root, "family-photos");
    await mkdir(unrelated);
    await writeFile(path.join(unrelated, "keep.txt"), "do not overwrite\n");
    await assert.rejects(
      () => prepareGuestDestination({ destinationRoot: unrelated }),
      { code: "destination_contains_unmanaged_content" },
    );
    assert.equal(await readFile(path.join(unrelated, "keep.txt"), "utf8"), "do not overwrite\n");
    await assert.rejects(() => readFile(path.join(unrelated, GUEST_MANAGED_ROOT_MARKER)));

    await assert.rejects(
      () => inspectGuestDestination({ destinationRoot: path.join(destination, "nested"), forbiddenRoots: [destination] }),
      { code: "destination_overlaps_runtime" },
    );
  } finally {
    await cleanup(root);
  }
});

test("Guest destination and state reject redirected roots", async (context) => {
  const root = await temporaryRoot();
  try {
    const target = path.join(root, "target");
    const redirected = path.join(root, "redirected");
    await mkdir(path.join(target, "nested"), { recursive: true });
    try {
      await symlink(target, redirected, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
        context.skip(`Filesystem link creation unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    await assert.rejects(
      () => inspectGuestDestination({ destinationRoot: redirected }),
      { code: "unsafe_guest_destination" },
    );
    await assert.rejects(
      () => inspectGuestStateRoot({ stateRoot: redirected }),
      { code: "unsafe_guest_state_root" },
    );
    await assert.rejects(
      () => inspectGuestDestination({ destinationRoot: path.join(redirected, "nested") }),
      { code: "unsafe_guest_destination" },
    );
    await assert.rejects(
      () => inspectGuestStateRoot({ stateRoot: path.join(redirected, "nested") }),
      { code: "unsafe_guest_state_root" },
    );
  } finally {
    await cleanup(root);
  }
});

test("Windows Guest roots reject UNC, device namespaces, ambiguous suffixes, and reserved segments", async (context) => {
  if (process.platform !== "win32") {
    context.skip("Windows path namespace regression.");
    return;
  }
  const root = await temporaryRoot();
  try {
    const unsafeDestinations = [
      "\\\\localhost\\C$\\TeamForge Projects",
      "\\\\?\\C:\\TeamForge Projects",
      path.join(root, "Runtime."),
      path.join(root, "Runtime "),
      path.join(root, "CON", "Projects"),
      `${root}\\\\Projects`,
    ];
    for (const destinationRoot of unsafeDestinations) {
      await assert.rejects(
        () => inspectGuestDestination({ destinationRoot }),
        { code: "unsafe_guest_destination" },
      );
    }
    await assert.rejects(
      () => inspectGuestStateRoot({ stateRoot: "\\\\localhost\\C$\\TeamForge\\Launcher" }),
      { code: "unsafe_guest_state_root" },
    );
    await assert.rejects(
      () => inspectGuestStateRoot({ stateRoot: path.join(root, "LPT1", "Launcher") }),
      { code: "unsafe_guest_state_root" },
    );
  } finally {
    await cleanup(root);
  }
});

test("Guest trust is state-root scoped, exact-bound, and corrupt data never auto-trusts", async () => {
  const root = await temporaryRoot();
  try {
    const destination = path.join(root, "projects");
    const stateRoot = path.join(root, "launcher-state");
    await prepareGuestDestination({ destinationRoot: destination });
    const state = await prepareGuestStateRoot({ stateRoot, destinationRoot: destination });
    const projectUuid = randomUUID().toLowerCase();
    const owner = generateIdentity("Owner");
    const publisher = generateIdentity("Publisher");
    assert.equal((await readGuestTrustPin(state.guestRoot, projectUuid)).state, "missing");
    const saved = await writeGuestTrustPin(state.guestRoot, {
      projectUuid,
      ownerKeyId: owner.keyId,
      publisherKeyId: publisher.keyId,
    });
    const record = await readGuestTrustPin(state.guestRoot, projectUuid);
    assert.equal(compareGuestTrustPin(record, {
      projectUuid, ownerKeyId: owner.keyId, publisherKeyId: publisher.keyId,
    }), "match");
    assert.equal(compareGuestTrustPin(record, {
      projectUuid, ownerKeyId: owner.keyId, publisherKeyId: generateIdentity("Other").keyId,
    }), "mismatch");
    assert.throws(() => compareGuestTrustPin(record, {
      projectUuid, ownerKeyId: generateIdentity("Wrong Owner").keyId, publisherKeyId: publisher.keyId,
    }), { code: "untrusted_owner" });
    assert.equal(saved.destination.startsWith(`${state.guestRoot}${path.sep}`), true);
    assert.equal(saved.destination.startsWith(`${destination}${path.sep}`), false);
    const replacementPublisher = generateIdentity("Replacement Publisher");
    await writeGuestTrustPin(state.guestRoot, {
      projectUuid,
      ownerKeyId: owner.keyId,
      publisherKeyId: replacementPublisher.keyId,
    });
    assert.equal((await readGuestTrustPin(state.guestRoot, projectUuid)).pin.publisherKeyId,
      replacementPublisher.keyId);
    const wrongProjectPin = JSON.parse(await readFile(saved.destination, "utf8"));
    wrongProjectPin.projectUuid = randomUUID().toLowerCase();
    await writeFile(saved.destination, `${JSON.stringify(wrongProjectPin, null, 2)}\n`, "utf8");
    await assert.rejects(
      () => readGuestTrustPin(state.guestRoot, projectUuid),
      { code: "guest_trust_project_conflict" },
    );
    await writeGuestTrustPin(state.guestRoot, {
      projectUuid,
      ownerKeyId: owner.keyId,
      publisherKeyId: replacementPublisher.keyId,
    });
    await writeFile(saved.destination, "{damaged", "utf8");
    assert.equal((await readGuestTrustPin(state.guestRoot, projectUuid)).state, "invalid");
  } finally {
    await cleanup(root);
  }
});
