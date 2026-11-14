import { loadConfig } from '../server/config.mjs';
import { normalizeModels } from '../server/models.mjs';
const config = loadConfig();
console.log('Coarena credential present:', Boolean(config.apiKey));
try {
  const response = await fetch(`${config.baseUrl}/models`, { headers: { Authorization: `Bearer ${config.apiKey}` }, signal: AbortSignal.timeout(20000) });
  console.log('Catalog HTTP status:', response.status);
  const data = response.ok ? await response.json() : {};
  console.log(JSON.stringify(normalizeModels(data, config.values), null, 2));
  console.log('Fable-like catalog entries:', JSON.stringify((data.data || []).filter(m => /fable|5[.-]2/i.test(m.id || '')).map(m => ({ id: m.id, context_length: m.context_length, max_output_tokens: m.max_output_tokens, top_provider: m.top_provider })), null, 2));
} catch { console.log('Catalog unavailable: connection failed or timed out. No generation request made.'); }
