import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { buildManifest } from "../src/manifest.mjs";
import { discoverProjectFiles } from "../src/path-policy.mjs";
import { cleanup, createUnityProject, temporaryRoot } from "./helpers.mjs";

const MEMBER_NAMES = ["privateKey", "publicKey", "keyId"];
const PROJECT_UUID = "12345678-1234-4234-8234-123456789abc";
const PREFIX = '{"padding":"';

function escapedMember(key) {
  return Array.from(key, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0").toUpperCase()}`).join("");
}

function ownerMembers(keys, whitespace = " ") {
  return keys.map((key, index) => `"${key}"${whitespace}:"synthetic-${index}"`).join(",");
}

async function fixture(source) {
  const root = await temporaryRoot("teamforge-owner-json-");
  const project = path.join(root, "project");
  await createUnityProject(project, { assetFiles: { "Assets/ordinary.json": source } });
  return { root, project, target: path.join(project, "Assets", "ordinary.json") };
}

for (const [label, source] of [
  ["literal keys followed by whitespace spanning multiple reads",
    PREFIX + "x".repeat(65_300 - PREFIX.length) + '",' +
    ownerMembers(MEMBER_NAMES, " \n\t\r".repeat(50_000)) + "}"],
  ["split escaped keys followed by whitespace spanning multiple reads",
    PREFIX + "x".repeat(65_520 - PREFIX.length) + '",' +
    ownerMembers(MEMBER_NAMES.map(escapedMember), " ".repeat(200_000)) + "}"],
  ["split UTF-8 before escaped keys and whitespace spanning multiple reads",
    PREFIX + "x".repeat(65_535 - PREFIX.length) + '한",' +
    ownerMembers(MEMBER_NAMES.map(escapedMember), " ".repeat(200_000)) + "}"],
]) {
  test(`Owner JSON scanner rejects ${label} before storing chunks`, async () => {
    const decoded = JSON.parse(source);
    assert(MEMBER_NAMES.every((key) => Object.hasOwn(decoded, key)), "The fixture must decode to all three protected member names.");
    assert(Buffer.byteLength(source) > 4 * 65_536, "The fixture must exceed several scanner read windows.");
    const f = await fixture(source);
    try {
      let storedChunks = 0;
      await assert.rejects(buildManifest({
        projectRoot: f.project, projectUuid: PROJECT_UUID, baselineRevision: 1,
        store: { put: async () => { storedChunks += 1; } },
      }), { code: "secret_file_rejected" });
      assert.equal(storedChunks, 0, "Discovery must reject the Owner shape before any manifest chunk is stored.");
    } finally { await cleanup(f.root); }
  });
}

test("Owner JSON scanner retains benign escaped-key and whitespace controls", async () => {
  const sources = [
    ["one protected member", String.raw`{"\u0070rivateKey":"ordinary"}`],
    ["literal backslash-u key", String.raw`{"\\u0070rivateKey":"ordinary","publicKey":"ordinary","keyId":"ordinary"}`],
    ["whitespace inside key", JSON.stringify({ "private   Key": "ordinary", publicKey: "ordinary", keyId: "ordinary" })],
    ["whitespace suffix in key", JSON.stringify({ "privateKey ": "ordinary", publicKey: "ordinary", keyId: "ordinary" })],
    ["escaped whitespace inside key", String.raw`{"private\u0020Key":"ordinary","publicKey":"ordinary","keyId":"ordinary"}`],
    ["key-like text inside value", JSON.stringify({ note: '"privateKey"   : "publicKey"\t:\n"keyId" :' })],
  ];
  const f = await fixture("{}");
  try {
    for (const [label, source] of sources) {
      const decoded = JSON.parse(source);
      assert.equal(MEMBER_NAMES.every((key) => Object.hasOwn(decoded, key)), false, label);
      await writeFile(f.target, source);
      assert((await discoverProjectFiles(f.project)).some((file) => file.path === "Assets/ordinary.json"), label);
    }
  } finally { await cleanup(f.root); }
});

test("Owner JSON scan view preserves whitespace-rich asset bytes and manifest hashes", async () => {
  const source = JSON.stringify({ privateKey: "single ordinary field", note: "a     b\n\t한\u00a0\u2028" }, null, 3) + "\n";
  const f = await fixture(source);
  try {
    const chunks = new Map();
    const publish = () => buildManifest({
      projectRoot: f.project, projectUuid: PROJECT_UUID, baselineRevision: 1,
      store: { put: async (bytes, hash) => { chunks.set(hash, Buffer.from(bytes)); } },
    });
    const first = await publish();
    const second = await publish();
    const asset = first.manifest.files.find((file) => file.path === "Assets/ordinary.json");
    assert.deepEqual(first.manifest, second.manifest);
    assert.equal(asset.size, Buffer.byteLength(source));
    assert.equal(asset.fileHash, createHash("sha256").update(source).digest("hex"));
    assert.deepEqual(Buffer.concat(asset.chunks.map((chunk) => chunks.get(chunk.hash))), Buffer.from(source));
  } finally { await cleanup(f.root); }
});
