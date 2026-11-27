// Итоги смены по этажам: 1 и 2 этаж отдельно и в сумме равны общему итогу (жалоба 27.11: сводка не делила этажи).
const assert = require('node:assert/strict');
const { buildReport, floorTotals, fields, shares, fitTo } = require('./report');
const { reportText } = require('./text');
const { floorOf } = require('./sales-breakdown');

const COLS = ['DishDiscountSumInt', 'DishSumInt', 'UniqOrderId.OrdersCount', 'GuestNum', 'OrderWaiter.Name', 'PayTypes', 'PayTypes.Combo',
  'PayTypes.Group', 'PayTypes.IsPrintCheque', 'OrderDiscount.Type', 'Department', 'RestaurantSection', 'OrderNum', 'TableNum', 'CardOwner',
  'CloseTime', 'ProductCostBase.ProductCost'];

// Фейковый iiko: атомарные строки, агрегация по запрошенным полям, чек считается один раз в своей группе.
function fakeIiko(atoms, cols = COLS) {
  const set = new Set(cols);
  return {
    async columns() { return Object.fromEntries(cols.map((c) => [c, { name: c }])); },
    async olap(body) {
      const groups = body.groupByRowFields.filter((g) => set.has(g));
      const aggs = body.aggregateFields.filter((a) => set.has(a));
      const out = new Map();
      for (const a of atoms) {
        const key = JSON.stringify(groups.map((g) => a[g] ?? null));
        const row = out.get(key) || Object.fromEntries([...groups.map((g) => [g, a[g] ?? null]), ...aggs.map((x) => [x, 0])]);
        for (const x of aggs) row[x] += x === 'UniqOrderId.OrdersCount' ? 1 : Number(a[x] || 0);
        out.set(key, row);
      }
      return [...out.values()];
    }
  };
}

let n = 500;
function sale(room, pay, sum, disc = 0, type = '', extra = {}) {
  return { OrderNum: String(n++), TableNum: String(10 + (n % 20)), RestaurantSection: room, PayTypes: pay, 'PayTypes.Combo': pay,
    'PayTypes.Group': /нал/i.test(pay) ? 'CASH' : 'CARD', 'PayTypes.IsPrintCheque': 'true', 'OrderDiscount.Type': type,
    DishSumInt: sum, DishDiscountSumInt: sum - disc, GuestNum: 2, 'OrderWaiter.Name': 'Официант', Department: 'Смок Дог Москва',
    'ProductCostBase.ProductCost': Math.round((sum - disc) * 0.4), ...extra };
}
const F1 = 'Зал 1 этаж', F2 = 'Зал 2 этаж';

function shift() {
  n = 500;
  const atoms = [];
  for (let i = 0; i < 10; i++) atoms.push(sale(F1, i % 2 ? 'Банковские карты' : 'Наличные', 3000));
  for (let i = 0; i < 4; i++) atoms.push(sale(F1, 'Банковские карты', 4000, 1000, 'LoonaLevel2'));
  for (let i = 0; i < 5; i++) atoms.push(sale(F2, 'Банковские карты', 2000));
  atoms.push(sale(F2, 'Банковские карты', 2050, 205, 'LoonaFixedSumDiscount'));
  // промо без оплаты на 1 этаже: в выручке
  atoms.push(sale(F1, 'ПромоБезОплаты', 2400, 0, '', { 'PayTypes.Group': 'WRITEOFF', 'PayTypes.IsPrintCheque': 'false', DishDiscountSumInt: 2400 }));
  // учредительский стол на 2 этаже: не в выручке, но себестоимость есть
  atoms.push(sale(F2, 'Расим', 5000, 0, '', { 'PayTypes.Group': 'WRITEOFF', 'PayTypes.IsPrintCheque': 'false', DishDiscountSumInt: 0, TableNum: '338', 'ProductCostBase.ProductCost': 1500 }));
  return atoms;
}

async function testFloors() {
  const o = await buildReport(fakeIiko(shift()), '2026-11-26', [{ id: '', name: 'Смок Дог Москва' }]);
  assert.ok(!o.errors, String(o.errors));
  assert.ok(Array.isArray(o.by_floor), 'есть итоги по этажам');
  assert.deepEqual(o.by_floor.map((x) => x.floor), ['1', '2']);
  const [f1, f2] = o.by_floor;
  // 1 этаж: 10×3000 + 4×3000 (после скидки) + промо 2400
  assert.equal(f1.revenue, 30000 + 12000 + 2400);
  assert.equal(f1.orders, 15);
  assert.equal(f1.guests, 30);
  assert.equal(f1.discount, 4000);
  assert.deepEqual(f1.discount_by_type.map((x) => [x.type, x.sum, x.count]), [['LoonaLevel2', 4000, 4]]);
  // 2 этаж: 5×2000 + 1845; учредительский стол не в выручке и не в чеках
  assert.equal(f2.revenue, 10000 + 1845);
  assert.equal(f2.orders, 6);
  assert.equal(f2.discount, 205);
  // сумма этажей = общий итог
  const s = (k) => Math.round(o.by_floor.reduce((a, x) => a + x[k], 0) * 100) / 100;
  assert.equal(s('revenue'), o.totals.revenue);
  assert.equal(s('orders'), o.totals.orders);
  assert.equal(s('guests'), o.totals.guests);
  assert.equal(s('discount'), o.totals.discount);
  assert.equal(s('cost'), o.totals.cost);
  assert.equal(f2.cost, 2000 * 0.4 * 5 + Math.round(1845 * 0.4) + 1500);
  assert.equal(f1.gross_profit, f1.revenue - f1.cost);
  assert.equal(f1.avg_check, Math.round(f1.revenue / f1.orders * 100) / 100);

  o.profit = { cost: o.totals.cost, gross: o.totals.revenue - o.totals.cost, has_expenses: false };
  const text = reportText(o, null);
  assert.match(text, /<b>Всего по заведению<\/b>/);
  assert.match(text, /<b>🏢 По этажам<\/b>/);
  assert.match(text, /<b>1 этаж<\/b> — выручка <b>44\s400\s₽<\/b>/);
  assert.match(text, /<b>2 этаж<\/b> — выручка <b>11\s845\s₽<\/b>/);
  assert.match(text, /Чеков: 15  ·  Гостей: 30/);
  assert.match(text, /Скидки: 4\s000\s₽ \(LoonaLevel2 4\s000\s₽ · 4 чека\)/);
  assert.match(text, /Валовая прибыль: /);
  assert.ok(text.indexOf('По этажам') < text.indexOf('🏷 Скидки'), 'этажи идут сразу после общего итога');
  assert.ok(text.length < 4096, 'сообщение помещается в Telegram');
}

// Если разбор чеков не сошёлся, этажи берутся напрямую из iiko по залам
async function testFallbackFromIiko() {
  const f = fields(Object.fromEntries(COLS.map((c) => [c, 1])));
  const rows = [
    { RestaurantSection: F1, DishDiscountSumInt: 1000, 'UniqOrderId.OrdersCount': 2, GuestNum: 3, 'ProductCostBase.ProductCost': 400 },
    { RestaurantSection: F2, DishDiscountSumInt: 500, 'UniqOrderId.OrdersCount': 1, GuestNum: 1, 'ProductCostBase.ProductCost': 100 }
  ];
  const out = floorTotals(rows, f, undefined, { revenue: 1500 });
  assert.deepEqual(out.map((x) => [x.floor, x.revenue, x.orders, x.guests, x.cost, x.gross_profit, x.discount]),
    [['1', 1000, 2, 3, 400, 600, null], ['2', 500, 1, 1, 400 - 300, 400, null]]);
  // залы без номера этажа — блока нет
  assert.equal(floorTotals([{ RestaurantSection: 'Основной зал', DishDiscountSumInt: 10 }], f, undefined, {}), undefined);
  // этаж без продаж всё равно показывается нулём, «Этаж не указан» — только при продажах
  const one = floorTotals([{ RestaurantSection: F1, DishDiscountSumInt: 10 }, { RestaurantSection: 'Терраса', DishDiscountSumInt: 0 }], f, undefined, { revenue: 10 });
  assert.deepEqual(one.map((x) => x.floor), ['1', '2']);
}

function testFloorNames() {
  const cases = {
    'Зал 1 этаж': '1', 'ЗАЛ 2 ЭТАЖ': '2', '1-й этаж': '1', '1-ый этаж': '1', '2-ой этаж': '2', '2й этаж': '2', 'Этаж 2': '2', 'Этаж2': '2',
    '2этаж': '2', 'VIP 2 этаж': '2', 'Банкет (2 этаж)': '2', 'Зал на 2 этаже': '2', 'Терраса 2 этажа': '2', 'Зал\u00a02\u00a0этаж': '2',
    '2 эт': '2', '2 эт.': '2', 'Зал 2 эт.': '2', 'первый этаж': '1', 'Второй этаж': '2', 'на втором этаже': '2', 'Этаж-2': '2',
    'Этаж №2': '2', 'Этаж № 1': '1', '2-м этаже': '2', 'Этаж: 2': '2', '3 этаж': '3',
    'Зал 12': 'unknown', '12 этаж': 'unknown', 'Этаж 12': 'unknown', 'этаж 21': 'unknown', '-1 этаж': 'unknown', 'Цоколь -1 этаж': 'unknown',
    '1–2 этаж': 'unknown', '1-2 этаж': 'unknown', 'Этаж 1-2': 'unknown', 'этаж -1': 'unknown', 'Зал 1/2 этаж': 'unknown', 'Зал 1': 'unknown',
    'Веранда': 'unknown', 'Этажерка 2': 'unknown', '2 этап': 'unknown', '': 'unknown'
  };
  for (const [name, floor] of Object.entries(cases)) assert.equal(floorOf(name), floor, name);
  assert.equal(floorOf('', 'Смок Дог 2 этаж'), '2');
  assert.equal(floorOf('Основной зал', 'Смок Дог 2 этаж'), '2');
}

// Старый отчёт 26.11 из базы (без by_floor): выручка по этажам из revenue_breakdown, реальные суммы
function testOldReport26() {
  const o = {
    day: '2026-11-26', depts: ['Смок Дог Москва'],
    totals: { revenue: 488438, orders: 166, guests: 237, avg_check: 2942.4, avg_guest: 2060.92, discount: 102, discount_base: 488540, deleted_sum: 18510 },
    prev: {}, profit: { cost: 210752.65, gross: 277685.35, has_expenses: false },
    revenue_breakdown: [
      { floor: '1', payment: 'card', sum: 245794 }, { floor: '1', payment: 'unknown', sum: 67154 }, { floor: '1', payment: 'cash', sum: 33220 },
      { floor: '1', payment: 'bank', sum: 17970 }, { floor: '1', payment: 'bank', sum: 49456 },
      { floor: '2', payment: 'card', sum: 68332 }, { floor: '2', payment: 'cash', sum: 6512 }
    ]
  };
  const text = reportText(o, null);
  assert.match(text, /Выручка по этажам/);
  assert.match(text, /• 1 этаж: 413\s594\s₽ · 84,7%/);
  assert.match(text, /• 2 этаж: 74\s844\s₽ · 15,3%/);
  assert.equal(413594 + 74844, 488438);
}


// 1) Надбавки не уменьшают скидки: LoonaLevel2 1000 + надбавка −900 → скидки 1000, надбавки 900 (было «Всего: 100 ₽»)
async function testSurcharge() {
  n = 700;
  const atoms = [
    sale(F1, 'Банковские карты', 4000, 1000, 'LoonaLevel2'),
    sale(F1, 'Банковские карты', 3000, -900, 'Надбавка за обслуживание'),
    sale(F2, 'Банковские карты', 1000)
  ];
  const o = await buildReport(fakeIiko(atoms), '2026-11-26', [{ id: '', name: 'Смок Дог Москва' }]);
  assert.ok(!o.errors, String(o.errors));
  assert.equal(o.totals.discount, 1000);
  assert.equal(o.totals.surcharge, 900);
  assert.deepEqual(o.discount_by_type.map((x) => [x.type, x.sum]), [['LoonaLevel2', 1000]]);
  assert.deepEqual(o.surcharge_by_type.map((x) => [x.type, x.sum, x.count]), [['Надбавка за обслуживание', 900, 1]]);
  assert.equal(o.totals.revenue, 3000 + 3900 + 1000, 'выручка не меняется');
  const [f1, f2] = o.by_floor;
  assert.equal(f1.discount, 1000);
  assert.equal(f1.surcharge, 900);
  assert.equal(f2.discount, 0);
  const w = o.waiters.find((x) => x.name === 'Официант');
  assert.equal(w.discount, 1000, 'скидки официанта без взаимозачёта');
  assert.equal(w.surcharge, 900);
  const text = reportText(o, null);
  assert.match(text, /Всего: <b>1\s000\s₽<\/b>/);
  assert.match(text, /Надбавки <i>\(в выручке, не скидки\)<\/i>: 900\s₽/);
  assert.match(text, /Скидки: 1\s000\s₽ \(LoonaLevel2 1\s000\s₽ · 1 чек\)  ·  Надбавки: 900\s₽/);
  // доля скидок и флаг 12% считаются от положительных скидок
  // доля скидок и флаг 12% — от положительных скидок: 1000 / 8000 = 12,5% (по старой формуле было 100 ₽ = 1,3%, флага не было)
  assert.ok(o.flags.some((x) => /^Скидки — 12,5%/.test(x.text)), JSON.stringify(o.flags));
}

// 2) Тяжёлый день: сообщение никогда не длиннее 4096, детали сжимаются
function heavy(nFloors, nTypes, nPromo, nWo, nFlags) {
  const types = Array.from({ length: nTypes }, (_, i) => ({ type: `Очень длинный тип скидки номер ${i} для гостей`, sum: 1000 + i, count: i + 1 }));
  return {
    day: '2026-11-26', depts: ['Смок Дог Москва'], partial: false,
    totals: { revenue: 1234567, orders: 400, guests: 900, avg_check: 3086, avg_guest: 1371, discount: 50000, surcharge: 1200, discount_base: 1284567, deleted_sum: 30000 },
    prev: { revenue: 1000000 }, profit: { cost: 500000, gross: 734567, has_expenses: false },
    discount_by_type: types, surcharge_by_type: [{ type: 'Надбавка', sum: 1200, count: 3 }],
    by_floor: Array.from({ length: nFloors }, (_, i) => ({ floor: String(i + 1), revenue: 100000 + i, orders: 100, guests: 200, avg_check: 1000, avg_guest: 500,
      cost: 40000, gross_profit: 60000, discount: 10000, surcharge: 300, discount_by_type: types.slice(0, 6) })),
    non_fiscal: Array.from({ length: nWo }, (_, i) => ({ type: `Списание ${i}`, category: i % 2 ? 'Учредительские столы' : 'Прочее', table: String(300 + i), count: 1, sum: 1000 + i })),
    promo_items: Array.from({ length: nPromo }, (_, i) => ({ label: `Стол ${i} · ПромоБезОплаты с длинным названием`, sum: 500 + i, count: 1 })),
    promo_total: 50000,
    unprinted: { sum: 1000, count: 2 },
    flags: Array.from({ length: nFlags }, (_, i) => ({ level: 'warn', text: 'Очень длинное предупреждение '.repeat(6) + i }))
  };
}
function testLength() {
  const link = 'https://svodka-tau.vercel.app/app/r/123456';
  const normal = reportText(heavy(2, 4, 2, 2, 1), link);
  assert.match(normal, /Чеков: 100  ·  Гостей: 200/, 'обычный день — этажи подробно');
  for (const args of [[2, 30, 40, 40, 6], [3, 60, 120, 120, 10], [9, 200, 500, 500, 50]]) {
    const o = heavy(...args);
    const text = reportText(o, link, 'Совет дня: '.repeat(100));
    assert.ok(text.length <= 4096, `длина ${text.length}`);
    assert.ok(text.length <= 3900, `с запасом: ${text.length}`);
    assert.match(text, /Итоги смены/);
    assert.match(text, /Выручка: <b>1\s234\s567\s₽<\/b>/);
    assert.match(text, /Полный отчёт в кабинете/);
    assert.match(text, /<b>1 этаж<\/b>/, 'этажи остаются хотя бы одной строкой');
    // HTML не порван: теги сбалансированы
    for (const tag of ['b', 'i', 'pre', 'a']) assert.equal((text.match(new RegExp(`<${tag}[ >]`, 'g')) || []).length, (text.match(new RegExp(`</${tag}>`, 'g')) || []).length, tag);
  }
  const huge = reportText(heavy(3, 60, 120, 120, 10), link);
  assert.match(huge, /<b>1 этаж<\/b>: /, 'при нехватке места этаж — одной строкой');
}

// 3) Чек с блюдами из двух залов — один этаж (где больше выручки); чеки этажей в сумме = итог
async function testSplitReceipt() {
  n = 800;
  const atoms = [
    sale(F1, 'Банковские карты', 3000, 0, '', { OrderNum: '900' }),
    sale(F2, 'Банковские карты', 1000, 0, '', { OrderNum: '900' }),
    sale(F2, 'Банковские карты', 2000, 0, '', { OrderNum: '901' })
  ];
  const o = await buildReport(fakeIiko(atoms), '2026-11-26', [{ id: '', name: 'Смок Дог Москва' }]);
  assert.ok(!o.errors, String(o.errors));
  assert.equal(o.totals.orders, 2);
  const [f1, f2] = o.by_floor;
  assert.equal(f1.orders, 1);
  assert.equal(f2.orders, 1);
  assert.equal(f1.revenue + f2.revenue, o.totals.revenue, 'выручка по строкам');
  assert.equal(f1.guests + f2.guests, o.totals.guests);
  // при равной выручке — меньший этаж
  n = 810;
  const tie = await buildReport(fakeIiko([sale(F2, 'Наличные', 1000, 0, '', { OrderNum: '950' }), sale(F1, 'Наличные', 1000, 0, '', { OrderNum: '950' })]), '2026-11-26', [{ id: '', name: 'Смок Дог Москва' }]);
  assert.deepEqual(tie.by_floor.map((x) => [x.floor, x.orders]), [['1', 1], ['2', 0]]);
}

// 4) Себестоимость по тому же правилу, что продажи: зал без этажа + подразделение «… 2 этаж» → 2 этаж
async function testCostByDept() {
  n = 850;
  const atoms = [
    sale(F1, 'Наличные', 1000),
    sale('Основной зал', 'Наличные', 2000, 0, '', { Department: 'Смок Дог 2 этаж' })
  ];
  const o = await buildReport(fakeIiko(atoms), '2026-11-26', null);
  assert.ok(!o.errors, String(o.errors));
  assert.deepEqual(o.by_floor.map((x) => [x.floor, x.revenue, x.cost]), [['1', 1000, 400], ['2', 2000, 800]]);
  assert.ok(o.by_floor.every((x) => x.gross_profit >= 0), 'нет «Этаж не указан» с отрицательной прибылью');
}

// 5 + 8) Нет номера чека: запрос скидок без детализации (этаж только из discountGroups), чеки — из iiko по залам
async function testNoReceiptFallback() {
  n = 870;
  const cols = COLS.filter((c) => c !== 'OrderNum');
  const atoms = [
    sale(F1, 'Банковские карты', 4000, 1000, 'LoonaLevel2'), sale(F1, 'Наличные', 1000), sale(F1, 'Наличные', 1000),
    sale(F2, 'Банковские карты', 2000, 200, 'LoonaFixedSumDiscount'),
    sale('Основной зал', 'Наличные', 500, 0, '', { Department: 'Смок Дог 2 этаж' })
  ];
  const o = await buildReport(fakeIiko(atoms, cols), '2026-11-26', [{ id: '', name: 'Смок Дог Москва' }]);
  assert.ok(!o.errors, String(o.errors));
  assert.equal(o.discount_details, undefined, 'детализации по чекам нет');
  const [f1, f2] = o.by_floor;
  assert.deepEqual([f1.revenue, f2.revenue], [5000, 2300], 'этаж по подразделению и без детализации');
  assert.deepEqual([f1.discount, f2.discount], [1000, 200]);
  assert.deepEqual([f1.orders, f2.orders], [3, 2], 'чеки из iiko, а не 0');
  assert.equal(o.by_floor.length, 2, 'нет «Этаж не указан»');
  assert.equal(f1.orders + f2.orders, o.totals.orders);
  assert.equal(f1.guests + f2.guests, o.totals.guests);
}

// 7) Доли этажей в сумме ровно 100%
function testShares() {
  assert.deepEqual(shares([1, 1, 1]), [0.334, 0.333, 0.333]);
  assert.equal(shares([413594, 74844]).reduce((s, x) => s + x, 0), 1);
  assert.deepEqual(fitTo([3, 3, 3], 7), [3, 2, 2]);
  const o = { day: '2026-11-26', totals: { revenue: 300, orders: 3, guests: 3 }, prev: {}, profit: {},
    by_floor: ['1', '2', '3'].map((floor) => ({ floor, revenue: 100, orders: 1, guests: 1, avg_check: 100, avg_guest: 100, discount: 0 })) };
  const text = reportText(o, null);
  const got = [...text.matchAll(/· (\d+,\d)%/g)].map((m) => Number(m[1].replace(',', '.')));
  assert.deepEqual(got, [33.4, 33.3, 33.3]);
}

(async () => {
  testFloorNames();
  testOldReport26();
  await testFloors();
  await testFallbackFromIiko();
  await testSurcharge();
  testLength();
  await testSplitReceipt();
  await testCostByDept();
  await testNoReceiptFallback();
  testShares();
  console.log('ok: floors tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
