// Короткое сообщение в Telegram по отчёту.
function money(n) { return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(n || 0)) + ' ₽'; }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function delta(a, b) { if (!b) return ''; const d = Math.round((a / b - 1) * 100); return ` (${d >= 0 ? '+' : ''}${d}% к прошлой неделе)`; }
function dayRu(iso) { const d = new Date(iso + 'T12:00:00Z'); return d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' }); }
function reportText(o, link) {
  const t = o.totals, p = o.prev || {};
  const L = [];
  L.push(`<b>Итоги смены · ${esc(dayRu(o.day))}</b>${o.demo ? ' · <i>демо</i>' : ''}`);
  if (o.depts && o.depts.length) L.push(esc(o.depts.join(', ')));
  L.push('');
  L.push(`💰 Выручка: <b>${money(t.revenue)}</b>${delta(t.revenue, p.revenue)}`);
  L.push(`🧾 Чеков: ${t.orders} · средний ${money(t.avg_check)}`);
  L.push(`👥 Гостей: ${t.guests} · на гостя ${money(t.avg_guest)}`);
  if (t.discount) L.push(`🏷 Скидки: ${money(t.discount)}`);
  if (t.deleted_sum) L.push(`🗑 Удаления: ${money(t.deleted_sum)}`);
  if (o.pay && o.pay.length) L.push('💳 ' + o.pay.slice(0, 3).map((x) => `${esc(x.name)} ${Math.round(x.share * 100)}%`).join(' · '));
  if (o.waiters && o.waiters.length) L.push(`⭐ Лучший: ${esc(o.waiters[0].name)} — ${money(o.waiters[0].revenue)}`);
  if (o.flags && o.flags.length) {
    L.push('');
    L.push('<b>На что посмотреть:</b>');
    o.flags.slice(0, 5).forEach((f) => L.push(`${f.level === 'bad' ? '🔴' : '🟡'} ${esc(f.text)}`));
  } else { L.push(''); L.push('✅ Отклонений не найдено'); }
  if (link) { L.push(''); L.push(`<a href="${esc(link)}">Полный отчёт</a>`); }
  return L.join('\n');
}
async function tgSend(chatId, text) {
  const tok = process.env.TG_BOT_TOKEN;
  if (!tok || !chatId) return false;
  const r = await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }), signal: AbortSignal.timeout(15000) });
  return r.ok;
}
module.exports = { reportText, tgSend, money };
