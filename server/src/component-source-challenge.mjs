// Test-only WP6 *live* read-only freshness probe, not a signed source proof.
// A Server nonce is bound to the current exact Project/Session/connection and
// Publisher Baseline. Echoing the nonce proves ONLY that the same live socket
// could see it: it never verifies Scene file bytes or authorizes writes.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { inspectCurrentSignedProjectForRecoveryPreview } from "./component-recovery-project-gate.mjs";

const outstanding = new WeakMap();
const TTL_MS = 15_000;
const SCENE_GUID = /^[0-9a-f]{32}$/u;
const NONCE = /^[0-9a-f]{64}$/u;

function denied(error, reason) {
  return Object.freeze({ error, reason });
}
function canonicalSceneGuid(value) {
  return typeof value === "string" && SCENE_GUID.test(value) &&
    value !== "00000000000000000000000000000000";
}
function snapshot(coordinator, realtime, connection, sceneId) {
  const current = inspectCurrentSignedProjectForRecoveryPreview(
    coordinator, realtime, connection,
  );
  if (current.error) return current;
  const baseline = coordinator.projects.get(connection.projectId)?.baseline;
  const liveSession = realtime.activeSession(connection)?.session;
  if (!baseline || !liveSession ||
      !Number.isSafeInteger(liveSession.revision) ||
      liveSession.revision < 0)
    return denied("component_source_challenge_epoch_changed",
      "Current signed Project Baseline or realtime Session was retired.");
  const pin = {
    projectId: connection.projectId,
    sessionId: connection.sessionId,
    connectionId: connection.connectionId,
    sessionRevision: liveSession.revision,
    projectUuid: current.projectUuid,
    baselineRevision: current.baselineRevision,
    manifestHash: current.manifestHash,
    descriptorHash: current.descriptorHash,
    ownerKeyId: baseline.ownerKeyId,
    ownerPublicKey: baseline.ownerPublicKey,
    publisherKeyId: baseline.publisherKeyId,
    publisherPublicKey: baseline.publisherPublicKey,
    publisherAuthorization: baseline.publisherAuthorization,
    baselineSignature: baseline.baselineSignature,
    sceneId,
  };
  return { pin: Object.freeze(pin) };
}
function samePin(left, right) {
  return right != null &&
    Object.keys(left).every(key => left[key] === right[key]);
}

/** Produce one nonce per authenticated, currently registered WP6 Editor. */
export function issueComponentSourceChallenge(
  coordinator, realtime, connection, sceneId, nowUnixMs = Date.now(),
) {
  if (!canonicalSceneGuid(sceneId) ||
      !Number.isSafeInteger(nowUnixMs) || nowUnixMs < 0)
    return denied("component_source_challenge_invalid",
      "A canonical saved Unity Scene GUID and valid current time are required.");

  const context = snapshot(coordinator, realtime, connection, sceneId);
  if (context.error) return context;
  const old = outstanding.get(connection);
  if (old && nowUnixMs < old.expiresAtUnixMs) {
    return denied("component_source_challenge_outstanding",
      "An unexpired read-only source challenge is already outstanding.");
  }

  const nonce = randomBytes(32).toString("hex");
  const expiresAtUnixMs = nowUnixMs + TTL_MS;
  if (!Number.isSafeInteger(expiresAtUnixMs)) {
    return denied("component_source_challenge_invalid", "Current time is out of range.");
  }
  outstanding.set(connection, Object.freeze({
    nonce, expiresAtUnixMs, pin: context.pin,
  }));
  return Object.freeze({
    status: "server_source_freshness_probe_unverified",
    nonce,
    sceneId,
    projectUuid: context.pin.projectUuid,
    baselineRevision: context.pin.baselineRevision,
    sessionRevision: context.pin.sessionRevision,
    manifestHash: context.pin.manifestHash,
    descriptorHash: context.pin.descriptorHash,
    expiresAtUnixMs,
    sceneBytesAttested: false,
    editorApplyVerified: false,
    networkWriteAuthorized: false,
  });
}

/** Consume before checking nonce or epoch, avoiding brute-force/replay reuse. */
export function consumeComponentSourceChallenge(
  coordinator, realtime, connection, sceneId, nonce, nowUnixMs = Date.now(),
) {
  if (!canonicalSceneGuid(sceneId) || typeof nonce !== "string" ||
      !NONCE.test(nonce) || !Number.isSafeInteger(nowUnixMs) || nowUnixMs < 0)
    return denied("component_source_challenge_invalid",
      "The challenge reply requires an exact canonical Scene GUID and nonce.");

  const old = outstanding.get(connection);
  if (!old) return denied("component_source_challenge_absent",
    "No unconsumed challenge exists for this exact Editor connection.");
  outstanding.delete(connection);
  if (nowUnixMs >= old.expiresAtUnixMs)
    return denied("component_source_challenge_expired",
      "The challenge expired and was consumed. Request a new one.");
  const context = snapshot(coordinator, realtime, connection, sceneId);
  if (context.error || !samePin(old.pin, context.pin))
    return denied("component_source_challenge_epoch_changed",
      "Project, Publisher, Session, Scene or connection changed during the challenge.");

  const expected = Buffer.from(old.nonce, "hex");
  const supplied = Buffer.from(nonce, "hex");
  if (!timingSafeEqual(expected, supplied))
    return denied("component_source_challenge_nonce_mismatch",
      "The one-time challenge did not match this Editor connection.");

  return Object.freeze({
    status: "same_connection_challenge_echo_unverified",
    challengeConsumed: true,
    sceneId,
    projectUuid: context.pin.projectUuid,
    baselineRevision: context.pin.baselineRevision,
    sessionRevision: context.pin.sessionRevision,
    manifestHash: context.pin.manifestHash,
    descriptorHash: context.pin.descriptorHash,
    sceneBytesAttested: false,
    editorApplyVerified: false,
    networkWriteAuthorized: false,
  });
}
