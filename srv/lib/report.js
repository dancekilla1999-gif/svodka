// Сборка отчёта по смене из OLAP-отчёта продаж iiko (reportType SALES).
// Названия полей у разных версий iiko немного отличаются, поэтому сначала читаем список полей сервера
// и берём первое подходящее из кандидатов. Нет поля — раздел отчёта пропускается, а не падает весь отчёт.

const { classification, floorOf, entityOf, paymentOf, rulesFromPrefs, isUnprintedCheque, nonFiscalOf, FOUNDERS_CATEGORY } = require('./sales-breakdown');

const CANDIDATES = {
  rev: ['DishDiscountSumInt', 'DishDiscountSum'],
  gross: ['DishSumInt', 'DishSum'],
  disc: ['DiscountSum', 'DishDiscountSumInt.discount'],
  orders: ['UniqOrderId.OrdersCount', 'UniqOrderId', 'OrdersCount'],
  guests: ['GuestNum', 'GuestsCount'],
  qty: ['DishAmountInt', 'DishAmount'],
  cost: ['ProductCostBase.ProductCost', 'ProductCostBase.Cost', 'ProductCost'],
  waiter: ['OrderWaiter.Name', 'WaiterName', 'Waiter.Name'],
  pay: ['PayTypes', 'PayTypes.Combo', 'PayType'],
  dish: ['DishName'],
  hour: ['HourOpen', 'HourClose'],
  deptId: ['Department.Id'],
  dept: ['Department', 'Department.Name', 'RestaurantSection'],
  del: ['DeletedWithWriteoff', 'OrderDeleted'],
  discType: ['OrderDiscount.Type', 'Discount.Type', 'OrderDiscountType'],
  fiscal: ['PayTypes.IsPrintCheque'],
  floor: ['RestaurantSection'],
  entity: ['JurName'],
  payCombo: ['PayTypes.Combo'],
  payGroup: ['PayTypes.Group'],
  receipt: ['OrderNum'],
  orderId: ['UniqOrderId.Id'],
  closed: ['CloseTime'],
  table: ['TableNum'],
  cardOwner: ['CardOwner'],
  authorizedBy: ['AuthUser']
};

function pick(cols, list) { for (const f of list) if (cols[f]) return f; return null; }
function num(v) { if (v == null || v === '') return 0; const n = typeof v === 'number' ? v : Number(String(v).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : 0; }
function r2(n) { return Math.round(n * 100) / 100; }
function isoAdd(day, n) { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

function fields(cols) {
  const f = {};
  for (const k of Object.keys(CANDIDATES)) f[k] = pick(cols, CANDIDATES[k]);
  return f;
}

function baseFilters(f, from, to, deptIds, deptNames, notDeleted) {
  const flt = {
    'OpenDate.Typed': { filterType: 'DateRange', periodType: 'CUSTOM', from, to, includeLow: true, includeHigh: false }
  };
  if (deptIds && deptIds.length) {
    if (f.deptId) flt[f.deptId] = { filterType: 'IncludeValues', values: deptIds };
    else if (f.dept && deptNames && deptNames.length) flt[f.dept] = { filterType: 'IncludeValues', values: deptNames };
  }
  if (notDeleted && f.del) {
    flt[f.del] = f.del === 'OrderDeleted' ? { filterType: 'IncludeValues', values: ['NOT_DELETED'] } : { filterType: 'IncludeValues', values: ['NOT_DELETED'] };
  }
  return flt;
}
function body(groups, aggs, filters) {
  return { reportType: 'SALES', buildSummary: false, groupByRowFields: groups.filter(Boolean), groupByColFields: [], aggregateFields: aggs.filter(Boolean), filters };
}

async function buildReport(iiko, day, sel, opts = {}) {
  const rules = opts.rules || rulesFromPrefs(opts.prefs);
  const cols = await iiko.columns();
  const f = fields(cols);
  if (!f.rev) throw new Error('В iiko не нашлось поля выручки (DishDiscountSumInt) — нужен доступ к отчётам по продажам');
  const deptIds = (sel || []).map((d) => d.id).filter(Boolean);
  const deptNames = (sel || []).map((d) => d.name).filter(Boolean);
  const from = day, to = isoAdd(day, 1);
  const flt = baseFilters(f, from, to, deptIds, deptNames, true);
  const aggMain = [f.rev, f.gross, f.orders, f.guests, f.cost];
  const optionalFields = ['deptId', 'disc', 'discType', 'cost', 'fiscal', 'floor', 'entity', 'payCombo', 'payGroup', 'receipt', 'orderId', 'closed', 'table', 'cardOwner', 'authorizedBy'];
  const missing = Object.keys(f).filter((k) => !f[k] && !optionalFields.includes(k));
  const out = { demo: false, day, depts: deptNames, generated_at: new Date().toISOString(), fields_missing: missing };
  // OLAP-запросы идут параллельно (не больше 4 одновременно): последовательно медленный iiko не укладывался в лимит функции
  let active = 0; const waiting = [];
  const slot = () => new Promise((ok) => { if (active < 4) { active++; ok(); } else waiting.push(ok); });
  const free = () => { const n = waiting.shift(); if (n) n(); else active--; };
  const run = async (groups, aggs, filters) => { await slot(); try { return await iiko.olap(body(groups, aggs, filters || flt)); } catch (e) { (out.errors = out.errors || []).push(e.message.slice(0, 160)); return []; } finally { free(); } };
  const pd = isoAdd(day, -7);
  const dflt = f.del ? baseFilters(f, from, to, deptIds, deptNames, false) : null;
  if (dflt) dflt[f.del] = { filterType: 'ExcludeValues', values: ['NOT_DELETED'] };
  const salesPay = f.payCombo || f.pay;
  const discountGroups = [f.discType, salesPay, f.payGroup, f.fiscal, f.waiter];
  const discountDetailGroups = [...new Set([...discountGroups, f.receipt, f.orderId, f.closed, f.table, f.cardOwner, f.authorizedBy, f.floor, f.dept].filter(Boolean))];
  const hasReceiptDetail = !!(f.receipt || f.orderId);
  // Комбинация оплат сохраняет выручку чека одной строкой. Смешанные оплаты
  // без отдельных сумм по способам показываем в нераспределённых.
  const P = {
    dept: f.dept ? run([f.dept], aggMain) : run([f.hour || f.waiter], aggMain),
    pay: f.pay ? run([f.pay], [f.rev]) : null,
    waiters: f.waiter ? run([f.waiter], [f.rev, f.gross, f.orders, f.guests]) : null,
    dish: f.dish ? run([f.dish], [f.qty, f.rev, f.cost]) : null,
    hours: f.hour ? run([f.hour], [f.rev, f.orders]) : null,
    del: f.del ? run([f.del, f.waiter, f.dish], [f.gross || f.rev, f.qty], dflt) : null,
    disc: f.gross && (f.discType || salesPay || f.fiscal)
      ? run(hasReceiptDetail ? discountDetailGroups : discountGroups, [f.rev, f.gross])
      : null,
    sales: salesPay ? run([...new Set([f.floor, f.dept, f.entity, salesPay, f.discType])], [f.rev, f.gross]) : null,
    prev: run([f.dept || f.waiter], [f.rev, f.orders, f.guests], baseFilters(f, pd, isoAdd(pd, 1), deptIds, deptNames, true))
  };

  // по подразделениям (и общий итог)
  const deptRows = await P.dept;
  const tot = { revenue: 0, gross: 0, orders: 0, guests: 0, cost: 0 };
  out.by_dept = [];
  deptRows.forEach((row) => {
    const x = { name: f.dept ? String(row[f.dept] || '—') : 'Все', revenue: num(row[f.rev]), gross: num(row[f.gross]), orders: num(row[f.orders]), guests: num(row[f.guests]) };
    tot.revenue += x.revenue; tot.gross += x.gross; tot.orders += x.orders; tot.guests += x.guests; tot.cost += f.cost ? num(row[f.cost]) : 0;
    if (f.dept) out.by_dept.push(Object.assign(x, { avg_check: x.orders ? r2(x.revenue / x.orders) : 0 }));
  });
  if (!f.gross) tot.gross = tot.revenue;
  out.totals = {
    revenue: r2(tot.revenue), gross: r2(tot.gross), discount: r2(Math.max(0, tot.gross - tot.revenue)), orders: tot.orders, guests: tot.guests,
    avg_check: tot.orders ? r2(tot.revenue / tot.orders) : 0, avg_guest: tot.guests ? r2(tot.revenue / tot.guests) : 0,
    cost: f.cost ? r2(tot.cost) : null
  };

  // оплаты
  out.pay = f.pay ? (await P.pay).map((row) => ({ name: String(row[f.pay] || 'Не указано'), sum: r2(num(row[f.rev])) }))
    .filter((x) => x.sum).sort((a, b) => b.sum - a.sum) : [];
  out.pay.forEach((x) => { x.share = tot.revenue ? r2(x.sum / tot.revenue) : 0; });

  // официанты
  out.waiters = f.waiter ? (await P.waiters).map((row) => {
    const rev = num(row[f.rev]), gross = f.gross ? num(row[f.gross]) : rev, ord = num(row[f.orders]);
    return { name: String(row[f.waiter] || 'Без официанта'), revenue: r2(rev), orders: ord, guests: num(row[f.guests]), avg_check: ord ? r2(rev / ord) : 0,
      discount: r2(Math.max(0, gross - rev)), discount_share: gross ? r2(Math.max(0, gross - rev) / gross) : 0 };
  }).sort((a, b) => b.revenue - a.revenue) : [];

  // блюда
  if (f.dish) {
    const rows = await P.dish;
    out.dishes_total = rows.length;
    const all = rows.map((row) => ({ name: String(row[f.dish] || '—'), qty: r2(num(row[f.qty])), sum: r2(num(row[f.rev])), cost: f.cost ? r2(num(row[f.cost])) : null }))
      .sort((a, b) => b.sum - a.sum);
    out.dishes = all.slice(0, 10);
    out.dishes_all = all.slice(0, 400);
  } else out.dishes = [];

  // по часам
  out.hours = f.hour ? (await P.hours).map((row) => ({ hour: Number(row[f.hour]), revenue: r2(num(row[f.rev])), orders: num(row[f.orders]) }))
    .filter((x) => !isNaN(x.hour)).sort((a, b) => a.hour - b.hour) : [];

  // удаления
  out.deletions = [];
  if (f.del) {
    const rows = await P.del;
    out.deletions = rows.map((row) => ({ type: String(row[f.del] || ''), waiter: f.waiter ? String(row[f.waiter] || '—') : '—', dish: f.dish ? String(row[f.dish] || '—') : '—',
      sum: r2(num(row[f.gross || f.rev])), qty: r2(num(row[f.qty])) })).filter((x) => x.sum || x.qty).sort((a, b) => b.sum - a.sum);
  }
  out.totals.deleted_sum = r2(out.deletions.reduce((s, x) => s + x.sum, 0));
  out.totals.deleted_qty = r2(out.deletions.reduce((s, x) => s + x.qty, 0));

  out.discounts = [];
  if (P.disc) {
    let rows = await P.disc;
    const reconciles = (items) => Math.abs(items.reduce((sum, row) => sum + num(row[f.gross]), 0) - tot.gross) < 0.02
      && Math.abs(items.reduce((sum, row) => sum + num(row[f.rev]), 0) - tot.revenue) < 0.02;
    const detailed = hasReceiptDetail && reconciles(rows);
    if (hasReceiptDetail && !detailed) {
      rows = await run(discountGroups, [f.rev, f.gross]);
      (out.errors = out.errors || []).push('Реестр скидок по чекам недоступен; получены общие данные');
    }
    if (reconciles(rows)) {
      const discounts = new Map();
      const discountDetails = new Map();
      const discountByType = new Map();
      const nonFiscal = new Map();
      const promoItems = new Map();
      const byWaiter = new Map();
      const saleReceipts = new Set();
      const saleGuestsByReceipt = new Map();
      let saleOrdersAgg = 0, saleGuestsAgg = 0;
      let eligibleGross = 0, eligibleNet = 0, promoGross = 0, promoNet = 0;
      const unprinted = { sum: 0, count: 0, receipts: new Set() };
      const receiptKey = (row) => String(row[f.receipt] || row[f.orderId] || '') || null;
      const bumpCount = (entry, row, receipts) => {
        const key = receiptKey(row);
        if (key) {
          if (!receipts.has(key)) { receipts.add(key); entry.count += 1; }
        } else entry.count += 1;
      };
      const countSale = (row) => {
        const key = receiptKey(row);
        if (key) saleReceipts.add(key);
        if (f.orders) saleOrdersAgg += num(row[f.orders]);
        if (f.guests) {
          const g = num(row[f.guests]);
          if (key) { if (!saleGuestsByReceipt.has(key)) saleGuestsByReceipt.set(key, g); }
          else saleGuestsAgg += g;
        }
      };
      for (const row of rows) {
        const type = row[f.discType] || '';
        const payment = row[salesPay] || '';
        const group = classification(type, payment, row[f.fiscal], rules);
        const waiter = String(row[f.waiter] || 'Без официанта');
        const gross = num(row[f.gross]), net = num(row[f.rev]);
        if (group === 'promo') {
          promoGross += (net > 0 ? net : gross);
          promoNet += net;
          countSale(row);
          const payName = String(payment || type || 'ПромоБезОплаты').trim() || 'ПромоБезОплаты';
          const table = String(row[f.table] ?? '').trim();
          const label = table ? `Стол ${table} · ${payName}` : payName;
          const entry = promoItems.get(label) || { label, table, type: payName, sum: 0, count: 0, receipts: new Set() };
          entry.sum += (net > 0 ? net : gross);
          bumpCount(entry, row, entry.receipts);
          promoItems.set(label, entry);
          continue;
        }
        // Списания / за счёт заведения: не касса, не скидки, не выручка. Типы из списка, группа оплаты
        // «За счет заведения» (PayTypes.Group = WRITEOFF) и запасной признак — сумма в DiscountSum без типа скидки.
        const wo = nonFiscalOf({ type, payment, payGroup: row[f.payGroup], fiscal: row[f.fiscal], gross, net, table: row[f.table], guest: row[f.cardOwner] }, rules);
        if (wo) {
          const key = JSON.stringify([wo.category, wo.name]);
          const entry = nonFiscal.get(key) || { type: wo.name, category: wo.category, founder: wo.founder || null, tables: new Set(), reasons: new Set(), sum: 0, count: 0, receipts: new Set() };
          entry.sum += Math.max(0, wo.sum);
          if (wo.table) entry.tables.add(wo.table);
          entry.reasons.add(wo.reason);
          bumpCount(entry, row, entry.receipts);
          if (wo.sum > 0.009) nonFiscal.set(key, entry);
          if (wo.rest <= 0.009) continue;
          // смешанная оплата: оплаченная часть — обычная продажа без скидки
          countSale(row);
          eligibleGross += wo.rest; eligibleNet += wo.rest;
          const w = byWaiter.get(waiter) || { gross: 0, net: 0 };
          w.gross += wo.rest; w.net += wo.rest; byWaiter.set(waiter, w);
          continue;
        }
        countSale(row);
        if (isUnprintedCheque(row[f.fiscal])) {
          unprinted.sum += net;
          bumpCount(unprinted, row, unprinted.receipts);
        }
        eligibleGross += gross;
        eligibleNet += net;
        const w = byWaiter.get(waiter) || { gross: 0, net: 0 };
        w.gross += gross;
        w.net += net;
        byWaiter.set(waiter, w);
        if (gross !== net) {
          const discountType = type || 'Тип не указан';
          const key = JSON.stringify([discountType, waiter]);
          const entry = discounts.get(key) || { type: discountType, waiter, sum: 0 };
          entry.sum += gross - net;
          discounts.set(key, entry);
          const byType = discountByType.get(discountType) || { type: discountType, sum: 0, count: 0, receipts: new Set() };
          byType.sum += gross - net;
          bumpCount(byType, row, byType.receipts);
          discountByType.set(discountType, byType);
          if (detailed) {
            const detail = {
              type: discountType, waiter,
              receipt: String(row[f.receipt] ?? ''),
              order_id: String(row[f.orderId] ?? ''),
              closed: String(row[f.closed] ?? ''),
              table: String(row[f.table] ?? ''),
              guest: String(row[f.cardOwner] ?? ''),
              authorized_by: String(row[f.authorizedBy] ?? ''),
              room: String(row[f.floor] ?? row[f.dept] ?? '')
            };
            const detailKey = JSON.stringify(detail);
            const existing = discountDetails.get(detailKey) || { ...detail, sum: 0 };
            existing.sum += gross - net;
            discountDetails.set(detailKey, existing);
          }
        }
      }
      const clean = (x) => { const { receipts, ...rest } = x; return { ...rest, sum: r2(x.sum), count: x.count || 0 }; };
      out.totals.discount = r2(Math.max(0, eligibleGross - eligibleNet));
      out.totals.discount_base = r2(eligibleGross);
      // Выручка = фискальные чеки (после скидки) + промо без оплаты. Нефискальные «за счёт заведения» не входят.
      const fiscalRevenue = r2(eligibleNet + promoGross);
      const nfCount = [...nonFiscal.values()].reduce((s, x) => s + (x.count || 0), 0);
      const saleGuests = saleGuestsByReceipt.size
        ? [...saleGuestsByReceipt.values()].reduce((s, g) => s + g, 0)
        : saleGuestsAgg;
      const saleOrders = saleReceipts.size || saleOrdersAgg || (tot.orders && nfCount ? Math.max(0, tot.orders - nfCount) : 0);
      if (Math.abs(fiscalRevenue - tot.revenue) >= 0.01 || nonFiscal.size || saleOrders) {
        out.totals.revenue_iiko = r2(tot.revenue);
        out.totals.revenue = fiscalRevenue;
      }
      if (saleOrders) {
        out.totals.orders = saleOrders;
        out.totals.avg_check = r2(fiscalRevenue / saleOrders);
      } else if (tot.orders) {
        out.totals.avg_check = r2(fiscalRevenue / tot.orders);
      }
      if (saleGuests) {
        out.totals.guests = saleGuests;
        out.totals.avg_guest = r2(fiscalRevenue / saleGuests);
        out.totals.guests_include_non_fiscal = false;
      } else {
        out.totals.avg_guest = tot.guests ? r2(fiscalRevenue / tot.guests) : 0;
        out.totals.guests_include_non_fiscal = true;
      }
      out.non_fiscal = [...nonFiscal.values()].map((x) => {
        const { tables, reasons, ...rest } = clean(x);
        return { ...rest, table: [...tables].sort((a, b) => a.localeCompare(b, 'ru', { numeric: true })).join(', '), reasons: [...reasons] };
      }).sort((a, b) => (a.category === FOUNDERS_CATEGORY ? 0 : 1) - (b.category === FOUNDERS_CATEGORY ? 0 : 1) || b.sum - a.sum);
      const founders = out.non_fiscal.filter((x) => x.category === FOUNDERS_CATEGORY);
      const byFounder = new Map();
      founders.forEach((x) => {
        const name = x.founder || x.type;
        const e = byFounder.get(name) || { name, sum: 0, count: 0 };
        e.sum = r2(e.sum + x.sum); e.count += x.count || 0;
        byFounder.set(name, e);
      });
      out.founders = [...byFounder.values()].sort((a, b) => b.sum - a.sum);
      out.founders_total = r2(founders.reduce((s, x) => s + x.sum, 0));
      out.write_offs_total = r2(out.non_fiscal.reduce((s, x) => s + x.sum, 0));
      out.promo_items = [...promoItems.values()].map(clean).filter((x) => x.sum > 0).sort((a, b) => b.sum - a.sum);
      out.promo_total = r2(out.promo_items.reduce((s, x) => s + x.sum, 0));
      if (unprinted.count || unprinted.sum) out.unprinted = { sum: r2(unprinted.sum), count: unprinted.count };
      out.discount_by_type = [...discountByType.values()].map(clean).filter((x) => x.sum > 0).sort((a, b) => b.sum - a.sum);
      out.discounts = [...discounts.values()].filter((x) => x.sum > 0)
        .sort((a, b) => b.sum - a.sum).slice(0, 15).map((x) => ({ ...x, sum: r2(x.sum) }));
      if (detailed) {
        out.discount_details = [...discountDetails.values()].filter((x) => x.sum > 0)
          .map((x) => ({ ...x, sum: r2(x.sum) }))
          .sort((a, b) => a.closed.localeCompare(b.closed) || a.receipt.localeCompare(b.receipt));
      }
      if (out.pay && out.pay.length) {
        const classified = out.pay.map((x) => ({ ...x, group: classification('', x.name, null, rules) }));
        const kept = classified.filter((x) => x.group !== 'nonFiscal');
        if (kept.length !== classified.length) {
          const shareBase = fiscalRevenue || kept.reduce((s, x) => s + x.sum, 0);
          out.pay = kept.map((x) => ({ name: x.name, sum: x.sum, share: shareBase ? r2(x.sum / shareBase) : 0 }));
        }
      }
      out.waiters.forEach((w) => {
        const x = byWaiter.get(w.name);
        w.discount_base = x ? r2(x.gross) : 0;
        w.discount = x ? r2(Math.max(0, x.gross - x.net)) : 0;
        w.discount_share = x && x.gross > 0 ? r2(w.discount / x.gross) : 0;
      });
    } else {
      out.totals.discount = null;
      out.totals.discount_base = null;
      out.waiters.forEach((w) => { w.discount = null; w.discount_share = null; });
      (out.errors = out.errors || []).push('Детализация скидок не совпала с итогами iiko');
    }
  }

  const salesRows = P.sales ? await P.sales : null;
  const salesMatch = salesRows && Math.abs(salesRows.reduce((sum, row) => sum + num(row[f.rev]), 0) - tot.revenue) < 0.02;
  if (P.sales && !salesMatch) (out.errors = out.errors || []).push('Детализация выручки не совпала с итогами iiko');
  if (salesMatch) {
    const rows = salesRows;
    const grouped = new Map();
    for (const row of rows) {
      if (classification(row[f.discType], row[salesPay], null, rules) === 'nonFiscal') continue;
      const floor = floorOf(row[f.floor], row[f.dept]);
      const entity = entityOf(row[f.entity]);
      const payment = paymentOf(row[salesPay]);
      const entityName = String(row[f.entity] ?? '');
      const paymentName = String(row[salesPay] ?? '');
      const key = JSON.stringify([floor, entity, payment, entityName, paymentName]);
      const entry = grouped.get(key) || { floor, entity, payment, entity_name: entityName, payment_name: paymentName, sum: 0 };
      entry.sum += num(row[f.rev]);
      grouped.set(key, entry);
    }
    if (rows.length || !tot.revenue) {
      out.revenue_breakdown = [...grouped.values()].map((x) => ({ ...x, sum: r2(x.sum) }));
    }
  }
  if ((!out.promo_items || !out.promo_items.length) && salesMatch && f.gross && Math.abs(salesRows.reduce((sum, row) => sum + num(row[f.gross]), 0) - tot.gross) < 0.02) {
    const rows = salesRows;
    if (rows.length || !tot.gross) {
      const items = new Map();
      for (const row of rows) {
        if (classification(row[f.discType], row[salesPay], null, rules) !== 'promo') continue;
        const payName = String(row[salesPay] || row[f.discType] || 'ПромоБезОплаты').trim() || 'ПромоБезОплаты';
        const table = String(row[f.table] ?? '').trim();
        const label = table ? `Стол ${table} · ${payName}` : payName;
        const entry = items.get(label) || { label, table, type: payName, sum: 0, count: 0 };
        entry.sum += num(row[f.gross]);
        entry.count += 1;
        items.set(label, entry);
      }
      out.promo_items = [...items.values()].map((x) => ({ ...x, sum: r2(x.sum) })).sort((a, b) => b.sum - a.sum);
      out.promo_total = r2(out.promo_items.reduce((s, x) => s + x.sum, 0));
    }
  }

  // тот же день недели неделю назад
  const prevRows = await P.prev;
  const pv = prevRows.reduce((s, row) => ({ revenue: s.revenue + num(row[f.rev]), orders: s.orders + num(row[f.orders]), guests: s.guests + num(row[f.guests]) }), { revenue: 0, orders: 0, guests: 0 });
  out.prev = { day: pd, revenue: r2(pv.revenue), orders: pv.orders, guests: pv.guests, avg_check: pv.orders ? r2(pv.revenue / pv.orders) : 0 };

  out.partial = !!opts.partial;
  out.flags = flags(out);
  return out;
}

function money(n) { return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(n)) + ' ₽'; }
function pct(x) { return (Math.round(Number(x) * 1000) / 10).toFixed(1).replace('.', ',') + '%'; }

// правила «на что посмотреть собственнику»
function flags(o) {
  const out = [], t = o.totals;
  if (!t.revenue && !o.partial) out.push({ level: 'warn', text: 'Продаж за день нет — точка не работала или iiko не выгрузил данные' });
  if (t.deleted_sum && t.deleted_sum >= Math.max(1500, t.revenue * 0.02)) {
    const byW = {};
    o.deletions.forEach((d) => { byW[d.waiter] = (byW[d.waiter] || 0) + d.sum; });
    const top = Object.keys(byW).sort((a, b) => byW[b] - byW[a])[0];
    out.push({ level: 'bad', text: `Удалений на ${money(t.deleted_sum)} (${pct(t.deleted_sum / Math.max(1, t.revenue))} выручки). Больше всего — ${top}: ${money(byW[top])}` });
  }
  const noWo = o.deletions.filter((d) => /WITHOUT/i.test(d.type)).reduce((s, d) => s + d.sum, 0);
  if (noWo >= 1000) out.push({ level: 'warn', text: `Удалено без списания на ${money(noWo)} — проверьте причины` });
  const discountBase = t.discount_base ?? t.gross;
  const share = discountBase > 0 ? t.discount / discountBase : 0;
  if (share >= 0.12) out.push({ level: 'warn', text: `Скидки — ${pct(share)} от суммы до скидок (${money(t.discount)})` });
  const ws = o.waiters.filter((w) => w.revenue > 0);
  ws.forEach((w) => {
    if (w.discount >= 1000 && w.discount_share >= Math.max(0.1, share * 2)) out.push({ level: 'bad', text: `${w.name}: скидки ${pct(w.discount_share)} от его чеков (${money(w.discount)}) — заметно выше среднего` });
  });
  if (o.prev && o.prev.revenue > 0 && !o.partial) {
    const d = t.revenue / o.prev.revenue - 1;
    if (d <= -0.25) out.push({ level: 'warn', text: `Выручка на ${pct(-d)} ниже, чем неделю назад (${money(o.prev.revenue)})` });
    if (o.prev.avg_check && t.avg_check) {
      const a = t.avg_check / o.prev.avg_check - 1;
      if (a <= -0.15) out.push({ level: 'warn', text: `Средний чек упал на ${pct(-a)}: ${money(t.avg_check)} против ${money(o.prev.avg_check)}` });
    }
  }
  const cash = o.pay.filter((p) => /нал|cash/i.test(p.name)).reduce((s, p) => s + p.share, 0);
  if (cash >= 0.45 && t.revenue > 20000) out.push({ level: 'warn', text: `Наличными — ${pct(cash)} выручки, проверьте сдачу кассы` });
  return out;
}

module.exports = { buildReport, flags, isoAdd, fields, CANDIDATES };
