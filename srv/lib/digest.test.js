const assert = require('node:assert/strict');
const { classification, rulesFromPrefs, DEFAULT_PROMO, DEFAULT_NON_FISCAL } = require('./sales-breakdown');
const { demoReport } = require('./demo');
const { reportText, discountRegistryText, discountTypes } = require('./text');

function testClassification() {
  const r = rulesFromPrefs();
  assert.equal(classification('', 'ПромоБезОплаты', null, r), 'promo');
  assert.equal(classification('ПромоБезОплаты', 'Карта', null, r), 'promo');
  for (const name of ['Андрей Михайлович', 'Маркетинг', 'Персонал', 'Представительская оплата', 'Представитьельская оплата', 'Расим', 'Захар']) {
    assert.equal(classification('', name, null, r), 'nonFiscal', name);
  }
  assert.equal(classification('Луна', 'Банковская карта', 'true', r), 'regular');
  assert.equal(classification('', 'Банковская карта', 'false', r), 'nonFiscal');
  const custom = rulesFromPrefs({ non_fiscal_pay_types: ['Луна'], promo_pay_types: ['Спецпромо'] });
  assert.equal(classification('Луна', 'Карта', null, custom), 'nonFiscal');
  assert.equal(classification('', 'Спецпромо', null, custom), 'promo');
  assert.equal(classification('', 'Маркетинг', null, custom), 'regular');
  assert.ok(DEFAULT_PROMO.includes('ПромоБезОплаты'));
  assert.ok(DEFAULT_NON_FISCAL.includes('Надежда'));
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
  const text = reportText(o, 'https://svodka-egor12.vercel.app/app/r/12345');
  assert.match(text, /Итоги смены/);
  assert.match(text, /Скидки/);
  assert.match(text, /Луна/);
  assert.match(text, /Нефискальные \(за счёт заведения\)/);
  assert.match(text, /Андрей Михайлович/);
  assert.match(text, /Маркетинг/);
  assert.match(text, /Промо без оплаты/);
  assert.match(text, /в выручке/);
  assert.match(text, /\/app\/r\/12345/);
  assert.doesNotMatch(text, /#\/r\//);
  // Не должно быть списка каждого чека Луны
  assert.doesNotMatch(text, /чек №1800/);
  assert.doesNotMatch(text, /РЕЕСТР СКИДОК/);
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

testClassification();
testDigest();
testLinkAndMoney();
console.log('ok: digest tests passed');
