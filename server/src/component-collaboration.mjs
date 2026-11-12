// Collider property collaboration. Signed Project bytes establish the initial
// ledger; current Session authority owns all subsequent dirty-Scene edits.
import { createHash, randomUUID } from "node:crypto";
import { loadStoredPublication } from "../../project-peer/src/stored-publication.mjs";
import { ChunkStore } from "../../project-peer/src/content-store.mjs";
import { verifyWp6PublishedSceneSource } from "../../project-peer/src/wp6-signed-scene-source.mjs";
import { inspectSerializedColliderSceneValues }
  from "./serialized-collider-scene.mjs";
import { prepareComponentIdentityBaseline } from "./component-foundation.mjs";
import { prepareComponentPropertySnapshot, validateComponentPropertyCandidate }
  from "./component-property-foundation.mjs";
import { inspectCompleteSavedColliderObservation, seedCompleteSavedColliderTransaction }
  from "./component-collider-completeness.mjs";
import { activateComponentPropertyRuntime, commitComponentPropertyTransaction,
  readComponentPropertyTransaction, retireComponentPropertyTransaction }
  from "./component-property-transaction.mjs";
import { inspectCurrentSignedProjectForRecoveryPreview }
  from "./component-recovery-project-gate.mjs";
import { validateText } from "./protocol.mjs";

const MAX_SCENE_BYTES = 16 * 1024 * 1024;
const MAX_LEDGERS = 128;
const SHA = /^[0-9a-f]{64}$/u;
const GUID = /^(?!0{32}$)[0-9a-f]{32}$/u;
const envelope = ["type", "protocolVersion", "requestId"];
const identityFields = ["sceneId", "objectId", "componentId", "typeName", "propertyPath", "valueKind"];
function canonicalValue(kind, value) {
  if (kind === "float") return typeof value === "number" ? Math.fround(value) : value;
  if (kind === "vector3" && value && typeof value === "object" && !Array.isArray(value) &&
      Object.keys(value).length === 3 && ["x","y","z"].every(k=>Object.hasOwn(value,k) && typeof value[k] === "number"))
    return {x:Math.fround(value.x),y:Math.fround(value.y),z:Math.fround(value.z)};
  return value;
}
function floatHex(value) {
  const bytes = Buffer.allocUnsafe(4); bytes.writeFloatBE(value); return bytes.toString("hex");
}
// Portable digest: each field on its own LF-separated line, no final LF.
// All strings are canonical identities; numeric values use IEEE754 binary32
// big-endian lowercase hex (negative zero is normalized to positive zero).
export function componentSnapshotHash(snapshot) {
  const fields = ["teamforge-collider-snapshot-v1",snapshot.source.projectUuid,
    String(snapshot.source.baselineRevision),snapshot.source.manifestHash,snapshot.source.descriptorHash,
    snapshot.source.scenePath,snapshot.source.sceneFileSha256,snapshot.source.sceneMetaSha256,
    snapshot.epoch,snapshot.sceneId,String(snapshot.serverRevision)];
  for (const row of snapshot.properties) {
    fields.push(row.sceneId,row.objectId,row.componentId,row.typeName,
      row.propertyPath,row.valueKind,String(row.serverRevision));
    const encode = value=>floatHex(Object.is(value,-0)?0:value);
    fields.push(row.valueKind === "boolean" ? (row.value ? "1" : "0") :
      row.valueKind === "vector3" ? [row.value.x,row.value.y,row.value.z].map(encode).join("") : encode(row.value));
  }
  return createHash("sha256").update(fields.join("\n"),"utf8").digest("hex");
}
const sameValue = (a, b) => typeof a === "object" && a !== null
  ? b !== null && typeof b === "object" && a.x === b.x && a.y === b.y && a.z === b.z
  : a === b;
const targetKey = x => JSON.stringify(identityFields.map(k => x[k]));
const cloneValue = x => x !== null && typeof x === "object" ? Object.freeze({x:x.x,y:x.y,z:x.z}) : x;
function exact(value, fields) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === fields.length && Object.keys(value).every(k => fields.includes(k));
}
function denied(error, reason) { return { error, reason, repair: "resnapshot_required" }; }
function requestValid(message) {
  return validateText(message.requestId, "requestId", 128) === null &&
    message.requestId === message.requestId.trim();
}
function sourcePin(coordinator, connection) {
  const project = coordinator.projects.get(connection.projectId);
  const b = project?.baseline;
  return b && Object.freeze({ projectId: connection.projectId,
    projectUuid: project.projectUuid, baselineRevision: b.baselineRevision,
    manifestHash: b.manifestHash, descriptorHash: b.descriptorHash, ownerKeyId: project.ownerKeyId });
}
function samePin(a, b) { return b && Object.keys(a).every(k => a[k] === b[k]); }
function propertyPolicy() {
  return { maxProperties: 1536, allowedProperties: new Map([
    ["UnityEngine.BoxCollider", new Map([
      ["m_IsTrigger", {kind:"boolean"}], ["m_Center", {kind:"vector3",maximumAbsolute:100}],
      ["m_Size", {kind:"vector3",maximumAbsolute:100}],
    ])],
    ["UnityEngine.SphereCollider", new Map([
      ["m_IsTrigger", {kind:"boolean"}], ["m_Center", {kind:"vector3",maximumAbsolute:100}],
      ["m_Radius", {kind:"float",minimum:0,maximum:100}],
    ])],
  ]) };
}
function canonicalIdentities(records) {
  return JSON.stringify([...records].sort((a,b)=>a.componentId.localeCompare(b.componentId))
    .map(x=>[x.objectId,x.componentId,x.typeName]));
}

export class ComponentCollaboration {
  constructor({ coordinator, authority, managedRoot, maximumBytes, maximumOperations }) {
    this.coordinator = coordinator;
    this.authority = authority;
    this.managedRoot = managedRoot;
    this.maximumBytes = Math.min(maximumBytes, 1024 * 1024);
    this.maximumOperations = Math.min(4096, maximumOperations);
    this.ledgers = new Map();
    this.pending = new WeakSet();
    this.joined = new WeakMap();
  }

  inspectBaselinePublication(connection,message) {
    for (const state of this.ledgers.values()) {
      if (state.pin.projectId === connection.projectId &&
          (message.baselineRevision !== state.pin.baselineRevision ||
           message.manifestHash !== state.pin.manifestHash ||
           message.descriptorHash !== state.pin.descriptorHash))
        return denied("component_checkpoint_required",
          "Changing the Project baseline requires a checkpoint/refresh transition while Collider collaboration retains accepted edits. Current shared work was preserved.");
    }
    return null;
  }

  context(connection, sceneId, epoch = undefined) {
    if (!connection.supportsComponentPropertySync)
      return denied("component_sync_not_negotiated", "Collider property synchronization was not negotiated.");
    const signed = inspectCurrentSignedProjectForRecoveryPreview(this.coordinator, this.authority, connection);
    if (signed.error) return signed;
    const active = this.authority.activeSession(connection);
    if (!active) return denied("component_session_not_registered", "The Editor connection was replaced.");
    const state = this.ledgers.get(active.session);
    if (state && (!samePin(state.pin, sourcePin(this.coordinator, connection)) || state.sceneId !== sceneId))
      return denied("component_source_epoch_changed", "The signed Project baseline or admitted Scene changed.");
    if (epoch !== undefined && (!state || state.epoch !== epoch))
      return denied("component_epoch_mismatch", "The Collider Session epoch changed. Rejoin and recover the current snapshot.");
    return {session:active.session, state, pin:sourcePin(this.coordinator, connection)};
  }

  snapshot(state, requestId = "") {
    const view = readComponentPropertyTransaction(state.session);
    if (view.error) return view;
    for (const row of view.properties) {
      if (!state.session.hierarchyObjects.has(JSON.stringify([state.sceneId,row.objectId])))
        return denied("component_owner_missing", "An admitted Collider owner was removed. Structure recovery is required.");
    }
    const snapshotHash = componentSnapshotHash({epoch:state.epoch,sceneId:state.sceneId,
      serverRevision:view.serverRevision,properties:view.properties,source:state.source});
    const response = { type:"component_snapshot", protocolVersion:1, requestId,
      sceneId:state.sceneId, epoch:state.epoch, serverRevision:view.serverRevision,
      properties:view.properties, source:state.source, snapshotHash,
      serverCommitted:true, editorApplyVerified:false, diskSaved:false };
    if (Buffer.byteLength(JSON.stringify({...response,requestId:"\uffff".repeat(128)})) > this.maximumBytes)
      return denied("component_snapshot_size_limit", "The Collider recovery snapshot exceeds the configured message budget.");
    return response;
  }

  async join(connection, message) {
    const fields = [...envelope, "sceneId", "scenePath", "sceneFileSha256", "sceneMetaSha256",
      "baseRevision", "components", "properties"];
    if (!exact(message, fields) || !requestValid(message) || !GUID.test(message.sceneId ?? "") ||
        !SHA.test(message.sceneFileSha256 ?? "") || !SHA.test(message.sceneMetaSha256 ?? "") ||
        typeof message.scenePath !== "string" || message.scenePath.length > 1024)
      return denied("component_join_invalid", "An exact bounded saved Scene observation and source hashes are required.");
    const context = this.context(connection, message.sceneId);
    if (context.error) return context;
    const {session,pin} = context;
    if (this.pending.has(session)) return denied("component_admission_busy", "Signed Scene admission is already in progress. Retry after its result.");
    if (message.baseRevision !== session.revision)
      return denied("component_property_stale_revision", "Join must observe the current shared Session revision.");
    const policy = propertyPolicy();
    const identity = prepareComponentIdentityBaseline(session, {
      sceneId:message.sceneId, baseRevision:message.baseRevision, components:message.components,
    }, {maxComponents:512,supportedTypes:new Set(policy.allowedProperties.keys())});
    if (identity.error) return identity;
    const rawProperties = prepareComponentPropertySnapshot(session,identity,{
      sceneId:message.sceneId,baseRevision:message.baseRevision,properties:message.properties,
    },policy);
    if (rawProperties.error) return rawProperties;
    const rawComplete = inspectCompleteSavedColliderObservation(session,identity,rawProperties);
    if (rawComplete.error) return rawComplete;
    const properties = prepareComponentPropertySnapshot(session, identity, {
      sceneId:message.sceneId,baseRevision:message.baseRevision,
      properties:message.properties.map(row=>({...row,value:canonicalValue(row.valueKind,row.value)})),
    }, policy);
    if (properties.error) return properties;
    const complete = inspectCompleteSavedColliderObservation(session, identity, properties);
    if (complete.error) return complete;
    if (context.state) {
      if (context.state.scenePath !== message.scenePath ||
          context.state.identities !== canonicalIdentities(identity.records))
        return denied("component_join_identity_mismatch", "Runtime recovery requires exactly the admitted Collider owners and types.");
      // A saved runtime edit legitimately differs from the original source bytes.
      // The Editor must preserve differing local values before applying recovery.
      const reply = this.snapshot(context.state,message.requestId);
      if (reply.error) return reply;
      this.joined.set(connection, context.state);
      session.componentPropertyConnections.add(connection.connectionId);
      return reply;
    }
    if (this.ledgers.size >= MAX_LEDGERS)
      return denied("component_session_capacity", "The bounded Collider Session capacity is full.");
    this.pending.add(session);
    const initialRevision = session.revision;
    try {
      const publication = await loadStoredPublication({managedRoot:this.managedRoot,
        projectId:pin.projectId,projectUuid:pin.projectUuid,
        manifestHash:pin.manifestHash,requireApproved:true,
      });
      const source = await verifyWp6PublishedSceneSource({
        publication,expectedBaseline:pin,scenePath:message.scenePath,sceneGuid:message.sceneId,
        maxSceneBytes:MAX_SCENE_BYTES,
      });
      if (source.sceneFileSha256 !== message.sceneFileSha256 || source.sceneMetaSha256 !== message.sceneMetaSha256)
        return denied("component_join_source_mismatch", "The initial Editor source hashes differ from the signed Scene source.");
      const entry = publication.manifest.files.find(x=>x.path===source.scenePath);
      if (!entry || entry.size > MAX_SCENE_BYTES || entry.chunks.length > 2048)
        return denied("component_join_source_limit", "The signed Scene exceeds the bounded text Scene budget.");
      const buffers = []; let size = 0;
      const hash = createHash("sha256");
      for (const part of entry.chunks) {
        const bytes = await ChunkStore.prototype.read.call(publication.store,part.hash,part.size);
        size += bytes.length;
        if (size > entry.size || size > MAX_SCENE_BYTES)
          return denied("component_join_source_limit", "Stored Scene bytes exceed the signed size.");
        hash.update(bytes); buffers.push(bytes);
      }
      if (size !== entry.size || hash.digest("hex") !== source.sceneFileSha256)
        return denied("component_join_source_changed", "The exact bytes read differ from the signed Scene hash.");
      const witness = inspectSerializedColliderSceneValues({
        sceneBytes:Buffer.concat(buffers,size),sceneGuid:message.sceneId,
        identityBaseline:identity,propertySnapshot:properties,
      });
      if (witness.error) return witness;
      const after = this.context(connection,message.sceneId);
      if (after.error) return after;
      if (after.session !== session || after.state || session.revision !== initialRevision ||
          !samePin(pin,after.pin))
        return denied("component_admission_changed", "Project, membership or Session revision changed during signed source verification.");
      // Other Sessions may have consumed the remaining capacity while this
      // admission awaited source IO. Recheck at the synchronous seed boundary.
      if (this.ledgers.size >= MAX_LEDGERS)
        return denied("component_session_capacity", "The bounded Collider Session capacity is full.");
      const seeded = seedCompleteSavedColliderTransaction(
        session,identity,properties,policy,this.maximumOperations);
      if (seeded.error) return seeded;
      activateComponentPropertyRuntime(session);
      const state = {session,pin,sceneId:message.sceneId,scenePath:message.scenePath,
        sceneRequirementPending:true,epoch:randomUUID(),identities:canonicalIdentities(identity.records),results:new Map(),
        reports:new Map(), source:Object.freeze({...pin,scenePath:source.scenePath,
          sceneFileSha256:source.sceneFileSha256,sceneMetaSha256:source.sceneMetaSha256})};
      const reply = this.snapshot(state,message.requestId);
      if (reply.error || Buffer.byteLength(JSON.stringify(reply)) > this.maximumBytes) {
        retireComponentPropertyTransaction(session);
        return reply.error ? reply : denied("component_snapshot_size_limit", "The full Collider snapshot exceeds the configured message budget.");
      }
      this.ledgers.set(session,state);
      session.componentPropertySceneId = message.sceneId;
      session.componentPropertyConnections = new Set([connection.connectionId]);
      this.joined.set(connection,state);
      return reply;
    } catch (error) {
      return denied("component_signed_source_unavailable", "Signed Scene admission failed: " + String(error?.code ?? "verification_failed").slice(0,80));
    } finally { this.pending.delete(session); }
  }

  requireJoined(connection, message) {
    const context = this.context(connection,message.sceneId,message.epoch);
    if (context.error) return context;
    if (this.joined.get(connection) !== context.state)
      return denied("component_scene_join_required", "This connection must join the verified Collider Scene first.");
    return context;
  }

  recover(connection, message) {
    if (!exact(message,[...envelope,"sceneId","epoch"]) || !requestValid(message))
      return denied("component_snapshot_request_invalid", "Exact Scene and epoch recovery fields are required.");
    const context = this.requireJoined(connection,message);
    return context.error ? context : this.snapshot(context.state,message.requestId);
  }

  commit(connection, message, nowUnixMs) {
    const fields = [...envelope,"operationId","epoch",...identityFields,"value","baseRevision",
      "expectedRevision","expectedValue","compensatesOperationId"];
    if (!exact(message,fields) || !requestValid(message) ||
        validateText(message.operationId,"operationId",128) !== null ||
        message.operationId !== message.operationId.trim() ||
        typeof message.compensatesOperationId !== "string" || message.compensatesOperationId.length > 128 ||
        (message.compensatesOperationId !== "" && validateText(message.compensatesOperationId,"compensatesOperationId",128) !== null) ||
        !Number.isSafeInteger(message.expectedRevision) || message.expectedRevision < 0)
      return denied("component_operation_invalid", "Exact Collider set/conditional compensation fields are required.");
    const context = this.requireJoined(connection,message);
    if (context.error) return context;
    const {session,state} = context;
    const intent = Object.fromEntries([...identityFields,"value","baseRevision"].map(k=>[k,message[k]]));
    // Validate exact raw shape before numeric normalization, so extra vector
    // keys or an out-of-range double cannot disappear during canonicalization.
    const invalid = validateComponentPropertyCandidate(intent);
    const expectedInvalid = validateComponentPropertyCandidate({...intent,value:message.expectedValue});
    if (invalid || expectedInvalid) return denied("component_operation_invalid", invalid ?? expectedInvalid);
    const rangeValid = value => {
      if (message.valueKind === "boolean") return true;
      const minimum = ["m_Size","m_Radius"].includes(message.propertyPath) ? 0 : -100;
      const axes = message.valueKind === "vector3" ? [value.x,value.y,value.z] : [value];
      return axes.every(axis=>axis>=minimum && axis<=100);
    };
    if (!rangeValid(message.value) || !rangeValid(message.expectedValue))
      return denied("component_property_range_exceeded", "Raw Collider values must be within their exact property bounds.");
    message = {...message,value:canonicalValue(message.valueKind,message.value),
      expectedValue:canonicalValue(message.valueKind,message.expectedValue)};
    intent.value = message.value;
    if (message.propertyPath === "m_Size" && message.valueKind === "vector3" &&
        [message.value.x,message.value.y,message.value.z].some(axis=>axis<0))
      return denied("component_property_range_exceeded", "BoxCollider size axes must be nonnegative.");
    const fingerprint = JSON.stringify([connection.userId,message.epoch,
      identityFields.map(k=>message[k]),message.baseRevision,message.valueKind === "vector3"
        ? [message.value.x,message.value.y,message.value.z] : message.value,
      message.expectedRevision,message.valueKind === "vector3"
        ? [message.expectedValue.x,message.expectedValue.y,message.expectedValue.z] : message.expectedValue,
      message.compensatesOperationId]);
    if (!session.operations.has(message.operationId) && message.baseRevision !== session.revision)
      return denied("component_property_stale_revision", "New edits must observe the current shared Session revision.");
    for (const id of state.results.keys()) if (!session.operations.has(id)) state.results.delete(id);
    const cached = state.results.get(message.operationId);
    if (cached) {
      if (cached.fingerprint !== fingerprint) return denied("operation_id_conflict", "The operation ID already belongs to a different request.");
      return {...cached.reply,requestId:message.requestId,replayed:true,currentServerRevision:session.revision};
    }
    const before = this.snapshot(state);
    if (before.error) return before;
    const previous = before.properties.find(x=>targetKey(x)===targetKey(message));
    if (!previous) return denied("component_property_target_missing", "The exact Collider property was not admitted.");
    if (previous.serverRevision !== message.expectedRevision || !sameValue(previous.value,message.expectedValue))
      return denied("component_property_conflict", "The property changed after the local before-image. Preserve local work and recover.");
    if (message.compensatesOperationId) {
      const original = state.results.get(message.compensatesOperationId)?.reply;
      if (!original || original.userId !== connection.userId || targetKey(original)!==targetKey(message) ||
          original.serverRevision !== previous.serverRevision || !sameValue(original.value,previous.value) ||
          !sameValue(original.previousValue,message.value))
        return denied("component_compensation_conflict", "Undo/Redo can compensate only this user's latest unchanged property operation.");
    }
    const projected = {...before,requestId:"\uffff".repeat(128),serverRevision:session.revision+1,
      properties:before.properties.map(row=>targetKey(row)===targetKey(message)
        ? {...row,value:message.value,serverRevision:session.revision+1} : row)};
    if (Buffer.byteLength(JSON.stringify(projected)) > this.maximumBytes)
      return denied("component_snapshot_size_limit", "This edit would exceed the bounded recovery snapshot budget.");
    const result = commitComponentPropertyTransaction(session,intent,message.operationId,connection,nowUnixMs);
    if (result.error) return result;
    const current = this.snapshot(state);
    // All snapshot budgets and identities were checked before the synchronous
    // commit. Property sets cannot change topology or grow record count.
    const reply = {...result.applied,protocolVersion:1,requestId:message.requestId,epoch:state.epoch,
      previousValue:cloneValue(previous.value),compensatesOperationId:message.compensatesOperationId,
      snapshotHash:current.snapshotHash,serverCommitted:true,editorApplyVerified:false,diskSaved:false,
      replayed:result.status==="replayed"};
    state.results.set(message.operationId,{fingerprint,reply});
    return reply;
  }

  report(connection,message) {
    if (!exact(message,[...envelope,"sceneId","epoch","serverRevision","snapshotHash","status"]) ||
        !requestValid(message) || !["applied","conflict"].includes(message.status) ||
        !SHA.test(message.snapshotHash ?? ""))
      return denied("component_apply_report_invalid", "An exact current snapshot cursor and Editor apply status are required.");
    const context = this.requireJoined(connection,message);
    if (context.error) return context;
    const snapshot = this.snapshot(context.state);
    if (snapshot.error) return snapshot;
    if (snapshot.serverRevision !== message.serverRevision || snapshot.snapshotHash !== message.snapshotHash)
      return denied("component_apply_report_stale", "The Editor reported a stale snapshot; request current state.");
    context.state.reports.set(connection.userId,{connectionId:connection.connectionId,
      serverRevision:message.serverRevision,status:message.status});
    return {type:"component_apply_report_ack",protocolVersion:1,requestId:message.requestId,
      sceneId:message.sceneId,epoch:message.epoch,serverRevision:message.serverRevision,
      status:"editor_report_recorded",editorStatus:message.status,
      serverCommitted:true,editorApplyVerified:false,diskSaved:false};
  }

  clear() {
    for (const state of this.ledgers.values()) {
      retireComponentPropertyTransaction(state.session);
      delete state.session.componentPropertySceneId;
      delete state.session.componentPropertyConnections;
    }
    this.ledgers.clear();
    this.joined = new WeakMap();
  }

  removeConnection(connection) {
    const state = this.joined.get(connection);
    if (state) {
      state.session.componentPropertyConnections.delete(connection.connectionId);
      if (state.reports.get(connection.userId)?.connectionId === connection.connectionId)
        state.reports.delete(connection.userId);
      this.joined.delete(connection);
    }
  }

  recipientConnectionIds(state) {
    return [...state.session.members.values()].filter(member=>{
      const connection = this.connections?.get(member.connectionId)?.state;
      return connection && this.joined.get(connection)===state;
    }).map(member=>member.connectionId);
  }
}
