// WP6 LOCAL-ONLY atomic property transaction experiment. NOT routed through
// WebSocket, SessionAuthority.dispatch or Unity. Seed inputs below MUST be
// trusted server-side observations; a client's JSON is not a trusted seed.
// This explores commit/replay/stale/repair boundaries without promising WP6.
import { isPreparedComponentIdentityBaseline, prepareComponentIdentityBaseline } from "./component-foundation.mjs";
import { inspectComponentPropertyAuthority } from "./component-authority-preflight.mjs";
import {
  inspectComponentPropertyTarget,
  isPreparedComponentPropertySnapshot,
  prepareComponentPropertyCandidate,
} from "./component-property-foundation.mjs";
import { classifyComponentPropertyReplay } from "./component-operation-preflight.mjs";

const transactions = new WeakMap();
const MAX_HISTORY = 4096;
const MAX_LEDGER_BYTES = 256 * 1024;

function rejected(code, reason, session, repair = "none") {
  return Object.freeze({
    error: code, reason, repair,
    serverRevision: Number.isSafeInteger(session?.revision) ? session.revision : null,
  });
}
function keyFor(record) {
  return JSON.stringify([record.sceneId, record.objectId, record.componentId, record.typeName, record.propertyPath]);
}
function safeValue(kind, value) {
  return kind === "vector3" ? Object.freeze({ x: value.x, y: value.y, z: value.z }) : value;
}
function ledgerRecord(record, revision) {
  return Object.freeze({
    sceneId: record.sceneId, objectId: record.objectId,
    componentId: record.componentId, typeName: record.typeName,
    propertyPath: record.propertyPath, valueKind: record.valueKind,
    value: safeValue(record.valueKind, record.value),
    serverRevision: revision,
  });
}
function snapshotRows(ledger) {
  return [...ledger.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, v]) => v);
}
function snapshotSize(rows) {
  return Buffer.byteLength(JSON.stringify(rows), "utf8");
}

// Once per disposable Session: verify a genuine same-Session prepared snapshot
// and preserve ONLY known property targets. No arbitrary property creation.
// Do not call from network handlers without a separate authenticated and
// negotiated bootstrap, lifecycle/rollback and resnapshot design.
export function seedComponentPropertyTransaction(session, identityBaseline, snapshot, policy, maxOperations = 256) {
  if (!isPreparedComponentPropertySnapshot(snapshot, session, identityBaseline)) {
    return rejected("component_transaction_seed_untrusted",
      "A locally prepared same-Session property snapshot is required.", session);
  }
  if (!session || typeof session !== "object" || !(session.operations instanceof Map) ||
      !(session.hierarchyObjects instanceof Map) ||
      !Number.isSafeInteger(session.revision) || session.revision < 0 ||
      !isPreparedComponentIdentityBaseline(identityBaseline, session) ||
      !snapshot || !Array.isArray(snapshot.properties) ||
      snapshot.baseRevision !== session.revision ||
      snapshot.sceneId !== identityBaseline.sceneId ||
      !policy || !(policy.allowedProperties instanceof Map) ||
      !Number.isSafeInteger(policy.maxProperties) || policy.maxProperties < 1 ||
      !Number.isSafeInteger(maxOperations) || maxOperations < 1 || maxOperations > MAX_HISTORY) {
    return rejected("component_transaction_seed_invalid",
      "A trusted same-revision Component identity/property seed, exact policy and bounded history are required.", session);
  }
  if (transactions.has(session)) {
    return rejected("component_transaction_already_seeded",
      "An active transaction cannot be silently replaced with a new seed.", session);
  }
  if (snapshot.properties.length < 1 || snapshot.properties.length > policy.maxProperties) {
    return rejected("component_transaction_seed_empty_or_oversized",
      "The initial prototype must observe at least one allowed property within the limit.", session);
  }
  // Validate snapshot provenance through the private prepared-snapshot registry
  // rather than relying on an attacker-controlled lookalike/fingerprint.
  const first = snapshot.properties[0];
  const checked = inspectComponentPropertyTarget(session, snapshot, {
    sceneId: snapshot.sceneId, objectId: first.objectId,
    componentId: first.componentId, typeName: first.typeName,
    propertyPath: first.propertyPath, valueKind: first.valueKind,
  }, policy);
  if (checked.error) {
    return rejected("component_transaction_seed_untrusted", "The prepared property snapshot or owner/policy is not trusted.", session);
  }

  const ledger = new Map();
  for (const record of snapshot.properties) {
    const candidate = prepareComponentPropertyCandidate(session, identityBaseline, {
      ...record, sceneId: snapshot.sceneId, baseRevision: session.revision,
    }, policy);
    if (candidate.error) return rejected(candidate.error, candidate.reason, session);
    const k = keyFor(candidate);
    if (ledger.has(k)) {
      return rejected("component_transaction_duplicate_property", "Repeated property identity is not allowed.", session);
    }
    ledger.set(k, ledgerRecord(candidate, session.revision));
  }
  if (snapshotSize(snapshotRows(ledger)) > MAX_LEDGER_BYTES) {
    return rejected("component_transaction_seed_size_limit", "The initial ledger exceeds 256 KiB.", session);
  }
  // All writes below are private until the entire seed is validated.
  transactions.set(session, {
    sceneId: snapshot.sceneId,
    lastRevision: session.revision,
    identities: identityBaseline.records.map(r => Object.freeze({
      objectId: r.objectId, componentId: r.componentId, typeName: r.typeName,
    })),
    maxComponents: Math.max(1, identityBaseline.records.length),
    policy, maxOperations, ledger, committed: new Map(),
  });
  return Object.freeze({ status: "seeded_for_local_simulation", serverRevision: session.revision, properties: ledger.size });
}

export function readComponentPropertyTransaction(session) {
  const tx = session && typeof session === "object" ? transactions.get(session) : null;
  if (!tx) return rejected("component_transaction_unseeded", "No locally trusted property seed exists.", session);
  if (session.revision !== tx.lastRevision) {
    return rejected("component_transaction_reseed_required",
      "An unrelated authority revision invalidated the local property view.", session, "resnapshot_required");
  }
  const rows = snapshotRows(tx.ledger);
  if (snapshotSize(rows) > MAX_LEDGER_BYTES) {
    return rejected("component_transaction_snapshot_size_limit", "The ledger cannot be safely exported.", session);
  }
  return Object.freeze({
    sceneId: tx.sceneId, serverRevision: session.revision,
    properties: Object.freeze(rows),
  });
}

export function commitComponentPropertyTransaction(session, intent, operationId, connection, nowUnixMs) {
  const tx = session && typeof session === "object" ? transactions.get(session) : null;
  if (!tx) return rejected("component_transaction_unseeded", "No trusted property seed exists.", session);
  if (session.revision !== tx.lastRevision) {
    return rejected("component_transaction_reseed_required",
      "Unobserved Session activity requires a new trusted Component/property seed.", session, "resnapshot_required");
  }
  if (!Number.isSafeInteger(session.revision) || session.revision >= Number.MAX_SAFE_INTEGER) {
    return rejected("component_transaction_revision_exhausted", "No safe next shared revision is available.", session);
  }
  // Refresh ONLY verified saved Component IDs against CURRENT Hierarchy
  // authority, never trust a candidate or an old baseline across revisions.
  const identity = prepareComponentIdentityBaseline(session, {
    sceneId: tx.sceneId, baseRevision: session.revision,
    components: tx.identities.map(row => ({ ...row })),
  }, {
    maxComponents: tx.maxComponents,
    supportedTypes: new Set(tx.identities.map(r => r.typeName)),
  });
  if (identity.error) {
    return rejected(identity.error, identity.reason, session, "resnapshot_required");
  }
  const verdict = inspectComponentPropertyAuthority(
    session, identity, intent, tx.policy, operationId, connection, nowUnixMs,
  );
  if (verdict.error) return verdict;

  if (verdict.status === "matching_prior_record_only") {
    const prior = session.operations.get(operationId);
    if (!tx.committed.has(operationId) || tx.committed.get(operationId) !== prior?.applied) {
      return rejected("component_transaction_replay_untrusted",
        "Only an applied record produced by this transaction may be acknowledged.", session);
    }
    return Object.freeze({ status: "replayed", applied: prior.applied, serverRevision: session.revision });
  }
  if (verdict.status !== "unseen_candidate_with_live_lock") {
    return rejected("component_transaction_unexpected_preflight", "Unknown authority preflight result.", session);
  }

  const prepared = prepareComponentPropertyCandidate(session, identity, intent, tx.policy);
  if (prepared.error) return rejected(prepared.error, prepared.reason, session);
  const k = keyFor(prepared);
  const existing = tx.ledger.get(k);
  if (!existing || existing.valueKind !== prepared.valueKind) {
    return rejected("component_transaction_target_unseeded",
      "Only a known, precisely typed Component property may be changed.", session, "resnapshot_required");
  }
  const replay = classifyComponentPropertyReplay(session, intent, operationId, connection.userId);
  if (replay.status !== "unseen_requires_authority") {
    return rejected("component_transaction_replay_race",
      "Operation history changed before the intended commit.", session);
  }
  const revision = session.revision + 1;
  const nextValue = ledgerRecord(prepared, revision);
  const next = new Map(tx.ledger);
  next.set(k, nextValue);
  if (snapshotSize(snapshotRows(next)) > MAX_LEDGER_BYTES) {
    return rejected("component_transaction_snapshot_size_limit", "Commit would exceed the 256 KiB ledger ceiling.", session);
  }
  const applied = Object.freeze({
    type: "component_property_applied",
    operationId, userId: connection.userId,
    sceneId: prepared.sceneId, objectId: prepared.objectId,
    componentId: prepared.componentId, typeName: prepared.typeName,
    propertyPath: prepared.propertyPath, valueKind: prepared.valueKind,
    value: prepared.value, baseRevision: prepared.baseRevision,
    serverRevision: revision,
  });
  // Synchronous, no await/IO: publish the validated state and common revision
  // together. The Session is server-owned. This is NOT a network/Undo commit.
  tx.ledger = next;
  session.revision = revision;
  tx.lastRevision = revision;
  session.operations.set(operationId, { fingerprint: replay.fingerprint, applied });
  tx.committed.set(operationId, applied);
  while (session.operations.size > tx.maxOperations) {
    const oldest = session.operations.keys().next().value;
    session.operations.delete(oldest);
    tx.committed.delete(oldest);
  }
  return Object.freeze({ status: "committed_locally", applied, serverRevision: revision });
}
