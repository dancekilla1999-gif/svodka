// Шифрование пары access+refresh на 60 секунд после ротации. В базе только шифротекст.
const crypto = require('node:crypto');

function graceKey() {
  const raw = String(process.env.REFRESH_GRACE_KEY || '');
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  if (!raw) {
    const err = new Error('Сервер не настроен');
    err.hint = 'config';
    throw err;
  }
  return crypto.createHash('sha256').update(raw).digest();
}

function sealPair(access, refresh) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', graceKey(), iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify({ access: access, refresh: refresh }), 'utf8'),
    cipher.final()
  ]);
  return {
    cipher: body.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64')
  };
}

function openPair(box) {
  const iv = Buffer.from(String(box.iv || ''), 'base64');
  const tag = Buffer.from(String(box.tag || ''), 'base64');
  const data = Buffer.from(String(box.cipher || ''), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', graceKey(), iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  const parsed = JSON.parse(plain);
  if (!parsed || !parsed.access || !parsed.refresh) {
    const err = new Error('Сессия не сохранилась');
    err.hint = 'expired';
    throw err;
  }
  return parsed;
}

module.exports = { sealPair, openPair };
