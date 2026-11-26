// Проверка initData мини-приложения Telegram.
// secret_key = HMAC_SHA256(key="WebAppData", msg=bot token).
// data_check_string — все поля, кроме hash, по алфавиту, через \n. Поле signature из строки не выкидывается.
const crypto = require('node:crypto');

function parseInitData(initData) {
  const params = {};
  const sp = new URLSearchParams(String(initData || ''));
  for (const [k, v] of sp.entries()) params[k] = v;
  return params;
}

function dataCheckString(params, excludeSignature) {
  return Object.keys(params)
    .filter((k) => k !== 'hash' && !(excludeSignature && k === 'signature'))
    .sort()
    .map((k) => k + '=' + params[k])
    .join('\n');
}

function signInitData(fields, botToken) {
  const params = Object.assign({}, fields);
  delete params.hash;
  const secret = crypto.createHmac('sha256', 'WebAppData').update(String(botToken)).digest();
  const hash = crypto.createHmac('sha256', secret).update(dataCheckString(params, false)).digest('hex');
  const usp = new URLSearchParams();
  Object.keys(params).sort().forEach((k) => usp.append(k, params[k]));
  usp.append('hash', hash);
  return usp.toString();
}

function safeEqualHex(a, b) {
  if (!/^[0-9a-f]{64}$/.test(a) || !/^[0-9a-f]{64}$/.test(b)) return false;
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function validateInitData(initData, botToken, opts) {
  const options = opts || {};
  const nowMs = options.now != null ? options.now : Date.now();
  const maxAgeSec = options.maxAgeSec != null ? options.maxAgeSec : 600;
  if (!initData || typeof initData !== 'string' || !botToken) return { ok: false, error: 'BAD_HASH' };
  let params;
  try { params = parseInitData(initData); } catch (e) { return { ok: false, error: 'BAD_HASH' }; }
  const hash = params.hash || '';
  if (!/^[0-9a-f]{64}$/.test(hash)) return { ok: false, error: 'BAD_HASH' };
  const secret = crypto.createHmac('sha256', 'WebAppData').update(String(botToken)).digest();
  const calc = crypto.createHmac('sha256', secret).update(dataCheckString(params, !!options.excludeSignature)).digest('hex');
  if (!safeEqualHex(hash, calc)) return { ok: false, error: 'BAD_HASH' };
  const authDate = Number(params.auth_date);
  if (!Number.isFinite(authDate)) return { ok: false, error: 'BAD_HASH' };
  const nowSec = Math.floor(nowMs / 1000);
  if (authDate - nowSec > 60) return { ok: false, error: 'EXPIRED' };
  if (nowSec - authDate > maxAgeSec) return { ok: false, error: 'EXPIRED' };
  if (!params.user) return { ok: false, error: 'BAD_HASH' };
  let user = {};
  try { user = JSON.parse(params.user); } catch (e) { return { ok: false, error: 'BAD_HASH' }; }
  const id = user && user.id != null ? user.id : null;
  if (id == null || id === '') return { ok: false, error: 'BAD_HASH' };
  return {
    ok: true,
    hash: hash.toLowerCase(),
    tgUserId: id == null ? null : String(id),
    user: {
      id: id,
      first_name: user.first_name ? String(user.first_name).slice(0, 128) : '',
      username: user.username ? String(user.username).slice(0, 64) : '',
      language_code: user.language_code ? String(user.language_code).slice(0, 16) : ''
    }
  };
}

module.exports = { parseInitData, dataCheckString, signInitData, validateInitData };
