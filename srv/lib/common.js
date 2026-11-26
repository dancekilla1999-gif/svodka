const crypto = require('node:crypto');
function moscowDay(offsetDays = 0) {
  const d = new Date(Date.now() + 3 * 3600 * 1000); d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
// Уникальный адрес деплоя Vercel: project-<hash>-team.vercel.app и алиас ветки *-git-*.
// Его нельзя класть в кнопку Telegram: следующий деплой его бросает, а превью часто закрыто логином Vercel.
function unstableVercelHost(host) {
  const name = String(host || '').trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  if (!name.endsWith('.vercel.app')) return false;
  const sub = name.slice(0, -'.vercel.app'.length);
  if (/(^|-)git-/.test(sub)) return true;
  const parts = sub.split('-');
  return parts.some((part, i) => i > 0 && i < parts.length - 1 && /^[a-z0-9]{8,}$/.test(part) && /\d/.test(part));
}
function configuredBase(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  const proto = /^localhost\b|^127\.0\.0\.1\b/i.test(raw) ? 'http' : 'https';
  return `${proto}://${raw}`;
}
function requestHost(req) {
  const raw = req && req.headers && (req.headers['x-forwarded-host'] || req.headers.host);
  const first = Array.isArray(raw) ? raw[0] : raw;
  return String(first || '').split(',')[0].trim();
}
function publicUrl(req) {
  const configured = configuredBase(process.env.PUBLIC_URL) || configuredBase(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  if (configured) return configured;
  const host = requestHost(req);
  if (host && !unstableVercelHost(host)) return configuredBase(host);
  return 'https://svodka-egor12.vercel.app';
}
function hookSecret() { return crypto.createHash('sha256').update('tg:' + (process.env.CRON_SECRET || '')).digest('hex').slice(0, 48); }
function send(res, code, obj) { res.statusCode = code; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(obj)); }
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  const chunks = []; for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (e) { return {}; }
}
module.exports = { moscowDay, publicUrl, unstableVercelHost, hookSecret, send, readBody };
