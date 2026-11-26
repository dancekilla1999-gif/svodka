// HTTP кабинета и Mini App: /api/auth/* и /api/tg/{auth,link,login,unbind,bot}.
// initData в логи, ответы и аналитику не попадает — только код ошибки и tg_user_id при верной подписи.
const crypto = require('node:crypto');
const { send, readBody, requestHost, publicUrl } = require('../lib/common');
const { validateInitData } = require('../lib/telegram');
const { sealPair, openPair } = require('../lib/grace');
const db = require('../lib/authdb');
const { operatorGaps } = require('../lib/operator');

const CONSENT_VERSION = '2026-11-26.3';
const AUTH_MAX_SEC = 10 * 60;
const LINK_MAX_SEC = 60 * 60;
let alertedAt = 0;

function sessionSecret() { return db.sessionSecret(); }

function clientIp(req) {
  const raw = req && req.headers ? req.headers['x-real-ip'] : '';
  const first = Array.isArray(raw) ? raw[0] : raw;
  return String(first || '').split(',')[0].trim();
}

function ipHash(ip) {
  const salt = process.env.IP_SALT || '';
  if (!salt) return crypto.createHash('sha256').update('no-salt').digest('hex');
  return crypto.createHmac('sha256', salt).update(String(ip || '')).digest('hex');
}

function bearer(req) {
  const h = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || '');
  const m = /^Bearer\s+(\S+)/i.exec(h);
  return m ? m[1] : '';
}

function readCookie(req, name) {
  const raw = String((req.headers && req.headers.cookie) || '');
  const parts = raw.split(/;\s*/);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const eq = p.indexOf('=');
    if (eq > 0 && p.slice(0, eq) === name) return decodeURIComponent(p.slice(eq + 1));
  }
  return '';
}

function refreshCookie(token, maxAge) {
  const age = maxAge == null ? 31536000 : maxAge;
  return 'sv_rt=' + encodeURIComponent(token || '') + '; HttpOnly; Secure; SameSite=Strict; Path=/api/auth; Max-Age=' + age;
}

function sameOrigin(req) {
  const origin = String((req.headers && req.headers.origin) || '');
  const host = requestHost(req);
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch (e) { return false; }
}

function logTg(code, tgUserId) {
  console.log(JSON.stringify({ tg_auth: code, tg_user_id: tgUserId || null }));
}

function newToken() { return crypto.randomBytes(24).toString('hex'); }

function deviceKey(body) {
  const platform = String((body && body.platform) || '').slice(0, 32);
  const id = String((body && body.device_id) || '').slice(0, 128);
  return crypto.createHash('sha256').update(platform + id).digest('hex');
}

function tgLabel(body) {
  if (body && body.device_label) return String(body.device_label).slice(0, 80);
  const p = String((body && body.platform) || '');
  const map = {
    ios: 'iPhone · Telegram', android: 'Android · Telegram', tdesktop: 'Telegram Desktop',
    macos: 'macOS · Telegram', web: 'Telegram Web', weba: 'Telegram Web'
  };
  return map[p] || (p ? p.slice(0, 24) + ' · Telegram' : 'Telegram');
}

function botUsername() {
  return String(process.env.TG_BOT_USERNAME || '').replace(/^@/, '').trim();
}

async function bump(kind) {
  try {
    const n = await db.call('sv_security_bump', { p_kind: kind });
    const chat = process.env.TG_ALERT_CHAT_ID || '';
    if (Number(n) > 50 && chat && Date.now() - alertedAt > 5 * 60 * 1000) {
      alertedAt = Date.now();
      const { tgSend } = require('../lib/text');
      await tgSend(chat, 'Сводка: ' + kind + ' за 5 мин: ' + n).catch(() => {});
    }
  } catch (e) { /* счётчик не должен ронять вход */ }
}

function mapRow(res, row) {
  if (!row) return send(res, 500, { error: 'Ошибка сервера' });
  if (row.hint === 'rate') return send(res, 429, { error: row.error || 'Слишком много попыток, подождите 15 мин' });
  if (row.hint === 'forbidden') return send(res, 403, { error: row.error || 'Недостаточно прав', hint: 'forbidden' });
  if (row.hint === 'consent') return send(res, 400, { error: row.error, hint: 'consent' });
  if (row.hint === 'invite') return send(res, 400, { error: row.error || 'Регистрация только по приглашению', hint: 'invite' });
  if (row.hint === 'taken') return send(res, 409, { error: row.error, hint: 'taken' });
  if (row.hint === 'disabled' || row.status === 'disabled') return send(res, 401, { error: 'Аккаунт отключён', hint: 'disabled' });
  if (row.hint === 'code') return send(res, 401, { error: row.error || 'Код не подошёл или устарел', hint: 'code' });
  if (row.hint === 'password') return send(res, 401, { error: row.error || 'Неверная почта или пароль', hint: 'password' });
  if (row.hint === 'expired' || row.status === 'expired') return send(res, 401, { error: 'Сессия закончилась', hint: 'expired' });
  if (row.hint === 'revoked' || row.status === 'revoked' || row.status === 'reuse') return send(res, 401, { error: 'Нужно войти', hint: 'revoked' });
  if (row.hint === 'auth' || row.status === 'missing') return send(res, 401, { error: 'Нужно войти', hint: 'auth' });
  if (row.error) return send(res, 400, { error: row.error, hint: row.hint || null });
  return null;
}

function mapErr(res, err) {
  if (err && err.hint === 'replay') {
    logTg('REPLAY', null);
    return send(res, 401, { error: 'REPLAY', hint: 'replay' });
  }
  if (err && err.hint === 'config') return send(res, 503, { error: 'Сервер не настроен' });
  if (err && (err.code === '42501' || /permission denied/i.test(err.message || ''))) return send(res, 403, { error: 'forbidden' });
  const mapped = mapRow(res, { error: err && err.message, hint: err && err.hint, status: err && err.hint });
  if (mapped) return mapped;
  return send(res, 500, { error: 'Ошибка сервера' });
}

function checkInit(initData, maxAgeSec) {
  const token = process.env.TG_BOT_TOKEN || '';
  const checked = validateInitData(initData, token, { maxAgeSec: maxAgeSec });
  if (!checked.ok) logTg(checked.error, null);
  else logTg('ok', checked.tgUserId);
  return checked;
}

async function post(req, res, fn) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  try { return await fn(); } catch (e) { return mapErr(res, e); }
}

async function tgAuth(req, res) {
  return post(req, res, async () => {
    const body = await readBody(req);
    const checked = checkInit(body.initData, AUTH_MAX_SEC);
    if (!checked.ok) {
      await bump('401');
      return send(res, 401, { error: checked.error });
    }
    const row = await db.call('sv_tg_session', {
      p_secret: sessionSecret(),
      p_tg_user_id: checked.tgUserId,
      p_device_key: deviceKey(body),
      p_device_label: tgLabel(body),
      p_ip_hash: ipHash(clientIp(req))
    });
    if (row && row.hint === 'rate') { await bump('429'); return mapRow(res, row); }
    const mapped = mapRow(res, row);
    if (mapped) return mapped;
    if (row.need_link) return send(res, 200, { need_link: true, tg: { first_name: checked.user.first_name } });
    return send(res, 200, { token: row.token, me: row.me });
  });
}

async function tgLink(req, res) {
  return post(req, res, async () => {
    const body = await readBody(req);
    if (body.consent !== true) return send(res, 400, { error: 'Нужно согласие на обработку Telegram ID, имени и username', hint: 'consent' });
    const checked = checkInit(body.initData, LINK_MAX_SEC);
    if (!checked.ok) { await bump('401'); return send(res, 401, { error: checked.error }); }
    const code = String(body.code || '').replace(/^l_/, '');
    const row = await db.call('sv_tg_link', {
      p_secret: sessionSecret(),
      p_tg_user_id: checked.tgUserId,
      p_device_key: deviceKey(body),
      p_device_label: tgLabel(body),
      p_ip_hash: ipHash(clientIp(req)),
      p_first_name: checked.user.first_name,
      p_username: checked.user.username,
      p_code: code,
      p_consent: true,
      p_init_hash: checked.hash,
      p_version: CONSENT_VERSION
    });
    if (row && row.hint === 'rate') { await bump('429'); return mapRow(res, row); }
    const mapped = mapRow(res, row);
    if (mapped) return mapped;
    return send(res, 200, { token: row.token, me: row.me });
  });
}

async function tgLogin(req, res) {
  return post(req, res, async () => {
    const body = await readBody(req);
    if (body.consent !== true) return send(res, 400, { error: 'Нужно согласие на обработку Telegram ID, имени и username', hint: 'consent' });
    const checked = checkInit(body.initData, LINK_MAX_SEC);
    if (!checked.ok) { await bump('401'); return send(res, 401, { error: checked.error }); }
    const row = await db.call('sv_tg_login', {
      p_secret: sessionSecret(),
      p_email: body.email,
      p_password: body.password,
      p_tg_user_id: checked.tgUserId,
      p_device_key: deviceKey(body),
      p_device_label: tgLabel(body),
      p_ip_hash: ipHash(clientIp(req)),
      p_first_name: checked.user.first_name,
      p_username: checked.user.username,
      p_consent: true,
      p_init_hash: checked.hash,
      p_version: CONSENT_VERSION
    });
    if (row && row.hint === 'rate') { await bump('429'); return mapRow(res, row); }
    const mapped = mapRow(res, row);
    if (mapped) return mapped;
    return send(res, 200, { token: row.token, me: row.me });
  });
}

async function tgUnbind(req, res) {
  return post(req, res, async () => {
    const token = bearer(req);
    const row = await db.call('sv_login_unbind', { p_token: token });
    const mapped = mapRow(res, row);
    if (mapped) return mapped;
    return send(res, 200, { ok: true });
  });
}

async function tgBot(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, { error: 'GET only' });
  return send(res, 200, { username: botUsername() });
}

function webGuard(req, res) {
  if (!sameOrigin(req)) {
    send(res, 403, { error: 'forbidden' });
    return true;
  }
  return false;
}

function issueWeb(res, row) {
  res.setHeader('Set-Cookie', refreshCookie(row.refresh || row.access));
  return send(res, 200, { token: row.access, email: row.email, name: row.name });
}

async function login(req, res) {
  return post(req, res, async () => {
    if (webGuard(req, res)) return;
    const body = await readBody(req);
    const row = await db.call('sv_web_login', {
      p_secret: sessionSecret(),
      p_email: body.email,
      p_password: body.password,
      p_device_label: String(body.device_label || 'Браузер').slice(0, 80),
      p_ip_hash: ipHash(clientIp(req))
    });
    if (row && row.hint === 'rate') { await bump('429'); return mapRow(res, row); }
    const mapped = mapRow(res, row);
    if (mapped) return mapped;
    return issueWeb(res, row);
  });
}

async function register(req, res) {
  return post(req, res, async () => {
    if (webGuard(req, res)) return;
    const body = await readBody(req);
    if (!body.invite || String(body.invite).length < 22) {
      return send(res, 400, { error: 'Регистрация только по приглашению', hint: 'invite' });
    }
    const gaps = operatorGaps();
    if (gaps.length) {
      return send(res, 400, { error: 'Регистрация закрыта: в документах ещё нет реквизитов оператора', hint: 'operator' });
    }
    const row = await db.call('sv_web_register', {
      p_secret: sessionSecret(),
      p_email: body.email,
      p_password: body.password,
      p_name: body.name || '',
      p_invite: body.invite || '',
      p_offer: body.offer === true,
      p_consent: body.consent === true,
      p_doc_version: body.doc_version || '',
      p_device_label: String(body.device_label || 'Браузер').slice(0, 80),
      p_ip_hash: ipHash(clientIp(req)),
      p_ip: '',
      p_ua: String((req.headers && req.headers['user-agent']) || '').slice(0, 500)
    });
    const mapped = mapRow(res, row);
    if (mapped) return mapped;
    return issueWeb(res, row);
  });
}

async function refresh(req, res) {
  return post(req, res, async () => {
    if (webGuard(req, res)) return;
    const old = readCookie(req, 'sv_rt');
    const access = newToken();
    const next = newToken();
    const sealed = sealPair(access, next);
    const row = await db.call('sv_web_refresh', {
      p_secret: sessionSecret(),
      p_old_token: old,
      p_new_access: access,
      p_new_refresh: next,
      p_cipher: sealed.cipher,
      p_iv: sealed.iv,
      p_tag: sealed.tag,
      p_device_label: '',
      p_ip_hash: ipHash(clientIp(req))
    });
    if (row && row.status === 'ok') {
      res.setHeader('Set-Cookie', refreshCookie(next));
      return send(res, 200, { token: access, email: row.email, name: row.name });
    }
    if (row && row.status === 'grace') {
      const pair = openPair(row);
      res.setHeader('Set-Cookie', refreshCookie(pair.refresh));
      return send(res, 200, { token: pair.access });
    }
    if (row && row.status === 'reuse') {
      await bump('refresh_reuse');
      const chat = process.env.TG_ALERT_CHAT_ID || '';
      if (chat) {
        const { tgSend } = require('../lib/text');
        await tgSend(chat, 'Сводка: refresh_reuse, событий: 1').catch(() => {});
      }
      res.setHeader('Set-Cookie', refreshCookie('', 0));
      return send(res, 401, { error: 'Нужно войти', hint: 'revoked' });
    }
    const mapped = mapRow(res, row || { status: 'missing' });
    if (mapped) return mapped;
    return send(res, 401, { error: 'Нужно войти', hint: 'auth' });
  });
}

async function migrate(req, res) {
  return post(req, res, async () => {
    if (webGuard(req, res)) return;
    const body = await readBody(req);
    const row = await db.call('sv_web_migrate', {
      p_secret: sessionSecret(),
      p_token: body.token || '',
      p_device_label: String(body.device_label || 'Браузер').slice(0, 80),
      p_ip_hash: ipHash(clientIp(req))
    });
    const mapped = mapRow(res, row);
    if (mapped) return mapped;
    return issueWeb(res, row);
  });
}

async function logout(req, res) {
  return post(req, res, async () => {
    if (webGuard(req, res)) return;
    const row = await db.call('sv_logout', { p_token: bearer(req) });
    res.setHeader('Set-Cookie', refreshCookie('', 0));
    const mapped = mapRow(res, row);
    if (mapped) return mapped;
    return send(res, 200, { ok: true });
  });
}

async function logoutAll(req, res) {
  return post(req, res, async () => {
    if (webGuard(req, res)) return;
    const row = await db.call('sv_logout_all', { p_token: bearer(req) });
    res.setHeader('Set-Cookie', refreshCookie('', 0));
    const mapped = mapRow(res, row);
    if (mapped) return mapped;
    return send(res, 200, { ok: true });
  });
}

async function password(req, res) {
  return post(req, res, async () => {
    if (webGuard(req, res)) return;
    const body = await readBody(req);
    const row = await db.call('sv_password', {
      p_token: bearer(req),
      p_current: body.current || '',
      p_new: body.new || body.next || ''
    });
    const mapped = mapRow(res, row);
    if (mapped) return mapped;
    return send(res, 200, { ok: true });
  });
}

async function linkCode(req, res) {
  return post(req, res, async () => {
    if (webGuard(req, res)) return;
    const code = crypto.randomBytes(16).toString('base64url');
    const row = await db.call('sv_link_code_issue', {
      p_secret: sessionSecret(),
      p_token: bearer(req),
      p_code: code
    });
    const mapped = mapRow(res, row);
    if (mapped) return mapped;
    const user = botUsername();
    const start = 'l_' + code;
    return send(res, 200, {
      code: code,
      start: start,
      url: user ? 'https://t.me/' + user + '/app?startapp=' + start : ''
    });
  });
}

async function linkStatus(req, res) {
  return post(req, res, async () => {
    if (webGuard(req, res)) return;
    const body = await readBody(req);
    const row = await db.call('sv_link_code_status', {
      p_secret: sessionSecret(),
      p_token: bearer(req),
      p_code: String(body.code || '').replace(/^l_/, '')
    });
    const mapped = mapRow(res, row);
    if (mapped) return mapped;
    return send(res, 200, row);
  });
}

async function linkDispute(req, res) {
  return post(req, res, async () => {
    if (webGuard(req, res)) return;
    const body = await readBody(req);
    const row = await db.call('sv_link_code_dispute', {
      p_secret: sessionSecret(),
      p_token: bearer(req),
      p_code: String(body.code || '').replace(/^l_/, '')
    });
    const mapped = mapRow(res, row);
    if (mapped) return mapped;
    return send(res, 200, { ok: true });
  });
}

function adminTelegramIds() {
  return String(process.env.ADMIN_TELEGRAM_IDS || '')
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter((part) => /^\d+$/.test(part));
}

async function invite(req, res) {
  return post(req, res, async () => {
    if (webGuard(req, res)) return;
    const code = crypto.randomBytes(16).toString('base64url');
    const row = await db.call('sv_invite_issue', {
      p_secret: sessionSecret(),
      p_token: bearer(req),
      p_code: code,
      p_hours: 168,
      p_admin_ids: adminTelegramIds().length ? adminTelegramIds() : null
    });
    const mapped = mapRow(res, row);
    if (mapped) return mapped;
    return send(res, 200, { code: code, role: 'owner', url: publicUrl(req) + '/app/#/register?invite=' + code });
  });
}

async function devices(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, { error: 'GET only' });
  if (webGuard(req, res)) return;
  try {
    const row = await db.call('sv_devices', { p_token: bearer(req) });
    const mapped = mapRow(res, row);
    if (mapped) return mapped;
    return send(res, 200, row);
  } catch (e) { return mapErr(res, e); }
}

async function deviceEnd(req, res) {
  return post(req, res, async () => {
    if (webGuard(req, res)) return;
    const id = (req.query && req.query.id) || '';
    const row = await db.call('sv_device_end', { p_token: bearer(req), p_id: id });
    const mapped = mapRow(res, row);
    if (mapped) return mapped;
    return send(res, 200, { ok: true });
  });
}

async function purge(req, res) {
  const secret = process.env.CRON_SECRET || '';
  const got = String((req.headers && req.headers.authorization) || '');
  const a = Buffer.from(got);
  const b = Buffer.from('Bearer ' + secret);
  if (!secret || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return send(res, 401, { error: 'unauthorized' });
  try {
    const row = await db.call('sv_tg_purge', {});
    return send(res, 200, row || { ok: true });
  } catch (e) { return mapErr(res, e); }
}

module.exports = {
  CONSENT_VERSION,
  tgAuth, tgLink, tgLogin, tgUnbind, tgBot,
  login, register, refresh, migrate, logout, logoutAll, password,
  linkCode, linkStatus, linkDispute, invite, devices, deviceEnd, purge,
  clientIp, ipHash
};
