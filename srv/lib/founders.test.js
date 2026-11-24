// Учредительские столы и прочие «за счёт заведения» на смене 23.11 (по кассовому листу и выжимке Сводки 24.11).
// Фейковый iiko отдаёт атомарные строки OLAP и агрегирует их по запрошенным полям — как настоящий сервер.
const assert = require('node:assert/strict');
const { buildReport } = require('./report');
const { reportText } = require('./text');
const { nonFiscalOf, founderOf, rulesFromPrefs, isWriteoffGroup, splitPayName } = require('./sales-breakdown');

const COLS = ['DishDiscountSumInt', 'DishSumInt', 'UniqOrderId.OrdersCount', 'GuestNum', 'OrderWaiter.Name', 'PayTypes', 'PayTypes.Combo',
  'PayTypes.Group', 'PayTypes.IsPrintCheque', 'OrderDiscount.Type', 'Department', 'OrderNum', 'TableNum', 'CardOwner', 'CloseTime'];

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

let n = 100;
// В iiko оплата группы «За счет заведения» (WRITEOFF): DishSumInt = сумма чека, DishDiscountSumInt = 0, тип скидки пустой.
function writeoff(pay, table, sum, extra = {}) {
  return { OrderNum: String(n++), TableNum: table, PayTypes: pay, 'PayTypes.Combo': pay, 'PayTypes.Group': 'WRITEOFF', 'PayTypes.IsPrintCheque': 'false',
    'OrderDiscount.Type': '', DishSumInt: sum, DishDiscountSumInt: 0, GuestNum: 2, 'OrderWaiter.Name': 'Менеджер', Department: 'SMOKE DOG', ...extra };
}
function sale(pay, sum, disc = 0, type = '', extra = {}) {
  return { OrderNum: String(n++), TableNum: String(10 + (n % 20)), PayTypes: pay, 'PayTypes.Combo': pay, 'PayTypes.Group': /нал/i.test(pay) ? 'CASH' : 'CARD',
    'PayTypes.IsPrintCheque': 'true', 'OrderDiscount.Type': type, DishSumInt: sum, DishDiscountSumInt: sum - disc, GuestNum: 2,
    'OrderWaiter.Name': 'Официант', Department: 'SMOKE DOG', ...extra };
}

// Смена: 2 учредительских стола (Расим 17 540, Андрей Михайлович 18 870), фискальные скидки 9 584 (6 чеков LoonaLevel2),
// 582 «Скидка персонал 30%», 205 LoonaFixedSumDiscount, промо стол 27, наличные и карты.
function shiftAtoms(payNames = { rasim: 'Расим', andrey: 'Андрей Михайлович' }, group = 'WRITEOFF') {
  n = 100;
  const atoms = [
    writeoff(payNames.rasim, '338', 17540, { 'PayTypes.Group': group }),
    writeoff(payNames.andrey, '334', 18870, { 'PayTypes.Group': group }),
    sale('Наличные', 3200), sale('Банковская карта', 4000),
    sale('Банковская карта', 1940, 582, 'Скидка персонал 30%'),
    sale('Банковская карта', 2050, 205, 'LoonaFixedSumDiscount'),
    { ...writeoff('ПромоБезОплаты', '27', 2400), DishDiscountSumInt: 2400 }
  ];
  const loona = [1600, 1600, 1600, 1600, 1592, 1592];
  loona.forEach((d) => atoms.push(sale('Банковская карта', d * 4, d, 'LoonaLevel2')));
  for (let i = 0; i < 60; i++) atoms.push(sale(i % 3 ? 'Банковская карта' : 'Наличные', 2667));
  return atoms;
}

async function testShift() {
  const o = await buildReport(fakeIiko(shiftAtoms()), '2026-11-23', [{ id: '', name: 'SMOKE DOG' }]);
  assert.ok(!o.errors, String(o.errors));
  const types = Object.fromEntries(o.discount_by_type.map((x) => [x.type, x]));
  assert.equal(types['Тип не указан'], undefined, 'учредительские не попадают в «Тип не указан»');
  assert.equal(o.totals.discount, 9584 + 582 + 205);
  assert.equal(types.LoonaLevel2.count, 6);
  assert.equal(o.founders_total, 36410);
  assert.deepEqual(o.founders.map((x) => [x.name, x.sum, x.count]).sort(), [['Андрей М.', 18870, 1], ['Расим К.', 17540, 1]]);
  const rasim = o.non_fiscal.find((x) => x.type === 'Расим');
  assert.equal(rasim.table, '338');
  assert.equal(rasim.category, 'Учредительские столы');
  // в выручку не входят: выручка = фискальные после скидок + промо
  const fiscalNet = o.totals.discount_base - o.totals.discount;
  assert.equal(o.totals.revenue, fiscalNet + 2400);
  assert.equal(o.totals.discount_base, o.totals.gross - 36410 - 2400);
  assert.ok(!o.pay.some((p) => /Расим|Андрей/.test(p.name)), 'в оплатах (касса) их нет');
  const text = reportText(o, null);
  assert.doesNotMatch(text, /Тип не указан/);
  assert.match(text, /Списания \/ За счёт заведения/);
  assert.match(text, /Андрей Михайлович\s+334\s+1\s+18 870/);
  assert.match(text, /Расим\s+338\s+1\s+17 540/);
  assert.match(text, /Итого учредит\.\s+2\s+36 410/);
  assert.match(text, /ИТОГО\s+2\s+36 410/);
  assert.match(text, /Стол 27 · ПромоБезОплаты: 2\s400\s₽/);
  return text;
}

// Если имя типа оплаты в iiko написано иначе («338 Расим К.», «Андрей М. учредитель») — ловим по группе оплаты.
async function testUnknownNamesByGroup() {
  const o = await buildReport(fakeIiko(shiftAtoms({ rasim: 'Учредитель Расим К', andrey: 'Стол Андрея' })), '2026-11-23', []);
  assert.equal(o.founders_total, 17540, 'Расим опознан, «Стол Андрея» — без инициала → прочие');
  assert.equal(o.write_offs_total, 36410);
  assert.ok(!o.discount_by_type.some((x) => x.type === 'Тип не указан'));
}

// Нет поля PayTypes.Group (старый iiko) и имя не из списка: запасной признак — DiscountSum без типа скидки.
async function testNoGroupField() {
  const cols = COLS.filter((c) => c !== 'PayTypes.Group');
  const o = await buildReport(fakeIiko(shiftAtoms({ rasim: 'Расим К.', andrey: 'Андрей М.' }), cols), '2026-11-23', []);
  assert.equal(o.founders_total, 36410);
  assert.ok(!o.discount_by_type.some((x) => x.type === 'Тип не указан'));
  assert.equal(o.totals.discount, 10371);
}

// Тип оплаты в строке OLAP пустой: всё равно не скидки и не выручка, а «За счёт заведения» с пометкой.
async function testEmptyPayName() {
  const atoms = shiftAtoms().map((a) => a['PayTypes.Group'] === 'WRITEOFF' && a.PayTypes !== 'ПромоБезОплаты' ? { ...a, PayTypes: '', 'PayTypes.Combo': '' } : a);
  const o = await buildReport(fakeIiko(atoms), '2026-11-23', []);
  assert.equal(o.totals.discount, 10371);
  assert.equal(o.write_offs_total, 36410);
  assert.ok(o.non_fiscal.some((x) => x.type === 'Тип оплаты не указан'));
}

function testUnits() {
  const r = rulesFromPrefs();
  assert.equal(founderOf('338 Расим', r), 'Расим К.');
  assert.equal(founderOf('Андрей Михайлович', r), 'Андрей М.');
  assert.equal(founderOf('335 Алексей Р.Ш.', r), 'Алексей П.');
  assert.equal(founderOf('Андрей Сидоров', r), null);
  assert.equal(founderOf('Надежда', r), null);
  assert.ok(isWriteoffGroup('WRITEOFF'));
  assert.ok(isWriteoffGroup('За счет заведения'));
  assert.ok(!isWriteoffGroup('CARD'));
  assert.deepEqual(splitPayName('49 Представительская оплата'), { name: 'Представительская оплата', code: '49' });
  for (const pay of ['19 Антон бухгалтер', '336 Надежда', '20 Маркетинг', '88 Захар', '88 Персонал', '49 Представительская оплата']) {
    const x = nonFiscalOf({ type: '', payment: pay, gross: 1000, net: 0 }, r);
    assert.equal(x.category, 'За счёт заведения', pay);
    assert.equal(x.sum, 1000);
  }
  assert.equal(nonFiscalOf({ payment: 'ПромоБезОплаты', payGroup: 'WRITEOFF', gross: 1000, net: 1000 }, r), null, 'промо идёт в выручку');
  assert.equal(nonFiscalOf({ type: 'LoonaLevel2', payment: 'Банковская карта', payGroup: 'CARD', gross: 1000, net: 750 }, r), null);
  // смешанная оплата: часть картой, часть за счёт заведения — списание только на списанную часть
  const mix = nonFiscalOf({ type: '', payment: 'Банковская карта, 338 Расим', payGroup: '', gross: 5000, net: 2000 }, r);
  assert.equal(mix.sum, 3000); assert.equal(mix.rest, 2000); assert.equal(mix.founder, 'Расим К.');
  const custom = rulesFromPrefs({ founders: ['Ирина С.: 401 Ирина'] });
  assert.equal(founderOf('401 Ирина', custom), 'Ирина С.');
}

(async () => {
  testUnits();
  const text = await testShift();
  await testUnknownNamesByGroup();
  await testNoGroupField();
  await testEmptyPayName();
  if (process.env.SHOW) console.log(text);
  console.log('ok: founders tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
