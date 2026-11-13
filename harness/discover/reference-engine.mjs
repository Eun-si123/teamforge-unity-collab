/**
 * Minimal independent specification oracle. Only used to establish that
 * deterministic generated tests are satisfiable; NEVER used for production
 * inference, staging, or candidate scoring.
 */
function validate(args, schema) {
  if (!args || Array.isArray(args) || typeof args !== 'object') {
    return 'Tool arguments must be an object';
  }
  for (const key of schema.required || []) {
    if (!Object.hasOwn(args, key)) return 'Missing required argument';
  }
  for (const [name, value] of Object.entries(args)) {
    if (!Object.hasOwn(schema.properties || {}, name)) {
      if (schema.additionalProperties === false) return 'Unrecognized argument';
      continue;
    }
    const field = schema.properties[name];
    if (field.type === 'integer' && !Number.isSafeInteger(value)) return 'Invalid integer argument type';
    if (field.type === 'string' && typeof value !== 'string') return 'Invalid string argument type';
    if (field.type === 'boolean' && typeof value !== 'boolean') return 'Invalid boolean argument type';
    if (field.enum && !field.enum.includes(value)) return 'Invalid argument enum';
  }
  return null;
}
export async function runAgent({ instruction, task, tools, complete, maxTurns = 3 }) {
  if (!instruction || !task || !Array.isArray(tools)) throw new Error('Bad fixture');
  const schemas = tools.map(x => ({ type: x.type, function: x.function }));
  const messages = [{ role: 'system', content: instruction }, { role: 'user', content: task }];
  let used = 0;
  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await complete(messages, schemas);
    const calls = response.message.tool_calls || [];
    if (!calls.length) return { final: response.message.content.trim(), calls: used };
    messages.push({ role: 'assistant', content: null, tool_calls: calls });
    for (const call of calls) {
      const name = call.function.name;
      const tool = tools.find(x => x.function.name === name);
      let result;
      if (!tool) result = { ok: false, error: 'tool not exposed' };
      else {
        try {
          const args = JSON.parse(call.function.arguments);
          const reason = validate(args, tool.function.parameters);
          if (reason) result = { ok: false, error: reason };
          else {
            try { result = await tool.execute(args); }
            catch (error) { result = { ok: false, error: String(error.message).slice(0, 200) }; }
          }
        } catch {
          result = { ok: false, error: 'Invalid JSON tool arguments' };
        }
      }
      messages.push({ role: 'tool', tool_call_id: call.id, name, content: JSON.stringify(result) });
      used++;
    }
  }
  throw new Error('Fixture turn budget reached');
}
