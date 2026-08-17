#!/usr/bin/env node
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCT_VERSION } from "./constants.mjs";
import { fail } from "./errors.mjs";
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

export async function runGuestBridge({
  input = process.stdin,
  output = process.stdout,
  forbiddenRoots = [],
  orchestrator = new TeamForgeGuestOrchestrator({ forbiddenRoots }),
} = {}) {
  const lines = createInterface({ input, crlfDelay: Infinity, terminal: false });
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
  const guestEvent = ({ operationId: _operationId, ...event }) => {
    if (activeStartId) write({ id: activeStartId, ...event });
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
            lines.close();
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

  lines.on("line", (line) => {
    if (closing) return;
    let frame;
    try {
      frame = parseFrame(line);
    } catch (error) {
      terminalError("", error);
      return;
    }
    command(frame);
  });
  lines.once("close", () => {
    closing = true;
    orchestrator.cancel();
    finishIfIdle();
  });
  await closed;
  orchestrator.off("guestEvent", guestEvent);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runGuestBridge().catch((error) => {
    process.stderr.write(`TeamForge Guest bridge stopped: ${error?.code ?? "guest_bridge_failed"}\n`);
    process.exitCode = 1;
  });
}
