// Ежедневно в 06:00 по Москве: отчёт за вчера и работа агентов для каждого подключённого собственника.
// По понедельникам (вчера — воскресенье) дополнительно недельный разбор: финансы, персонал, меню, закупки и план управляющего.
const crypto = require('node:crypto');
const { rpc } = require('../lib/sb');
const { tgSend } = require('../lib/text');
const { dbFor, runDay } = require('../lib/pipeline');
const { moscowDay, publicUrl, hookSecret, send } = require('../lib/common');

function same(a, b) { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && crypto.timingSafeEqual(x, y); }

module.exports = async function handler(req, res) {
  const secret = process.env.CRON_SECRET || '';
  if (!secret || !same(req.headers.authorization, `Bearer ${secret}`)) return send(res, 401, { error: 'unauthorized' });
  const base = publicUrl(req);
  // вебхук бота (идемпотентно): нужен и для привязки чата, и для вопросов управляющему
  if (process.env.TG_BOT_TOKEN) {
    await fetch(`https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/setWebhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `${base}/api/tg`, secret_token: hookSecret(), allowed_updates: ['message'] }), signal: AbortSignal.timeout(10000) }).catch(() => {});
  }
  const day = (req.query && /^\d{4}-\d{2}-\d{2}$/.test(req.query.day || '')) ? req.query.day : moscowDay(-1);
  const jobs = await rpc('sv_cron_jobs', { p_secret: secret });
  const results = [];
  const queue = jobs.slice();
  async function worker() {
    while (queue.length) {
      const j = queue.shift();
      const db = dbFor({ secret, owner: j.owner_id });
      try {
        const r = await runDay(db, j, day, { chatId: j.chat_id, base });
        results.push({ ok: true, sent: r.sent, week: r.week });
      } catch (e) {
        await rpc('sv_cron_save', { p_secret: secret, p_owner: j.owner_id, p_day: day, p_dept: 'all', p_data: {}, p_error: e.message }).catch(() => {});
        if (j.chat_id) await tgSend(j.chat_id, `⚠️ Не удалось собрать отчёт за ${day}: ${String(e.message).slice(0, 200)}`).catch(() => {});
        results.push({ ok: false });
      }
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  return send(res, 200, { day, total: jobs.length, ok: results.filter((r) => r.ok).length, weeks: results.filter((r) => r.week).length });
};
