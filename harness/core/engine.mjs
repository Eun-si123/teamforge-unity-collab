/**
 * Independent, bounded OpenAI-compatible tool-calling agent runtime.
 * Deliberately contains no filesystem, subprocess, GitHub or Docker primitives.
 * Callers supply only explicitly authorized tools.
 */
/** Provider-neutral agent loop. The transport is a caller-injected function. */
const MAX_CONTEXT_BYTES = 160_000;
const MAX_TOOL_RESULT_BYTES = 8_000;
export const ENGINE_LIMITS = Object.freeze({ turns: 12, calls: 28, contextBytes: MAX_CONTEXT_BYTES });

function toolResult(value) {
  let serialized;
  try {
    serialized = JSON.stringify(value === undefined ? { ok: false, error: 'undefined tool result' } : value);
  } catch {
    serialized = JSON.stringify({ ok: false, error: 'tool result is not JSON-serializable' });
  }
  if (typeof serialized !== 'string') {
    serialized = JSON.stringify({ ok: false, error: 'tool result is not JSON-serializable' });
  }
  if (Buffer.byteLength(serialized) > MAX_TOOL_RESULT_BYTES) {
    serialized = JSON.stringify({ ok: false, error: 'tool output exceeded per-call limit' });
  }
  return serialized;
}
function contextSize(messages) {
  return Buffer.byteLength(JSON.stringify(messages), 'utf8');
}
function normalizeToolCall(call) {
  if (!call || typeof call.id !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(call.id) ||
      call.type !== 'function' || typeof call.function?.name !== 'string' ||
      typeof call.function?.arguments !== 'string' || call.function.arguments.length > 50000) {
    throw new Error('Malformed model tool call');
  }
  const args = JSON.parse(call.function.arguments);
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object');
  return { id: call.id, name: call.function.name, args };
}

export async function runAgent({
  instruction, task, tools, complete, maxTurns = ENGINE_LIMITS.turns,
  maxCalls = ENGINE_LIMITS.calls, onStep = () => {},
}) {
  if (typeof instruction !== 'string' || !instruction ||
      typeof task !== 'string' || !task || typeof complete !== 'function' ||
      !Array.isArray(tools) || !tools.length ||
      !Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 24 ||
      !Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 48) {
    throw new Error('Invalid harness configuration');
  }
  const map = new Map();
  for (const tool of tools) {
    if (!tool?.function?.name || typeof tool.execute !== 'function' || map.has(tool.function.name)) {
      throw new Error('Invalid or duplicate tool registration');
    }
    map.set(tool.function.name, tool.execute);
  }
  const schemas = tools.map(({ type, function: fn }) => ({ type, function: fn }));
  const messages = [{ role: 'system', content: instruction }, { role: 'user', content: task }];
  let used = 0, model = null;
  const transcript = [];
  const seenCallIds = new Set();
  for (let turn = 1; turn <= maxTurns; turn++) {
    if (contextSize(messages) > MAX_CONTEXT_BYTES) throw new Error('Context budget reached, checkpoint and split task');
    const reply = await complete(messages, schemas);
    model = reply.model;
    const message = reply.message;
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (calls.length > 4 || calls.length + used > maxCalls) throw new Error('Tool call budget exceeded');
    if (calls.length === 0) {
      const final = typeof message.content === 'string' ? message.content.trim() : '';
      if (!final || final.length > 20_000) throw new Error('Missing or oversized final response');
      onStep({ kind: 'final', turn, model, calls: used });
      return { final, model, turns: turn, calls: used, transcript };
    }
    if (calls.length && calls.some(x => !x || !x.id)) throw new Error('Invalid call identity');
    for (const call of calls) {
      if (seenCallIds.has(call.id)) throw new Error('Duplicate tool-call id');
      seenCallIds.add(call.id);
    }
    messages.push({ role: 'assistant', content: message.content || null, tool_calls: calls });
    for (const raw of calls) {
      const call = normalizeToolCall(raw);
      const handler = map.get(call.name);
      let result;
      if (!handler) result = { ok: false, error: 'tool not exposed' };
      else {
        try {
          result = await handler(call.args);
        } catch (error) {
          result = { ok: false, error: String(error?.message || 'tool error').slice(0, 280) };
        }
      }
      messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: toolResult(result) });
      used++;
      const event = { kind: 'tool', turn, model, tool: call.name, ok: result?.ok === true, calls: used };
      transcript.push(event);
      onStep(event);
    }
  }
  throw new Error('Harness turn limit reached, no unverified completion claimed');
}
