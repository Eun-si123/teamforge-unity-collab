import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { types } from 'node:util';

const SCHEMA_VERSION = 1;
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
  return digest('checkpoint', { schemaVersion: SCHEMA_VERSION, scope, epoch, revision }, json);
}

function operationChecksum(row) {
  return digest('operation', {
    schemaVersion: SCHEMA_VERSION,
    scope: { projectId: row.project_id, sessionId: row.session_id, projectUuid: row.project_uuid },
    epoch: row.epoch, operationId: row.operation_id, userId: row.user_id,
    fingerprint: row.fingerprint, baseRevision: row.base_revision,
    revision: row.revision, checkpointChecksum: row.checkpoint_checksum,
  }, row.result_json);
}

function checkPath(filePath) {
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

const CREATE_SCHEMA = `
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

/** Synchronous SQLite owner. Open only when durable mode is enabled by the caller. */
export function openDurableSessionStore(options = {}) {
  const filePath = options.filePath;
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
    checkPath(filePath);
    let fresh = false;
    try { const fd = openSync(filePath, 'wx', 0o600); closeSync(fd); fresh = true; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(filePath);
    db.exec('PRAGMA busy_timeout=100; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;');
    if (fresh) {
      db.exec(`BEGIN IMMEDIATE; ${CREATE_SCHEMA}
        PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=${SCHEMA_VERSION}; COMMIT;`);
    } else {
      const version = db.prepare('PRAGMA user_version').get().user_version;
      const application = db.prepare('PRAGMA application_id').get().application_id;
      if (version !== SCHEMA_VERSION || application !== APPLICATION_ID)
        refuse('SCHEMA_MISMATCH', 'Unsupported durable database schema; the existing file was preserved.');
      const definitions = db.prepare("SELECT name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
      const reference = new DatabaseSync(':memory:');
      let expected;
      try {
        reference.exec(CREATE_SCHEMA);
        expected = reference.prepare("SELECT name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
      } finally { reference.close(); }
      if (JSON.stringify(definitions) !== JSON.stringify(expected))
        refuse('SCHEMA_MISMATCH', 'Durable database definitions do not match this schema version.');
      if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok')
        refuse('INTEGRITY_ERROR', 'Durable database integrity validation failed.');
    }
    // One process owns a durable authority. SQLite releases this lock after a crash.
    db.exec('PRAGMA locking_mode=EXCLUSIVE; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA wal_autocheckpoint=256;');
    const pageSize = db.prepare('PRAGMA page_size').get().page_size;
    const pageLimit = Math.floor(maxDatabaseBytes / pageSize);
    if (db.prepare(`PRAGMA max_page_count=${pageLimit}`).get().max_page_count > pageLimit)
      refuse('STORAGE_ERROR', 'The durable database exceeds the configured page budget.');
    db.exec('BEGIN EXCLUSIVE; COMMIT;');
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

  const store = {
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
