import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { WebSocket } from "ws";
import { configFromEnv, profileFromEnv } from "../src/config.mjs";

test("Collider sync stays disabled unless an operator explicitly enables it", () => {
  for (const flag of [undefined, "", "0", "false", " FALSE "]) {
    const config = configFromEnv({
      TEAMFORGE_COMPONENT_PROPERTY_SYNC: flag,
      TEAMFORGE_COMPONENT_PROJECT_ROOT: path.resolve("unused-operator-store"),
    });
    assert.equal(config.enableComponentPropertySync, undefined);
    assert.equal(config.componentProjectManagedRoot, undefined);
  }
});

test("Collider sync requires a typed explicit flag and absolute managed root", () => {
  for (const flag of ["yes", "enabled", "2", true, 1, null]) {
    assert.throws(() => configFromEnv({ TEAMFORGE_COMPONENT_PROPERTY_SYNC: flag }),
      /TEAMFORGE_COMPONENT_PROPERTY_SYNC must be/);
  }
  for (const root of [undefined, "", " \t ", "relative-store", 7, "/invalid\0store"]) {
    assert.throws(() => configFromEnv({
      TEAMFORGE_COMPONENT_PROPERTY_SYNC: "true",
      TEAMFORGE_COMPONENT_PROJECT_ROOT: root,
    }), /TEAMFORGE_COMPONENT_PROJECT_ROOT must be/);
  }
});

test("enabled Collider options reach runtime configuration without exposing the root in policy", () => {
  const root = path.resolve("operator-managed-store");
  for (const flag of ["1", "true", " TRUE "]) {
    const env = { TEAMFORGE_COMPONENT_PROPERTY_SYNC: flag,
      TEAMFORGE_COMPONENT_PROJECT_ROOT: ` ${root} ` };
    const config = configFromEnv(env);
    assert.equal(config.enableComponentPropertySync, true);
    assert.equal(config.componentProjectManagedRoot, root);
    assert.equal("componentProjectManagedRoot" in profileFromEnv(env).connectionPolicy, false);
    assert.equal("enableComponentPropertySync" in profileFromEnv(env).connectionPolicy, false);
  }
});

async function startEntry(t, entry, enabled) {
  const root = await mkdtemp(path.join(os.tmpdir(), "teamforge-component-config-"));
  const instanceId = "component-config-test";
  const child = fork(fileURLToPath(new URL(`../src/${entry}`, import.meta.url)), [], {
    execArgv: [],
    env: {
      ...process.env,
      TEAMFORGE_HOST: "127.0.0.1", TEAMFORGE_PORT: "0", TEAMFORGE_AUTH_TOKEN: "",
      TEAMFORGE_COMPONENT_PROPERTY_SYNC: enabled ? "1" : "false",
      TEAMFORGE_COMPONENT_PROJECT_ROOT: root,
      TEAMFORGE_LIFECYCLE_INSTANCE_ID: instanceId,
      TEAMFORGE_LIFECYCLE_TOKEN: "component-config-test-lifecycle-token-000000000000",
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const closed = once(child, "close");
  let stderr = "";
  child.stderr.on("data", data => { stderr = (stderr + data).slice(-8192); });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await closed;
    await rm(root, { recursive: true, force: true });
  });
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Server entry point did not start.")), 5000);
    let stdout = "";
    function ready(endpoint) {
      clearTimeout(timer);
      resolve(endpoint);
    }
    child.stdout.on("data", data => {
      stdout = (stdout + data).slice(-8192);
      const match = /WebSocket: (ws:\/\/[^\s]+)/.exec(stdout);
      if (match) ready(match[1]);
    });
    child.on("message", message => {
      if (message?.channel === "teamforge-lifecycle-v1" && message.type === "ready") {
        ready(`ws://${message.endpoint.host}:${message.endpoint.port}${message.endpoint.wsPath}`);
      }
    });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    closed.then(([code]) => {
      clearTimeout(timer);
      reject(new Error(`Server entry point exited before readiness (${code}): ${stderr}`));
    }, reject);
  });
}

for (const entry of ["index.mjs", "lifecycle-child.mjs"]) {
  for (const enabled of [false, true]) {
    test(`${entry} applies operator Collider sync opt-in (${enabled}) to the real WebSocket handshake`,
      { timeout: 10000 }, async t => {
        const endpoint = await startEntry(t, entry, enabled);
        const socket = new WebSocket(endpoint);
        t.after(() => socket.terminate());
        await once(socket, "open", { signal: t.signal });
        const response = once(socket, "message", { signal: t.signal });
        socket.send(JSON.stringify({
          type: "hello", protocolVersion: 1, requestId: "operator-config",
          projectId: "component-config-test", sessionId: "test",
          userId: "editor-config", userName: "Editor", userColor: "#AABBCC",
          supportsPresence: true, supportsTransformSync: true, supportsHierarchySync: true,
          supportsProjectTransfer: true, supportsComponentPropertySync: true,
        }));
        const ack = JSON.parse((await response)[0].toString("utf8"));
        assert.equal(ack.type, "hello_ack");
        assert.equal(ack.componentPropertySyncEnabled, enabled);
        assert.equal(ack.componentStructureSyncEnabled, false);
        assert.equal(JSON.stringify(ack).includes("component-config-"), false,
          "the operator's managed-store path must not enter the handshake");
      });
  }
}
