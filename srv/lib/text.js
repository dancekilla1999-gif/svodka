// Короткое сообщение в Telegram по отчёту: выжимка, без списка чеков.
function money(n) { return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(n || 0)) + ' ₽'; }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function pct1(n) { return (Math.round(Number(n) * 10) / 10).toFixed(1).replace('.', ',') + '%'; }
function delta(a, b) { if (!b) return ''; const d = (a / b - 1) * 100; return ` (${d >= 0 ? '+' : ''}${pct1(d)} к прошлой неделе)`; }
function dayRu(iso) { const d = new Date(iso + 'T12:00:00Z'); return d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' }); }
function sum(rows, field = 'sum') { return (rows || []).reduce((s, x) => s + Number(x[field] || 0), 0); }
function percent(a, b) { return b > 0 ? ` · ${pct1(a / b * 100)}` : ''; }
function plural(n, one, few, many) {
  const num = Math.abs(Number(n)) || 0;
  const n100 = num % 100, n10 = num % 10;
  if (n100 >= 11 && n100 <= 14) return many;
  if (n10 === 1) return one;
  if (n10 >= 2 && n10 <= 4) return few;
  return many;
}
function cheques(n) { return `${n} ${plural(n, 'чек', 'чека', 'чеков')}`; }
function label(value, max = 80) { return esc(String(value || '').slice(0, max)); }
function closedLabel(value) {
  if (!value) return 'время не указано';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}:\d{2})/);
  return match ? `${match[3]}.${match[2]} ${match[4]}` : label(value, 40);
}

function discountTypes(o) {
  if (o.discount_by_type?.length) return o.discount_by_type;
  const map = new Map();
  for (const x of o.discount_details || []) {
    const type = x.type || 'Тип не указан — проверить';
    const e = map.get(type) || { type, sum: 0, count: 0 };
    e.sum += Number(x.sum || 0);
    e.count += 1;
    map.set(type, e);
  }
  if (map.size) return [...map.values()].sort((a, b) => b.sum - a.sum);
  const byType = new Map();
  for (const x of o.discounts || []) {
    const type = x.type || 'Тип не указан — проверить';
    const e = byType.get(type) || { type, sum: 0, count: 0 };
    e.sum += Number(x.sum || 0);
    e.count += 1;
    byType.set(type, e);
  }
  return [...byType.values()].sort((a, b) => b.sum - a.sum);
}

const FOUNDERS = 'Учредительские столы';
function num0(n) { return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(n || 0)).replace(/\s/g, ' '); }
function cell(value, width, right) {
  let s = String(value ?? '');
  if (s.length > width) s = s.slice(0, width - 1) + '…';
  return right ? s.padStart(width) : s.padEnd(width);
}
function tableRow(name, table, count, total) {
  return `${cell(name, 18)} ${cell(table, 4, true)} ${cell(count, 3, true)} ${cell(total, 8, true)}`;
}

// Блок «Списания / За счёт заведения»: таблица по типам оплаты (название, стол, чеков, сумма) с итогом.
// Учредительские столы — отдельной группой с подытогом. В кассу, скидки и выручку эти суммы не входят.
function writeOffLines(o, max = Infinity) {
  const rows = o.non_fiscal || [];
  const L = ['<b>🧾 Списания / За счёт заведения</b>', '<i>Не в кассе, не в скидках, не в выручке</i>'];
  if (!rows.length) { L.push('Нет'); return L; }
  const founders = rows.filter((x) => x.category === FOUNDERS);
  const others = rows.filter((x) => x.category !== FOUNDERS);
  const count = (list) => list.reduce((s, x) => s + Number(x.count || 0), 0);
  if (max <= 0) { L.push(`Итого: ${money(sum(rows))} · ${cheques(count(rows))} <i>(по типам — в кабинете)</i>`); return L; }
  const T = [tableRow('Тип оплаты', 'Стол', 'Чек', 'Сумма ₽')];
  const line = (x) => T.push(tableRow(x.type || '—', x.table || '—', x.count || '—', num0(x.sum)));
  let left = max;
  const some = (list) => {
    const shown = list.slice(0, Math.max(0, left)); left -= shown.length;
    shown.forEach(line);
    const rest = list.slice(shown.length);
    if (rest.length) T.push(tableRow(`Ещё ${rest.length}`, '', count(rest), num0(sum(rest))));
  };
  if (founders.length) {
    T.push('— Учредительские столы —');
    some(founders);
    T.push(tableRow('Итого учредит.', '', count(founders), num0(sum(founders))));
  }
  if (others.length) {
    if (founders.length) T.push('— Прочие за счёт заведения —');
    some(others);
  }
  T.push(tableRow('ИТОГО', '', count(rows), num0(sum(rows))));
  L.push(`<pre>${esc(T.join('\n'))}</pre>`);
  return L;
}

// Блок «По этажам»: каждый этаж отдельно (выручка, чеки, гости, средний чек, себестоимость, валовая прибыль, скидки).
// Этажи в сумме дают общий итог выше. Старые отчёты без by_floor — только выручка по этажам из revenue_breakdown.
// compact: одна строка на этаж (когда сообщение не помещается в лимит Telegram).
function floorName(floor) { return floor === 'unknown' ? 'Этаж не указан' : `${floor} этаж`; }
function floorSort(a, b) { return a === 'unknown' ? 1 : b === 'unknown' ? -1 : Number(a) - Number(b); }
// доли с одним знаком после запятой, в сумме ровно 100,0% (наибольший остаток)
function shareList(values) {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  if (!total) return values.map(() => null);
  const raw = values.map((v) => Math.max(0, v) * 1000 / total);
  const out = raw.map(Math.floor);
  let rest = 1000 - out.reduce((s, v) => s + v, 0);
  raw.map((v, i) => [v - Math.floor(v), i]).sort((x, y) => y[0] - x[0] || x[1] - y[1]).forEach(([, i]) => { if (rest > 0) { out[i] += 1; rest -= 1; } });
  return out.map((x) => x / 10);
}
function shareText(x) { return x == null ? '' : ` · ${(x).toFixed(1).replace('.', ',')}%`; }
function typeList(list, max, maxLen = 30) {
  return (list || []).slice(0, max).map((d) => `${label(d.type, maxLen)} ${money(d.sum)}${d.count ? ` · ${cheques(d.count)}` : ''}`);
}
function floorLines(o, opt = {}) {
  if (o.by_floor && o.by_floor.length) {
    const sh = shareList(o.by_floor.map((x) => Number(x.revenue) || 0));
    const L = ['', '<b>🏢 По этажам</b>'];
    o.by_floor.forEach((x, i) => {
      const disc = x.discount == null ? 'данные недоступны' : x.discount ? money(x.discount) : 'нет';
      const sur = x.surcharge > 0 ? `  ·  Надбавки: ${money(x.surcharge)}` : '';
      if (opt.compact) {
        const gp = x.gross_profit != null ? ` · ВП ${money(x.gross_profit)}` : '';
        L.push(`<b>${floorName(x.floor)}</b>: ${money(x.revenue)}${shareText(sh[i])} · ${cheques(x.orders)} · ср. ${money(x.avg_check)}${gp} · скидки ${disc}`);
        return;
      }
      L.push('', `<b>${floorName(x.floor)}</b> — выручка <b>${money(x.revenue)}</b>${shareText(sh[i])}`);
      L.push(`Чеков: ${x.orders}  ·  Гостей: ${x.guests}`);
      L.push(`Средний чек: ${money(x.avg_check)}  ·  На гостя: ${money(x.avg_guest)}`);
      if (x.cost != null) L.push(`Себестоимость: ${money(x.cost)}${percent(x.cost, x.revenue)}  ·  Валовая прибыль: ${money(x.gross_profit)}`);
      const types = x.discount ? typeList(x.discount_by_type, opt.floorTypes ?? 4) : [];
      L.push(`Скидки: ${disc}${types.length ? ` (${types.join('; ')})` : ''}${sur}`);
    });
    return L;
  }
  const rb = o.revenue_breakdown || [];
  if (!rb.some((x) => x.floor && x.floor !== 'unknown')) return [];
  const keys = [...new Set(['1', '2', ...rb.map((x) => x.floor)])].sort(floorSort);
  const floors = keys.map((floor) => ({ floor, sum: sum(rb.filter((x) => x.floor === floor)) }))
    .filter((x) => x.floor === '1' || x.floor === '2' || x.sum);
  const sh = shareList(floors.map((x) => x.sum));
  return ['', '<b>🏢 Выручка по этажам</b>', ...floors.map((x, i) => `• ${floorName(x.floor)}: ${money(x.sum)}${shareText(sh[i])}`)];
}

// Ступени сжатия: Telegram не принимает сообщения длиннее 4096 символов (дайджест тогда молча не уходил).
const TG_LIMIT = 4096, SOFT_LIMIT = 3900;
const LEVELS = [
  { types: 8, floorTypes: 4, promo: 50, writeOffs: 50, flags: 4 },
  { types: 5, floorTypes: 2, promo: 8, writeOffs: 12, flags: 4 },
  { types: 5, compact: true, promo: 5, writeOffs: 8, flags: 3 },
  { types: 3, compact: true, promo: 3, writeOffs: 5, flags: 2 },
  { types: 0, compact: true, promo: 0, writeOffs: 0, flags: 1 }
];

function mainLines(o, opt) {
  const t = o.totals || {}, p = o.prev || {}, m = o.profit || {};
  const L = [`<b>📊 Итоги смены · ${esc(dayRu(o.day))}</b>${o.demo ? ' · <i>демо</i>' : ''}`];
  if (o.depts?.length) L.push(label(o.depts.join(', '), 150));
  if (o.partial) L.push('<i>Смена ещё идёт — цифры на текущий момент</i>');

  const floors = floorLines(o, opt);
  L.push('');
  if (floors.length) L.push('<b>Всего по заведению</b>');
  L.push(`Выручка: <b>${money(t.revenue)}</b>${p.revenue ? delta(t.revenue, p.revenue) : ''}`);
  const guestNote = t.guests_include_non_fiscal ? ' <i>(включая нефискальные)</i>' : '';
  L.push(`Чеков: ${t.orders}  ·  Гостей: ${t.guests}${guestNote}`);
  L.push(`Средний чек: ${money(t.avg_check)}  ·  На гостя: ${money(t.avg_guest)}${guestNote}`);
  if (m.cost != null) L.push(`Себестоимость: ${money(m.cost)}${percent(m.cost, t.revenue)}`);
  if (m.has_expenses && m.profit != null) {
    L.push(`Расходы смены: ${money(m.expenses)}`);
    L.push(`Прибыль: <b>${money(m.profit)}</b>`);
  } else if (m.gross != null) {
    L.push(`Валовая прибыль: <b>${money(m.gross)}</b>`);
    L.push('<i>Чистая прибыль: внесите расходы в кабинете</i>');
  }

  L.push(...floors);

  const base = t.discount_base ?? t.gross;
  L.push('', '<b>🏷 Скидки</b> <i>(только фискальные чеки)</i>');
  L.push(t.discount == null ? 'Данные недоступны' : `Всего: <b>${money(t.discount)}</b>${percent(t.discount, base)}${percent(t.discount, base) ? ' от суммы до скидок' : ''}`);
  const types = discountTypes(o);
  types.slice(0, opt.types).forEach((x) => {
    const n = x.count ? ` · ${cheques(x.count)}` : '';
    L.push(`• ${label(x.type, 40)}: ${money(x.sum)}${n}`);
  });
  if (types.length > opt.types) L.push(`• ${opt.types ? 'Остальные типы' : 'По типам — в кабинете'}: ${money(sum(types.slice(opt.types)))}`);
  else if (!types.length && t.discount > 0) L.push('iiko не вернул разбивку по типам скидок');
  if (t.surcharge > 0) {
    const st = typeList(o.surcharge_by_type, Math.min(3, opt.types), 40);
    L.push(`Надбавки <i>(в выручке, не скидки)</i>: ${money(t.surcharge)}${st.length ? ` (${st.join('; ')})` : ''}`);
  }

  L.push('', ...writeOffLines(o, opt.writeOffs));

  if (o.unprinted && (o.unprinted.sum || o.unprinted.count)) {
    const n = o.unprinted.count || 0;
    L.push('', `Без фискального чека, не из списка: ${money(o.unprinted.sum)} · ${cheques(n)} <i>(в выручке, проверьте тип оплаты)</i>`);
  }

  const promoRows = o.promo_items && o.promo_items.length ? o.promo_items : (o.promo ? [
    o.promo['1'] && { label: '1 этаж', sum: o.promo['1'] },
    o.promo['2'] && { label: '2 этаж', sum: o.promo['2'] },
    o.promo.unknown && { label: 'Этаж не указан', sum: o.promo.unknown }
  ].filter(Boolean) : []);
  if (promoRows.length || o.promo_total) {
    const promoSum = o.promo_total != null ? o.promo_total : sum(promoRows);
    L.push('', `Промо без оплаты <i>(в выручке)</i>: <b>${money(promoSum)}</b>`);
    promoRows.slice(0, opt.promo).forEach((x) => {
      const n = x.count ? ` · ${x.count}` : '';
      L.push(`• ${label(x.label || x.type, 60)}: ${money(x.sum)}${n}`);
    });
    if (promoRows.length > opt.promo) L.push(`• Ещё ${promoRows.length - opt.promo} — в кабинете: ${money(sum(promoRows.slice(opt.promo)))}`);
  }

  L.push('', `Удаления: ${money(t.deleted_sum)}${percent(t.deleted_sum, t.revenue)}`);
  const flags = (o.flags || []).filter((f) => !/^Скидки —/.test(f.text));
  if ((o.flags || []).some((f) => /^Скидки —/.test(f.text))) L.push('🟡 Доля скидок выше порога — подробности в кабинете');
  flags.slice(0, opt.flags).forEach((f) => L.push(`${f.level === 'bad' ? '🔴' : '🟡'} ${label(f.text, 200)}`));
  if (!(o.flags || []).length) L.push('✅ Отклонений не найдено');
  return L;
}

// Сообщение всегда не длиннее 4096: сначала сокращаем детали (типы скидок, этажи до одной строки, промо, списания),
// в крайнем случае отрезаем хвост целыми блоками (HTML-теги не рвутся) и пишем, что полный отчёт в кабинете.
function reportText(o, link, extra = '') {
  const footer = link ? `<a href="${esc(link)}">📋 Полный отчёт в кабинете →</a>` : '';
  const room = SOFT_LIMIT - footer.length - (footer ? 2 : 0);
  let L = null;
  for (const opt of LEVELS) {
    L = mainLines(o, opt);
    if (L.join('\n').length <= room) break;
  }
  let main = L.join('\n');
  if (main.length > room) {
    const cut = '<i>… сообщение сокращено, полный отчёт — в кабинете</i>';
    while (L.length > 1 && L.join('\n').length + cut.length + 1 > room) L.pop();
    main = [...L, cut].join('\n');
  }
  const text = [main, extra && main.length + extra.length + footer.length + 4 <= SOFT_LIMIT ? extra : '', footer].filter(Boolean).join('\n\n');
  return text.length <= TG_LIMIT ? text : text.slice(0, TG_LIMIT);
}

// Реестр по чекам больше не уходит в Telegram (только кабинет). Функция оставлена
// на случай ручной выгрузки и для тестов совместимости.
function discountRegistryText(o, link) {
  if (!o.discount_details?.length) return [];
  const header = `<b>🏷 РЕЕСТР СКИДОК · ${esc(dayRu(o.day))}</b>\n${label((o.depts || []).join(', '), 150)}\nВремя указано по закрытию чека.`;
  const footer = link ? `\n\n<a href="${esc(link)}">Полный отчёт в кабинете →</a>` : '';
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
module.exports = { reportText, writeOffLines, discountRegistryText, tgSend, money, discountTypes, percent, pct1, plural };
