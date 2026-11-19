// Короткое сообщение в Telegram по отчёту.
function money(n) { return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(n || 0)) + ' ₽'; }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function delta(a, b) { if (!b) return ''; const d = Math.round((a / b - 1) * 100); return ` (${d >= 0 ? '+' : ''}${d}% к прошлой неделе)`; }
function dayRu(iso) { const d = new Date(iso + 'T12:00:00Z'); return d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' }); }
function sum(rows) { return rows.reduce((s, x) => s + Number(x.sum || 0), 0); }
function percent(a, b) { return b > 0 ? ` · ${Math.round(a / b * 100)}%` : ''; }
function label(value, max = 80) { return esc(String(value || '').slice(0, max)); }
function closedLabel(value) {
  if (!value) return 'время не указано';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}:\d{2})/);
  return match ? `${match[3]}.${match[2]} ${match[4]}` : label(value, 40);
}
const PAYMENTS = { cash: 'Наличные', card: 'Карты', bank: 'Безналичный расчёт / р/с', unknown: 'Способ оплаты не определён' };

function reportText(o, link, extra = '') {
  const t = o.totals, p = o.prev || {}, m = o.profit || {};
  const L = [`<b>📊 ИТОГИ СМЕНЫ · ${esc(dayRu(o.day))}</b>${o.demo ? ' · <i>демо</i>' : ''}`];
  if (o.depts?.length) L.push(label(o.depts.join(', '), 150));
  if (o.partial) L.push('<i>Смена ещё идёт</i>');
  L.push('', '<b>💰 ФИНАНСЫ</b>', `Выручка: <b>${money(t.revenue)}</b>`);
  if (p.revenue) L.push(`Динамика: ${delta(t.revenue, p.revenue).trim().replace(/^\(|\)$/g, '')}`);
  if (m.cost != null) L.push(`Себестоимость: ${money(m.cost)}${percent(m.cost, t.revenue)} (фудкост)`);
  if (m.gross != null) L.push(`Валовая прибыль: <b>${money(m.gross)}</b>`);
  if (m.has_expenses && m.profit != null) L.push(`Расходы смены: ${money(m.expenses)}`, `Прибыль после учтённых расходов: <b>${money(m.profit)}</b>`);
  else if (m.gross != null) L.push('Чистая прибыль: внесите расходы в кабинет');

  L.push('', '<b>👥 ГОСТИ И ПРОДАЖИ</b>',
    `Чеков: ${t.orders}  ·  Гостей: ${t.guests}`,
    `Средний чек: ${money(t.avg_check)}`, `На гостя: ${money(t.avg_guest)}`);
  if (o.waiters?.length) L.push(`Лучший по выручке: ${label(o.waiters[0].name)} — ${money(o.waiters[0].revenue)}`);
  if (o.pay?.length) {
    L.push('', '<b>💳 ОПЛАТЫ ПО ДАННЫМ IIKO</b>');
    o.pay.slice(0, 8).forEach((x) => L.push(`• ${label(x.name)}: ${money(x.sum)}${percent(x.sum, t.revenue)}`));
    if (o.pay.length > 8) L.push(`• Остальные: ${money(sum(o.pay.slice(8)))}`);
    const diff = t.revenue - sum(o.pay);
    if (Math.abs(diff) >= 1) L.push(`Расхождение с выручкой: ${money(diff)}`);
  }

  if (o.revenue_breakdown) {
    const items = o.revenue_breakdown;
    L.push('', '<b>🏢 ВЫРУЧКА ПО ЭТАЖАМ</b>');
    for (const floor of ['1', '2', 'unknown']) {
      const rows = items.filter((x) => x.floor === floor);
      if (floor === 'unknown' && !rows.some((x) => x.sum)) continue;
      const title = floor === 'unknown' ? 'Этаж не определён' : `${floor} этаж`;
      if (!rows.some((x) => x.sum)) { L.push(`${title}: нет отдельно учтённой выручки`); continue; }
      L.push(`<b>${title} — ${money(sum(rows))}</b>`);
      for (const [payment, name] of Object.entries(PAYMENTS)) {
        const value = sum(rows.filter((x) => x.payment === payment));
        if (value) L.push(`• ${name}: ${money(value)}`);
      }
      const unknown = sum(rows.filter((x) => x.entity === 'unknown'));
      for (const entity of ['ООО', 'ИП', 'unknown']) {
        const entityRows = rows.filter((x) => x.entity === entity);
        if (!sum(entityRows)) continue;
        const name = entity === 'unknown' ? '⚠️ Юрлицо не определено' : entity;
        L.push(`${name}: ${money(sum(entityRows))}`);
        if (sum(entityRows) !== sum(rows)) {
          for (const [payment, paymentName] of Object.entries(PAYMENTS)) {
            const value = sum(entityRows.filter((x) => x.payment === payment));
            if (value) L.push(`  ${paymentName}: ${money(value)}`);
          }
        }
      }
      if (unknown) {
        const names = [...new Set(rows.filter((x) => x.entity === 'unknown').map((x) => x.entity_name).filter(Boolean))];
        if (names.length) L.push(`  Названия в iiko: ${label(names.join(', '), 100)}`);
      }
    }
    L.push(`<b>Итого по данным разбивки: ${money(sum(items))}</b>`);
    const difference = t.revenue - sum(items);
    if (Math.abs(difference) >= 1) L.push(`Вне разбивки: ${money(difference)}`);
    if (items.some((x) => x.entity === 'unknown' && x.sum)) L.push('<i>iiko не позволил отнести часть выручки к ООО или ИП. Эти деньги входят в итог этажа.</i>');
  }
  L.push('', '<b>🏷 СКИДКИ</b>');
  const base = t.discount_base ?? t.gross;
  L.push(t.discount == null ? 'Данные недоступны' : `Всего: <b>${money(t.discount)}</b>${percent(t.discount, base)}`);
  if (o.discount_details?.length) {
    L.push(`Записей в реестре: ${o.discount_details.length}`, '<i>Подробный реестр скидок — отдельным сообщением.</i>');
  } else if (o.discounts?.length) {
    L.push('<i>Детализация по чекам недоступна. Крупнейшие скидки по типам:</i>');
    o.discounts.slice(0, 3).forEach((x) => L.push(`• ${label(x.type, 40)} · ${label(x.waiter, 40)}: ${money(x.sum)}`));
  } else if (t.discount > 0) L.push('iiko не вернул детализацию скидок');
  if (o.non_fiscal) L.push(`Нефискальные чеки: ${money(sum(o.non_fiscal))}`);
  if (o.promo) {
    const amounts = [o.promo['1'] || 0, o.promo['2'] || 0, o.promo.unknown || 0];
    L.push(`Промо без оплаты: ${money(amounts.reduce((s, x) => s + x, 0))}`);
    if (amounts.some(Boolean)) {
      amounts.forEach((amount, i) => { if (amount) L.push(`• ${i < 2 ? (i + 1) + ' этаж' : 'Этаж не определён'}: ${money(amount)}`); });
    }
  }
  L.push('', '<b>⚠️ КОНТРОЛЬ СМЕНЫ</b>', `Удаления: ${money(t.deleted_sum)}${percent(t.deleted_sum, t.revenue)}`);
  const flags = (o.flags || []).filter((f) => !/^Скидки —/.test(f.text));
  if ((o.flags || []).some((f) => /^Скидки —/.test(f.text))) L.push('🟡 Доля скидок выше порога — проверьте реестр');
  flags.slice(0, 4).forEach((f) => L.push(`${f.level === 'bad' ? '🔴' : '🟡'} ${label(f.text, 200)}`));
  if (!(o.flags || []).length) L.push('✅ Отклонений не найдено');
  const footer = link ? `<a href="${esc(link)}">📋 Полный отчёт и реестр скидок →</a>` : '';
  // Telegram ограничивает длину сообщения. Дополнительные советы имеют меньший приоритет.
  const main = L.join('\n');
  return [main, extra && main.length + extra.length + footer.length < 3900 ? extra : '', footer].filter(Boolean).join('\n\n');
}
function discountRegistryText(o, link) {
  if (!o.discount_details?.length) return [];
  const header = `<b>🏷 РЕЕСТР СКИДОК · ${esc(dayRu(o.day))}</b>\n${label((o.depts || []).join(', '), 150)}\nВремя указано по закрытию чека.`;
  const footer = link ? `\n\n<a href="${esc(link)}">Полный отчёт →</a>` : '';
  const messages = [];
  let lines = [];
  let length = 0;
  for (const x of o.discount_details) {
    const receipt = x.receipt ? 'чек №' + label(x.receipt, 30) : x.order_id ? 'заказ ' + label(x.order_id, 40) : 'номер не указан';
    const entry = [
      `<b>${money(x.sum)}</b> · ${label(x.type, 80)}`,
      `${closedLabel(x.closed)} · ${receipt}${x.table ? ' · стол ' + label(x.table, 20) : ''}`,
      `Гость: ${x.guest ? label(x.guest, 80) : 'не указан'}`,
      `Сотрудник: ${label(x.waiter, 80)}`,
      x.authorized_by ? `Авторизация: ${label(x.authorized_by, 80)}` : ''
    ].filter(Boolean).join('\n');
    if (lines.length && length + entry.length > 3000) {
      messages.push(lines.join('\n\n'));
      lines = []; length = 0;
    }
    lines.push(entry);
    length += entry.length + 2;
  }
  if (lines.length) messages.push(lines.join('\n\n'));
  return messages.map((message, i) => `${header}\nЧасть ${i + 1} из ${messages.length}\n\n${message}${footer}`);
}
async function tgSend(chatId, text) {
  const tok = process.env.TG_BOT_TOKEN;
  if (!tok || !chatId) return false;
  const r = await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }), signal: AbortSignal.timeout(15000) });
  return r.ok;
}
module.exports = { reportText, discountRegistryText, tgSend, money };
