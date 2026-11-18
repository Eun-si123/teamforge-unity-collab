// Atomic property ledger shared by the original offline WP6 experiments and
// signed production Collider admission. Seed inputs MUST be trusted prepared
// observations; client JSON alone is not a trusted seed. Runtime activation
// preserves the common Session revision across unrelated supported edits.
import { types as nodeTypes } from "node:util";
import { isPreparedComponentIdentityBaseline, prepareComponentIdentityBaseline, isLogicalComponentId, isSavedComponentId } from "./component-foundation.mjs";
import { inspectComponentPropertyAuthority } from "./component-authority-preflight.mjs";
import {
  inspectComponentPropertyTarget,
  isPreparedComponentPropertySnapshot,
  prepareComponentPropertyCandidate,
  validateComponentPropertyCandidate,
} from "./component-property-foundation.mjs";
import { isLogicalHierarchyObjectId } from "./hierarchy-model.mjs";
import { validateText } from "./protocol.mjs";
import { classifyComponentPropertyReplay } from "./component-operation-preflight.mjs";

const transactions = new WeakMap();
const MAX_HISTORY = 4096;
const MAX_LEDGER_BYTES = 256 * 1024;

function validSeedPolicy(policy) {
  // Even offline/locally prepared policies must not execute accessors or proxy
  // traps before the committed transaction's typed allowlist checks run.
  if (policy === null || typeof policy !== "object" || nodeTypes.isProxy(policy) ||
      Array.isArray(policy)) return false;
  const prototype = Object.getPrototypeOf(policy);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const fields = Object.getOwnPropertyDescriptors(policy);
  const keys = Reflect.ownKeys(fields);
  if (keys.length !== 2 || !keys.every(key =>
    typeof key === "string" && ["allowedProperties", "maxProperties"].includes(key) &&
    fields[key].enumerable && Object.hasOwn(fields[key], "value"))) return false;
  const allowed = fields.allowedProperties.value;
  return !nodeTypes.isProxy(allowed) && nodeTypes.isMap(allowed) &&
    Object.getPrototypeOf(allowed) === Map.prototype &&
    Number.isSafeInteger(fields.maxProperties.value) && fields.maxProperties.value > 0;
}

function rejected(code, reason, session, repair = "none") {
  return Object.freeze({
    error: code, reason, repair,
    serverRevision: Number.isSafeInteger(session?.revision) ? session.revision : null,
  });
}
// Capture only the already-approved property targets and descriptor values.
// The caller retains its own mutable Maps; the Session must not consult them
// after seeding, or a later policy change could enlarge a live transaction.
function pinSeededPropertyPolicy(policy, record, pinned) {
  const paths = Map.prototype.get.call(policy.allowedProperties, record.typeName);
  const source = Map.prototype.get.call(paths, record.propertyPath);
  const kind = record.valueKind;
  const descriptor = kind === "boolean"
    ? Object.freeze({ kind })
    : kind === "vector3"
      ? Object.freeze({ kind, maximumAbsolute: source.maximumAbsolute })
      : Object.freeze({ kind, minimum: source.minimum, maximum: source.maximum });
  let types = Map.prototype.get.call(pinned.allowedProperties, record.typeName);
  if (!types) {
    types = new Map();
    pinned.allowedProperties.set(record.typeName, types);
  }
  types.set(record.propertyPath, descriptor);
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
export function seedComponentPropertyTransaction(session, identityBaseline, snapshot, policy, maxOperations = 256, { allowEmpty = false } = {}) {
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
      !validSeedPolicy(policy) ||
      !Number.isSafeInteger(maxOperations) || maxOperations < 1 || maxOperations > MAX_HISTORY) {
    return rejected("component_transaction_seed_invalid",
      "A trusted same-revision Component identity/property seed, exact policy and bounded history are required.", session);
  }
  if (transactions.has(session)) {
    return rejected("component_transaction_already_seeded",
      "An active transaction cannot be silently replaced with a new seed.", session);
  }
  if ((!allowEmpty && snapshot.properties.length < 1) || snapshot.properties.length > policy.maxProperties) {
    return rejected("component_transaction_seed_empty_or_oversized",
      "The initial prototype must observe at least one allowed property within the limit.", session);
  }
  // Validate snapshot provenance through the private prepared-snapshot registry
  // rather than relying on an attacker-controlled lookalike/fingerprint.
  const first = snapshot.properties[0];
  const checked = first ? inspectComponentPropertyTarget(session, snapshot, {
    sceneId: snapshot.sceneId, objectId: first.objectId,
    componentId: first.componentId, typeName: first.typeName,
    propertyPath: first.propertyPath, valueKind: first.valueKind,
  }, policy) : { error: allowEmpty && identityBaseline.records.length === 0 ? null : "component_transaction_seed_empty" };
  if (checked.error) {
    return rejected("component_transaction_seed_untrusted", "The prepared property snapshot or owner/policy is not trusted.", session);
  }

  const ledger = new Map();
  const pinnedPolicy = {
    maxProperties: policy.maxProperties,
    allowedProperties: new Map(),
  };
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
    pinSeededPropertyPolicy(policy, candidate, pinnedPolicy);
  }
  if (snapshotSize(snapshotRows(ledger)) > MAX_LEDGER_BYTES) {
    return rejected("component_transaction_seed_size_limit", "The initial ledger exceeds 256 KiB.", session);
  }
  // All writes below are private until the entire seed is validated.
  transactions.set(session, {
    // Opaque per-seed identity prevents a stale Publisher handle from
    // mistaking (or deleting) an independently re-seeded local ledger.
    instanceIdentity: Object.freeze({}),
    sceneId: snapshot.sceneId,
    lastRevision: session.revision,
    identities: identityBaseline.records.map(r => Object.freeze({
      objectId: r.objectId, componentId: r.componentId, typeName: r.typeName,
    })),
    maxComponents: Math.max(1, identityBaseline.records.length),
    policy: pinnedPolicy, maxOperations, ledger, committed: new Map(),
  });
  return Object.freeze({ status: "seeded_for_local_simulation", serverRevision: session.revision, properties: ledger.size });
}

// An explicit trusted lifecycle operation discards ONLY the disposable ledger.
// It neither rolls back committed Session revision/history nor guesses how to
// reconstruct a newer baseline. A new trusted seed is required after retirement.
export function componentPropertyTransactionIdentityForLocalTest(session) {
  return session && typeof session === "object"
    ? transactions.get(session)?.instanceIdentity ?? null : null;
}

export function retireComponentPropertyTransaction(session, expectedIdentity) {
  if (!session || typeof session !== "object") return false;
  const current = transactions.get(session);
  if (!current || (expectedIdentity !== undefined &&
      current.instanceIdentity !== expectedIdentity)) return false;
  return transactions.delete(session);
}

// Production admission calls this only after the signed Scene bytes and the
// exact complete prepared seed were verified. Unrelated Session revisions do
// not invalidate property values; every new commit still checks current owner
// identity, membership, lock, revision, target and the common operation history.
export function activateComponentPropertyRuntime(session) {
  const tx = transactions.get(session);
  if (!tx) return false;
  tx.continuous = true;
  return true;
}

export function readComponentPropertyTransaction(session) {
  const tx = session && typeof session === "object" ? transactions.get(session) : null;
  if (!tx) return rejected("component_transaction_unseeded", "No locally trusted property seed exists.", session);
  if (!tx.continuous && session.revision !== tx.lastRevision) {
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
    ...(tx.structure ? { structureVersion: 1, structureRevision: tx.structureRevision,
      components: Object.freeze(catalogRows(tx.catalog)), tombstones: Object.freeze(catalogRows(tx.tombstones)) } : {}),
  });
}

export function commitComponentPropertyTransaction(session, intent, operationId, connection, nowUnixMs) {
  const tx = session && typeof session === "object" ? transactions.get(session) : null;
  if (!tx) return rejected("component_transaction_unseeded", "No trusted property seed exists.", session);
  if (!tx.continuous && session.revision !== tx.lastRevision) {
    return rejected("component_transaction_reseed_required",
      "Unobserved Session activity requires a new trusted Component/property seed.", session, "resnapshot_required");
  }
  if (!Number.isSafeInteger(session.revision) || session.revision >= Number.MAX_SAFE_INTEGER) {
    return rejected("component_transaction_revision_exhausted", "No safe next shared revision is available.", session);
  }
  if (tx.structure) return commitRuntimeProperty(session, tx, intent, operationId, connection, nowUnixMs);
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
  if (!tx.continuous && session.operations.size >= tx.maxOperations) {
    return rejected("component_transaction_history_full",
      "The shared operation history is full; refuse rather than evict another operation.", session);
  }
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
  // together. The Session is server-owned; the production caller separately
  // owns source admission, delivery and conditional compensation validation.
  tx.ledger = next;
  session.revision = revision;
  tx.lastRevision = revision;
  session.operations.set(operationId, { fingerprint: replay.fingerprint, applied });
  tx.committed.set(operationId, applied);
  if (tx.continuous) {
    // Like Transform/Hierarchy, retain a bounded shared idempotency window.
    // An evicted request still cannot replay as a new edit: its old revision
    // no longer matches current authority.
    while (session.operations.size > tx.maxOperations)
      session.operations.delete(session.operations.keys().next().value);
    for (const id of tx.committed.keys())
      if (!session.operations.has(id)) tx.committed.delete(id);
  }
  return Object.freeze({ status: "committed_locally", applied, serverRevision: revision });
}

// Structure mode is activated only after the production caller verified the
// exact signed Scene. Initial saved-source validators remain unchanged.
const RUNTIME_TYPES = new Set(["UnityEngine.BoxCollider", "UnityEngine.SphereCollider"]);
const STRUCTURE_FIELDS = ["sceneId","objectId","componentId","typeName","baseRevision","kind","expectedComponentRevision","compensatesOperationId"];
function inertExact(value, fields) {
  if (!value || typeof value !== "object" || nodeTypes.isProxy(value) || Array.isArray(value)) return false;
  const p = Object.getPrototypeOf(value);
  if (p !== Object.prototype && p !== null) return false;
  const ds = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(ds);
  return keys.length === fields.length && keys.every(k=>typeof k === "string" && fields.includes(k) && ds[k].enumerable && Object.hasOwn(ds[k],"value"));
}
function catalogRows(map) { return [...map.values()].sort((a,b)=>a.componentId < b.componentId ? -1 : a.componentId > b.componentId ? 1 : 0); }
function targetRows(tx, id) { return [...tx.ledger.values()].filter(r=>r.componentId===id); }
function componentVersion(tx, id) {
  const row = tx.catalog.get(id) ?? tx.tombstones.get(id);
  return row ? Math.max(row.serverRevision,...targetRows(tx,id).map(r=>r.serverRevision)) : -1;
}
export function activateComponentStructureRuntime(session, savedOwnerIds) {
  const tx = transactions.get(session);
  if (!tx?.continuous || tx.structure || !Array.isArray(savedOwnerIds) || savedOwnerIds.length > 10000 ||
      savedOwnerIds.some(id=>!isSavedComponentId(id) || !id.startsWith(`GlobalObjectId_V1-2-${tx.sceneId}-`))) return false;
  tx.structure = true;
  tx.maxComponents = 512;
  tx.savedOwnerIds = new Set(savedOwnerIds);
  tx.catalog = new Map(tx.identities.map(row=>[row.componentId,Object.freeze({...row,sceneId:tx.sceneId,serverRevision:session.revision})]));
  tx.seenIds = new Set(tx.catalog.keys());
  tx.tombstones = new Map();
  tx.structureReceipts = new Map();
  tx.structureRevision = session.revision;
  return true;
}
function runtimeAuthority(session, tx, intent, operationId, connection, now, fingerprint) {
  if (!(session?.members instanceof Map) || !(session?.locks instanceof Map) || !(session?.operations instanceof Map))
    return rejected("component_authority_context_invalid","A server-owned Session is required.",session);
  const member = session.members.get(connection?.userId);
  if (!tx?.structure || !connection || member?.connectionId !== connection.connectionId ||
      !connection.supportsComponentStructureSync || !session.componentPropertyConnections?.has(connection.connectionId))
    return rejected("component_session_not_registered","A current structure-capable joined Session member is required.",session);
  if (validateText(operationId,"operationId",128) || operationId!==operationId.trim())
    return rejected("component_operation_invalid","A canonical operation ID is required.",session);
  const prior = session.operations.get(operationId);
  if (prior) {
    if (prior.fingerprint !== fingerprint || tx.committed.get(operationId) !== prior.applied)
      return rejected("operation_id_conflict","This operation ID belongs to a different request.",session);
    return {status:"replayed",applied:prior.applied,serverRevision:session.revision};
  }
  if (intent.baseRevision !== session.revision)
    return rejected("component_property_stale_revision","Observe the latest shared Session revision.",session,"resnapshot_required");
  if (intent.sceneId !== tx.sceneId || !session.hierarchySceneIds.has(intent.sceneId) ||
      !session.hierarchyObjects.has(JSON.stringify([intent.sceneId,intent.objectId])))
    return rejected("component_structure_owner_missing","The exact owning GameObject must remain authoritative.",session);
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(session.revision) || session.revision>=Number.MAX_SAFE_INTEGER)
    return rejected("component_authority_context_invalid","A valid live server clock and revision are required.",session);
  const lease = session.locks.get(JSON.stringify([intent.sceneId,intent.objectId]));
  if (!lease || lease.ownerConnectionId!==connection.connectionId || lease.ownerUserId!==connection.userId ||
      lease.sceneId!==intent.sceneId || lease.objectId!==intent.objectId ||
      !Number.isSafeInteger(lease.expiresAtUnixMs) || lease.expiresAtUnixMs<=now)
    return rejected("component_structure_lock_required","A current owned GameObject lease is required.",session);
  return null;
}
function publishRuntime(session, tx, nextLedger, applied, fingerprint) {
  tx.ledger = nextLedger;
  tx.lastRevision = session.revision = applied.serverRevision;
  session.operations.set(applied.operationId,{fingerprint,applied});
  tx.committed.set(applied.operationId,applied);
  while (session.operations.size > tx.maxOperations) session.operations.delete(session.operations.keys().next().value);
  for (const id of tx.committed.keys()) if (!session.operations.has(id)) tx.committed.delete(id);
  for (const id of tx.structureReceipts.keys()) if (!session.operations.has(id)) tx.structureReceipts.delete(id);
}
function commitRuntimeProperty(session, tx, intent, operationId, connection, now) {
  const invalid = validateComponentPropertyCandidate(intent,{allowLogicalComponentId:true});
  if (invalid) return rejected("invalid_component_property",invalid,session);
  const row = tx.ledger.get(keyFor(intent));
  const fp = JSON.stringify(["m2-property",connection?.userId,intent]);
  const authority = runtimeAuthority(session,tx,intent,operationId,connection,now,fp);
  if (authority) return authority;
  if (!row || row.valueKind !== intent.valueKind) return rejected("component_property_target_missing","The exact property must exist in the runtime catalog.",session);
  const minimum = ["m_Size","m_Radius"].includes(intent.propertyPath) ? 0 : -100;
  const values = intent.valueKind === "boolean" ? [] : intent.valueKind === "vector3" ? [intent.value.x,intent.value.y,intent.value.z] : [intent.value];
  if (!RUNTIME_TYPES.has(intent.typeName) || values.some(n=>n<minimum || n>100))
    return rejected("component_property_range_exceeded","Collider value is outside its exact runtime range.",session);
  const applied = Object.freeze({type:"component_property_applied",operationId,userId:connection.userId,...intent,
    value:safeValue(intent.valueKind,intent.value),serverRevision:session.revision+1});
  const next = new Map(tx.ledger); next.set(keyFor(intent),ledgerRecord(intent,applied.serverRevision));
  if (snapshotSize(snapshotRows(next))>MAX_LEDGER_BYTES) return rejected("component_snapshot_size_limit","Runtime property ledger exceeds its bounded budget.",session);
  publishRuntime(session,tx,next,applied,fp);
  return Object.freeze({status:"committed_locally",applied,serverRevision:session.revision});
}
function initialRows(intent, revision) {
  return [["m_IsTrigger","boolean",false],["m_Center","vector3",{x:0,y:0,z:0}],
    intent.typeName === "UnityEngine.BoxCollider" ? ["m_Size","vector3",{x:1,y:1,z:1}] : ["m_Radius","float",0.5]]
    .map(([propertyPath,valueKind,value])=>ledgerRecord({...intent,propertyPath,valueKind,value},revision));
}
export function commitComponentStructureTransaction(session, intent, operationId, connection, now,
  inspectProjection = () => null) {
  const tx = transactions.get(session);
  if (!inertExact(intent,STRUCTURE_FIELDS) || !["add_component","remove_component"].includes(intent.kind) ||
      typeof intent.sceneId !== "string" || !/^(?!0{32}$)[0-9a-f]{32}$/u.test(intent.sceneId) ||
      validateText(intent.objectId,"objectId",512) || intent.objectId!==intent.objectId.trim() ||
      !Number.isSafeInteger(intent.baseRevision) || intent.baseRevision<0 ||
      !RUNTIME_TYPES.has(intent.typeName) || !Number.isSafeInteger(intent.expectedComponentRevision) || intent.expectedComponentRevision<0 ||
      typeof intent.compensatesOperationId!=="string" || intent.compensatesOperationId.length>128 ||
      (intent.compensatesOperationId!=="" && (validateText(intent.compensatesOperationId,"compensatesOperationId",128) || intent.compensatesOperationId!==intent.compensatesOperationId.trim())) ||
      (!isLogicalComponentId(intent.componentId) && !isSavedComponentId(intent.componentId)))
    return rejected("component_structure_invalid","An exact typed bounded structural intent is required.",session);
  const fp = JSON.stringify(["m2-structure",connection?.userId,intent]);
  const auth = runtimeAuthority(session,tx,intent,operationId,connection,now,fp);
  if (auth) return auth;
  const existing = tx.catalog.get(intent.componentId), tombstone = tx.tombstones.get(intent.componentId);
  const prior = intent.compensatesOperationId ? tx.structureReceipts.get(intent.compensatesOperationId) : null;
  if (intent.compensatesOperationId && (!prior || prior.applied.userId!==connection.userId ||
      prior.applied.componentId!==intent.componentId || prior.applied.objectId!==intent.objectId ||
      prior.applied.typeName!==intent.typeName || prior.applied.kind===intent.kind))
    return rejected("component_compensation_conflict","Structure Undo/Redo requires this user's exact prior inverse operation.",session);
  const revision = session.revision+1;
  const catalog = new Map(tx.catalog), tombstones = new Map(tx.tombstones), ledger = new Map(tx.ledger);
  let beforeProperties = [], addedRow;
  if (intent.kind === "add_component") {
    const hierarchy = session.hierarchyObjects.get(JSON.stringify([intent.sceneId,intent.objectId]));
    if (!tx.savedOwnerIds.has(intent.objectId) && !(isLogicalHierarchyObjectId(intent.objectId) &&
        Number.isSafeInteger(hierarchy.createdRevision) && hierarchy.createdRevision>0 && hierarchy.createdRevision<=session.revision))
      return rejected("component_structure_owner_unverified","Addition requires a signed saved owner or an authoritative newly-created logical GameObject.",session);
    if (existing || catalog.size>=512) return rejected("component_structure_limit_or_collision","Component count or identity collision.",session);
    if (prior) {
      if (!tombstone || tombstone.serverRevision!==prior.applied.serverRevision || intent.expectedComponentRevision!==tombstone.serverRevision)
        return rejected("component_compensation_conflict","The removed Component tombstone changed or is no longer available.",session);
      beforeProperties = prior.beforeProperties;
    } else if (!isLogicalComponentId(intent.componentId) || tx.seenIds.has(intent.componentId) || intent.expectedComponentRevision!==0 || tx.seenIds.size>=4096) {
      return rejected("component_structure_identity_reused","A new addition needs a never-used logical Component ID within the Session budget.",session);
    }
    addedRow = Object.freeze({sceneId:intent.sceneId,objectId:intent.objectId,componentId:intent.componentId,typeName:intent.typeName,serverRevision:revision});
    catalog.set(intent.componentId,addedRow); tombstones.delete(intent.componentId);
    for (const row of prior ? beforeProperties.map(r=>ledgerRecord(r,revision)) : initialRows(intent,revision)) ledger.set(keyFor(row),row);
  } else {
    if (!existing || existing.objectId!==intent.objectId || existing.typeName!==intent.typeName)
      return rejected("component_structure_target_missing","Remove must match the exact current catalog owner and type.",session);
    const version = componentVersion(tx,intent.componentId);
    if (intent.expectedComponentRevision!==version || (prior && prior.applied.serverRevision!==version))
      return rejected("component_compensation_conflict","The Component changed after this conditional remove/Undo before-image.",session);
    if (tombstones.size>=4096) return rejected("component_structure_tombstone_limit","The Session tombstone budget is exhausted.",session);
    beforeProperties = targetRows(tx,intent.componentId);
    catalog.delete(intent.componentId);
    tombstones.set(intent.componentId,Object.freeze({...existing,serverRevision:revision}));
    for (const [key,row] of ledger) if (row.componentId===intent.componentId) ledger.delete(key);
  }
  const properties = snapshotRows(ledger);
  if (properties.length>1536 || snapshotSize(properties)>MAX_LEDGER_BYTES)
    return rejected("component_snapshot_size_limit","Structural commit would exceed the runtime property budget.",session);
  const projected = Object.freeze({sceneId:tx.sceneId,serverRevision:revision,properties:Object.freeze(properties),
    structureVersion:1,structureRevision:revision,components:Object.freeze(catalogRows(catalog)),tombstones:Object.freeze(catalogRows(tombstones))});
  let projectionError;
  try { projectionError = inspectProjection(projected); }
  catch { return rejected("component_snapshot_size_limit","Structural projection could not be safely encoded.",session); }
  if (projectionError?.error) return projectionError;
  const applied = Object.freeze({type:"component_structure_applied",operationId,userId:connection.userId,...intent,serverRevision:revision});
  tx.catalog=catalog; tx.tombstones=tombstones; tx.structureRevision=revision; tx.seenIds.add(intent.componentId);
  publishRuntime(session,tx,ledger,applied,fp);
  tx.structureReceipts.set(operationId,{applied,beforeProperties:Object.freeze(beforeProperties)});
  return Object.freeze({status:"committed_locally",applied,serverRevision:revision});
}
