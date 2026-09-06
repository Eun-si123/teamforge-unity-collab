import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";

const [root, uuid, pause] = process.argv.slice(2);
const checkpoint = async (stage) => {
  if (pause !== stage) return;
  process.send({ stage });
  await new Promise((resolve) => process.once("message", resolve));
};
const originalLink = fs.link;
fs.link = async (...args) => {
  if (args[1].endsWith("project.json")) await checkpoint("before-link");
  const result = await originalLink(...args);
  if (args[1].endsWith("project.json")) await checkpoint("after-link");
  return result;
};
syncBuiltinESMExports();
const { ProjectPeerEngine } = await import("../src/project-peer.mjs");
const engine = new ProjectPeerEngine({ managedRoot: root });
const find = engine.findProject.bind(engine);
engine.findProject = async (id) => {
  const value = await find(id);
  await checkpoint("after-find");
  return value;
};
try {
  process.send({ result: await engine.ensureProject({ projectId: " race ", projectUuid: uuid || undefined }) });
} catch (error) {
  process.send({ error: error.code ?? error.message });
}
process.disconnect();
