const assert = require('node:assert/strict');
const { classification, rulesFromPrefs, DEFAULT_PROMO, DEFAULT_NON_FISCAL, isUnprintedCheque, normalize } = require('./sales-breakdown');
const { demoReport } = require('./demo');
const { reportText, discountRegistryText, discountTypes, percent, pct1, plural } = require('./text');

function testClassification() {
  const r = rulesFromPrefs();
  assert.equal(classification('', 'ПромоБезОплаты', null, r), 'promo');
  assert.equal(classification('ПромоБезОплаты', 'Карта', null, r), 'promo');
  for (const name of ['Андрей Михайлович', 'Маркетинг', 'Персонал', 'Представительская оплата', 'Расим', 'Захар']) {
    assert.equal(classification('', name, null, r), 'nonFiscal', name);
  }
  assert.equal(classification('', '334 Андрей Михайлович', null, r), 'nonFiscal');
  assert.equal(classification('', '88 Персонал', null, r), 'nonFiscal');
  assert.equal(classification('', '49 Представительская оплата', null, r), 'nonFiscal');
  assert.equal(normalize('334 Андрей Михайлович'), normalize('Андрей Михайлович'));
  assert.equal(normalize('88 Персонал'), normalize('Персонал'));
  assert.equal(classification('Луна', 'Банковская карта', 'true', r), 'regular');
  assert.equal(classification('', 'Банковская карта', 'false', r), 'regular');
  assert.equal(isUnprintedCheque('false'), true);
  assert.equal(isUnprintedCheque('true'), false);
  const custom = rulesFromPrefs({ non_fiscal_pay_types: ['Луна'], promo_pay_types: ['Спецпромо'] });
  assert.equal(classification('Луна', 'Карта', null, custom), 'nonFiscal');
  assert.equal(classification('', 'Спецпромо', null, custom), 'promo');
  assert.equal(classification('', 'Маркетинг', null, custom), 'regular');
  assert.ok(DEFAULT_PROMO.includes('ПромоБезОплаты'));
  assert.ok(DEFAULT_NON_FISCAL.includes('Надежда'));
  assert.ok(DEFAULT_NON_FISCAL.includes('334 Андрей Михайлович'));
  assert.ok(!DEFAULT_NON_FISCAL.some((x) => /промокод|съ[её]мка|сьёмка/i.test(x)));
}

function testPercents() {
  assert.equal(pct1(9.5), '9,5%');
  assert.equal(pct1(9), '9,0%');
  assert.equal(percent(9.5, 100), ' · 9,5%');
  assert.equal(percent(34, 100), ' · 34,0%');
}

function testPlural() {
  const form = (n) => plural(n, 'чек', 'чека', 'чеков');
  assert.equal(form(1), 'чек');
  assert.equal(form(2), 'чека');
  assert.equal(form(5), 'чеков');
  assert.equal(form(11), 'чеков');
  assert.equal(form(21), 'чек');
  assert.equal(form(22), 'чека');
}

function testDigest() {
  const day = '2026-11-20';
  const o = demoReport(day);
  o.profit = { cost: 42000, gross: 100000, expenses: 28000, profit: 72000, has_expenses: true };
  const types = discountTypes(o);
  const luna = types.find((x) => x.type === 'Луна');
  assert.ok(luna, 'Луна должна быть одним типом скидки');
  assert.equal(luna.count, 8);
  assert.ok(luna.sum > 0);
  assert.equal(o.totals.guests_include_non_fiscal, false);
  assert.equal(o.totals.avg_check, Math.round((o.totals.revenue / o.totals.orders) * 100) / 100);
  const text = reportText(o, 'https://svodka-egor12.vercel.app/app/r/12345');
  assert.match(text, /Итоги смены/);
  assert.match(text, /Скидки/);
  assert.match(text, /Луна/);
  assert.match(text, /Списания \/ За счёт заведения/);
  assert.match(text, /Не в кассе, не в скидках, не в выручке/);
  assert.match(text, /<pre>Тип оплаты\s+Стол\s+Чек\s+Сумма ₽/);
  assert.match(text, /— Учредительские столы —/);
  assert.match(text, /Андрей Михайлович\s+334\s+2\s+4 500/);
  assert.match(text, /Итого учредит\.\s+3\s+8 400/);
  assert.match(text, /Маркетинг\s+20\s+1\s+3 200/);
  assert.match(text, /ИТОГО\s+8\s+15 500<\/pre>/);
  assert.doesNotMatch(text, /Нефискальные/);
  assert.match(text, /Промо без оплаты/);
  assert.match(text, /Стол 27 · ПромоБезОплаты/);
  assert.doesNotMatch(text, /1 этаж: /);
  assert.match(text, /в выручке/);
  assert.match(text, /от суммы до скидок/);
  assert.match(text, /Без фискального чека, не из списка:[\s\S]*2 чека[\s\S]*в выручке, проверьте тип оплаты/);
  assert.match(text, /\n\nБез фискального чека, не из списка:/);
  const unp = text.indexOf('Без фискального чека');
  const promo = text.indexOf('Промо без оплаты');
  const nf = text.indexOf('Списания / За счёт заведения');
  assert.ok(nf >= 0 && unp > nf && promo > unp, 'строка без чека идёт после нефискальных и перед промо');
  assert.doesNotMatch(text, /2 чеков/);

  assert.match(text, /\/app\/r\/12345/);
  assert.doesNotMatch(text, /#\/r\//);
  assert.doesNotMatch(text, /чек №1800/);
  assert.doesNotMatch(text, /РЕЕСТР СКИДОК/);
  assert.match(text, /,\d%/);
  assert.ok(o.discount_details.length >= 8);
  const registry = discountRegistryText(o, 'https://example.com/app/r/1');
  assert.ok(registry.length >= 1, 'реестр по чекам остаётся доступен для кабинета/тестов');
  assert.ok(!text.includes('ФИНАНСЫ') && !text.includes('ВЫРУЧКА ПО ЭТАЖАМ'));
}

function testLinkAndMoney() {
  const o = demoReport('2026-11-21');
  const text = reportText(o, 'https://svodka-egor12.vercel.app/app/r/9');
  assert.ok(text.includes('href="https://svodka-egor12.vercel.app/app/r/9"'));
}

function testLunaExample() {
  const o = demoReport('2026-11-20');
  const row = o.discount_details.find((x) => x.type === 'Луна' && x.guest === 'Луна');
  assert.ok(row, 'в реестре Луна есть и как тип скидки, и как гость');
}

testClassification();
testPercents();
testPlural();
testDigest();
testLinkAndMoney();
testLunaExample();
console.log('ok: digest tests passed');
