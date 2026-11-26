// Вызов функций сессий. Локально и на Timeweb — Postgres по DATABASE_URL.
// На Этапе 1 — REST Supabase с сервисным ключом. Публичный ключ эти функции не вызывает.
let pool;
const SERVICE_FNS = new Set([
  'sv_tg_session', 'sv_tg_link', 'sv_tg_login', 'sv_link_code_consume', 'sv_link_code_issue',
  'sv_link_code_status', 'sv_link_code_dispute', 'sv_web_login', 'sv_web_register', 'sv_web_refresh',
  'sv_web_migrate', 'sv_invite_issue', 'sv_tg_purge', 'sv_security_bump'
]);

function databaseUrl() {
  return process.env.DATABASE_URL || process.env.TEST_DATABASE_URL || '';
}

function getPool() {
  const url = databaseUrl();
  if (!url) return null;
  if (!pool) {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: url, max: 12 });
  }
  return pool;
}

function fail(message, hint, code) {
  const err = new Error(message || 'Ошибка');
  err.hint = hint || null;
  if (code) err.code = code;
  return err;
}

async function rest(fn, named) {
  const base = process.env.SB_URL || 'https://qozyihhlocvgpkchyqsp.supabase.co';
  const key = process.env.SB_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!key) throw fail('Сервер не настроен', 'config');
  const r = await fetch(base.replace(/\/$/, '') + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify(named),
    signal: AbortSignal.timeout(20000)
  });
  const txt = await r.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
  if (!r.ok) {
    const message = (data && (data.message || data.error)) || 'База ответила ' + r.status;
    throw fail(message, data && data.hint, data && data.code);
  }
  return data;
}

async function call(fn, named) {
  if (!/^[a-z0-9_]+$/i.test(fn)) throw fail('Неизвестная функция', 'invalid');
  const db = getPool();
  if (!db) return rest(fn, named);
    const keys = Object.keys(named);
    const values = keys.map((k) => named[k]);
    const slots = keys.map((k, i) => {
      if (!/^[a-z_][a-z0-9_]*$/i.test(k)) throw fail('Плохой аргумент', 'invalid');
      return k + ' => $' + (i + 1);
    }).join(', ');
    try {
      const r = await db.query('select public.' + fn + '(' + slots + ') as result', values);
    return r.rows[0] ? r.rows[0].result : null;
  } catch (e) {
    throw fail(e.message, e.hint, e.code);
  }
}

async function query(sql, params) {
  const db = getPool();
  if (!db) throw fail('Нет локальной базы', 'config');
  return db.query(sql, params);
}

function sessionSecret() {
  const s = process.env.TG_SESSION_SECRET || '';
  if (!s) throw fail('Сервер не настроен', 'config');
  return s;
}

module.exports = { call, query, getPool, sessionSecret, SERVICE_FNS, databaseUrl };
