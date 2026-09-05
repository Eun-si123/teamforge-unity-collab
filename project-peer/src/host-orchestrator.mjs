import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { parseSessionJoinCode } from "./bootstrap-invite.mjs";
import { enforceNoOpPublishPolicy } from "./cli-policy.mjs";
import { TeamForgePeerError } from "./errors.mjs";
import { loadLaunchSettings } from "./launch-settings.mjs";
import { uniqueManifestChunks } from "./manifest.mjs";
import { normalizeOrchestratorFailure, ORCHESTRATOR_API_VERSION } from "./orchestrator-contract.mjs";
import {
  createPublishReviewFingerprint,
  launchSettingsDigest,
  publicPublishReview,
} from "./publication-plan.mjs";
import { TeamForgeProcessLifecycleManager } from "./process-lifecycle.mjs";
import { CoordinatorClient, ProjectPeerEngine } from "./project-peer.mjs";
import { inspectPreflight, repairDependencies } from "./unified-preflight.mjs";

export const DEFAULT_LAN_SEED_PORT = 5091;

function normalizePreferredSeedPort(value) {
  if (value === undefined || value === null) return DEFAULT_LAN_SEED_PORT;
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new TeamForgePeerError(
      "invalid_lifecycle_config",
      "Preferred LAN Seed port must be an integer between 1 and 65535.",
    );
  }
  return value;
}

function canFallbackSeedPort(error) {
  if (error?.code === "EADDRINUSE") return true;
  if (error?.code !== "port_conflict") return false;
  if (error?.details?.causeCode === "EADDRINUSE") return true;
  return /^Direct Seed (?:publish )?port is occupied\b/u.test(String(error.message ?? ""));
}

async function startWithPreferredSeedPort(preferredPort, start) {
  try {
    return await start(preferredPort);
  } catch (error) {
    if (!canFallbackSeedPort(error)) throw error;
    return start(0);
  }
}

function failureResult(operationId, operation, error) {
  return Object.freeze({
    apiVersion: ORCHESTRATOR_API_VERSION,
    operationId,
    operation,
    state: "needs_action",
    failure: normalizeOrchestratorFailure(error),
  });
}

function normalizedHost(value) {
  const host = String(value ?? "").trim();
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function isLoopbackHost(value) {
  const host = normalizedHost(value).toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;
  if (isIP(host) === 4) return host.split(".")[0] === "127";
  return false;
}

function isWildcardHost(value) {
  const host = normalizedHost(value);
  return host === "0.0.0.0" || host === "::";
}

export function resolveCoordinatorEndpoint(settings, authToken = "") {
  let url;
  try {
    url = new URL(settings.serverAddress);
  } catch {
    throw new TeamForgePeerError("invalid_launch_settings", "Coordinator address is invalid.");
  }
  if (url.protocol !== "http:" || url.username || url.password || url.search || url.hash ||
      (url.pathname !== "/" && url.pathname !== "")) {
    throw new TeamForgePeerError(
      "invalid_launch_settings",
      "WP3 managed Coordinator requires a credential-free HTTP origin; export updated launch settings.",
    );
  }
  const advertisedHost = normalizedHost(url.hostname);
  const listenHost = normalizedHost(settings.coordinatorListenHost ?? advertisedHost);
  const advertisedLocalOnly = isLoopbackHost(advertisedHost);
  const listenLocalOnly = isLoopbackHost(listenHost);
  const listenExposed = isWildcardHost(listenHost) || !listenLocalOnly;
  if (isWildcardHost(advertisedHost) || (listenExposed && advertisedLocalOnly) ||
      (listenLocalOnly && !advertisedLocalOnly)) {
    throw new TeamForgePeerError(
      "invalid_launch_settings",
      "Coordinator listen address and advertised Guest endpoint are inconsistent. " +
        "Use an explicit LAN Guest address for LAN hosting or explicit loopback for local-only hosting.",
    );
  }
  if (listenExposed && !String(authToken ?? "").trim()) {
    throw new TeamForgePeerError(
      "invalid_launch_settings",
      "LAN hosting requires a separately shared Coordinator access code before any non-loopback listener is started.",
    );
  }
  return {
    host: listenHost,
    advertisedHost,
    port: url.port ? Number(url.port) : 80,
    healthPath: "/health",
    wsPath: `/${settings.realtimePath.replace(/^\/+|\/+$/gu, "")}`,
  };
}

async function buildLocalPlan(launch, { forceNewRevision = false } = {}) {
  const engine = new ProjectPeerEngine({ managedRoot: launch.managedRoot });
  const settings = launch.settings;
  const source = await engine.resolveSourceProject({
    projectRoot: launch.sourceProjectRoot,
    projectId: settings.projectId,
    expectedProjectUuid: settings.projectUuid,
    projectDescriptorPath: launch.projectDescriptorPath,
    requireDescriptor: true,
  });
  const local = source.sourceDescriptorState.descriptor;
  let previousPublication = null;
  if (local.baselineRevision > 0) {
    previousPublication = await engine.loadPublication({
      projectId: settings.projectId,
      manifestHash: local.manifestHash,
      requireApproved: true,
    });
    if (previousPublication.descriptor.descriptorHash !== local.descriptorHash ||
        previousPublication.descriptor.baselineRevision !== local.baselineRevision ||
        previousPublication.descriptor.projectUuid !== local.projectUuid) {
      throw new TeamForgePeerError(
        "owner_metadata_mismatch",
        "Local approved metadata does not exactly match the source Project descriptor.",
      );
    }
  }
  const ownerEnvironment = settings.ownerKeyEnvironmentVariable;
  const publication = await engine.preparePublication({
    projectRoot: launch.sourceProjectRoot,
    projectId: settings.projectId,
    projectUuid: settings.projectUuid,
    baselineRevision: local.baselineRevision + 1,
    ownerKeyPath: ownerEnvironment ? process.env[ownerEnvironment] : undefined,
    projectDescriptorPath: launch.projectDescriptorPath,
    requireSourceDescriptor: true,
    expectedOwnerKeyId: previousPublication?.descriptor.ownerKeyId ?? "",
  });
  const review = engine.summarizePublicationChanges(
    publication.manifest,
    previousPublication?.manifest ?? null,
    publication.embeddedPackages,
  );
  const hasChanges = review.addedCount > 0 || review.changedCount > 0 || review.deletedCount > 0;
  const reuseExistingBaseline = !hasChanges && previousPublication && !forceNewRevision;
  if (!reuseExistingBaseline) {
    enforceNoOpPublishPolicy({ "force-new-revision": forceNewRevision || undefined }, review);
  }
  review.reuseExistingBaseline = Boolean(reuseExistingBaseline);
  const selectedPublication = reuseExistingBaseline ? previousPublication : publication;
  const mode = reuseExistingBaseline ? "existing_baseline" : "publish";
  const fingerprint = createPublishReviewFingerprint({
    launchDigest: await launchSettingsDigest(launch.filePath),
    sourceDescriptorDigest: publication.sourceDescriptorState.digest,
    baselineRevision: selectedPublication.descriptor.baselineRevision,
    manifestHash: selectedPublication.manifest.manifestHash,
    review,
    hostMode: mode,
  });
  return {
    engine,
    publication: selectedPublication,
    previousPublication,
    review,
    fingerprint,
    launch,
    mode,
  };
}

function coordinatorOptions(settings, authToken) {
  return {
    serverAddress: settings.serverAddress,
    realtimePath: settings.realtimePath,
    authenticationToken: authToken,
    userId: `wp3-host-${randomUUID()}`,
    userName: "TeamForge Host Orchestrator",
    projectId: settings.projectId,
    sessionId: settings.sessionId,
  };
}

async function inspectCoordinatorBaseline(settings, authToken, expectedProjectUuid) {
  const client = new CoordinatorClient(coordinatorOptions(settings, authToken));
  try {
    const snapshot = await client.connect();
    if (snapshot.projectUuid && snapshot.projectUuid !== expectedProjectUuid) {
      throw new TeamForgePeerError(
        "project_uuid_conflict",
        "Coordinator Project UUID conflicts with the local Owner project.",
      );
    }
    return snapshot.baseline ?? null;
  } finally {
    client.close();
  }
}

function exactBaselineMatches(descriptor, baseline) {
  return Boolean(baseline) && descriptor.projectUuid === baseline.projectUuid &&
    descriptor.baselineRevision === baseline.baselineRevision &&
    descriptor.manifestHash === baseline.manifestHash &&
    descriptor.descriptorHash === baseline.descriptorHash &&
    descriptor.ownerKeyId === baseline.ownerKeyId;
}

async function assertCompleteApprovedPublication(publication) {
  const chunks = uniqueManifestChunks(publication.manifest);
  const available = await publication.store.inventory(chunks.map((chunk) => chunk.hash));
  if (available.length !== chunks.length) {
    throw new TeamForgePeerError(
      "baseline_unavailable",
      "The signed approved Baseline is incomplete locally and cannot safely re-arm the Coordinator.",
    );
  }
}

function assertRealtimeSceneMatchesPublication(realtimeJoinCode, publication) {
  const session = parseSessionJoinCode(realtimeJoinCode);
  const scene = session.sceneBaseline;
  const entry = scene
    ? publication?.manifest?.files?.find((file) => file.path === scene.scenePath)
    : null;
  if (!scene || !entry || entry.fileHash !== scene.sha256) {
    throw new TeamForgePeerError(
      "source_changed",
      "Realtime Scene fingerprint does not match the exact reviewed Project Baseline.",
    );
  }
  return session;
}

export class TeamForgeHostOrchestrator {
  constructor({ workspaceRoot, lifecycleManager = undefined } = {}) {
    if (!workspaceRoot || !path.isAbsolute(workspaceRoot)) {
      throw new TeamForgePeerError("invalid_lifecycle_config", "Host orchestrator requires an absolute workspace root.");
    }
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.lifecycle = lifecycleManager ?? new TeamForgeProcessLifecycleManager({ workspaceRoot: this.workspaceRoot });
    this.plans = new Map();
    this.coordinatorHandle = null;
    this.seedHandle = null;
    this.rearmSeedHandle = null;
    this.ready = null;
  }

  async inspect({ launchSettingsPath = undefined } = {}) {
    return inspectPreflight({
      workspaceRoot: this.workspaceRoot,
      ...(launchSettingsPath ? { launchSettingsPath } : {}),
      serverPort: 0,
      seedPort: 0,
    });
  }

  async repairDependencies({ confirmed = false } = {}) {
    if (!confirmed) {
      throw new TeamForgePeerError("operation_cancelled", "Dependency repair requires explicit confirmation.");
    }
    return repairDependencies({
      workspaceRoot: this.workspaceRoot,
      confirmRepair: true,
      serverPort: 0,
      seedPort: 0,
    });
  }

  async planHost({ launchSettingsPath, forceNewRevision = false } = {}) {
    const operationId = randomUUID();
    try {
      const preflight = await this.inspect({ launchSettingsPath });
      if (preflight.state !== "idle") {
        return Object.freeze({ ...preflight, operationId, operation: "planHost" });
      }
      const launch = await loadLaunchSettings(launchSettingsPath, { requireSeedSource: true });
      const plan = await buildLocalPlan(launch, { forceNewRevision });
      const planId = randomUUID();
      this.plans.clear();
      this.plans.set(planId, plan);
      return Object.freeze({
        apiVersion: ORCHESTRATOR_API_VERSION,
        operationId,
        operation: "planHost",
        state: "awaiting_publish_confirmation",
        planId,
        reviewFingerprint: plan.fingerprint,
        review: publicPublishReview(plan.review),
      });
    } catch (error) {
      return failureResult(operationId, "planHost", error);
    }
  }

  async commitHost({
    planId,
    reviewFingerprint,
    confirmation,
    realtimeJoinCode = undefined,
    requireRealtimeBootstrap = false,
    preferredSeedPort = DEFAULT_LAN_SEED_PORT,
  } = {}) {
    const operationId = randomUUID();
    const plan = this.plans.get(planId);
    if (!plan || plan.fingerprint !== reviewFingerprint || confirmation !== "PUBLISH") {
      return failureResult(operationId, "commitHost", {
        code: "publish_cancelled",
        message: "Exact Publish review confirmation is missing or stale.",
      });
    }
    this.plans.clear();
    try {
      if (requireRealtimeBootstrap === true &&
          (typeof realtimeJoinCode !== "string" || !realtimeJoinCode.trim())) {
        throw new TeamForgePeerError(
          "realtime_session_missing",
          "Unity Host Ready requires a fresh realtime session code for the signed Collaboration Invite.",
        );
      }
      if (realtimeJoinCode !== undefined) {
        assertRealtimeSceneMatchesPublication(realtimeJoinCode, plan.publication);
      }
      let selectedSeedPort = normalizePreferredSeedPort(preferredSeedPort);
      const settings = plan.launch.settings;
      const authToken = String(process.env[settings.authenticationTokenEnvironmentVariable] ?? "");
      const endpoint = resolveCoordinatorEndpoint(settings, authToken);
      this.coordinatorHandle = await this.lifecycle.ensureCoordinator({
        ...endpoint,
        authToken,
      });
      let coordinatorBaseline = await inspectCoordinatorBaseline(
        settings,
        authToken,
        plan.publication.project.projectUuid,
      );
      const startExistingSeed = async (manifestHash, expectedIdentity) => {
        const handle = await startWithPreferredSeedPort(selectedSeedPort, (port) =>
          this.lifecycle.ensureSeed({
            arguments: [
              "seed",
              "--project-id", settings.projectId,
              "--session", settings.sessionId,
              "--server", settings.serverAddress,
              "--realtime-path", settings.realtimePath,
              "--managed-root", plan.launch.managedRoot,
              "--manifest-hash", manifestHash,
              "--host", endpoint.host,
              "--port", String(port),
              "--advertised-host", endpoint.advertisedHost,
            ],
            expectedIdentity,
            host: endpoint.host,
            port,
            timeoutMilliseconds: 120_000,
            environment: { TEAMFORGE_AUTH_TOKEN: authToken },
          }));
        selectedSeedPort = handle.endpoint.port;
        return handle;
      };
      const startPublishingSeed = async (expectedIdentity) => {
        const handle = await startWithPreferredSeedPort(selectedSeedPort, (port) =>
          this.lifecycle.ensurePublishingSeed({
            arguments: [
              "publish",
              "--launch-settings", plan.launch.filePath,
              "--host", endpoint.host,
              "--port", String(port),
              "--advertised-host", endpoint.advertisedHost,
            ],
            expectedIdentity,
            publishReviewFingerprint: plan.fingerprint,
            host: endpoint.host,
            port,
            timeoutMilliseconds: 120_000,
          }));
        selectedSeedPort = handle.endpoint.port;
        return handle;
      };
      if (!coordinatorBaseline && plan.previousPublication) {
        const previous = plan.previousPublication;
        await assertCompleteApprovedPublication(previous);
        const previousIdentity = {
          projectId: settings.projectId,
          projectUuid: previous.project.projectUuid,
          sessionId: settings.sessionId,
          baselineRevision: previous.descriptor.baselineRevision,
          manifestHash: previous.manifest.manifestHash,
        };
        this.rearmSeedHandle = await startExistingSeed(previous.manifest.manifestHash, previousIdentity);
        coordinatorBaseline = await inspectCoordinatorBaseline(
          settings,
          authToken,
          previous.project.projectUuid,
        );
        if (!exactBaselineMatches(previous.descriptor, coordinatorBaseline)) {
          throw new TeamForgePeerError(
            "lifecycle_identity_mismatch",
            "Coordinator registry was not rebuilt from the exact signed approved Baseline.",
          );
        }
      }

      if (plan.mode === "existing_baseline") {
        const refreshed = await buildLocalPlan(plan.launch);
        if (refreshed.mode !== "existing_baseline" || refreshed.fingerprint !== plan.fingerprint) {
          throw new TeamForgePeerError(
            "source_changed",
            "Source changed after the existing Baseline review; re-review is required.",
          );
        }
        if (!exactBaselineMatches(plan.publication.descriptor, coordinatorBaseline)) {
          throw new TeamForgePeerError(
            "owner_sync_required",
            "Coordinator Baseline does not exactly match the local signed approved Baseline.",
          );
        }
        if (!this.rearmSeedHandle) {
          await assertCompleteApprovedPublication(plan.publication);
          this.rearmSeedHandle = await startExistingSeed(
            plan.publication.manifest.manifestHash,
            {
              projectId: settings.projectId,
              projectUuid: plan.publication.project.projectUuid,
              sessionId: settings.sessionId,
              baselineRevision: plan.publication.descriptor.baselineRevision,
              manifestHash: plan.publication.manifest.manifestHash,
            },
          );
        }
        this.seedHandle = this.rearmSeedHandle;
        this.rearmSeedHandle = null;
      }
      const expectedIdentity = {
        projectId: settings.projectId,
        projectUuid: plan.publication.project.projectUuid,
        sessionId: settings.sessionId,
        baselineRevision: plan.publication.descriptor.baselineRevision,
        manifestHash: plan.publication.manifest.manifestHash,
      };
      if (plan.mode === "publish") {
        // A temporary previous-Baseline rearm Seed and the newly publishing Seed
        // must not overlap on the currently selected direct-transfer listener.
        // Retire only the orchestrator-owned Seed, then prefer the same exact port
        // for the approved publication. If another process wins that port after
        // release, the bind helper falls back to one OS-assigned port instead of
        // terminating or adopting the unrelated listener.
        if (this.rearmSeedHandle) {
          const retired = await this.lifecycle.stopSeed(this.rearmSeedHandle);
          if (!retired.stopped) {
            throw new TeamForgePeerError(
              "port_conflict",
              "The previous Baseline Seed could not release its direct-transfer port safely.",
            );
          }
          this.rearmSeedHandle = null;
        }

        this.seedHandle = await startPublishingSeed(expectedIdentity);
      }
      const invitePath = path.join(
        plan.launch.managedRoot,
        expectedIdentity.projectUuid,
        "metadata",
        `host-invite-${randomUUID()}.json`,
      );
      const created = await plan.engine.createInvite({
        projectId: settings.projectId,
        serverAddress: settings.serverAddress,
        realtimePath: settings.realtimePath,
        sessionId: settings.sessionId,
        outputPath: invitePath,
      });
      const inviteJson = await readFile(created.outputPath, "utf8");
      const bootstrapInvite = realtimeJoinCode === undefined
        ? undefined
        : await plan.engine.createBootstrapInvite({
          projectId: settings.projectId,
          projectInvite: created.invite,
          sessionJoinCode: realtimeJoinCode,
        });
      this.ready = Object.freeze({
        apiVersion: ORCHESTRATOR_API_VERSION,
        operationId,
        operation: "commitHost",
        state: "host_ready",
        server: Object.freeze({ ready: true, owned: this.coordinatorHandle.owned }),
        seed: Object.freeze({ ready: true, owned: true, port: this.seedHandle.endpoint.port }),
        baseline: Object.freeze({ revision: expectedIdentity.baselineRevision }),
        invite: inviteJson.trim(),
        invitePath: created.outputPath,
        ...(bootstrapInvite
          ? { bootstrapInvite: JSON.stringify(bootstrapInvite) }
          : {}),
      });
      return this.ready;
    } catch (error) {
      if (this.seedHandle) await this.lifecycle.stopSeed(this.seedHandle).catch(() => {});
      if (this.rearmSeedHandle && this.rearmSeedHandle.handleId !== this.seedHandle?.handleId) {
        await this.lifecycle.stopSeed(this.rearmSeedHandle).catch(() => {});
      }
      if (this.coordinatorHandle?.owned) await this.lifecycle.stopCoordinator(this.coordinatorHandle).catch(() => {});
      this.seedHandle = null;
      this.rearmSeedHandle = null;
      this.coordinatorHandle = null;
      return failureResult(operationId, "commitHost", error);
    }
  }

  async stop() {
    const operationId = randomUUID();
    try {
      const stopped = [];
      if (this.seedHandle) stopped.push(await this.lifecycle.stopSeed(this.seedHandle));
      if (this.rearmSeedHandle && this.rearmSeedHandle.handleId !== this.seedHandle?.handleId) {
        stopped.push(await this.lifecycle.stopSeed(this.rearmSeedHandle));
      }
      if (this.coordinatorHandle?.owned) stopped.push(await this.lifecycle.stopCoordinator(this.coordinatorHandle));
      this.seedHandle = null;
      this.rearmSeedHandle = null;
      this.coordinatorHandle = null;
      this.ready = null;
      return Object.freeze({
        apiVersion: ORCHESTRATOR_API_VERSION,
        operationId,
        operation: "stop",
        state: "idle",
        stopped: Object.freeze(stopped),
      });
    } catch (error) {
      return failureResult(operationId, "stop", error);
    }
  }
}
