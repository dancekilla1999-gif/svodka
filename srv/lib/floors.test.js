// Итоги смены по этажам: 1 и 2 этаж отдельно и в сумме равны общему итогу (жалоба 27.11: сводка не делила этажи).
const assert = require('node:assert/strict');
const { buildReport, floorTotals, fields } = require('./report');
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
  assert.equal(floorOf('Зал 1 этаж'), '1');
  assert.equal(floorOf('Зал 2 этаж'), '2');
  assert.equal(floorOf('2-й этаж'), '2');
  assert.equal(floorOf('Этаж 1'), '1');
  assert.equal(floorOf('Веранда'), 'unknown');
  assert.equal(floorOf('', 'Смок Дог 2 этаж'), '2');
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

(async () => {
  testFloorNames();
  testOldReport26();
  await testFloors();
  await testFallbackFromIiko();
  console.log('ok: floors tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
