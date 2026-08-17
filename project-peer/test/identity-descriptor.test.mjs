import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  baselinePayload,
  calculateDescriptorHash,
  createDescriptor,
  createOwnerProof,
  ownerProofPayload,
  verifyOwnerProof,
  validateDescriptor,
} from "../src/descriptor.mjs";
import { createInvite, validateInvite } from "../src/invite.mjs";
import { generateIdentity, loadIdentity, saveIdentity } from "../src/identity.mjs";
import { sha256 } from "../src/hash.mjs";
import { cleanup, temporaryRoot } from "./helpers.mjs";

const goldenCompatibility = JSON.parse(await readFile(new URL(
  "../../unity-package/com.eunsung.teamforge/Tests/Fixtures/teamforge-compatibility-v1.json",
  import.meta.url,
), "utf8"));

test("WP1 shared golden fixture validates Descriptor canonical bytes and signed Project Invite", () => {
  const descriptor = goldenCompatibility.descriptor;
  assert.equal(baselinePayload(descriptor), goldenCompatibility.canonicalPayload);
  assert.equal(calculateDescriptorHash(descriptor), descriptor.descriptorHash);
  assert.equal(validateDescriptor(descriptor), descriptor);
  assert.equal(validateInvite(goldenCompatibility.invite), goldenCompatibility.invite);
  assert.equal(goldenCompatibility.invite.projectUuid, descriptor.projectUuid);
  assert.equal(goldenCompatibility.invite.ownerKeyId, descriptor.ownerKeyId);
});

test("Ed25519 Owner and authorized Publisher produce a server-compatible signed descriptor", () => {
  const owner = generateIdentity("Owner");
  const publisher = generateIdentity("Publisher");
  const projectUuid = randomUUID();
  const descriptor = createDescriptor({
    projectId: "signed-project",
    projectUuid,
    baselineRevision: 3,
    manifestHash: "a".repeat(64),
    unityVersion: "6000.3.21f1",
    ownerIdentity: owner,
    publisherIdentity: publisher,
  });
  assert.equal(validateDescriptor(descriptor), descriptor);
  const fixtureHash = sha256(Buffer.from(baselinePayload(descriptor), "utf8"));
  assert.equal(descriptor.descriptorHash, fixtureHash);
  assert.equal(calculateDescriptorHash(descriptor), fixtureHash);
  assert.equal(descriptor.ownerPublicKey, owner.publicKey);
  assert.equal(descriptor.publisherPublicKey, publisher.publicKey);
  assert.notEqual(descriptor.publisherAuthorization, "");

  const tampered = { ...descriptor, baselineRevision: 4 };
  assert.throws(() => validateDescriptor(tampered));
});

test("Owner proof binds connection, endpoint, token, and baseline", () => {
  const owner = generateIdentity();
  const context = {
    projectId: "proof-project",
    projectUuid: randomUUID(),
    connectionId: randomUUID(),
    baselineRevision: 2,
    manifestHash: "b".repeat(64),
    endpoint: "http://127.0.0.1:5091/teamforge-transfer/v1",
    transferToken: "one-time-token-value-123456",
  };
  assert.equal(
    ownerProofPayload(context),
    [
      "teamforge-owner-proof-v1", context.projectId, context.projectUuid, context.connectionId,
      "2", context.manifestHash, context.endpoint, context.transferToken,
    ].join("\n"),
  );
  const signature = createOwnerProof(owner, context);
  assert.equal(verifyOwnerProof(owner.publicKey, context, signature), true);
  assert.equal(verifyOwnerProof(owner.publicKey, { ...context, connectionId: randomUUID() }, signature), false);
  assert.equal(verifyOwnerProof(owner.publicKey, { ...context, transferToken: "different-token-value" }, signature), false);
});

test("signed invite schema is stable and tampering is rejected", () => {
  const owner = generateIdentity();
  const invite = createInvite({
    serverAddress: "https://teamforge.example.com/base",
    realtimePath: "ws",
    projectId: "invite-project",
    projectUuid: randomUUID(),
    sessionId: "artists",
    ownerIdentity: owner,
  });
  assert.deepEqual(Object.keys(invite).sort(), [
    "format", "ownerKeyId", "ownerPublicKey", "ownerSignature", "projectId", "projectUuid",
    "realtimePath", "serverAddress", "sessionId",
  ]);
  assert.equal(validateInvite(invite), invite);
  assert.throws(() => validateInvite({ ...invite, sessionId: "other" }));
});

test("identity save is private best-effort and never overwrites an Owner key", async () => {
  const root = await temporaryRoot();
  try {
    const destination = path.join(root, "private", "owner.json");
    const first = generateIdentity("First");
    const second = generateIdentity("Second");
    await saveIdentity(destination, first);
    assert.equal((await loadIdentity(destination)).keyId, first.keyId);
    await assert.rejects(() => saveIdentity(destination, second), { code: "identity_exists" });
    assert.equal((await loadIdentity(destination)).keyId, first.keyId);
  } finally {
    await cleanup(root);
  }
});
