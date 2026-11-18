// Действия кабинета, которым нужен сервер: проверка и сохранение подключения iiko, построение отчёта, демо, Telegram.
const { rpc } = require('../lib/sb');
const { seal, open } = require('../lib/box');
const { Iiko } = require('../lib/iiko');
const { dbFor, runDay, runWeek } = require('../lib/pipeline');
const { isoAdd } = require('../lib/agents');
const { moscowDay, publicUrl, hookSecret, send, readBody } = require('../lib/common');

async function withIiko(base, login, password, fn) {
  const c = new Iiko(base, login, password);
  await c.auth();
  try { return await fn(c); } finally { await c.logout(); }
}
function validDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) throw new Error('Неверная дата');
  if (day > moscowDay(0)) throw new Error('Отчёт за будущий день построить нельзя');
  return day;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Только POST' });
  const b = await readBody(req);
  const token = String(b.token || '');
  try {
    await rpc('sv_me', { p_token: token }); // проверка сессии владельца до любых обращений к iiko
    switch (b.action) {
      case 'test': {
        const deps = await withIiko(b.base_url, b.login, b.password, (c) => c.departments());
        return send(res, 200, { ok: true, departments: deps });
      }
      case 'save': {
        let pass_enc = '', departments;
        if (b.password) {
          departments = await withIiko(b.base_url, b.login, b.password, (c) => c.departments());
          pass_enc = seal(b.password);
        } else {
          const s = await rpc('sv_conn_secret', { p_token: token });
          departments = await withIiko(b.base_url || s.base_url, b.login || s.login, open(s.pass_enc), (c) => c.departments());
        }
        const ids = new Set((b.selected || []).map(String));
        const selected = departments.filter((d) => ids.has(String(d.id)));
        const conn = await rpc('sv_conn_save', { p_token: token, p_conn: { mode: 'iiko', base_url: new Iiko(b.base_url).base, login: b.login, pass_enc, departments, selected: selected.length ? selected : departments } });
        return send(res, 200, { ok: true, conn });
      }
      case 'demo': {
        // две недели вымышленного кафе: отчёты, закупки, затем недельный разбор всех агентов
        await rpc('sv_conn_save', { p_token: token, p_conn: { mode: 'demo', departments: [{ id: 'demo', name: 'Демо-кафе' }], selected: [{ id: 'demo', name: 'Демо-кафе' }] } });
        const db = dbFor({ token });
        const conn = { mode: 'demo', prefs: {} };
        let last = null;
        for (let i = 14; i >= 1; i--) last = await runDay(db, conn, moscowDay(-i), { noAi: true, week: false });
        // последняя полная неделя (пн–вс) — с ИИ, если он подключён; предыдущая — для сравнения
        const y = moscowDay(-1), d = new Date(y + 'T12:00:00Z').getUTCDay();
        const lastSunday = d === 0 ? y : isoAdd(y, -d);
        await runWeek(db, isoAdd(lastSunday, -7), { noAi: true });
        await runWeek(db, lastSunday, {});
        return send(res, 200, { ok: true, id: last && last.id });
      }
      case 'run': {
        const day = validDay(b.day || moscowDay(-1));
        const s = await rpc('sv_conn_secret', { p_token: token });
        const home = await rpc('sv_agent', { p_token: token, p_op: 'home', p_args: {} }).catch(() => ({}));
        const partial = day === moscowDay(0);
        let r;
        try {
          r = await runDay(dbFor({ token }), Object.assign({}, s, { prefs: home.prefs || {} }), day, { partial, chatId: b.send ? s.chat_id : null, base: publicUrl(req), week: false, purchBudget: 8000 });
          if (s.mode !== 'demo') await rpc('sv_conn_status', { p_token: token, p_error: '' });
        } catch (e) {
          if (s.mode !== 'demo') await rpc('sv_conn_status', { p_token: token, p_error: e.message }).catch(() => {});
          throw e;
        }
        return send(res, 200, { ok: true, id: r.id, sent: r.sent });
      }
      case 'tg_link': {
        const tok = process.env.TG_BOT_TOKEN;
        if (!tok) return send(res, 200, { enabled: false });
        const me = await fetch(`https://api.telegram.org/bot${tok}/getMe`, { signal: AbortSignal.timeout(10000) }).then((r) => r.json()).catch(() => null);
        if (!me || !me.ok) return send(res, 200, { enabled: false });
        // вебхук ставим сразу, не дожидаясь утреннего крона (идемпотентно)
        await fetch(`https://api.telegram.org/bot${tok}/setWebhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: `${publicUrl(req)}/api/tg`, secret_token: hookSecret(), allowed_updates: ['message'] }), signal: AbortSignal.timeout(10000) }).catch(() => {});
        const c = await rpc('sv_tg_code', { p_token: token });
        return send(res, 200, { enabled: true, bot: me.result.username, url: `https://t.me/${me.result.username}?start=${c.code}`, group: `https://t.me/${me.result.username}?startgroup=${c.code}` });
      }
      default:
        return send(res, 400, { error: 'Неизвестное действие' });
    }
  } catch (e) {
    return send(res, e.hint === 'auth' ? 401 : 400, { error: e.message || 'Ошибка', hint: e.hint || null });
  }
};
