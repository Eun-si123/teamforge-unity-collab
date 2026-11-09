// Pure, narrow saved-Unity-text Scene value comparator for WP6 test research.
// No filesystem, networking, native Unity Editor, authority, or writes here.
// Reject unsupported YAML rather than treating unknown Scene fields as values.
const MAX_YAML_BYTES = 16 * 1024 * 1024;
const MAX_DOCS = 65_536;
const MAX_LINES = 131_072;
const MAX_COLLIDERS = 512;
const HEADER = /^--- !u!([0-9]{1,10}) &(-?[1-9][0-9]{0,19})$/u;
const COMPONENT = /^  - component: \{fileID: (-?[1-9][0-9]{0,19})\}$/u;
const REF = /^\{fileID: (-?[1-9][0-9]{0,19})\}$/u;
const NUMBER = /^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/u;
const VECTOR = /^\{x: ([^,}]{1,32}), y: ([^,}]{1,32}), z: ([^,}]{1,32})\}$/u;
const GUID = /^[0-9a-f]{32}$/u;
const GLOBAL = /^GlobalObjectId_V1-2-([0-9a-f]{32})-([1-9][0-9]{0,19})-0$/u;

function rejected(reason) {
  return Object.freeze({ error: "wp6_serialized_collider_values_mismatch", reason });
}
function localId(value) {
  if (typeof value !== "string" || !/^-?[1-9][0-9]{0,19}$/u.test(value)) return null;
  const id = BigInt(value);
  return id < -(1n << 63n) || id >= (1n << 63n) || id === 0n
    ? null : BigInt.asUintN(64, id).toString();
}
function globalId(text, sceneGuid) {
  const m = typeof text === "string" ? GLOBAL.exec(text) : null;
  if (!m || m[1] !== sceneGuid) return null;
  const id = BigInt(m[2]);
  return id > 0n && id <= (1n << 64n) - 1n && id.toString() === m[2]
    ? m[2] : null;
}
function finiteFloat(text, nonnegative = false) {
  if (typeof text !== "string" || text.length > 32 || !NUMBER.test(text)) return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < (nonnegative ? 0 : -100) || n > 100) return null;
  const f = Math.fround(n);
  return Number.isFinite(f) ? f : null;
}
function sameScalar(actual, wanted) {
  return Number.isFinite(wanted) && Math.fround(wanted) === actual &&
    wanted >= -100 && wanted <= 100;
}
function vector(text, nonnegative = false) {
  const m = typeof text === "string" ? VECTOR.exec(text) : null;
  if (!m) return null;
  const values = m.slice(1).map(t => finiteFloat(t, nonnegative));
  return values.every(v => v !== null) ? values : null;
}
function exactReference(doc, field) {
  const m = REF.exec(doc.fields.get(field) ?? "");
  return m ? localId(m[1]) : null;
}
function plainMapRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null);
}

export function inspectWp6SerializedColliderValuesFromSignedTextForLocalTest({
  sceneBytes, sceneGuid, identityBaseline, propertySnapshot,
} = {}) {
  if (!Buffer.isBuffer(sceneBytes) || sceneBytes.length === 0 ||
      sceneBytes.length > MAX_YAML_BYTES || !GUID.test(sceneGuid ?? "") ||
      sceneGuid === "00000000000000000000000000000000" ||
      !Array.isArray(identityBaseline?.records) ||
      !Array.isArray(propertySnapshot?.properties) ||
      identityBaseline.records.length < 1 ||
      identityBaseline.records.length > MAX_COLLIDERS ||
      propertySnapshot.properties.length !== identityBaseline.records.length * 3)
    return rejected("Requires a bounded, complete Scene Collider observation and signed-source byte input.");

  // Precount newlines BEFORE String.split. A 16 MiB file containing only
  // newlines could otherwise create millions of JS string/array entries.
  let lineCount = 1;
  for (const byte of sceneBytes) {
    if (byte === 10 && ++lineCount > MAX_LINES)
      return rejected("Scene text exceeds the maximum YAML line count.");
  }
  let yaml;
  try { yaml = new TextDecoder("utf-8", { fatal: true }).decode(sceneBytes); }
  catch { return rejected("Scene content is not strict UTF-8 text."); }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(yaml))
    return rejected("Scene YAML contains unsupported binary control characters.");
  const lines = yaml.split(/\r?\n/u);
  if (lines[0] !== "%YAML 1.1" || lines[1] !== "%TAG !u! tag:unity3d.com,2011:")
    return rejected("Scene must use the supported Unity text serialization header.");

  const seenIds = new Set(), owners = new Map(), colliders = new Map();
  let current = null, count = 0;
  function finish() {
    if (!current) return true;
    if (current.classId !== 1 && current.classId !== 65 && current.classId !== 135)
      return true;
    if (current.fields.get("m_CorrespondingSourceObject") !== "{fileID: 0}" ||
        current.fields.get("m_PrefabInstance") !== "{fileID: 0}" ||
        current.fields.get("m_PrefabAsset") !== "{fileID: 0}") return false;
    if (current.classId === 1) {
      if (current.root !== "GameObject:" || owners.has(current.id)) return false;
      owners.set(current.id, current);
      return true;
    }
    if (current.root !== (current.classId === 65 ? "BoxCollider:" : "SphereCollider:") ||
        colliders.size >= MAX_COLLIDERS || colliders.has(current.id)) return false;
    colliders.set(current.id, current);
    return true;
  }
  for (let index = 2; index < lines.length; index++) {
    const line = lines[index];
    if (line.length > 16_384)
      return rejected("Unity Scene YAML exceeds the per-line length budget.");
    if (line.startsWith("---")) {
      if (!finish() || ++count > MAX_DOCS)
        return rejected("Scene has unsupported, duplicated or too many YAML documents.");
      const m = HEADER.exec(line);
      const id = m ? localId(m[2]) : null;
      const classId = m ? Number(m[1]) : 0;
      if (!id || !Number.isSafeInteger(classId) || classId < 1 ||
          classId === 1001 || seenIds.has(id))
        return rejected("Scene has invalid, duplicated or Prefab-backed YAML document IDs.");
      seenIds.add(id);
      current = { id, classId, root: null, fields: new Map(), refs: new Set(),
        sawComponents: false };
      continue;
    }
    if (!current) {
      if (line.length) return rejected("Scene has content outside its Unity YAML documents.");
      continue;
    }
    if (![1, 65, 135].includes(current.classId)) continue;
    if (current.root === null) {
      current.root = line;
      continue;
    }
    if (line.startsWith("  m_Component:")) {
      if (current.classId !== 1 || current.sawComponents || line !== "  m_Component:")
        return rejected("GameObject Component references are ambiguous.");
      current.sawComponents = true;
      continue;
    }
    if (current.classId === 1 && current.sawComponents &&
        line.startsWith("  - component:")) {
      const m = COMPONENT.exec(line);
      const reference = m ? localId(m[1]) : null;
      if (!reference || current.refs.has(reference))
        return rejected("GameObject has malformed or duplicate Component references.");
      current.refs.add(reference);
      continue;
    }
    if (line.startsWith("  m_")) {
      const colon = line.indexOf(":", 2);
      if (colon <= 2 || (colon < line.length - 1 && line[colon + 1] !== " "))
        return rejected("Scene property has unsupported serialized structure.");
      const name = line.slice(2, colon);
      if (current.fields.has(name))
        return rejected("Scene contains duplicate serialized property fields.");
      current.fields.set(name, colon === line.length - 1 ? "" : line.slice(colon + 2));
    }
  }
  if (!finish() || count < 1)
    return rejected("Scene has an invalid final YAML document.");

  const expected = new Map();
  for (const row of identityBaseline.records) {
    const componentId = globalId(row.componentId, sceneGuid);
    const ownerId = globalId(row.objectId, sceneGuid);
    if (!componentId || !ownerId || componentId === ownerId ||
        expected.has(componentId) ||
        !["UnityEngine.BoxCollider", "UnityEngine.SphereCollider"].includes(row.typeName))
      return rejected("Approved Collider identity cannot map to exact saved Scene local IDs.");
    expected.set(componentId, { ownerId, type: row.typeName, properties: new Map() });
  }
  for (const row of propertySnapshot.properties) {
    const componentId = globalId(row.componentId, sceneGuid);
    const ownerId = globalId(row.objectId, sceneGuid);
    const candidate = expected.get(componentId);
    if (!candidate || candidate.ownerId !== ownerId || candidate.type !== row.typeName ||
        candidate.properties.has(row.propertyPath) ||
        !["m_IsTrigger", "m_Center", candidate.type === "UnityEngine.BoxCollider"
          ? "m_Size" : "m_Radius"].includes(row.propertyPath))
      return rejected("Approved property has a missing, repeated or mismatched Collider identity.");
    candidate.properties.set(row.propertyPath, row);
  }
  if (expected.size !== colliders.size)
    return rejected("Signed Unity Scene Collider documents differ from approved complete set.");

  for (const [id, collider] of colliders) {
    const wanted = expected.get(id);
    const owner = wanted && owners.get(wanted.ownerId);
    if (!wanted || !owner || !owner.sawComponents || !owner.refs.has(id) ||
        collider.classId !== (wanted.type === "UnityEngine.BoxCollider" ? 65 : 135) ||
        exactReference(collider, "m_GameObject") !== wanted.ownerId ||
        wanted.properties.size !== 3)
      return rejected("Signed Collider is missing, owned by another GameObject or has wrong type.");

    const trigger = wanted.properties.get("m_IsTrigger");
    const center = wanted.properties.get("m_Center");
    const extent = wanted.properties.get(collider.classId === 65 ? "m_Size" : "m_Radius");
    const serializedTrigger = collider.fields.get("m_IsTrigger");
    if (trigger?.valueKind !== "boolean" || typeof trigger.value !== "boolean" ||
        !["0", "1"].includes(serializedTrigger) ||
        (serializedTrigger === "1") !== trigger.value ||
        center?.valueKind !== "vector3" || !plainMapRecord(center.value))
      return rejected("Signed Collider trigger or center type differs.");
    const v = vector(collider.fields.get("m_Center"));
    if (!v || !["x","y","z"].every((axis,i) => sameScalar(v[i], center.value[axis])))
      return rejected("Signed Collider center does not match Publisher-approved values.");
    if (collider.classId === 65) {
      if (extent?.valueKind !== "vector3" || !plainMapRecord(extent.value))
        return rejected("Signed BoxCollider size kind is invalid.");
      const size = vector(collider.fields.get("m_Size"), true);
      if (!size || !["x","y","z"].every((axis,i) =>
        sameScalar(size[i], extent.value[axis]) && extent.value[axis] >= 0))
        return rejected("Signed BoxCollider size differs.");
    } else {
      const radius = finiteFloat(collider.fields.get("m_Radius"), true);
      if (extent?.valueKind !== "float" || radius === null ||
          !sameScalar(radius, extent.value) || extent.value < 0)
        return rejected("Signed SphereCollider radius differs.");
    }
  }
  return Object.freeze({
    status: "signed_text_scene_colliders_equal_to_publisher_observation_offline",
    sceneId: sceneGuid,
    componentCount: expected.size,
    propertyCount: propertySnapshot.properties.length,
    editorApplyVerified: false,
    networkWriteAuthorized: false,
  });
}
