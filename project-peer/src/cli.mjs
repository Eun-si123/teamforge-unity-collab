#!/usr/bin/env node
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { userInfo } from "node:os";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { ProjectPeerEngine, CoordinatorClient } from "./project-peer.mjs";
import { PRODUCT_VERSION } from "./constants.mjs";
import { TeamForgePeerError, fail } from "./errors.mjs";
import { loadLaunchSettings } from "./launch-settings.mjs";
import {
  LEGACY_CONNECTION_DEFAULTS,
  LEGACY_TRANSFER_DEFAULTS,
} from "./policy-profile.mjs";
import {
  assessWindowsUnityActivePath,
  enforceNoOpPublishPolicy,
  transferRateOption,
} from "./cli-policy.mjs";
import {
  createPublishReviewFingerprint,
  launchSettingsDigest,
  publicPublishReview,
} from "./publication-plan.mjs";

const LIFECYCLE_CHANNEL = "teamforge-lifecycle-v1";
const lifecycleInstanceId = String(process.env.TEAMFORGE_LIFECYCLE_INSTANCE_ID ?? "");
const lifecycleToken = String(process.env.TEAMFORGE_LIFECYCLE_TOKEN ?? "");
const lifecycleEnabled = lifecycleInstanceId.length > 0 && lifecycleToken.length >= 32 &&
  typeof process.send === "function";

function lifecycleTokenMatches(candidate) {
  const left = Buffer.from(String(candidate), "utf8");
  const right = Buffer.from(lifecycleToken, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function sendLifecycle(type, payload = {}) {
  if (!lifecycleEnabled || !process.connected) return;
  process.send({
    channel: LIFECYCLE_CHANNEL,
    type,
    kind: "seed",
    instanceId: lifecycleInstanceId,
    ...payload,
  }, () => {});
}

function parseArguments(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      positional.push(argument);
      continue;
    }
    const equals = argument.indexOf("=");
    if (equals >= 0) {
      options[argument.slice(2, equals)] = argument.slice(equals + 1);
      continue;
    }
    const name = argument.slice(2);
    if (argv[index + 1] !== undefined && !argv[index + 1].startsWith("--")) {
      options[name] = argv[index + 1];
      index += 1;
    } else {
      options[name] = true;
    }
  }
  return { positional, options };
}

function integerOption(options, name, fallback, minimum, maximum) {
  if (options[name] === undefined) {
    return fallback;
  }
  const value = Number(options[name]);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail("invalid_cli_option", `--${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function required(options, name) {
  const value = options[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    fail("missing_cli_option", `--${name} is required.`);
  }
  return value;
}

function defaultManagedRoot(options, launch = null) {
  return launch?.managedRoot ??
    path.resolve(options["managed-root"] || process.env.TEAMFORGE_MANAGED_ROOT || "TeamForgeProjects");
}

async function peerIdentity(managedRoot) {
  const identityPath = path.join(managedRoot, "peer-client.json");
  try {
    const existing = JSON.parse(await readFile(identityPath, "utf8"));
    if (typeof existing.userId === "string" && existing.userId.length > 0 &&
        typeof existing.userName === "string" && existing.userName.length > 0) {
      return existing;
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  let localName = "Unity User";
  try {
    localName = userInfo().username || localName;
  } catch {}
  const created = { schemaVersion: 1, userId: randomUUID().replaceAll("-", ""), userName: localName };
  await mkdir(managedRoot, { recursive: true });
  await writeFile(identityPath, `${JSON.stringify(created, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return created;
}

function coordinatorOptions(
  options,
  identity,
  projectId,
  sessionId,
  serverAddress,
  realtimePath,
  authenticationEnvironmentVariable = "TEAMFORGE_AUTH_TOKEN",
) {
  return {
    serverAddress,
    realtimePath,
    authenticationToken: String(
      options["auth-token"] ?? process.env[authenticationEnvironmentVariable] ?? "",
    ),
    userId: identity.userId,
    userName: identity.userName,
    projectId,
    sessionId,
  };
}



function rejectUnsafeLaunchOverrides(options) {
  for (const name of ["project-root", "project-id", "session", "managed-root", "manifest-hash"]) {
    if (options[name] !== undefined) {
      fail(
        "unsafe_launch_override",
        `--${name} cannot override Unity-exported launch settings; export a new settings file instead.`,
      );
    }
  }
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function waitForSignal(seedIdentity = null) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (reason, requestId = "") => {
      if (settled) return;
      settled = true;
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      if (lifecycleEnabled) {
        process.off("message", onMessage);
        process.off("disconnect", onDisconnect);
      }
      resolve({ reason, requestId });
    };
    const onSigint = () => finish("SIGINT");
    const onSigterm = () => finish("SIGTERM");
    const onDisconnect = () => finish("parent_disconnect");
    const onMessage = (message) => {
      if (!message || message.channel !== LIFECYCLE_CHANNEL ||
          message.instanceId !== lifecycleInstanceId || !lifecycleTokenMatches(message.token)) {
        return;
      }
      if (message.type === "status") {
        sendLifecycle("status", {
          requestId: message.requestId ?? "",
          identity: seedIdentity,
          stopping: false,
        });
      } else if (message.type === "stop") {
        finish("ipc", message.requestId ?? "");
      }
    };
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
    if (lifecycleEnabled) {
      process.on("message", onMessage);
      process.once("disconnect", onDisconnect);
    }
  });
}

async function trustApproval(options, summary) {
  process.stdout.write(
    `Publisher fingerprint: ${summary.publisherFingerprint}\n` +
    `Owner fingerprint:     ${summary.ownerKeyId}\n` +
    `Files: ${summary.totalFiles}, bytes: ${summary.totalBytes}, scripts: ${summary.containsScripts}, packages: ${summary.containsPackages}\n`,
  );
  if (typeof options["approve-publisher"] === "string") {
    return options["approve-publisher"] === summary.publisherFingerprint;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question("Type the complete Publisher fingerprint to activate this project: ");
    return answer.trim() === summary.publisherFingerprint;
  } finally {
    prompt.close();
  }
}

async function waitForLifecyclePublishConfirmation(fingerprint) {
  sendLifecycle("publish_review", { fingerprint });
  return new Promise((resolve, reject) => {
    const finish = (callback, value) => {
      process.off("message", onMessage);
      process.off("disconnect", onDisconnect);
      callback(value);
    };
    const onDisconnect = () => finish(
      reject,
      new TeamForgePeerError("publish_cancelled", "Publish parent disconnected before confirmation."),
    );
    const onMessage = (message) => {
      if (!message || message.channel !== LIFECYCLE_CHANNEL ||
          message.instanceId !== lifecycleInstanceId || !lifecycleTokenMatches(message.token)) {
        return;
      }
      if (message.type === "cancel_publish") {
        finish(reject, new TeamForgePeerError("publish_cancelled", "Publish review was cancelled."));
      } else if (message.type === "confirm_publish") {
        if (message.fingerprint !== fingerprint || message.confirmation !== "PUBLISH") {
          finish(reject, new TeamForgePeerError(
            "source_changed",
            "Publish confirmation did not match the exact current review fingerprint.",
          ));
          return;
        }
        finish(resolve);
      }
    };
    process.on("message", onMessage);
    process.once("disconnect", onDisconnect);
  });
}

async function confirmPublish(options, review, fingerprint = "") {
  print({
    publishReview: publicPublishReview(review),
  });
  if (lifecycleEnabled) {
    await waitForLifecyclePublishConfirmation(fingerprint);
    return;
  }
  if (options["confirm-publish"] === true) {
    return;
  }
  if (options["confirm-publish"] !== undefined) {
    fail("invalid_publish_confirmation", "Use --confirm-publish as a flag without a value.");
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    fail(
      "publish_confirmation_required",
      "Non-interactive Publish requires the explicit --confirm-publish flag after reviewing the diff.",
    );
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question("Type PUBLISH to publish this Baseline: ");
    if (answer.trim() !== "PUBLISH") {
      fail("publish_cancelled", "Publish confirmation was not provided; no Baseline was sent.");
    }
  } finally {
    prompt.close();
  }
}

function help() {
  process.stdout.write(`TeamForge Project Peer ${PRODUCT_VERSION}

Commands:
  publish --launch-settings FILE
  publish --project-root PATH --project-id NAME --session NAME [--server URL]
  seed --launch-settings FILE
  seed --project-id NAME --session NAME [--server URL]
  repair-source-descriptor --launch-settings FILE
  sync --invite FILE [--approve-publisher FINGERPRINT]
  status --project-id NAME [--verbose]
  invite create --project-id NAME --session NAME --server URL --output FILE
  invite import --file FILE
  owner-key backup --project-id NAME --output FILE
  init-owner --output FILE                         (advanced)

Connection and transfer options:
  --managed-root PATH  --realtime-path PATH  --auth-token TOKEN
  --host ADDRESS  --port NUMBER  --endpoint PUBLIC_DIRECT_ENDPOINT
  --advertised-host HOST (keeps the actual bound port/path; mutually exclusive with --endpoint)
  --concurrency NUMBER (default 4)  --retry-rounds NUMBER (default 3)
  --retry-base-ms NUMBER  --retry-max-ms NUMBER
  --max-bytes-per-second NUMBER (seed upload limiter; legacy sync alias)
  --partial-seed-max-bytes-per-second NUMBER (sync partial-seed upload limiter)
  --force-new-revision (allow a no-content-change Publish to advance revision)
  --confirm-publish (required for non-interactive Publish)

Raw UUID, revision, hashes, and public keys are intentionally not normal inputs.
Key rotation and ownership transfer are unsupported and fail closed in v0.5.1.
`);
}

async function main() {
  const { positional, options } = parseArguments(process.argv.slice(2));
  const command = positional[0];
  if (!command || command === "help" || options.help) {
    help();
    return;
  }
  let launch = null;
  if (options["launch-settings"] !== undefined) {
    if (!["publish", "seed", "repair-source-descriptor"].includes(command)) {
      fail(
        "invalid_launch_settings_command",
        "--launch-settings is supported only by publish, seed, and repair-source-descriptor.",
      );
    }
    rejectUnsafeLaunchOverrides(options);
    launch = await loadLaunchSettings(required(options, "launch-settings"), { requireSeedSource: true });
  }
  const managedRoot = defaultManagedRoot(options, launch);
  const engine = new ProjectPeerEngine({ managedRoot });

  if (command === "init-owner") {
    print(await engine.initOwner({ outputPath: required(options, "output"), label: options.label }));
    return;
  }
  if (command === "owner-key") {
    if (positional[1] !== "backup") {
      fail("unsupported_key_operation", "Only 'owner-key backup' is supported; rotation and transfer fail closed.");
    }
    print(await engine.backupOwnerKey({
      projectId: required(options, "project-id"),
      outputPath: required(options, "output"),
    }));
    return;
  }
  if (command === "invite") {
    if (positional[1] === "create") {
      const created = await engine.createInvite({
        projectId: required(options, "project-id"),
        serverAddress: required(options, "server"),
        realtimePath: options["realtime-path"] || LEGACY_CONNECTION_DEFAULTS.realtimePath,
        sessionId: required(options, "session"),
        outputPath: required(options, "output"),
      });
      print({
        created: true,
        projectId: created.invite.projectId,
        ownerFingerprint: created.invite.ownerKeyId,
        outputPath: created.outputPath,
      });
      return;
    }
    if (positional[1] === "import") {
      const imported = await engine.importInvite({ invitePath: required(options, "file") });
      print({ imported: true, projectId: imported.project.projectId, storedAt: imported.destination });
      return;
    }
    fail("invalid_command", "Use 'invite create' or 'invite import'.");
  }
  if (command === "status") {
    print(await engine.status({
      projectId: required(options, "project-id"),
      verbose: options.verbose === true,
    }));
    return;
  }

  const identity = await peerIdentity(managedRoot);
  if (command === "repair-source-descriptor") {
    if (!launch) {
      fail("missing_cli_option", "repair-source-descriptor requires --launch-settings FILE.");
    }
    const settings = launch.settings;
    const source = await engine.resolveSourceProject({
      projectRoot: launch.sourceProjectRoot,
      projectId: settings.projectId,
      expectedProjectUuid: settings.projectUuid,
      projectDescriptorPath: launch.projectDescriptorPath,
      requireDescriptor: false,
    });
    const coordinator = new CoordinatorClient(coordinatorOptions(
      options,
      identity,
      settings.projectId,
      settings.sessionId,
      options.server || settings.serverAddress,
      options["realtime-path"] || settings.realtimePath,
      settings.authenticationTokenEnvironmentVariable,
    ));
    try {
      const snapshot = await coordinator.connect();
      if (snapshot.projectUuid && snapshot.projectUuid !== source.project.projectUuid) {
        fail("project_uuid_conflict", "Coordinator Project UUID conflicts with the source Project.");
      }
      const repaired = await engine.repairSourceDescriptor({
        projectId: settings.projectId,
        source,
        coordinatorBaseline: snapshot.baseline,
      });
      print({ repaired: repaired.repaired, projectId: repaired.projectId, destination: repaired.destination });
    } finally {
      coordinator.close();
    }
    return;
  }
  if (command === "publish") {
    const projectId = launch?.settings.projectId ?? required(options, "project-id");
    const sessionId = launch?.settings.sessionId ?? required(options, "session");
    const serverAddress = options.server || launch?.settings.serverAddress ||
      LEGACY_CONNECTION_DEFAULTS.serverAddress;
    const realtimePath = options["realtime-path"] || launch?.settings.realtimePath ||
      LEGACY_CONNECTION_DEFAULTS.realtimePath;
    const projectRoot = launch?.sourceProjectRoot ?? required(options, "project-root");
    const expectedProjectUuid = launch?.settings.projectUuid;
    const projectDescriptorPath = launch?.projectDescriptorPath;
    const source = await engine.resolveSourceProject({
      projectRoot,
      projectId,
      expectedProjectUuid,
      projectDescriptorPath,
      requireDescriptor: Boolean(launch),
    });
    const authEnvironment = launch?.settings.authenticationTokenEnvironmentVariable;
    const discovery = new CoordinatorClient(
      coordinatorOptions(
        options, identity, projectId, sessionId, serverAddress, realtimePath, authEnvironment,
      ),
    );
    const snapshot = await discovery.connect();
    if (snapshot.projectUuid && snapshot.projectUuid !== source.project.projectUuid) {
      discovery.close();
      fail("project_uuid_conflict", "Coordinator Project UUID conflicts with the local Owner project.");
    }
    const publishBase = await engine.validatePublishBase({
      projectId,
      source,
      coordinatorBaseline: snapshot.baseline,
    });
    const baselineRevision = snapshot.baseline ? snapshot.baseline.baselineRevision + 1 : 1;
    discovery.close();
    const ownerEnvironment = launch?.settings.ownerKeyEnvironmentVariable;
    const ownerKeyPath = options["owner-key"] ||
      (ownerEnvironment ? process.env[ownerEnvironment] : undefined);
    const publication = await engine.preparePublication({
      projectRoot,
      projectId,
      projectUuid: source.project.projectUuid,
      baselineRevision,
      publisherKeyPath: options["publisher-key"],
      ownerKeyPath,
      projectDescriptorPath,
      requireSourceDescriptor: Boolean(launch),
      expectedOwnerKeyId: snapshot.baseline?.ownerKeyId ?? "",
      chunkSize: options["chunk-size"] === undefined
        ? undefined
        : integerOption(options, "chunk-size", undefined, 65_536, 4_194_304),
    });
    const review = engine.summarizePublicationChanges(
      publication.manifest,
      publishBase.previousPublication?.manifest ?? null,
      publication.embeddedPackages,
    );
    enforceNoOpPublishPolicy(options, review);
    const fingerprint = launch
      ? createPublishReviewFingerprint({
          launchDigest: await launchSettingsDigest(launch.filePath),
          sourceDescriptorDigest: publication.sourceDescriptorState.digest,
          baselineRevision: publication.descriptor.baselineRevision,
          manifestHash: publication.manifest.manifestHash,
          review,
        })
      : "";
    await confirmPublish(options, review, fingerprint);
    const running = await engine.startSeed({
      publication,
      host: options.host || LEGACY_TRANSFER_DEFAULTS.host,
      port: integerOption(options, "port", LEGACY_TRANSFER_DEFAULTS.port, 0, 65_535),
      advertisedEndpoint: options.endpoint,
      advertisedHost: options["advertised-host"],
      maxBytesPerSecond: transferRateOption(options),
      sessionId,
      coordinatorOptions: coordinatorOptions(
        options, identity, projectId, sessionId, serverAddress, realtimePath, authEnvironment,
      ),
      publish: true,
    });
    const boundAddress = running.transferServer.httpServer.address();
    const seedIdentity = {
      projectId,
      projectUuid: publication.project.projectUuid,
      sessionId,
      baselineRevision: publication.descriptor.baselineRevision,
      manifestHash: publication.manifest.manifestHash,
      endpoint: running.endpoint,
      boundHost: running.transferServer.host,
      boundPort: boundAddress && typeof boundAddress !== "string" ? boundAddress.port : null,
      transferTokenFingerprint: createHash("sha256").update(running.transferToken).digest("hex"),
    };
    sendLifecycle("ready", { identity: seedIdentity, published: true });
    print({ published: true, projectId, endpoint: running.endpoint, sourceDescriptorUpdated: true });
    let stopRequest = { reason: "once", requestId: "" };
    if (options.once === true) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    } else {
      stopRequest = await waitForSignal(seedIdentity);
    }
    await running.stop();
    sendLifecycle("stopped", {
      reason: stopRequest.reason,
      requestId: stopRequest.requestId,
      graceful: true,
    });
    if (lifecycleEnabled && process.connected) process.disconnect();
    return;
  }

  if (command === "seed") {
    const projectId = launch?.settings.projectId ?? required(options, "project-id");
    const sessionId = launch?.settings.sessionId ?? required(options, "session");
    const serverAddress = options.server || launch?.settings.serverAddress ||
      LEGACY_CONNECTION_DEFAULTS.serverAddress;
    const realtimePath = options["realtime-path"] || launch?.settings.realtimePath ||
      LEGACY_CONNECTION_DEFAULTS.realtimePath;
    const publication = await engine.loadPublication({
      projectId,
      manifestHash: options["manifest-hash"],
      requireApproved: true,
    });
    if (launch && publication.project.projectUuid !== launch.settings.projectUuid) {
      fail("project_uuid_conflict", "Launch settings UUID conflicts with the managed publication.");
    }
    const authEnvironment = launch?.settings.authenticationTokenEnvironmentVariable;
    const running = await engine.startSeed({
      publication,
      host: options.host || LEGACY_TRANSFER_DEFAULTS.host,
      port: integerOption(options, "port", LEGACY_TRANSFER_DEFAULTS.port, 0, 65_535),
      advertisedEndpoint: options.endpoint,
      advertisedHost: options["advertised-host"],
      maxBytesPerSecond: transferRateOption(options),
      sessionId,
      coordinatorOptions: coordinatorOptions(
        options, identity, projectId, sessionId, serverAddress, realtimePath, authEnvironment,
      ),
    });
    const boundAddress = running.transferServer.httpServer.address();
    const seedIdentity = {
      projectId,
      projectUuid: publication.project.projectUuid,
      sessionId,
      baselineRevision: publication.descriptor.baselineRevision,
      manifestHash: publication.manifest.manifestHash,
      endpoint: running.endpoint,
      boundHost: running.transferServer.host,
      boundPort: boundAddress && typeof boundAddress !== "string" ? boundAddress.port : null,
      transferTokenFingerprint: createHash("sha256").update(running.transferToken).digest("hex"),
    };
    sendLifecycle("ready", { identity: seedIdentity });
    print({ seeding: true, projectId, endpoint: running.endpoint });
    let stopRequest = { reason: "once", requestId: "" };
    if (options.once === true) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    } else {
      stopRequest = await waitForSignal(seedIdentity);
    }
    await running.stop();
    sendLifecycle("stopped", {
      reason: stopRequest.reason,
      requestId: stopRequest.requestId,
      graceful: true,
    });
    if (lifecycleEnabled && process.connected) process.disconnect();
    return;
  }

  if (command === "sync") {
    const invitePath = required(options, "invite");
    const imported = await engine.importInvite({ invitePath });
    const invite = imported.invite;
    const coordinator = new CoordinatorClient(
      coordinatorOptions(
        options,
        identity,
        invite.projectId,
        invite.sessionId,
        invite.serverAddress,
        invite.realtimePath,
      ),
    );
    const snapshot = await coordinator.connect();
    try {
      if (snapshot?.baseline) {
        const pathPreflight = assessWindowsUnityActivePath({
          managedRoot,
          projectUuid: snapshot.baseline.projectUuid ?? snapshot.projectUuid,
          baselineRevision: snapshot.baseline.baselineRevision,
          manifestHash: snapshot.baseline.manifestHash,
        });
        if (pathPreflight.highRisk) {
          process.stderr.write(
            `[preflight] windows_unity_path_risk activePathLength=${pathPreflight.activePathLength} ` +
            `estimatedGeneratedPathLength=${pathPreflight.estimatedGeneratedPathLength} ` +
            `activePath=${pathPreflight.activePath}\n` +
            `[preflight] ${pathPreflight.recommendation}\n`,
          );
        }
      }
      const synced = await engine.syncFromSnapshot({
        projectId: invite.projectId,
        snapshot,
        coordinator,
        sessionId: invite.sessionId,
        host: options.host || LEGACY_TRANSFER_DEFAULTS.host,
        port: integerOption(options, "port", LEGACY_TRANSFER_DEFAULTS.port, 0, 65_535),
        advertisedEndpoint: options.endpoint,
        advertisedHost: options["advertised-host"],
        maxConcurrency: integerOption(
          options, "concurrency", LEGACY_TRANSFER_DEFAULTS.maxConcurrency, 1, 64,
        ),
        retryRounds: integerOption(
          options, "retry-rounds", LEGACY_TRANSFER_DEFAULTS.retryRounds, 0, 10,
        ),
        retryBaseMilliseconds: integerOption(
          options, "retry-base-ms", LEGACY_TRANSFER_DEFAULTS.retryBaseMilliseconds, 1, 60_000,
        ),
        retryMaximumMilliseconds: integerOption(
          options, "retry-max-ms", LEGACY_TRANSFER_DEFAULTS.retryMaximumMilliseconds, 1, 60_000,
        ),
        maxBytesPerSecond: transferRateOption(options, { sync: true }),
        trustApproval: (summary) => trustApproval(options, summary),
        onProgress: (progress) => {
          if (process.stdout.isTTY) {
            process.stdout.write(
              `\r${progress.state}: ${progress.completedChunks}/${progress.totalChunks} chunks, ` +
              `${progress.remainingBytes} bytes remaining   `,
            );
          }
        },
        onDiagnostic: (diagnostic) => {
          process.stderr.write(
            `[transfer] operation=${diagnostic.operation} chunk=${diagnostic.chunkHashPrefix || "-"} ` +
            `peer=${diagnostic.peerId || "-"} endpoint=${diagnostic.peerEndpoint || "-"} ` +
            `status=${diagnostic.httpStatus || "-"} kind=${diagnostic.errorKind} ` +
            `attempt=${diagnostic.attempt}/${diagnostic.maxAttempts} ` +
            `retryMs=${diagnostic.retryInMilliseconds || 0} switched=${Boolean(diagnostic.switchedPeer)} ` +
            `resumed=${diagnostic.resumedChunks || 0} remainingBytes=${diagnostic.remainingBytes || 0}\n`,
          );
        },
      });
      if (process.stdout.isTTY) {
        process.stdout.write("\n");
      }
      print({
        state: synced.activation.state,
        projectId: invite.projectId,
        activePath: synced.activation.activePath ?? "",
        stagingPath: synced.activation.stagingPath ?? "",
        totalChunks: synced.download.totalChunks,
        transferredChunks: synced.download.transferredChunks,
        resumedChunks: synced.download.resumedChunks,
        totalBytes: synced.download.totalBytes,
        transferredBytes: synced.download.transferredBytes,
        resumedBytes: synced.download.resumedBytes,
      });
      await synced.partialServer.stop();
      if (synced.activation.state === "AwaitingTrust") {
        process.exitCode = 3;
      }
    } finally {
      coordinator.close();
    }
    return;
  }

  fail("invalid_command", `Unknown command '${command}'.`);
}

main().catch((error) => {
  const code = error instanceof TeamForgePeerError ? error.code : "unexpected_error";
  sendLifecycle("failure", { code });
  process.stderr.write(`${code}: ${error.message}\n`);
  if (error.details?.stagingPath) {
    process.stderr.write(`Failure staging retained at: ${error.details.stagingPath}\n`);
  }
  process.exitCode = 1;
  if (lifecycleEnabled && process.connected) process.disconnect();
});
