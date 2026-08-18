// Process entry point only. It resolves environment configuration and owns
// process lifecycle; HTTP/WebSocket behavior lives in teamforge-server.mjs and
// authoritative session/project transitions live in their respective cores.
import { configFromEnv } from "./config.mjs";
import { createTeamForgeServer } from "./teamforge-server.mjs";

const config = configFromEnv(process.env);
const server = createTeamForgeServer({ ...config, logger: console });

try {
  const endpoint = await server.start();
  console.info(`Health: http://${endpoint.host}:${endpoint.port}${endpoint.healthPath}`);
  console.info(`WebSocket: ws://${endpoint.host}:${endpoint.port}${endpoint.wsPath}`);
  if (!config.authToken) {
    console.warn("Authentication is disabled. Do not expose this MVP directly to the public internet.");
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  // SIGINT/SIGTERM may race during process teardown. Stop the composed server
  // once so authority/transport cleanup is not run concurrently.
  shuttingDown = true;
  console.info(`Received ${signal}; stopping TeamForge server.`);
  try {
    await server.stop();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));