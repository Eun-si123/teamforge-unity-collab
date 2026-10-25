import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readUnityProjectDescriptor, UNITY_DESCRIPTOR_RELATIVE_PATH } from "../src/unity-project-descriptor.mjs";
import { cleanup, temporaryRoot } from "./helpers.mjs";

const marker = "SECRET_MARKER_NOT_JSON"; // Synthetic fixture, not a real secret.

test("malformed Unity Project descriptor does not echo file bytes in errors", async () => {
  const root = await temporaryRoot();
  try {
    const destination = path.join(root, ...UNITY_DESCRIPTOR_RELATIVE_PATH.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, marker);
    let failure;
    await assert.rejects(
      readUnityProjectDescriptor(root, { required: true }).catch(error => {
        failure = error;
        throw error;
      }),
      { code: "invalid_unity_descriptor" },
    );
    assert.equal(failure.message.includes("SECRET_"), false, "parser must not echo project bytes");
    assert.equal(await readFile(destination, "utf8"), marker, "failed read must not mutate project");
  } finally {
    await cleanup(root);
  }
});

test("missing optional Unity Project descriptor still returns no descriptor", async () => {
  const root = await temporaryRoot();
  try {
    const result = await readUnityProjectDescriptor(root);
    assert.equal(result.descriptor, null);
    assert.equal(result.digest, null);
  } finally {
    await cleanup(root);
  }
});
