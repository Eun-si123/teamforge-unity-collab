import { timingSafeEqual } from "node:crypto";
import process from "node:process";
import { configFromEnv } from "./config.mjs";
import { createTeamForgeServer } from "./teamforge-server.mjs";

const CHANNEL = "teamforge-lifecycle-v1";
const instanceId = String(process.env.TEAMFORGE_LIFECYCLE_INSTANCE_ID ?? "");
const token = String(process.env.TEAMFORGE_LIFECYCLE_TOKEN ?? "");

function safeEqual(left, right) {
  const leftBytes = Buffer.from(String(left), "utf8");
  const rightBytes = Buffer.from(String(right), "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function send(type, payload = {}) {
  if (!process.send || !process.connected) return;
  process.send({ channel: CHANNEL, type, kind: "coordinator", instanceId, ...payload }, () => {});
}

if (!instanceId || token.length < 32 || typeof process.send !== "function") {
  throw new Error("Coordinator lifecycle child requires an authenticated IPC parent.");
}

const config = configFromEnv(process.env);
const server = createTeamForgeServer({ ...config, lifecycleInstanceId: instanceId, logger: console });
let endpoint = null;
let stoppingPromise = null;

async function stop(reason, requestId = "") {
  if (stoppingPromise) return stoppingPromise;
  stoppingPromise = (async () => {
    await server.stop();
    send("stopped", { reason, requestId, graceful: true });
    process.exitCode = 0;
    if (process.connected) process.disconnect();
  })().catch((error) => {
    send("failure", { requestId, code: error.code ?? "coordinator_stop_failed" });
    process.exitCode = 1;
    if (process.connected) process.disconnect();
  });
  return stoppingPromise;
}

process.on("message", (message) => {
  if (!message || message.channel !== CHANNEL || message.instanceId !== instanceId ||
      !safeEqual(message.token, token)) {
    return;
  }
  if (message.type === "status") {
    send("status", { requestId: message.requestId ?? "", endpoint, stopping: Boolean(stoppingPromise) });
  } else if (message.type === "stop") {
    void stop("ipc", message.requestId ?? "");
  }
});
process.once("disconnect", () => void stop("parent_disconnect"));
process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));

try {
  endpoint = await server.start();
  send("ready", { endpoint });
} catch (error) {
  send("failure", { code: error.code ?? "coordinator_start_failed" });
  process.exitCode = 1;
  if (process.connected) process.disconnect();
}
