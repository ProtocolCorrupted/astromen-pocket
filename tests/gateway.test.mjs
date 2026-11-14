import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createGateway } from '../server/index.mjs';
import { loadConfig } from '../server/config.mjs';
const token = 'test-device-access-token-32-characters';
const config = { apiKey: 'fake-server-only-key', baseUrl: 'https://provider.test/api/v1', values: {} };
async function start(t, fetcher, options = {}) {
  const server = createGateway({ config, token, fetcher, ...options });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r); }));
  return `http://127.0.0.1:${server.address().port}`;
}
const catalog = () => Response.json({ data: [{ id: 'gemini-4-carbon', context_length: 128000, max_output_tokens: 32768 }] });
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: 'capacitor://localhost' };
const prompt = { model: 'gemini-4-carbon', effort: 'high', messages: [{ role: 'user', content: 'Test' }] };

test('all API routes require authentication and reject unknown origins', async t => {
  const url = await start(t, async () => catalog());
  assert.equal((await fetch(url + '/api/status')).status, 401);
  assert.equal((await fetch(url + '/api/status', { headers: { ...headers, Origin: 'https://evil.test' } })).status, 403);
  assert.equal((await fetch(url + '/api/status', { headers: { Authorization: 'Bearer ' + 'é'.repeat(token.length) } })).status, 401);
  const result = await fetch(url + '/api/status', { headers });
  assert.equal(result.status, 200); const text = await result.text();
  assert.match(text, /128000/); assert.doesNotMatch(text, /fake-server-only-key|test-device-access/);
});
test('local browser session requires same local host and cannot be minted through a remote proxy', async t => {
  const url = await start(t, async () => catalog());
  assert.equal((await fetch(url + '/api/session', { method: 'POST' })).status, 403);
  assert.equal((await fetch(url + '/api/session', { method: 'POST', headers: { Origin: 'http://localhost:1234' } })).status, 403);
  const session = await fetch(url + '/api/session', { method: 'POST', headers: { Origin: url } });
  assert.equal(session.status, 200); const cookie = session.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly; SameSite=Strict/);
  assert.equal((await fetch(url + '/api/status', { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(url + '/api/chat', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(prompt) })).status, 401);
  const status = await new Promise(resolve => {
    const req = http.request(url + '/api/session', { method: 'POST', headers: { Host: 'gateway.example', Origin: 'http://localhost' } }, res => { res.resume(); resolve(res.statusCode); }); req.end();
  });
  assert.equal(status, 403);
});
test('SSE forwards output at exact provider max, not client max; no extra requests', async t => {
  let generationCalls = 0, sent;
  const url = await start(t, async (url, init) => {
    if (url.endsWith('/models')) return catalog();
    generationCalls++; sent = JSON.parse(init.body);
    assert.equal(init.headers.Authorization, 'Bearer fake-server-only-key');
    return new Response('data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const response = await fetch(url + '/api/chat', { method: 'POST', headers, body: JSON.stringify({ ...prompt, max_tokens: 5 }) });
  assert.equal(response.status, 200); assert.match(await response.text(), /hello/);
  assert.equal(sent.max_tokens, 32768); assert.equal(generationCalls, 1);
});
test('missing limits, invalid roles, invalid JSON, and unknown models fail closed', async t => {
  const url = await start(t, async () => catalog());
  for (const [body, code] of [[{ ...prompt, model: 'claude-fable-5-2' }, 503], [{ ...prompt, model: 'bad' }, 400], [{ ...prompt, messages: [{ role: 'tool', content: 'bad' }] }, 400]]) {
    assert.equal((await fetch(url + '/api/chat', { method: 'POST', headers, body: JSON.stringify(body) })).status, code);
  }
  assert.equal((await fetch(url + '/api/chat', { method: 'POST', headers, body: '{' })).status, 400);
});
test('provider failures are sanitized, never retried, and JSON responses become SSE', async t => {
  let calls = 0;
  const url = await start(t, async url => {
    if (url.endsWith('/models')) return catalog();
    calls++;
    return calls === 1 ? new Response('sensitive provider error fake-server-only-key', { status: 429 }) : Response.json({ choices: [{ message: { content: 'fallback' }, finish_reason: 'stop' }] });
  });
  const first = await fetch(url + '/api/chat', { method: 'POST', headers, body: JSON.stringify(prompt) });
  assert.equal(first.status, 429); assert.doesNotMatch(await first.text(), /fake-server-only-key/); assert.equal(calls, 1);
  const second = await fetch(url + '/api/chat', { method: 'POST', headers, body: JSON.stringify(prompt) });
  assert.match(await second.text(), /fallback[\s\S]*\[DONE\]/); assert.equal(calls, 2);
});
test('static files stay inside dist', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dist = path.join(dir, 'dist'); fs.mkdirSync(dist); fs.writeFileSync(path.join(dist, 'index.html'), 'pocket'); fs.writeFileSync(path.join(dir, 'secret'), 'private');
  const url = await start(t, async () => catalog(), { dist });
  assert.equal(await (await fetch(url)).text(), 'pocket');
  const response = await fetch(url + '/..%5csecret'); assert.notEqual(response.status, 200); assert.doesNotMatch(await response.text(), /private/);
});
test('environment precedence supports Astromen env formats without leaking secrets', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-env-'));
  try {
    fs.writeFileSync(path.join(dir, '.env'), 'COARENA_API_KEY=coa_fake\nCOARENA_BASE_URL=https://provider.test/api/v1');
    fs.writeFileSync(path.join(dir, 'example.env'), 'coa_fallback\nbase url: https://other.test/api/v1');
    assert.equal(loadConfig(dir, {}).apiKey, 'coa_fake');
    assert.equal(loadConfig(dir, { COARENA_API_KEY: 'from-process' }).apiKey, 'from-process');
    assert.throws(() => loadConfig(dir, { COARENA_BASE_URL: 'http://evil.test' }), /HTTPS/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
