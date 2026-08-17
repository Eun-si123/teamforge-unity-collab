import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createTeamForgeServer } from "../../server/src/teamforge-server.mjs";
import { ProjectPeerEngine } from "../src/project-peer.mjs";
import {
  TeamForgeProcessLifecycleManager,
  probeCoordinatorHealth,
} from "../src/process-lifecycle.mjs";
import { cleanup, createUnityProject, temporaryRoot } from "./helpers.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const testServerSockets = new WeakMap();

function noopLogger() {
  return { info() {}, warn() {}, error() {} };
}

function listen(server, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const sockets = new Set();
    testServerSockets.set(server, sockets);
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
    server.once("error", reject);
    server.listen(0, host, () => resolve(server.address()));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    for (const socket of testServerSockets.get(server) ?? []) socket.destroy();
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function unavailable(url) {
  await assert.rejects(() => fetch(url, { signal: AbortSignal.timeout(500) }));
}

test("Coordinator reuses only exact compatible health identity and never owns or stops the external server", async () => {
  const server = createTeamForgeServer({ host: "127.0.0.1", port: 0, logger: noopLogger() });
  const endpoint = await server.start();
  const manager = new TeamForgeProcessLifecycleManager({ workspaceRoot });
  try {
    const handle = await manager.ensureCoordinator({ host: endpoint.host, port: endpoint.port });
    assert.equal(handle.reused, true);
    assert.equal(handle.owned, false);
    assert.equal(handle.identity.service, "unity-teamforge-server");
    assert.equal(handle.identity.serverVersion, "0.5.1");
    assert.equal(handle.identity.protocolVersion, 1);
    assert.equal(handle.identity.healthPath, "/health");
    assert.equal(handle.identity.wsPath, "/ws");
    assert.equal(handle.identity.lifecycleInstanceId, null);

    const stop = await manager.stopCoordinator(handle);
    assert.equal(stop.stopped, false);
    assert.equal(stop.owned, false);
    const health = await probeCoordinatorHealth({ host: endpoint.host, port: endpoint.port });
    assert.equal(health.compatible, true, "external compatible server must remain running");
  } finally {
    await server.stop();
  }
});

test("unknown and incompatible listeners remain alive and are reported as port_conflict", async () => {
  const unknown = net.createServer();
  const unknownAddress = await listen(unknown);
  const manager = new TeamForgeProcessLifecycleManager({ workspaceRoot });
  try {
    await assert.rejects(
      () => manager.ensureCoordinator({ host: "127.0.0.1", port: unknownAddress.port, timeoutMilliseconds: 500 }),
      { code: "port_conflict" },
    );
    assert.equal(unknown.listening, true);
  } finally {
    await close(unknown);
  }

  const incompatible = createHttpServer((_request, response) => {
    const body = JSON.stringify({
      status: "ok",
      service: "unity-teamforge-server",
      serverVersion: "99.0.0",
      protocolVersion: 99,
      healthPath: "/health",
      wsPath: "/ws",
      authenticationRequired: false,
      lifecycleInstanceId: null,
    });
    response.writeHead(200, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    });
    response.end(body);
  });
  const incompatibleAddress = await listen(incompatible);
  try {
    await assert.rejects(
      () => manager.ensureCoordinator({ host: "127.0.0.1", port: incompatibleAddress.port }),
      { code: "port_conflict" },
    );
    assert.equal(incompatible.listening, true);
  } finally {
    await close(incompatible);
  }
});

test("compatible authenticated Coordinator requires caller credential availability but is never killed", async () => {
  const server = createTeamForgeServer({
    host: "127.0.0.1",
    port: 0,
    authToken: "test-auth-token",
    logger: noopLogger(),
  });
  const endpoint = await server.start();
  const manager = new TeamForgeProcessLifecycleManager({ workspaceRoot });
  try {
    await assert.rejects(
      () => manager.ensureCoordinator({ host: endpoint.host, port: endpoint.port }),
      { code: "server_authentication_unavailable" },
    );
    assert.equal(server.httpServer.listening, true);
    const handle = await manager.ensureCoordinator({
      host: endpoint.host,
      port: endpoint.port,
      authToken: "test-auth-token",
    });
    assert.equal(handle.owned, false);
    assert.equal((await manager.stopCoordinator(handle)).stopped, false);
    assert.equal(server.httpServer.listening, true);
  } finally {
    await server.stop();
  }
});

test("owned Coordinator starts, reuses, refuses a forged stop, and shuts down gracefully over authenticated IPC", async () => {
  const manager = new TeamForgeProcessLifecycleManager({ workspaceRoot });
  let handle;
  try {
    handle = await manager.ensureCoordinator({ port: 0 });
    assert.equal(handle.owned, true);
    assert.equal(handle.reused, false);
    assert(handle.pid > 0);
    assert.equal(handle.identity.lifecycleInstanceId, handle.instanceId);

    const reused = await manager.ensureCoordinator({ port: 0 });
    assert.equal(reused.handleId, handle.handleId);
    assert.equal(reused.reused, true);

    const forged = { ...handle, handleId: "forged" };
    const refused = await manager.stopCoordinator(forged);
    assert.equal(refused.stopped, false);
    assert.equal(refused.owned, false);
    assert.equal((await probeCoordinatorHealth({
      host: handle.endpoint.host,
      port: handle.endpoint.port,
    })).compatible, true);

    const stopped = await manager.stopCoordinator(handle);
    assert.equal(stopped.stopped, true);
    assert.equal(stopped.graceful, true);
    assert.equal(stopped.forced, false);
    assert.equal(stopped.method, "authenticated_ipc");
    assert.equal(stopped.exitCode, 0);
    if (process.platform === "win32") {
      assert.equal(stopped.platform, "win32", "Windows must use verified IPC rather than signal emulation");
      assert.equal(stopped.signal, null);
    }
    await unavailable(`http://127.0.0.1:${handle.endpoint.port}/health`);
    handle = null;
  } finally {
    if (handle) await manager.stopCoordinator(handle, { forceOwnedAfterTimeout: true }).catch(() => {});
  }
});

test("unknown Direct Seed listener is never reused or killed", async () => {
  const listener = net.createServer();
  const address = await listen(listener);
  const manager = new TeamForgeProcessLifecycleManager({ workspaceRoot });
  const root = await temporaryRoot();
  try {
    await assert.rejects(
      () => manager.ensureSeed({
        arguments: [
          "seed",
          "--managed-root", path.join(root, "managed"),
          "--project-id", "unknown-listener",
          "--session", "editors",
          "--server", "http://127.0.0.1:5080",
          "--port", String(address.port),
        ],
        expectedIdentity: {
          projectId: "unknown-listener",
          projectUuid: "11111111-1111-4111-8111-111111111111",
          sessionId: "editors",
          baselineRevision: 1,
          manifestHash: "a".repeat(64),
        },
        port: address.port,
      }),
      { code: "port_conflict" },
    );
    assert.equal(listener.listening, true);
  } finally {
    await close(listener);
    await cleanup(root);
  }
});

test("owned Direct Seed proves exact identity, reuses only the authenticated child, and stops gracefully", async () => {
  const root = await temporaryRoot();
  const manager = new TeamForgeProcessLifecycleManager({ workspaceRoot });
  let coordinatorHandle;
  let seedHandle;
  try {
    coordinatorHandle = await manager.ensureCoordinator({ port: 0 });
    const sourceRoot = path.join(root, "source");
    const managedRoot = path.join(root, "managed");
    const projectId = "lifecycle-seed";
    const sessionId = "editors";
    await createUnityProject(sourceRoot);
    const engine = new ProjectPeerEngine({ managedRoot });
    const publication = await engine.preparePublication({
      projectRoot: sourceRoot,
      projectId,
      baselineRevision: 1,
    });
    const initial = await engine.startSeed({
      publication,
      sessionId,
      coordinatorOptions: {
        serverAddress: coordinatorHandle.endpoint.url,
        realtimePath: "ws",
        userId: "wp2-publisher",
        userName: "WP2 Publisher",
        projectId,
        sessionId,
      },
      publish: true,
    });
    await initial.stop();

    const arguments_ = [
      "seed",
      "--managed-root", managedRoot,
      "--project-id", projectId,
      "--session", sessionId,
      "--server", coordinatorHandle.endpoint.url,
      "--port", "0",
    ];
    const expectedIdentity = {
      projectId,
      projectUuid: publication.project.projectUuid,
      sessionId,
      baselineRevision: publication.descriptor.baselineRevision,
      manifestHash: publication.manifest.manifestHash,
    };
    seedHandle = await manager.ensureSeed({
      arguments: arguments_,
      expectedIdentity,
      port: 0,
    });
    assert.equal(seedHandle.owned, true);
    assert.equal(seedHandle.reused, false);
    assert.equal(seedHandle.identity.projectUuid, expectedIdentity.projectUuid);
    assert.equal(seedHandle.identity.manifestHash, expectedIdentity.manifestHash);
    assert.match(seedHandle.identity.transferTokenFingerprint, /^[0-9a-f]{64}$/u);
    assert(!JSON.stringify(seedHandle).includes(initial.transferToken));

    const reused = await manager.ensureSeed({
      arguments: arguments_,
      expectedIdentity,
      port: 0,
    });
    assert.equal(reused.handleId, seedHandle.handleId);
    assert.equal(reused.reused, true);

    const stopped = await manager.stopSeed(seedHandle);
    assert.equal(stopped.stopped, true);
    assert.equal(stopped.graceful, true);
    assert.equal(stopped.forced, false);
    assert.equal(stopped.method, "authenticated_ipc");
    assert.equal(stopped.exitCode, 0);
    if (process.platform === "win32") {
      assert.equal(stopped.platform, "win32");
      assert.equal(stopped.signal, null);
    }
    await unavailable(seedHandle.identity.endpoint);
    seedHandle = null;
  } finally {
    if (seedHandle) await manager.stopSeed(seedHandle, { forceOwnedAfterTimeout: true }).catch(() => {});
    if (coordinatorHandle) {
      await manager.stopCoordinator(coordinatorHandle, { forceOwnedAfterTimeout: true }).catch(() => {});
    }
    await cleanup(root);
  }
});
