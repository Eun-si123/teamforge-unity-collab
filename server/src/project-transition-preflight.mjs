// Read-only, signed-Project-member scoped server preflight for a FUTURE durable
// M4 -> M5 baseline transition. Never changes the Coordinator registry,
// approved durable pin, Collider ledger or existing recovery journal.
import { loadStoredPublication, readPublishedBaseline } from "../../project-peer/src/stored-publication.mjs";
import { missingChangedAssetMetadata, previewRetainedM4SourceChanges, summarizeSignedManifestChanges }
  from "../../project-peer/src/baseline-transition-source-preview.mjs";
import { descriptorIsCompatible, validateProjectCoordinatorMessage, verifyProjectDescriptor }
  from "./project-coordinator.mjs";
import { isDeepStrictEqual } from "node:util";
import { auditSignedAssetGuids } from "../../project-peer/src/signed-asset-guid-audit.mjs";
import { auditSignedCandidateContents } from "../../project-peer/src/signed-candidate-content-audit.mjs";

function reject(error, reason) { return { error, reason }; }

const conflict = () => reject("project_transition_stale",
  "The signed Host Project or durable Session changed while reading the candidate. Review again.");
const sourceUnavailable = () => reject("project_transition_source_unavailable",
  "The exact signed candidate or approved source is unavailable in managed Project storage.");

// A stored M4 project can have multiple active or disconnected Sessions and
// only SOME of them have a Collider ledger. A Collider-only check misses
// accepted Transform/Hierarchy changes in the other Sessions. Capture all
// authorized Session generations, plus active membership, lease state and
// durable checkpoint cursors, as inert values before entering async I/O.
// This is an invalidation fence for a READ-ONLY preview, not a write freeze.
export function captureProjectTransitionSessions({authority, durable, components, projectId, projectUuid, baseline}) {
  if (!(authority?.sessions instanceof Map) || !(durable?.checkpoints instanceof Map) ||
      !(components?.ledgers instanceof Map)) return null;
  const sessions = new Map();
  for (const [key, session] of authority.sessions) {
    let decoded;
    try { decoded = JSON.parse(key); } catch { return null; }
    if (!Array.isArray(decoded) || decoded.length !== 2 ||
        typeof decoded[0] !== "string" || typeof decoded[1] !== "string") return null;
    if (decoded[0] !== projectId) continue;
    sessions.set(key, {
      identity:session,
      revision:session.revision,
      durableEpoch:session.durableEpoch ?? "",
      durableLineageId:session.durableLineageId ?? "",
      members:[...session.members].map(([id, member]) => [id, member.connectionId]),
      leases:[...session.locks].map(([key, lock]) => [key, lock.ownerConnectionId, lock.expiresAtUnixMs]),
    });
  }
  const checkpoints = new Map();
  for (const [key, cursor] of durable.checkpoints) {
    if (cursor.scope.projectId !== projectId) continue;
    const expectedKey = JSON.stringify([cursor.scope.projectId, cursor.scope.sessionId]);
    if (cursor.scope.projectUuid !== projectUuid || key !== expectedKey ||
        !sessions.has(key) || cursor.revision !== sessions.get(key).revision) return null;
    checkpoints.set(key, {revision:cursor.revision,
      sessionId:cursor.scope.sessionId, epoch:sessions.get(key).durableEpoch});
  }
  const knownSessions = new Set([...sessions.values()].map(value => value.identity));
  const ledgers = new Map();
  for (const [session, state] of components.ledgers) {
    if (state.pin.projectId !== projectId) continue;
    if (state.pin.projectUuid !== projectUuid || state.pin.manifestHash !== baseline.manifestHash ||
        state.pin.descriptorHash !== baseline.descriptorHash ||
        state.pin.baselineRevision !== baseline.baselineRevision ||
        !knownSessions.has(session)) return null;
    ledgers.set(session, {epoch:state.epoch,sceneId:state.sceneId,
      revision:session.revision, pin:state.pin.descriptorHash});
  }
  return {sessions,checkpoints,ledgers};
}

export function sameProjectTransitionSessions(before, after) {
  if (!before || !after) return false;
  for (const name of ["sessions", "checkpoints", "ledgers"]) {
    const a = before[name], b = after[name];
    if (a.size !== b.size) return false;
    for (const [key, value] of a) if (!b.has(key) || !isDeepStrictEqual(value,b.get(key))) return false;
  }
  return true;
}

export async function inspectSignedProjectTransition({
  coordinator, authority, durable, components, managedRoot, connection, message, signal,
} = {}) {
  const syntax = validateProjectCoordinatorMessage(message, "project_baseline_transition_preview");
  if (syntax || message?.userId !== connection?.userId)
    return reject("project_transition_invalid", "A valid Owner/Publisher-signed next revision and exact connection identity are required.");
  const active = coordinator?.activeRecord(connection);
  const project = coordinator?.projects.get(connection.projectId);
  const current = project?.baseline;
  if (!durable?.ready || !active || active.record.connection !== connection ||
      connection.projectClientRegistered !== true || connection.supportsProjectTransfer !== true ||
      !current || !project || !descriptorIsCompatible(current) ||
      project.projectUuid !== current.projectUuid ||
      project.ownerKeyId !== current.ownerKeyId)
    return reject("project_transition_membership_required",
      "Only a currently registered Project member with an Owner-signed proposal may inspect a read-only M4 transition.");

  const oldApproved = durable.approvedProjects.get(connection.projectId);
  const oldSignature = verifyProjectDescriptor(current, connection.projectId);
  const proposal = verifyProjectDescriptor(message, connection.projectId);
  if (!oldApproved || oldApproved.descriptorHash !== current.descriptorHash ||
      oldSignature.error || proposal.error || !descriptorIsCompatible(message) ||
      message.ownerKeyId !== current.ownerKeyId ||
      message.ownerPublicKey !== current.ownerPublicKey ||
      message.projectUuid !== current.projectUuid ||
      message.baselineRevision !== current.baselineRevision + 1)
    return reject("project_transition_invalid",
      "The proposed Baseline must be exactly one later revision from the same signed Project Owner.");

  // The proposed descriptor is a PUBLIC signed artifact, not a fresh
  // signature challenge. It authorizes only a summary preview for a live,
  // registered Project member. Any later *write* must independently prove
  // Publisher key possession and require an explicit durable transaction.
  const beforeSessions = captureProjectTransitionSessions({authority, durable, components,
    projectId:connection.projectId, projectUuid:current.projectUuid, baseline:current});
  if (!beforeSessions) return conflict();
  const originalProject = project;
  let oldPublication, candidate;
  try {
    [oldPublication, candidate] = await Promise.all([
      loadStoredPublication({ managedRoot, projectId:connection.projectId,
        projectUuid:current.projectUuid, manifestHash:current.manifestHash, requireApproved:true }),
      loadStoredPublication({ managedRoot, projectId:connection.projectId,
        projectUuid:current.projectUuid, manifestHash:message.manifestHash, requireApproved:false }),
    ]);
  } catch { return sourceUnavailable(); }

  if (candidate.descriptor.descriptorHash !== message.descriptorHash ||
      candidate.descriptor.ownerKeyId !== current.ownerKeyId ||
      candidate.descriptor.baselineRevision !== message.baselineRevision ||
      oldPublication.descriptor.descriptorHash !== current.descriptorHash ||
      oldPublication.descriptor.ownerKeyId !== current.ownerKeyId)
    return reject("project_transition_source_mismatch",
      "The staged signed Manifest/Descriptor does not match the exact Publisher proposal.");

  let report, metadataAudit, contentAudit;
  try {
    signal?.throwIfAborted();
    const delta = summarizeSignedManifestChanges(candidate.manifest, oldPublication.manifest);
    const missing = missingChangedAssetMetadata(candidate.manifest, delta);
    metadataAudit = await auditSignedAssetGuids(candidate, delta, {signal});
    contentAudit = await auditSignedCandidateContents(candidate, {signal});
    signal?.throwIfAborted();
    report = previewRetainedM4SourceChanges(oldPublication.manifest, candidate.manifest,
      delta, missing, metadataAudit);
  } catch { return sourceUnavailable(); }

  // No async operation may publish a stale preview after a new signed project,
  // a session edit, a Publisher replacement or a local approval pointer flip.
  let pointer;
  try { pointer = await readPublishedBaseline({ managedRoot, projectUuid:current.projectUuid }); }
  catch { return sourceUnavailable(); }
  const afterSessions = captureProjectTransitionSessions({authority, durable, components,
    projectId:connection.projectId, projectUuid:current.projectUuid, baseline:current});
  if (!sameProjectTransitionSessions(beforeSessions, afterSessions) ||
      coordinator.projects.get(connection.projectId) !== originalProject ||
      originalProject.baseline !== current ||
      durable.approvedProjects.get(connection.projectId)?.descriptorHash !== current.descriptorHash ||
      coordinator.activeRecord(connection)?.record.connection !== connection ||
      pointer?.manifestHash !== current.manifestHash ||
      pointer?.descriptorHash !== current.descriptorHash) return conflict();

  return {
    type: "project_baseline_transition_preview", protocolVersion: 1,
    requestId: message.requestId,
    currentBaselineRevision: current.baselineRevision,
    candidateBaselineRevision: message.baselineRevision,
    status: report.status,
    blockerCount: report.blockerCount,
    retainedSceneCount: report.retainedSceneCount,
    retainedComponentSessions: beforeSessions.ledgers.size,
    retainedRealtimeSessions: beforeSessions.sessions.size,
    retainedDurableCheckpoints: beforeSessions.checkpoints.size,
    sceneSourceChangeCount: report.sceneSourceChangeCount,
    priorMetadataChangeCount: report.priorMetadataChangeCount,
    runtimeSourceChangeCount: report.runtimeSourceChangeCount,
    existingPrefabChangeCount: report.existingPrefabChangeCount,
    priorAssetChangeCount: report.priorAssetChangeCount,
    identicalMetaCount: report.identicalMetaCount,
    duplicateGuidCount: report.duplicateGuidCount,
    invalidGuidCount: report.invalidGuidCount,
    candidateMetadataAuditStatus: metadataAudit.status,
    auditedMetadataFiles: metadataAudit.auditedMetadataFiles,
    candidateContentAuditStatus: contentAudit.status,
    candidateVerifiedFileCount: contentAudit.verifiedFiles,
    candidateVerifiedByteCount: contentAudit.verifiedBytes,
    candidateVerifiedChunkCount: contentAudit.verifiedChunks,
    candidateStoredChunksVerified: contentAudit.status === "verified",
    durableCheckpointRequired: true,
    peerRefreshRequired: true,
    commitPermitted: false,
  };
}
