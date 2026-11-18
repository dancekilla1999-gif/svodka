// Вебхук Telegram-бота: привязка чата по коду из кабинета (/start КОД) и разговор с ИИ-управляющим.
// Команды: /week — план управляющего на неделю, /money — финансы недели, /buy — закупки, /team — персонал, /menu — меню, /help.
// Любой другой текст из привязанного чата — вопрос управляющему по данным заведения.
const crypto = require('node:crypto');
const { rpc } = require('../lib/sb');
const { hookSecret, send, readBody, publicUrl } = require('../lib/common');
const { tgSend } = require('../lib/text');
const { dbFor } = require('../lib/pipeline');
const A = require('../lib/agents');

const HELP = 'Я — управляющий «Сводки». Каждое утро присылаю отчёт по смене, по понедельникам — итоги недели и план.\n\n' +
  'Спросите меня о чём угодно по заведению: «почему упала выручка?», «что подорожало?», «кого из официантов похвалить?», «сколько заработали за неделю?»\n\n' +
  'Команды: /week — план на неделю, /money — финансы, /buy — закупки, /team — персонал, /menu — меню.';
const CMD = { '/money': 'finance', '/buy': 'purchases', '/team': 'staff', '/menu': 'menu', '/week': 'director', '/today': 'shift' };

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function insightText(i) {
  if (!i) return 'Этот агент ещё не работал — подождите утреннего отчёта или нажмите «Пересчитать неделю» в кабинете.';
  const items = ((i.data && i.data.items) || []).slice(0, 7).map((x) => `${x.level === 'bad' ? '🔴' : x.level === 'warn' ? '🟡' : '🟢'} ${esc(x.text)}`);
  return `<b>${esc((A.AGENTS[i.agent] || {}).name || i.agent)} · ${esc(i.title)}</b>\n\n` + (i.agent === 'director' ? esc(i.text) : (items.join('\n') || esc(i.text)));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  const got = String(req.headers['x-telegram-bot-api-secret-token'] || '');
  const want = hookSecret();
  if (!process.env.CRON_SECRET || got.length !== want.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))) return send(res, 401, { error: 'unauthorized' });
  const u = await readBody(req);
  const m = u.message;
  if (!m || !m.chat) return send(res, 200, { ok: true });
  const text = String(m.text || '').trim();
  const secret = process.env.CRON_SECRET;
  const code = (text.match(/^\/start(?:@\w+)?\s+([a-f0-9]{18})$/i) || [])[1];
  if (code) {
    const r = await rpc('sv_tg_bind', { p_secret: secret, p_code: code.toLowerCase(), p_chat: m.chat.id, p_title: m.chat.title || [m.chat.first_name, m.chat.last_name].filter(Boolean).join(' ') }).catch(() => ({ ok: false }));
    await tgSend(m.chat.id, r.ok ? '✅ Готово! Каждое утро в 6:00 сюда будет приходить отчёт по вчерашней смене, а по понедельникам — итоги недели.\n\n' + HELP : 'Код не подошёл или устарел. Нажмите «Подключить Telegram» в кабинете ещё раз.');
    return send(res, 200, { ok: true });
  }
  if (!text) return send(res, 200, { ok: true });
  const o = await rpc('sv_agent_sys', { p_secret: secret, p_owner: null, p_op: 'tg_owner', p_args: { chat: m.chat.id } }).catch(() => ({}));
  if (!o.owner_id) {
    await tgSend(m.chat.id, 'Это бот «Сводки» — отчёты и ИИ-управляющий по данным iiko. Чтобы подключить чат, нажмите «Подключить Telegram» в кабинете.');
    return send(res, 200, { ok: true });
  }
  // в группах отвечаем только на команды и сообщения, где бота упомянули или ответили ему
  const isGroup = m.chat.type === 'group' || m.chat.type === 'supergroup';
  const cmd = text.split(/[\s@]/)[0].toLowerCase();
  if (isGroup && !text.startsWith('/') && !(m.reply_to_message && m.reply_to_message.from && m.reply_to_message.from.is_bot) && !/@\w*bot\b/i.test(text)) return send(res, 200, { ok: true });
  const db = dbFor({ secret, owner: o.owner_id });
  try {
    if (cmd === '/help' || cmd === '/start') { await tgSend(m.chat.id, HELP); return send(res, 200, { ok: true }); }
    if (CMD[cmd]) {
      const i = await db.op('insight_get', { agent: CMD[cmd] }).catch(() => null);
      await tgSend(m.chat.id, insightText(i) + `\n\n<a href="${publicUrl(req)}/app/#/agents">Открыть в кабинете</a>`);
      return send(res, 200, { ok: true });
    }
    const q = text.replace(/@\w+/g, '').trim().slice(0, 1500);
    const ctx = await db.op('ctx', { days: 14 });
    await db.op('chat_add', { role: 'user', text: q, via: 'tg' });
    const ans = await A.answer(q, ctx);
    await db.op('chat_add', { role: 'assistant', text: ans.text, via: 'tg' });
    await tgSend(m.chat.id, esc(ans.text));
  } catch (e) {
    await tgSend(m.chat.id, 'Не получилось ответить: ' + esc(String(e.message).slice(0, 200)));
  }
  return send(res, 200, { ok: true });
};
