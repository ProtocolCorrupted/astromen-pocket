import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const ROOT = path.resolve(APP_ROOT, '..');
export function loadConfig(root = ROOT, env = process.env) {
  const values = { ...env };
  for (const name of ['.env', 'example.env']) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      if (line.startsWith('coa_') && !line.includes('=')) {
        if (!values.COARENA_API_KEY || values.COARENA_API_KEY === 'coa_api-key') values.COARENA_API_KEY = line;
      } else if (/^base\s*url\s*:/i.test(line)) {
        values.COARENA_BASE_URL ||= line.replace(/^base\s*url\s*:\s*/i, '').trim();
      } else {
        const match = line.match(/^(\w+)\s*=\s*(.*)$/);
        if (match && (!values[match[1]] || values[match[1]] === 'coa_api-key')) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
      }
    }
  }
  const base = new URL(values.COARENA_BASE_URL || 'https://coarena.ai/api/v1');
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('Coarena base URL must be an HTTPS URL without credentials or query.');
  return { apiKey: values.COARENA_API_KEY === 'coa_api-key' ? '' : values.COARENA_API_KEY || '', baseUrl: base.href.replace(/\/+$/, ''), values };
}
export function accessToken() {
  if (process.env.IDE_ACCESS_TOKEN?.length >= 32) return process.env.IDE_ACCESS_TOKEN;
  const dir = path.join(APP_ROOT, '.data');
  const file = path.join(dir, 'access-token');
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const token = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, token, { mode: 0o600, flag: 'wx' });
  return token;
}
