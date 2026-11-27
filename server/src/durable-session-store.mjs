import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { types } from 'node:util';
import {captureGuestRoster,validateCapturedGuestRoster,validateStoredGuestEvidence,
  validateHistoricalGuestEvidence,transitionJournalBinding} from './project-transition-guest-evidence.mjs';

const SCHEMA_VERSION = 2;
// The v1 checkpoint and operation receipt checksum domain is intentionally
// unchanged across the SQLite schema migration. Otherwise every recovered
// edit/receipt from a prior release would fail checksum verification.
const RECORD_FORMAT_VERSION = 1;
const APPLICATION_ID = 0x54465247;
const require = createRequire(import.meta.url);
const SCOPE_COLUMNS = 'project_id = ? AND session_id = ? AND project_uuid = ?';

export class DurableSessionStoreError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'DurableSessionStoreError';
    this.code = code;
  }
}

function refuse(code, message) {
  throw new DurableSessionStoreError(code, message);
}

function integer(value, name, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    refuse('INVALID_INPUT', `Invalid ${name}.`);
  return value;
}

function identity(value, name, maximum = 256) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum ||
      value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value) || !value.isWellFormed())
    refuse('INVALID_INPUT', `Invalid ${name}.`);
  return value;
}

function scopeOf(value) {
  if (!value || typeof value !== 'object' || types.isProxy(value))
    refuse('INVALID_INPUT', 'Invalid durable session scope.');
  const fields = ['projectId', 'sessionId', 'projectUuid'];
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== fields.length || fields.some(key =>
    !Object.hasOwn(descriptors, key) || !Object.hasOwn(descriptors[key], 'value')))
    refuse('INVALID_INPUT', 'Invalid durable session scope.');
  return Object.fromEntries(fields.map(key => [key, identity(descriptors[key].value, key)]));
}

function scopeArgs(scope) {
  return [scope.projectId, scope.sessionId, scope.projectUuid];
}

// Do not call toJSON or access getters supplied by application or network state.
// This format is deliberately narrower than JSON.stringify's coercion rules.
function canonical(value, maximumBytes) {
  let bytes = 0;
  let nodes = 0;
  const chunks = [];
  const ancestors = new Set();
  function append(text) {
    bytes += Buffer.byteLength(text);
    if (bytes > maximumBytes) refuse('INVALID_INPUT', 'Durable data exceeds its byte limit.');
    chunks.push(text);
  }
  function visit(item, depth) {
    if (++nodes > 250_000 || depth > 64)
      refuse('INVALID_INPUT', 'Durable data exceeds its structural limit.');
    if (typeof item === 'string' && item.length > maximumBytes - bytes)
      refuse('INVALID_INPUT', 'Durable data exceeds its byte limit.');
    if (item === null || typeof item === 'boolean' || typeof item === 'string') {
      append(JSON.stringify(item));
      return;
    }
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) refuse('INVALID_INPUT', 'Durable numbers must be finite.');
      append(JSON.stringify(item));
      return;
    }
    if (!item || typeof item !== 'object' || types.isProxy(item) || ancestors.has(item))
      refuse('INVALID_INPUT', 'Durable data must contain only acyclic plain JSON values.');
    const array = Array.isArray(item);
    const prototype = Object.getPrototypeOf(item);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)
      refuse('INVALID_INPUT', 'Durable data must contain only plain objects and arrays.');
    const keys = Reflect.ownKeys(item);
    if (keys.length > 250_000 || keys.some(key => typeof key !== 'string'))
      refuse('INVALID_INPUT', 'Invalid durable object keys.');
    if (array && (item.length > 250_000 || keys.length !== item.length + 1))
      refuse('INVALID_INPUT', 'Durable arrays must be dense and contain no extra properties.');
    const descriptors = Object.getOwnPropertyDescriptors(item);
    const ordered = array ? Array.from({ length: item.length }, (_, index) => String(index)) : keys.sort();
    ancestors.add(item);
    append(array ? '[' : '{');
    for (let index = 0; index < ordered.length; index += 1) {
      const key = ordered[index];
      const descriptor = descriptors[key];
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable)
        refuse('INVALID_INPUT', 'Durable data cannot contain accessors or hidden properties.');
      if (index > 0) append(',');
      if (!array) {
        if (key.length > maximumBytes - bytes)
          refuse('INVALID_INPUT', 'Durable data exceeds its byte limit.');
        append(JSON.stringify(key)); append(':');
      }
      visit(descriptor.value, depth + 1);
    }
    append(array ? ']' : '}');
    ancestors.delete(item);
  }
  visit(value, 0);
  return chunks.join('');
}

function digest(kind, metadata, json) {
  return createHash('sha256').update(`teamforge-durable-${kind}-v1\n`)
    .update(canonical(metadata, 128 * 1024)).update('\n').update(json).digest('hex');
}

function checkpointChecksum(scope, epoch, revision, json) {
  return digest('checkpoint', { schemaVersion: RECORD_FORMAT_VERSION, scope, epoch, revision }, json);
}

function operationChecksum(row) {
  return digest('operation', {
    schemaVersion: RECORD_FORMAT_VERSION,
    scope: { projectId: row.project_id, sessionId: row.session_id, projectUuid: row.project_uuid },
    epoch: row.epoch, operationId: row.operation_id, userId: row.user_id,
    fingerprint: row.fingerprint, baseRevision: row.base_revision,
    revision: row.revision, checkpointChecksum: row.checkpoint_checksum,
  }, row.result_json);
}

function checkPath(filePath, readOnly = false) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || filePath.includes('\0') ||
      path.normalize(filePath) !== filePath || path.basename(filePath) === path.parse(filePath).root)
    refuse('INVALID_INPUT', 'The durable database requires an absolute normalized file path.');
  const parent = path.dirname(filePath);
  let current = path.parse(parent).root;
  for (const part of parent.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const entry = lstatSync(current);
      if (entry.isSymbolicLink() || !entry.isDirectory())
        refuse('STORAGE_ERROR', 'The durable database parent must be a real directory.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (readOnly) refuse('STORAGE_ERROR', 'Read-only inspection requires an existing real database directory.');
      mkdirSync(current, { mode: 0o700 });
    }
  }
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try {
      const entry = lstatSync(`${filePath}${suffix}`);
      if (entry.isSymbolicLink() || !entry.isFile() || entry.nlink !== 1)
        refuse('STORAGE_ERROR', 'The durable database and sidecars must be regular files without aliases.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

const LEGACY_SCHEMA = `
CREATE TABLE session_checkpoints (
  project_id TEXT NOT NULL, session_id TEXT NOT NULL, project_uuid TEXT NOT NULL,
  epoch TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision >= 0),
  checkpoint_json TEXT NOT NULL, checksum TEXT NOT NULL,
  PRIMARY KEY(project_id, session_id, project_uuid), UNIQUE(project_id, session_id)
) STRICT;
CREATE TABLE operation_results (
  project_id TEXT NOT NULL, session_id TEXT NOT NULL, project_uuid TEXT NOT NULL,
  epoch TEXT NOT NULL, operation_id TEXT NOT NULL, user_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL, base_revision INTEGER NOT NULL CHECK(base_revision >= 0),
  revision INTEGER NOT NULL CHECK(revision = base_revision + 1),
  result_json TEXT NOT NULL, checkpoint_checksum TEXT NOT NULL, checksum TEXT NOT NULL,
  PRIMARY KEY(project_id, session_id, project_uuid, epoch, operation_id),
  FOREIGN KEY(project_id, session_id, project_uuid)
    REFERENCES session_checkpoints(project_id, session_id, project_uuid)
) STRICT;`;

// The transition and backup belong to the SAME SQLite transaction as every
// M4 -> M5 Session checkpoint. No half-migrated Session set is acknowledged.
// The transition journal remains intentionally unresolved until a future
// Publisher/Host/Guest cross-store reconciliation verifies exact saved bytes.
const TRANSITION_SCHEMA = `
CREATE TABLE project_transition_journal (
  project_id TEXT PRIMARY KEY NOT NULL,
  project_uuid TEXT NOT NULL,
  transition_id TEXT NOT NULL UNIQUE,
  journal_json TEXT NOT NULL,
  checksum TEXT NOT NULL
) STRICT;
CREATE TABLE transition_checkpoint_backups (
  project_id TEXT NOT NULL, session_id TEXT NOT NULL, project_uuid TEXT NOT NULL,
  epoch TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision >= 0),
  checkpoint_json TEXT NOT NULL, checksum TEXT NOT NULL,
  PRIMARY KEY(project_id, session_id),
  FOREIGN KEY(project_id) REFERENCES project_transition_journal(project_id) ON DELETE RESTRICT
) STRICT;`;
const CREATE_SCHEMA = `${LEGACY_SCHEMA}\n${TRANSITION_SCHEMA}`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const HASH_RE = /^[a-f0-9]{64}$/u;
const MAX_TRANSITION_JOURNAL_BYTES = 2 * 1024 * 1024;

/** Synchronous SQLite owner. Open only when durable mode is enabled by the caller. */
export function openDurableSessionStore(options = {}) {
  const filePath = options.filePath;
  const readOnly = options.readOnly === true;
  if (options.readOnly !== undefined && typeof options.readOnly !== 'boolean')
    refuse('INVALID_INPUT','Read-only mode must be a boolean.');
  const maxCheckpointBytes = integer(options.maxCheckpointBytes ?? 2 * 1024 * 1024,
    'checkpoint byte limit', 128, 64 * 1024 * 1024);
  const maxResultBytes = integer(options.maxResultBytes ?? 1024 * 1024,
    'result byte limit', 128, 64 * 1024 * 1024);
  const maxDatabaseBytes = integer(options.maxDatabaseBytes ?? 1024 * 1024 * 1024,
    'database byte limit', 32768, 64 * 1024 * 1024 * 1024);
  const maxSessions = integer(options.maxSessions ?? 128, 'session limit', 1, 4096);
  let db;
  let closed = false;
  try {
    checkPath(filePath,readOnly);
    let fresh = false;
    if (!readOnly) {
      try { const fd = openSync(filePath, 'wx', 0o600); closeSync(fd); fresh = true; }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(filePath,readOnly ? {readOnly:true} : {});
    db.exec('PRAGMA busy_timeout=100; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;');
    if (readOnly) db.exec('PRAGMA query_only=ON;');
    if (fresh) {
      db.exec(`BEGIN IMMEDIATE; ${CREATE_SCHEMA}
        PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=${SCHEMA_VERSION}; COMMIT;`);
    } else {
      const version = db.prepare('PRAGMA user_version').get().user_version;
      const application = db.prepare('PRAGMA application_id').get().application_id;
      if (![1,SCHEMA_VERSION].includes(version) || application !== APPLICATION_ID)
        refuse('SCHEMA_MISMATCH', 'Unsupported durable database schema; the existing file was preserved.');
      const definitions = db.prepare("SELECT name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
      const reference = new DatabaseSync(':memory:');
      let expected;
      try {
        reference.exec(version === 1 ? LEGACY_SCHEMA : CREATE_SCHEMA);
        expected = reference.prepare("SELECT name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
      } finally { reference.close(); }
      if (JSON.stringify(definitions) !== JSON.stringify(expected))
        refuse('SCHEMA_MISMATCH', 'Durable database definitions do not match this schema version.');
      if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok')
        refuse('INTEGRITY_ERROR', 'Durable database integrity validation failed.');
      if (version === 1 && readOnly)
        refuse('UPGRADE_REQUIRED','Read-only inspection requires durable SQLite schema v2; the database was not changed.');
      if (version === 1) {
        // Upgrade only a verified v1 database; keep old checkpoint/receipt
        // checksum domains intact. SQLite rollback also reverts user_version.
        let migrating = false;
        try {
          db.exec('BEGIN IMMEDIATE;'); migrating = true;
          db.exec(`${TRANSITION_SCHEMA}\nPRAGMA user_version=${SCHEMA_VERSION};`);
          db.exec('COMMIT;'); migrating = false;
        } catch (error) {
          if (migrating) {
            try { db.exec('ROLLBACK;'); } catch { /* Fail opening closed. */ }
          }
          throw error;
        }
      }
    }
    // One process owns a durable authority. SQLite releases this lock after a crash.
    if (!readOnly)
      db.exec('PRAGMA locking_mode=EXCLUSIVE; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA wal_autocheckpoint=256;');
    const pageSize = db.prepare('PRAGMA page_size').get().page_size;
    const pageLimit = Math.floor(maxDatabaseBytes / pageSize);
    if (readOnly) {
      if (db.prepare('PRAGMA page_count').get().page_count > pageLimit)
        refuse('STORAGE_ERROR','The inspected database exceeds the configured byte budget.');
      // Hold one consistent SQLite snapshot while verifying the journal and
      // backup set. Does not acquire a write lock or run WAL checkpoints.
      db.exec('BEGIN;');
    } else {
      if (db.prepare(`PRAGMA max_page_count=${pageLimit}`).get().max_page_count > pageLimit)
        refuse('STORAGE_ERROR', 'The durable database exceeds the configured page budget.');
      db.exec('BEGIN EXCLUSIVE; COMMIT;');
    }
  } catch (error) {
    try { db?.close(); } catch { /* Preserve the original opening failure. */ }
    if (error instanceof DurableSessionStoreError) throw error;
    throw new DurableSessionStoreError('STORAGE_ERROR', 'Unable to open the durable database.', error);
  }

  function ready() {
    if (closed) refuse('CLOSED', 'The durable database is closed.');
  }

  function checkpointRow(scope) {
    const row = db.prepare(`SELECT project_id, session_id, project_uuid, epoch, revision, checksum,
      length(CAST(checkpoint_json AS BLOB)) AS bytes,
      CASE WHEN length(CAST(checkpoint_json AS BLOB)) <= ? THEN checkpoint_json END AS checkpoint_json
      FROM session_checkpoints WHERE project_id = ? AND session_id = ?`).get(
      maxCheckpointBytes, scope.projectId, scope.sessionId);
    if (row && row.project_uuid !== scope.projectUuid)
      refuse('SCOPE_CONFLICT', 'The durable session belongs to a different project identity.');
    return row;
  }

  function decodeCheckpoint(row) {
    if (!row) return null;
    try {
      const scope = scopeOf({ projectId: row.project_id, sessionId: row.session_id, projectUuid: row.project_uuid });
      identity(row.epoch, 'stored epoch');
      integer(row.revision, 'stored revision');
      if (typeof row.checkpoint_json !== 'string' || row.bytes > maxCheckpointBytes)
        refuse('INTEGRITY_ERROR', 'Stored checkpoint exceeds its byte limit.');
      const checkpoint = JSON.parse(row.checkpoint_json);
      if (canonical(checkpoint, maxCheckpointBytes) !== row.checkpoint_json ||
          checkpointChecksum(scope, row.epoch, row.revision, row.checkpoint_json) !== row.checksum)
        refuse('INTEGRITY_ERROR', 'Stored checkpoint checksum validation failed.');
      return { scope, epoch: row.epoch, revision: row.revision, checkpoint, checksum: row.checksum };
    } catch (error) {
      if (error instanceof DurableSessionStoreError && error.code === 'INTEGRITY_ERROR') throw error;
      throw new DurableSessionStoreError('INTEGRITY_ERROR', 'Stored checkpoint is malformed.', error);
    }
  }

  function operationRow(scope, epoch, operationId) {
    return db.prepare(`SELECT project_id, session_id, project_uuid, epoch, operation_id, user_id,
      fingerprint, base_revision, revision, checkpoint_checksum, checksum,
      length(CAST(result_json AS BLOB)) AS bytes,
      CASE WHEN length(CAST(result_json AS BLOB)) <= ? THEN result_json END AS result_json
      FROM operation_results WHERE ${SCOPE_COLUMNS} AND epoch = ? AND operation_id = ?`).get(
      maxResultBytes, ...scopeArgs(scope), epoch, operationId);
  }

  function decodeOperation(row) {
    if (!row) return null;
    try {
      const scope = scopeOf({ projectId: row.project_id, sessionId: row.session_id, projectUuid: row.project_uuid });
      identity(row.epoch, 'stored epoch'); identity(row.operation_id, 'stored operation');
      identity(row.user_id, 'stored user'); identity(row.fingerprint, 'stored fingerprint', 32768);
      integer(row.base_revision, 'stored base revision'); integer(row.revision, 'stored revision', 1);
      if (row.revision !== row.base_revision + 1 || !/^[a-f0-9]{64}$/u.test(row.checkpoint_checksum) ||
          typeof row.result_json !== 'string' || row.bytes > maxResultBytes)
        refuse('INTEGRITY_ERROR', 'Stored operation identity is malformed.');
      const result = JSON.parse(row.result_json);
      if (canonical(result, maxResultBytes) !== row.result_json || operationChecksum(row) !== row.checksum)
        refuse('INTEGRITY_ERROR', 'Stored operation checksum validation failed.');
      return { scope, epoch: row.epoch, operationId: row.operation_id, userId: row.user_id,
        fingerprint: row.fingerprint, baseRevision: row.base_revision, revision: row.revision,
        result, checkpointChecksum: row.checkpoint_checksum };
    } catch (error) {
      if (error instanceof DurableSessionStoreError && error.code === 'INTEGRITY_ERROR') throw error;
      throw new DurableSessionStoreError('INTEGRITY_ERROR', 'Stored operation is malformed.', error);
    }
  }

  function storageCall(action) {
    ready();
    try { return action(); }
    catch (error) {
      if (error instanceof DurableSessionStoreError) throw error;
      throw new DurableSessionStoreError('STORAGE_ERROR', 'The durable database operation failed.', error);
    }
  }

  function journalRecord(projectId) {
    return db.prepare(`SELECT project_id,project_uuid,transition_id,checksum,
      length(CAST(journal_json AS BLOB)) AS bytes,
      CASE WHEN length(CAST(journal_json AS BLOB)) <= ? THEN journal_json END AS journal_json
      FROM project_transition_journal WHERE project_id=?`).get(MAX_TRANSITION_JOURNAL_BYTES,projectId);
  }

  function verifyTransitionJournal(row) {
    if (!row) return null;
    try {
      const projectId = identity(row.project_id,'journal Project ID',128);
      const projectUuid = identity(row.project_uuid,'journal Project UUID',128);
      if (!UUID_RE.test(projectUuid) || !HASH_RE.test(row.checksum) ||
          typeof row.journal_json !== 'string' || row.bytes > MAX_TRANSITION_JOURNAL_BYTES)
        refuse('INTEGRITY_ERROR','Invalid Project transition journal identity.');
      const record = JSON.parse(row.journal_json);
      if (canonical(record,MAX_TRANSITION_JOURNAL_BYTES) !== row.journal_json ||
          digest('transition-journal',{projectId,projectUuid},row.journal_json) !== row.checksum ||
          record?.version !== 1 || record.projectId !== projectId || record.projectUuid !== projectUuid ||
          record.transitionId !== row.transition_id || !UUID_RE.test(record.transitionId) ||
          !['sqlite_committed','sqlite_rolled_back'].includes(record.stage) ||
          !HASH_RE.test(record.previousDescriptorHash) || !HASH_RE.test(record.candidateDescriptorHash) ||
          !HASH_RE.test(record.previousManifestHash) || !HASH_RE.test(record.candidateManifestHash) ||
          !Number.isSafeInteger(record.previousBaselineRevision) || record.previousBaselineRevision < 1 ||
          record.candidateBaselineRevision !== record.previousBaselineRevision + 1 ||
          !Number.isSafeInteger(record.sessionCount) || record.sessionCount < 1 ||
          record.sessionCount > maxSessions || !Array.isArray(record.sessions) ||
          record.sessions.length !== record.sessionCount)
        refuse('INTEGRITY_ERROR','Invalid Project transition journal checksum or fields.');
      const backups = db.prepare(`SELECT project_id,session_id,project_uuid,epoch,revision,checksum,
        length(CAST(checkpoint_json AS BLOB)) AS bytes,
        CASE WHEN length(CAST(checkpoint_json AS BLOB)) <= ? THEN checkpoint_json END AS checkpoint_json
        FROM transition_checkpoint_backups WHERE project_id=? ORDER BY session_id LIMIT ?`)
        .all(maxCheckpointBytes,projectId,maxSessions+1);
      const migrated = db.prepare(`SELECT session_id, project_uuid FROM session_checkpoints
        WHERE project_id=? ORDER BY session_id LIMIT ?`).all(projectId,maxSessions+1);
      if (backups.length !== record.sessionCount || migrated.length !== record.sessionCount ||
          backups.some((item,index)=>item.session_id !== migrated[index].session_id ||
            item.project_uuid !== projectUuid || migrated[index].project_uuid !== projectUuid))
        refuse('INTEGRITY_ERROR','Project transition backup Session set is incomplete.');
      const rolledBack = record.stage === 'sqlite_rolled_back';
      const priorEpochs = new Set(record.sessions.flatMap(item=>[item?.previousEpoch,item?.nextEpoch]));
      const rollbackEpochs = new Set();
      for (let i=0;i<backups.length;i++) {
        const backup = backups[i];
        const entry = record.sessions[i];
        if (!entry || entry.sessionId !== backup.session_id ||
            !UUID_RE.test(entry.previousEpoch) || !UUID_RE.test(entry.nextEpoch) ||
            !HASH_RE.test(entry.previousChecksum) || !HASH_RE.test(entry.nextChecksum) ||
            !Number.isSafeInteger(entry.revision) || entry.revision !== backup.revision ||
            entry.previousEpoch !== backup.epoch || entry.previousChecksum !== backup.checksum)
          refuse('INTEGRITY_ERROR','Project transition Session cursor list is corrupted.');
        const scope = scopeOf({projectId,sessionId:backup.session_id,projectUuid});
        identity(backup.epoch,'backup epoch');
        integer(backup.revision,'backup revision');
        if (typeof backup.checkpoint_json !== 'string' || backup.bytes > maxCheckpointBytes ||
            !HASH_RE.test(backup.checksum) ||
            canonical(JSON.parse(backup.checkpoint_json),maxCheckpointBytes) !== backup.checkpoint_json ||
            checkpointChecksum(scope,backup.epoch,backup.revision,backup.checkpoint_json) !== backup.checksum)
          refuse('INTEGRITY_ERROR','Project transition backup checkpoint changed.');
        const old = JSON.parse(backup.checkpoint_json);
        if (old.version !== 1 || old.project?.descriptorHash !== record.previousDescriptorHash ||
            old.project?.manifestHash !== record.previousManifestHash ||
            old.project?.baselineRevision !== record.previousBaselineRevision)
          refuse('INTEGRITY_ERROR','Project transition backup has the wrong signed source.');
        const current = decodeCheckpoint(checkpointRow(scope));
        if (Object.hasOwn(record,'guestRoster'))
          validateCapturedGuestRoster(record.guestRoster,old.project,current?.checkpoint?.project,record.stage);
        if (rolledBack) {
          if (!UUID_RE.test(entry.rollbackEpoch ?? '') || priorEpochs.has(entry.rollbackEpoch) ||
              rollbackEpochs.has(entry.rollbackEpoch) || !HASH_RE.test(entry.rollbackChecksum ?? '') ||
              checkpointChecksum(scope,entry.rollbackEpoch,backup.revision,backup.checkpoint_json)!==entry.rollbackChecksum ||
              !current || current.epoch!==entry.rollbackEpoch || current.revision!==backup.revision ||
              current.checksum!==entry.rollbackChecksum ||
              canonical(current.checkpoint,maxCheckpointBytes)!==backup.checkpoint_json)
            refuse('INTEGRITY_ERROR','Rolled-back Session differs from its exact original backup.');
          rollbackEpochs.add(entry.rollbackEpoch);
        } else if (Object.hasOwn(entry,'rollbackEpoch') || Object.hasOwn(entry,'rollbackChecksum') ||
            !current || current.revision !== backup.revision ||
            current.epoch !== entry.nextEpoch || current.checksum !== entry.nextChecksum ||
            current.checkpoint.project?.descriptorHash !== record.candidateDescriptorHash ||
            current.checkpoint.project?.manifestHash !== record.candidateManifestHash ||
            current.checkpoint.project?.baselineRevision !== record.candidateBaselineRevision)
          refuse('INTEGRITY_ERROR','Project transition journal disagrees with the current signed checkpoint.');
        // A transition never admitted operations in either the unapproved
        // candidate generation or the quarantined rollback generation.
        const receiptInEpoch=db.prepare(`SELECT 1 FROM operation_results WHERE
          ${SCOPE_COLUMNS} AND epoch=? LIMIT 1`);
        if (receiptInEpoch.get(...scopeArgs(scope),entry.nextEpoch) ||
            (rolledBack && receiptInEpoch.get(...scopeArgs(scope),entry.rollbackEpoch)))
          refuse('INTEGRITY_ERROR','Unapproved transition generation contains an accepted operation.');
      }
      validateStoredGuestEvidence(record);
      return record;
    } catch (error) {
      if (error instanceof DurableSessionStoreError && error.code === 'INTEGRITY_ERROR') throw error;
      throw new DurableSessionStoreError('INTEGRITY_ERROR','Stored transition journal is malformed.',error);
    }
  }

  function refusePendingTransition(projectId = null) {
    const row = projectId == null
      ? db.prepare('SELECT 1 FROM project_transition_journal LIMIT 1').get()
      : db.prepare('SELECT 1 FROM project_transition_journal WHERE project_id=?').get(projectId);
    if (row) refuse('TRANSITION_RECOVERY_REQUIRED',
      'An unresolved Project Baseline transition requires source and pointer reconciliation before edits resume.');
  }

  const store = {
    listProjectTransitionJournals() {
      return storageCall(() => {
        const rows = db.prepare(`SELECT project_id,project_uuid,transition_id,checksum,
          length(CAST(journal_json AS BLOB)) AS bytes,
          CASE WHEN length(CAST(journal_json AS BLOB)) <= ? THEN journal_json END AS journal_json
          FROM project_transition_journal ORDER BY project_id LIMIT ?`)
          .all(MAX_TRANSITION_JOURNAL_BYTES,maxSessions+1);
        if (rows.length > maxSessions)
          refuse('INTEGRITY_ERROR','Transition journals exceed the configured Session limit.');
        return rows.map(verifyTransitionJournal);
      });
    },
    // Historical, stage-specific full signature bundle. The trusted offline
    // Host caller must independently verify the actual Host pointer and stop
    // competing writers. This never resolves the transition or admits edits.
    recordGuestReconciliationEvidence(input) {
      return storageCall(() => {
        if (readOnly) refuse('READ_ONLY','Diagnostic SQLite snapshots cannot record Guest evidence.');
        const projectId=identity(input?.projectId,'Project ID',128);
        const transitionId=identity(input?.transitionId,'transition ID',64);
        const expectedBinding=identity(input?.expectedJournalHash,'journal binding',64);
        const stage=input?.stage;
        if (!UUID_RE.test(transitionId)||!HASH_RE.test(expectedBinding)||
            !['sqlite_committed','sqlite_rolled_back'].includes(stage))
          refuse('INVALID_INPUT','Exact transition stage and binding are required.');
        // Snapshot the data before BEGIN; bound it using existing canonical
        // journal serialization, never caller getters or mutable objects.
        const evidence=JSON.parse(canonical(input.evidence,MAX_TRANSITION_JOURNAL_BYTES));
        let transaction=false;
        try {
          db.exec('BEGIN IMMEDIATE;'); transaction=true;
          const row=journalRecord(projectId);
          const journal=verifyTransitionJournal(row);
          if (!journal||journal.transitionId!==transitionId||journal.stage!==stage||
              !journal.guestRoster||transitionJournalBinding(journal)!==expectedBinding)
            refuse('TRANSITION_CONFLICT','No exact pending transition with a captured Guest roster matches.');
          try { validateHistoricalGuestEvidence(journal,stage,evidence); }
          catch { refuse('INVALID_INPUT','Complete signed Guest evidence does not match this transition.'); }
          const existing=journal.guestReconciliationEvidence?.[stage];
          const outcome={status:'guest_evidence_recorded',transitionId,stage,
            confirmedCount:evidence.receipts.length,editorResumePermitted:false,journalResolutionPermitted:false};
          if(existing){
            if(canonical(existing,MAX_TRANSITION_JOURNAL_BYTES)!==canonical(evidence,MAX_TRANSITION_JOURNAL_BYTES))
              refuse('TRANSITION_CONFLICT','This stage already retains a different verified historical bundle.');
            db.exec('COMMIT;'); transaction=false;
            return {...outcome,replayed:true};
          }
          const now=Date.now();
          if(!Number.isSafeInteger(now)||now<evidence.verifiedAtUnixMs||
              now>evidence.challenge.body.expiresAtUnixMs)
            refuse('TRANSITION_CONFLICT','New evidence must be recorded within its signed validity window.');
          journal.guestReconciliationEvidence={...journal.guestReconciliationEvidence,[stage]:evidence};
          const json=canonical(journal,MAX_TRANSITION_JOURNAL_BYTES);
          const checksum=digest('transition-journal',{projectId,projectUuid:journal.projectUuid},json);
          if(db.prepare(`UPDATE project_transition_journal SET journal_json=?,checksum=?
              WHERE project_id=? AND transition_id=? AND checksum=?`)
            .run(json,checksum,projectId,transitionId,row.checksum).changes!==1)
            refuse('TRANSITION_CONFLICT','The Project journal changed before recording evidence.');
          verifyTransitionJournal(journalRecord(projectId));
          db.exec('COMMIT;'); transaction=false;
          return {...outcome,replayed:false};
        } catch(error){
          if(transaction){
            try {db.exec('ROLLBACK;');}
            catch(rollbackError){
              if(!String(rollbackError.message).includes('no transaction is active')){
                try {db.close();} finally {closed=true;}
              }
            }
          }
          throw error;
        }
      });
    },
    readProjectTransitionBackup({projectId,sessionId}) {
      return storageCall(() => {
        const project = identity(projectId,'Project ID',128);
        const session = identity(sessionId,'Session ID',256);
        if (!verifyTransitionJournal(journalRecord(project))) return null;
        const row = db.prepare(`SELECT project_id,session_id,project_uuid,epoch,revision,checksum,
          length(CAST(checkpoint_json AS BLOB)) AS bytes,
          CASE WHEN length(CAST(checkpoint_json AS BLOB)) <= ? THEN checkpoint_json END AS checkpoint_json
          FROM transition_checkpoint_backups WHERE project_id=? AND session_id=?`)
          .get(maxCheckpointBytes,project,session);
        return row ? Object.freeze({scope:{projectId:project,sessionId:session,projectUuid:row.project_uuid},
          epoch:row.epoch,revision:row.revision,checksum:row.checksum,
          checkpoint:JSON.parse(row.checkpoint_json)}) : null;
      });
    },
    // Storage-only rollback. No live Coordinator, Host or Guest authority
    // may resume from this call. Keep the journal as a durable recovery fence
    // even after all M4 checkpoint bytes are restored in a new generation.
    get readOnly() { return readOnly; },
    rollbackProjectTransitionCheckpoints(input) {
      return storageCall(() => {
        if (readOnly) refuse('READ_ONLY','Diagnostic SQLite snapshots cannot roll back transitions.');
        const projectId=identity(input?.projectId,'Project ID',128);
        const projectUuid=identity(input?.projectUuid,'Project UUID',128);
        const transitionId=identity(input?.transitionId,'transition ID',64);
        const previousDescriptorHash=identity(input?.previousDescriptorHash,'previous descriptor hash',64);
        const candidateDescriptorHash=identity(input?.candidateDescriptorHash,'candidate descriptor hash',64);
        if (!UUID_RE.test(projectUuid) || !UUID_RE.test(transitionId) ||
            !HASH_RE.test(previousDescriptorHash) || !HASH_RE.test(candidateDescriptorHash))
          refuse('INVALID_INPUT','A complete exact rollback journal identity is required.');
        let transaction=false;
        try {
          db.exec('BEGIN IMMEDIATE;'); transaction=true;
          const journal=verifyTransitionJournal(journalRecord(projectId));
          if (!journal || journal.projectUuid!==projectUuid || journal.transitionId!==transitionId ||
              journal.previousDescriptorHash!==previousDescriptorHash ||
              journal.candidateDescriptorHash!==candidateDescriptorHash)
            refuse('TRANSITION_CONFLICT','No exact pending Project transition matches the rollback request.');
          const outcome={projectId,projectUuid,transitionId,stage:'sqlite_rolled_back',
            descriptorHash:previousDescriptorHash,sessionCount:journal.sessionCount,
            editorResumePermitted:false,revisionPreserved:true};
          if (journal.stage==='sqlite_rolled_back') {
            db.exec('COMMIT;'); transaction=false;
            return {...outcome,replayed:true};
          }
          const oldEpochs=new Set([
            ...db.prepare('SELECT epoch FROM session_checkpoints').all().map(row=>row.epoch),
            ...journal.sessions.flatMap(entry=>[entry.previousEpoch,entry.nextEpoch]),
          ]);
          const receipt=db.prepare(`SELECT 1 FROM operation_results WHERE
            ${SCOPE_COLUMNS} AND epoch=? LIMIT 1`);
          const update=db.prepare(`UPDATE session_checkpoints SET epoch=?,checkpoint_json=?,checksum=?
            WHERE ${SCOPE_COLUMNS} AND epoch=? AND revision=? AND checksum=?`);
          const backup=db.prepare(`SELECT checkpoint_json FROM transition_checkpoint_backups
            WHERE project_id=? AND session_id=? AND project_uuid=?`);
          for (const entry of journal.sessions) {
            const scope={projectId,sessionId:entry.sessionId,projectUuid};
            const saved=backup.get(...scopeArgs(scope));
            const fresh=randomUUID();
            if (!saved || oldEpochs.has(fresh) || receipt.get(...scopeArgs(scope),fresh))
              refuse('EPOCH_CONFLICT','Cannot assign a fresh rollback generation.');
            oldEpochs.add(fresh);
            const checksum=checkpointChecksum(scope,fresh,entry.revision,saved.checkpoint_json);
            if (update.run(fresh,saved.checkpoint_json,checksum,...scopeArgs(scope),
                entry.nextEpoch,entry.revision,entry.nextChecksum).changes!==1)
              refuse('REVISION_CONFLICT','A candidate Session changed before rollback.');
            entry.rollbackEpoch=fresh;
            entry.rollbackChecksum=checksum;
          }
          journal.stage='sqlite_rolled_back';
          const json=canonical(journal,MAX_TRANSITION_JOURNAL_BYTES);
          const checksum=digest('transition-journal',{projectId,projectUuid},json);
          if (db.prepare(`UPDATE project_transition_journal SET journal_json=?,checksum=?
                WHERE project_id=? AND project_uuid=? AND transition_id=?`)
              .run(json,checksum,projectId,projectUuid,transitionId).changes!==1)
            refuse('TRANSITION_CONFLICT','The Project transition journal changed before rollback.');
          verifyTransitionJournal(journalRecord(projectId));
          db.exec('COMMIT;'); transaction=false;
          return {...outcome,replayed:false};
        } catch(error) {
          if (transaction) {
            try { db.exec('ROLLBACK;'); }
            catch (rollbackError) {
              if (!String(rollbackError.message).includes('no transaction is active')) {
                try { db.close(); } finally { closed=true; }
              }
            }
          }
          throw error;
        }
      });
    },
    load(scope) {
      return storageCall(() => decodeCheckpoint(checkpointRow(scopeOf(scope))));
    },
    loadAll() {
      return storageCall(() => {
        const scopes = db.prepare('SELECT project_id, session_id, project_uuid FROM session_checkpoints ORDER BY project_id, session_id LIMIT ?').all(maxSessions + 1);
        if (scopes.length > maxSessions) refuse('INTEGRITY_ERROR', 'Stored sessions exceed their configured limit.');
        return scopes.map(row => decodeCheckpoint(checkpointRow({ projectId: row.project_id,
          sessionId: row.session_id, projectUuid: row.project_uuid })));
      });
    },
    // Read-only admission check for a scope's FIRST checkpoint, so callers can
    // refuse a new Session before mutating any in-memory authority state.
    hasCapacityFor(input) {
      return storageCall(() => {
        const scope = scopeOf(input);
        if (checkpointRow(scope)) return true;
        return db.prepare('SELECT count(*) AS count FROM session_checkpoints').get().count < maxSessions;
      });
    },
    findOperation(input) {
      return storageCall(() => {
        const scope = scopeOf(input.scope);
        const epoch = identity(input.epoch, 'epoch');
        const operationId = identity(input.operationId, 'operation ID');
        const userId = identity(input.userId, 'user ID');
        const fingerprint = identity(input.fingerprint, 'operation fingerprint', 32768);
        decodeCheckpoint(checkpointRow(scope));
        const row = operationRow(scope, epoch, operationId);
        const result = decodeOperation(row);
        if (result && (result.userId !== userId || result.fingerprint !== fingerprint))
          refuse('OPERATION_CONFLICT', 'The operation identity has a different durable outcome.');
        return result;
      });
    },
    commit(input) {
      return storageCall(() => {
        if (readOnly) refuse('READ_ONLY','Diagnostic SQLite snapshots cannot modify durable Sessions.');
        const scope = scopeOf(input.scope);
        const epoch = identity(input.epoch, 'epoch');
        const baseRevision = integer(input.baseRevision, 'base revision');
        const revision = integer(input.revision, 'revision');
        const checkpointJson = canonical(input.checkpoint, maxCheckpointBytes);
        const checksum = checkpointChecksum(scope, epoch, revision, checkpointJson);
        const operation = input.operation ?? null;
        let nextOperation;
        if (operation !== null) {
          if (revision !== baseRevision + 1) refuse('REVISION_CONFLICT', 'An operation must advance exactly one revision.');
          nextOperation = { project_id: scope.projectId, session_id: scope.sessionId, project_uuid: scope.projectUuid,
            epoch, operation_id: identity(operation.operationId, 'operation ID'),
            user_id: identity(operation.userId, 'user ID'),
            fingerprint: identity(operation.fingerprint, 'operation fingerprint', 32768),
            base_revision: baseRevision, revision, result_json: canonical(operation.result, maxResultBytes),
            checkpoint_checksum: checksum };
          nextOperation.checksum = operationChecksum(nextOperation);
        }
        let transaction = false;
        try {
          db.exec('BEGIN IMMEDIATE;');
          transaction = true;
          refusePendingTransition(scope.projectId);
          const current = decodeCheckpoint(checkpointRow(scope));
          const prior = nextOperation && operationRow(scope, epoch, nextOperation.operation_id);
          if (prior) {
            decodeOperation(prior);
            if (prior.checksum !== nextOperation.checksum)
              refuse('OPERATION_CONFLICT', 'The operation identity has a different durable outcome.');
            db.exec('COMMIT;'); transaction = false;
            return { ...current, replayed: true, operationRevision: prior.revision };
          }
          if (current ? current.revision !== baseRevision : baseRevision !== 0)
            refuse('REVISION_CONFLICT', 'The durable revision changed before this checkpoint.');
          if (current && current.epoch !== epoch) {
            if (nextOperation || revision !== baseRevision || input.previousEpoch !== current.epoch)
              refuse('EPOCH_CONFLICT', 'Durable epoch rotation requires the exact previous epoch and an unchanged revision.');
          } else if (input.previousEpoch !== undefined) {
            refuse('EPOCH_CONFLICT', 'The requested durable epoch rotation does not match the current epoch.');
          }
          if (!nextOperation && (current ? revision !== baseRevision : revision !== 0 && revision !== 1))
            refuse('REVISION_CONFLICT', 'A checkpoint must retain its revision, except for the first seed.');
          // An expected quota refusal, NOT an unknown storage outcome: the
          // transaction is rolled back below and nothing was written.
          if (!current && db.prepare('SELECT count(*) AS count FROM session_checkpoints').get().count >= maxSessions)
            refuse('CAPACITY_EXCEEDED', 'The durable session limit has been reached.');
          db.prepare(`INSERT INTO session_checkpoints VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(project_id, session_id, project_uuid) DO UPDATE SET
            epoch=excluded.epoch, revision=excluded.revision,
            checkpoint_json=excluded.checkpoint_json, checksum=excluded.checksum`).run(
            ...scopeArgs(scope), epoch, revision, checkpointJson, checksum);
          if (nextOperation) db.prepare('INSERT INTO operation_results VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
            ...scopeArgs(scope), epoch, nextOperation.operation_id, nextOperation.user_id,
            nextOperation.fingerprint, baseRevision, revision, nextOperation.result_json, checksum,
            nextOperation.checksum);
          db.exec('COMMIT;'); transaction = false;
          return { scope, epoch, revision, checkpoint: JSON.parse(checkpointJson), checksum, replayed: false };
        } catch (error) {
          if (transaction) {
            try { db.exec('ROLLBACK;'); }
            catch (rollbackError) {
              // SQLITE_FULL may already have rolled the transaction back. If it has
              // not, do not let a caller publish or reuse a connection of uncertain state.
              if (!String(rollbackError.message).includes('no transaction is active')) {
                try { db.close(); } finally { closed = true; }
              }
            }
          }
          throw error;
        }
      });
    },
    // Rotate ALL restored M4 Session epochs before exposing ANY recovered
    // Session on Coordinator startup. Previous per-Session commits could
    // leave a partially rotated DB when the process died between rows. This
    // does not change the signed Project, checkpoint contents, accepted
    // revisions, or historical operation receipts. It is an internal call,
    // not an authorization to rotate a published M4 -> M5 Baseline.
    rotateRecoveredEpochs(input) {
      return storageCall(() => {
        if (readOnly) refuse('READ_ONLY','Diagnostic SQLite snapshots cannot rotate Session epochs.');
        if (!Array.isArray(input?.sessions) || input.sessions.length > maxSessions)
          refuse('INVALID_INPUT', 'Recovered Session rotation requires a bounded complete set.');
        const seen = new Set();
        const nextEpochs = new Set();
        const oldEpochs = new Set();
        const prepared = input.sessions.map(change => {
          const scope = scopeOf(change.scope);
          const key = JSON.stringify([scope.projectId, scope.sessionId]);
          const previousEpoch = identity(change.previousEpoch, 'previous epoch');
          const nextEpoch = identity(change.nextEpoch, 'next epoch');
          const revision = integer(change.revision, 'Session revision');
          const checksum = identity(change.expectedChecksum, 'checkpoint checksum', 64);
          if (seen.has(key) || previousEpoch === nextEpoch || nextEpochs.has(nextEpoch) ||
              !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(nextEpoch) ||
              !/^[a-f0-9]{64}$/u.test(checksum))
            refuse('EPOCH_CONFLICT', 'Recovered Session epochs and identities must be unique.');
          seen.add(key);
          nextEpochs.add(nextEpoch);
          oldEpochs.add(previousEpoch);
          return {scope, previousEpoch, nextEpoch, revision, checksum};
        });
        if ([...nextEpochs].some(value => oldEpochs.has(value)))
          refuse('EPOCH_CONFLICT', 'Recovered epochs cannot reuse any prior live epoch.');
        let transaction = false;
        try {
          db.exec('BEGIN IMMEDIATE;'); transaction = true;
          refusePendingTransition();
          // Include EVERY stored Session across Projects. A partial input must
          // never rotate the first Session and leave others on old authority.
          const storedScopes = db.prepare(`SELECT project_id, session_id, project_uuid
            FROM session_checkpoints ORDER BY project_id, session_id LIMIT ?`).all(maxSessions + 1);
          const expectedScopes = new Map(prepared.map(item =>
            [JSON.stringify([item.scope.projectId,item.scope.sessionId]),item.scope.projectUuid]));
          if (storedScopes.length !== prepared.length || storedScopes.some(row =>
              expectedScopes.get(JSON.stringify([row.project_id,row.session_id])) !== row.project_uuid))
            refuse('SESSION_SET_CONFLICT', 'Recovered Session membership changed before epoch rotation.');
          const pending = [];
          const historicReceipt = db.prepare(`SELECT 1 FROM operation_results WHERE
            ${SCOPE_COLUMNS} AND epoch = ? LIMIT 1`);
          for (const item of prepared) {
            const stored = checkpointRow(item.scope);
            const current = decodeCheckpoint(stored);
            if (!current || current.epoch !== item.previousEpoch ||
                current.revision !== item.revision || current.checksum !== item.checksum)
              refuse('REVISION_CONFLICT', 'Recovered Session checkpoint changed before epoch rotation.');
            // Even after multiple crashes, never recycle an epoch with old
            // accepted receipts: a delayed operation must not replay as new.
            if (historicReceipt.get(...scopeArgs(item.scope),item.nextEpoch))
              refuse('EPOCH_CONFLICT', 'Recovered Session epoch collides with historical operation receipts.');
            pending.push({...item, nextChecksum:checkpointChecksum(
              item.scope,item.nextEpoch,item.revision,stored.checkpoint_json)});
          }
          const update = db.prepare(`UPDATE session_checkpoints SET epoch=?, checksum=? WHERE
            ${SCOPE_COLUMNS} AND epoch=? AND revision=? AND checksum=?`);
          for (const item of pending) {
            const written = update.run(item.nextEpoch,item.nextChecksum,...scopeArgs(item.scope),
              item.previousEpoch,item.revision,item.checksum);
            if (written.changes !== 1)
              refuse('REVISION_CONFLICT', 'Recovered Session changed during atomic epoch rotation.');
          }
          db.exec('COMMIT;'); transaction = false;
          return {sessionCount:pending.length, revisionsPreserved:true};
        } catch (error) {
          if (transaction) {
            try { db.exec('ROLLBACK;'); }
            catch (rollbackError) {
              if (!String(rollbackError.message).includes('no transaction is active')) {
                try { db.close(); } finally { closed = true; }
              }
            }
          }
          throw error;
        }
      });
    },
    // Internal storage primitive for a FUTURE source/epoch transition. This
    // intentionally has no Coordinator wire handler. An authenticated,
    // write-quiesced runtime must separately verify the candidate publication,
    // signed source continuity, Editor readiness and cross-store recovery
    // protocol before ever invoking it. SQLite cannot atomically update the
    // filesystem's approved pointer or a Guest's verified Active revision.
    transitionProjectCheckpoints(input) {
      return storageCall(() => {
        if (readOnly) refuse('READ_ONLY','Diagnostic SQLite snapshots cannot approve Project transitions.');
        const projectId = identity(input?.projectId, 'project ID', 128);
        const projectUuid = identity(input?.projectUuid, 'project UUID', 128);
        const priorHash = identity(input?.previousDescriptorHash, 'previous descriptor hash', 64);
        const candidateHash = identity(input?.candidateDescriptorHash, 'candidate descriptor hash', 64);
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(projectUuid) ||
            !/^[a-f0-9]{64}$/u.test(priorHash) || !/^[a-f0-9]{64}$/u.test(candidateHash) ||
            priorHash === candidateHash || !Array.isArray(input?.sessions) ||
            input.sessions.length === 0 || input.sessions.length > maxSessions)
          refuse('INVALID_INPUT', 'A complete bounded Project transition is required.');
        // Optional provisioned roster must be captured with the original
        // transaction, not attached retrospectively to a legacy journal.
        const rosterInput=input.guestParticipants===undefined?undefined:
          JSON.parse(canonical(input.guestParticipants,128*1024));
        // Validate every intended target BEFORE opening the write transaction.
        // A batch with a bad second item must not partially replace the first.
        const seen = new Set();
        const newEpochs = new Set();
        const prepared = input.sessions.map(change => {
          const scope = scopeOf(change.scope);
          if (scope.projectId !== projectId || scope.projectUuid !== projectUuid ||
              seen.has(scope.sessionId))
            refuse('SCOPE_CONFLICT', 'Project transition contains a wrong or duplicated Session.');
          seen.add(scope.sessionId);
          const previousEpoch = identity(change.previousEpoch, 'previous epoch');
          const nextEpoch = identity(change.nextEpoch, 'next epoch');
          const revision = integer(change.revision, 'Session revision');
          const checksum = identity(change.expectedChecksum, 'expected checkpoint checksum', 64);
          if (!/^[a-f0-9]{64}$/u.test(checksum) || previousEpoch === nextEpoch ||
              newEpochs.has(nextEpoch) ||
              ![previousEpoch,nextEpoch].every(value =>
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value)))
            refuse('EPOCH_CONFLICT', 'Project transition requires a fresh epoch and exact prior checkpoint.');
          newEpochs.add(nextEpoch);
          const checkpointJson = canonical(change.checkpoint, maxCheckpointBytes);
          const next = JSON.parse(checkpointJson);
          if (next?.version !== 1 || next?.project?.descriptorHash !== candidateHash ||
              next?.project?.projectId !== projectId || next?.project?.projectUuid !== projectUuid ||
              !/^[a-f0-9]{64}$/u.test(next?.project?.manifestHash ?? '') ||
              !/^[a-f0-9]{64}$/u.test(next?.project?.ownerKeyId ?? '') ||
              next?.realtime?.revision !== revision ||
              typeof next?.lineageId !== 'string' ||
              !Number.isSafeInteger(next?.project?.baselineRevision) ||
              next.project.baselineRevision <= 0)
            refuse('INVALID_INPUT', 'Project transition checkpoint has an invalid signed source or revision.');
          return {scope,previousEpoch,nextEpoch,revision,checksum,checkpointJson,next,
            nextChecksum:checkpointChecksum(scope,nextEpoch,revision,checkpointJson)};
        });
        if (prepared.some(item => prepared.some(other =>
            other.previousEpoch === item.nextEpoch)))
          refuse('EPOCH_CONFLICT', 'A new Project epoch must not reuse any previous active Session epoch.');
        let transaction = false;
        try {
          db.exec('BEGIN IMMEDIATE;'); transaction = true;
          // No omitted or invented Sessions, even when one has never used a
          // Collider ledger. This check also rejects foreign Project UUIDs.
          const storedScopes = db.prepare(`SELECT session_id, project_uuid FROM session_checkpoints
            WHERE project_id = ? ORDER BY session_id`).all(projectId);
          if (storedScopes.length !== prepared.length || storedScopes.some(row =>
              row.project_uuid !== projectUuid || !seen.has(row.session_id)))
            refuse('SESSION_SET_CONFLICT', 'Project Session membership changed before transition.');
          let commonPublication = null;
          let commonDescriptor = null;
          const historicReceipt = db.prepare(`SELECT 1 FROM operation_results WHERE
            ${SCOPE_COLUMNS} AND epoch = ? LIMIT 1`);
          for (const item of prepared) {
            // A past epoch's accepted operation receipts remain on disk after
            // rotation. Never reuse that epoch for the new Project Baseline:
            // replaying a delayed signed edit would otherwise appear to have
            // been accepted under the new epoch.
            if (historicReceipt.get(...scopeArgs(item.scope),item.nextEpoch))
              refuse('EPOCH_CONFLICT', 'New Project epoch collides with historical accepted operation receipts.');
            const current = decodeCheckpoint(checkpointRow(item.scope));
            if (!current || current.revision !== item.revision || current.epoch !== item.previousEpoch ||
                current.checksum !== item.checksum ||
                current.checkpoint?.project?.descriptorHash !== priorHash)
              refuse('REVISION_CONFLICT', 'An M4 Session or its signed source changed before transition.');
            const original = current.checkpoint;
            const withoutComponentSource = components => components == null ? null :
              Object.fromEntries(Object.entries(components).filter(([key]) => key !== 'source'));
            // Older real Coordinator checkpoints carry the Project ID in their
            // signed Session scope, not as a duplicate Descriptor field. The
            // SQLite scope, old Descriptor hash and saved UUID are still CAS
            // verified; do not fabricate an ID in the immutable M4 backup.
            if (original.version !== 1 || !Number.isSafeInteger(original.project?.baselineRevision) ||
                (original.project.projectId !== undefined && original.project.projectId !== projectId) ||
                original.project.projectUuid !== projectUuid ||
                item.next.project.ownerKeyId !== original.project.ownerKeyId ||
                item.next.project.ownerPublicKey !== original.project.ownerPublicKey ||
                item.next.project.baselineRevision !== original.project.baselineRevision + 1 ||
                item.next.lineageId !== original.lineageId ||
                canonical(item.next.realtime,maxCheckpointBytes) !== canonical(original.realtime,maxCheckpointBytes) ||
                canonical(withoutComponentSource(item.next.components),maxCheckpointBytes) !==
                  canonical(withoutComponentSource(original.components),maxCheckpointBytes))
              refuse('SESSION_STATE_CONFLICT', 'An M4 edit, Collider ledger or lineage cannot be rewritten during Project transition.');
            const nextSource = item.next.components?.source ?? null;
            const oldSource = original.components?.source ?? null;
            // Repin only the signed descriptor fields. The actual admitted
            // Scene/Collider source bytes and exact object identities must
            // remain identical to the durable M4 witness.
            const pinFields = ['projectId','projectUuid','baselineRevision','manifestHash','descriptorHash','ownerKeyId'];
            const withoutPin = value => Object.fromEntries(
              Object.entries(value).filter(([key]) => !pinFields.includes(key)));
            if ((original.components === null) !== (item.next.components === null) ||
                (oldSource && (!nextSource ||
                  nextSource.projectId !== projectId || nextSource.projectUuid !== projectUuid ||
                  nextSource.baselineRevision !== item.next.project.baselineRevision ||
                  nextSource.manifestHash !== item.next.project.manifestHash ||
                  nextSource.descriptorHash !== candidateHash ||
                  nextSource.ownerKeyId !== item.next.project.ownerKeyId ||
                  canonical(withoutPin(oldSource),maxCheckpointBytes) !==
                    canonical(withoutPin(nextSource),maxCheckpointBytes))) ||
                (!oldSource && nextSource))
              refuse('SESSION_STATE_CONFLICT', 'Collider source pin was not migrated with the signed Project.');
            const descriptor = canonical(item.next.project,maxCheckpointBytes);
            const attribution = item.next.publication;
            if (typeof attribution?.publishedByUserId !== 'string' ||
                attribution.publishedByUserId.length === 0 || attribution.publishedByUserId.length > 128 ||
                typeof attribution.publishedByConnectionId !== 'string' ||
                attribution.publishedByConnectionId.length === 0 || attribution.publishedByConnectionId.length > 128 ||
                !Number.isSafeInteger(attribution.publishedAtUnixMs) ||
                attribution.publishedAtUnixMs < original.publication.publishedAtUnixMs ||
                attribution.publishedAtUnixMs > 253402300799999)
              refuse('SESSION_STATE_CONFLICT', 'A migrated Project requires a coherent published version attribution.');
            const publication = canonical(attribution,maxCheckpointBytes);
            if ((commonDescriptor !== null && descriptor !== commonDescriptor) ||
                (commonPublication !== null && publication !== commonPublication))
              refuse('SESSION_STATE_CONFLICT', 'All migrated Sessions must share one signed publication.');
            commonDescriptor = descriptor;
            commonPublication = publication;
          }
          // Persist the previous exact accepted bytes and transition marker
          // IN THIS SAME TRANSACTION as the repin; if SQLite rolls back, neither
          // journal nor any new Session checkpoint is published. A crash after
          // COMMIT retains both versions' evidence but blocks live restore.
          const original = prepared.map(item => decodeCheckpoint(checkpointRow(item.scope)));
          const firstOld = original[0].checkpoint.project;
          const firstNew = prepared[0].next.project;
          if (prepared.some((item,i)=>original[i].checkpoint.project.manifestHash !== firstOld.manifestHash ||
              original[i].checkpoint.project.baselineRevision !== firstOld.baselineRevision ||
              item.next.project.manifestHash !== firstNew.manifestHash ||
              item.next.project.baselineRevision !== firstNew.baselineRevision))
            refuse('SESSION_STATE_CONFLICT','Signed Project Manifests or revisions disagree across Sessions.');
          refusePendingTransition();
          const journal = {
            version:1,transitionId:randomUUID(),stage:'sqlite_committed',projectId,projectUuid,
            previousDescriptorHash:priorHash,candidateDescriptorHash:candidateHash,
            previousManifestHash:firstOld.manifestHash,candidateManifestHash:firstNew.manifestHash,
            previousBaselineRevision:firstOld.baselineRevision,
            candidateBaselineRevision:firstNew.baselineRevision,
            sessionCount:prepared.length,
            sessions:prepared.map((item,i)=>({sessionId:item.scope.sessionId,
              previousEpoch:item.previousEpoch,nextEpoch:item.nextEpoch,revision:item.revision,
              previousChecksum:original[i].checksum,nextChecksum:item.nextChecksum}))
              // Match SQLite BINARY collation (UTF-8 bytes), not JS UTF-16
              // ordering: supplementary Unicode session IDs sort differently.
              .sort((a,b)=>Buffer.compare(Buffer.from(a.sessionId,"utf8"),Buffer.from(b.sessionId,"utf8"))),
          };
          if(rosterInput!==undefined){
            try {journal.guestRoster=captureGuestRoster(rosterInput,firstOld,firstNew);}
            catch {refuse('INVALID_INPUT','A valid explicit provisioned Guest roster is required.');}
          }
          const journalJson = canonical(journal,MAX_TRANSITION_JOURNAL_BYTES);
          const journalChecksum = digest('transition-journal',{projectId,projectUuid},journalJson);
          db.prepare(`INSERT INTO project_transition_journal VALUES (?,?,?,?,?)`).run(
            projectId,projectUuid,journal.transitionId,journalJson,journalChecksum);
          const backupInsert = db.prepare(`INSERT INTO transition_checkpoint_backups
            VALUES (?,?,?,?,?,?,?)`);
          for (let i=0;i<prepared.length;i++) {
            const old = original[i];
            backupInsert.run(...scopeArgs(prepared[i].scope),old.epoch,old.revision,
              canonical(old.checkpoint,maxCheckpointBytes),old.checksum);
          }
          const update = db.prepare(`UPDATE session_checkpoints
            SET epoch=?, checkpoint_json=?, checksum=?
            WHERE project_id=? AND session_id=? AND project_uuid=? AND epoch=? AND revision=? AND checksum=?`);
          for (const item of prepared) {
            const written = update.run(item.nextEpoch,item.checkpointJson,item.nextChecksum,
              ...scopeArgs(item.scope),item.previousEpoch,item.revision,item.checksum);
            if (written.changes !== 1)
              refuse('REVISION_CONFLICT', 'Project Session was replaced during atomic transition.');
          }
          // Validate the captured roster against every retained/current
          // checkpoint before the transaction becomes durable.
          if(rosterInput!==undefined) verifyTransitionJournal(journalRecord(projectId));
          db.exec('COMMIT;'); transaction = false;
          return {projectId,projectUuid,descriptorHash:candidateHash,
            sessionCount:prepared.length,revisionPreserved:true};
        } catch (error) {
          if (transaction) {
            try { db.exec('ROLLBACK;'); }
            catch (rollbackError) {
              if (!String(rollbackError.message).includes('no transaction is active')) {
                try { db.close(); } finally { closed = true; }
              }
            }
          }
          throw error;
        }
      });
    },
    close() {
      if (closed) return;
      try { db.close(); closed = true; }
      catch (error) { throw new DurableSessionStoreError('STORAGE_ERROR', 'Unable to close the durable database.', error); }
    },
  };
  // Validate every checkpoint and journal before making restored state available.
  // A corrupt obsolete outcome must not silently become an uncommitted operation.
  try {
    store.loadAll();
    store.listProjectTransitionJournals();
    const rows = db.prepare('SELECT project_id, session_id, project_uuid, epoch, operation_id FROM operation_results').iterate();
    for (const row of rows) decodeOperation(operationRow({ projectId: row.project_id,
      sessionId: row.session_id, projectUuid: row.project_uuid }, row.epoch, row.operation_id));
    if (db.prepare('PRAGMA foreign_key_check').get())
      refuse('INTEGRITY_ERROR', 'Durable operation results have no matching checkpoint.');
    if (db.prepare(`SELECT 1 FROM operation_results AS operation
      JOIN session_checkpoints AS checkpoint USING(project_id, session_id, project_uuid)
      WHERE operation.revision > checkpoint.revision LIMIT 1`).get())
      refuse('INTEGRITY_ERROR', 'A durable operation is newer than its checkpoint.');
  } catch (error) {
    store.close();
    throw error;
  }
  return store;
}
