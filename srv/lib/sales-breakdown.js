const normalize = (value) => String(value ?? '').normalize('NFKC').toLowerCase()
  .replace(/ё/g, 'е').replace(/[^а-яa-z0-9]/g, '');

// Значения по умолчанию — по типам оплаты iiko, не по номерам столов.
// Их можно переопределить в настройках кабинета (prefs.promo_pay_types / non_fiscal_pay_types).
const DEFAULT_PROMO = ['ПромоБезОплаты'];
const DEFAULT_NON_FISCAL = [
  'Алексей Р.Ш.', 'Андрей Михайлович', 'Антон бухгалтер', 'Захар', 'Маркетинг',
  'Надежда', 'Персонал', 'Представитьельская оплата', 'Представительская оплата',
  'Промокод Smoke', 'Расим', 'Сьёмка СММ', 'Съёмка СММ'
];

function parseList(value, fallback) {
  let items = fallback;
  if (Array.isArray(value) && value.length) items = value;
  else if (typeof value === 'string' && value.trim()) items = value.split(/\n|,/).map((s) => s.trim()).filter(Boolean);
  return items.map(normalize).filter(Boolean);
}

function rulesFromPrefs(prefs) {
  const p = prefs || {};
  return {
    promo: new Set(parseList(p.promo_pay_types, DEFAULT_PROMO)),
    nonFiscal: new Set(parseList(p.non_fiscal_pay_types, DEFAULT_NON_FISCAL))
  };
}

function classification(type, payment, fiscal, rules) {
  const r = rules || rulesFromPrefs();
  const names = [normalize(type), normalize(payment)];
  if (names.some((name) => r.promo.has(name))) return 'promo';
  if (names.some((name) => r.nonFiscal.has(name)) || /^(false|no|нет|nonfiscal|нефискальный)$/.test(normalize(fiscal))) {
    return 'nonFiscal';
  }
  return 'regular';
}

function floorOf(...names) {
  for (const name of names) {
    const label = String(name ?? '').toLowerCase();
    const floor = label.match(/(?:^|[^0-9])([12])\s*(?:[-–]?\s*(?:й|ый|ой)\s*)?этаж|этаж\s*([12])(?!\d)/);
    if (floor) return floor[1] || floor[2];
  }
  return 'unknown';
}

function entityOf(name) {
  const match = String(name ?? '').toUpperCase().match(/(?:^|[^А-ЯЁ])(ООО|ИП)(?=$|[^А-ЯЁ])/);
  return match ? match[1] : 'unknown';
}

function paymentOf(name) {
  const label = normalize(name);
  if ((/наличн|cash/.test(label) && /карт|card|эквайринг/.test(label)) ||
      /[+;,/]/.test(String(name ?? '')) && !/^р\s*\/\s*с$/i.test(String(name))) return 'unknown';
  if (/расч[её]тныйсч[её]т|безналичныйрасчет|^рс$|banktransfer/.test(label)) return 'bank';
  const cash = /^(cash|наличные|нал)$/.test(label);
  const card = /карт|эквайринг|card/.test(label);
  if (card && !/наличн/.test(label)) return 'card';
  if (cash) return 'cash';
  return 'unknown';
}

module.exports = {
  classification, floorOf, entityOf, paymentOf,
  rulesFromPrefs, normalize, DEFAULT_PROMO, DEFAULT_NON_FISCAL
};
