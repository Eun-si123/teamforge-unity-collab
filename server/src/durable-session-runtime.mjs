import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { loadStoredPublication } from "../../project-peer/src/stored-publication.mjs";
import { descriptorIsCompatible, verifyProjectDescriptor } from "./project-coordinator.mjs";
import { validateText } from "./protocol.mjs";
import { captureRealtimeCheckpoint, makeSessionKey, restoreRealtimeCheckpoint } from "./session-authority.mjs";
import { openDurableSessionStore } from "./durable-session-store.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function signedPin(scope, descriptor) {
  return { projectId:scope.projectId, projectUuid:scope.projectUuid,
    baselineRevision:descriptor.baselineRevision, manifestHash:descriptor.manifestHash,
    descriptorHash:descriptor.descriptorHash, ownerKeyId:descriptor.ownerKeyId };
}

function publicationRecord(baseline) {
  const { publishedByUserId, publishedByConnectionId, publishedAtUnixMs } = baseline ?? {};
  if (validateText(publishedByUserId, "Published-by user ID", 128) ||
      validateText(publishedByConnectionId, "Published-by connection ID", 128) ||
      !Number.isSafeInteger(publishedAtUnixMs) || publishedAtUnixMs <= 0 || publishedAtUnixMs > 253402300799999)
    throw new Error("The durable Project publication record is invalid.");
  return { publishedByUserId, publishedByConnectionId, publishedAtUnixMs };
}

export class DurableSessionRuntime {
  constructor({ filePath, managedRoot, authority, coordinator, components }) {
    this.authority = authority;
    this.coordinator = coordinator;
    this.components = components;
    this.managedRoot = managedRoot;
    this.store = openDurableSessionStore({ filePath });
    this.checkpoints = new Map();
    this.approvedProjects = new Map();
    this.ready = false;
  }

  async approveProject(projectId, baseline) {
    if (!baseline || !descriptorIsCompatible(baseline))
      throw new Error("Durable editing requires a compatible signed Project publication.");
    const verified = verifyProjectDescriptor(baseline, projectId);
    if (verified.error) throw new Error("Durable Project descriptor failed signature verification.");
    // userId belongs to the publishing wire request. A coordinator snapshot
    // carries the descriptor and signer keys without that transient field.
    const {userId: _publishingUser, ...descriptor} = verified.descriptor;
    const prior = this.approvedProjects.get(projectId);
    if (prior && prior.descriptorHash === descriptor.descriptorHash) return prior;
    if (prior) throw new Error("Durable Sessions require a Project checkpoint to change their signed baseline.");
    const stored = await loadStoredPublication({ managedRoot:this.managedRoot, projectId,
      projectUuid:descriptor.projectUuid, manifestHash:descriptor.manifestHash, requireApproved:true });
    if (stored.descriptor.descriptorHash !== descriptor.descriptorHash || stored.descriptor.ownerKeyId !== descriptor.ownerKeyId)
      throw new Error("Durable Project publication differs from the approved managed source.");
    // Another verified request may have completed during the store read.
    const current = this.approvedProjects.get(projectId);
    if (current && current.descriptorHash !== descriptor.descriptorHash)
      throw new Error("The approved durable Project changed during verification.");
    this.approvedProjects.set(projectId, Object.freeze(descriptor));
    return descriptor;
  }

  async restore() {
    if (this.ready) return;
    // SQLite's checkpoint repin is atomic but the Host approved filesystem
    // pointer and Guest Active revisions are separate stores. Never pretend
    // the Project is recovered until that boundary is reconciled explicitly.
    if (this.store.listProjectTransitionJournals().length)
      throw new Error('An M4/M5 signed Project transition is unresolved; do not resume live Editor authority.');
    const recovered = [];
    const projects = new Map();
    for (const record of this.store.loadAll()) {
      const {scope, checkpoint} = record;
      const key = makeSessionKey(scope.projectId, scope.sessionId);
      if (checkpoint?.version !== 1 || !UUID.test(checkpoint.lineageId) || checkpoint.realtime?.revision !== record.revision ||
          checkpoint.project?.projectUuid !== scope.projectUuid || recovered.some(entry => entry.key === key))
        throw new Error("A durable Session checkpoint has invalid scope, revision or lineage.");
      const descriptor = await this.approveProject(scope.projectId, checkpoint.project);
      const publication = publicationRecord(checkpoint.publication);
      const existingProject = projects.get(scope.projectId);
      if (existingProject && !isDeepStrictEqual(publicationRecord(existingProject.baseline), publication))
        throw new Error("Durable Sessions for the same Project disagree on its publication record.");
      if (!existingProject) {
        projects.set(scope.projectId, { projectId:scope.projectId,
          projectUuid:descriptor.projectUuid, ownerKeyId:descriptor.ownerKeyId, ownerPublicKey:descriptor.ownerPublicKey,
          baseline:{ ...descriptor, ...publication }, bootstrapPublisherConnectionId:"" });
      }
      const session = restoreRealtimeCheckpoint(checkpoint.realtime, this.authority.config);
      session.durableEpoch = randomUUID();
      if ((!this.components?.enablePrimitives) &&
          ([...session.hierarchyObjects.values()].some(row => row.primitiveTemplate) || checkpoint.components?.collider?.primitiveOwners?.length))
        throw new Error("Enable shared primitive templates before opening this durable Session.");
      if (checkpoint.components) {
        if (!this.components) throw new Error("Enable Collider collaboration before opening this durable Session.");
        await this.components.restoreCheckpoint(session, checkpoint.components, signedPin(scope, descriptor), session.durableEpoch);
      }
      session.durableLineageId = checkpoint.lineageId;
      session.durableRetained = true;
      recovered.push({key, scope, session, record});
    }

    // Retire all old epochs atomically, after every Session and Collider
    // checkpoint has passed validation. A crash or SQLite failure cannot
    // leave only some Sessions re-epoch'd. Expose recovered authority only
    // after the single durable transaction commits successfully.
    this.store.rotateRecoveredEpochs({sessions:recovered.map(({scope,session,record}) => ({
      scope, previousEpoch:record.epoch, nextEpoch:session.durableEpoch,
      revision:record.revision, expectedChecksum:record.checksum,
    }))});
    for (const {key, scope, session, record} of recovered) {
      this.checkpoints.set(key, {scope, revision:record.revision});
      this.authority.sessions.set(key, session);
    }
    // Original publication attribution is historical. Registration still
    // starts empty, with no restored Publisher, peers or transfer endpoints.
    for (const [projectId, project] of projects) this.coordinator.projects.set(projectId, project);
    this.ready = true;
  }

  lineageFor(session) {
    if (!session.durableLineageId) session.durableLineageId = randomUUID();
    if (!session.durableEpoch) session.durableEpoch = randomUUID();
    return session.durableLineageId;
  }

  commit(connection, session, operation = null) {
    const descriptor = this.approvedProjects.get(connection.projectId);
    const liveDescriptor = this.coordinator.projects.get(connection.projectId)?.baseline;
    if (!this.ready || !descriptor || descriptor.descriptorHash !== liveDescriptor?.descriptorHash)
      throw new Error("The exact current Project must be approved before committing durable edits.");
    const key = makeSessionKey(connection.projectId, connection.sessionId);
    if (this.authority.sessions.get(key) !== session) throw new Error("The durable Session changed before commit.");
    const scope = {projectId:connection.projectId, sessionId:connection.sessionId, projectUuid:descriptor.projectUuid};
    const prior = this.checkpoints.get(key);
    const checkpoint = {version:1, lineageId:this.lineageFor(session), project:descriptor,
      publication:publicationRecord(liveDescriptor),
      realtime:captureRealtimeCheckpoint(session), components:this.components?.captureCheckpoint(session) ?? null};
    const saved = this.store.commit({scope, epoch:session.durableEpoch, baseRevision:prior?.revision ?? 0,
      revision:session.revision, checkpoint, operation});
    this.checkpoints.set(key, {scope, revision:saved.revision});
    session.durableRetained = true;
    return saved;
  }

  close() { this.store.close(); }
}
