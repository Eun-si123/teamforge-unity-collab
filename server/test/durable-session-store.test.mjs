import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { link, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DurableSessionStoreError, openDurableSessionStore } from "../src/durable-session-store.mjs";

const scope = Object.freeze({
  projectId: "durable-project",
  sessionId: "durable-session",
  projectUuid: "11111111-1111-4111-8111-111111111111",
});
const epoch = "22222222-2222-4222-8222-222222222222";
const nextEpoch = "33333333-3333-4333-8333-333333333333";
const operationId = n => `44444444-4444-4444-8444-${String(n).padStart(12, "0")}`;
const fingerprint = n => createHash("sha256").update(`operation-${n}`).digest("hex");
const checkpoint = revision => ({
  formatVersion: 1,
  hierarchy: [{ objectId: "tf:o:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", name: `Cube ${revision}` }],
  components: { components: [], tombstones: [], properties: [] },
});
const operation = n => ({ operationId: operationId(n), userId: "editor-a", fingerprint: fingerprint(n), result: { type: "hierarchy_applied", serverRevision: n } });
const intent = (revision, fields = {}) => ({
  scope, epoch, baseRevision: revision - 1, revision,
  checkpoint: checkpoint(revision), operation: operation(revision), ...fields,
});
const lookup = n => ({ scope, epoch, operationId: operationId(n), userId: "editor-a", fingerprint: fingerprint(n) });
const expectStoreError = (run, code) => {
  let caught;
  assert.throws(run, error => {
    assert.ok(error instanceof DurableSessionStoreError, `expected DurableSessionStoreError, got ${error?.constructor?.name}`);
    assert.equal(typeof error.code, "string");
    if (code) assert.equal(error.code, code);
    caught = error;
    return true;
  });
  return caught;
};

async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "teamforge-durable-store-"));
  const filePath = path.join(root, "session.sqlite");
  const opened = [];
  t.after(async () => {
    for (const store of opened.reverse()) store.close();
    await rm(root, { recursive: true, force: true });
  });
  const open = extra => {
    const store = openDurableSessionStore({ filePath, ...options, ...extra });
    opened.push(store);
    return store;
  };
  return { root, filePath, open };
}

test("durable store atomically reopens the canonical checkpoint and exact operation outcome", async t => {
  const f = await fixture(t);
  const store = f.open();
  assert.equal(store.load(scope), null);
  assert.deepEqual(store.loadAll(), []);
  const input = intent(1, { checkpoint: { z: [true, null, 1.5], a: { value: "Collider" } } });
  const saved = store.commit(input);
  assert.equal(saved.replayed, false);
  assert.equal(saved.revision, 1);
  assert.match(saved.checksum, /^[a-f0-9]{64}$/);
  assert.deepEqual(saved.scope, scope);
  input.checkpoint.a.value = "changed by caller";
  saved.checkpoint.a.value = "changed by receiver";
  store.close();
  const restored = f.open();
  assert.deepEqual(restored.load(scope).checkpoint, { a: { value: "Collider" }, z: [true, null, 1.5] });
  assert.equal(restored.load(scope).checksum, saved.checksum);
  assert.deepEqual(restored.loadAll().map(value => value.scope), [scope]);
  const receipt = restored.findOperation(lookup(1));
  assert.equal(receipt.baseRevision, 0);
  assert.equal(receipt.revision, 1);
  assert.equal(receipt.epoch, epoch);
  assert.equal(receipt.operationId, operationId(1));
  assert.equal(receipt.checkpointChecksum, saved.checksum);
  assert.deepEqual(receipt.result, operation(1).result);
  assert.equal(restored.findOperation(lookup(9)), null);
});

test("durable retry does not roll back a newer checkpoint and rejects a changed operation identity", async t => {
  const f = await fixture(t);
  const store = f.open();
  const first = intent(1);
  store.commit(first);
  store.commit(intent(2));
  assert.equal(store.commit({ ...first, checkpoint: { ...first.checkpoint } }).replayed, true);
  assert.equal(store.load(scope).revision, 2);
  assert.deepEqual(store.load(scope).checkpoint, checkpoint(2));
  for (const changed of [
    { operation: { ...first.operation, fingerprint: fingerprint(99) } },
    { operation: { ...first.operation, userId: "editor-b" } },
    { operation: { ...first.operation, result: { different: true } } },
    { checkpoint: checkpoint(99) },
    { baseRevision: 1, revision: 2 },
  ]) expectStoreError(() => store.commit({ ...first, ...changed }), "OPERATION_CONFLICT");
  expectStoreError(() => store.findOperation({ ...lookup(1), userId: "editor-b" }), "OPERATION_CONFLICT");
  expectStoreError(() => store.findOperation({ ...lookup(1), fingerprint: fingerprint(99) }), "OPERATION_CONFLICT");
  assert.equal(store.load(scope).revision, 2);
  assert.deepEqual(store.findOperation(lookup(1)).result, operation(1).result);
});

test("durable CAS, exact scope and explicit epoch rotation fence stale content", async t => {
  const f = await fixture(t);
  const store = f.open();
  store.commit(intent(1, { operation: null }));
  store.commit(intent(2));
  const before = store.load(scope);
  expectStoreError(() => store.commit(intent(3, { baseRevision: 1 })), "REVISION_CONFLICT");
  expectStoreError(() => store.commit(intent(3, { revision: 4 })), "REVISION_CONFLICT");
  expectStoreError(() => store.commit(intent(3, { epoch: nextEpoch })), "EPOCH_CONFLICT");
  expectStoreError(() => store.commit(intent(2, { baseRevision: 2, operation: null, epoch: nextEpoch })), "EPOCH_CONFLICT");
  expectStoreError(() => store.commit(intent(2, { baseRevision: 2, operation: null, epoch: nextEpoch, previousEpoch: nextEpoch })), "EPOCH_CONFLICT");
  expectStoreError(() => store.commit(intent(3, { operation: null })), "REVISION_CONFLICT");
  expectStoreError(() => store.commit(intent(1, { scope: { ...scope, projectUuid: "55555555-5555-4555-8555-555555555555" } })));
  assert.deepEqual(store.load(scope), before);
  store.commit(intent(2, { baseRevision: 2, operation: null, epoch: nextEpoch, previousEpoch: epoch }));
  assert.equal(store.load(scope).epoch, nextEpoch);
  assert.equal(store.load(scope).revision, 2);
  assert.equal(store.findOperation(lookup(2)).epoch, epoch);
  expectStoreError(() => store.commit(intent(3)), "EPOCH_CONFLICT");
  store.commit(intent(3, { epoch: nextEpoch }));
  assert.equal(store.load(scope).revision, 3);
  assert.equal(store.findOperation({ ...lookup(3), epoch: nextEpoch }).revision, 3);
  assert.equal(store.findOperation(lookup(3)), null);
});

test("checkpoint-only admission keeps revision and a canonical reorder keeps checksum", async t => {
  const f = await fixture(t);
  const store = f.open();
  const initial = { a: 1, z: { a: 2, z: 3 } };
  const first = store.commit(intent(1, { checkpoint: initial, operation: null }));
  const same = store.commit(intent(1, { baseRevision: 1, checkpoint: { z: { z: 3, a: 2 }, a: 1 }, operation: null }));
  assert.equal(same.checksum, first.checksum);
  store.commit(intent(1, { baseRevision: 1, checkpoint: { ...initial, admittedScene: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }, operation: null }));
  assert.equal(store.load(scope).revision, 1);
  assert.equal(store.load(scope).checkpoint.admittedScene, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
});

test("non-JSON or unbounded caller data is refused without executing accessors or mutating storage", async t => {
  const f = await fixture(t, { maxCheckpointBytes: 4096, maxResultBytes: 2048 });
  const store = f.open();
  store.commit(intent(1));
  const cyclic = {};
  cyclic.self = cyclic;
  let reads = 0;
  const getter = Object.defineProperty({}, "value", { enumerable: true, get() { reads++; return 3; } });
  const hidden = Object.defineProperty({}, "hidden", { enumerable: false, value: 3 });
  let nested = { end: true };
  for (let i = 0; i < 100; i++) nested = { child: nested };
  const invalid = [cyclic, getter, hidden, new Date(), new Map(), new Proxy({}, {}), { value: NaN }, { value: Infinity }, { value: undefined }, { value: 1n }, { value: () => 1 }, { value: Symbol("value") }, { text: "x".repeat(5000) }, nested, Array(2), Array(2 ** 32 - 1)];
  for (const bad of invalid) expectStoreError(() => store.commit(intent(2, { checkpoint: bad })));
  expectStoreError(() => store.commit(intent(2, { operation: { ...operation(2), result: { text: "x".repeat(3000) } } })));
  expectStoreError(() => store.commit(intent(2, { scope: { ...scope, sessionId: "bad\u0000session" } })));
  expectStoreError(() => store.commit(intent(2, { scope: { ...scope, sessionId: "bad\ud800session" } })));
  assert.equal(reads, 0);
  assert.equal(store.load(scope).revision, 1);
  assert.equal(store.findOperation(lookup(2)), null);
});

test("stored checksum corruption refuses load and reopen without resetting the database", async t => {
  const f = await fixture(t);
  const store = f.open();
  store.commit(intent(1));
  store.close();
  const db = new DatabaseSync(f.filePath);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  const table = tables.find(row => {
    const columns = db.prepare(`PRAGMA table_info(${JSON.stringify(row.name)})`).all().map(column => column.name);
    return columns.includes("checkpoint_json") && columns.includes("checksum");
  });
  assert.ok(table, "checkpoint table must retain its versioned checksum");
  db.prepare(`UPDATE ${JSON.stringify(table.name)} SET checksum=?`).run("0".repeat(64));
  db.close();
  const bytesBefore = await readFile(f.filePath);
  let rejected;
  try {
    rejected = f.open();
    expectStoreError(() => rejected.loadAll(), "INTEGRITY_ERROR");
  } catch (error) {
    assert.ok(error instanceof DurableSessionStoreError);
    assert.equal(error.code, "INTEGRITY_ERROR");
  } finally { rejected?.close(); }
  assert.deepEqual(await readFile(f.filePath), bytesBefore);
});

test("a corrupt operation result cannot become a replay success", async t => {
  const f = await fixture(t);
  const store = f.open();
  store.commit(intent(1));
  store.close();
  const db = new DatabaseSync(f.filePath);
  db.prepare("UPDATE operation_results SET result_json=?").run('{"serverRevision":999,"type":"hierarchy_applied"}');
  db.close();
  let restored;
  try {
    restored = f.open();
    expectStoreError(() => restored.findOperation(lookup(1)), "INTEGRITY_ERROR");
    expectStoreError(() => restored.commit(intent(1)), "INTEGRITY_ERROR");
  } catch (error) {
    assert.ok(error instanceof DurableSessionStoreError);
    assert.equal(error.code, "INTEGRITY_ERROR");
  }
});

test("session quota refuses a second scope atomically and matching operation IDs stay scope-bound", async t => {
  const f = await fixture(t, { maxSessions: 1 });
  const store = f.open();
  store.commit(intent(1));
  const otherScope = { ...scope, sessionId: "other-session" };
  assert.equal(store.hasCapacityFor(scope), true, "an existing scope never needs new capacity");
  assert.equal(store.hasCapacityFor(otherScope), false);
  // An expected quota refusal is distinct from an unknown storage outcome.
  expectStoreError(() => store.commit(intent(1, { scope: otherScope })), "CAPACITY_EXCEEDED");
  assert.equal(store.load(otherScope), null);
  assert.equal(store.findOperation({ ...lookup(1), scope: otherScope }), null);
  assert.equal(store.loadAll().length, 1);
  assert.equal(store.load(scope).revision, 1);
  store.close();
  const expanded = f.open({ maxSessions: 2 });
  expanded.commit(intent(1, { scope: otherScope }));
  assert.equal(expanded.loadAll().length, 2);
  assert.equal(expanded.findOperation({ ...lookup(1), scope: otherScope }).scope.sessionId, "other-session");
  assert.equal(expanded.findOperation(lookup(1)).scope.sessionId, scope.sessionId);
});

test("an unsupported schema or foreign SQLite database is preserved and refused", async t => {
  const f = await fixture(t);
  const store = f.open();
  store.commit(intent(1));
  store.close();
  const db = new DatabaseSync(f.filePath);
  db.exec("PRAGMA user_version=2147483647");
  db.close();
  const bytesBefore = await readFile(f.filePath);
  expectStoreError(() => f.open(), "SCHEMA_MISMATCH");
  assert.deepEqual(await readFile(f.filePath), bytesBefore);
  const foreignPath = path.join(f.root, "foreign.sqlite");
  const foreign = new DatabaseSync(foreignPath);
  foreign.exec("CREATE TABLE important (value TEXT); INSERT INTO important VALUES ('preserve me')");
  foreign.close();
  const foreignBefore = await readFile(foreignPath);
  expectStoreError(() => openDurableSessionStore({ filePath: foreignPath }), "SCHEMA_MISMATCH");
  assert.deepEqual(await readFile(foreignPath), foreignBefore);
});

test("SQLite quota exhaustion rolls back the checkpoint and operation journal together", async t => {
  const f = await fixture(t, { maxDatabaseBytes: 64 * 1024, maxCheckpointBytes: 512 * 1024, maxResultBytes: 512 * 1024 });
  const store = f.open();
  store.commit(intent(1));
  const before = store.load(scope);
  const full = expectStoreError(() => store.commit(intent(2, {
    // The small checkpoint UPDATE fits. The following large journal INSERT
    // exceeds SQLite's page quota and must roll that UPDATE back as well.
    checkpoint: checkpoint(2),
    operation: { ...operation(2), result: { text: "y".repeat(128 * 1024) } },
  })), "STORAGE_ERROR");
  assert.equal(full.cause?.errcode, 13, "the write must fail with actual SQLITE_FULL");
  assert.deepEqual(store.load(scope), before);
  assert.equal(store.findOperation(lookup(2)), null);
  store.close();
  const restored = f.open();
  assert.deepEqual(restored.load(scope), before);
  assert.equal(restored.findOperation(lookup(2)), null);
});

test("store ownership is exclusive, close is idempotent, and a fresh owner can reopen", async t => {
  const f = await fixture(t);
  const store = f.open();
  store.commit(intent(1));
  expectStoreError(() => f.open(), "STORAGE_ERROR");
  store.close();
  store.close();
  expectStoreError(() => store.load(scope), "CLOSED");
  expectStoreError(() => store.commit(intent(2)), "CLOSED");
  assert.equal(f.open().load(scope).revision, 1);
});

test("invalid paths, symlink targets and non-regular database targets fail closed", async t => {
  const f = await fixture(t);
  expectStoreError(() => openDurableSessionStore({ filePath: "relative.sqlite" }));
  expectStoreError(() => openDurableSessionStore({ filePath: f.root }));
  const original = path.join(f.root, "original.sqlite");
  const alias = path.join(f.root, "alias.sqlite");
  await writeFile(original, "preserve this content");
  try { await symlink(original, alias); }
  catch (error) {
    if (error.code === "EPERM" && process.platform === "win32") return;
    throw error;
  }
  expectStoreError(() => openDurableSessionStore({ filePath: alias }));
  assert.equal(await readFile(original, "utf8"), "preserve this content");
  const walAlias = `${f.filePath}-wal`;
  await symlink(original, walAlias);
  expectStoreError(() => f.open());
  assert.equal(await readFile(original, "utf8"), "preserve this content");
});

test("hard-linked mainfiles and sidecars refuse ambiguous WAL ownership without altering their targets", async t => {
  const f = await fixture(t);
  const store = f.open();
  store.commit(intent(1));
  store.close();
  const alias = path.join(f.root, "alias.sqlite");
  try { await link(f.filePath, alias); }
  catch (error) {
    if (process.platform === "win32" && ["EPERM", "ENOTSUP"].includes(error.code)) return;
    throw error;
  }
  const before = await readFile(f.filePath);
  expectStoreError(() => f.open(), "STORAGE_ERROR");
  expectStoreError(() => openDurableSessionStore({ filePath: alias }), "STORAGE_ERROR");
  assert.deepEqual(await readFile(f.filePath), before);
  await rm(alias);
  assert.equal(f.open().load(scope).revision, 1);
  const sidecarTarget = path.join(f.root, "unrelated-content");
  const sidecarDb = path.join(f.root, "sidecar.sqlite");
  await writeFile(sidecarTarget, "preserve sidecar target");
  await link(sidecarTarget, `${sidecarDb}-wal`);
  expectStoreError(() => openDurableSessionStore({ filePath: sidecarDb }), "STORAGE_ERROR");
  assert.equal(await readFile(sidecarTarget, "utf8"), "preserve sidecar target");
});

async function childAtPhase(t, source, args) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", source, ...args], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let diagnostics = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", chunk => { diagnostics += chunk; });
  const exited = new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
  });
  const phase = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`child phase timeout: ${diagnostics}`)), 10000);
    child.once("message", value => { clearTimeout(timer); resolve(value); });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => { clearTimeout(timer); reject(new Error(`child exited before phase (${code}): ${diagnostics}`)); });
  });
  return { child, phase, exited };
}

test("kill after SQLite commit and before reply retains the exact lost-ACK outcome", async t => {
  const f = await fixture(t);
  const moduleUrl = new URL("../src/durable-session-store.mjs", import.meta.url).href;
  const source = `
    import { openDurableSessionStore } from ${JSON.stringify(moduleUrl)};
    const store = openDurableSessionStore({ filePath: process.argv[1] });
    const input = JSON.parse(process.argv[2]);
    store.commit(input);
    process.send({ phase: 'committed' });
    setInterval(() => {}, 1000);
  `;
  const { child, phase, exited } = await childAtPhase(t, source, [f.filePath, JSON.stringify(intent(1))]);
  assert.deepEqual(phase, { phase: "committed" });
  child.kill("SIGKILL");
  await exited;
  const store = f.open();
  assert.equal(store.load(scope).revision, 1);
  assert.deepEqual(store.findOperation(lookup(1)).result, operation(1).result);
  assert.equal(store.commit(intent(1)).replayed, true);
  assert.equal(store.load(scope).revision, 1);
});

test("kill inside an uncommitted SQLite transaction restores the last complete checkpoint and journal", async t => {
  const f = await fixture(t);
  const store = f.open();
  store.commit(intent(1));
  const before = store.load(scope);
  store.close();
  const source = `
    import { DatabaseSync } from 'node:sqlite';
    const db = new DatabaseSync(process.argv[1]);
    db.exec('BEGIN IMMEDIATE');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    for (const row of tables) {
      const cols = db.prepare('PRAGMA table_info(' + JSON.stringify(row.name) + ')').all().map(c => c.name);
      if (cols.includes('checkpoint_json') && cols.includes('checksum'))
        db.prepare('UPDATE ' + JSON.stringify(row.name) + ' SET checksum=?').run('f'.repeat(64));
      if (cols.includes('operation_id')) db.exec('DELETE FROM ' + JSON.stringify(row.name));
    }
    process.send({ phase: 'uncommitted' });
    setInterval(() => {}, 1000);
  `;
  const { child, phase, exited } = await childAtPhase(t, source, [f.filePath]);
  assert.deepEqual(phase, { phase: "uncommitted" });
  child.kill("SIGKILL");
  await exited;
  const restored = f.open();
  assert.deepEqual(restored.load(scope), before);
  assert.deepEqual(restored.findOperation(lookup(1)).result, operation(1).result);
  assert.ok((await stat(f.filePath)).size > 0);
});
