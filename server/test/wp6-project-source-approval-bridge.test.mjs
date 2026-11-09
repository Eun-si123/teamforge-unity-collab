import assert from "node:assert/strict";
import { createHash, createPrivateKey, sign } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { DEFAULTS } from "../src/config.mjs";
import { createProjectCoordinatorCore } from "../src/project-coordinator-core.mjs";
import { createSessionAuthority, makeSessionKey } from "../src/session-authority.mjs";
import { prepareComponentIdentityBaseline } from "../src/component-foundation.mjs";
import { prepareComponentPropertySnapshot } from "../src/component-property-foundation.mjs";
import { publisherObservationApprovalPayload }
  from "../src/component-publisher-observation-approval.mjs";
import { temporaryRoot, publicationFixture, cleanup }
  from "../../project-peer/test/helpers.mjs";
import { inspectWp6ProjectSceneAndPublisherObservationForLocalTest }
  from "../../scripts/wp6-source-approval-bridge.mjs";
import { inspectWp6PublisherColliderValuesInSignedSceneForLocalTest }
  from "../../scripts/wp6-signed-collider-value-bridge.mjs";
import { inspectWp6SerializedColliderValuesFromSignedTextForLocalTest }
  from "../../scripts/wp6-signed-collider-values.mjs";

const projectId = "wp6-bridge-project";
const projectUuid = "315b1ce0-5da1-4336-83ba-8ad070f38231";
const sessionId = "wp6-bridge-session";
const scenePath = "Assets/Scenes/Verified.unity";
const sceneGuid = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const otherSceneGuid = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const box = "UnityEngine.BoxCollider", sphere = "UnityEngine.SphereCollider";
const objectId = "GlobalObjectId_V1-2-" + sceneGuid + "-10-0";
const otherObjectId = "GlobalObjectId_V1-2-" + sceneGuid + "-11-0";
const boxId = "GlobalObjectId_V1-2-" + sceneGuid + "-20-0";
const sphereId = "GlobalObjectId_V1-2-" + sceneGuid + "-21-0";
const sceneBytes = Buffer.from(
  "%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n" +
  "--- !u!1 &42\nGameObject:\n  m_Name: Published Bytes\n", "utf8");
const metaBytes = Buffer.from("fileFormatVersion: 2\nguid: " + sceneGuid +
  "\nDefaultImporter:\n  externalObjects: {}\n");

// Exact direct Collider values used in the *prepared* Publisher observation
// fixture, and deliberately different from the original fixture Scene
// containing no Colliders. This exercises source-value proof, not a
// self-declared proof object from another Editor.
const colliderScene = Buffer.from(`%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &10
GameObject:
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_Component:
  - component: {fileID: 20}
--- !u!65 &20
BoxCollider:
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 10}
  m_IsTrigger: 0
  m_Center: {x: 0, y: 0, z: 0}
  m_Size: {x: 1, y: 2, z: 3}
--- !u!1 &11
GameObject:
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_Component:
  - component: {fileID: 21}
--- !u!135 &21
SphereCollider:
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 11}
  m_IsTrigger: 0
  m_Center: {x: 0, y: 0, z: 0}
  m_Radius: 0.5
--- !u!1660057539 &200
SceneRoots:
  m_Roots:
  - {fileID: 10}
  - {fileID: 11}
`, "utf8");

const digest = value => createHash("sha256").update(value).digest("hex");

async function setup({ meta = metaBytes, scene = sceneBytes } = {}) {
  const root = await temporaryRoot("teamforge-wp6-bridge-");
  try {
    const publication = await publicationFixture(root, {
      projectId, projectUuid, assetFiles: {
        [scenePath]: scene, [scenePath + ".meta"]: meta,
      },
    });
    const actor = {
      connectionId: "verified-publisher-editor", userId: "publisher-editor",
      userName: "Publisher", userColor: "#336699", projectId, sessionId,
      sessionKey: makeSessionKey(projectId, sessionId),
      supportsProjectTransfer: true, supportsHierarchySync: true,
      supportsTransformSync: true, supportsPresence: true,
    };
    const coordinator = createProjectCoordinatorCore({
      maxProjectPeersPerSession: 5, maxProjectRegistries: 5, maxSnapshotBytes: 1_000_000,
    });
    const realtime = createSessionAuthority({ ...DEFAULTS });
    assert.equal(coordinator.dispatch({
      type: "register_client", connection: actor, nowUnixMs: 1000,
    }).error, null);
    realtime.dispatch({ type: "register_presence", connection: actor,
      requestId: "join", nowUnixMs: 1000 });
    const { descriptor } = publication;
    const { descriptorSchemaVersion, projectId: _pathProject, ...wireDescriptor } = descriptor;
    assert.equal(coordinator.dispatch({
      type: "baseline_publish", connection: actor, nowUnixMs: 2000,
      message: { type: "project_baseline_publish", protocolVersion: 1,
        requestId: "signed-publish", userId: actor.userId, ...wireDescriptor },
    }).error, undefined);
    const registered = coordinator.projects.get(projectId);
    assert.equal(registered.baseline.manifestHash, publication.manifest.manifestHash);
    const session = realtime.activeSession(actor).session;
    session.revision = 7;
    session.hierarchySceneIds.add(sceneGuid);
    for (const id of [objectId, otherObjectId])
      session.hierarchyObjects.set(JSON.stringify([sceneGuid, id]), { sceneId: sceneGuid, objectId: id });
    const identities = [
      { objectId, componentId: boxId, typeName: box },
      { objectId: otherObjectId, componentId: sphereId, typeName: sphere },
    ];
    const identityBaseline = prepareComponentIdentityBaseline(session, {
      sceneId: sceneGuid, baseRevision: 7, components: identities,
    }, { maxComponents: 2, supportedTypes: new Set([box, sphere]) });
    assert.equal(identityBaseline.error, undefined, identityBaseline.reason);
    const records = identities.flatMap(identity => [
      { ...identity, propertyPath: "m_IsTrigger", valueKind: "boolean", value: false },
      { ...identity, propertyPath: "m_Center", valueKind: "vector3",
        value: { x: 0, y: 0, z: 0 } },
      identity.typeName === box
        ? { ...identity, propertyPath: "m_Size", valueKind: "vector3",
          value: { x: 1, y: 2, z: 3 } }
        : { ...identity, propertyPath: "m_Radius", valueKind: "float", value: 0.5 },
    ]);
    const propertySnapshot = prepareComponentPropertySnapshot(session, identityBaseline, {
      sceneId: sceneGuid, baseRevision: 7, properties: records,
    }, { maxProperties: 8, allowedProperties: new Map([
      [box, new Map([
        ["m_IsTrigger", { kind: "boolean" }],
        ["m_Center", { kind: "vector3", maximumAbsolute: 100 }],
        ["m_Size", { kind: "vector3", maximumAbsolute: 100 }],
      ])],
      [sphere, new Map([
        ["m_IsTrigger", { kind: "boolean" }],
        ["m_Center", { kind: "vector3", maximumAbsolute: 100 }],
        ["m_Radius", { kind: "float", minimum: 0, maximum: 100 }],
      ])],
    ]) });
    assert.equal(propertySnapshot.error, undefined, propertySnapshot.reason);
    const publisherApproval = {
      schemaVersion: 1, projectUuid, baselineRevision: descriptor.baselineRevision,
      manifestHash: descriptor.manifestHash, descriptorHash: descriptor.descriptorHash,
      sceneId: sceneGuid, realtimeRevision: 7,
      identityFingerprintSha256: digest(identityBaseline.fingerprint),
      propertyFingerprintSha256: digest(propertySnapshot.fingerprint),
      signature: "",
    };
    const payload = publisherObservationApprovalPayload(
      projectId, sessionId, actor.connectionId, publisherApproval);
    const ownerPrivate = createPrivateKey({
      key: Buffer.from(publication.owner.privateKey, "base64"),
      format: "der", type: "pkcs8",
    });
    publisherApproval.signature = sign(null, Buffer.from(payload), ownerPrivate).toString("base64");
    const args = {
      coordinator, realtime, actor, identityBaseline, propertySnapshot,
      publisherApproval, publication, scenePath, sceneGuid,
    };
    const inspect = (changes = {}) =>
      inspectWp6ProjectSceneAndPublisherObservationForLocalTest({ ...args, ...changes });
    return { root, inspect, ...args, session };
  } catch (error) {
    await cleanup(root);
    throw error;
  }
}

test("WP6 real signed Project Peer chunks and registered Server signed Publisher observations share one baseline", async () => {
  const f = await setup();
  try {
    const before = { revision: f.session.revision, history: f.session.operations.size };
    const value = await f.inspect();
    assert.equal(value.status,
      "signed_scene_bytes_and_publisher_observation_same_baseline_values_unverified");
    assert.equal(value.sceneId, sceneGuid);
    assert.equal(value.projectUuid, projectUuid);
    assert.equal(value.scenePath, scenePath);
    assert.equal(value.sceneFileSha256, digest(sceneBytes));
    assert.equal(value.sceneMetaSha256, digest(metaBytes));
    assert.equal(value.manifestHash, f.publication.manifest.manifestHash);
    assert.equal(value.propertyFingerprintSha256, digest(f.propertySnapshot.fingerprint));
    assert.equal(value.realtimeRevision, 7);
    assert.equal(value.serializedValuesVerified, false);
    assert.equal(value.networkWriteAuthorized, false);
    assert.equal(value.editorApplyVerified, false);
    assert(Object.isFrozen(value));
    assert.deepEqual({ revision: f.session.revision, history: f.session.operations.size }, before);
    // These fixture Scene bytes contain no Colliders; the bridge explicitly
    // does NOT treat signed file identity as observed Unity value equality.
    assert.equal(sceneBytes.includes(Buffer.from("BoxCollider")), false);
  } finally { await cleanup(f.root); }
});

test("WP6 wrong Scene GUID or a different signed Project manifest fails closed", async () => {
  const f = await setup();
  try {
    assert.equal((await f.inspect({ sceneGuid: otherSceneGuid })).error,
      "wp6_bridge_publisher_source_mismatch");
    const foreign = await setup();
    try {
      const result = await f.inspect({ publication: foreign.publication });
      // Same project UUID and Owner key differ, so signed descriptor pin fails.
      assert.equal(result.error, "wp6_bridge_signed_scene_invalid");
    } finally { await cleanup(foreign.root); }
    assert.equal(f.session.operations.size, 0);
  } finally { await cleanup(f.root); }
});

test("WP6 wrong .meta GUID, corrupt published chunk or missing signed metadata rejects source", async () => {
  for (const input of [
    { meta: Buffer.from("fileFormatVersion: 2\nguid: " + otherSceneGuid + "\n") },
    { meta: Buffer.from("fileFormatVersion: 2\n") },
  ]) {
    const f = await setup(input);
    try { assert.equal((await f.inspect()).error, "wp6_bridge_signed_scene_invalid"); }
    finally { await cleanup(f.root); }
  }
  const f = await setup();
  try {
    const file = f.publication.manifest.files.find(entry => entry.path === scenePath);
    await writeFile(f.publication.store.pathForHash(file.chunks[0].hash), "corrupt");
    assert.equal((await f.inspect()).error, "wp6_bridge_signed_scene_invalid");
  } finally { await cleanup(f.root); }
});

test("WP6 invalid Publisher approval, changed Session revision or replaced Publisher connection never bridges", async () => {
  const f = await setup();
  try {
    assert.equal((await f.inspect({ publisherApproval: {
      ...f.publisherApproval, signature: "",
    } })).error, "component_publisher_signature_invalid");
    f.session.revision++;
    assert.equal((await f.inspect()).error, "component_collider_observation_stale");
    f.session.revision--;
    f.session.members.set(f.actor.userId, {
      connectionId: "newer-connection", supportsHierarchySync: true,
    });
    assert.equal((await f.inspect()).error, "component_publisher_membership_stale");
  } finally { await cleanup(f.root); }
});

test("WP6 signed Project baseline rotation rejects old Publisher and published Scene source", async () => {
  const f = await setup();
  try {
    f.coordinator.projects.get(projectId).baseline.manifestHash = "d".repeat(64);
    const refused = await f.inspect();
    assert.equal(refused.error, "component_publisher_descriptor_invalid");
    assert.equal(f.session.revision, 7);
    assert.equal(f.session.operations.size, 0);
  } finally { await cleanup(f.root); }
});

test("WP6 in-flight Session revision change between signed source reads and completion rejects late proof", async () => {
  const f = await setup({ scene: Buffer.concat([sceneBytes, Buffer.alloc(512 * 1024, 120)]) });
  try {
    const pending = f.inspect();
    // The verifier necessarily awaits actual ChunkStore filesystem IO.
    // A microtask advances the independent shared Session before those
    // awaited reads can complete, without relying on timer scheduling.
    queueMicrotask(() => { f.session.revision++; });
    const result = await pending;
    assert.equal(result.error, "component_collider_observation_stale");
    assert.equal(f.session.operations.size, 0);
  } finally { await cleanup(f.root); }
});

test("WP6 signed, stored and verified direct Unity Collider YAML exactly matches Publisher-approved values", async () => {
  const f = await setup({ scene: colliderScene });
  try {
    const before = { revision: f.session.revision, history: f.session.operations.size };
    const result = await inspectWp6PublisherColliderValuesInSignedSceneForLocalTest(f);
    assert.equal(result.status,
      "signed_stored_scene_collider_values_match_approved_snapshot_offline", result.reason);
    assert.equal(result.componentCount, 2);
    assert.equal(result.propertyCount, 6);
    assert.equal(result.sceneId, sceneGuid);
    assert.equal(result.sceneFileSha256, digest(colliderScene));
    assert.equal(result.serializedValuesVerified, true);
    assert.equal(result.editorApplyVerified, false);
    assert.equal(result.networkWriteAuthorized, false);
    assert(Object.isFrozen(result));
    assert.deepEqual({ revision: f.session.revision, history: f.session.operations.size }, before);
  } finally { await cleanup(f.root); }
});

test("WP6 no serialized Colliders cannot be laundered by a perfectly valid Publisher signature", async () => {
  const f = await setup();
  try {
    const result = await inspectWp6PublisherColliderValuesInSignedSceneForLocalTest(f);
    assert.equal(result.error, "wp6_serialized_collider_values_mismatch");
    // Legacy #518 identity proof still explicitly does not attest values.
    assert.equal((await f.inspect()).serializedValuesVerified, false);
  } finally { await cleanup(f.root); }
});

test("WP6 exactly signed altered or missing Collider values fail closed, not an accepted different baseline", async () => {
  const cases = [
    colliderScene.toString().replace("m_Radius: 0.5", "m_Radius: 0.6"),
    colliderScene.toString().replace("m_Size: {x: 1, y: 2, z: 3}", "m_Size: {x: 1, y: 2, z: 4}"),
    colliderScene.toString().replace("m_IsTrigger: 0", "m_IsTrigger: 1"),
    colliderScene.toString().replace("m_GameObject: {fileID: 11}", "m_GameObject: {fileID: 10}"),
    colliderScene.toString().replace("  - component: {fileID: 21}", "  - component: {fileID: 20}"),
    colliderScene.toString().replace("--- !u!135 &21", "--- !u!135 &22"),
    colliderScene.toString().replace("--- !u!135 &21", "--- !u!65 &21").replace("SphereCollider:", "BoxCollider:"),
    colliderScene.toString().replace("m_Radius: 0.5", "m_Radius:"),
    colliderScene.toString().replace("m_Radius: 0.5", "m_Radius: NaN"),
    colliderScene.toString().replace("m_Radius: 0.5", "m_Radius: -5"),
    colliderScene.toString().replace("m_Center: {x: 0, y: 0, z: 0}",
      "m_Center: {x: 0, y: 0, z: 0}\n  m_Center: {x: 0, y: 0, z: 0}"),
    colliderScene.toString() + "--- !u!1001 &999\nPrefabInstance:\n",
    colliderScene.toString() + "--- !u!65 &999\nBoxCollider:\n",
    colliderScene.toString().replace("m_PrefabInstance: {fileID: 0}", "m_PrefabInstance: {fileID: 1001}"),
  ];
  for (const source of cases) {
    const f = await setup({ scene: Buffer.from(source) });
    try {
      const result = await inspectWp6PublisherColliderValuesInSignedSceneForLocalTest(f);
      assert.equal(result.error, "wp6_serialized_collider_values_mismatch", result.reason);
      assert.equal(f.session.operations.size, 0);
      assert.equal(f.session.revision, 7);
    } finally { await cleanup(f.root); }
  }
});

test("WP6 source-value check refuses damaged published Scene chunk, forged Publisher and in-flight Session drift", async () => {
  const f = await setup({ scene: colliderScene });
  try {
    const file = f.publication.manifest.files.find(row => row.path === scenePath);
    await writeFile(f.publication.store.pathForHash(file.chunks[0].hash), "tampered");
    const broken = await inspectWp6PublisherColliderValuesInSignedSceneForLocalTest(f);
    assert.equal(broken.error, "wp6_bridge_signed_scene_invalid");
  } finally { await cleanup(f.root); }

  const g = await setup({ scene: colliderScene });
  try {
    const forged = await inspectWp6PublisherColliderValuesInSignedSceneForLocalTest({
      ...g, publisherApproval: { ...g.publisherApproval, signature: "" },
    });
    assert.equal(forged.error, "component_publisher_signature_invalid");
    const pending = inspectWp6PublisherColliderValuesInSignedSceneForLocalTest(g);
    queueMicrotask(() => { g.session.revision++; });
    const late = await pending;
    assert.equal(late.error, "component_collider_observation_stale");
    assert.equal(g.session.operations.size, 0);
  } finally { await cleanup(g.root); }
});

test("WP6 source-value comparison cannot be tricked by cloning a prepared Collider snapshot", async () => {
  const f = await setup({ scene: colliderScene });
  try {
    const response = await inspectWp6PublisherColliderValuesInSignedSceneForLocalTest({
      ...f, propertySnapshot: { ...f.propertySnapshot },
    });
    assert.equal(response.error, "component_collider_observation_untrusted");
    assert.equal(f.session.operations.size, 0);
  } finally { await cleanup(f.root); }
});


test("WP6 Unity negative signed 64-bit fileIDs map to their exact unsigned saved GlobalObjectId bits", () => {
  const conversions = new Map([["10","-10"],["11","-11"],["20","-20"],["21","-21"]]);
  let yaml = colliderScene.toString();
  for (const [positive, negative] of conversions)
    yaml = yaml.replaceAll("&" + positive, "&" + negative)
      .replaceAll("fileID: " + positive + "}", "fileID: " + negative + "}");
  function id(n) {
    return "GlobalObjectId_V1-2-" + sceneGuid + "-" +
      BigInt.asUintN(64, -BigInt(n)).toString() + "-0";
  }
  const identityBaseline = { records: [
    { objectId: id(10), componentId: id(20), typeName: box },
    { objectId: id(11), componentId: id(21), typeName: sphere },
  ] };
  const propertySnapshot = { properties: identityBaseline.records.flatMap(row => [
    { ...row, propertyPath: "m_IsTrigger", valueKind: "boolean", value: false },
    { ...row, propertyPath: "m_Center", valueKind: "vector3",
      value: { x: 0, y: 0, z: 0 } },
    row.typeName === box
      ? { ...row, propertyPath: "m_Size", valueKind: "vector3",
        value: { x: 1, y: 2, z: 3 } }
      : { ...row, propertyPath: "m_Radius", valueKind: "float", value: 0.5 },
  ]) };
  const compare = changes =>
    inspectWp6SerializedColliderValuesFromSignedTextForLocalTest({
      sceneBytes: Buffer.from(yaml), sceneGuid, identityBaseline, propertySnapshot,
      ...changes,
    });
  assert.equal(compare().status,
    "signed_text_scene_colliders_equal_to_publisher_observation_offline");
  assert.equal(compare({
    sceneBytes: Buffer.from(yaml.replace("&-20", "&-9223372036854775809")),
  }).error, "wp6_serialized_collider_values_mismatch");
  assert.equal(compare({
    sceneBytes: Buffer.from(yaml.replace("m_Radius: 0.5", "m_Radius: 0.5001")),
  }).error, "wp6_serialized_collider_values_mismatch");
});

test("WP6 direct YAML parser rejects binary, oversized and partial observations", () => {
  const f = {
    sceneBytes: colliderScene,
    sceneGuid,
    identityBaseline: { records: [
      { objectId, componentId: boxId, typeName: box },
      { objectId: otherObjectId, componentId: sphereId, typeName: sphere },
    ] },
    propertySnapshot: { properties: [] },
  };
  assert.equal(inspectWp6SerializedColliderValuesFromSignedTextForLocalTest(f).error,
    "wp6_serialized_collider_values_mismatch");
  const bytes = Buffer.alloc(16 * 1024 * 1024 + 1, 32);
  assert.equal(inspectWp6SerializedColliderValuesFromSignedTextForLocalTest({
    ...f, sceneBytes: bytes,
  }).error, "wp6_serialized_collider_values_mismatch");
  assert.equal(inspectWp6SerializedColliderValuesFromSignedTextForLocalTest({
    ...f, sceneBytes: Buffer.from([0xff, 0xfe]),
  }).error, "wp6_serialized_collider_values_mismatch");
});
