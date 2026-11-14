import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { APP_ROOT, loadConfig, accessToken } from './config.mjs';
import { MODELS, normalizeModels, validateChat } from './models.mjs';

const loopback = ip => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip);
const localOrigin = origin => /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin || '');
const safeEqual = (a, b) => { const left = Buffer.from(typeof a === 'string' ? a : ''); const right = Buffer.from(b); return left.length === right.length && crypto.timingSafeEqual(left, right); };
const localHost = host => /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host || '');
const sameLocalOrigin = (origin, host) => localOrigin(origin) && new URL(origin).host === host;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32 * 1024 * 1024) throw Object.assign(new Error('Request exceeds the 32 MB transport limit.'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON request.'), { status: 400 }); }
}
export function createGateway({ config = loadConfig(), token = accessToken(), fetcher = fetch, dist = path.join(APP_ROOT, 'dist') } = {}) {
  const session = crypto.randomBytes(32).toString('hex');
  let cache = null; let cacheAt = 0;
  async function status(refresh = false) {
    if (!refresh && cache && Date.now() - cacheAt < 60000) return cache;
    let data = {}; let message = 'Coarena key not found in the Astromen environment files.';
    if (config.apiKey) {
      try {
        const response = await fetcher(`${config.baseUrl}/models`, { headers: { Authorization: `Bearer ${config.apiKey}` }, signal: AbortSignal.timeout(15000) });
        if (response.ok) { data = await response.json(); message = 'Connected to Coarena. Limits are read from the model catalog.'; }
        else message = `Coarena catalog returned HTTP ${response.status}. Verify your gateway configuration.`;
      } catch { message = 'Coarena model catalog is unreachable. Check the gateway network and retry.'; }
    }
    cacheAt = Date.now();
    return cache = { configured: Boolean(config.apiKey), models: normalizeModels(data, config.values), message };
  }
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const origin = req.headers.origin || '';
    const allowed = localOrigin(origin) || origin === 'capacitor://localhost' || (config.values.IDE_ALLOWED_ORIGIN && origin === config.values.IDE_ALLOWED_ORIGIN);
    if (origin && !allowed) return json(res, 403, { error: 'This origin is not allowed.' });
    if (allowed) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Access-Control-Allow-Credentials', 'true'); res.setHeader('Vary', 'Origin'); }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.writeHead(204); return res.end();
    }
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/session' && req.method === 'POST') {
        if (!loopback(req.socket.remoteAddress) || !localHost(req.headers.host) || !sameLocalOrigin(origin, req.headers.host)) return json(res, 403, { error: 'Use a device access token outside the local browser.' });
        res.setHeader('Set-Cookie', `pocket_session=${session}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=86400`);
        return json(res, 200, { connected: true });
      }
      if (url.pathname.startsWith('/api/')) {
        const bearer = req.headers.authorization?.replace(/^Bearer /, '') || '';
        const cookie = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('pocket_session='))?.slice(15) || '';
        const cookieAuth = loopback(req.socket.remoteAddress) && localHost(req.headers.host) && safeEqual(cookie, session) && (origin ? sameLocalOrigin(origin, req.headers.host) : req.method === 'GET');
        if (!safeEqual(bearer, token) && !cookieAuth) return json(res, 401, { error: 'Connect your gateway in Settings. A device access token is required.' });
        if (url.pathname === '/api/status' && req.method === 'GET') return json(res, 200, await status(url.searchParams.has('refresh')));
        if (url.pathname === '/api/chat' && req.method === 'POST') {
          if (!config.apiKey) return json(res, 503, { error: 'The gateway has no Coarena API key.' });
          const body = await readBody(req);
          const payload = validateChat(body, (await status()).models);
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 15 * 60 * 1000);
          res.on('close', () => { clearTimeout(timer); controller.abort(); });
          try {
            const upstream = await fetcher(`${config.baseUrl}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal });
            if (!upstream.ok) {
              await upstream.body?.cancel();
              return json(res, upstream.status === 429 ? 429 : 502, { error: `Coarena returned HTTP ${upstream.status}. Check model availability, limits, or account quota. No automatic paid retry was made.` });
            }
            if (!upstream.body) return json(res, 502, { error: 'Coarena returned an empty response.' });
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
            if (upstream.headers.get('content-type')?.includes('application/json')) {
              const result = await upstream.json();
              res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: result.choices?.[0]?.message?.content || '' }, finish_reason: result.choices?.[0]?.finish_reason }], usage: result.usage })}\n\ndata: [DONE]\n\n`);
            } else {
              for await (const chunk of upstream.body) {
                if (res.destroyed) break;
                if (!res.write(chunk)) await new Promise(resolve => { res.once('drain', resolve); res.once('close', resolve); });
              }
            }
            res.end();
          } finally { clearTimeout(timer); }
          return;
        }
        return json(res, 404, { error: 'Unknown API route.' });
      }
      if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed.' });
      const decoded = decodeURIComponent(url.pathname);
      const file = path.resolve(dist, `.${decoded === '/' ? '/index.html' : decoded}`);
      if (!file.startsWith(path.resolve(dist) + path.sep)) return json(res, 403, { error: 'Invalid path.' });
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return json(res, 404, { error: 'Build the app first with npm run build.' });
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    } catch (error) {
      if (res.headersSent) { res.write(`data: ${JSON.stringify({ error: { message: 'Connection interrupted. Your local files are unchanged.' } })}\n\n`); res.end(); }
      else json(res, error.status || 500, { error: error.status ? error.message : 'Gateway request failed. Check configuration and network.' });
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createGateway();
  server.listen(Number(process.env.IDE_PORT || 4318), process.env.IDE_HOST || '127.0.0.1', () => console.log(`Astromen Pocket gateway: http://${process.env.IDE_HOST || '127.0.0.1'}:${server.address().port}`));
}
