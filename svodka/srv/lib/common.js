const crypto = require('node:crypto');
function moscowDay(offsetDays = 0) {
  const d = new Date(Date.now() + 3 * 3600 * 1000); d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
function publicUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  const host = (req && (req.headers['x-forwarded-host'] || req.headers.host)) || 'localhost';
  return `https://${host}`;
}
function hookSecret() { return crypto.createHash('sha256').update('tg:' + (process.env.CRON_SECRET || '')).digest('hex').slice(0, 48); }
function send(res, code, obj) { res.statusCode = code; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(obj)); }
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  const chunks = []; for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (e) { return {}; }
}
module.exports = { moscowDay, publicUrl, hookSecret, send, readBody };
