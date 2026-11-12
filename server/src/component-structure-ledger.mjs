// Server-local, opt-in structural transaction ledger. Not wired to transport or Unity.
// A committed entry is a reservation, NOT proof that an Editor applied the change.
import { prepareComponentStructureCandidate, validateComponentStructureCandidate } from './component-structure-foundation.mjs';

const ledgers = new WeakMap();
const LIMIT = 256;
const fail = (error, revision) => Object.freeze({ error, serverRevision: revision });

export function seedComponentStructureLedger(session, baseline) {
  if (!session || !Number.isSafeInteger(session.revision) || session.revision < 0 ||
      !baseline || baseline.baseRevision !== session.revision ||
      !Array.isArray(baseline.records) || ledgers.has(session)) {
    return fail('component_structure_seed_refused', session?.revision ?? null);
  }
  // The candidate validator verifies provenance on every apply. Never trust
  // an unverified baseline to establish a mutation capability.
  const state = { baseline, revision: session.revision, rows: baseline.records.map(row => ({
    sceneId: row.sceneId, objectId: row.objectId,
    componentId: row.componentId, typeName: row.typeName,
  })), receipts: new Map() };
  ledgers.set(session, state);
  return Object.freeze({ serverRevision: state.revision });
}

export function applyComponentStructureReservation(session, baseline, intent, policy, operationId) {
  const state = ledgers.get(session);
  if (!state || baseline !== state.baseline || session.revision !== state.revision) {
    return fail('component_structure_ledger_unavailable', session?.revision ?? null);
  }
  if (typeof operationId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(operationId)) {
    return fail('component_structure_operation_invalid', state.revision);
  }
  // Validate inert data before serializing; never invoke caller getters.
  if (validateComponentStructureCandidate(intent)) {
    return fail('invalid_component_structure', state.revision);
  }
  const fingerprint = JSON.stringify([intent.kind, intent.sceneId, intent.objectId,
    intent.componentId, intent.typeName, intent.baseRevision]);
  const receipt = state.receipts.get(operationId);
  if (receipt) return receipt.fingerprint === fingerprint
    ? receipt.result : fail('component_structure_operation_conflict', state.revision);
  if (state.receipts.size >= LIMIT || state.revision === Number.MAX_SAFE_INTEGER) {
    return fail('component_structure_ledger_full', state.revision);
  }
  // No speculative apply: candidate must match the original trusted baseline.
  // After the first reservation a fresh authoritative Unity snapshot is required.
  if (state.receipts.size !== 0) return fail('component_structure_resnapshot_required', state.revision);
  const plan = prepareComponentStructureCandidate(session, baseline, intent, policy);
  if (plan.error) return fail(plan.error, state.revision);
  const next = state.rows.slice();
  if (plan.kind === 'add_component') {
    next.push(Object.freeze({ sceneId: plan.sceneId, objectId: plan.objectId,
      componentId: plan.componentId, typeName: plan.typeName }));
  } else {
    const index = next.findIndex(row => row.componentId === plan.componentId &&
      row.sceneId === plan.sceneId && row.objectId === plan.objectId && row.typeName === plan.typeName);
    if (index < 0) return fail('component_structure_identity_missing', state.revision);
    next.splice(index, 1);
  }
  const result = Object.freeze({ reserved: true, appliedInUnity: false,
    serverRevision: state.revision, rows: Object.freeze(next) });
  state.rows = next;
  state.receipts.set(operationId, { fingerprint, result });
  return result;
}
