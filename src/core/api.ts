import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { createEventDecoder } from './stream.mjs';
import type { Connection, Model, Status } from '../types';

export const native = Capacitor.isNativePlatform();

declare global {
  interface Window {
    __pocketStreamEvent?: (event: {
      id: string;
      type: 'response' | 'chunk' | 'end' | 'error' | 'cancelled';
      status?: number;
      contentType?: string;
      data?: string;
      message?: string;
    }) => void;
    webkit?: {
      messageHandlers?: {
        pocketStreamStart?: { postMessage: (msg: unknown) => void };
        pocketStreamAbort?: { postMessage: (msg: unknown) => void };
      };
    };
  }
}

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

const activeStreams = new Map<string, (event: any) => void>();
if (typeof window !== 'undefined') {
  window.__pocketStreamEvent = event => {
    const handler = activeStreams.get(event.id);
    if (handler) handler(event);
  };
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function streamViaNativeBridge(
  url: string,
  reqHeaders: Record<string, string>,
  reqBody: unknown,
  signal: AbortSignal,
  onChange: (text: string, usage?: any, truncated?: boolean) => void
) {
  const startHandler = window.webkit?.messageHandlers?.pocketStreamStart;
  const abortHandler = window.webkit?.messageHandlers?.pocketStreamAbort;
  if (!startHandler) {
    throw new Error('Native streaming bridge is unavailable.');
  }

  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let text = '', done = false, streamError = '', usage: any, truncated = false;
  let status = 200;
  let contentType = '';
  const rawChunks: Uint8Array[] = [];

  const decoder = createEventDecoder((data: string) => {
    if (data === '[DONE]') { done = true; return; }
    try {
      const event = JSON.parse(data);
      if (event.error) { streamError = event.error.message || event.error || 'Provider interrupted the response.'; return; }
      const choice = event.choices?.[0];
      if (typeof choice?.delta?.content === 'string') text += choice.delta.content;
      else if (typeof choice?.message?.content === 'string') text += choice.message.content;
      if (choice?.finish_reason === 'length') truncated = true;
      if (event.usage) usage = event.usage;
      onChange(text, usage, truncated);
    } catch {
      // Ignore non-JSON keepalive comments
    }
  });

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      activeStreams.delete(id);
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      abortHandler?.postMessage({ id });
      cleanup();
      reject(new Error('Generation stopped.'));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });

    activeStreams.set(id, event => {
      if (event.type === 'response') {
        status = event.status || 200;
        contentType = (event.contentType || '').toLowerCase();
      } else if (event.type === 'chunk' && event.data) {
        const bytes = base64ToBytes(event.data);
        if (status >= 400 || contentType.includes('application/json')) {
          rawChunks.push(bytes);
        } else {
          decoder.push(bytes);
        }
      } else if (event.type === 'end') {
        cleanup();
        if (status >= 400 || contentType.includes('application/json')) {
          const totalLen = rawChunks.reduce((acc, c) => acc + c.length, 0);
          const merged = new Uint8Array(totalLen);
          let offset = 0;
          for (const c of rawChunks) { merged.set(c, offset); offset += c.length; }
          const bodyText = new TextDecoder().decode(merged);
          let parsed: any = null;
          try { parsed = JSON.parse(bodyText); } catch { /* not json */ }
          if (status >= 400) {
            reject(new Error(parsed?.error?.message || parsed?.error || `Provider returned HTTP ${status}.`));
            return;
          }
          if (parsed?.choices) {
            const choice = parsed.choices[0];
            text = choice?.message?.content || choice?.delta?.content || '';
            truncated = choice?.finish_reason === 'length';
            usage = parsed.usage;
            done = true;
            onChange(text, usage, truncated);
          } else {
            decoder.push(merged);
            decoder.finish();
            done = true;
          }
        } else {
          decoder.finish();
        }
        resolve();
      } else if (event.type === 'cancelled') {
        cleanup();
        reject(new Error('Generation stopped.'));
      } else if (event.type === 'error') {
        cleanup();
        reject(new Error(event.message || 'Stream connection failed.'));
      }
    });

    startHandler.postMessage({
      id,
      url,
      method: 'POST',
      headers: reqHeaders,
      body: JSON.stringify(reqBody),
    });
  });

  if (streamError) throw new Error(streamError);
  if (!done && !text.trim()) throw new Error('Connection interrupted before any response was received.');
  if (!text.trim()) throw new Error('The model returned no answer. No automatic paid retry was made.');
}

export async function streamChat(
  connection: Connection,
  payload: { model: string; effort: string; messages: Array<{ role: string; content: string }>; maxOutputTokens?: number | null },
  signal: AbortSignal,
  onChange: (text: string, usage?: any, truncated?: boolean) => void
) {
  const base = normalizeBaseUrl(connection);
  const token = connection.token.trim();
  const direct = Boolean(base && isDirectCoarena(base, token));

  const chatUrl = direct
    ? (base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/api/v1/chat/completions`)
    : endpoint(connection, '/api/chat');

  const reqBody = direct
    ? {
        model: payload.model,
        messages: payload.messages,
        reasoning_effort: payload.effort,
        max_tokens: payload.maxOutputTokens || 16384,
        stream: true,
        stream_options: { include_usage: true },
      }
    : payload;

  if (native && window.webkit?.messageHandlers?.pocketStreamStart) {
    await streamViaNativeBridge(chatUrl, headers(connection), reqBody, signal, onChange);
    return;
  }

  const response = await fetch(chatUrl, {
    method: 'POST',
    credentials: !base && !direct ? 'include' : 'omit',
    headers: headers(connection),
    body: JSON.stringify(reqBody),
    signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error?.message || body?.error || `Gateway returned ${response.status}.`);
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
