const normalize = (value) => String(value ?? '').normalize('NFKC').toLowerCase()
  .replace(/ё/g, 'е').replace(/[^а-яa-z0-9]/g, '');

const excluded = [
  'Алексей Р.Ш.', 'Андрей Михайлович', 'Антон бухгалтер', 'Захар', 'Маркетинг',
  'Надежда', 'Персонал', 'Представитьельская оплата', 'Представительская оплата',
  'Промокод Smoke', 'Расим', 'Сьёмка СММ', 'Съёмка СММ'
].map(normalize);
const promo = normalize('ПромоБезОплаты');

function classification(type, payment, fiscal) {
  const names = [normalize(type), normalize(payment)];
  if (names.includes(promo)) return 'promo';
  if (names.some((name) => excluded.includes(name)) || /^(false|no|нет|nonfiscal|нефискальный)$/.test(normalize(fiscal))) {
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

module.exports = { classification, floorOf, entityOf, paymentOf };
