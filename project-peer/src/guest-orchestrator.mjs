import { EventEmitter } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { chmod, link, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseGuestInvite } from "./bootstrap-invite.mjs";
import { ChunkStore } from "./content-store.mjs";
import { CoordinatorClient } from "./coordinator-client.mjs";
import { TeamForgePeerError, fail } from "./errors.mjs";
import { inspectGuestDestination, prepareGuestDestination } from "./guest-destination.mjs";
import { inspectGuestStateRoot, prepareGuestStateRoot } from "./guest-state.mjs";
import {
  compareGuestTrustPin,
  readGuestTrustPin,
  writeGuestTrustPin,
} from "./guest-trust.mjs";
import { ManagedProjectStore } from "./managed-project.mjs";
import { ProjectPeerEngine } from "./project-peer.mjs";
import { assessWindowsUnityActivePath } from "./cli-policy.mjs";

const MAXIMUM_AUTHENTICATION_TOKEN_LENGTH = 8_192;
const MAXIMUM_GUEST_HANDOFF_BYTES = 65_536;
const GUEST_HANDOFF_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

const FRIENDLY_ERRORS = Object.freeze({
  access_code_incorrect: [
    "Access code is incorrect.",
    "Enter the access code again and retry.",
  ],
  active_descriptor_mismatch: [
    "The received Project no longer matches its approved Baseline.",
    "Receive the Project again or ask the Host for a new invite.",
  ],
  active_metadata_invalid: [
    "The received Project metadata is damaged.",
    "Receive the Project again into a new TeamForge Projects folder.",
  ],
  active_metadata_mismatch: [
    "The received Project metadata does not match its approved Baseline.",
    "Receive the Project again or ask the Host for help.",
  ],
  active_project_reparse_point: [
    "The Project folder contains an unsafe redirected path.",
    "Choose a normal local folder and receive the Project again.",
  ],
  active_teamforge_package_incompatible: [
    "This Project needs a different TeamForge version.",
    "Update TeamForge or ask the Host to send a compatible Project.",
  ],
  active_teamforge_package_missing: [
    "The received Project does not contain TeamForge.",
    "Ask the Host to publish the Project with the TeamForge Package included.",
  ],
  baseline_unavailable: [
    "The Host Project is not ready to receive yet.",
    "Keep the Host online and try again.",
  ],
  coordinator_closed: [
    "Host cannot be reached.",
    "Check the network and ask the Host to keep collaboration running.",
  ],
  coordinator_error: [
    "Host cannot be reached.",
    "Check the network and try again.",
  ],
  coordinator_timeout: [
    "Host cannot be reached.",
    "Check the network and try again.",
  ],
  destination_contains_unmanaged_content: [
    "TeamForge will not overwrite the selected folder.",
    "Choose an empty folder or your existing TeamForge Projects folder.",
  ],
  destination_overlaps_runtime: [
    "The Project cannot be stored inside the TeamForge application folder.",
    "Choose Documents/TeamForge Projects or another normal folder.",
  ],
  direct_transfer_unavailable: [
    "Required project revision could not be downloaded.",
    "Keep the Host online and try again; completed verified data will be reused.",
  ],
  download_cancelled: [
    "Receiving was cancelled.",
    "Start again to reuse completed verified data.",
  ],
  guest_cancelled: [
    "Receiving was cancelled.",
    "Start again to reuse completed verified data.",
  ],
  guest_handoff_cleanup_failed: [
    "TeamForge stopped before opening the received Project.",
    "Close TeamForge and ask for help before trying to open the Project.",
  ],
  guest_state_conflict: [
    "TeamForge Launcher state is not safe to reuse.",
    "Close TeamForge and ask for help before changing its application data.",
  ],
  guest_state_root_overlap: [
    "TeamForge application state must be separate from the Project and application files.",
    "Restore the default TeamForge Launcher configuration.",
  ],
  guest_trust_project_conflict: [
    "Stored trust belongs to a different TeamForge Project.",
    "Stop and choose the correct Project folder; do not ignore this warning.",
  ],
  invalid_authentication_token: [
    "The optional Server access code is not valid.",
    "Enter the access code again or leave it empty when the Host does not require one.",
  ],
  invalid_bootstrap_invite: [
    "Invite is invalid or damaged.",
    "Copy a new invite from the Host.",
  ],
  invalid_guest_destination: [
    "The selected Project folder is not valid.",
    "Choose a normal local folder.",
  ],
  invalid_invite: [
    "Invite is invalid or damaged.",
    "Copy a new invite from the Host.",
  ],
  invalid_guest_state_marker: [
    "TeamForge Launcher state is damaged.",
    "Close TeamForge and ask for help before changing its application data.",
  ],
  invalid_guest_state_root: [
    "TeamForge Launcher state location is invalid.",
    "Restore the default TeamForge Launcher configuration.",
  ],
  invalid_join_code: [
    "Invite is invalid or damaged.",
    "Copy a new invite from the Host.",
  ],
  invite_conflict: [
    "This project belongs to a different collaboration.",
    "Paste the correct invite for this existing TeamForge Projects folder.",
  ],
  path_length_risk: [
    "Project path is too long or unsafe.",
    "Choose a shorter project location, such as C:\\TF.",
  ],
  project_transfer_not_negotiated: [
    "This Server cannot provide the Host Project safely.",
    "Ask the Host to update or restart TeamForge, then try again.",
  ],
  publisher_not_trusted: [
    "The Project Publisher was not trusted.",
    "Review the fingerprint with the Host before approving it.",
  ],
  unsafe_guest_destination: [
    "Project path is too long or unsafe.",
    "Choose a shorter safe folder on a normal local drive.",
  ],
  teamforge_version_mismatch: [
    "TeamForge version mismatch.",
    "Use a Launcher that matches the invite version, then paste the invite again.",
  ],
  unsafe_guest_state_root: [
    "TeamForge Launcher state location is unsafe.",
    "Restore the default TeamForge Launcher configuration.",
  ],
  untrusted_owner: [
    "The Server Project identity conflicts with the signed Host invite.",
    "Stop and ask the Host for a new invite; do not ignore this warning.",
  ],
});

const DIAGNOSTIC_STRING_FIELDS = Object.freeze([
  "operation", "role", "projectIdentity", "managedRoot", "endpoint", "activePath",
  "unityVersion", "processOwnershipState", "coordinatorSeedHealthIdentity", "transferState",
  "stagingPath", "runtimeVerificationStage", "inviteProductVersion", "runtimeProductVersion",
]);

function diagnosticSnapshot(value, secrets) {
  const source = value && typeof value === "object" ? value : {};
  const result = {};
  for (const field of DIAGNOSTIC_STRING_FIELDS) {
    if (typeof source[field] === "string" && source[field].length > 0) {
      result[field] = scrub(source[field], secrets);
    }
  }
  for (const field of ["baselineRevision", "activeRevision"]) {
    if (Number.isSafeInteger(source[field]) && source[field] >= 0) result[field] = source[field];
  }
  for (const field of ["previousVerifiedActiveAvailable", "pathLengthHighRisk"]) {
    if (typeof source[field] === "boolean") result[field] = source[field];
  }
  return Object.freeze(result);
}

function scrub(value, secrets) {
  let result = String(value ?? "");
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length > 0) result = result.split(secret).join("[redacted]");
  }
  return result.replace(/[\r\n\u0000]/gu, " ").slice(0, 2_048);
}

export function guestErrorInfo(error, { secrets = [], diagnostics = {} } = {}) {
  const rawCode = typeof error?.code === "string" && /^[a-z0-9_]{1,80}$/u.test(error.code)
    ? error.code
    : "guest_bootstrap_failed";
  const friendly = FRIENDLY_ERRORS[rawCode] ?? [
    "TeamForge could not finish receiving this Project.",
    "Try again, or open Advanced details when asking for help.",
  ];
  return {
    code: rawCode,
    userMessage: friendly[0],
    recoveryAction: friendly[1],
    technicalDetail: scrub(`${rawCode}: ${error?.message ?? "Unknown Guest bootstrap failure."}`, secrets),
    diagnostics: diagnosticSnapshot({
      ...diagnostics,
      stagingPath: error?.details?.stagingPath ?? diagnostics.stagingPath,
      inviteProductVersion: error?.details?.inviteProductVersion ?? diagnostics.inviteProductVersion,
      runtimeProductVersion: error?.details?.runtimeProductVersion ?? diagnostics.runtimeProductVersion,
    }, secrets),
  };
}

function validateAuthenticationToken(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || value.length > MAXIMUM_AUTHENTICATION_TOKEN_LENGTH ||
      /[\u0000\r\n]/u.test(value)) {
    fail("invalid_authentication_token", "Optional Server access code is invalid.");
  }
  return value;
}

function exactSnapshotIdentity(snapshot, invite) {
  if (!snapshot || snapshot.projectId !== invite.projectId || snapshot.projectUuid !== invite.projectUuid ||
      snapshot.baseline?.projectUuid !== invite.projectUuid ||
      snapshot.baseline?.ownerKeyId !== invite.ownerKeyId) {
    fail("untrusted_owner", "Coordinator snapshot conflicts with the signed Project invite.");
  }
}

function trustSummaryFromResult({ projectInvite, descriptor, manifest, sourcePeers = [] }) {
  if (descriptor.projectId !== projectInvite.projectId || descriptor.projectUuid !== projectInvite.projectUuid ||
      descriptor.ownerKeyId !== projectInvite.ownerKeyId || descriptor.manifestHash !== manifest.manifestHash ||
      descriptor.baselineRevision !== manifest.baselineRevision) {
    fail("untrusted_owner", "Signed Baseline identity conflicts with the signed Project invite.");
  }
  return {
    projectId: descriptor.projectId,
    projectUuid: descriptor.projectUuid,
    baselineRevision: descriptor.baselineRevision,
    manifestHash: descriptor.manifestHash,
    ownerKeyId: descriptor.ownerKeyId,
    publisherKeyId: descriptor.publisherKeyId,
    publisherFingerprint: descriptor.publisherKeyId,
    containsScripts: manifest.files.some((file) => file.script),
    containsPackages: manifest.files.some((file) => file.kind === "package"),
    totalFiles: manifest.totalFiles,
    totalBytes: manifest.totalBytes,
    sourcePeers,
  };
}

async function writeGuestHandoff(guestStateRoot, value) {
  const handoffRoot = path.join(guestStateRoot, "handoff");
  const destination = path.join(handoffRoot, `${randomUUID()}.json`);
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  const digest = createHash("sha256").update(serialized, "utf8").digest("hex");
  await mkdir(handoffRoot, { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await writeFile(temporary, serialized, { flag: "wx", mode: 0o600 });
  await chmod(temporary, 0o600).catch(() => {});
  try {
    await link(temporary, destination);
  } catch (error) {
    throw error;
  } finally {
    await rm(temporary, { force: true });
  }
  return { handoffPath: destination, handoffSha256: digest };
}

async function removeInterruptedGuestHandoff(guestStateRoot, handoff) {
  const handoffRoot = path.resolve(guestStateRoot, "handoff");
  const destination = typeof handoff?.handoffPath === "string"
    ? path.resolve(handoff.handoffPath)
    : "";
  if (!destination || path.dirname(destination) !== handoffRoot ||
      !GUEST_HANDOFF_NAME.test(path.basename(destination)) ||
      !SHA256.test(handoff?.handoffSha256 ?? "")) {
    fail("guest_handoff_cleanup_failed", "Interrupted Guest handoff identity is unsafe to remove.");
  }
  const information = await lstat(destination).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!information) return;
  if (!information.isFile() || information.isSymbolicLink() ||
      information.size <= 0 || information.size > MAXIMUM_GUEST_HANDOFF_BYTES) {
    fail("guest_handoff_cleanup_failed", "Interrupted Guest handoff is not a bounded regular file.");
  }
  const bytes = await readFile(destination);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== handoff.handoffSha256) {
    fail("guest_handoff_cleanup_failed", "Interrupted Guest handoff changed before cleanup.");
  }
  await rm(destination);
  const remaining = await lstat(destination).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (remaining) {
    fail("guest_handoff_cleanup_failed", "Interrupted Guest handoff could not be removed.");
  }
}

export class TeamForgeGuestOrchestrator extends EventEmitter {
  constructor({
    forbiddenRoots = [],
    engineFactory = (managedRoot) => new ProjectPeerEngine({ managedRoot }),
    coordinatorFactory = (options) => new CoordinatorClient(options),
    managedStoreFactory = (options) => new ManagedProjectStore(options),
    handoffWriter = writeGuestHandoff,
    syncOptions = {},
  } = {}) {
    super();
    this.forbiddenRoots = forbiddenRoots.map((entry) => path.resolve(entry));
    this.engineFactory = engineFactory;
    this.coordinatorFactory = coordinatorFactory;
    this.managedStoreFactory = managedStoreFactory;
    this.handoffWriter = handoffWriter;
    this.syncOptions = { ...syncOptions };
    this.active = null;
    this.currentRunHistory = [];
    this.lastDiagnosticState = Object.freeze({ role: "Guest", operation: "idle" });
  }

  #event(active, event) {
    const emitted = Object.freeze({ operationId: active.operationId, ...event });
    this.currentRunHistory.push(emitted);
    if (this.currentRunHistory.length > 32) this.currentRunHistory.splice(0, this.currentRunHistory.length - 32);
    this.lastDiagnosticState = Object.freeze({
      ...this.lastDiagnosticState,
      operation: event.state ?? event.operation ?? event.event ?? active.state ?? "guest_receive",
      transferState: event.state ?? active.state ?? "",
    });
    this.emit("guestEvent", emitted);
  }

  diagnostics() {
    return Object.freeze({ ...this.lastDiagnosticState, historyCount: this.currentRunHistory.length });
  }

  async inspect({ invite, managedRoot, stateRoot }) {
    const parsed = parseGuestInvite(invite);
    const destination = await inspectGuestDestination({
      destinationRoot: managedRoot,
      forbiddenRoots: this.forbiddenRoots,
    });
    const existingProject = destination.projects.find((item) =>
      item.projectUuid === parsed.projectInvite.projectUuid);
    const state = await inspectGuestStateRoot({
      stateRoot,
      forbiddenRoots: this.forbiddenRoots,
      destinationRoot: destination.destination,
    });
    const trust = existingProject && state.managed
      ? await readGuestTrustPin(state.guestRoot, parsed.projectInvite.projectUuid)
      : { state: "missing", pin: null };
    let current = null;
    if (existingProject) {
      const metadataRoot = path.join(destination.destination, parsed.projectInvite.projectUuid, "metadata");
      const managed = this.managedStoreFactory({
        managedRoot: destination.destination,
        projectUuid: parsed.projectInvite.projectUuid,
        chunkStore: new ChunkStore(path.join(metadataRoot, "chunks")),
      });
      current = await managed.validatedCurrent();
    }
    const pathAssessment = assessWindowsUnityActivePath({
      managedRoot: destination.destination,
      projectUuid: parsed.projectInvite.projectUuid,
      baselineRevision: Math.max(1, Number(current?.baselineRevision ?? 0) + 1),
      manifestHash: "0".repeat(64),
    });
    const projectIdentity = parsed.projectInvite.projectUuid.length <= 13
      ? parsed.projectInvite.projectUuid
      : `${parsed.projectInvite.projectUuid.slice(0, 8)}…${parsed.projectInvite.projectUuid.slice(-4)}`;
    this.lastDiagnosticState = Object.freeze({
      role: "Guest",
      operation: "invite_inspection",
      projectIdentity,
      managedRoot: destination.destination,
      endpoint: parsed.projectInvite.serverAddress,
      baselineRevision: current?.baselineRevision ?? 0,
      activeRevision: current?.baselineRevision ?? 0,
      activePath: current?.activePath ?? "",
      unityVersion: current?.unityVersion ?? "",
      processOwnershipState: "not_applicable_guest",
      coordinatorSeedHealthIdentity: "not_connected",
      transferState: "inspected",
      stagingPath: "",
      previousVerifiedActiveAvailable: Boolean(current),
      pathLengthHighRisk: pathAssessment.highRisk,
    });
    return {
      projectId: parsed.projectInvite.projectId,
      projectUuid: parsed.projectInvite.projectUuid,
      ownerFingerprint: parsed.projectInvite.ownerKeyId,
      serverHost: new URL(parsed.projectInvite.serverAddress).host,
      includesRealtimeSession: Boolean(parsed.sessionJoin),
      destination: destination.destination,
      destinationState: destination.state,
      stateRootState: state.state,
      existingProject: Boolean(existingProject),
      trustState: trust.state,
      trustedPublisherFingerprint: trust.state === "valid" ? trust.pin.publisherKeyId : "",
      projectIdentity,
      managedRoot: destination.destination,
      endpoint: parsed.projectInvite.serverAddress,
      baselineRevision: current?.baselineRevision ?? 0,
      activeRevision: current?.baselineRevision ?? 0,
      activePath: current?.activePath ?? "",
      activeUnityVersion: current?.unityVersion ?? "",
      previousVerifiedActiveAvailable: Boolean(current),
      pathLengthHighRisk: pathAssessment.highRisk,
      estimatedGeneratedPathLength: pathAssessment.estimatedGeneratedPathLength,
    };
  }

  async start({ invite, managedRoot, stateRoot, authenticationToken = "" }) {
    if (this.active) fail("guest_operation_busy", "Another Guest receive operation is already running.");
    const parsed = parseGuestInvite(invite);
    const token = validateAuthenticationToken(authenticationToken);
    const active = {
      operationId: randomUUID(),
      parsed,
      token,
      cancelled: false,
      pauseRequested: false,
      pauseGate: null,
      controller: null,
      coordinator: null,
      trustPending: null,
      state: "starting",
    };
    this.active = active;
    const projectIdentity = parsed.projectInvite.projectUuid.length <= 13
      ? parsed.projectInvite.projectUuid
      : `${parsed.projectInvite.projectUuid.slice(0, 8)}…${parsed.projectInvite.projectUuid.slice(-4)}`;
    this.currentRunHistory = [];
    this.lastDiagnosticState = Object.freeze({
      role: "Guest",
      operation: "starting",
      projectIdentity,
      managedRoot,
      endpoint: parsed.projectInvite.serverAddress,
      processOwnershipState: "not_applicable_guest",
      coordinatorSeedHealthIdentity: "not_connected",
      transferState: "starting",
      previousVerifiedActiveAvailable: false,
    });
    try {
      const destination = await prepareGuestDestination({
        destinationRoot: managedRoot,
        forbiddenRoots: this.forbiddenRoots,
      });
      active.managedRoot = destination.destination;
      const state = await prepareGuestStateRoot({
        stateRoot,
        forbiddenRoots: this.forbiddenRoots,
        destinationRoot: active.managedRoot,
      });
      active.guestStateRoot = state.guestRoot;
      active.engine = this.engineFactory(active.managedRoot);
      const metadataRoot = path.join(active.managedRoot, parsed.projectInvite.projectUuid, "metadata");
      const managed = this.managedStoreFactory({
        managedRoot: active.managedRoot,
        projectUuid: parsed.projectInvite.projectUuid,
        chunkStore: new ChunkStore(path.join(metadataRoot, "chunks")),
      });
      const priorCurrent = await managed.validatedCurrent();
      this.lastDiagnosticState = Object.freeze({
        ...this.lastDiagnosticState,
        managedRoot: active.managedRoot,
        baselineRevision: priorCurrent?.baselineRevision ?? 0,
        activeRevision: priorCurrent?.baselineRevision ?? 0,
        activePath: priorCurrent?.activePath ?? "",
        unityVersion: priorCurrent?.unityVersion ?? "",
        previousVerifiedActiveAvailable: Boolean(priorCurrent),
      });
      this.#event(active, { event: "state", state: "ImportingInvite" });

      // The signed Project Invite is deliberately pinned before any Coordinator snapshot is trusted.
      const imported = await active.engine.importInviteValue({ invite: parsed.projectInvite });
      active.project = imported.project;
      while (true) {
        if (active.cancelled) {
          throw new TeamForgePeerError("guest_cancelled", "Guest receive was cancelled.");
        }
        if (active.pauseRequested) await this.#awaitResume(active);
        active.controller = new AbortController();
        try {
          const result = await this.#attempt(active);
          active.state = "complete";
          this.#event(active, { event: "state", state: "Complete" });
          return result;
        } catch (error) {
          if (error?.code === "guest_handoff_cleanup_failed") throw error;
          if (active.cancelled) {
            throw new TeamForgePeerError("guest_cancelled", "Guest receive was cancelled.");
          }
          if (!active.pauseRequested) throw error;
          await this.#awaitResume(active);
        }
      }
    } finally {
      active.coordinator?.close?.();
      if (this.active === active) this.active = null;
    }
  }

  async #attempt(active) {
    this.#assertContinuing(active);
    const { projectInvite, sessionJoin, envelope } = active.parsed;
    const metadataRoot = active.engine.metadataRoot(projectInvite.projectUuid);
    const trustRecord = await readGuestTrustPin(active.guestStateRoot, projectInvite.projectUuid);
    let trustWasExplicitlyApproved = false;
    const ensureTrust = async (summary) => {
      if (summary.projectId !== projectInvite.projectId || summary.projectUuid !== projectInvite.projectUuid ||
          summary.ownerKeyId !== projectInvite.ownerKeyId) {
        fail("untrusted_owner", "Publisher trust challenge conflicts with the signed Project invite.");
      }
      const comparison = compareGuestTrustPin(trustRecord, summary);
      if (comparison === "match") return true;
      const approved = await this.#requestTrust(active, summary, comparison, trustRecord.pin);
      if (approved) trustWasExplicitlyApproved = true;
      return approved;
    };

    active.state = "connecting";
    this.lastDiagnosticState = Object.freeze({
      ...this.lastDiagnosticState,
      operation: "coordinator_connect",
      transferState: "connecting",
    });
    this.#event(active, { event: "state", state: "Connecting" });
    const coordinator = this.coordinatorFactory({
      serverAddress: projectInvite.serverAddress,
      realtimePath: projectInvite.realtimePath,
      authenticationToken: active.token,
      userId: `guest-${randomUUID()}`,
      userName: "Guest",
      projectId: projectInvite.projectId,
      sessionId: projectInvite.sessionId,
    });
    active.coordinator = coordinator;
    let partialServer = null;
    try {
      const snapshot = await coordinator.connect();
      this.#assertContinuing(active);
      exactSnapshotIdentity(snapshot, projectInvite);
      this.lastDiagnosticState = Object.freeze({
        ...this.lastDiagnosticState,
        coordinatorSeedHealthIdentity: "protocol_v1_project_identity_verified",
        baselineRevision: snapshot.baseline?.baselineRevision ?? this.lastDiagnosticState.baselineRevision ?? 0,
      });
      active.state = "receiving";
      this.#event(active, { event: "state", state: "Receiving" });
      const synced = await active.engine.syncFromSnapshot({
        ...this.syncOptions,
        projectId: projectInvite.projectId,
        snapshot,
        sessionId: projectInvite.sessionId,
        coordinator,
        signal: active.controller.signal,
        trustApproval: ensureTrust,
        onProgress: (progress) => this.#event(active, {
          event: "progress",
          state: progress.state,
          completedBytes: progress.completedBytes,
          remainingBytes: progress.remainingBytes,
          totalBytes: progress.totalBytes,
          completedChunks: progress.completedChunks,
          totalChunks: progress.totalChunks,
          resumedChunks: progress.resumedChunks,
        }),
        onDiagnostic: (diagnostic) => this.#event(active, {
          event: "diagnostic",
          code: diagnostic.errorKind ?? "transfer_diagnostic",
          operation: diagnostic.operation ?? "transfer",
          retryInMilliseconds: diagnostic.retryInMilliseconds ?? 0,
        }),
      });
      partialServer = synced.partialServer;
      this.#assertContinuing(active);
      if (synced.activation?.state !== "Complete") {
        throw new TeamForgePeerError("publisher_not_trusted", "Publisher fingerprint approval was declined.");
      }
      const managed = this.managedStoreFactory({
        managedRoot: active.managedRoot,
        projectUuid: projectInvite.projectUuid,
        chunkStore: new ChunkStore(path.join(metadataRoot, "chunks")),
      });
      const current = await managed.validatedCurrent();
      if (!current || current.manifestHash !== synced.descriptor.manifestHash ||
          current.descriptorHash !== synced.descriptor.descriptorHash) {
        fail("active_metadata_mismatch", "Verified Active Project does not match the received Baseline.");
      }
      if (synced.activation.alreadyActive && compareGuestTrustPin(trustRecord, synced.descriptor) !== "match") {
        const summary = trustSummaryFromResult({
          projectInvite,
          descriptor: synced.descriptor,
          manifest: synced.manifest,
          sourcePeers: synced.download?.peers?.filter((peer) => peer.successes > 0).map((peer) => peer.id) ?? [],
        });
        if (!(await ensureTrust(summary))) {
          throw new TeamForgePeerError("publisher_not_trusted", "Publisher fingerprint approval was declined.");
        }
      }
      if (trustWasExplicitlyApproved) {
        this.#assertContinuing(active);
        await writeGuestTrustPin(active.guestStateRoot, {
          projectUuid: current.projectUuid,
          ownerKeyId: synced.descriptor.ownerKeyId,
          publisherKeyId: synced.descriptor.publisherKeyId,
        });
      }

      let handoff = { handoffPath: "", handoffSha256: "" };
      if (envelope && sessionJoin) {
        this.#assertContinuing(active);
        handoff = await this.handoffWriter(active.guestStateRoot, {
          schemaVersion: 1,
          projectUuid: current.projectUuid,
          baselineRevision: current.baselineRevision,
          manifestHash: current.manifestHash,
          descriptorHash: current.descriptorHash,
          ownerKeyId: synced.descriptor.ownerKeyId,
          publisherKeyId: synced.descriptor.publisherKeyId,
          activeProjectPath: current.activePath,
          sessionJoinCode: envelope.sessionJoinCode,
          createdAtUnixMs: Date.now(),
        });
        try {
          this.#assertContinuing(active);
        } catch (error) {
          try {
            await removeInterruptedGuestHandoff(active.guestStateRoot, handoff);
          } catch {
            throw new TeamForgePeerError(
              "guest_handoff_cleanup_failed",
              "Interrupted Guest handoff could not be removed safely.",
            );
          }
          throw error;
        }
      }
      this.#assertContinuing(active);
      this.lastDiagnosticState = Object.freeze({
        ...this.lastDiagnosticState,
        operation: "complete",
        transferState: "complete",
        baselineRevision: current.baselineRevision,
        activeRevision: current.baselineRevision,
        activePath: current.activePath,
        unityVersion: current.unityVersion,
        previousVerifiedActiveAvailable: true,
      });
      return {
        activePath: current.activePath,
        unityVersion: current.unityVersion,
        projectIdentity: this.lastDiagnosticState.projectIdentity,
        baselineRevision: current.baselineRevision,
        handoffPath: handoff.handoffPath,
        handoffSha256: handoff.handoffSha256,
      };
    } finally {
      active.coordinator = null;
      coordinator.close?.();
      await partialServer?.stop?.().catch(() => {});
    }
  }

  #assertContinuing(active) {
    if (active.cancelled) {
      throw new TeamForgePeerError("guest_cancelled", "Guest receive was cancelled.");
    }
    if (active.pauseRequested) {
      throw new TeamForgePeerError("download_cancelled", "Guest receive was paused.");
    }
  }

  async #awaitResume(active) {
    active.state = "paused";
    this.#event(active, { event: "paused", state: "Paused" });
    await active.pauseGate.promise;
    if (active.cancelled) {
      throw new TeamForgePeerError("guest_cancelled", "Guest receive was cancelled.");
    }
    active.pauseRequested = false;
    active.pauseGate = null;
    active.state = "resuming";
    this.#event(active, { event: "resumed", state: "Resuming" });
  }

  #requestTrust(active, summary, reason, previousPin) {
    if (active.trustPending) fail("trust_challenge_busy", "A Publisher trust decision is already pending.");
    const challengeId = randomUUID();
    active.state = "awaiting_trust";
    const promise = new Promise((resolve, reject) => {
      active.trustPending = { challengeId, resolve, reject };
    });
    this.#event(active, {
      event: "trust",
      challengeId,
      reason,
      projectId: summary.projectId,
      projectUuid: summary.projectUuid,
      baselineRevision: summary.baselineRevision,
      ownerFingerprint: summary.ownerKeyId,
      publisherFingerprint: summary.publisherKeyId,
      previousOwnerFingerprint: reason === "mismatch" ? previousPin?.ownerKeyId ?? "" : "",
      previousPublisherFingerprint: reason === "mismatch" ? previousPin?.publisherKeyId ?? "" : "",
      containsScripts: Boolean(summary.containsScripts),
      containsPackages: Boolean(summary.containsPackages),
      totalFiles: summary.totalFiles,
      totalBytes: summary.totalBytes,
    });
    return promise.finally(() => {
      if (active.trustPending?.challengeId === challengeId) active.trustPending = null;
    });
  }

  trust({ challengeId, approved }) {
    const pending = this.active?.trustPending;
    if (!pending || pending.challengeId !== challengeId || typeof approved !== "boolean") {
      fail("invalid_trust_decision", "Trust decision does not match the active Publisher challenge.");
    }
    pending.resolve(approved);
    return { accepted: true, approved };
  }

  pause() {
    const active = this.active;
    if (!active || active.pauseRequested || active.state === "complete") {
      fail("guest_not_receiving", "There is no running Guest receive operation to pause.");
    }
    active.pauseRequested = true;
    active.state = "pausing";
    active.pauseGate = {};
    active.pauseGate.promise = new Promise((resolve) => { active.pauseGate.resolve = resolve; });
    active.trustPending?.reject(new TeamForgePeerError("download_cancelled", "Guest receive was paused."));
    active.controller?.abort();
    try { active.coordinator?.close?.(); } catch {}
    return { accepted: true, state: "Pausing" };
  }

  resume() {
    const active = this.active;
    if (!active?.pauseRequested || !active.pauseGate) {
      fail("guest_not_paused", "There is no paused Guest receive operation to resume.");
    }
    active.pauseGate.resolve();
    return { accepted: true, state: "Resuming" };
  }

  cancel() {
    const active = this.active;
    if (!active) return { accepted: true, state: "Idle" };
    active.cancelled = true;
    active.state = "cancelling";
    active.trustPending?.reject(new TeamForgePeerError("guest_cancelled", "Guest receive was cancelled."));
    active.controller?.abort();
    active.pauseGate?.resolve?.();
    try { active.coordinator?.close?.(); } catch {}
    return { accepted: true, state: "Cancelling" };
  }
}
