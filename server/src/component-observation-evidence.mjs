// Source-only, bounded, in-memory WP6 corroboration of independent Editor
// observations. This is NOT a trusted Project/Scene baseline or an identity
// attestation. User IDs come from authenticated *Session* membership but do
// not prove truly independent people/devices or unmodified Unity projects.
// No remote property values, Scene writes, repair, locks or operation revisions.
const evidence = new WeakMap();
const MAX_RECORDED_PEERS = 64;
const EVIDENCE_LEVEL = "unverified_peer_observations";

export function registerFirstEditorColliderEvidence(session, connection, message) {
  if (!session || typeof session !== "object" || !connection ||
      !message || evidence.has(session) ||
      !(session.members instanceof Map) ||
      session.members.get(connection.userId)?.connectionId !== connection.connectionId ||
      !Number.isSafeInteger(session.revision) || session.revision !== message.baseRevision) {
    return false;
  }
  evidence.set(session, {
    sceneId: message.sceneId,
    objectId: message.objectId,
    componentId: message.componentId,
    typeName: message.typeName,
    originUserId: connection.userId,
    declaredRevision: session.revision,
    peerReports: new Map(),
  });
  return true;
}

function compatible(origin, message, session) {
  return origin.sceneId === message.sceneId &&
    origin.objectId === message.objectId &&
    origin.componentId === message.componentId &&
    origin.typeName === message.typeName &&
    origin.declaredRevision === session.revision;
}
function currentMember(session, report) {
  return session.members.get(report.userId)?.connectionId === report.connectionId;
}

// Invoked ONLY after the separate comparison validator has established exact
// membership, target, complete typed values and server revision. A new report
// replaces the same stable User ID, including a previous mismatch. Superseded
// connections and departed members can never count as current corroboration.
export function observeIndependentColliderComparison(session, connection, message, verdict) {
  const origin = session && typeof session === "object" ? evidence.get(session) : null;
  if (!origin || !compatible(origin, message, session) ||
      !connection || session.members.get(connection.userId)?.connectionId !== connection.connectionId ||
      !verdict || !["observations_match", "observations_differ"].includes(verdict.status)) {
    return Object.freeze({
      evidenceLevel: "unavailable",
      agreeingPeerCount: 0,
      divergingPeerCount: 0,
    });
  }

  if (connection.userId !== origin.originUserId) {
    // Bounded LRU; old/stale identities are removed before capacity handling.
    for (const [id, report] of origin.peerReports) {
      if (!currentMember(session, report)) origin.peerReports.delete(id);
    }
    origin.peerReports.delete(connection.userId);
    while (origin.peerReports.size >= MAX_RECORDED_PEERS) {
      origin.peerReports.delete(origin.peerReports.keys().next().value);
    }
    origin.peerReports.set(connection.userId, Object.freeze({
      userId: connection.userId,
      connectionId: connection.connectionId,
      status: verdict.status,
    }));
  }

  let agreeingPeerCount = 0;
  let divergingPeerCount = 0;
  for (const report of origin.peerReports.values()) {
    if (!currentMember(session, report)) continue;
    if (report.status === "observations_match") agreeingPeerCount += 1;
    else divergingPeerCount += 1;
  }
  return Object.freeze({
    evidenceLevel: EVIDENCE_LEVEL,
    agreeingPeerCount,
    divergingPeerCount,
  });
}
