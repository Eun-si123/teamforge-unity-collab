import assert from "node:assert/strict";
import test from "node:test";
import filesystem from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { buildManifest } from "../src/manifest.mjs";
import { discoverProjectContent } from "../src/path-policy.mjs";
import { cleanup, createUnityProject, temporaryRoot } from "./helpers.mjs";

const PROJECT_UUID = "12345678-1234-4234-8234-123456789abc";

async function fixture(relative = "Assets/Target.bin", bytes = "original-source") {
  const root = await temporaryRoot("teamforge-manifest-source-");
  const project = path.join(root, "project");
  await createUnityProject(project, { assetFiles: { [relative]: bytes } });
  return { root, project, target: path.join(project, ...relative.split("/")) };
}

function publish(f, store = { put: async () => {} }) {
  return buildManifest({ projectRoot: f.project, projectUuid: PROJECT_UUID, baselineRevision: 1, store });
}

function sourceChanged(f) {
  return (error) => {
    assert.equal(error.code, "source_changed");
    assert.equal(error.message.includes(f.root), false, "Diagnostics must not reveal the absolute source path.");
    assert.equal(error.message.includes("private-path-sentinel"), false);
    assert.equal(error.details, undefined);
    return true;
  };
}

// These wrappers exercise the real imported builtin bindings at one controlled
// boundary in this test file's isolated, sequential worker. Always restore them.
async function withOperations(replacements, operation) {
  const originals = Object.fromEntries(Object.keys(replacements).map((name) => [name, filesystem[name]]));
  for (const [name, replace] of Object.entries(replacements)) {
    filesystem[name] = (...args) => replace(originals[name], ...args);
  }
  syncBuiltinESMExports();
  try { return await operation(); }
  finally {
    Object.assign(filesystem, originals);
    syncBuiltinESMExports();
  }
}

test("stable source retains the existing manifest hash and keeps discovery metadata internal", async () => {
  const f = await fixture("Assets/Stable.txt", "stable source\n");
  try {
    await filesystem.writeFile(path.join(f.project, "Assets", "Empty.txt"), "");
    const discovery = await discoverProjectContent(f.project);
    assert.equal(typeof discovery.files[0].sourceIdentity.ino, "bigint");
    assert.equal(typeof discovery.files[0].sourceIdentity.mtimeNs, "bigint");
    const first = await publish(f);
    const second = await publish(f);
    assert.deepEqual(first.manifest, second.manifest);
    assert.equal(first.manifestHash, "c08aa8bbe421edabd57f4a6a730adf4578487c4ac1d131ce4cab8b33786fc72a");
    assert.equal(JSON.stringify(first.manifest).includes("sourceIdentity"), false);
    assert.equal(first.manifest.totalBytes, 93);
  } finally { await cleanup(f.root); }
});

test("manifest rejects a real file replacement immediately before open without storing replacement bytes", async () => {
  const f = await fixture();
  try {
    const replacement = path.join(f.root, "replacement.bin");
    await filesystem.writeFile(replacement, "replacement-data");
    let retired = false;
    let installed = false;
    const offered = [];
    await withOperations({ open: async (original, ...args) => {
      if (args[0] === f.target && !installed) {
        await filesystem.rename(f.target, `${f.target}.retired`);
        retired = true;
        await filesystem.rename(replacement, f.target);
        installed = true;
      }
      return original(...args);
    } }, () => assert.rejects(publish(f, { put: async (bytes) => offered.push(Buffer.from(bytes)) }), sourceChanged(f)));
    assert.equal(retired && installed, true, "Both native pathname mutations must complete.");
    assert.equal(offered.length, 0, "The opened replacement must be rejected before any source bytes reach the store.");
  } finally { await cleanup(f.root); }
});

test("manifest compares exact wide inode and nanosecond identities before reading", async () => {
  for (const field of ["ino", "mtimeNs", "ctimeNs"]) {
    const f = await fixture();
    try {
      const wide = 2n ** 60n;
      assert.equal(Number(wide), Number(wide + 1n), "The fixture must exercise a distinction lost by Number precision.");
      const identity = (info, value) => Object.assign(Object.create(Object.getPrototypeOf(info)), info, { [field]: value });
      let inspected = false;
      let read = false;
      await withOperations({
        lstat: async (original, ...args) => {
          const info = await original(...args);
          if (args[0] === f.target) {
            assert.equal(args[1]?.bigint, true);
            return identity(info, wide);
          }
          return info;
        },
        open: async (original, ...args) => {
          const handle = await original(...args);
          if (args[0] === f.target) {
            const stat = handle.stat.bind(handle);
            handle.stat = async (...statArgs) => {
              assert.equal(statArgs[0]?.bigint, true);
              inspected = true;
              return identity(await stat(...statArgs), wide + 1n);
            };
            handle.read = async () => { read = true; throw new Error("A differing identity must not be read."); };
          }
          return handle;
        },
      }, () => assert.rejects(publish(f), sourceChanged(f)));
      assert.equal(inspected, true);
      assert.equal(read, false);
    } finally { await cleanup(f.root); }
  }
});

test("manifest rejects mixed-time parent observations before external bytes reach the store", async () => {
  const f = await fixture("Assets/Nested/Target.bin");
  let release;
  try {
    const outside = path.join(f.root, "outside");
    await filesystem.mkdir(outside);
    await filesystem.writeFile(path.join(outside, "Target.bin"), "synthetic-external-data");
    const gate = new Promise((resolve) => { release = resolve; });
    let inspections = 0;
    let retired = false;
    let installed = false;
    const offered = [];
    await withOperations({
      lstat: async (original, ...args) => {
        if (args[0] === f.target && ++inspections === 2) await gate;
        return original(...args);
      },
      realpath: async (original, ...args) => {
        const resolved = await original(...args);
        if (args[0] === f.target && !installed) {
          try {
            const parent = path.dirname(f.target);
            await filesystem.rename(parent, `${parent}-retired`);
            retired = true;
            await filesystem.symlink(outside, parent, "junction");
            installed = true;
          } finally { release(); }
        }
        return resolved;
      },
    }, () => assert.rejects(publish(f, { put: async (bytes) => offered.push(Buffer.from(bytes).toString()) }), sourceChanged(f)));
    assert.equal(retired && installed, true, "The real parent must be retired and an external link installed.");
    assert.equal(offered.includes("synthetic-external-data"), false);
    assert.equal(offered.length, 0, "Discovery's inode must reject the mixed namespace before reading.");
  } finally { release?.(); await cleanup(f.root); }
});

test("manifest bounds growth after the opened-handle check to the discovered byte budget", async () => {
  const f = await fixture("Assets/Target.bin", "original-source");
  try {
    let readBytes = 0;
    let requestedEnd = 0;
    let grew = false;
    await withOperations({ open: async (original, ...args) => {
      const handle = await original(...args);
      if (args[0] === f.target) {
        const read = handle.read.bind(handle);
        handle.read = async (...readArgs) => {
          if (!grew) { await filesystem.appendFile(f.target, "x".repeat(131_072)); grew = true; }
          requestedEnd = Math.max(requestedEnd, readArgs[3] + readArgs[2]);
          const result = await read(...readArgs);
          readBytes += result.bytesRead;
          return result;
        };
      }
      return handle;
    } }, () => assert.rejects(publish(f), sourceChanged(f)));
    assert.equal(grew, true);
    assert.equal(readBytes, Buffer.byteLength("original-source"));
    assert.equal(requestedEnd, Buffer.byteLength("original-source"));
  } finally { await cleanup(f.root); }
});

test("manifest rejects final-path replacement after reading the pinned inode", async () => {
  const f = await fixture();
  try {
    const replacement = path.join(f.root, "replacement.bin");
    await filesystem.writeFile(replacement, "replacement-data");
    let retired = false;
    let installed = false;
    let pinned = false;
    await withOperations({ open: async (original, ...args) => {
      const handle = await original(...args);
      if (args[0] === f.target) {
        const stat = handle.stat.bind(handle);
        let calls = 0;
        handle.stat = async (...statArgs) => {
          const value = await stat(...statArgs);
          if (++calls === 2) {
            await filesystem.rename(f.target, `${f.target}.retired`);
            retired = true;
            await filesystem.rename(replacement, f.target);
            installed = true;
            const current = await stat(...statArgs);
            pinned = current.dev === value.dev && current.ino === value.ino;
          }
          return value;
        };
      }
      return handle;
    } }, () => assert.rejects(publish(f), sourceChanged(f)));
    assert.equal(retired && installed && pinned, true, "Both native renames must complete while the original handle stays pinned.");
  } finally { await cleanup(f.root); }
});

test("manifest source read errors are path-free", async () => {
  const f = await fixture();
  try {
    await withOperations({ open: async (original, ...args) => {
      const handle = await original(...args);
      if (args[0] === f.target) {
        handle.read = async () => { throw Object.assign(new Error(`${f.root}/private-path-sentinel`), { code: "EIO" }); };
      }
      return handle;
    } }, () => assert.rejects(publish(f), sourceChanged(f)));
  } finally { await cleanup(f.root); }
});

test("manifest preserves store and cancellation failures when source close also fails", async () => {
  const failures = [
    ...["chunk_store_write_failed", "download_cancelled"].map((code) => Object.assign(new Error("primary store failure"), { code })),
    undefined, null, false, 0, "",
  ];
  for (const primary of failures) {
    const f = await fixture();
    try {
      let closed = false;
      await withOperations({ open: async (original, ...args) => {
        const handle = await original(...args);
        if (args[0] === f.target) {
          const close = handle.close.bind(handle);
          handle.close = async () => { await close(); closed = true; throw new Error("private-path-sentinel close failure"); };
        }
        return handle;
      } }, () => assert.rejects(publish(f, { put: async () => { throw primary; } }), (error) => error === primary));
      assert.equal(closed, true);
    } finally { await cleanup(f.root); }
  }
});

test("JSON discovery scans the entire file and marker boundaries, preserving secret errors through close failure", async () => {
  const padding = "x".repeat(65_530);
  const f = await fixture("Assets/Unexpected.json", `${padding}\"privateKey\":1,\"publicKey\":2,\"keyId\":3`);
  try {
    let closed = false;
    await withOperations({ open: async (original, ...args) => {
      const handle = await original(...args);
      if (args[0] === f.target) {
        const close = handle.close.bind(handle);
        handle.close = async () => { await close(); closed = true; throw new Error("private-path-sentinel close failure"); };
      }
      return handle;
    } }, () => assert.rejects(publish(f), { code: "secret_file_rejected" }));
    assert.equal(closed, true);
  } finally { await cleanup(f.root); }
});

test("JSON discovery bounds growth to its discovered size with at most 64 KiB reads", async () => {
  const bytes = `{"padding":"${"x".repeat(100_000)}"}`;
  const f = await fixture("Assets/Target.json", bytes);
  try {
    let readBytes = 0;
    let requestedEnd = 0;
    let largestRead = 0;
    let grew = false;
    await withOperations({ open: async (original, ...args) => {
      const handle = await original(...args);
      if (args[0] === f.target && !grew) {
        const read = handle.read.bind(handle);
        handle.read = async (...readArgs) => {
          if (!grew) { await filesystem.appendFile(f.target, "y".repeat(131_072)); grew = true; }
          requestedEnd = Math.max(requestedEnd, readArgs[3] + readArgs[2]);
          largestRead = Math.max(largestRead, readArgs[0].length);
          const result = await read(...readArgs);
          readBytes += result.bytesRead;
          return result;
        };
      }
      return handle;
    } }, () => assert.rejects(publish(f), sourceChanged(f)));
    assert.equal(grew, true);
    assert.equal(readBytes, Buffer.byteLength(bytes));
    assert.equal(requestedEnd, Buffer.byteLength(bytes));
    assert.equal(largestRead, 65_536);
  } finally { await cleanup(f.root); }
});

for (const extension of ["bin", "json"]) {
  test(`${extension === "json" ? "JSON discovery" : "manifest hashing"} rejects a FIFO swapped immediately before open without hanging`, async (context) => {
    if (process.platform === "win32") { context.skip("POSIX FIFO fixture is unavailable on Windows."); return; }
    const f = await fixture(`Assets/Target.${extension}`);
    try {
      const fifo = path.join(f.root, "replacement-pipe");
      const creation = spawnSync("mkfifo", [fifo], { encoding: "utf8", timeout: 5_000 });
      if (creation.error?.code === "ENOENT") { context.skip("POSIX mkfifo utility is unavailable."); return; }
      assert.equal(creation.status, 0, "The actual FIFO fixture must be created successfully.");
      const child = `
        import filesystem from "node:fs/promises";
        import { syncBuiltinESMExports } from "node:module";
        import { buildManifest } from ${JSON.stringify(new URL("../src/manifest.mjs", import.meta.url).href)};
        const [project,target,fifo] = process.argv.slice(1);
        const original = filesystem.open;
        let retired=false, installed=false, opened=false;
        filesystem.open = async (...args) => {
          if(args[0]===target && !installed) {
            await filesystem.rename(target,target+".retired"); retired=true;
            await filesystem.rename(fifo,target); installed=true;
          }
          const handle=await original(...args);
          if(args[0]===target) opened=true;
          return handle;
        };
        syncBuiltinESMExports();
        try {
          await buildManifest({projectRoot:project,projectUuid:${JSON.stringify(PROJECT_UUID)},baselineRevision:1,store:{put:async()=>{}}});
          process.exitCode=2;
        } catch(error) {
          process.stdout.write(JSON.stringify({code:error.code,retired,installed,opened,leaked:error.message.includes(project)}));
          if(error.code!=="source_changed") process.exitCode=3;
        }
      `;
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", child, f.project, f.target, fifo], {
        encoding: "utf8", timeout: 5_000, killSignal: "SIGKILL",
      });
      assert.equal(result.error?.code, undefined, "The reader must reject the FIFO within the subprocess deadline.");
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), { code: "source_changed", retired: true, installed: true, opened: true, leaked: false });
    } finally { await cleanup(f.root); }
  });
}
