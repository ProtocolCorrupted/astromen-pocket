import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { createEventDecoder } from './stream.mjs';
import type { Connection, Model, Status } from '../types';

export const native = Capacitor.isNativePlatform();

const SUPPORTED_MODELS = [
  { id: 'gemini-4-carbon', label: 'Gemini 4 Carbon' },
  { id: 'gemini-4-argon', label: 'Gemini 4 Argon' },
  { id: 'claude-fable-5-2', label: 'Fable 5.2' },
];

function isDirectCoarena(rawUrl: string, token: string): boolean {
  const lower = rawUrl.toLowerCase();
  return lower.includes('coarena.ai') || lower.endsWith('/v1') || token.trim().startsWith('coa_');
}

export function normalizeBaseUrl(connection: Connection): string {
  let raw = connection.url.trim().replace(/\/+$/, '');
  if (!raw) {
    if (native || connection.token.trim().startsWith('coa_')) {
      raw = 'https://coarena.ai/api/v1';
    } else {
      return '';
    }
  }
  if (!/^https?:\/\//i.test(raw)) {
    raw = `https://${raw}`;
  }
  const url = new URL(raw);
  const isLocal = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !isLocal) {
    throw new Error('Use an HTTPS gateway URL.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Use a clean gateway URL without credentials or query parameters.');
  }
  let clean = url.href.replace(/\/+$/, '');
  if (url.hostname.endsWith('coarena.ai') && (url.pathname === '' || url.pathname === '/')) {
    clean = `${url.origin}/api/v1`;
  } else if (url.hostname.endsWith('coarena.ai') && url.pathname === '/api') {
    clean = `${url.origin}/api/v1`;
  }
  return clean;
}

export function endpoint(connection: Connection, route: string) {
  const base = normalizeBaseUrl(connection);
  if (!base) return route;
  return base + route;
}

function headers(connection: Connection): Record<string, string> {
  const token = connection.token.trim();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function httpRequest(url: string, method: 'GET' | 'POST', reqHeaders: Record<string, string>, body?: unknown, useCredentials = false) {
  if (native) {
    const res = await CapacitorHttp.request({
      url,
      method,
      headers: reqHeaders,
      data: body !== undefined ? body : undefined,
      connectTimeout: 30000,
      readTimeout: 120000,
      responseType: 'json',
    });
    let data = res.data;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch { /* keep text */ }
    }
    return { ok: res.status >= 200 && res.status < 300, status: res.status, data };
  }
  const response = await fetch(url, {
    method,
    ...(useCredentials ? { credentials: 'include' as RequestCredentials } : {}),
    headers: reqHeaders,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* keep text */ }
  return { ok: response.ok, status: response.status, data };
}

function buildDirectModels(catalogData: any): Model[] {
  const entries = Array.isArray(catalogData?.data)
    ? catalogData.data
    : Array.isArray(catalogData?.models)
      ? catalogData.models
      : [];
  return SUPPORTED_MODELS.map(m => {
    const item = entries.find((e: any) => e.id === m.id);
    const contextWindow = Number(item?.context_length || item?.context_window || item?.max_input_tokens || item?.limits?.context_window || 128000);
    const maxOutputTokens = Number(item?.top_provider?.max_completion_tokens || item?.max_output_tokens || item?.max_completion_tokens || item?.limits?.max_output_tokens || 16384);
    return {
      id: m.id,
      label: m.label,
      contextWindow,
      maxOutputTokens,
      available: true,
      verified: true,
      source: item ? 'Coarena model catalog' : 'Coarena direct configuration',
    };
  });
}

export async function getStatus(connection: Connection): Promise<Status> {
  const base = normalizeBaseUrl(connection);
  const token = connection.token.trim();

  // Direct Coarena API mode (default on iOS or when using coarena.ai / coa_ key)
  if (base && isDirectCoarena(base, token)) {
    if (!token) {
      return {
        configured: false,
        models: SUPPORTED_MODELS.map(m => ({ ...m, contextWindow: null, maxOutputTokens: null, available: false, verified: false, source: 'Enter your Coarena API key' })),
        message: 'Enter your Coarena API key in Settings to connect.',
      };
    }
    const modelsUrl = base.endsWith('/v1') ? `${base}/models` : `${base}/api/v1/models`;
    const res = await httpRequest(modelsUrl, 'GET', headers(connection));
    if (!res.ok) {
      throw new Error(res.data?.error?.message || res.data?.error || `Coarena returned HTTP ${res.status}. Check your API key.`);
    }
    return {
      configured: true,
      models: buildDirectModels(res.data),
      message: 'Connected to Coarena. Model limits verified.',
    };
  }

  // Local browser gateway session
  if (!native && !base) {
    const session = await fetch('/api/session', { method: 'POST', credentials: 'include' });
    if (!session.ok) throw new Error('Local gateway session could not be established.');
  }

  const res = await httpRequest(endpoint(connection, '/api/status'), 'GET', headers(connection), undefined, !native && !base);
  if (!res.ok) {
    throw new Error(res.data?.error || `Gateway connection failed (HTTP ${res.status}).`);
  }
  return res.data;
}

export async function streamChat(
  connection: Connection,
  payload: { model: string; effort: string; messages: Array<{ role: string; content: string }> },
  signal: AbortSignal,
  onChange: (text: string, usage?: any, truncated?: boolean) => void
) {
  const base = normalizeBaseUrl(connection);
  const token = connection.token.trim();
  const direct = Boolean(base && isDirectCoarena(base, token));

  if (direct || native) {
    const chatUrl = direct
      ? (base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/api/v1/chat/completions`)
      : endpoint(connection, '/api/chat');
    const reqBody = direct
      ? {
          model: payload.model,
          messages: payload.messages,
          reasoning_effort: payload.effort,
          max_tokens: 16384,
          stream: false,
        }
      : payload;

    if (signal.aborted) throw new Error('Generation stopped.');
    const res = await httpRequest(chatUrl, 'POST', headers(connection), reqBody, false);
    if (signal.aborted) throw new Error('Generation stopped.');

    if (!res.ok) {
      const msg = res.data?.error?.message || res.data?.error || `Provider returned HTTP ${res.status}.`;
      throw new Error(msg);
    }

    if (typeof res.data === 'string') {
      let text = '', streamError = '', usage: any, truncated = false;
      const decoder = createEventDecoder((data: string) => {
        if (data === '[DONE]') return;
        const event = JSON.parse(data);
        if (event.error) { streamError = event.error.message || 'Provider interrupted the response.'; return; }
        const choice = event.choices?.[0];
        if (typeof choice?.delta?.content === 'string') text += choice.delta.content;
        else if (typeof choice?.message?.content === 'string') text += choice.message.content;
        if (choice?.finish_reason === 'length') truncated = true;
        if (event.usage) usage = event.usage;
        onChange(text, usage, truncated);
      });
      decoder.push(new TextEncoder().encode(res.data));
      decoder.finish();
      if (streamError) throw new Error(streamError);
      if (!text.trim()) throw new Error('The model returned no answer.');
      return;
    }

    const choice = res.data?.choices?.[0];
    const text = choice?.message?.content || choice?.delta?.content || '';
    const truncated = choice?.finish_reason === 'length';
    const usage = res.data?.usage;
    if (!text.trim()) throw new Error('The model returned no answer. No automatic paid retry was made.');
    onChange(text, usage, truncated);
    return;
  }

  // Browser streaming against local/remote gateway
  const response = await fetch(endpoint(connection, '/api/chat'), {
    method: 'POST',
    credentials: !base ? 'include' : 'omit',
    headers: headers(connection),
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Gateway returned ${response.status}.`);
  }
  if (!response.body) throw new Error('Streaming is unavailable on this connection.');
  let text = '', done = false, streamError = '', usage: any, truncated = false;
  const decoder = createEventDecoder((data: string) => {
    if (data === '[DONE]') { done = true; return; }
    const event = JSON.parse(data);
    if (event.error) { streamError = event.error.message || 'Provider interrupted the response.'; return; }
    const choice = event.choices?.[0];
    if (typeof choice?.delta?.content === 'string') text += choice.delta.content;
    if (choice?.finish_reason === 'length') truncated = true;
    if (event.usage) usage = event.usage;
    onChange(text, usage, truncated);
  });
  const reader = response.body.getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      decoder.push(chunk.value);
    }
    decoder.finish();
  } finally {
    reader.releaseLock();
  }
  if (streamError) throw new Error(streamError);
  if (!done) throw new Error('Connection interrupted. Partial response kept; retry only if you want another request.');
  if (!text.trim()) throw new Error('The model returned no answer. No automatic paid retry was made.');
}
