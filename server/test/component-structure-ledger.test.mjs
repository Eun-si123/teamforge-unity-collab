import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareComponentIdentityBaseline } from '../src/component-foundation.mjs';
import { seedComponentStructureLedger, applyComponentStructureReservation } from '../src/component-structure-ledger.mjs';
const sceneId = 'scene-struct';
const objectId = 'GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-10-0';
const componentId = 'GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-200-0';
const typeName = 'UnityEngine.BoxCollider';
const pending = 'tf:c:0123456789abcdef0123456789abcdef';
function fixture() {
  const session = { revision: 13, hierarchySceneIds: new Set([sceneId]),
    hierarchyObjects: new Map([[JSON.stringify([sceneId, objectId]), { sceneId, objectId }]]) };
  const baseline = prepareComponentIdentityBaseline(session, { sceneId, baseRevision: 13,
    components: [{ objectId, componentId, typeName }] },
  { maxComponents: 10, supportedTypes: new Set([typeName]) });
  assert.equal(baseline.error, undefined);
  const policy = { maxComponents: 10, types: new Map([[typeName, { canAdd: true,
    canRemove: true, allowMultiple: true, requires: [], minPerObject: 0, maxPerObject: 5 }]]) };
  return { session, baseline, policy };
}
const intent = { kind: 'add_component', sceneId, objectId, componentId: pending, typeName, baseRevision: 13 };
test('reservation returns idempotent receipt without claiming Unity apply', () => {
  const { session, baseline, policy } = fixture();
  assert.equal(seedComponentStructureLedger(session, baseline).serverRevision, 13);
  const first = applyComponentStructureReservation(session, baseline, intent, policy, 'op-1');
  assert.equal(first.reserved, true);
  assert.equal(first.appliedInUnity, false);
  assert.equal(first.rows.length, 2);
  assert.strictEqual(applyComponentStructureReservation(session, baseline, intent, policy, 'op-1'), first);
  assert.equal(applyComponentStructureReservation(session, baseline, { ...intent, componentId: 'tf:c:ffffffffffffffffffffffffffffffff' }, policy, 'op-1').error, 'component_structure_operation_conflict');
  assert.equal(applyComponentStructureReservation(session, baseline, intent, policy, 'op-2').error, 'component_structure_resnapshot_required');
  assert.equal(session.revision, 13);
});
test('stale revision and untrusted accessor do not mutate ledger', () => {
  const { session, baseline, policy } = fixture();
  seedComponentStructureLedger(session, baseline);
  const evil = { ...intent };
  Object.defineProperty(evil, 'componentId', { enumerable: true, get() { throw new Error('getter executed'); } });
  assert.equal(applyComponentStructureReservation(session, baseline, evil, policy, 'bad').error, 'invalid_component_structure');
  session.revision++;
  assert.equal(applyComponentStructureReservation(session, baseline, intent, policy, 'op').error, 'component_structure_ledger_unavailable');
});
