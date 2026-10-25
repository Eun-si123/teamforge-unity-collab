import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createInvite, loadInvite, saveInvite } from "../src/invite.mjs";
import { generateIdentity } from "../src/identity.mjs";
import { ProjectPeerEngine } from "../src/project-peer.mjs";
import { cleanup, temporaryRoot } from "./helpers.mjs";

const marker = "SYNTHETIC_INVITE_PRIVATE_MARKER_0800";

function signedInvite(owner, projectUuid, sessionId = "session-one") {
  return createInvite({
    serverAddress: "https://teamforge.example.com",
    realtimePath: "ws",
    projectId: "invite-privacy-project",
    projectUuid,
    sessionId,
    ownerIdentity: owner,
  });
}

function assertSanitized(error) {
  assert.equal(error.code, "invite_load_failed");
  assert.equal(error.message.includes(marker), false);
  assert.equal(error.message.includes("SYNTHETIC_"), false);
  return true;
}

test("malformed Project Invite JSON fails without echoing file bytes or modifying the input", async () => {
  const root = await temporaryRoot();
  try {
    const file = path.join(root, "invite.json");
    const raw = marker + " not-json";
    await writeFile(file, raw);
    await assert.rejects(loadInvite(file), assertSanitized);
    assert.equal(await readFile(file, "utf8"), raw);
    await assert.rejects(loadInvite(path.join(root, "missing.json")), (error) => {
      assert.equal(error.code, "invite_load_failed");
      assert.match(error.message, /ENOENT/u);
      return true;
    });
    const owner = generateIdentity("Test Owner");
    const valid = signedInvite(owner, randomUUID());
    const validFile = path.join(root, "valid-invite.json");
    await saveInvite(validFile, valid);
    assert.deepEqual(await loadInvite(validFile), valid);
  } finally {
    await cleanup(root);
  }
});

test("stored malformed invite blocks refresh without leaking content or overwriting the file", async () => {
  const root = await temporaryRoot();
  try {
    const engine = new ProjectPeerEngine({ managedRoot: path.join(root, "managed") });
    const owner = generateIdentity("Test Owner");
    const projectUuid = randomUUID();
    const initial = signedInvite(owner, projectUuid);
    await engine.importInviteValue({ invite: initial });
    const destination = path.join(engine.metadataRoot(projectUuid), "invite.json");
    const raw = marker + " corrupt-existing-invite";
    await writeFile(destination, raw);
    const refresh = signedInvite(owner, projectUuid, "session-two");
    await assert.rejects(engine.importInviteValue({ invite: refresh }), assertSanitized);
    assert.equal(await readFile(destination, "utf8"), raw);
    await assert.rejects(engine.storedInvite(projectUuid), assertSanitized);
    assert.equal(await readFile(destination, "utf8"), raw);
    await writeFile(destination, JSON.stringify(initial));
    const imported = await engine.importInviteValue({ invite: refresh });
    assert.deepEqual(imported.invite, refresh);
    assert.deepEqual(await engine.storedInvite(projectUuid), refresh);
  } finally {
    await cleanup(root);
  }
});
