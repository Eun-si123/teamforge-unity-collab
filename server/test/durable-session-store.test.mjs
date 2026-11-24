import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
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
  expectStoreError(() => store.commit(intent(1, { scope: otherScope })));
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

// The batch interface below is a STORAGE-ONLY building block for the future
// all-Editor quiescence/Publisher/Guest transaction. It is deliberately not a
// Coordinator WebSocket operation or a public Baseline publication mechanism.
const revisionHash = value => String(value).repeat(64);
const projectOld = Object.freeze({
  projectId:scope.projectId,projectUuid:scope.projectUuid,
  baselineRevision:1,descriptorHash:revisionHash('a'),
  manifestHash:revisionHash('b'),ownerKeyId:revisionHash('c'),
  ownerPublicKey:'synthetic-public-owner-evidence',
});
const projectNext = Object.freeze({
  ...projectOld,baselineRevision:2,descriptorHash:revisionHash('d'),manifestHash:revisionHash('e'),
});
const published = Object.freeze({publishedByUserId:'owner',publishedByConnectionId:'published-connection',publishedAtUnixMs:1000});
const durableM4 = (revision,sessionId,component = null) => ({
  version:1,lineageId:'66666666-6666-4666-8666-666666666666',
  project:projectOld,publication:published,
  realtime:{revision,hierarchyObjects:[{id:sessionId,name:`Saved ${revision}`}],transforms:[{position:{x:1,y:2,z:3}}]},
  components:component,
});
const repinned = (stored, updates = {}) => {
  const copy = structuredClone(stored);
  return {...copy,project:{...projectNext},
    publication:{...published,publishedAtUnixMs:2000},
    ...(copy.components ? {components:{...copy.components,
      source:{...copy.components.source,...projectNext}}} : {}),
    ...updates};
};
const persisted = ({replayed: _firstWriteOnly, ...record}) => record;
const signedComponent = () => ({
  source:{...projectOld,sceneId:'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    scenePath:'Assets/Scenes/Main.unity',sceneFileSha256:revisionHash('f'),
    sceneMetaSha256:revisionHash('0')},
  collider:{sceneId:'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',properties:[{value:17}],components:[]},
});
function seedProjectSessions(store) {
  const otherScope={...scope,sessionId:'hierarchy-only'};
  const outsider={...scope,projectId:'independent-project',sessionId:'foreign'};
  const first=store.commit({scope,epoch,baseRevision:0,revision:1,
    checkpoint:durableM4(1,scope.sessionId,signedComponent()),operation:operation(1)});
  const second=store.commit({scope:otherScope,epoch:nextEpoch,baseRevision:0,revision:1,
    checkpoint:durableM4(1,otherScope.sessionId),operation:null});
  const foreign=store.commit({scope:outsider,epoch,baseRevision:0,revision:1,
    checkpoint:durableM4(1,outsider.sessionId),operation:null});
  const migration={projectId:scope.projectId,projectUuid:scope.projectUuid,
    previousDescriptorHash:projectOld.descriptorHash,
    candidateDescriptorHash:projectNext.descriptorHash,
    sessions:[
      {scope,previousEpoch:epoch,nextEpoch:'77777777-7777-4777-8777-777777777777',
        revision:1,expectedChecksum:first.checksum,checkpoint:repinned(first.checkpoint)},
      {scope:otherScope,previousEpoch:nextEpoch,nextEpoch:'88888888-8888-4888-8888-888888888888',
        revision:1,expectedChecksum:second.checksum,checkpoint:repinned(second.checkpoint)},
    ],
  };
  return {first,second,foreign,outsider,otherScope,migration};
}

test('M4->M5 internal storage batch atomically repins every Collider and Hierarchy-only Session, retaining accepted edits, receipts and lineage after reopening',async t=>{
  const f=await fixture(t);
  const store=f.open();
  const {first,second,foreign,outsider,otherScope,migration}=seedProjectSessions(store);
  const result=store.transitionProjectCheckpoints(migration);
  assert.deepEqual(result,{projectId:scope.projectId,projectUuid:scope.projectUuid,
    descriptorHash:projectNext.descriptorHash,sessionCount:2,revisionPreserved:true});
  for(const [item,old] of [[migration.sessions[0],first],[migration.sessions[1],second]]) {
    const read=store.load(item.scope);
    assert.equal(read.epoch,item.nextEpoch);
    assert.equal(read.revision,old.revision);
    assert.equal(read.checkpoint.project.descriptorHash,projectNext.descriptorHash);
    assert.deepEqual(read.checkpoint.realtime,old.checkpoint.realtime);
    assert.equal(read.checkpoint.lineageId,old.checkpoint.lineageId);
  }
  assert.deepEqual(store.load(outsider),persisted(foreign),'Unrelated Project checkpoints must be preserved.');
  const oldReceipt=store.findOperation(lookup(1));
  assert.equal(oldReceipt.revision,1);
  assert.equal(oldReceipt.epoch,epoch,'Old operation receipts retain their original epochs.');
  assert.equal(store.findOperation({...lookup(1),epoch:migration.sessions[0].nextEpoch}),null,
    'Old operation cannot replay as a new Project epoch.');
  store.close();
  const restored=f.open();
  assert.equal(restored.load(scope).checkpoint.project.baselineRevision,2);
  assert.equal(restored.load(otherScope).checkpoint.project.baselineRevision,2);
  assert.deepEqual(restored.load(scope).checkpoint.components.collider,first.checkpoint.components.collider);
  assert.deepEqual(restored.findOperation(lookup(1)).result,operation(1).result);
  assert.deepEqual(restored.load(outsider),persisted(foreign));
});

test('M4->M5 internal storage batch rejects missing, duplicate, foreign and newly added Sessions with zero partial migration',async t=>{
  for(const mutate of [
    ({migration})=>{migration.sessions.pop();},
    ({migration})=>{migration.sessions.push({...migration.sessions[0]});},
    ({migration})=>{migration.sessions[1].scope={...scope,sessionId:'unrecorded'};},
    ({migration})=>{migration.sessions[1].scope={...scope,projectUuid:'99999999-9999-4999-8999-999999999999'};},
    ({migration})=>{migration.sessions[0].scope={...scope,projectId:'wrong-project'};},
  ]) {
    const f=await fixture(t);const store=f.open();
    const state=seedProjectSessions(store);
    mutate(state);
    assert.throws(()=>store.transitionProjectCheckpoints(state.migration),error=>{
      assert.ok(error instanceof DurableSessionStoreError);
      assert.ok(['SCOPE_CONFLICT','SESSION_SET_CONFLICT'].includes(error.code));return true;
    });
    assert.deepEqual(store.load(scope),persisted(state.first));
    assert.deepEqual(store.load(state.otherScope),persisted(state.second));
    assert.deepEqual(store.load(state.outsider),persisted(state.foreign));
  }
});

test('M4->M5 internal storage batch refuses stale checksums, revisions or old epochs without writing the first Session',async t=>{
  for(const mutate of [
    ({migration})=>{migration.sessions[1].previousEpoch=epoch;},
    ({migration})=>{migration.sessions[1].expectedChecksum=revisionHash('a');},
    ({migration})=>{migration.sessions[1].revision=2;},
    ({migration})=>{migration.sessions[1].nextEpoch=migration.sessions[1].previousEpoch;},
    ({migration})=>{migration.sessions[1].nextEpoch=migration.sessions[0].nextEpoch;},
    ({migration})=>{migration.sessions[1].nextEpoch=migration.sessions[0].previousEpoch;},
    ({migration})=>{migration.previousDescriptorHash=revisionHash('d');},
  ]) {
    const f=await fixture(t);const store=f.open();const state=seedProjectSessions(store);
    mutate(state);
    expectStoreError(()=>store.transitionProjectCheckpoints(state.migration));
    assert.deepEqual(store.load(scope),persisted(state.first));
    assert.deepEqual(store.load(state.otherScope),persisted(state.second));
    assert.equal(store.findOperation(lookup(1)).revision,1);
  }
});

test('M4->M5 internal storage batch protects exact source pins, Collider properties, Transform/Hierarchy edits, signed publication and lineage',async t=>{
  for(const mutate of [
    ({migration})=>{migration.sessions[1].checkpoint.realtime.hierarchyObjects[0].name='Forged';},
    ({migration})=>{migration.sessions[0].checkpoint.components.collider.properties[0].value=99;},
    ({migration})=>{migration.sessions[0].checkpoint.components.unrelatedFutureLedger={owner:'forged'};},
    ({migration})=>{migration.sessions[1].checkpoint.lineageId='00000000-0000-0000-0000-000000000000';},
    ({migration})=>{migration.sessions[0].checkpoint.components.source.descriptorHash=projectOld.descriptorHash;},
    ({migration})=>{migration.sessions[0].checkpoint.components=null;},
    ({migration})=>{migration.sessions[0].checkpoint.project.baselineRevision=3;},
    ({migration})=>{migration.sessions[1].checkpoint.project.manifestHash=revisionHash('f');},
    ({migration})=>{migration.sessions[1].checkpoint.project.ownerKeyId=revisionHash('7');},
    ({migration})=>{migration.sessions[1].checkpoint.project.ownerPublicKey='wrong-owner';},
    ({migration})=>{migration.sessions[1].checkpoint.project.projectId='another-project';},
    ({migration})=>{migration.sessions[0].checkpoint.components.source.sceneFileSha256=revisionHash('9');},
    ({migration})=>{migration.sessions[0].checkpoint.components.source.scenePath='Assets/Scenes/Forged.unity';},
    ({migration})=>{migration.sessions[1].checkpoint.publication.publishedAtUnixMs=3000;},
    ({migration})=>{migration.sessions[1].checkpoint.publication.publishedByUserId='';},
    ({migration})=>{migration.sessions[1].checkpoint.publication.publishedAtUnixMs=1;},
  ]) {
    const f=await fixture(t);const store=f.open();const state=seedProjectSessions(store);
    mutate(state);
    expectStoreError(()=>store.transitionProjectCheckpoints(state.migration));
    assert.deepEqual(store.load(scope),persisted(state.first));
    assert.deepEqual(store.load(state.otherScope),persisted(state.second));
  }
});

test('M4->M5 internal storage batch refuses concurrent new Session or accepted edit, with identical original recovery bytes',async t=>{
  const f=await fixture(t);const store=f.open();const state=seedProjectSessions(store);
  const added={...scope,sessionId:'late-join-registered'};
  const newRecord=store.commit({scope:added,epoch,baseRevision:0,revision:1,
    checkpoint:durableM4(1,added.sessionId),operation:null});
  expectStoreError(()=>store.transitionProjectCheckpoints(state.migration),'SESSION_SET_CONFLICT');
  assert.deepEqual(store.load(added),persisted(newRecord));
  assert.deepEqual(store.load(scope),persisted(state.first));
  store.close();
  const reopened=f.open();
  assert.deepEqual(reopened.load(scope),persisted(state.first));
  assert.deepEqual(reopened.load(state.otherScope),persisted(state.second));
});

test('M4->M5 internal storage batch refuses an accepted M4 edit after review without replacing another checkpoint or its journal',async t=>{
  const f=await fixture(t);const store=f.open();const state=seedProjectSessions(store);
  const accepted=store.commit({scope:state.otherScope,epoch:nextEpoch,baseRevision:1,revision:2,
    checkpoint:durableM4(2,state.otherScope.sessionId),operation:operation(2)});
  expectStoreError(()=>store.transitionProjectCheckpoints(state.migration),'REVISION_CONFLICT');
  assert.deepEqual(store.load(scope),persisted(state.first));
  assert.deepEqual(store.load(state.otherScope),persisted(accepted));
  assert.equal(store.findOperation({ ...lookup(2),scope:state.otherScope,epoch:nextEpoch }).revision,2);
  store.close();
  const restored=f.open();
  assert.deepEqual(restored.load(scope),persisted(state.first));
  assert.deepEqual(restored.load(state.otherScope),persisted(accepted));
});


test('M4->M5 internal storage batch atomically rolls back on actual SQLITE_FULL and restores all original epochs',async t=>{
  const f=await fixture(t,{maxDatabaseBytes:64*1024,maxCheckpointBytes:512*1024});
  const store=f.open();const state=seedProjectSessions(store);
  const oversizedProject={...projectNext,largeSignedNote:'x'.repeat(130*1024)};
  for(const record of state.migration.sessions)
    record.checkpoint.project=oversizedProject;
  const error=expectStoreError(()=>store.transitionProjectCheckpoints(state.migration),'STORAGE_ERROR');
  assert.equal(error.cause?.errcode,13,'A real SQLITE_FULL must prevent committing partial Session rows.');
  assert.deepEqual(store.load(scope),persisted(state.first));
  assert.deepEqual(store.load(state.otherScope),persisted(state.second));
  assert.deepEqual(store.findOperation(lookup(1)).result,operation(1).result);
  store.close();
  const restored=f.open();
  assert.deepEqual(restored.load(scope),persisted(state.first));
  assert.deepEqual(restored.load(state.otherScope),persisted(state.second));
});

test('M4->M5 SQLite batch survives process SIGKILL after COMMIT but before Publisher confirmation as an all-new Session set',async t=>{
  const f=await fixture(t);
  const store=f.open();const state=seedProjectSessions(store);
  store.close();
  const moduleUrl=new URL('../src/durable-session-store.mjs',import.meta.url).href;
  const source=`
    import { openDurableSessionStore } from ${JSON.stringify(moduleUrl)};
    const store=openDurableSessionStore({filePath:process.argv[1]});
    const transition=JSON.parse(process.argv[2]);
    const saved=store.transitionProjectCheckpoints(transition);
    process.send({phase:'persisted',sessionCount:saved.sessionCount});
    setInterval(()=>{},1000);
  `;
  const {child,phase,exited}=await childAtPhase(t,source,[f.filePath,JSON.stringify(state.migration)]);
  assert.deepEqual(phase,{phase:'persisted',sessionCount:2});
  child.kill('SIGKILL');
  await exited;
  const restored=f.open();
  for(const item of state.migration.sessions) {
    const record=restored.load(item.scope);
    assert.equal(record.checkpoint.project.descriptorHash,projectNext.descriptorHash);
    assert.equal(record.epoch,item.nextEpoch);
  }
  assert.equal(restored.findOperation(lookup(1)).epoch,epoch);
  assert.equal(restored.listProjectTransitionJournals()[0].stage,'sqlite_committed');
  assert.deepEqual(restored.readProjectTransitionBackup({projectId:scope.projectId,sessionId:scope.sessionId}).checkpoint,
    state.first.checkpoint);
  expectStoreError(()=>restored.transitionProjectCheckpoints(state.migration),'REVISION_CONFLICT');
  assert.deepEqual(restored.load(state.outsider),persisted(state.foreign));
});

test('M4->M5 unresolved SQLite repin blocks new edits while preserving both signed source versions, old receipts and immutable M4 backup',async t=>{
  const f=await fixture(t);const store=f.open();const state=seedProjectSessions(store);
  store.transitionProjectCheckpoints(state.migration);
  const current=store.load(scope);
  const nextCheckpoint={...current.checkpoint,
    realtime:{...current.checkpoint.realtime,revision:2,
      hierarchyObjects:[{id:scope.sessionId,name:'Unverified post-transition edit'}]}};
  const pending=store.listProjectTransitionJournals();
  assert.equal(pending.length,1);
  assert.equal(pending[0].stage,'sqlite_committed');
  assert.equal(pending[0].candidateDescriptorHash,projectNext.descriptorHash);
  assert.equal(pending[0].sessionCount,2);
  assert.equal(pending[0].sessions.length,2);
  assert.equal(store.readProjectTransitionBackup({projectId:scope.projectId,sessionId:scope.sessionId}).checksum,state.first.checksum);
  expectStoreError(()=>store.commit({scope,epoch:state.migration.sessions[0].nextEpoch,
    baseRevision:1,revision:2,checkpoint:nextCheckpoint,operation:operation(2)}),'TRANSITION_RECOVERY_REQUIRED');
  assert.equal(store.load(scope).revision,1);
  assert.equal(store.findOperation(lookup(1)).epoch,epoch);
  assert.equal(store.findOperation({...lookup(2),epoch:state.migration.sessions[0].nextEpoch}),null);
  store.close();
  const restored=f.open();
  assert.equal(restored.load(scope).checkpoint.project.descriptorHash,projectNext.descriptorHash);
  assert.deepEqual(restored.readProjectTransitionBackup({projectId:scope.projectId,sessionId:scope.sessionId}).checkpoint,
    state.first.checkpoint);
  assert.equal(restored.load(state.otherScope).revision,1);
  assert.equal(restored.findOperation(lookup(1)).revision,1);
  assert.equal(restored.listProjectTransitionJournals().length,1);
});

test('M4->M5 signed transition journal sorts non-ASCII Session keys by actual SQLite binary collation',async t=>{
  const f=await fixture(t);const store=f.open();
  const firstScope={...scope,sessionId:'\u{10000}'};
  const secondScope={...scope,sessionId:'\uE000'};
  const sessions=[firstScope,secondScope].map((item,index)=>{
    const previousEpoch=randomUUID(),freshEpoch=randomUUID();
    const old=store.commit({scope:item,epoch:previousEpoch,baseRevision:0,revision:1,
      checkpoint:durableM4(1,item.sessionId),operation:null});
    return {scope:item,previousEpoch,nextEpoch:freshEpoch,revision:1,
      expectedChecksum:old.checksum,checkpoint:repinned(old.checkpoint)};
  });
  store.transitionProjectCheckpoints({projectId:scope.projectId,projectUuid:scope.projectUuid,
    previousDescriptorHash:projectOld.descriptorHash,candidateDescriptorHash:projectNext.descriptorHash,
    sessions});
  const journals=store.listProjectTransitionJournals();
  assert.equal(journals.length,1);
  assert.deepEqual(journals[0].sessions.map(item=>item.sessionId),['\uE000','\u{10000}']);
  store.close();
  assert.equal(f.open().listProjectTransitionJournals()[0].sessionCount,2);
});

test('M4->M5 SQLite schema v1 upgrade preserves old accepted edits and receipts without rewriting checksum domains',async t=>{
  const f=await fixture(t);const store=f.open();
  const seed=store.commit(intent(1));
  const originalReceipt=store.findOperation(lookup(1));
  store.close();
  const db=new DatabaseSync(f.filePath);
  db.exec('DROP TABLE transition_checkpoint_backups; DROP TABLE project_transition_journal; PRAGMA user_version=1;');
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,1);
  db.close();
  const migrated=f.open();
  assert.equal(migrated.load(scope).checksum,seed.checksum);
  assert.deepEqual(migrated.load(scope).checkpoint,seed.checkpoint);
  assert.deepEqual(migrated.findOperation(lookup(1)),originalReceipt);
  assert.deepEqual(migrated.listProjectTransitionJournals(),[]);
  migrated.close();
  const check=new DatabaseSync(f.filePath);
  assert.equal(check.prepare('PRAGMA user_version').get().user_version,2);
  assert.equal(check.prepare('SELECT count(*) AS count FROM project_transition_journal').get().count,0);
  check.close();
  const reopened=f.open();
  assert.equal(reopened.load(scope).checksum,seed.checksum);
});

test('M4->M5 SQLite journal and both prior Session backups are atomic with repin across SQLITE_FULL',async t=>{
  const f=await fixture(t,{maxDatabaseBytes:64*1024,maxCheckpointBytes:512*1024});
  const store=f.open();const state=seedProjectSessions(store);
  const oversizedProject={...projectNext,largeSignedNote:'y'.repeat(130*1024)};
  for(const record of state.migration.sessions) record.checkpoint.project=oversizedProject;
  expectStoreError(()=>store.transitionProjectCheckpoints(state.migration),'STORAGE_ERROR');
  assert.deepEqual(store.listProjectTransitionJournals(),[]);
  assert.deepEqual(store.load(scope),persisted(state.first));
  assert.deepEqual(store.load(state.otherScope),persisted(state.second));
  store.close();
  const opened=f.open();
  assert.deepEqual(opened.listProjectTransitionJournals(),[]);
});

test('M4->M5 journal detects modified committed intent and old backup before allowing restart',async t=>{
  for(const mutate of [
    db=>db.prepare('UPDATE project_transition_journal SET checksum=?').run('0'.repeat(64)),
    db=>db.prepare('UPDATE transition_checkpoint_backups SET checksum=? WHERE session_id=?').run('0'.repeat(64),scope.sessionId),
    db=>db.prepare('UPDATE transition_checkpoint_backups SET checkpoint_json=? WHERE session_id=?').run('{"untrusted":true}',scope.sessionId),
    db=>db.prepare('DELETE FROM transition_checkpoint_backups WHERE session_id=?').run(scope.sessionId),
  ]) {
    const f=await fixture(t);const store=f.open();const state=seedProjectSessions(store);
    store.transitionProjectCheckpoints(state.migration);
    store.close();
    const db=new DatabaseSync(f.filePath);mutate(db);db.close();
    expectStoreError(()=>f.open(),'INTEGRITY_ERROR');
    const verify=new DatabaseSync(f.filePath);
    assert.equal(verify.prepare('SELECT count(*) AS count FROM project_transition_journal').get().count,1);
    verify.close();
  }
});

test('M4->M5 transition journal forbids epoch rotation until exact filesystem pointer reconciliation',async t=>{
  const f=await fixture(t);const store=f.open();const state=seedProjectSessions(store);
  store.transitionProjectCheckpoints(state.migration);
  const rotation={sessions:[...state.migration.sessions.map(item=>({
    scope:item.scope,previousEpoch:item.nextEpoch,nextEpoch:randomUUID(),revision:item.revision,
    expectedChecksum:store.load(item.scope).checksum})),{
    scope:state.outsider,previousEpoch:epoch,nextEpoch:randomUUID(),revision:1,
    expectedChecksum:state.foreign.checksum}]};
  expectStoreError(()=>store.rotateRecoveredEpochs(rotation),'TRANSITION_RECOVERY_REQUIRED');
  assert.equal(store.load(scope).epoch,state.migration.sessions[0].nextEpoch);
  assert.equal(store.load(state.outsider).epoch,epoch);
});

// Startup must never publish a half-restored authority after a crash while
// re-epoching multiple M4 Sessions. Signed project contents are unchanged.
function recoveredRotation(state) {
  return {sessions:[
    {scope,previousEpoch:epoch,nextEpoch:'99999999-9999-4999-8999-999999999999',
      revision:state.first.revision,expectedChecksum:state.first.checksum},
    {scope:state.otherScope,previousEpoch:nextEpoch,nextEpoch:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      revision:state.second.revision,expectedChecksum:state.second.checksum},
    {scope:state.outsider,previousEpoch:epoch,nextEpoch:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      revision:state.foreign.revision,expectedChecksum:state.foreign.checksum},
  ]};
}

test('M4 startup atomically rotates ALL restored Session epochs across Projects without altering source, edits or old receipts',async t=>{
  const f=await fixture(t);const store=f.open();const state=seedProjectSessions(store);
  const rotation=recoveredRotation(state);
  assert.deepEqual(store.rotateRecoveredEpochs(rotation),{sessionCount:3,revisionsPreserved:true});
  for(const [item,before] of rotation.sessions.map((item,index)=>
    [item,[state.first,state.second,state.foreign][index]])) {
    const restored=store.load(item.scope);
    assert.equal(restored.epoch,item.nextEpoch);
    assert.equal(restored.revision,before.revision);
    assert.deepEqual(restored.checkpoint,before.checkpoint,
      'Restart epoch must not rewrite a signed Project or accepted realtime state.');
    assert.notEqual(restored.checksum,before.checksum,'Epoch must be covered by the stored checksum.');
  }
  assert.deepEqual(store.findOperation(lookup(1)).result,operation(1).result);
  assert.equal(store.findOperation({...lookup(1),epoch:rotation.sessions[0].nextEpoch}),null);
  store.close();
  const reopened=f.open();
  assert.equal(reopened.load(scope).epoch,rotation.sessions[0].nextEpoch);
  assert.equal(reopened.load(state.otherScope).epoch,rotation.sessions[1].nextEpoch);
  assert.equal(reopened.load(state.outsider).epoch,rotation.sessions[2].nextEpoch);
  assert.equal(reopened.findOperation(lookup(1)).epoch,epoch);
  // A second crash/restart advances EVERY recovered epoch again.
  const again={sessions:rotation.sessions.map((item,index)=>({
    ...item,previousEpoch:item.nextEpoch,
    nextEpoch:['cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'][index],
    expectedChecksum:reopened.load(item.scope).checksum,
  }))};
  assert.equal(reopened.rotateRecoveredEpochs(again).sessionCount,3);
  assert.equal(reopened.load(scope).epoch,again.sessions[0].nextEpoch);
  assert.deepEqual(reopened.findOperation(lookup(1)).result,operation(1).result);
});

test('M4 startup refuses omitted, duplicate, stale, swapped and colliding Session epochs with no partial rotation',async t=>{
  const mutations=[
    rotation=>rotation.sessions.pop(),
    rotation=>rotation.sessions.push({...rotation.sessions[0]}),
    rotation=>rotation.sessions[1].expectedChecksum='f'.repeat(64),
    rotation=>rotation.sessions[1].previousEpoch=epoch,
    rotation=>rotation.sessions[1].revision=2,
    rotation=>rotation.sessions[1].nextEpoch=rotation.sessions[0].nextEpoch,
    rotation=>rotation.sessions[0].nextEpoch=rotation.sessions[1].previousEpoch,
    rotation=>rotation.sessions[1].scope={...scope,sessionId:'unknown'},
    rotation=>rotation.sessions[1].scope={...scope,projectUuid:'00000000-0000-4000-8000-000000000000'},
  ];
  for(const mutate of mutations) {
    const f=await fixture(t);const store=f.open();const state=seedProjectSessions(store);
    const rotation=recoveredRotation(state);
    mutate(rotation);
    expectStoreError(()=>store.rotateRecoveredEpochs(rotation));
    assert.deepEqual(store.load(scope),persisted(state.first));
    assert.deepEqual(store.load(state.otherScope),persisted(state.second));
    assert.deepEqual(store.load(state.outsider),persisted(state.foreign));
  }
});

test('M4 startup rejects recycling a historically journaled epoch even when no current Session uses it',async t=>{
  const f=await fixture(t);const store=f.open();const state=seedProjectSessions(store);
  const first=recoveredRotation(state);
  store.rotateRecoveredEpochs(first);
  const reverse={sessions:first.sessions.map((item,index)=>({
    ...item,previousEpoch:item.nextEpoch,
    nextEpoch:index===0 ? epoch : [
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'][index],
    expectedChecksum:store.load(item.scope).checksum,
  }))};
  expectStoreError(()=>store.rotateRecoveredEpochs(reverse),'EPOCH_CONFLICT');
  assert.equal(store.load(scope).epoch,first.sessions[0].nextEpoch);
  assert.equal(store.load(state.otherScope).epoch,first.sessions[1].nextEpoch);
  assert.deepEqual(store.findOperation(lookup(1)).result,operation(1).result);
});

test('M4 startup epoch batch survives process SIGKILL before ACK as all-new Session epochs',async t=>{
  const f=await fixture(t);const store=f.open();const state=seedProjectSessions(store);
  const rotation=recoveredRotation(state);
  store.close();
  const moduleUrl=new URL('../src/durable-session-store.mjs',import.meta.url).href;
  const source=`
    import { openDurableSessionStore } from ${JSON.stringify(moduleUrl)};
    const store=openDurableSessionStore({filePath:process.argv[1]});
    store.rotateRecoveredEpochs(JSON.parse(process.argv[2]));
    process.send({phase:'all-epochs-committed'});
    setInterval(()=>{},1000);
  `;
  const {child,phase,exited}=await childAtPhase(t,source,[f.filePath,JSON.stringify(rotation)]);
  assert.deepEqual(phase,{phase:'all-epochs-committed'});
  child.kill('SIGKILL');
  await exited;
  const recovered=f.open();
  for(const item of rotation.sessions)
    assert.equal(recovered.load(item.scope).epoch,item.nextEpoch);
  assert.deepEqual(recovered.findOperation(lookup(1)).result,operation(1).result);
  expectStoreError(()=>recovered.rotateRecoveredEpochs(rotation),'REVISION_CONFLICT');
});


test('M4->M5 signed checkpoint batch refuses reused historical operation epoch without rewriting any Session',async t=>{
  const f=await fixture(t);const store=f.open();const state=seedProjectSessions(store);
  const historic=state.first;
  const intermediate='ffffffff-ffff-4fff-8fff-ffffffffffff';
  const moved=store.commit({scope,epoch:intermediate,previousEpoch:epoch,
    baseRevision:historic.revision,revision:historic.revision,
    checkpoint:historic.checkpoint,operation:null});
  state.migration.sessions[0].previousEpoch=intermediate;
  state.migration.sessions[0].nextEpoch=epoch;
  state.migration.sessions[0].expectedChecksum=moved.checksum;
  expectStoreError(()=>store.transitionProjectCheckpoints(state.migration),'EPOCH_CONFLICT');
  assert.deepEqual(store.load(scope),persisted(moved));
  assert.deepEqual(store.load(state.otherScope),persisted(state.second));
  assert.equal(store.findOperation(lookup(1)).epoch,epoch);
  store.close();
  const reopened=f.open();
  assert.deepEqual(reopened.load(scope),persisted(moved));
  assert.equal(reopened.findOperation(lookup(1)).revision,1);
});
