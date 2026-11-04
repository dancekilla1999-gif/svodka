// Агенты в кабинете: пересчёт недели и вопросы ИИ-управляющему. Остальное (расходы, настройки, выводы) — напрямую через базу.
const { rpc } = require('../lib/sb');
const { dbFor, runWeek } = require('../lib/pipeline');
const A = require('../lib/agents');
const ai = require('../lib/ai');
const { moscowDay, send, readBody } = require('../lib/common');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Только POST' });
  const b = await readBody(req);
  const token = String(b.token || '');
  try {
    await rpc('sv_me', { p_token: token });
    const db = dbFor({ token });
    switch (b.action) {
      case 'status':
        return send(res, 200, { ai: ai.enabled(), agents: A.AGENTS });
      case 'week': {
        // неделя, в которую входит указанный день; по умолчанию — последняя полная (пн–вс)
        let day = /^\d{4}-\d{2}-\d{2}$/.test(b.day || '') ? b.day : null;
        if (!day) { const y = moscowDay(-1), d = A.dow(y); day = d === 0 ? y : A.isoAdd(y, -d); }
        if (day > moscowDay(0)) throw new Error('Неделя ещё не наступила');
        const w = await runWeek(db, day, {});
        return send(res, 200, { ok: true, key: w.director.pkey, by_ai: w.director.data.by_ai });
      }
      case 'ask': {
        const q = String(b.question || '').trim();
        if (q.length < 2) throw new Error('Задайте вопрос');
        if (q.length > 1500) throw new Error('Слишком длинный вопрос — до 1500 знаков');
        const ctx = await db.op('ctx', { days: 14 });
        await db.op('chat_add', { role: 'user', text: q, via: 'app' });
        const ans = await A.answer(q, ctx);
        if (!process.env.CRON_SECRET) return send(res, 200, { ok: true, text: ans.text, by_ai: ans.by_ai });
        const o = await rpc('sv_agent_sys', { p_secret: process.env.CRON_SECRET, p_owner: null, p_op: 'owner_of_token', p_args: { token } });
        await rpc('sv_agent_sys', { p_secret: process.env.CRON_SECRET, p_owner: o.owner_id, p_op: 'chat_add', p_args: { role: 'assistant', text: ans.text, via: 'app' } });
        return send(res, 200, { ok: true, text: ans.text, by_ai: ans.by_ai });
      }
      default:
        return send(res, 400, { error: 'Неизвестное действие' });
    }
  } catch (e) {
    return send(res, e.hint === 'auth' ? 401 : 400, { error: e.message || 'Ошибка', hint: e.hint || null });
  }
};
