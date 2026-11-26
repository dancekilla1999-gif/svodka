const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Client } = require('pg');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://svodka:svodka@127.0.0.1:5432/svodka';
process.env.TG_SESSION_SECRET = process.env.TG_SESSION_SECRET || 'test-session-secret';
process.env.TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || '123456789:AAH-synthetic-bot-token-00000000000';
process.env.REFRESH_GRACE_KEY = process.env.REFRESH_GRACE_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.IP_SALT = process.env.IP_SALT || 'test-ip-salt';
process.env.CRON_SECRET = process.env.CRON_SECRET || 'test-cron-secret-value';
process.env.TG_BOT_USERNAME = process.env.TG_BOT_USERNAME || 'trio_svodka_bot';

const session = require('../api/session');
const db = require('./authdb');
const { signInitData } = require('./telegram');
const logs = [];
const origLog = console.log;
console.log = (...args) => { logs.push(args.map(String).join(' ')); };

let seq = 0;
function ip() { seq += 1; return '198.51.100.' + (seq % 200 + 1); }
function email(tag) { return tag + '-' + crypto.randomBytes(4).toString('hex') + '@example.test'; }

function resCapture() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    end(s) { this.body = s == null ? '' : String(s); }
  };
}
async function hit(fn, opt) {
  const o = opt || {};
  const r = resCapture();
  const req = {
    method: o.method || 'POST',
    headers: Object.assign({
      host: 'svodka.test',
      origin: 'https://svodka.test',
      'x-real-ip': o.ip || ip(),
      'content-type': 'application/json'
    }, o.headers || {}),
    body: o.body || {},
    query: o.query || {}
  };
  await fn(req, r);
  let json = null;
  try { json = r.body ? JSON.parse(r.body) : null; } catch (e) { json = null; }
  return { status: r.statusCode, json, headers: r.headers, raw: r.body };
}
function cookie(header) {
  const m = /sv_rt=([^;]*)/.exec(header || '');
  return m ? decodeURIComponent(m[1]) : '';
}
function initData(user, authDate, extra) {
  return signInitData(Object.assign({
    auth_date: String(authDate),
    query_id: 'q' + crypto.randomBytes(3).toString('hex'),
    user: JSON.stringify(user),
    signature: 'sig-' + crypto.randomBytes(4).toString('hex')
  }, extra || {}), process.env.TG_BOT_TOKEN);
}
function user(id) { return { id, first_name: 'Егор', username: 'rundego', language_code: 'ru' }; }
function nowSec() { return Math.floor(Date.now() / 1000); }
async function me(token) {
  try { return { ok: true, row: await db.call('sv_me', { p_token: token }) }; }
  catch (e) { return { ok: false, hint: e.hint }; }
}
async function wipe() {
  await db.query(`truncate sv.auth_events, sv.rate_hits, sv.tg_initdata_used, sv.refresh_grace,
    sv.security_minute, sv.login_attempts, sv.invites, public.sv_legal_consent, sv.owners restart identity cascade`);
}
async function register(tag, password) {
  const code = crypto.randomBytes(16).toString('base64url');
  await db.call('sv_invite_issue', { p_secret: process.env.TG_SESSION_SECRET, p_code: code, p_hours: 48 });
  const r = await hit(session.register, {
    body: {
      email: email(tag), password: password || 'password123', name: 'Егор', invite: code,
      offer: true, consent: true, doc_version: '2026-11-26.3', device_label: 'Chrome · Windows'
    }
  });
  assert.equal(r.status, 200, r.raw);
  assert.equal(r.json.refresh, undefined);
  assert.match(r.headers['set-cookie'], /HttpOnly/);
  assert.match(r.headers['set-cookie'], /Secure/);
  assert.match(r.headers['set-cookie'], /SameSite=Strict/);
  assert.match(r.headers['set-cookie'], /Path=\/api\/auth/);
  return { token: r.json.token, cookie: cookie(r.headers['set-cookie']), email: r.json.email };
}
function authBody(data, device, extra) {
  return Object.assign({ initData: data, platform: 'ios', device_id: device || crypto.randomBytes(16).toString('hex') }, extra || {});
}

test.before(async () => {
  try {
    await db.query('select 1 from sv.tg_links limit 1');
  } catch (e) {
    require('node:child_process').execFileSync('node', ['scripts/db-bootstrap.js'], { stdio: 'inherit', env: process.env });
  }
  await wipe();
});

test('регистрация без приглашения закрыта, прямой anon тоже', async () => {
  const no = await hit(session.register, { body: { email: email('no'), password: 'password123', offer: true, consent: true, doc_version: 'x', invite: '' } });
  assert.equal(no.status, 400);
  assert.equal(no.json.hint, 'invite');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('begin');
    await client.query('set local role anon');
    await client.query(`select public.sv_register('a@b.c', 'password123', '', null, true, true, 'v')`);
    assert.fail('anon не должен регистрировать');
  } catch (e) {
    assert.match(e.message, /permission denied|приглашен/i);
  } finally {
    await client.query('rollback');
    await client.end();
  }
});

test('права: anon не вызывает функции сессии даже с верным секретом', async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const secret = process.env.TG_SESSION_SECRET;
  const denied = ['sv_tg_session($1::text, 1::bigint, $2, $2, $2)', 'sv_tg_link($1, 1::bigint, $2, $2, $2, $2, $2, $2, true, $2, $2)', 'sv_tg_login($1, $2, $2, 1::bigint, $2, $2, $2, $2, $2, true, $2, $2)', 'sv_link_code_consume($1, $2)'];
  try {
    for (const sig of denied) {
      await client.query('begin');
      await client.query('set local role anon');
      await assert.rejects(client.query('select public.' + sig, [secret, 'x']), (e) => /permission denied/i.test(e.message));
      await client.query('rollback');
    }
    await client.query('begin');
    await client.query('set local role service_role');
    const ok = await client.query('select public.sv_tg_session($1, 7::bigint, $2, $2, $2) as result', [secret, 'dev']);
    assert.equal(ok.rows[0].result.need_link, true);
    await client.query('rollback');
  } finally { await client.end(); }
});

test('owner_id стабильная, продление отдельное, hint на каждой функции с p_token', async () => {
  const acc = await register('hints');
  const vol = await db.query(`select p.proname, p.provolatile from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'sv' and p.proname in ('owner_id', 'session_touch')`);
  const map = Object.fromEntries(vol.rows.map((r) => [r.proname, r.provolatile]));
  assert.equal(map.owner_id, 's');
  assert.equal(map.session_touch, 'v');
  const hash = crypto.createHash('sha256').update(acc.token).digest('hex');
  async function expectHint(hint) {
    const fns = await db.query(`select p.proname, p.proargnames from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and pg_get_function_identity_arguments(p.oid) ilike '%p_token text%'`);
    assert.ok(fns.rows.length >= 8);
    for (const fn of fns.rows) {
      const named = {};
      for (const name of fn.proargnames || []) {
        if (!name) continue;
        if (name === 'p_token') named[name] = acc.token;
        else if (name === 'p_secret') named[name] = process.env.TG_SESSION_SECRET;
        else if (name === 'p_offer' || name === 'p_consent') named[name] = true;
        else if (name === 'p_doc_version') named[name] = 't';
        else if (name === 'p_id') named[name] = '00000000-0000-0000-0000-000000000000';
        else if (name === 'p_args' || name === 'p_conn' || name === 'p_patch' || name === 'p_data') named[name] = {};
        else named[name] = null;
      }
      try {
        const row = await db.call(fn.proname, named);
        assert.equal(row && row.hint, hint, fn.proname);
      } catch (e) {
        assert.equal(e.hint, hint, fn.proname + ' ' + e.message);
      }
    }
    await assert.rejects(db.query(`select bill.owner_of('sv', $1)`, [acc.token]), (e) => e.hint === hint);
  }
  await db.query(`update sv.sessions set revoked_at = now(), revoke_reason = 'logout' where token_hash = $1`, [hash]);
  await expectHint('revoked');
  const reasons = ['logout_all', 'password', 'admin', 'unbind', 'device_end', 'refresh_reuse'];
  for (const reason of reasons) {
    await db.query(`update sv.sessions set revoked_at = now(), rotated_at = null, revoke_reason = $2 where token_hash = $1`, [hash, reason]);
    const got = await me(acc.token);
    assert.equal(got.hint, 'revoked', reason);
  }
  await db.query(`update sv.sessions set revoked_at = now(), rotated_at = now(), revoke_reason = 'rotated' where token_hash = $1`, [hash]);
  assert.equal((await me(acc.token)).hint, 'expired');
  await db.query(`update sv.sessions set revoked_at = null, rotated_at = null, revoke_reason = null, expires_at = now() - interval '1 minute' where token_hash = $1`, [hash]);
  assert.equal((await me(acc.token)).hint, 'expired');
  await db.query(`update sv.sessions set expires_at = now() + interval '1 day', abs_expires_at = now() - interval '1 minute' where token_hash = $1`, [hash]);
  assert.equal((await me(acc.token)).hint, 'expired');
  await db.query(`update sv.sessions set expires_at = now() + interval '1 day', abs_expires_at = now() + interval '1 day' where token_hash = $1`, [hash]);
  await db.query(`update sv.owners set disabled_at = now() where email = $1`, [acc.email]);
  assert.equal((await me(acc.token)).hint, 'disabled');
  assert.equal((await me('x'.repeat(24))).hint, 'auth');
});

test('привязка кодом: 128 бит, только хеш, срок, повтор, 18-hex и лимит', async () => {
  const acc = await register('link');
  const codes = [];
  for (let i = 0; i < 5; i++) {
    const issued = await hit(session.linkCode, { headers: { authorization: 'Bearer ' + acc.token } });
    assert.equal(issued.status, 200, issued.raw);
    assert.equal(Buffer.from(issued.json.code, 'base64url').length, 16);
    assert.match(issued.json.url, /^https:\/\/t\.me\/trio_svodka_bot\/app\?startapp=l_/);
    codes.push(issued.json.code);
  }
  const sixth = await hit(session.linkCode, { headers: { authorization: 'Bearer ' + acc.token } });
  assert.equal(sixth.status, 429);
  const stored = await db.query('select code_hash from sv.tg_link_codes');
  for (const code of codes) {
    assert.equal(stored.rows.some((r) => r.code_hash === code), false);
    assert.equal(stored.rows.some((r) => r.code_hash === crypto.createHash('sha256').update(code).digest('hex')), true);
  }
  const tg = 9001;
  const fresh = initData(user(tg), nowSec());
  const badConsent = await hit(session.tgLink, { body: authBody(fresh, 'dev-a', { code: codes[0], consent: false }) });
  assert.equal(badConsent.status, 400);
  assert.equal((await db.query('select count(*)::int as n from sv.tg_links where tg_user_id = 9001')).rows[0].n, 0);
  const hex = 'a'.repeat(18);
  const hexTry = await hit(session.tgLink, { body: authBody(fresh, 'dev-a', { code: hex, consent: true }) });
  assert.equal(hexTry.status, 401);
  const bind = await db.query(`select public.sv_tg_bind($1, $2, 1, 'чат') as r`, [process.env.CRON_SECRET, codes[0]]);
  assert.equal(bind.rows[0].r.ok, false);
  const linked = await hit(session.tgLink, { body: authBody(fresh, 'dev-a', { code: codes[0], consent: true }) });
  assert.equal(linked.status, 200, linked.raw);
  const again = await hit(session.tgLink, { body: authBody(initData(user(tg), nowSec()), 'dev-a', { code: codes[0], consent: true }) });
  assert.notEqual(again.status, 200);
  await db.query(`update sv.tg_link_codes set expires_at = now() - interval '1 minute' where code_hash = encode(extensions.digest(convert_to($1, 'UTF8'), 'sha256'), 'hex')`, [codes[1]]);
  const late = await hit(session.tgLink, { body: authBody(initData(user(9002), nowSec()), 'dev-b', { code: codes[1], consent: true }) });
  assert.equal(late.status, 401);
  const consentRow = await db.query(`select kind, version, withdrawn_at from sv.consents`);
  assert.equal(consentRow.rows[0].kind, 'tg_login');
  assert.equal(consentRow.rows[0].version, session.CONSENT_VERSION);
  assert.equal(consentRow.rows[0].withdrawn_at, null);
});

test('один Telegram на аккаунт и согласие при отвязке', async () => {
  const a = await register('one-a');
  const b = await register('one-b');
  async function codeFor(token) {
    const issued = await hit(session.linkCode, { headers: { authorization: 'Bearer ' + token } });
    assert.equal(issued.status, 200, issued.raw);
    return issued.json.code;
  }
  const c1 = await codeFor(a.token);
  const c2 = await codeFor(a.token);
  const c3 = await codeFor(b.token);
  const first = await hit(session.tgLink, { body: authBody(initData(user(9100), nowSec()), 'd1', { code: c1, consent: true }) });
  assert.equal(first.status, 200, first.raw);
  const secondTg = await hit(session.tgLink, { body: authBody(initData(user(9101), nowSec()), 'd2', { code: c2, consent: true }) });
  assert.equal(secondTg.status, 409);
  const otherAcc = await hit(session.tgLink, { body: authBody(initData(user(9100), nowSec()), 'd3', { code: c3, consent: true }) });
  assert.equal(otherAcc.status, 409);
  const off = await hit(session.tgUnbind, { headers: { authorization: 'Bearer ' + first.json.token } });
  assert.equal(off.status, 200);
  const withdrawn = await db.query('select withdrawn_at is not null as gone from sv.consents where tg_user_id = 9100');
  assert.equal(withdrawn.rows.length > 0 && withdrawn.rows.every((r) => r.gone), true);
});

test('повтор initData, неверный пароль его не сжигает, гонки', async () => {
  const acc = await register('replay', 'right-password');
  const data = initData(user(9200), nowSec());
  const wrong = await hit(session.tgLogin, { body: authBody(data, 'phone', { email: acc.email, password: 'wrong-pass', consent: true }) });
  assert.equal(wrong.status, 401);
  assert.notEqual(wrong.json.error, 'REPLAY');
  const right = await hit(session.tgLogin, { body: authBody(data, 'phone', { email: acc.email, password: 'right-password', consent: true }) });
  assert.equal(right.status, 200, right.raw);
  const replay = await hit(session.tgLogin, { body: authBody(data, 'phone', { email: acc.email, password: 'right-password', consent: true }) });
  assert.equal(replay.status, 401);
  assert.equal(replay.json.error, 'REPLAY');
  const other = await register('race', 'race-password');
  const shared = initData(user(9201), nowSec());
  const calls = [];
  for (let i = 0; i < 20; i++) {
    calls.push(hit(session.tgLogin, { body: authBody(shared, 'race-device', { email: other.email, password: 'race-password', consent: true }) }));
  }
  const done = await Promise.all(calls);
  assert.equal(done.filter((r) => r.status === 200).length, 1);
  const acc2 = await register('race-link');
  const issued = await hit(session.linkCode, { headers: { authorization: 'Bearer ' + acc2.token } });
  const linkCalls = [];
  for (let i = 0; i < 2; i++) {
    linkCalls.push(hit(session.tgLink, { body: authBody(initData(user(9300 + i), nowSec()), 'L' + i, { code: issued.json.code, consent: true }) }));
  }
  const linked = await Promise.all(linkCalls);
  assert.equal(linked.filter((r) => r.status === 200).length, 1);
});

test('сессии Telegram: устройство, шесть слотов, сроки', async () => {
  const acc = await register('devices-tg');
  const issued = await hit(session.linkCode, { headers: { authorization: 'Bearer ' + acc.token } });
  const dev = [];
  const first = await hit(session.tgLink, { body: authBody(initData(user(9400), nowSec()), 'device-0', { code: issued.json.code, consent: true }) });
  assert.equal(first.status, 200, first.raw);
  dev.push({ id: 'device-0', token: first.json.token });
  for (let i = 1; i < 5; i++) {
    const id = 'device-' + i;
    const r = await hit(session.tgAuth, { body: authBody(initData(user(9400), nowSec()), id) });
    assert.equal(r.status, 200, r.raw);
    dev.push({ id, token: r.json.token });
  }
  assert.equal((await me(dev[0].token)).ok, true);
  assert.equal((await me(dev[1].token)).ok, true);
  const again = await hit(session.tgAuth, { body: authBody(initData(user(9400), nowSec()), dev[0].id) });
  assert.equal(again.status, 200);
  assert.equal((await me(dev[0].token)).hint, 'expired');
  assert.equal((await me(dev[1].token)).ok, true);
  await db.query(`update sv.sessions set last_used_at = now() - interval '2 days' where device_key = encode(extensions.digest(convert_to('ios' || $1, 'UTF8'), 'sha256'), 'hex')`, [dev[2].id]);
  const sixth = await hit(session.tgAuth, { body: authBody(initData(user(9400), nowSec()), 'device-5') });
  assert.equal(sixth.status, 200, sixth.raw);
  assert.equal((await me(dev[2].token)).hint, 'expired');
  const back = await hit(session.tgAuth, { body: authBody(initData(user(9400), nowSec()), dev[2].id) });
  assert.equal(back.status, 200);
  const hash = crypto.createHash('sha256').update(back.json.token).digest('hex');
  await db.query(`update sv.sessions set expires_at = now() - interval '8 days', last_used_at = now() - interval '8 days' where token_hash = $1`, [hash]);
  assert.equal((await me(back.json.token)).hint, 'expired');
  const renewed = await hit(session.tgAuth, { body: authBody(initData(user(9400), nowSec()), dev[2].id) });
  assert.equal(renewed.status, 200);
  await db.query(`update sv.sessions set abs_expires_at = now() - interval '1 minute', expires_at = now() + interval '1 day' where token_hash = encode(extensions.digest(convert_to($1, 'UTF8'), 'sha256'), 'hex')`, [renewed.json.token]);
  assert.equal((await me(renewed.json.token)).hint, 'expired');
});

test('смена пароля: сайт снимает привязку, Mini App оставляет свою', async () => {
  const acc = await register('pass', 'old-password');
  const issued = await hit(session.linkCode, { headers: { authorization: 'Bearer ' + acc.token } });
  const tg = await hit(session.tgLink, { body: authBody(initData(user(9500), nowSec()), 'pw', { code: issued.json.code, consent: true }) });
  assert.equal(tg.status, 200, tg.raw);
  const bad = await hit(session.password, { headers: { authorization: 'Bearer ' + acc.token }, body: { current: 'nope', new: 'new-password' } });
  assert.equal(bad.status, 401);
  const changed = await hit(session.password, { headers: { authorization: 'Bearer ' + acc.token }, body: { current: 'old-password', new: 'new-password' } });
  assert.equal(changed.status, 200, changed.raw);
  assert.equal((await me(acc.token)).ok, true);
  assert.equal((await me(tg.json.token)).hint, 'revoked');
  assert.equal((await db.query('select count(*)::int as n from sv.tg_links where tg_user_id = 9500')).rows[0].n, 0);
  const login = await hit(session.login, { body: { email: acc.email, password: 'new-password', device_label: 'Safari · macOS' } });
  assert.equal(login.status, 200, login.raw);
  const issued2 = await hit(session.linkCode, { headers: { authorization: 'Bearer ' + login.json.token } });
  const tg2 = await hit(session.tgLink, { body: authBody(initData(user(9501), nowSec()), 'pw2', { code: issued2.json.code, consent: true }) });
  assert.equal(tg2.status, 200, tg2.raw);
  const fromTg = await hit(session.password, { headers: { authorization: 'Bearer ' + tg2.json.token }, body: { current: 'new-password', new: 'newer-password' } });
  assert.equal(fromTg.status, 200, fromTg.raw);
  assert.equal((await me(tg2.json.token)).ok, true);
  assert.equal((await db.query('select count(*)::int as n from sv.tg_links where tg_user_id = 9501')).rows[0].n, 1);
  assert.equal((await me(login.json.token)).hint, 'revoked');
});

test('refresh: ротация, окно 60 секунд, повтор после окна', async () => {
  const acc = await register('refresh');
  const first = await hit(session.refresh, { headers: { cookie: 'sv_rt=' + encodeURIComponent(acc.cookie) } });
  assert.equal(first.status, 200, first.raw);
  const again = await hit(session.refresh, { headers: { cookie: 'sv_rt=' + encodeURIComponent(acc.cookie) } });
  assert.equal(again.status, 200, again.raw);
  assert.equal(again.json.token, first.json.token);
  const foreign = await hit(session.refresh, { headers: { origin: 'https://evil.test', cookie: 'sv_rt=' + encodeURIComponent(acc.cookie) } });
  assert.equal(foreign.status, 403);
  const grace = await db.query('select ciphertext from sv.refresh_grace');
  assert.equal(grace.rows.length, 1);
  assert.equal(grace.rows[0].ciphertext.includes(first.json.token), false);
  assert.equal(grace.rows[0].ciphertext.includes(acc.cookie), false);
  await db.query(`update sv.refresh_grace set expires_at = now() - interval '1 second'`);
  const reuse = await hit(session.refresh, { headers: { cookie: 'sv_rt=' + encodeURIComponent(acc.cookie) } });
  assert.equal(reuse.status, 401);
  assert.equal(reuse.json.hint, 'revoked');
  const ev = await db.query(`select count(*)::int as n from sv.auth_events where kind = 'refresh_reuse'`);
  assert.equal(ev.rows[0].n, 1);
  assert.equal((await me(first.json.token)).hint, 'revoked');
});

test('устройства: завершить Telegram снимает привязку и только эту сессию сайта не трогает чужую', async () => {
  const acc = await register('end');
  const issued = await hit(session.linkCode, { headers: { authorization: 'Bearer ' + acc.token } });
  const tg = await hit(session.tgLink, { body: authBody(initData(user(9600), nowSec()), 'end-dev', { code: issued.json.code, consent: true }) });
  const list = await hit(session.devices, { method: 'GET', headers: { authorization: 'Bearer ' + acc.token } });
  assert.equal(list.status, 200, list.raw);
  const tgRow = list.json.devices.filter((d) => d.kind === 'tg')[0];
  const webRow = list.json.devices.filter((d) => d.current)[0];
  assert.ok(tgRow && webRow);
  const ended = await hit(session.deviceEnd, { headers: { authorization: 'Bearer ' + acc.token }, query: { id: tgRow.id } });
  assert.equal(ended.status, 200, ended.raw);
  assert.equal((await me(tg.json.token)).hint, 'revoked');
  assert.equal((await me(acc.token)).ok, true);
  assert.equal((await db.query('select count(*)::int as n from sv.tg_links where tg_user_id = 9600')).rows[0].n, 0);
  const disputed = await db.query(`select count(*)::int as n from sv.auth_events where kind = 'device_end'`);
  assert.ok(disputed.rows[0].n >= 1);
});

test('лимиты пароля и кода не раскрывают почту и не верят x-forwarded-for', async () => {
  const acc = await register('limit', 'secret-pass');
  const same = '203.0.113.50';
  let last = null;
  for (let i = 0; i < 10; i++) {
    last = await hit(session.login, { ip: same, headers: { 'x-forwarded-for': '1.2.3.' + i }, body: { email: acc.email, password: 'bad-password' } });
    assert.equal(last.status, 401);
  }
  const blocked = await hit(session.login, { ip: same, headers: { 'x-forwarded-for': '8.8.8.8' }, body: { email: acc.email, password: 'bad-password' } });
  assert.equal(blocked.status, 429);
  assert.match(blocked.json.error, /Слишком много попыток, подождите/);
  const fresh = await register('same-text');
  const unknown = await hit(session.login, { ip: ip(), body: { email: email('missing'), password: 'bad-password' } });
  const known = await hit(session.login, { ip: ip(), body: { email: fresh.email, password: 'still-bad' } });
  assert.equal(unknown.json.error, 'Неверная почта или пароль');
  assert.equal(known.json.error, unknown.json.error);
  const ipOnly = '203.0.113.77';
  for (let i = 0; i < 30; i++) {
    const r = await hit(session.login, { ip: ipOnly, body: { email: email('ip' + i), password: 'bad-password' } });
    assert.equal(r.status, 401);
  }
  const ipBlock = await hit(session.login, { ip: ipOnly, headers: { 'x-forwarded-for': '9.9.9.9' }, body: { email: email('fresh'), password: 'bad-password' } });
  assert.equal(ipBlock.status, 429);
  const otherIp = await hit(session.login, { ip: '203.0.113.90', body: { email: email('otherip'), password: 'bad-password' } });
  assert.equal(otherIp.status, 401);
  const who = await register('codes');
  const data = initData(user(9700), nowSec());
  for (let i = 0; i < 10; i++) {
    const r = await hit(session.tgLink, { ip: '203.0.113.60', body: authBody(data, 'c', { code: 'not-a-valid-code-value!!', consent: true }) });
    assert.equal(r.status, 401);
  }
  const tooMany = await hit(session.tgLink, { ip: '203.0.113.60', body: authBody(data, 'c', { code: 'not-a-valid-code-value!!', consent: true }) });
  assert.equal(tooMany.status, 429);
});

test('срок initData на /auth и /login и это не я', async () => {
  const acc = await register('ages');
  const old = initData(user(9800), nowSec() - 11 * 60);
  const stale = await hit(session.tgAuth, { body: authBody(old, 'old') });
  assert.equal(stale.status, 401);
  assert.equal(stale.json.error, 'EXPIRED');
  const issued = await hit(session.linkCode, { headers: { authorization: 'Bearer ' + acc.token } });
  const hour = initData(user(9800), nowSec() - 30 * 60);
  const linked = await hit(session.tgLink, { body: authBody(hour, 'old2', { code: issued.json.code, consent: true }) });
  assert.equal(linked.status, 200, linked.raw);
  const future = initData(user(9801), nowSec() + 120);
  const fut = await hit(session.tgLogin, { body: authBody(future, 'fut', { email: acc.email, password: 'password123', consent: true }) });
  assert.equal(fut.status, 401);
  assert.equal(fut.json.error, 'EXPIRED');
  const status = await hit(session.linkStatus, { headers: { authorization: 'Bearer ' + acc.token }, body: { code: issued.json.code } });
  assert.equal(status.json.bound, true);
  const dispute = await hit(session.linkDispute, { headers: { authorization: 'Bearer ' + acc.token }, body: { code: issued.json.code } });
  assert.equal(dispute.status, 200, dispute.raw);
  const ev = await db.query(`select count(*)::int as n from sv.auth_events where kind = 'tg_unlink_disputed'`);
  assert.equal(ev.rows[0].n, 1);
  assert.equal((await db.query('select count(*)::int as n from sv.tg_links where tg_user_id = 9800')).rows[0].n, 0);
});

test('в логах нет initData', () => {
  const blob = logs.join('\n');
  assert.equal(blob.includes('auth_date='), false);
  assert.equal(blob.includes('query_id='), false);
  assert.match(blob, /BAD_HASH|EXPIRED|REPLAY|tg_auth/);
});
