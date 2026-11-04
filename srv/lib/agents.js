// Команда агентов «Сводки». Каждый агент — чистая функция: данные → вывод {agent, pkey, level, title, data, items, text}.
// Цифры всегда считает код. ИИ (YandexGPT) только пишет пояснения и советы поверх готовых цифр — см. director() и answer().
const ai = require('./ai');

const AGENTS = {
  shift: { name: 'Смена', role: 'Разбирает каждую смену: выручка, себестоимость, прибыль, подозрительные удаления и скидки' },
  purchases: { name: 'Закупки', role: 'Следит за накладными: что подорожало, у кого, во сколько это обходится' },
  finance: { name: 'Финансы', role: 'Неделя целиком: доходы, расходы, прибыль, фудкост, ФОТ, прогноз на месяц' },
  staff: { name: 'Персонал', role: 'Официанты и загрузка зала: кого похвалить, с кем поговорить, где лишние или нехватка людей' },
  menu: { name: 'Меню', role: 'Блюда по продажам и марже: звёзды, «рабочие лошадки», что продвигать и что убрать' },
  director: { name: 'Управляющий', role: 'Собирает выводы всех агентов в план действий и отвечает на вопросы' }
};
const CAT = { rent: 'Аренда', staff: 'Зарплаты (ФОТ)', utilities: 'Коммунальные', marketing: 'Маркетинг', taxes: 'Налоги', bank: 'Эквайринг и банк', other: 'Прочее' };
const DEF = { food_cost_target: 0.32, labor_target: 0.28, price_alert: 0.05, weekly_tg: true, daily_tips: true, purchases: true };
function prefsOf(p) { return Object.assign({}, DEF, p || {}); }

function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function money(n) { return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0)) + ' ₽'; }
function pct(x) { return Math.round((Number(x) || 0) * 100) + '%'; }
function pct1(x) { return (Math.round((Number(x) || 0) * 1000) / 10).toString().replace('.', ',') + '%'; }
function isoAdd(day, n) { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function dow(day) { return new Date(day + 'T12:00:00Z').getUTCDay(); }
function dayRu(iso) { return new Date(iso + 'T12:00:00Z').toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }); }
function weekOf(day) { const d = dow(day); const mon = isoAdd(day, d === 0 ? -6 : 1 - d); return { from: mon, to: isoAdd(mon, 6), key: 'w' + mon }; }
function levelOf(items) { return items.some((i) => i.level === 'bad') ? 'bad' : items.some((i) => i.level === 'warn') ? 'warn' : 'ok'; }
function daysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000) + 1; }

// Расходы владельца на период [from..to] (включительно) при выручке revenue
function expensesFor(list, from, to, revenue) {
  const n = daysBetween(from, to);
  const by = [];
  let fixed = 0, percent = 0;
  (list || []).forEach((e) => {
    if (e.active === false) return;
    const a = Number(e.amount) || 0;
    let s = 0;
    if (e.kind === 'month') s = a * 12 / 365 * n;
    else if (e.kind === 'week') s = a / 7 * n;
    else if (e.kind === 'once') s = e.day && e.day >= from && e.day <= to ? a : 0;
    else if (e.kind === 'percent') s = (Number(revenue) || 0) * a / 100;
    if (!s) return;
    if (e.kind === 'percent') percent += s; else fixed += s;
    by.push({ name: e.name, category: e.category || 'other', kind: e.kind, sum: r2(s) });
  });
  const byCat = {};
  by.forEach((x) => { byCat[x.category] = r2((byCat[x.category] || 0) + x.sum); });
  return { total: r2(fixed + percent), fixed: r2(fixed), percent: r2(percent), by: by.sort((a, b) => b.sum - a.sum), byCat, labor: byCat.staff || 0 };
}

// ------------------------------------------------------------------ Смена
function profitOf(report, expenses, prefs) {
  const t = report.totals || {}, day = report.day;
  const rev = Number(t.revenue) || 0;
  const hasCost = t.cost != null && t.cost > 0;
  const exp = expensesFor(expenses, day, day, rev);
  const gross = hasCost ? rev - t.cost : null;
  const profit = hasCost ? gross - exp.total : null;
  return { revenue: r2(rev), cost: hasCost ? r2(t.cost) : null, food_cost: hasCost && rev ? r2(t.cost / rev) : null, gross: gross == null ? null : r2(gross),
    expenses: exp.total, labor: exp.labor, labor_share: rev ? r2(exp.labor / rev) : null, profit: profit == null ? null : r2(profit),
    margin: profit != null && rev ? r2(profit / rev) : null, has_expenses: (expenses || []).length > 0 };
}
function shift(report, expenses, prefsIn) {
  const p = prefsOf(prefsIn), m = profitOf(report, expenses, p), items = [];
  (report.flags || []).forEach((f) => items.push({ level: f.level, text: f.text }));
  if (m.food_cost != null && m.food_cost > p.food_cost_target + 0.03) items.push({ level: m.food_cost > p.food_cost_target + 0.08 ? 'bad' : 'warn', text: `Фудкост смены ${pct1(m.food_cost)} при цели ${pct(p.food_cost_target)} — себестоимость съела ${money(m.cost)}` });
  if (m.profit != null && m.has_expenses && m.profit < 0 && !report.partial && m.revenue > 0) items.push({ level: 'warn', text: `Смена в минусе на ${money(-m.profit)} с учётом ежедневной доли расходов` });
  if (m.cost == null && report.totals && report.totals.revenue > 0 && !report.demo) items.push({ level: 'warn', text: 'iiko не отдал себестоимость — прибыль не посчитать. Проверьте техкарты и право на отчёт с себестоимостью' });
  const title = `${dayRu(report.day)}: выручка ${money(m.revenue)}` + (m.profit != null && m.has_expenses ? `, прибыль ≈ ${money(m.profit)}` : m.gross != null ? `, валовая прибыль ${money(m.gross)}` : '');
  const lines = [title];
  if (m.food_cost != null) lines.push(`Себестоимость ${money(m.cost)} (фудкост ${pct1(m.food_cost)}).`);
  if (m.has_expenses) lines.push(`Доля постоянных и процентных расходов за день — ${money(m.expenses)}.`);
  if (!items.length) lines.push('Отклонений нет.');
  return { agent: 'shift', pkey: report.day, level: levelOf(items), title, data: { day: report.day, metrics: m, items, demo: !!report.demo }, items, text: lines.join(' ') };
}

// ------------------------------------------------------------------ Закупки
function purchases(day, changes, prefsIn, totalSum) {
  const p = prefsOf(prefsIn), items = [], rows = [];
  let impact = 0, up = 0, down = 0, fresh = 0;
  (changes || []).forEach((c) => {
    const price = Number(c.price) || 0, prev = c.prev_price == null ? null : Number(c.prev_price);
    const d = prev ? price / prev - 1 : null;
    const imp = prev ? (price - prev) * (Number(c.qty) || 0) : 0;
    rows.push({ name: c.name, unit: c.unit, supplier: c.supplier, qty: r2(c.qty), sum: r2(c.sum), price: r2(price), prev_price: prev == null ? null : r2(prev), prev_day: c.prev_day, prev_supplier: c.prev_supplier, change: d == null ? null : Math.round(d * 1000) / 1000, impact: r2(imp) });
    if (prev == null) { fresh++; return; }
    if (d >= p.price_alert) { up++; impact += imp; items.push({ level: d >= p.price_alert * 2 ? 'bad' : 'warn', text: `${c.name}: ${money(prev)} → ${money(price)}${c.unit ? '/' + c.unit : ''} (+${pct1(d)})${c.supplier ? ' · ' + c.supplier : ''}${c.prev_supplier && c.prev_supplier !== c.supplier ? ' (раньше брали у ' + c.prev_supplier + ')' : ''}. Переплата в этой поставке ${money(imp)}` }); }
    else if (d <= -p.price_alert) { down++; impact += imp; items.push({ level: 'ok', text: `${c.name} подешевел: ${money(prev)} → ${money(price)} (${pct1(d)})${c.supplier ? ' · ' + c.supplier : ''}` }); }
  });
  rows.sort((a, b) => (b.change || 0) - (a.change || 0));
  const sum = totalSum != null ? totalSum : rows.reduce((s, r) => s + r.sum, 0);
  const title = `Закупки ${dayRu(day)}: ${money(sum)}` + (up ? `, подорожало позиций: ${up}` : ', без подорожаний');
  const text = [title + '.', up ? `Переплата к прошлым ценам ≈ ${money(Math.max(0, impact))}. Сравните цены у других поставщиков или пересмотрите цену блюд с этими продуктами.` : '', fresh ? `Новых позиций в учёте: ${fresh}.` : ''].filter(Boolean).join(' ');
  return { agent: 'purchases', pkey: day, level: levelOf(items), title, data: { day, sum: r2(sum), up, down, fresh, impact: r2(impact), rows: rows.slice(0, 120) }, items, text };
}

// Закупки за неделю: последняя цена недели против последней цены до неё
function purchasesWeek(week, ctx, prefsIn) {
  const p = prefsOf(prefsIn), by = {};
  (ctx.prices || []).forEach((x) => { (by[x.product_id] = by[x.product_id] || []).push(x); });
  const changes = [];
  let sum = 0;
  Object.values(by).forEach((list) => {
    list.sort((a, b) => (a.day < b.day ? -1 : 1));
    const inW = list.filter((x) => x.day >= week.from && x.day <= week.to), before = list.filter((x) => x.day < week.from);
    inW.forEach((x) => { sum += Number(x.sum) || 0; });
    if (!inW.length) return;
    const last = inW[inW.length - 1], prev = before.length ? before[before.length - 1] : (inW.length > 1 ? inW[0] : null);
    const qty = inW.reduce((s, x) => s + (Number(x.qty) || 0), 0);
    changes.push({ product_id: last.product_id, name: last.name, unit: last.unit, supplier: last.supplier, qty, sum: inW.reduce((s, x) => s + (Number(x.sum) || 0), 0), price: last.price,
      prev_price: prev && prev !== last ? prev.price : null, prev_day: prev && prev !== last ? prev.day : null, prev_supplier: prev && prev !== last ? prev.supplier : null });
  });
  const r = purchases(week.to, changes, p, sum);
  r.pkey = week.key; r.title = r.title.replace(/^Закупки [^:]+:/, `Закупки за неделю ${dayRu(week.from)} – ${dayRu(week.to)}:`);
  r.text = r.text.replace(/^Закупки [^:]+:/, 'Закупки за неделю:').replace('в этой поставке', 'за неделю');
  r.items.forEach((i) => { i.text = i.text.replace('в этой поставке', 'за неделю'); });
  r.data.week = week;
  return r;
}

// ------------------------------------------------------------------ сводные данные по дням
function aggregate(reports) {
  const s = { days: 0, revenue: 0, cost: 0, cost_days: 0, orders: 0, guests: 0, discount: 0, deleted: 0, gross: 0, by_day: [] };
  (reports || []).forEach((r) => {
    const t = (r.data && r.data.totals) || {};
    if (!t.revenue && !t.orders) return;
    s.days++; s.revenue += t.revenue || 0; s.orders += t.orders || 0; s.guests += t.guests || 0; s.discount += t.discount || 0; s.deleted += t.deleted_sum || 0; s.gross += t.gross || 0;
    if (t.cost != null && t.cost > 0) { s.cost += t.cost; s.cost_days++; }
    s.by_day.push({ day: r.day, revenue: r2(t.revenue), orders: t.orders || 0, avg_check: r2(t.avg_check), cost: t.cost == null ? null : r2(t.cost) });
  });
  s.avg_check = s.orders ? r2(s.revenue / s.orders) : 0;
  ['revenue', 'cost', 'discount', 'deleted', 'gross'].forEach((k) => { s[k] = r2(s[k]); });
  return s;
}
function inRange(reports, from, to) { return (reports || []).filter((r) => r.day >= from && r.day <= to); }

// ------------------------------------------------------------------ Финансы (неделя)
function finance(week, ctx, prefsIn) {
  const p = prefsOf(prefsIn), items = [];
  const cur = aggregate(inRange(ctx.reports, week.from, week.to));
  const pw = { from: isoAdd(week.from, -7), to: isoAdd(week.to, -7) };
  const prev = aggregate(inRange(ctx.reports, pw.from, pw.to));
  const exp = expensesFor(ctx.expenses, week.from, week.to, cur.revenue);
  const costKnown = cur.cost_days > 0 && cur.cost_days >= cur.days - 1;
  const gross = costKnown ? cur.revenue - cur.cost : null;
  const profit = gross == null ? null : gross - exp.total;
  const purch = (ctx.prices || []).filter((x) => x.day >= week.from && x.day <= week.to).reduce((s, x) => s + Number(x.sum || 0), 0);
  const prevExp = expensesFor(ctx.expenses, pw.from, pw.to, prev.revenue);
  const prevProfit = prev.cost_days ? prev.revenue - prev.cost - prevExp.total : null;
  const food = costKnown && cur.revenue ? cur.cost / cur.revenue : null;
  const labor = cur.revenue ? exp.labor / cur.revenue : null;
  // месяц: факт с 1-го числа + прогноз по среднему за прошедшие дни
  const monthStart = week.to.slice(0, 8) + '01';
  const mt = (ctx.month || []).filter((x) => x.day >= monthStart && x.day <= week.to);
  const mRev = mt.reduce((s, x) => s + (Number(x.revenue) || 0), 0);
  const dim = new Date(Date.UTC(+week.to.slice(0, 4), +week.to.slice(5, 7), 0)).getUTCDate();
  const passed = daysBetween(monthStart, week.to);
  const mForecast = passed ? mRev / passed * dim : 0;

  if (cur.days === 0) items.push({ level: 'warn', text: 'За неделю нет отчётов — проверьте подключение iiko' });
  if (prev.revenue && cur.revenue) {
    const d = cur.revenue / prev.revenue - 1;
    if (d <= -0.1) items.push({ level: d <= -0.2 ? 'bad' : 'warn', text: `Выручка недели ${money(cur.revenue)} — на ${pct(-d)} ниже прошлой (${money(prev.revenue)})` });
    else if (d >= 0.1) items.push({ level: 'ok', text: `Выручка выросла на ${pct(d)} к прошлой неделе` });
  }
  if (food != null && food > p.food_cost_target + 0.02) items.push({ level: food > p.food_cost_target + 0.06 ? 'bad' : 'warn', text: `Фудкост недели ${pct1(food)} при цели ${pct(p.food_cost_target)}: это ${money(cur.cost - cur.revenue * p.food_cost_target)} лишней себестоимости` });
  if (labor != null && exp.labor && labor > p.labor_target) items.push({ level: labor > p.labor_target + 0.07 ? 'bad' : 'warn', text: `ФОТ ${pct1(labor)} от выручки при цели ${pct(p.labor_target)} — пересмотрите график в слабые часы (см. агента «Персонал»)` });
  if (profit != null && exp.total) {
    if (profit < 0) items.push({ level: 'bad', text: `Неделя в минусе: ${money(profit)} после всех расходов` });
    else if (cur.revenue && profit / cur.revenue < 0.08) items.push({ level: 'warn', text: `Маржа всего ${pct1(profit / cur.revenue)} — запас прочности маленький` });
  }
  if (costKnown && purch > cur.cost * 1.35 && purch - cur.cost > 20000) items.push({ level: 'warn', text: `Закуплено на ${money(purch)}, а продано по себестоимости на ${money(cur.cost)} — проверьте остатки, списания и не затоварились ли` });
  if (!exp.total) items.push({ level: 'warn', text: 'Не внесены расходы (аренда, зарплаты, коммуналка) — без них прибыль считается только валовая. Добавьте их в разделе «Расходы»' });
  if (cur.by_day.length >= 5) {
    const best = cur.by_day.slice().sort((a, b) => b.revenue - a.revenue)[0], worst = cur.by_day.slice().sort((a, b) => a.revenue - b.revenue)[0];
    items.push({ level: 'ok', text: `Лучший день — ${dayRu(best.day)} (${money(best.revenue)}), слабый — ${dayRu(worst.day)} (${money(worst.revenue)})` });
  }
  const pnl = { revenue: cur.revenue, cost: costKnown ? cur.cost : null, gross: gross == null ? null : r2(gross), food_cost: food == null ? null : r2(food),
    expenses: exp, labor_share: labor == null ? null : r2(labor), profit: profit == null ? null : r2(profit), margin: profit != null && cur.revenue ? r2(profit / cur.revenue) : null,
    purchases: r2(purch), orders: cur.orders, guests: cur.guests, avg_check: cur.avg_check, discount: cur.discount, deleted: cur.deleted, days: cur.days, by_day: cur.by_day };
  const prevPnl = { revenue: prev.revenue, profit: prevProfit == null ? null : r2(prevProfit), orders: prev.orders, avg_check: prev.avg_check, food_cost: prev.cost_days && prev.revenue ? r2(prev.cost / prev.revenue) : null };
  const title = `Неделя ${dayRu(week.from)} – ${dayRu(week.to)}: выручка ${money(cur.revenue)}` + (profit != null && exp.total ? `, прибыль ${money(profit)}` : gross != null ? `, валовая ${money(gross)}` : '');
  const text = [title + '.', food != null ? `Фудкост ${pct1(food)}.` : '', exp.total ? `Расходы ${money(exp.total)}${exp.labor ? ', из них ФОТ ' + money(exp.labor) : ''}.` : '', purch ? `Закупки ${money(purch)}.` : '',
    mRev ? `С начала месяца ${money(mRev)}, прогноз на месяц ≈ ${money(mForecast)}.` : ''].filter(Boolean).join(' ');
  return { agent: 'finance', pkey: week.key, level: levelOf(items), title, data: { week, pnl, prev: prevPnl, month: { from: monthStart, revenue: r2(mRev), forecast: r2(mForecast), days: passed, dim } }, items, text };
}

// ------------------------------------------------------------------ Персонал (неделя)
function staff(week, ctx) {
  const reps = inRange(ctx.reports, week.from, week.to), items = [];
  const W = {}, hours = {};
  let teamRev = 0, teamOrd = 0, teamGross = 0, teamDisc = 0;
  reps.forEach((r) => {
    const o = r.data || {};
    (o.waiters || []).forEach((w) => {
      if (!w.revenue && !w.orders) return;
      const x = W[w.name] || (W[w.name] = { name: w.name, shifts: 0, revenue: 0, orders: 0, guests: 0, discount: 0, deleted: 0, deleted_no_wo: 0 });
      x.shifts++; x.revenue += w.revenue || 0; x.orders += w.orders || 0; x.guests += w.guests || 0; x.discount += w.discount || 0;
      teamRev += w.revenue || 0; teamOrd += w.orders || 0; teamDisc += w.discount || 0; teamGross += (w.revenue || 0) + (w.discount || 0);
    });
    (o.deletions || []).forEach((d) => {
      const x = W[d.waiter] || (W[d.waiter] = { name: d.waiter, shifts: 0, revenue: 0, orders: 0, guests: 0, discount: 0, deleted: 0, deleted_no_wo: 0 });
      x.deleted += d.sum || 0; if (/WITHOUT/i.test(d.type)) x.deleted_no_wo += d.sum || 0;
    });
    (o.hours || []).forEach((h) => { const y = hours[h.hour] || (hours[h.hour] = { hour: h.hour, revenue: 0, orders: 0, days: 0 }); y.revenue += h.revenue || 0; y.orders += h.orders || 0; y.days++; });
  });
  const teamAvg = teamOrd ? teamRev / teamOrd : 0, teamShare = teamGross ? teamDisc / teamGross : 0;
  const list = Object.values(W).filter((x) => x.name && x.name !== '—').map((x) => Object.assign(x, {
    revenue: r2(x.revenue), discount: r2(x.discount), deleted: r2(x.deleted), deleted_no_wo: r2(x.deleted_no_wo),
    avg_check: x.orders ? r2(x.revenue / x.orders) : 0, per_shift: x.shifts ? r2(x.revenue / x.shifts) : 0,
    discount_share: x.revenue + x.discount ? r2(x.discount / (x.revenue + x.discount)) : 0
  })).sort((a, b) => b.per_shift - a.per_shift);
  const praise = [], talk = [];
  list.forEach((x) => {
    if (x.shifts >= 2 && teamAvg && x.avg_check >= teamAvg * 1.12) praise.push(`${x.name} — средний чек ${money(x.avg_check)}, на ${pct(x.avg_check / teamAvg - 1)} выше команды`);
    if (x.shifts >= 2 && teamAvg && x.avg_check <= teamAvg * 0.85) talk.push({ level: 'warn', text: `${x.name}: средний чек ${money(x.avg_check)} — на ${pct(1 - x.avg_check / teamAvg)} ниже команды. Нужна допродажа: тренировка в «Подаче» или разбор с управляющим` });
    if (x.discount >= 2000 && x.discount_share >= Math.max(0.08, teamShare * 2)) talk.push({ level: 'bad', text: `${x.name}: скидки ${pct(x.discount_share)} от чеков (${money(x.discount)}) при среднем по команде ${pct(teamShare)} — проверьте, кому и почему` });
    if (x.deleted_no_wo >= 1500) talk.push({ level: 'bad', text: `${x.name}: удаления без списания на ${money(x.deleted_no_wo)} за неделю — частый признак «отмены после оплаты». Проверьте по камерам и чекам` });
  });
  if (praise.length) items.push({ level: 'ok', text: 'Похвалить: ' + praise.slice(0, 3).join('; ') });
  talk.forEach((t) => items.push(t));
  // загрузка по часам: средняя выручка в час по дням недели
  const H = Object.values(hours).map((h) => ({ hour: h.hour, avg_revenue: r2(h.revenue / Math.max(1, h.days)), avg_orders: r2(h.orders / Math.max(1, h.days)) })).sort((a, b) => a.hour - b.hour);
  if (H.length >= 6) {
    const peak = Math.max.apply(null, H.map((h) => h.avg_revenue));
    const weak = H.filter((h) => h.avg_revenue < peak * 0.22 && h.avg_revenue > 0).map((h) => h.hour);
    const busy = H.filter((h) => h.avg_revenue >= peak * 0.8).map((h) => h.hour);
    if (weak.length >= 2) items.push({ level: 'warn', text: `Слабые часы: ${ranges(weak)} — в среднем меньше ${money(peak * 0.22)} в час. Можно выводить на смену на одного человека меньше или запускать акцию на эти часы` });
    if (busy.length) items.push({ level: 'ok', text: `Пиковые часы: ${ranges(busy)} — в это время в зале должна быть полная смена и все позиции стоп-листа сняты заранее` });
  }
  const title = list.length ? `Персонал: ${list.length} ${plural(list.length, 'сотрудник', 'сотрудника', 'сотрудников')} в отчётах, ${talk.length ? 'есть с кем поговорить' : 'без тревог'}` : 'Персонал: нет данных по официантам';
  return { agent: 'staff', pkey: week.key, level: levelOf(items), title, data: { week, team: { revenue: r2(teamRev), orders: teamOrd, avg_check: r2(teamAvg), discount_share: r2(teamShare) }, staff: list, hours: H }, items, text: [title + '.'].concat(items.map((i) => i.text)).join(' ') };
}
function ranges(hs) {
  const out = []; let s = hs[0], p = hs[0];
  for (let i = 1; i <= hs.length; i++) { if (hs[i] === p + 1) { p = hs[i]; continue; } out.push(s === p ? `${s}:00` : `${s}–${p + 1}:00`); s = p = hs[i]; }
  return out.join(', ');
}
function plural(n, a, b, c) { const m = Math.abs(n) % 100, l = m % 10; return m > 10 && m < 20 ? c : l > 1 && l < 5 ? b : l === 1 ? a : c; }

// ------------------------------------------------------------------ Меню (неделя)
function menu(week, ctx) {
  const reps = inRange(ctx.reports, week.from, week.to), items = [];
  const D = {};
  reps.forEach((r) => {
    const list = (r.data && (r.data.dishes_all || r.data.dishes)) || [];
    list.forEach((d) => {
      const x = D[d.name] || (D[d.name] = { name: d.name, qty: 0, sum: 0, cost: 0, has_cost: true });
      x.qty += d.qty || 0; x.sum += d.sum || 0;
      if (d.cost == null) x.has_cost = false; else x.cost += d.cost;
    });
  });
  const all = Object.values(D).filter((x) => x.qty > 0);
  const withCost = all.filter((x) => x.has_cost && x.cost > 0);
  const totalQty = all.reduce((s, x) => s + x.qty, 0), totalSum = all.reduce((s, x) => s + x.sum, 0);
  let matrix = null;
  if (withCost.length >= 5) {
    const q = withCost.reduce((s, x) => s + x.qty, 0);
    const avgMargin = withCost.reduce((s, x) => s + (x.sum - x.cost), 0) / q;
    const popLine = 0.7 / withCost.length;
    matrix = { star: [], horse: [], puzzle: [], dog: [], avg_margin: r2(avgMargin) };
    withCost.forEach((x) => {
      const unitMargin = (x.sum - x.cost) / x.qty, pop = x.qty / q;
      const row = { name: x.name, qty: r2(x.qty), sum: r2(x.sum), cost: r2(x.cost), unit_margin: r2(unitMargin), food_cost: x.sum ? r2(x.cost / x.sum) : null, share: r2(pop) };
      matrix[pop >= popLine ? (unitMargin >= avgMargin ? 'star' : 'horse') : (unitMargin >= avgMargin ? 'puzzle' : 'dog')].push(row);
    });
    Object.keys(matrix).forEach((k) => { if (Array.isArray(matrix[k])) matrix[k].sort((a, b) => b.sum - a.sum); });
    if (matrix.star.length) items.push({ level: 'ok', text: `Звёзды (продаются и зарабатывают): ${matrix.star.slice(0, 4).map((x) => x.name).join(', ')} — держите в топе меню и в рекомендациях официантов` });
    const pricey = matrix.horse.filter((x) => x.food_cost != null && x.food_cost >= (prefsOf(ctx.prefs).food_cost_target - 0.04));
    const cheap = matrix.horse.filter((x) => pricey.indexOf(x) < 0);
    if (pricey.length) items.push({ level: 'warn', text: `«Рабочие лошадки» с высоким фудкостом: ${pricey.slice(0, 4).map((x) => `${x.name} (${pct(x.food_cost)})`).join(', ')} — их берут часто, поэтому +5–10% к цене или чуть меньше себестоимость порции дадут заметную прибавку` });
    if (cheap.length) items.push({ level: 'ok', text: `Популярные недорогие позиции: ${cheap.slice(0, 4).map((x) => x.name).join(', ')} — наценка хорошая, но чек маленький. Предлагайте их в паре с основными блюдами (допродажа)` });
    if (matrix.puzzle.length) items.push({ level: 'ok', text: `Загадки (выгодные, но берут редко): ${matrix.puzzle.slice(0, 4).map((x) => x.name).join(', ')} — пусть официанты их советуют, переставьте выше в меню` });
    if (matrix.dog.length) items.push({ level: 'warn', text: `Кандидаты на вывод из меню (редко и невыгодно): ${matrix.dog.slice(0, 4).map((x) => x.name).join(', ')}` });
  } else if (all.length) {
    items.push({ level: 'warn', text: 'Нет себестоимости по блюдам — показываю только продажи. Заполните техкарты в iiko, и агент построит матрицу «звёзды / лошадки / загадки / собаки»' });
  }
  const top = all.slice().sort((a, b) => b.sum - a.sum).slice(0, 15).map((x) => ({ name: x.name, qty: r2(x.qty), sum: r2(x.sum), share: totalSum ? r2(x.sum / totalSum) : 0, food_cost: x.has_cost && x.sum ? r2(x.cost / x.sum) : null }));
  const title = all.length ? `Меню: ${all.length} ${plural(all.length, 'позиция', 'позиции', 'позиций')} в продажах` + (matrix ? `, звёзд ${matrix.star.length}, на вывод ${matrix.dog.length}` : '') : 'Меню: нет данных о продажах блюд';
  return { agent: 'menu', pkey: week.key, level: levelOf(items), title, data: { week, top, matrix, total_qty: r2(totalQty), total_sum: r2(totalSum) }, items, text: [title + '.'].concat(items.map((i) => i.text)).join(' ') };
}

// ------------------------------------------------------------------ Управляющий
const DIRECTOR_SYS = 'Ты — опытный управляющий ресторанами и финансовый директор в сервисе «Сводка». Тебе приходят выводы агентов (смена, закупки, финансы, персонал, меню) по одному заведению. ' +
  'Напиши собственнику короткий план: сначала 1–2 предложения «как прошла неделя» с главными цифрами, затем 3–5 конкретных действий на эту неделю — каждое с цифрой-обоснованием и кто делает (собственник, управляющий, шеф, бар). ' +
  'Обращайся на «вы». Не больше 1200 знаков. Без вступлений и прощаний.';
async function director(period, results, opts = {}) {
  const items = [];
  results.filter(Boolean).forEach((r) => (r.items || []).forEach((i) => { if (i.level !== 'ok' || /Похвалить|Звёзды|Лучший/.test(i.text)) items.push({ agent: r.agent, level: i.level, text: i.text }); }));
  const order = { bad: 0, warn: 1, ok: 2 };
  items.sort((a, b) => order[a.level] - order[b.level]);
  const fin = results.find((r) => r && r.agent === 'finance');
  const facts = { период: period.label, финансы: fin ? fin.data.pnl && { выручка: fin.data.pnl.revenue, прибыль: fin.data.pnl.profit, фудкост: fin.data.pnl.food_cost, расходы: fin.data.pnl.expenses && fin.data.pnl.expenses.total, фот_доля: fin.data.pnl.labor_share, закупки: fin.data.pnl.purchases, средний_чек: fin.data.pnl.avg_check } : null,
    прошлая_неделя: fin ? fin.data.prev : null, месяц: fin ? fin.data.month : null, выводы_агентов: items.slice(0, 18).map((i) => `[${AGENTS[i.agent] ? AGENTS[i.agent].name : i.agent}/${i.level}] ${i.text}`) };
  let text = opts.noAi ? null : await ai.write(DIRECTOR_SYS, facts, { maxTokens: 900 });
  const byAi = !!text;
  if (!text) {
    const top = items.filter((i) => i.level !== 'ok').slice(0, 5);
    text = (fin ? fin.title + '.\n\n' : '') + (top.length ? 'Что сделать на этой неделе:\n' + top.map((i, n) => `${n + 1}. ${i.text}`).join('\n') : 'Серьёзных отклонений нет — держим курс.');
  }
  const level = levelOf(items);
  return { agent: 'director', pkey: period.key, level, title: `План на неделю после ${period.label}`, data: { period, actions: items.slice(0, 12), by_ai: byAi }, items: items.slice(0, 12), text };
}

// Короткий совет управляющего к ежедневному отчёту
async function dailyTip(shiftRes, purchRes) {
  const facts = { смена: shiftRes && { заголовок: shiftRes.title, метрики: shiftRes.data.metrics, отклонения: shiftRes.items.map((i) => i.text) }, закупки: purchRes && { заголовок: purchRes.title, изменения: purchRes.items.map((i) => i.text).slice(0, 6) } };
  return ai.write('Ты — управляющий рестораном. По итогам вчерашней смены дай собственнику один практичный совет на сегодня (1–2 предложения, до 300 знаков), опираясь на самое важное отклонение. Если отклонений нет — коротко похвали команду и подскажи, на что обратить внимание.', facts, { maxTokens: 250, temperature: 0.4 });
}

// ------------------------------------------------------------------ вопросы собственника
const ASK_SYS = 'Ты — ИИ-управляющий в сервисе «Сводка» (данные из iiko одного заведения). Отвечай собственнику по-русски, на «вы», коротко и по делу: сначала прямой ответ с цифрами из данных, потом 1–3 конкретных совета. ' +
  'Используй только переданные данные; если нужных данных нет — честно скажи, каких именно (например, «не внесены расходы на аренду» или «iiko не отдал себестоимость»), и как их добавить. Не выдумывай цифры. До 1200 знаков, без markdown-таблиц.';
function compactCtx(ctx) {
  const days = (ctx.reports || []).map((r) => {
    const t = (r.data && r.data.totals) || {}, pr = r.data && r.data.profit;
    return { day: r.day, выручка: r2(t.revenue), чеков: t.orders, средний_чек: r2(t.avg_check), себестоимость: t.cost, скидки: r2(t.discount), удаления: r2(t.deleted_sum), прибыль: pr ? pr.profit : null,
      официанты: (r.data.waiters || []).slice(0, 8).map((w) => `${w.name}: ${Math.round(w.revenue)} ₽, чек ${Math.round(w.avg_check)}, скидки ${Math.round(w.discount)}`),
      отклонения: (r.data.flags || []).map((f) => f.text) };
  });
  const ins = {};
  (ctx.insights || []).forEach((i) => { ins[i.agent] = { title: i.title, выводы: (i.data && i.data.items || []).map((x) => x.text).slice(0, 10), текст: i.agent === 'director' ? i.text : undefined }; });
  const fin = (ctx.insights || []).find((i) => i.agent === 'finance');
  const priceUp = {};
  (ctx.prices || []).forEach((p) => { priceUp[p.name] = priceUp[p.name] || []; priceUp[p.name].push(`${p.day}: ${r2(p.price)} ₽${p.unit ? '/' + p.unit : ''}${p.supplier ? ' (' + p.supplier + ')' : ''}`); });
  return { режим: ctx.mode === 'demo' ? 'демо-данные' : 'iiko', дни: days, агенты: ins, неделя_PnL: fin && fin.data && fin.data.pnl, расходы_владельца: (ctx.expenses || []).map((e) => `${e.name} (${CAT[e.category] || e.category}): ${e.amount}${e.kind === 'percent' ? '% от выручки' : e.kind === 'month' ? ' ₽/мес' : e.kind === 'week' ? ' ₽/нед' : ' ₽ разово ' + (e.day || '')}`),
    цены_закупок: Object.keys(priceUp).slice(0, 60).map((k) => `${k}: ${priceUp[k].slice(-4).join('; ')}`), цели: prefsOf(ctx.prefs) };
}
async function answer(question, ctx) {
  const q = String(question || '').trim().slice(0, 1500);
  if (!q) throw new Error('Задайте вопрос');
  if (ai.enabled()) {
    const msgs = [{ role: 'system', content: ASK_SYS + '\n\nДанные заведения (JSON):\n' + JSON.stringify(compactCtx(ctx)).slice(0, 26000) }];
    (ctx.chat || []).slice(-6).forEach((m) => msgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.text).slice(0, 1500) }));
    msgs.push({ role: 'user', content: q });
    try { return { text: ai.clean(await ai.chat(msgs, { maxTokens: 900 })), by_ai: true }; } catch (e) { console.error('answer', e.message); }
  }
  return { text: fallbackAnswer(q, ctx), by_ai: false };
}
function fallbackAnswer(q, ctx) {
  const l = q.toLowerCase();
  const ins = {};
  (ctx.insights || []).forEach((i) => { ins[i.agent] = i; });
  const pick = (/закуп|цен|подорож|поставщ|накладн/.test(l) && 'purchases') || (/официант|персонал|сотрудник|смен[уы] выход|график|фот|зарплат/.test(l) && 'staff') ||
    (/блюд|меню|позици|маржа блюд|звезд/.test(l) && 'menu') || (/прибыл|расход|доход|финанс|фудкост|себестоим|недел|месяц/.test(l) && 'finance') || (/вчера|смен|выручк/.test(l) && 'shift') || 'director';
  const i = ins[pick] || ins.director || ins.finance || ins.shift;
  const head = 'ИИ пока не подключён администратором сервиса, поэтому отвечаю выводами агентов.';
  if (!i) return head + ' Отчётов ещё нет — сформируйте первый отчёт или включите демо.';
  const lst = (i.data && i.data.items || []).slice(0, 5).map((x) => '• ' + x.text).join('\n');
  return `${head}\n\n${AGENTS[i.agent] ? AGENTS[i.agent].name : i.agent}: ${i.title}${lst ? '\n' + lst : ''}`;
}

// ------------------------------------------------------------------ тексты для Telegram
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function dot(l) { return l === 'bad' ? '🔴' : l === 'warn' ? '🟡' : '🟢'; }
function tgDailyExtra(shiftRes, purchRes, tip) {
  const L = [];
  const m = shiftRes && shiftRes.data.metrics;
  if (m && m.cost != null) L.push(`📦 Себестоимость: ${money(m.cost)} · фудкост ${pct1(m.food_cost)}`);
  if (m && m.profit != null && m.has_expenses) L.push(`📈 Прибыль смены ≈ <b>${money(m.profit)}</b> (с долей расходов ${money(m.expenses)})`);
  else if (m && m.gross != null) L.push(`📈 Валовая прибыль: <b>${money(m.gross)}</b> · внесите расходы в кабинете, чтобы видеть чистую`);
  if (purchRes && purchRes.data.rows.length) {
    L.push(''); L.push(`<b>Закупки:</b> ${money(purchRes.data.sum)}` + (purchRes.data.up ? ` · подорожало ${purchRes.data.up}` : ''));
    purchRes.items.filter((i) => i.level !== 'ok').slice(0, 3).forEach((i) => L.push(`${dot(i.level)} ${esc(i.text)}`));
  }
  if (tip) { L.push(''); L.push(`🧭 <b>Совет управляющего:</b> ${esc(tip)}`); }
  return L.join('\n');
}
function tgWeekly(dir, fin, link) {
  const L = [`<b>Итоги недели · ${esc(dir.data.period.label)}</b>`];
  if (fin && fin.data.pnl) {
    const p = fin.data.pnl, pv = fin.data.prev || {};
    L.push('');
    L.push(`💰 Выручка: <b>${money(p.revenue)}</b>${pv.revenue ? ` (${p.revenue >= pv.revenue ? '+' : ''}${Math.round((p.revenue / pv.revenue - 1) * 100)}%)` : ''}`);
    if (p.cost != null) L.push(`📦 Себестоимость: ${money(p.cost)} · фудкост ${pct1(p.food_cost)}`);
    if (p.expenses && p.expenses.total) L.push(`🧾 Расходы: ${money(p.expenses.total)}${p.expenses.labor ? ` · ФОТ ${pct1(p.labor_share)}` : ''}`);
    if (p.profit != null && p.expenses && p.expenses.total) L.push(`📈 Прибыль: <b>${money(p.profit)}</b> · маржа ${pct1(p.margin)}`);
    if (p.purchases) L.push(`🛒 Закупки: ${money(p.purchases)}`);
    if (fin.data.month && fin.data.month.revenue) L.push(`📅 Месяц: ${money(fin.data.month.revenue)}, прогноз ≈ ${money(fin.data.month.forecast)}`);
  }
  L.push(''); L.push('<b>🧭 Управляющий:</b>'); L.push(esc(dir.text));
  if (link) { L.push(''); L.push(`<a href="${esc(link)}">Все агенты и подробности</a>`); }
  return L.join('\n').slice(0, 4000);
}

module.exports = { AGENTS, CAT, DEF, prefsOf, expensesFor, profitOf, shift, purchases, purchasesWeek, finance, staff, menu, director, dailyTip, answer, compactCtx, weekOf, isoAdd, dow, dayRu, tgDailyExtra, tgWeekly, money, pct1 };
