/**
 * Trusted, deterministic property probes for the model/tool boundary.
 * Models may fix code but cannot write evaluator oracles.
 */
export const PROBE_FAMILIES = Object.freeze([
  'malformed_truncated', 'malformed_nonjson', 'wrong_type_string',
  'wrong_type_bool', 'missing_required', 'extra_property', 'invalid_enum',
  'valid_integer', 'unknown_tool', 'handler_exception', 'wrong_type_null',
]);

export function makeProbe(index) {
  if (!Number.isInteger(index) || index < 0 || index > 50000) {
    throw new Error('Probe cursor must be a bounded nonnegative integer');
  }
  const family = PROBE_FAMILIES[index % PROBE_FAMILIES.length];
  const generation = Math.floor(index / PROBE_FAMILIES.length);
  const positive = 3 + (generation * 17 + index * 11) % 1000;
  const argsByFamily = {
    malformed_truncated: '{"count":',
    malformed_nonjson: '{"count":NaN}',
    wrong_type_string: JSON.stringify({ count: 'not-an-integer-' + positive }),
    wrong_type_bool: JSON.stringify({ count: positive % 2 === 0 }),
    missing_required: JSON.stringify({ mode: 'safe' }),
    extra_property: JSON.stringify({ count: positive, unexpected: 'unapproved-' + positive }),
    invalid_enum: JSON.stringify({ count: positive, mode: 'elevated-' + positive }),
    valid_integer: JSON.stringify({ count: positive, mode: 'safe' }),
    unknown_tool: JSON.stringify({ count: positive }),
    handler_exception: JSON.stringify({ count: positive }),
    wrong_type_null: JSON.stringify({ count: null }),
  };
  return Object.freeze({
    id: 'probe_' + family + '_' + generation, family, generation,
    rawArguments: argsByFamily[family],
    toolName: family === 'unknown_tool' ? 'unregistered_tool' : 'inspect',
    expected: family === 'valid_integer' ? 'success' :
      family === 'unknown_tool' ? 'unknown' :
      family === 'handler_exception' ? 'exception' : 'validation_error',
    count: positive,
  });
}

export function probeSource(probe, engineImport = '/workspace/harness/core/engine.mjs') {
  if (!probe || !PROBE_FAMILIES.includes(probe.family) ||
      !/^[a-z][a-z0-9_]{2,60}$/.test(probe.id) ||
      !['/workspace/harness/core/engine.mjs', '/evaluator/reference-engine.mjs'].includes(engineImport)) {
    throw new Error('Untrusted probe inputs');
  }
  const spec = JSON.stringify(probe);
  // Fixed test body; only JSON data is interpolated. No model-authored test code.
  return [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { runAgent } from '" + engineImport + "';",
    '',
    "test('" + probe.id + "', async () => {",
    '  const probe = ' + spec + ';',
    '  const handlerCalls = [];',
    '  let responses = 0;',
    '  const complete = async messages => {',
    '    if (responses++ === 0) return { model: "trusted-fixture", message: {',
    '      role: "assistant", content: null, tool_calls: [{',
    '        id: "call_probe_1", type: "function",',
    '        function: { name: probe.toolName, arguments: probe.rawArguments },',
    '      }],',
    '    }};',
    '    const last = messages.at(-1);',
    '    assert.equal(last.role, "tool");',
    '    assert.equal(last.tool_call_id, "call_probe_1");',
    '    const result = JSON.parse(last.content);',
    '    if (probe.expected === "success") {',
    '      assert.deepEqual(result, { ok: true, observedCount: probe.count });',
    '      assert.equal(handlerCalls.length, 1);',
    '    } else {',
    '      assert.equal(result.ok, false);',
    '      assert.equal(typeof result.error, "string");',
    '      assert.ok(result.error.length >= 5 && result.error.length <= 300);',
    '      assert.equal(handlerCalls.length, probe.expected === "exception" ? 1 : 0);',
    '    }',
    '    return { model: "trusted-fixture", message: { role: "assistant", content: "finished safely" } };',
    '  };',
    '  const tools = [{',
    '    type: "function",',
    '    function: { name: "inspect", description: "Read the validated integer only",',
    '      parameters: { type: "object",',
    '        properties: {',
    '          count: { type: "integer" },',
    '          mode: { type: "string", enum: ["safe", "fast"] },',
    '        },',
    '        required: ["count"], additionalProperties: false,',
    '      },',
    '    },',
    '    execute: async args => {',
    '      handlerCalls.push(args);',
    '      if (probe.expected === "exception") throw new Error("synthetic handler exception");',
    '      return { ok: true, observedCount: args.count };',
    '    },',
    '  }];',
    '  const answer = await runAgent({',
    '    instruction: "Offline invariant test", task: "Safely handle a tool call",',
    '    tools, complete, maxTurns: 3, maxCalls: 2,',
    '  });',
    '  assert.equal(answer.final, "finished safely");',
    '  assert.equal(answer.calls, 1);',
    '});',
    '',
  ].join('\n');
}

export function failureGoal(failingProbes) {
  if (!Array.isArray(failingProbes) || !failingProbes.length ||
      failingProbes.some(x => !PROBE_FAMILIES.includes(x.family))) {
    throw new Error('No trusted failing probes');
  }
  const families = [...new Set(failingProbes.map(x => x.family))].sort();
  return [
    'Improve the provider-neutral Harness tool-call boundary in harness/core/engine.mjs.',
    'Independent hidden property checks found failures in these categories:',
    families.join(', ') + '.',
    'The model may output malformed JSON or arguments not conforming to the advertised JSON schema.',
    'Convert invalid tool calls to bounded, valid JSON error messages without executing a handler,',
    'and continue the tool-call conversation normally. Preserve all valid calls and handler error handling.',
    'Use a minimal standard unified diff for only the approved existing source file.',
    'Never change evaluators, tests, policies, model routing, CI, or security controls.',
    'Do not claim success unless independent verification confirms it.',
  ].join('\n');
}
