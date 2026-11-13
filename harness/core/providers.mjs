/**
 * Model/provider-neutral transport registry. Model IDs/endpoints/keys come from a
 * caller-owned config; no particular LLM vendor or code host is mandatory.
 * The API protocol adapters are deliberately narrow and independently testable.
 */
const ALLOWED_PROTOCOLS = new Set(['openai-compatible', 'anthropic-messages']);
const TRANSIENT = new Set([408, 429, 500, 502, 503, 504]);
const TEMPORARY_FAILURE = /\b(?:timeout|ETIMEDOUT|ECONNRESET|fetch failed)\b/i;

export function validateModelConfig(config, env = process.env) {
  if (!config || !Array.isArray(config.models) || config.models.length < 1 || config.models.length > 12) {
    throw new Error('Configure 1-12 explicit model routes');
  }
  const unique = new Set();
  return config.models.map((m, index) => {
    if (!m || !ALLOWED_PROTOCOLS.has(m.protocol) || typeof m.id !== 'string' ||
        !/^[A-Za-z0-9._:/@+-]{1,200}$/.test(m.id)) {
      throw new Error('Invalid model route at ' + index);
    }
    // The same model may be served by several independent, explicitly
    // approved accounts/connections; a failure on one must not quarantine all.
    const key = JSON.stringify([m.protocol, m.id, m.baseUrl, m.apiKeyEnv]);
    if (unique.has(key)) throw new Error('Duplicate model route at ' + index);
    if (m.approved !== true) throw new Error('Model route requires explicit operator approval: ' + m.id);
    if (typeof m.apiKeyEnv !== 'string' || !/^[A-Z][A-Z0-9_]{2,90}$/.test(m.apiKeyEnv)) {
      throw new Error('Model requires a credential environment-variable name');
    }
    if (!env[m.apiKeyEnv]) throw new Error('Missing model credential environment variable ' + m.apiKeyEnv);
    const endpoint = new URL(m.baseUrl);
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
        !(endpoint.protocol === 'https:' ||
          (endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)))) {
      throw new Error('Model endpoint must be HTTPS or local loopback with no embedded credentials');
    }
    const url = endpoint.href.replace(/\/$/, '');
    unique.add(key);
    return {
      id: m.id, routeKey: String(index), protocol: m.protocol, endpoint: url, credential: env[m.apiKeyEnv],
      maxOutputTokens: Math.min(8192, Math.max(100, Number(m.maxOutputTokens) || 2800)),
      timeoutMs: Math.min(120_000, Math.max(3_000, Number(m.timeoutMs) || 60_000)),
    };
  });
}

export function toAnthropic(messages, tools) {
  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
  const conversation = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'user') {
      conversation.push({ role: 'user', content: [{ type: 'text', text: m.content }] });
    } else if (m.role === 'assistant') {
      const blocks = [];
      if (typeof m.content === 'string' && m.content) blocks.push({ type: 'text', text: m.content });
      for (const call of m.tool_calls || []) {
        blocks.push({ type: 'tool_use', id: call.id, name: call.function.name,
          input: JSON.parse(call.function.arguments) });
      }
      conversation.push({ role: 'assistant', content: blocks });
    } else if (m.role === 'tool') {
      const result = { type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content };
      const previous = conversation.at(-1);
      if (previous?.role === 'user' && previous.content.some(x => x.type === 'tool_result')) {
        previous.content.push(result);
      } else conversation.push({ role: 'user', content: [result] });
    } else throw new Error('Unsupported transcript role');
  }
  return {
    system,
    messages: conversation,
    tools: tools.map(t => ({
      name: t.function.name, description: t.function.description,
      input_schema: t.function.parameters,
    })),
  };
}

export function normalizeAnthropicResponse(body) {
  if (!body || !Array.isArray(body.content)) throw new Error('Invalid Anthropic response');
  const text = body.content.filter(x => x?.type === 'text').map(x => x.text || '').join('\n');
  const calls = body.content.filter(x => x?.type === 'tool_use').map(x => ({
    id: x.id, type: 'function', function: { name: x.name, arguments: JSON.stringify(x.input) },
  }));
  return { role: 'assistant', content: text || null, tool_calls: calls };
}

async function callRoute(route, messages, tools, fetchImpl) {
  const anthropic = route.protocol === 'anthropic-messages';
  const req = anthropic
    ? { model: route.id, max_tokens: route.maxOutputTokens, ...toAnthropic(messages, tools) }
    : { model: route.id, messages, tools, tool_choice: 'auto',
        max_tokens: route.maxOutputTokens, temperature: 0.1, stream: false };
  const path = anthropic ? '/v1/messages' : '/chat/completions';
  const address = anthropic
    ? route.endpoint.replace(/\/v1$/, '') + path
    : route.endpoint + path;
  const headers = anthropic
    ? { 'x-api-key': route.credential, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
    : { Authorization: 'Bearer ' + route.credential, 'Content-Type': 'application/json' };
  const response = await fetchImpl(address, {
    method: 'POST', headers, body: JSON.stringify(req),
    signal: AbortSignal.timeout(route.timeoutMs),
  });
  if (!response.ok) {
    const error = new Error('Provider HTTP ' + response.status);
    error.status = response.status;
    error.transient = TRANSIENT.has(response.status);
    throw error;
  }
  const data = await response.json();
  const message = anthropic ? normalizeAnthropicResponse(data)
    : data?.choices?.[0]?.message;
  if (message?.role !== 'assistant' ||
      !(typeof message.content === 'string' || Array.isArray(message.tool_calls))) {
    throw new Error('Provider returned an invalid assistant message');
  }
  return { model: route.id, message, usage: data.usage || null };
}

export function createModelRouter(config, {
  env = process.env, fetchImpl = fetch, now = () => Date.now(), onAttempt = () => {},
} = {}) {
  const routes = validateModelConfig(config, env);
  const cooldowns = new Map();
  return {
    models: routes.map(r => r.id),
    async complete(messages, tools) {
      const failures = [];
      for (const route of routes) {
        if ((cooldowns.get(route.routeKey) || 0) > now()) continue;
        try {
          const output = await callRoute(route, messages, tools, fetchImpl);
          cooldowns.delete(route.routeKey);
          onAttempt({ model: route.id, outcome: 'success' });
          return output;
        } catch (error) {
          const isTransient = error.transient || TEMPORARY_FAILURE.test(error.message) ||
            error.name === 'TimeoutError';
          if (isTransient) cooldowns.set(route.routeKey, now() + (error.status === 429 ? 120_000 : 30_000));
          failures.push({ model: route.id, category: isTransient ? 'transient' : 'blocked',
            status: error.status || null });
          onAttempt({ model: route.id, outcome: isTransient ? 'cooldown' : 'blocked',
            status: error.status || null });
        }
      }
      const unavailable = failures.length ? failures : [{ category: 'cooldown' }];
      const error = new Error('No eligible model routes: ' + unavailable.map(x => x.category).join(','));
      error.reason = 'all_routes_unavailable';
      throw error;
    },
  };
}
