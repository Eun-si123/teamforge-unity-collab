#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCT_VERSION } from "./constants.mjs";
import { TeamForgePeerError, fail } from "./errors.mjs";
import { guestErrorInfo, TeamForgeGuestOrchestrator } from "./guest-orchestrator.mjs";

const MAXIMUM_FRAME_BYTES = 1_048_576;
const FRAME_KEYS = Object.freeze({
  health: ["id", "type"],
  inspect: ["id", "invite", "managedRoot", "stateRoot", "type"],
  start: ["authenticationToken", "id", "invite", "managedRoot", "stateRoot", "type"],
  trust: ["approved", "challengeId", "id", "type"],
  pause: ["id", "type"],
  resume: ["id", "type"],
  cancel: ["id", "type"],
  shutdown: ["id", "type"],
});

function exactKeys(frame, expected) {
  const actual = Object.keys(frame).sort();
  const required = expected.filter((key) => key !== "authenticationToken");
  const allowedWithoutOptional = expected.filter((key) => key !== "authenticationToken").sort();
  const allowedWithOptional = [...expected].sort();
  return required.every((key) => Object.hasOwn(frame, key)) &&
    (JSON.stringify(actual) === JSON.stringify(allowedWithoutOptional) ||
      JSON.stringify(actual) === JSON.stringify(allowedWithOptional));
}

function validateFrame(frame) {
  if (!frame || typeof frame !== "object" || Array.isArray(frame) ||
      typeof frame.id !== "string" || frame.id.length < 1 || frame.id.length > 128 ||
      /[\u0000-\u001f\u007f]/u.test(frame.id) || !Object.hasOwn(FRAME_KEYS, frame.type) ||
      !exactKeys(frame, FRAME_KEYS[frame.type])) {
    fail("invalid_guest_request", "Guest bridge request fields are invalid.");
  }
  if (["inspect", "start"].includes(frame.type) &&
      (![frame.invite, frame.managedRoot, frame.stateRoot].every((value) => typeof value === "string"))) {
    fail("invalid_guest_request", "Guest inspect/start request values are invalid.");
  }
  if (frame.type === "trust" &&
      (typeof frame.challengeId !== "string" || typeof frame.approved !== "boolean")) {
    fail("invalid_guest_request", "Guest trust response is invalid.");
  }
  return frame;
}

function parseFrame(line) {
  if (typeof line !== "string" || Buffer.byteLength(line, "utf8") > MAXIMUM_FRAME_BYTES) {
    fail("invalid_guest_request", "Guest bridge request is too large.");
  }
  try {
    return validateFrame(JSON.parse(line));
  } catch (error) {
    if (error?.code) throw error;
    fail("invalid_guest_request", "Guest bridge request is not valid JSON.");
  }
}

// Decode LF/CR/CRLF byte frames without asking readline to retain an
// arbitrarily large line. An oversized frame is discarded until its delimiter;
// no request bytes or partial UTF-8 characters enter diagnostics.
async function* readGuestFrames(input) {
  const frameBuffer = Buffer.alloc(MAXIMUM_FRAME_BYTES);
  let bytes = 0;
  let oversized = false;
  let skipLineFeed = false;
  for await (const value of input) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    if (chunk.length === 0) continue;
    let cursor = 0;
    if (skipLineFeed) {
      if (chunk[0] === 10) cursor = 1;
      skipLineFeed = false;
    }
    while (cursor < chunk.length) {
      let end = cursor;
      while (end < chunk.length && chunk[end] !== 10 && chunk[end] !== 13) end++;
      if (!oversized) {
        const length = end - cursor;
        if (bytes + length > MAXIMUM_FRAME_BYTES) {
          bytes = 0;
          oversized = true;
        } else if (length) {
          chunk.copy(frameBuffer, bytes, cursor, end);
          bytes += length;
        }
      }
      if (end === chunk.length) break;
      const carriageReturn = chunk[end] === 13;
      yield oversized
        ? { oversized: true }
        : { line: frameBuffer.toString("utf8", 0, bytes) };
      bytes = 0;
      oversized = false;
      cursor = end + 1;
      if (carriageReturn) {
        if (cursor < chunk.length && chunk[cursor] === 10) cursor++;
        else if (cursor === chunk.length) skipLineFeed = true;
      }
    }
  }
  if (oversized) yield { oversized: true };
  else if (bytes > 0) yield { line: frameBuffer.toString("utf8", 0, bytes) };
}

export async function runGuestBridge({
  input = process.stdin,
  output = process.stdout,
  forbiddenRoots = [],
  orchestrator = new TeamForgeGuestOrchestrator({ forbiddenRoots }),
} = {}) {
  const operations = new Set();
  let activeStartId = "";
  let closing = false;
  let closeResolve;
  const closed = new Promise((resolve) => { closeResolve = resolve; });
  const write = (value) => output.write(`${JSON.stringify(value)}\n`);
  const finishIfIdle = () => {
    if (closing && operations.size === 0) closeResolve();
  };
  const track = (promise) => {
    operations.add(promise);
    promise.finally(() => {
      operations.delete(promise);
      finishIfIdle();
    }).catch(() => {});
  };
  const guestEvent = ({ operationId, ...event }) => {
    // A prior run can still have an asynchronous callback after the next start.
    // Only the currently active orchestrator run may own the bridge request ID.
    if (activeStartId && operationId && operationId === orchestrator.active?.operationId) {
      write({ id: activeStartId, ...event });
    }
  };
  orchestrator.on("guestEvent", guestEvent);

  const terminalError = (id, error, secrets = []) => write({
    id,
    event: "error",
    error: guestErrorInfo(error, { secrets, diagnostics: orchestrator.diagnostics?.() ?? {} }),
  });
  const command = (frame) => {
    if (frame.type === "start") {
      const id = frame.id;
      if (activeStartId) {
        // The orchestrator rejects overlapping receives, but changing this ID
        // before that rejection would misattribute or drop the first run's events.
        terminalError(id, new TeamForgePeerError(
          "guest_operation_busy", "Another Guest receive operation is already running.",
        ));
        return;
      }
      activeStartId = id;
      const promise = orchestrator.start({
        invite: frame.invite,
        managedRoot: frame.managedRoot,
        stateRoot: frame.stateRoot,
        authenticationToken: frame.authenticationToken ?? "",
      }).then((result) => {
        write({ id, event: "complete", result });
      }).catch((error) => {
        terminalError(id, error, [frame.authenticationToken ?? ""]);
      }).finally(() => {
        if (activeStartId === id) activeStartId = "";
      });
      track(promise);
      return;
    }
    const promise = (async () => {
      try {
        let result;
        switch (frame.type) {
          case "health":
            result = {
              ready: true,
              bridge: "teamforge-guest-bridge-v1",
              productVersion: PRODUCT_VERSION,
              backend: "project-peer",
              runtimeStrategy: "bundled-verified-only",
            };
            break;
          case "inspect":
            result = await orchestrator.inspect({
              invite: frame.invite,
              managedRoot: frame.managedRoot,
              stateRoot: frame.stateRoot,
            });
            break;
          case "trust":
            result = orchestrator.trust({ challengeId: frame.challengeId, approved: frame.approved });
            break;
          case "pause": result = orchestrator.pause(); break;
          case "resume": result = orchestrator.resume(); break;
          case "cancel": result = orchestrator.cancel(); break;
          case "shutdown":
            result = orchestrator.cancel();
            closing = true;
            break;
          default: fail("invalid_guest_request", "Guest bridge request type is unsupported.");
        }
        write({ id: frame.id, event: "complete", result });
      } catch (error) {
        terminalError(frame.id, error);
      }
    })();
    track(promise);
  };

  try {
    // Do not await command operations here: pause/cancel/trust must remain
    // responsive while a Guest receive is still in progress.
    for await (const next of readGuestFrames(input)) {
      if (closing) break;
      let frame;
      try {
        if (next.oversized) {
          fail("invalid_guest_request", "Guest bridge request is too large.");
        }
        frame = parseFrame(next.line);
      } catch (error) {
        terminalError("", error);
        continue;
      }
      command(frame);
      if (closing) break; // shutdown must not wait for stdin EOF.
    }
  } finally {
    closing = true;
    orchestrator.cancel();
    finishIfIdle();
    await closed;
  }
  orchestrator.off("guestEvent", guestEvent);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runGuestBridge().catch((error) => {
    process.stderr.write(`TeamForge Guest bridge stopped: ${error?.code ?? "guest_bridge_failed"}\n`);
    process.exitCode = 1;
  });
}
