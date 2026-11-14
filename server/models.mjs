export const MODELS = [
  { id: 'gemini-4-carbon', label: 'Gemini 4 Carbon', key: 'CARBON' },
  { id: 'gemini-4-argon', label: 'Gemini 4 Argon', key: 'ARGON' },
  { id: 'claude-fable-5-2', label: 'Fable 5.2', key: 'FABLE' },
];
const positive = (...values) => values.map(Number).find(n => Number.isSafeInteger(n) && n > 0) || null;
export function normalizeModels(data, values = {}) {
  const entries = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
  return MODELS.map(model => {
    const item = entries.find(entry => entry.id === model.id);
    const contextWindow = positive(item?.context_length, item?.context_window, item?.max_input_tokens, item?.limits?.context_window, values[`COARENA_${model.key}_CONTEXT_WINDOW`]);
    const maxOutputTokens = positive(item?.top_provider?.max_completion_tokens, item?.max_output_tokens, item?.max_completion_tokens, item?.limits?.max_output_tokens, values[`COARENA_${model.key}_MAX_OUTPUT_TOKENS`]);
    const overridden = Boolean(values[`COARENA_${model.key}_CONTEXT_WINDOW`] || values[`COARENA_${model.key}_MAX_OUTPUT_TOKENS`]);
    return { id: model.id, label: model.label, contextWindow, maxOutputTokens, available: Boolean(item), verified: Boolean(contextWindow && maxOutputTokens && (item || overridden)), source: overridden ? 'server configuration' : item ? 'Coarena model catalog' : 'not reported' };
  });
}
export function validateChat(body, models) {
  const model = models.find(m => m.id === body?.model);
  if (!model) throw Object.assign(new Error('Choose one of the three supported models.'), { status: 400 });
  if (!model.verified) throw Object.assign(new Error('Coarena has not reported this model’s limits. Configure verified limits on the gateway before sending.'), { status: 503 });
  if (!['low', 'medium', 'high'].includes(body.effort)) throw Object.assign(new Error('Invalid reasoning effort.'), { status: 400 });
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 1000) throw Object.assign(new Error('Invalid conversation.'), { status: 400 });
  const messages = body.messages.map(m => {
    if (!m || !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string') throw Object.assign(new Error('Invalid message.'), { status: 400 });
    return { role: m.role, content: m.content };
  });
  if (messages.at(-1)?.role !== 'user' || !messages.at(-1)?.content.trim()) throw Object.assign(new Error('A user prompt is required.'), { status: 400 });
  // Coarena owns the exact tokenizer and context validation. A byte-based estimate
  // would incorrectly reject valid full-window requests, particularly source code.
  // The HTTP layer bounds transport size, not the model's context capacity.
  return { model: model.id, messages, reasoning_effort: body.effort, max_tokens: model.maxOutputTokens, stream: true, stream_options: { include_usage: true } };
}
