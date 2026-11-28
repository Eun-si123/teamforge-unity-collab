import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import path from "node:path";
import { fail, throwIfDownloadCancelled } from "./errors.mjs";
import { assertNoRedirectedDirectorySegments } from "./filesystem-safety.mjs";
import { sha256 } from "./hash.mjs";
import { sameSourceIdentity } from "./path-policy.mjs";
import { UNITY_DESCRIPTOR_RELATIVE_PATH, unityProjectDescriptorFromBaseline } from "./unity-project-descriptor.mjs";

const POSIX = process.platform !== "win32";
const READ_FLAGS = constants.O_RDONLY | (POSIX ?
  ((constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)) : 0);
const OCCUPIED = {
  code: "active_revision_exists",
  message: "Existing Active revision could not be verified as an interrupted activation. Its files have been preserved.",
};
const UNSAFE_PATH_ERRORS = new Set(["ENOENT", "ENOTDIR", "EISDIR", "ELOOP", "EACCES", "EPERM", "ESTALE"]);
const MAXIMUM_CONTROL_FILE_BYTES = 32 * 1024 * 1024;
const CONTROL_PATHS = new Set([
  "Packages/manifest.json",
  "Packages/packages-lock.json",
  "Packages/com.eunsung.teamforge/package.json",
  "ProjectSettings/ProjectVersion.txt",
]);

export function refuseOrphanActive() {
  fail(OCCUPIED.code, OCCUPIED.message);
}

async function inspectOrphan(signal, action) {
  throwIfDownloadCancelled(signal);
  try {
    return await action();
  } catch (error) {
    throwIfDownloadCancelled(signal);
    if (UNSAFE_PATH_ERRORS.has(error.code)) refuseOrphanActive();
    throw error;
  }
}

function expectedTree(descriptor, manifest, signal) {
  const root = new Map([["Assets", { children: new Map() }]]);
  // Use the same serialization as writeUnityProjectDescriptor.
  const generated = Buffer.from(`${JSON.stringify(unityProjectDescriptorFromBaseline(descriptor), null, 2)}\n`, "utf8");
  const generatedFile = {
    path: UNITY_DESCRIPTOR_RELATIVE_PATH,
    fileHash: sha256(generated),
    size: generated.length,
    executable: false,
  };
  for (const { path: relativePath, fileHash, size, executable } of [...manifest.files, generatedFile]) {
    throwIfDownloadCancelled(signal);
    const segments = relativePath.split("/");
    const fileName = segments.pop();
    let children = root;
    for (const segment of segments) {
      if (!children.has(segment)) children.set(segment, { children: new Map() });
      children = children.get(segment).children;
      if (!children) refuseOrphanActive();
    }
    if (children.has(fileName)) refuseOrphanActive();
    children.set(fileName, { fileHash, size, executable });
  }
  return { children: root };
}

async function entryIdentity(destination) {
  const identity = await lstat(destination, { bigint: true });
  if (identity.isSymbolicLink() || path.relative(destination, await realpath(destination)) !== "") {
    refuseOrphanActive();
  }
  return identity;
}

function assertSameIdentity(expected, actual) {
  const sameTypeAndIdentity = expected.isDirectory()
    ? actual.isDirectory() && expected.dev === actual.dev && expected.ino === actual.ino &&
      expected.size === actual.size && expected.mtimeNs === actual.mtimeNs &&
      expected.ctimeNs === actual.ctimeNs && expected.mode === actual.mode
    : sameSourceIdentity(expected, actual);
  if (!sameTypeAndIdentity || expected.nlink !== actual.nlink) refuseOrphanActive();
}

async function verifyDirectory(destination, children, identity, signal) {
  if (!identity.isDirectory() || (POSIX && (identity.mode & 0o5000n) !== 0n)) refuseOrphanActive();
  const missing = new Set(children.keys());
  // Iterate incrementally so a foreign directory with many entries remains bounded.
  const directory = await opendir(destination);
  for await (const entry of directory) {
    throwIfDownloadCancelled(signal);
    if (!missing.delete(entry.name)) refuseOrphanActive();
  }
  if (missing.size !== 0) refuseOrphanActive();
  assertSameIdentity(identity, await entryIdentity(destination));
}

async function verifyFile(destination, file, identity, buffer, captured, signal) {
  const mode = file.executable ? 0o755n : 0o644n;
  if (!identity.isFile() || identity.nlink !== 1n || identity.size !== BigInt(file.size) || (POSIX &&
      ((identity.mode & 0o7777n & ~mode) !== 0n ||
       ((identity.mode & 0o111n) !== 0n) !== file.executable))) {
    refuseOrphanActive();
  }

  const handle = await open(destination, READ_FLAGS);
  let verified = false;
  try {
    assertSameIdentity(identity, await handle.stat({ bigint: true }));
    const hash = createHash("sha256");
    let offset = 0;
    while (offset < file.size) {
      throwIfDownloadCancelled(signal);
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, file.size - offset), null);
      if (bytesRead === 0) refuseOrphanActive();
      const bytes = buffer.subarray(0, bytesRead);
      hash.update(bytes);
      if (captured) bytes.copy(captured, offset);
      offset += bytesRead;
    }
    throwIfDownloadCancelled(signal);
    const { bytesRead: excess } = await handle.read(buffer, 0, 1, null);
    if (excess !== 0 || hash.digest("hex") !== file.fileHash) refuseOrphanActive();
    assertSameIdentity(identity, await handle.stat({ bigint: true }));
    assertSameIdentity(identity, await entryIdentity(destination));
    verified = true;
  } finally {
    try { await handle.close(); }
    catch (error) { if (verified) throw error; }
  }
}

// A normal Active project may contain local edits. Orphan adoption is stricter:
// only the complete, untouched materialization of the approved Baseline can be reused.
export async function verifyOrphanActive({ activePath, descriptor, manifest, signal }) {
  return inspectOrphan(signal, async () => {
    await assertNoRedirectedDirectorySegments(activePath, OCCUPIED);
    const pending = [{ relativePath: "", destination: activePath, entry: expectedTree(descriptor, manifest, signal) }];
    const witnesses = [];
    const metadata = new Map();
    const buffer = Buffer.allocUnsafe(64 * 1024);
    const rootIdentity = await entryIdentity(activePath);
    while (pending.length > 0) {
      throwIfDownloadCancelled(signal);
      const { relativePath, destination, entry } = pending.pop();
      const identity = relativePath === "" ? rootIdentity : await entryIdentity(destination);
      if (identity.dev !== rootIdentity.dev) refuseOrphanActive();
      if (entry.children) {
        await verifyDirectory(destination, entry.children, identity, signal);
        for (const [name, child] of entry.children) {
          pending.push({
            relativePath: relativePath ? `${relativePath}/${name}` : name,
            destination: path.join(destination, name),
            entry: child,
          });
        }
      } else {
        const isControlFile = CONTROL_PATHS.has(relativePath);
        if (isControlFile && entry.size > MAXIMUM_CONTROL_FILE_BYTES) refuseOrphanActive();
        const captured = isControlFile ? Buffer.allocUnsafe(entry.size) : undefined;
        await verifyFile(destination, entry, identity, buffer, captured, signal);
        if (captured) metadata.set(relativePath, captured);
      }
      witnesses.push({ destination, identity, children: entry.children });
    }
    // Verify absence for control paths that were not signed as files. A
    // different name can still resolve on a case-insensitive filesystem.
    for (const relativePath of CONTROL_PATHS) {
      if (metadata.has(relativePath)) continue;
      try {
        await lstat(path.join(activePath, relativePath));
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      refuseOrphanActive();
    }
    throwIfDownloadCancelled(signal);

    return {
      async checkUnchanged(checkSignal = signal) {
        await inspectOrphan(checkSignal, async () => {
          await assertNoRedirectedDirectorySegments(activePath, OCCUPIED);
          // Children precede their ancestors so a directory replacement or a
          // newly added name can still fail the final comparison.
          for (let index = witnesses.length - 1; index >= 0; index -= 1) {
            throwIfDownloadCancelled(checkSignal);
            const { destination, identity, children } = witnesses[index];
            assertSameIdentity(identity, await entryIdentity(destination));
            if (children) await verifyDirectory(destination, children, identity, checkSignal);
          }
          throwIfDownloadCancelled(checkSignal);
        });
      },
      async readVerifiedMetadata(relativePath) {
        const captured = metadata.get(relativePath);
        if (!captured) {
          if (!CONTROL_PATHS.has(relativePath)) {
            throw new TypeError("Unknown Active Project control file.");
          }
          throw Object.assign(new Error("Active Project control file is absent."), { code: "ENOENT" });
        }
        return captured.toString("utf8");
      },
    };
  });
}
