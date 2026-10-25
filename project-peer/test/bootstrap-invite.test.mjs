import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  BOOTSTRAP_INVITE_FORMAT,
  createBootstrapInvite,
  parseGuestInvite,
  parseSessionJoinCode,
  validateBootstrapInvite,
} from "../src/bootstrap-invite.mjs";
import { createInvite } from "../src/invite.mjs";
import { generateIdentity } from "../src/identity.mjs";

function sessionCode({
  serverAddress = "https://teamforge.example.com/base",
  realtimePath = "ws",
  projectId = "highway-95",
  projectUuid,
  sessionId = "artists",
  additions = {},
} = {}) {
  const payload = {
    format: "teamforge-join-v1",
    serverAddress,
    realtimePath,
    projectId,
    sessionId,
    projectUuid,
    productVersion: "0.5.1",
    hostDisplayName: "Host",
    createdUtc: "2026-08-14T07:30:00.000Z",
    sceneBaseline: {
      scenePath: "Assets/Scenes/Main.unity",
      sceneGuid: "1".repeat(32),
      sha256: "2".repeat(64),
    },
    ...additions,
  };
  return `TF1.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
}

function fixture() {
  const owner = generateIdentity("Owner");
  const projectUuid = randomUUID();
  const projectInvite = createInvite({
    serverAddress: "https://teamforge.example.com/base",
    realtimePath: "ws",
    projectId: "highway-95",
    projectUuid,
    sessionId: "artists",
    ownerIdentity: owner,
  });
  const sessionJoinCode = sessionCode({ projectUuid });
  return { owner, projectUuid, projectInvite, sessionJoinCode };
}

test("WP4 Owner-signed bootstrap envelope binds the unchanged Project Invite and TF1 session contract", () => {
  const source = fixture();
  const envelope = createBootstrapInvite({
    projectInvite: source.projectInvite,
    sessionJoinCode: source.sessionJoinCode,
    ownerIdentity: source.owner,
  });
  assert.equal(envelope.format, BOOTSTRAP_INVITE_FORMAT);
  assert.equal(envelope.projectInvite, source.projectInvite);
  assert.equal(envelope.sessionJoinCode, source.sessionJoinCode);
  const verified = validateBootstrapInvite(envelope);
  assert.equal(verified.projectInvite.projectUuid, source.projectUuid);
  assert.equal(verified.sessionJoin.sceneBaseline.sha256, "2".repeat(64));
  assert.deepEqual(parseGuestInvite(JSON.stringify(envelope)), verified);
});

test("WP4 legacy signed Project Transfer Invite remains accepted without a realtime handoff", () => {
  const { projectInvite } = fixture();
  const parsed = parseGuestInvite(JSON.stringify(projectInvite));
  assert.equal(parsed.envelope, null);
  assert.equal(parsed.sessionJoin, null);
  assert.deepEqual(parsed.projectInvite, projectInvite);
});

test("WP4 bootstrap invite rejects unsigned additions and tampering in either internal contract", () => {
  const source = fixture();
  const envelope = createBootstrapInvite({
    projectInvite: source.projectInvite,
    sessionJoinCode: source.sessionJoinCode,
    ownerIdentity: source.owner,
  });
  assert.throws(
    () => validateBootstrapInvite({ ...envelope, authenticationToken: "must-not-be-carried" }),
    { code: "invalid_bootstrap_invite" },
  );
  assert.throws(
    () => validateBootstrapInvite({ ...envelope, sessionJoinCode: `${envelope.sessionJoinCode}A` }),
  );
  assert.throws(
    () => parseGuestInvite(JSON.stringify({ ...source.projectInvite, unknown: true })),
    { code: "invalid_invite" },
  );
  const decoded = parseSessionJoinCode(source.sessionJoinCode);
  const extra = `TF1.${Buffer.from(JSON.stringify({ ...decoded, authenticationToken: "secret" })).toString("base64url")}`;
  assert.throws(() => parseSessionJoinCode(extra), { code: "invalid_join_code" });
});

test("WP4 bootstrap invite rejects cross-project, cross-session, and cross-endpoint binding", () => {
  const source = fixture();
  for (const sessionJoinCode of [
    sessionCode({ projectUuid: randomUUID() }),
    sessionCode({ projectUuid: source.projectUuid, sessionId: "other-session" }),
    sessionCode({ projectUuid: source.projectUuid, serverAddress: "https://other.example.com/base" }),
  ]) {
    assert.throws(
      () => createBootstrapInvite({
        projectInvite: source.projectInvite,
        sessionJoinCode,
        ownerIdentity: source.owner,
      }),
      { code: "bootstrap_invite_mismatch" },
    );
  }
});

test("WP4 Guest invite input is bounded, canonical, and rejects unsafe realtime paths", () => {
  const source = fixture();
  assert.throws(() => parseGuestInvite("{"), { code: "invalid_bootstrap_invite" });
  assert.throws(
    () => parseGuestInvite(JSON.stringify({ padding: "x".repeat(65_536) })),
    { code: "invalid_bootstrap_invite" },
  );
  const upper = { ...source.projectInvite, projectUuid: source.projectUuid.toUpperCase() };
  assert.throws(() => parseGuestInvite(JSON.stringify(upper)), { code: "invalid_invite" });
  assert.throws(
    () => parseSessionJoinCode(sessionCode({ projectUuid: source.projectUuid, realtimePath: "../ws" })),
    { code: "invalid_join_code" },
  );
  assert.throws(() => parseSessionJoinCode("TF1.A"), { code: "invalid_join_code" });
});

test("signed realtime invites reject paths that the WebSocket client would normalize or refuse", () => {
  const source = fixture();
  for (const realtimePath of ["rooms/%41", "rooms/%e2%98%83", "rooms/%",
    "rooms/./ws", "rooms/%2e%2e/ws", "rooms//ws", "rooms\\ws",
    "w\ts", "ws\n", "rooms/\rws", "ws\u0000",
    " ", " ws", "ws ", " ws ", "\u00a0ws", "ws\u00a0"]) {
    assert.throws(
      () => parseSessionJoinCode(sessionCode({ projectUuid: source.projectUuid, realtimePath })),
      { code: "invalid_join_code" },
      realtimePath,
    );
    assert.throws(
      () => createInvite({
        serverAddress: "https://teamforge.example.com/base", realtimePath,
        projectId: "highway-95", projectUuid: source.projectUuid,
        sessionId: "artists", ownerIdentity: source.owner,
      }),
      { code: "invalid_invite" },
      realtimePath,
    );
  }
  assert.equal(parseSessionJoinCode(sessionCode({
    projectUuid: source.projectUuid, realtimePath: "rooms/live%20one",
  })).realtimePath, "rooms/live%20one");
});

test("signed invites reject ASCII controls in raw server addresses before URL normalization", () => {
  const source = fixture();
  for (const serverAddress of [
    "\nhttps://teamforge.example.com/base", "https://teamforge.example.com/base\r",
    "https://teamforge.example.com\n/base", "https://teamforge.example.com\t/base",
    "https://teamforge.example.com/base/%41", "https://teamforge.example.com/base/%2E/ws",
  ]) {
    assert.throws(
      () => parseSessionJoinCode(sessionCode({ projectUuid: source.projectUuid, serverAddress })),
      { code: "invalid_join_code" },
      JSON.stringify(serverAddress),
    );
    assert.throws(
      () => createInvite({ serverAddress, realtimePath: "ws", projectId: "highway-95",
        projectUuid: source.projectUuid, sessionId: "artists", ownerIdentity: source.owner }),
      { code: "invalid_invite" },
      JSON.stringify(serverAddress),
    );
  }
});

test("Unity-supported slash-wrapped realtime paths survive signed TF1/bootstrap validation", () => {
  const source = fixture();
  const realtimePath = "/ws/"; // Unity TeamForgeUriBuilderTests explicitly supports this input.
  const projectInvite = createInvite({
    serverAddress: "https://teamforge.example.com/base", realtimePath,
    projectId: "highway-95", projectUuid: source.projectUuid,
    sessionId: "artists", ownerIdentity: source.owner,
  });
  const sessionJoinCode = sessionCode({ projectUuid: source.projectUuid, realtimePath });
  assert.equal(parseSessionJoinCode(sessionJoinCode).realtimePath, realtimePath);
  const envelope = createBootstrapInvite({ projectInvite, sessionJoinCode, ownerIdentity: source.owner });
  assert.equal(validateBootstrapInvite(envelope).sessionJoin.realtimePath, realtimePath);
});

test("WP4 rejects numeric IPv4 shorthand in signed Project Invites and TF1 join codes", () => {
  const source = fixture();
  const malformed = [
    "http://192.168.219.:5080",
    "https://192.168.219:5080",
    "ws://127.1:5080",
    "wss://192.168.219.005:5080",
    "http://192.168.219.5.:5080",
    "http://192.168..5:5080",
    "http://192.168.219.999:5080",
    "http://0x7f.0.0.1:5080",
    "http://0177.0.0.1:5080",
    "http://2130706433:5080",
    "http://%31%32%37.0.0.1:5080",
    "http:127.1:5080",
    "http:/127.1:5080",
    "http:\\127.1:5080",
    "http://127.1\\@example.com",
  ];
  for (const serverAddress of malformed) {
    assert.throws(
      () => parseSessionJoinCode(sessionCode({ projectUuid: source.projectUuid, serverAddress })),
      { code: "invalid_join_code" },
      serverAddress,
    );
    assert.throws(
      () => createInvite({
        serverAddress, realtimePath: "ws", projectId: "highway-95",
        projectUuid: source.projectUuid, sessionId: "artists", ownerIdentity: source.owner,
      }),
      { code: "invalid_invite" },
      serverAddress,
    );
  }
  for (const serverAddress of [
    "http://192.168.219.5:5080",
    "https://127.0.0.1:5080",
    "wss://teamforge.example.com/base",
    "ws://[::1]:5080",
    "http://localhost:5080",
    "https://123.example.com/base",
    "https://example.123.com/base",
    "http://[2001:db8::1]:5080",
  ]) {
    assert.equal(parseSessionJoinCode(
      sessionCode({ projectUuid: source.projectUuid, serverAddress }),
    ).serverAddress, serverAddress);
    assert.equal(createInvite({
      serverAddress, realtimePath: "ws", projectId: "highway-95",
      projectUuid: source.projectUuid, sessionId: "artists", ownerIdentity: source.owner,
    }).serverAddress, serverAddress);
  }
});
