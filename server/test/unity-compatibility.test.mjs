import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import {
  baselineCanonicalPayload,
  calculateSeedRank,
  descriptorIsCompatible,
  descriptorMatchesBaseline,
  ownerProofPayload,
  verifyProjectDescriptor,
} from "../src/project-coordinator.mjs";
import { createProjectCoordinatorCore } from "../src/project-coordinator-core.mjs";

const projectId = "unity-compatibility-fixture";
const projectUuid = "0b84eb0e-4692-41f6-887a-c13b06971993";
const owner = generateKeyPairSync("ed25519");
const publicKey = owner.publicKey.export({ format: "der", type: "spki" });
const ownerKeyId = createHash("sha256").update(publicKey).digest("hex");
const connection = {
  connectionId: "compatibility-owner", userId: "owner", userName: "Owner",
  projectId, sessionId: "compatibility-session", sessionKey: "",
  supportsProjectTransfer: true,
};

function descriptor(unityVersion, overrides = {}) {
  const value = {
    userId: connection.userId, projectUuid, baselineRevision: 1,
    manifestHash: "a".repeat(64), descriptorHash: "", unityVersion,
    teamForgePackageVersion: "0.5.1", realtimeProtocolVersion: 1,
    transferProtocolVersion: 1, manifestSchemaVersion: 1,
    ownerKeyId, ownerPublicKey: publicKey.toString("base64"),
    publisherKeyId: ownerKeyId, publisherPublicKey: publicKey.toString("base64"),
    publisherAuthorization: "", baselineSignature: "", ...overrides,
  };
  const payload = Buffer.from(baselineCanonicalPayload(projectId, value), "utf8");
  value.descriptorHash = createHash("sha256").update(payload).digest("hex");
  value.baselineSignature = sign(null, payload, owner.privateKey).toString("base64");
  return value;
}

function peer(value, overrides = {}) {
  return { ...value, connectionId: connection.connectionId, completeBaseline: true,
    ownerProofVerified: true, availableChunkCount: 2, ...overrides };
}

function coordinator() {
  const core = createProjectCoordinatorCore({
    maxProjectPeersPerSession: 4, maxProjectRegistries: 4, maxSnapshotBytes: 1_000_000,
  });
  assert.equal(core.dispatch({ type: "register_client", connection, nowUnixMs: 1_000 }).error, null);
  return core;
}

function publish(core, value) {
  return core.dispatch({ type: "baseline_publish", connection, nowUnixMs: 2_000,
    message: { type: "project_baseline_publish", protocolVersion: 1, requestId: "publish", ...value } });
}

function announce(core, value) {
  const message = {
    type: "project_peer_announce", protocolVersion: 1, requestId: "announce", ...value,
    completeBaseline: true, availableChunkCount: 2, totalChunkCount: 2,
    endpoint: "http://127.0.0.1:5091/teamforge-transfer/v1",
    transferToken: "fixture-transfer-token-0123456789", ownerProofSignature: "",
  };
  message.ownerProofSignature = sign(null,
    Buffer.from(ownerProofPayload(projectId, connection.connectionId, message), "utf8"),
    owner.privateKey).toString("base64");
  return core.dispatch({ type: "peer_announce", connection, message, nowUnixMs: 3_000 });
}

test("legacy Unity 6.3 descriptor matching retains its existing release channels", () => {
  for (const version of ["6000.3.21f1", "6000.3.27f2", "6000.3.1a1", "6000.3.1b2", "6000.3.1p1"]) {
    const value = descriptor(version);
    assert.equal(descriptorIsCompatible(value), true, version);
    assert.equal(calculateSeedRank(peer(value), value), 0, version);
  }
});

test("stable experimental Unity 6.6 descriptors preserve their signed version and seed ranks", () => {
  for (const version of ["6000.6.0f1", "6000.6.7f1"]) {
    const signed = descriptor(version);
    const checked = verifyProjectDescriptor(signed, projectId);
    assert.equal(checked.error, null, version);
    assert.equal(checked.descriptor.unityVersion, version);
    assert.equal(checked.descriptor.descriptorHash, signed.descriptorHash);
    assert.equal(checked.descriptor.baselineSignature, signed.baselineSignature);
    assert.equal(descriptorIsCompatible(checked.descriptor), true, version);
    assert.equal(calculateSeedRank(peer(checked.descriptor), checked.descriptor), 0, version);
    assert.equal(calculateSeedRank(peer(checked.descriptor, { ownerProofVerified: false }), checked.descriptor), 1);
    assert.equal(calculateSeedRank(peer(checked.descriptor, { completeBaseline: false }), checked.descriptor), 2);
    assert.equal(calculateSeedRank(peer(checked.descriptor, { completeBaseline: false, availableChunkCount: 0 }),
      checked.descriptor, connection.connectionId), 3);
  }
});

test("Unity 6.6 accepts only a bounded ASCII stable full token without normalization", () => {
  const invalid = [
    "6000.6.7a1", "6000.6.7b1", "6000.6.7p1", "6000.6.7rc1", "6000.6.7f1-extra",
    "6000.6.7F1", "6000.6.７f1", "6000.6.7f１", "6000.6.7f1\0",
    "6000.6.7f1\n", "6000.6.7f1\r\n", "6000.6.7f1\u2028", "6000.6.7f1\u2029",
    " 6000.6.7f1", "6000.6.7f1 ", "\t6000.6.7f1", "6000.6.7\nf1",
    "6000.6.7f1\u200b", "6000.6.7f1\u00a0", `6000.6.${"1".repeat(56)}f1`,
    "6000.4.12f1", "6000.5.11f1", "6000.7.1f1", "7000.1.1f1", "2022.3.62f3",
    null, undefined, 6000.6, true, {}, [], ["6000.6.7f1"], new String("6000.6.7f1"),
  ];
  for (const version of invalid) {
    const value = { ...descriptor("6000.6.7f1"), unityVersion: version };
    assert.equal(descriptorIsCompatible(value), false, String(version));
    assert.equal(calculateSeedRank(peer(value), value), 99, String(version));
  }
  // A grammar boundary, not a claim that this synthetic patch is released.
  const maximumToken = `6000.6.${"1".repeat(55)}f1`;
  assert.equal(maximumToken.length, 64);
  assert.equal(descriptorIsCompatible(descriptor(maximumToken)), true);
});

test("Unity 6.6 admission keeps product, protocol and exact baseline constraints", () => {
  const value = descriptor("6000.6.7f1");
  for (const field of ["realtimeProtocolVersion", "transferProtocolVersion", "manifestSchemaVersion"]) {
    assert.equal(descriptorIsCompatible({ ...value, [field]: 2 }), false, field);
  }
  assert.equal(descriptorIsCompatible({ ...value, teamForgePackageVersion: "9.9.9" }), false);
  for (const changed of [
    { projectUuid: "a731e80e-e0af-4d58-b3d8-77d026f0c69e" }, { baselineRevision: 2 },
    { manifestHash: "b".repeat(64) }, { descriptorHash: "c".repeat(64) },
  ]) assert.equal(calculateSeedRank(peer({ ...value, ...changed }), value), 99);

  const lts = descriptor("6000.3.27f2");
  assert.equal(descriptorIsCompatible(lts), true);
  assert.equal(descriptorMatchesBaseline(value, lts), false);
  assert.equal(calculateSeedRank(peer(value), lts), 99, "Compatibility must not mix different signed Editor baselines.");
  assert.notEqual(verifyProjectDescriptor({ ...value, unityVersion: "6000.6.8f1" }, projectId).error, null,
    "Changing the signed version without signing again must still fail.");
});

test("a signed Unity 6.6 baseline can publish and announce an Owner seed", () => {
  const core = coordinator();
  const value = descriptor("6000.6.7f1");
  const published = publish(core, value);
  assert.equal(published.effects.find(effect => effect.message.type === "error"), undefined);
  assert.equal(core.projects.get(projectId)?.baseline.unityVersion, value.unityVersion);
  assert.equal(core.projects.get(projectId)?.baseline.descriptorHash, value.descriptorHash);
  assert.equal(core.projects.get(projectId)?.baseline.baselineSignature, value.baselineSignature);
  const joined = announce(core, value).effects.find(effect => effect.message.type === "project_peer_joined");
  assert.equal(joined?.message.peer.seedRank, 0);
  assert.equal(joined.message.peer.unityVersion, value.unityVersion);
});

test("a signed Unity 6.6 Owner announcement can recover an empty registry", () => {
  const core = coordinator();
  const value = descriptor("6000.6.7f1");
  const result = announce(core, value);
  assert.equal(result.effects.find(effect => effect.message.type === "error"), undefined);
  assert.equal(core.projects.get(projectId)?.baseline.unityVersion, value.unityVersion);
  assert.equal(core.projects.get(projectId)?.baseline.descriptorHash, value.descriptorHash);
  assert.equal(result.effects.find(effect => effect.message.type === "project_peer_joined")?.message.peer.seedRank, 0);
});

test("signed future or prerelease Unity versions cannot publish or recover a registry", () => {
  for (const version of ["6000.6.7a1", "6000.6.7b1", "6000.6.7p1", "6000.7.1f1", "7000.1.1f1"]) {
    const value = descriptor(version);
    assert.equal(verifyProjectDescriptor(value, projectId).error, null, "Signature validity is separate from compatibility.");
    for (const operation of [publish, announce]) {
      const core = coordinator();
      const result = operation(core, value);
      assert.equal(result.effects[0]?.message.code, "incompatible_project_descriptor", version);
      assert.equal(core.projects.size, 0);
    }
  }
});
