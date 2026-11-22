// Read-only, owner-publisher-scoped server preflight for a FUTURE durable
// M4 -> M5 baseline transition. Never changes the Coordinator registry,
// approved durable pin, Collider ledger or existing recovery journal.
import { loadStoredPublication, readPublishedBaseline } from "../../project-peer/src/stored-publication.mjs";
import { ProjectPeerEngine } from "../../project-peer/src/project-peer.mjs";
import { missingChangedAssetMetadata, previewRetainedM4SourceChanges }
  from "../../project-peer/src/host-checkpoint-preview.mjs";
import { descriptorIsCompatible, validateProjectCoordinatorMessage, verifyProjectDescriptor }
  from "./project-coordinator.mjs";

function reject(error, reason) { return { error, reason }; }

const conflict = () => reject("project_transition_stale",
  "The signed Host Project or durable Session changed while reading the candidate. Review again.");
const sourceUnavailable = () => reject("project_transition_source_unavailable",
  "The exact signed candidate or approved source is unavailable in managed Project storage.");

export async function inspectSignedProjectTransition({
  coordinator, durable, components, managedRoot, connection, message,
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
  const activeRevision = new Map();
  for (const [session, state] of components?.ledgers ?? []) {
    if (state.pin.projectId !== connection.projectId) continue;
    if (state.pin.manifestHash !== current.manifestHash ||
        state.pin.descriptorHash !== current.descriptorHash ||
        state.pin.baselineRevision !== current.baselineRevision)
      return conflict();
    activeRevision.set(session, session.revision);
  }
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

  let report;
  try {
    const engine = new ProjectPeerEngine({ managedRoot });
    const delta = engine.summarizePublicationChanges(candidate.manifest, oldPublication.manifest);
    const missing = missingChangedAssetMetadata(candidate.manifest, delta);
    report = previewRetainedM4SourceChanges(oldPublication.manifest, candidate.manifest, delta, missing);
  } catch { return sourceUnavailable(); }

  // No async operation may publish a stale preview after a new signed project,
  // a session edit, a Publisher replacement or a local approval pointer flip.
  let pointer;
  try { pointer = await readPublishedBaseline({ managedRoot, projectUuid:current.projectUuid }); }
  catch { return sourceUnavailable(); }
  const nowActive = new Map();
  for (const [session, state] of components?.ledgers ?? [])
    if (state.pin.projectId === connection.projectId) nowActive.set(session, session.revision);
  if (nowActive.size !== activeRevision.size ||
      [...activeRevision].some(([session, revision]) => nowActive.get(session) !== revision) ||
      coordinator.projects.get(connection.projectId) !== originalProject ||
      originalProject.baseline !== current ||
      durable.approvedProjects.get(connection.projectId)?.descriptorHash !== current.descriptorHash ||
      !coordinator.activeRecord(connection) ||
      pointer?.manifestHash !== current.manifestHash ||
      pointer?.descriptorHash !== current.descriptorHash ||
      [...activeRevision].some(([session, revision]) => session.revision !== revision ||
        components.ledgers.get(session)?.pin.descriptorHash !== current.descriptorHash)) return conflict();

  return {
    type: "project_baseline_transition_preview", protocolVersion: 1,
    requestId: message.requestId,
    currentBaselineRevision: current.baselineRevision,
    candidateBaselineRevision: message.baselineRevision,
    status: report.status,
    blockerCount: report.blockerCount,
    retainedSceneCount: report.retainedSceneCount,
    retainedComponentSessions: activeRevision.size,
    sceneSourceChangeCount: report.sceneSourceChangeCount,
    priorMetadataChangeCount: report.priorMetadataChangeCount,
    runtimeSourceChangeCount: report.runtimeSourceChangeCount,
    existingPrefabChangeCount: report.existingPrefabChangeCount,
    priorAssetChangeCount: report.priorAssetChangeCount,
    candidateStoredChunksVerified: false,
    durableCheckpointRequired: true,
    peerRefreshRequired: true,
    commitPermitted: false,
  };
}
