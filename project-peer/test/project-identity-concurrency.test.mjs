import assert from "node:assert/strict";
import test from "node:test";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, readdir, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { ProjectPeerEngine } from "../src/project-peer.mjs";
import { temporaryRoot, cleanup } from "./helpers.mjs";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
function worker(t, root, uuid = "", pause = "") {
  const child = fork(new URL("../test-support/identity-worker.mjs", import.meta.url), [root, uuid, pause], {
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  const messages = [];
  const waiting = [];
  child.on("message", (message) => waiting.length ? waiting.shift()(message) : messages.push(message));
  const exited = once(child, "exit");
  t.after(async () => { if (child.exitCode === null) child.kill(); await exited; });
  return {
    child, exited,
    next: () => messages.length ? Promise.resolve(messages.shift()) : new Promise((resolve) => waiting.push(resolve)),
  };
}
async function setup(t) {
  const root = await temporaryRoot("identity-race-");
  t.after(() => cleanup(root));
  return root;
}
async function records(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try { result.push(JSON.parse(await readFile(path.join(root, entry.name, "metadata/project.json"), "utf8"))); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return result;
}

for (const [name, firstUuid, secondUuid] of [
  ["generated", "", ""], ["matching", A, A], ["conflicting", A, B],
]) {
  test(`independent processes serialize ${name} first identities`, { timeout: 15000 }, async (t) => {
    const root = await setup(t);
    const first = worker(t, root, firstUuid, "after-find");
    assert.deepEqual(await first.next(), { stage: "after-find" });
    const lockPath = path.join(root, "project-identity.lock");
    assert.equal(await readFile(lockPath, "utf8"), "");
    // A deliberately old timestamp is not evidence that this live owner died.
    await utimes(lockPath, new Date(0), new Date(0));
    const second = worker(t, root, secondUuid);
    assert.deepEqual(await second.next(), { error: "project_identity_busy" });
    await second.exited;
    first.child.send("continue");
    const { result } = await first.next();
    assert.ok(result);
    await first.exited;
    await assert.rejects(readFile(lockPath), { code: "ENOENT" });
    const retry = worker(t, root, secondUuid);
    const outcome = await retry.next();
    if (name === "conflicting") assert.deepEqual(outcome, { error: "project_uuid_conflict" });
    else assert.deepEqual(outcome.result, result);
    await retry.exited;
    assert.deepEqual(await records(root), [result]);
    const reopened = new ProjectPeerEngine({ managedRoot: root });
    assert.deepEqual(await reopened.findProject(" race "), result);
    assert.deepEqual(await reopened.ensureProject({ projectId: "race" }), result);
  });
}

for (const stage of ["after-find", "before-link", "after-link"]) {
  test(`killed writer at ${stage} cannot permit a second identity`, { timeout: 15000 }, async (t) => {
    const root = await setup(t);
    const first = worker(t, root, A, stage);
    assert.deepEqual(await first.next(), { stage });
    const lockPath = path.join(root, "project-identity.lock");
    const liveLock = await readFile(lockPath);
    assert.equal(liveLock.length, 0);
    const liveContender = worker(t, root, B);
    assert.deepEqual(await liveContender.next(), { error: "project_identity_busy" });
    await liveContender.exited;
    assert.equal(first.child.exitCode, null);
    assert.equal(first.child.signalCode, null);
    const beforeCrash = await records(root);
    assert.equal(beforeCrash.length, stage === "after-link" ? 1 : 0);
    first.child.kill();
    await first.exited;
    // The parent knows this exact child exited. A fresh process has no such
    // ownership handle, and the durable lock record is unchanged by death.
    assert.deepEqual(await readFile(lockPath), liveLock);
    const second = worker(t, root, B);
    assert.deepEqual(await second.next(), { error: "project_identity_busy" });
    await second.exited;
    const stored = await records(root);
    assert.deepEqual(stored, beforeCrash);
    assert.deepEqual(await readFile(lockPath), liveLock);
    assert.equal(stored.length, stage === "after-link" ? 1 : 0);
    const reopened = await new ProjectPeerEngine({ managedRoot: root }).findProject("race");
    assert.deepEqual(reopened, stored[0] ?? null);
    if (reopened) assert.equal(reopened.projectUuid, A);
  });
}

test("lookup and initialization reject legacy duplicate normalized IDs", async (t) => {
  const root = await setup(t);
  const engine = new ProjectPeerEngine({ managedRoot: root });
  const original = await engine.ensureProject({ projectId: "race", projectUuid: A });
  await mkdir(engine.metadataRoot(B), { recursive: true });
  const duplicatePath = path.join(engine.metadataRoot(B), "project.json");
  for (const projectId of ["race", " race "]) {
    await writeFile(duplicatePath, JSON.stringify({ ...original, projectId, projectUuid: B }));
    await assert.rejects(engine.findProject("race"), { code: "project_uuid_conflict" });
    await assert.rejects(engine.ensureProject({ projectId: "race", projectUuid: B }), { code: "project_uuid_conflict" });
  }
  assert.equal((await records(root)).length, 2);
});

test("unknown lock ownership remains fail-closed without modifying the record", { timeout: 15000 }, async (t) => {
  const root = await setup(t);
  const lockPath = path.join(root, "project-identity.lock");
  for (const bytes of ["", "{", JSON.stringify({ pid: process.pid, startedAt: "1970-01-01" })]) {
    await writeFile(lockPath, bytes);
    const contender = worker(t, root, B);
    assert.deepEqual(await contender.next(), { error: "project_identity_busy" });
    await contender.exited;
    assert.equal(await readFile(lockPath, "utf8"), bytes);
    assert.deepEqual(await records(root), []);
  }
});

test("an established UUID belonging to another ID is never overwritten", async (t) => {
  const root = await setup(t);
  const engine = new ProjectPeerEngine({ managedRoot: root });
  const original = await engine.ensureProject({ projectId: "original", projectUuid: A });
  await assert.rejects(engine.ensureProject({ projectId: "race", projectUuid: A }), { code: "EEXIST" });
  assert.deepEqual(await records(root), [original]);
  assert.equal(await engine.findProject("race"), null);
  await assert.rejects(readFile(path.join(root, "project-identity.lock")), { code: "ENOENT" });
  assert.deepEqual(await engine.ensureProject({ projectId: "original", projectUuid: A }), original);
});
