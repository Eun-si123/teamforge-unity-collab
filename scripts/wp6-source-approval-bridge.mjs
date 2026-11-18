// WP6 monorepo integration-only trust-boundary probe. Reuse the REAL
// Project Peer stored-chunk verifier and the REAL server Coordinator/
// Session-approved observation verifier. Not imported by production
// WebSocket, transfer, Unity, or release runtime.
import { verifyWp6PublishedSceneSource } from "../project-peer/src/wp6-signed-scene-source.mjs";
import { verifyPublisherApprovedColliderObservationForLocalTest } from "../server/src/component-publisher-observation-approval.mjs";
import { ProjectCoordinatorCore } from "../server/src/project-coordinator-core.mjs";
import { SessionAuthority } from "../server/src/session-authority.mjs";

function refused(error, reason) {
  return Object.freeze({ error, reason, repair: "resnapshot_required" });
}
function currentTrustedProjectPin(coordinator, actor) {
  if (!(coordinator instanceof ProjectCoordinatorCore) ||
      !actor || typeof actor !== "object" ||
      coordinator.activeRecord(actor)?.record?.connection !== actor) return null;
  const project = coordinator.projects.get(actor.projectId);
  const baseline = project?.baseline;
  if (!project || !baseline || project.projectId !== actor.projectId ||
      baseline.projectUuid !== project.projectUuid ||
      baseline.ownerKeyId !== project.ownerKeyId ||
      baseline.ownerPublicKey !== project.ownerPublicKey) return null;
  // This pin is obtained from the current registered server state;
  // NEVER accept the expected manifest or owner from a peer's publication.
  return Object.freeze({
    projectId: actor.projectId,
    projectUuid: project.projectUuid,
    baselineRevision: baseline.baselineRevision,
    manifestHash: baseline.manifestHash,
    descriptorHash: baseline.descriptorHash,
    ownerKeyId: project.ownerKeyId,
  });
}
function samePin(a, b) {
  return a && b && Object.keys(a).every(key => a[key] === b[key]);
}

// Establish a cryptographically checked same Baseline & Scene source
// reference, NOT source-byte -> SerializedProperty correspondence.
// This checks REAL stored .unity/.meta chunks, not a supplied digest.
export async function inspectWp6ProjectSceneAndPublisherObservationForLocalTest({
  coordinator, realtime, actor, identityBaseline, propertySnapshot,
  publisherApproval, publication, scenePath, sceneGuid,
} = {}) {
  const approved = verifyPublisherApprovedColliderObservationForLocalTest(
    coordinator, realtime, actor, identityBaseline, propertySnapshot, publisherApproval);
  if (approved.error) return approved;
  if (!(realtime instanceof SessionAuthority)) {
    return refused("wp6_bridge_context_invalid", "A real realtime SessionAuthority is required.");
  }
  const pin = currentTrustedProjectPin(coordinator, actor);
  if (!pin) return refused("wp6_bridge_project_unavailable",
    "The same active server-owned Project baseline is required.");
  if (sceneGuid !== approved.sceneId ||
      pin.projectUuid !== approved.projectUuid ||
      pin.baselineRevision !== approved.baselineRevision ||
      pin.manifestHash !== publisherApproval.manifestHash ||
      pin.descriptorHash !== publisherApproval.descriptorHash) {
    return refused("wp6_bridge_publisher_source_mismatch",
      "The Publisher observation and requested signed Scene must share one exact Project baseline.");
  }

  let verified;
  try {
    verified = await verifyWp6PublishedSceneSource({
      publication, expectedBaseline: pin, scenePath, sceneGuid,
    });
  } catch (error) {
    // Never leak local chunk-store paths or private publication contents.
    return refused("wp6_bridge_signed_scene_invalid",
      "Signed Scene byte source validation rejected: " +
      String(error?.code ?? "unavailable").slice(0, 96));
  }

  // Filesystem IO yielded to the event loop. Revalidate BOTH authorities
  // to close Project Baseline rotation, Session revision and member races.
  const after = verifyPublisherApprovedColliderObservationForLocalTest(
    coordinator, realtime, actor, identityBaseline, propertySnapshot, publisherApproval);
  if (after.error) return after;
  const currentPin = currentTrustedProjectPin(coordinator, actor);
  if (!samePin(pin, currentPin) ||
      after.sceneId !== approved.sceneId ||
      after.realtimeRevision !== approved.realtimeRevision ||
      after.identityFingerprintSha256 !== approved.identityFingerprintSha256 ||
      after.propertyFingerprintSha256 !== approved.propertyFingerprintSha256 ||
      verified.projectUuid !== pin.projectUuid ||
      verified.baselineRevision !== pin.baselineRevision ||
      verified.manifestHash !== pin.manifestHash ||
      verified.descriptorHash !== pin.descriptorHash ||
      verified.sceneGuid !== after.sceneId) {
    return refused("wp6_bridge_epoch_changed",
      "Project, Session or prepared observation changed during stored source verification.");
  }

  // Each side is independently checked. Actual COLLIDER value equality
  // to these bytes still requires a trusted serialized-Scene witness.
  return Object.freeze({
    status: "signed_scene_bytes_and_publisher_observation_same_baseline_values_unverified",
    projectUuid: pin.projectUuid,
    baselineRevision: pin.baselineRevision,
    manifestHash: pin.manifestHash,
    descriptorHash: pin.descriptorHash,
    sceneId: verified.sceneGuid,
    scenePath: verified.scenePath,
    sceneFileSha256: verified.sceneFileSha256,
    sceneMetaSha256: verified.sceneMetaSha256,
    sceneFileBytes: verified.sceneFileBytes,
    realtimeRevision: approved.realtimeRevision,
    identityFingerprintSha256: approved.identityFingerprintSha256,
    propertyFingerprintSha256: approved.propertyFingerprintSha256,
    serializedValuesVerified: false,
    editorApplyVerified: false,
    networkWriteAuthorized: false,
  });
}
