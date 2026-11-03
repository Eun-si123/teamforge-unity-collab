import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  GUEST_CORE_STATE_DIRECTORY,
  GUEST_STATE_MARKER,
  inspectGuestStateRoot,
  prepareGuestStateRoot,
} from "../src/guest-state.mjs";
import { cleanup, temporaryRoot } from "./helpers.mjs";

test("parallel Guest state preparation converges on one managed marker without transient conflicts", async () => {
  const root = await temporaryRoot();
  try {
    const stateRoot = path.join(root, "launcher-state");
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, () => prepareGuestStateRoot({ stateRoot })),
    );
    assert.deepEqual(attempts.filter((attempt) => attempt.status === "rejected"), [],
      "concurrent initializers must not reject each other's temporary marker files");
    const states = attempts.map((attempt) => attempt.value);
    assert.ok(states.every((state) => state.managed));
    assert.equal(new Set(states.map((state) => state.marker.rootId)).size, 1,
      "all callers must observe the same persistent ownership marker");
    assert.deepEqual(await readdir(path.join(stateRoot, GUEST_CORE_STATE_DIRECTORY)),
      [GUEST_STATE_MARKER], "the managed state directory must contain only its marker");
    assert.deepEqual(await readdir(stateRoot), [GUEST_CORE_STATE_DIRECTORY],
      "initialization must not leave temporary marker files in the Launcher root");
    assert.equal((await inspectGuestStateRoot({ stateRoot })).state, "managed");
  } finally {
    await cleanup(root);
  }
});


const runChild = promisify(execFile);

test("independent Guest processes converge on one marker without temporary conflicts", { timeout: 30000 }, async () => {
  const root = await temporaryRoot();
  try {
    const moduleUrl = new URL("../src/guest-state.mjs", import.meta.url).href;
    const childSource = `
      import { prepareGuestStateRoot } from ${JSON.stringify(moduleUrl)};
      const state = await prepareGuestStateRoot({ stateRoot: process.argv[1] });
      if (!state.managed) throw new Error("Guest state was not managed");
      process.stdout.write(state.marker.rootId);
    `;
    // Limit concurrent children on shared CI runners; use fresh roots per round.
    for (let round = 0; round < 3; round++) {
      const stateRoot = path.join(root, `launcher-${round}`);
      const results = await Promise.allSettled(
        Array.from({ length: 2 }, () => runChild(process.execPath,
          ["--input-type=module", "-e", childSource, stateRoot],
          { timeout: 12000, maxBuffer: 1024 })),
      );
      const rejected = results.filter((result) => result.status === "rejected");
      assert.deepEqual(rejected.map(({ reason }) => ({
        code: reason?.code ?? "unknown", signal: reason?.signal ?? null,
      })), [], "independent initializers must not conflict");
      const rootIds = results.map((result) => result.value.stdout.trim());
      assert.equal(new Set(rootIds).size, 1, "processes must observe one owner marker");
      assert.deepEqual(await readdir(path.join(stateRoot, GUEST_CORE_STATE_DIRECTORY)),
        [GUEST_STATE_MARKER]);
      assert.deepEqual(await readdir(stateRoot), [GUEST_CORE_STATE_DIRECTORY]);
    }
  } finally {
    await cleanup(root);
  }
});

test("Guest state preparation still rejects and preserves genuinely unmanaged entries", async () => {
  const root = await temporaryRoot();
  try {
    const stateRoot = path.join(root, "launcher-state");
    const guestRoot = path.join(stateRoot, GUEST_CORE_STATE_DIRECTORY);
    await mkdir(guestRoot, { recursive: true });
    const unrelated = path.join(guestRoot, "keep.txt");
    await writeFile(unrelated, "existing user content\n");
    await assert.rejects(() => prepareGuestStateRoot({ stateRoot }),
      { code: "guest_state_conflict" });
    assert.deepEqual(await readdir(guestRoot), ["keep.txt"]);
    assert.equal(await readFile(unrelated, "utf8"), "existing user content\n");
  } finally {
    await cleanup(root);
  }
});
