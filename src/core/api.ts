import { Capacitor } from '@capacitor/core';
import { createEventDecoder } from './stream.mjs';
import type { Connection, Status } from '../types';

export const native = Capacitor.isNativePlatform();
// Remote bearer tokens are memory-only: never localStorage, project archives, or app bundles.
export function endpoint(connection: Connection, route: string) {
  const raw = connection.url.trim().replace(/\/+$/, '');
  if (!raw) { if (native) throw new Error('Connect your HTTPS gateway in Settings first.'); return route; }
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Use an HTTPS gateway URL without credentials.');
  return raw + route;
}
function headers(connection: Connection) {
  return { 'Content-Type': 'application/json', ...(connection.token ? { Authorization: `Bearer ${connection.token}` } : {}) };
}
export async function getStatus(connection: Connection): Promise<Status> {
  if (!native && !connection.url) {
    const session = await fetch('/api/session', { method: 'POST', credentials: 'include' });
    if (!session.ok) throw new Error('Local gateway session could not be established.');
  }
  const response = await fetch(endpoint(connection, '/api/status'), { credentials: 'include', headers: headers(connection), signal: AbortSignal.timeout(20000) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Gateway connection failed.');
  return body;
}
export async function streamChat(connection: Connection, payload: unknown, signal: AbortSignal, onChange: (text: string, usage?: any, truncated?: boolean) => void) {
  const response = await fetch(endpoint(connection, '/api/chat'), { method: 'POST', credentials: 'include', headers: headers(connection), body: JSON.stringify(payload), signal });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || `Gateway returned ${response.status}.`); }
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
    // Reasoning frames are deliberately not presented as model answers.
    onChange(text, usage, truncated);
  });
  const reader = response.body.getReader();
  try { while (true) { const chunk = await reader.read(); if (chunk.done) break; decoder.push(chunk.value); } decoder.finish(); }
  finally { reader.releaseLock(); }
  if (streamError) throw new Error(streamError);
  if (!done) throw new Error('Connection interrupted. Partial response kept; retry only if you want another request.');
  if (!text.trim()) throw new Error('The model returned no answer. No automatic paid retry was made.');
}
