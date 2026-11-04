// Демо-данные: правдоподобная смена кафе — чтобы показать продукт без подключения iiko. Всегда помечены demo: true.
const { flags, isoAdd } = require('./report');
function rng(seed) { let s = 0; for (const c of seed) s = (s * 31 + c.charCodeAt(0)) >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function r2(n) { return Math.round(n * 100) / 100; }
const WAITERS = ['Анна Смирнова', 'Дмитрий Козлов', 'Мария Иванова', 'Артём Волков', 'Елена Новикова'];
// [название, цена, доля себестоимости]
const DISHES = [['Цезарь с курицей', 690, 0.31], ['Борщ с говядиной', 490, 0.27], ['Паста карбонара', 720, 0.24], ['Стейк рибай', 2450, 0.46], ['Том ям', 790, 0.38], ['Бургер классический', 650, 0.35],
  ['Лимонад домашний', 390, 0.09], ['Капучино', 290, 0.14], ['Чизкейк', 450, 0.29], ['Пицца Маргарита', 690, 0.2], ['Сырники', 420, 0.22], ['Утиная грудка', 1290, 0.41], ['Кальян классический', 1800, 0.12], ['Чай улун', 590, 0.07]];
function demoReport(day, opts = {}) {
  const R = rng(day + (opts.seed || ''));
  const dow = new Date(day + 'T12:00:00Z').getUTCDay();
  const k = [1.35, 0.8, 0.85, 0.9, 1, 1.4, 1.55][dow] * (0.9 + R() * 0.2);
  const orders = Math.round(95 * k), guests = Math.round(orders * (1.7 + R() * 0.3));
  const dishes = DISHES.map(([n, p, c]) => { const q = Math.max(1, Math.round((3 + R() * 25) * k)); return { name: n, qty: q, sum: q * p, cost: r2(q * p * c * (0.97 + R() * 0.06)) }; }).sort((a, b) => b.sum - a.sum);
  const gross = dishes.reduce((s, d) => s + d.sum, 0);
  const discount = r2(gross * (0.04 + R() * 0.05));
  const revenue = r2(gross - discount);
  const wsh = WAITERS.map(() => 0.6 + R()); const wsum = wsh.reduce((a, b) => a + b, 0);
  const waiters = WAITERS.map((n, i) => {
    const rv = r2(revenue * wsh[i] / wsum), od = Math.max(1, Math.round(orders * wsh[i] / wsum));
    const dsh = i === 3 && R() > 0.4 ? 0.16 : 0.03 + R() * 0.05;
    return { name: n, revenue: rv, orders: od, guests: Math.round(od * 1.8), avg_check: r2(rv / od), discount: r2(rv * dsh), discount_share: r2(dsh) };
  }).sort((a, b) => b.revenue - a.revenue);
  const hours = []; for (let h = 11; h <= 23; h++) { const w = Math.exp(-Math.pow((h - (h < 16 ? 13.5 : 20)) / 2, 2)) * (h < 16 ? 0.6 : 1); hours.push({ hour: h, w }); }
  const hw = hours.reduce((s, x) => s + x.w, 0);
  const cash = 0.12 + R() * 0.1;
  const del = [{ type: 'DELETED_WITH_WRITEOFF', waiter: WAITERS[3], dish: 'Стейк рибай', sum: 2450, qty: 1 }, { type: 'DELETED_WITHOUT_WRITEOFF', waiter: WAITERS[1], dish: 'Лимонад домашний', sum: 390, qty: 1 }];
  if (R() > 0.5) del.push({ type: 'DELETED_WITHOUT_WRITEOFF', waiter: WAITERS[3], dish: 'Кальян классический', sum: 1800, qty: 1 });
  const pk = 0.9 + R() * 0.25;
  const out = {
    demo: true, day, depts: ['Демо-кафе'], generated_at: new Date().toISOString(), fields_missing: [], partial: !!opts.partial,
    totals: { revenue, gross: r2(gross), discount, orders, guests, avg_check: r2(revenue / orders), avg_guest: r2(revenue / guests), cost: r2(dishes.reduce((s, d) => s + d.cost, 0)) },
    by_dept: [],
    pay: [{ name: 'Банковская карта', sum: r2(revenue * (1 - cash - 0.08)) }, { name: 'Наличные', sum: r2(revenue * cash) }, { name: 'СБП', sum: r2(revenue * 0.08) }],
    waiters, dishes: dishes.slice(0, 10), dishes_all: dishes, dishes_total: DISHES.length,
    hours: hours.map((x) => ({ hour: x.hour, revenue: r2(revenue * x.w / hw), orders: Math.round(orders * x.w / hw) })),
    deletions: del, discounts: [{ type: 'Скидка постоянного гостя 10%', waiter: WAITERS[3], sum: r2(discount * 0.45) }, { type: 'Скидка сотрудника 30%', waiter: WAITERS[0], sum: r2(discount * 0.2) }, { type: 'Комплимент от шефа', waiter: WAITERS[2], sum: r2(discount * 0.15) }],
    prev: { day: isoAdd(day, -7), revenue: r2(revenue * pk), orders: Math.round(orders * (0.95 + R() * 0.1)), guests: Math.round(guests * 0.97) }
  };
  out.pay.forEach((p) => { p.share = r2(p.sum / revenue); });
  out.prev.avg_check = r2(out.prev.revenue / out.prev.orders);
  out.totals.deleted_sum = del.reduce((s, d) => s + d.sum, 0); out.totals.deleted_qty = del.length;
  out.flags = flags(out);
  return out;
}

// Демо-закупки: накладные по дням недели, цены медленно растут, у пары позиций — заметный скачок
const GOODS = [['Говядина вырезка', 'кг', 1890, 'ООО «Мясной двор»', 6, [1, 4]], ['Куриное филе', 'кг', 420, 'ООО «Мясной двор»', 14, [1, 4]],
  ['Лосось охлаждённый', 'кг', 1650, 'ООО «Северная рыба»', 4, [2, 5]], ['Креветка тигровая', 'кг', 1290, 'ООО «Северная рыба»', 3, [2, 5]],
  ['Сливки 33%', 'л', 520, 'ИП Молочник', 10, [1, 3, 5]], ['Сыр пармезан', 'кг', 2350, 'ИП Молочник', 2, [3]], ['Мука пшеничная', 'кг', 58, 'ООО «Бакалея»', 25, [2]],
  ['Томаты', 'кг', 290, 'Овощебаза №3', 18, [1, 3, 5]], ['Салат романо', 'кг', 640, 'Овощебаза №3', 5, [1, 3, 5]], ['Лимоны', 'кг', 210, 'Овощебаза №3', 8, [1, 4]],
  ['Кофе зерно', 'кг', 1950, 'ООО «Кофе-Опт»', 4, [4]], ['Табак для кальяна', 'кг', 6900, 'ООО «Дым»', 1, [3]], ['Утка тушка', 'кг', 790, 'ООО «Мясной двор»', 6, [2, 5]]];
function weekIdx(day) { return Math.floor((Date.parse(day + 'T00:00:00Z') / 86400000 + 3) / 7); }
function demoPurchases(day, opts = {}) {
  const dow = new Date(day + 'T12:00:00Z').getUTCDay();
  const R = rng('p' + day + (opts.seed || ''));
  const w = weekIdx(day);
  const rows = [];
  GOODS.forEach(([name, unit, base, supplier, qty, days], i) => {
    if (days.indexOf(dow) < 0) return;
    let price = base * (1 + 0.004 * (w % 50));
    if (i === 0 && w % 2 === 0) price *= 1.12;   // говядина: скачок через неделю
    if (i === 4 && w % 3 === 0) price *= 1.09;   // сливки
    if (i === 7 && w % 2 === 1) price *= 0.9;    // томаты подешевели
    price = Math.round(price * (0.99 + R() * 0.02) * 100) / 100;
    const q = Math.round(qty * 2.3 * (0.8 + R() * 0.5) * 10) / 10;
    rows.push({ product_id: 'demo-' + i, name, unit, supplier, qty: q, sum: Math.round(q * price * 100) / 100, day });
  });
  return { day, docs: rows.length ? new Set(rows.map((r) => r.supplier)).size : 0, rows, sum: Math.round(rows.reduce((s, r) => s + r.sum, 0) * 100) / 100, demo: true };
}
module.exports = { demoReport, demoPurchases };
