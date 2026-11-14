import test from 'node:test';
import assert from 'node:assert/strict';
import { safePath, createProject, validateProject, addFile, applyProposal, proposals, contextMessages } from '../src/core/sandbox.mjs';
import { createEventDecoder } from '../src/core/stream.mjs';
import { previewDocument } from '../src/core/preview.mjs';
import { normalizeModels, validateChat } from '../server/models.mjs';

test('sandbox rejects parent, absolute, hidden, and Windows paths', () => {
  for (const path of ['../key', '/tmp/a', 'C:\\a', '.env', 'src/../a', 'src//a', 'src\\a', 'src/a.']) assert.throws(() => safePath(path));
  assert.equal(safePath('src/components/App.tsx'), 'src/components/App.tsx');
});
test('project reload preserves identity, messages, and checkpoints', () => {
  const p = createProject('Orbit');
  p.messages.push({ id: 'answer', role: 'assistant', content: 'Hello' });
  p.history.push({ id: 'before', at: Date.now(), label: 'Checkpoint', files: p.files });
  const loaded = validateProject(JSON.parse(JSON.stringify(p)));
  assert.equal(loaded.id, p.id); assert.deepEqual(loaded.messages, p.messages); assert.deepEqual(loaded.history, p.history);
  assert.notEqual(createProject('Orbit').id, p.id);
});
test('case-insensitive duplicates cannot cross the sandbox boundary', () => {
  assert.throws(() => addFile(createProject('Test'), 'INDEX.html'));
  assert.throws(() => validateProject({ name: 'x', files: [{ path: 'a', content: '' }, { path: 'A', content: '' }] }));
});
test('AI changes are proposals only, with conflict detection and recoverable state', () => {
  const p = createProject('Test');
  const changes = proposals('```file:../secret\nhack\n```\n```file:secrets\nno\n```\n```file:app.js\nconsole.log(1);\n```');
  assert.equal(changes.length, 1);
  const old = p.files.find(f => f.path === 'app.js').content;
  assert.throws(() => applyProposal(p, changes[0], 'stale'));
  const applied = applyProposal(p, changes[0], old);
  assert.equal(applied.files.find(f => f.path === 'app.js').content, 'console.log(1);');
  assert.equal(p.files.find(f => f.path === 'app.js').content, old);
  assert.deepEqual(applied.history[0].files, p.files);
});
test('context is scoped and excludes credential files', () => {
  let p = addFile(createProject('One'), 'secret.key', 'DO NOT SEND');
  p = addFile(p, 'notes.md', 'This project only');
  const content = contextMessages(p, 'explain', 'file', 'notes.md').at(-1).content;
  assert.match(content, /This project only/); assert.doesNotMatch(content, /DO NOT SEND|<!doctype/);
});
test('SSE handles split unicode, CRLF, usage, and final marker', () => {
  const events = [], parser = createEventDecoder(data => events.push(data));
  const bytes = new TextEncoder().encode('data: {"text":"Привіт 🌍"}\r\n\r\ndata: [DONE]\r\n\r\n');
  for (const byte of bytes) parser.push(new Uint8Array([byte]));
  parser.finish(); assert.deepEqual(events, ['{"text":"Привіт 🌍"}', '[DONE]']);
});
test('preview bundles local assets and denies network and native access', () => {
  const document = previewDocument(createProject('Test').files);
  assert.match(document, /connect-src 'none'/); assert.match(document, /form-action 'none'/);
  assert.match(document, /Hello, world/); assert.doesNotMatch(document, /src="app.js"/);
  assert.throws(() => previewDocument([{ path: 'main.py', content: 'print(1)' }]));
});
test('provider limits are not invented or silently clamped', () => {
  const list = normalizeModels({ data: [{ id: 'gemini-4-carbon', context_length: 1048576, top_provider: { max_completion_tokens: 65536 } }] });
  assert.equal(list[0].verified, true); assert.equal(list[1].verified, false); assert.equal(list[2].maxOutputTokens, null);
  const payload = validateChat({ model: 'gemini-4-carbon', effort: 'high', messages: [{ role: 'user', content: 'x'.repeat(300000) }], max_tokens: 8 }, list);
  assert.equal(payload.max_tokens, 65536); assert.equal(payload.messages[0].content.length, 300000);
  assert.throws(() => validateChat({ model: 'arbitrary' }, list));
  assert.throws(() => validateChat({ model: 'claude-fable-5-2', effort: 'high' }, list), /limits/);
});
