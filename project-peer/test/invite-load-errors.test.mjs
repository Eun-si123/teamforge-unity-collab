import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
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

test("stored Project Invite input is rejected at the bounded file-read boundary", async () => {
  const root = await temporaryRoot();
  try {
    const file = path.join(root, "oversized-invite.json");
    const raw = JSON.stringify({ padding: "x".repeat(70_000) });
    await writeFile(file, raw);
    await assert.rejects(loadInvite(file), (error) => {
      assert.equal(error.code, "invite_load_failed");
      assert.match(error.message, /size limit/u);
      assert.equal(error.message.includes(raw.slice(0, 128)), false);
      return true;
    });
    assert.equal(await readFile(file, "utf8"), raw);
  } finally {
    await cleanup(root);
  }
});

test("Project Invite filesystem errors do not reveal local paths", async () => {
  const root = await temporaryRoot();
  try {
    const missing = path.join(root, `${marker}-missing.json`);
    await assert.rejects(loadInvite(missing), (error) => {
      assert.equal(error.code, "invite_load_failed");
      assert.match(error.message, /ENOENT/u);
      assert.equal(error.message.includes(root), false);
      assert.equal(error.message.includes(marker), false);
      return true;
    });
  } finally {
    await cleanup(root);
  }
});

const execFileAsync = promisify(execFile);

test("saved invite refuses a symlink to a valid signed invite", { skip: process.platform === "win32" }, async () => {
  const root = await temporaryRoot();
  try {
    const original = path.join(root, "original.json");
    const alias = path.join(root, "alias.json");
    const invite = signedInvite(generateIdentity("Test Owner"), randomUUID());
    await saveInvite(original, invite);
    await symlink(original, alias);
    await assert.rejects(loadInvite(alias), (error) => {
      assert.equal(error.code, "invite_load_failed");
      assert.equal(error.message.includes(root), false);
      return true;
    });
    assert.deepEqual(await loadInvite(original), invite);
  } finally {
    await cleanup(root);
  }
});

test("saved invite rejects a FIFO without blocking the loader", { skip: process.platform === "win32" }, async () => {
  const root = await temporaryRoot();
  try {
    const fifo = path.join(root, "invite-pipe.json");
    await execFileAsync("mkfifo", [fifo]);
    const script = `import { loadInvite } from "./src/invite.mjs";
      try { await loadInvite(process.argv[1]); process.exitCode = 3; }
      catch (error) { console.log(error.code); if (error.code !== "invite_load_failed") process.exitCode = 4; }`;
    const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "-e", script, fifo], {
      cwd: path.resolve(import.meta.dirname, ".."), timeout: 2_000,
    });
    assert.equal(stdout.trim(), "invite_load_failed");
  } finally {
    await cleanup(root);
  }
});
