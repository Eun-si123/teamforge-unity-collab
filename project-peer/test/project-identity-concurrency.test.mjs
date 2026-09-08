import assert from "node:assert/strict";
import test from "node:test";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdir, open, readFile, readdir, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { ProjectPeerEngine } from "../src/project-peer.mjs";
import { temporaryRoot, cleanup } from "./helpers.mjs";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const WINDOWS_V2 = process.platform === "win32";
const WINDOWS_FENCE = {
  schemaVersion: 2,
  kind: "teamforge-project-identity-lock-fence",
  mechanism: "windows-named-pipe",
};

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

async function assertLiveMarker(root) {
  const lockPath = path.join(root, "project-identity.lock");
  const source = await readFile(lockPath, "utf8");
  if (WINDOWS_V2) assert.deepEqual(JSON.parse(source), WINDOWS_FENCE);
  else assert.equal(source, "");
  return { lockPath, source };
}

async function assertReleasedMarker(root) {
  const lockPath = path.join(root, "project-identity.lock");
  if (WINDOWS_V2) {
    assert.deepEqual(JSON.parse(await readFile(lockPath, "utf8")), WINDOWS_FENCE);
  } else {
    await assert.rejects(readFile(lockPath), { code: "ENOENT" });
  }
}

for (const [name, firstUuid, secondUuid] of [
  ["generated", "", ""], ["matching", A, A], ["conflicting", A, B],
]) {
  test(`independent processes serialize ${name} first identities`, { timeout: 20000 }, async (t) => {
    const root = await setup(t);
    const first = worker(t, root, firstUuid, "after-find");
    assert.deepEqual(await first.next(), { stage: "after-find" });
    const { lockPath } = await assertLiveMarker(root);
    // A deliberately old timestamp is not evidence that this live owner died.
    await utimes(lockPath, new Date(0), new Date(0));
    const second = worker(t, root, secondUuid);
    assert.deepEqual(await second.next(), { error: "project_identity_busy" });
    await second.exited;
    first.child.send("continue");
    const { result } = await first.next();
    assert.ok(result);
    await first.exited;
    await assertReleasedMarker(root);
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
  test(`killed writer at ${stage} preserves one canonical identity`, { timeout: 25000 }, async (t) => {
    const root = await setup(t);
    const first = worker(t, root, A, stage);
    assert.deepEqual(await first.next(), { stage });
    const { lockPath, source: liveLock } = await assertLiveMarker(root);
    const liveContender = worker(t, root, B);
    assert.deepEqual(await liveContender.next(), { error: "project_identity_busy" });
    await liveContender.exited;
    assert.equal(first.child.exitCode, null);
    assert.equal(first.child.signalCode, null);
    const beforeCrash = await records(root);
    assert.equal(beforeCrash.length, stage === "after-link" ? 1 : 0);
    first.child.kill();
    await first.exited;

    if (!WINDOWS_V2) {
      // Legacy pathname ownership is intentionally ambiguous after process death.
      assert.equal(await readFile(lockPath, "utf8"), liveLock);
      const second = worker(t, root, B);
      assert.deepEqual(await second.next(), { error: "project_identity_busy" });
      await second.exited;
      const stored = await records(root);
      assert.deepEqual(stored, beforeCrash);
      assert.equal(await readFile(lockPath, "utf8"), liveLock);
      const reopened = await new ProjectPeerEngine({ managedRoot: root }).findProject("race");
      assert.deepEqual(reopened, stored[0] ?? null);
      if (reopened) assert.equal(reopened.projectUuid, A);
      return;
    }

    // Windows v2 leaves only the compatibility fence. Live ownership died with
    // the process, so a fresh writer can acquire the OS-owned pipe and re-check
    // the durable identity before deciding whether creation is still allowed.
    assert.deepEqual(JSON.parse(await readFile(lockPath, "utf8")), WINDOWS_FENCE);
    const second = worker(t, root, B);
    const recovery = await second.next();
    await second.exited;
    if (stage === "after-link") {
      assert.deepEqual(recovery, { error: "project_uuid_conflict" });
      assert.deepEqual(await records(root), beforeCrash);
      const canonical = worker(t, root);
      const reopened = await canonical.next();
      await canonical.exited;
      assert.equal(reopened.result.projectUuid, A);
    } else {
      assert.equal(recovery.result.projectUuid, B);
      assert.deepEqual(await records(root), [recovery.result]);
    }
    await assertReleasedMarker(root);
    assert.equal((await records(root)).length, 1);
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

test("unknown lock ownership remains fail-closed without modifying the record", { timeout: 20000 }, async (t) => {
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
  await assertReleasedMarker(root);
  assert.deepEqual(await engine.ensureProject({ projectId: "original", projectUuid: A }), original);
});

test("Windows v2 competing recoverers converge after a killed owner", {
  skip: !WINDOWS_V2,
  timeout: 25000,
}, async (t) => {
  const root = await setup(t);
  const interrupted = worker(t, root, A, "before-link");
  assert.deepEqual(await interrupted.next(), { stage: "before-link" });
  interrupted.child.kill();
  await interrupted.exited;
  assert.deepEqual(await records(root), []);

  const first = worker(t, root, A);
  const second = worker(t, root, A);
  const [left, right] = await Promise.all([first.next(), second.next()]);
  await Promise.all([first.exited, second.exited]);
  assert.ok(left.result);
  assert.deepEqual(right.result, left.result);
  assert.equal(left.result.projectUuid, A);
  assert.deepEqual(await records(root), [left.result]);
  await assertReleasedMarker(root);
});

test("Windows v2 releases ownership across repeated pre-publication crashes", {
  skip: !WINDOWS_V2,
  timeout: 30000,
}, async (t) => {
  const root = await setup(t);
  for (let index = 0; index < 6; index += 1) {
    const interrupted = worker(t, root, A, "after-find");
    assert.deepEqual(await interrupted.next(), { stage: "after-find" });
    interrupted.child.kill();
    await interrupted.exited;
    assert.deepEqual(await records(root), []);
    await assertReleasedMarker(root);
  }
  const final = worker(t, root, A);
  const created = await final.next();
  await final.exited;
  assert.equal(created.result.projectUuid, A);
  assert.deepEqual(await records(root), [created.result]);
  await assertReleasedMarker(root);
});

test("Windows v2 repeated crashes preserve an established canonical identity", {
  skip: !WINDOWS_V2,
  timeout: 30000,
}, async (t) => {
  const root = await setup(t);
  const engine = new ProjectPeerEngine({ managedRoot: root });
  const established = await engine.ensureProject({ projectId: "race", projectUuid: A });
  assert.deepEqual(await records(root), [established]);

  for (let index = 0; index < 6; index += 1) {
    const interrupted = worker(t, root, "", "after-find");
    assert.deepEqual(await interrupted.next(), { stage: "after-find" });
    interrupted.child.kill();
    await interrupted.exited;
    assert.deepEqual(await records(root), [established]);
    await assertReleasedMarker(root);
  }

  const reopened = worker(t, root);
  const result = await reopened.next();
  await reopened.exited;
  assert.deepEqual(result.result, established);

  const conflicting = worker(t, root, B);
  assert.deepEqual(await conflicting.next(), { error: "project_uuid_conflict" });
  await conflicting.exited;
  assert.deepEqual(await records(root), [established]);
  await assertReleasedMarker(root);
});

test("Windows v2 compatibility fence keeps legacy wx writers fail-closed", {
  skip: !WINDOWS_V2,
}, async (t) => {
  const root = await setup(t);
  const engine = new ProjectPeerEngine({ managedRoot: root });
  await engine.ensureProject({ projectId: "race", projectUuid: A });
  const lockPath = path.join(root, "project-identity.lock");
  assert.deepEqual(JSON.parse(await readFile(lockPath, "utf8")), WINDOWS_FENCE);
  await assert.rejects(open(lockPath, "wx", 0o600), { code: "EEXIST" });
});
