const normalize = (value) => String(value ?? '').normalize('NFKC').toLowerCase()
  .replace(/ё/g, 'е')
  .replace(/^[\s./-]*\d+[\s./-]*/, '')
  .replace(/[^а-яa-z0-9]/g, '');

// Значения по умолчанию — 9 типов Егора, в двух написаниях: с номером из iiko и без.
// Их можно переопределить в настройках кабинета (prefs.promo_pay_types / non_fiscal_pay_types).
const DEFAULT_PROMO = ['ПромоБезОплаты'];
const DEFAULT_NON_FISCAL = [
  'Андрей Михайлович', '334 Андрей Михайлович',
  'Алексей Р.Ш.', '335 Алексей Р.Ш.',
  'Расим', '338 Расим',
  'Представительская оплата', '49 Представительская оплата',
  'Антон бухгалтер', '19 Антон бухгалтер',
  'Надежда', '336 Надежда',
  'Маркетинг', '20 Маркетинг',
  'Захар', '88 Захар',
  'Персонал', '88 Персонал'
];

function parseList(value, fallback) {
  let items = fallback;
  if (Array.isArray(value) && value.length) items = value;
  else if (typeof value === 'string' && value.trim()) items = value.split(/\n|,/).map((s) => s.trim()).filter(Boolean);
  return items.map(normalize).filter(Boolean);
}

// Учредители — как на кассовом листе менеджера («Расим К.», «Алексей П.», «Андрей М.») и их типы оплаты в iiko.
// Формат: «Имя на листе: написания в iiko через запятую». Переопределяется prefs.founders.
// «Алексей Р.Ш.» ↔ «Алексей П.» — допущение, подтверждается у Егора.
const DEFAULT_FOUNDERS = [
  'Расим К.: Расим, 338 Расим',
  'Алексей П.: Алексей Р.Ш., 335 Алексей Р.Ш.',
  'Андрей М.: Андрей Михайлович, 334 Андрей Михайлович'
];
const FOUNDERS_CATEGORY = 'Учредительские столы';
const HOUSE_CATEGORY = 'За счёт заведения';
const FOUNDER_WORD = /учредит/;
// Группа оплаты iiko «За счет заведения» (PayTypes.Group = WRITEOFF): денег в кассе нет.
const WRITEOFF_GROUP = /^writeoff$|^write_off$|засчетзаведения|списан/;

function words(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/ё/g, 'е')
    .replace(/[^а-яa-z0-9]+/g, ' ').trim().split(' ').filter((w) => w && !/^\d+$/.test(w));
}

function parseFounders(value) {
  let items = DEFAULT_FOUNDERS;
  if (Array.isArray(value) && value.length) items = value;
  else if (typeof value === 'string' && value.trim()) items = value.split(/\n/).map((s) => s.trim()).filter(Boolean);
  return items.map((item) => {
    if (item && typeof item === 'object') return { name: String(item.name || '').trim(), aliases: (item.aliases || []).map(String) };
    const [name, rest] = String(item).split(':');
    return { name: name.trim(), aliases: rest ? rest.split(',').map((s) => s.trim()).filter(Boolean) : [] };
  }).filter((x) => x.name).map((x) => {
    const w = words(x.name);
    return { name: x.name, first: w[0] || '', initial: (w[1] || '').slice(0, 1), aliases: new Set([x.name, ...x.aliases].map(normalize).filter(Boolean)) };
  });
}

function rulesFromPrefs(prefs) {
  const p = prefs || {};
  return {
    promo: new Set(parseList(p.promo_pay_types, DEFAULT_PROMO)),
    nonFiscal: new Set(parseList(p.non_fiscal_pay_types, DEFAULT_NON_FISCAL)),
    founders: parseFounders(p.founders)
  };
}

// Кто из учредителей упомянут в строке: написание из списка или «Имя» + совпадающий инициал фамилии
// («Расим», «338 Расим», «Учредитель Расим К.», «Андрей Михайлович» → «Андрей М.»).
function founderOf(value, rules) {
  const r = rules || rulesFromPrefs();
  const text = String(value ?? '').trim();
  if (!text) return null;
  const n = normalize(text);
  for (const f of r.founders) if (f.aliases.has(n)) return f.name;
  const w = words(text);
  for (const f of r.founders) {
    const i = w.indexOf(f.first);
    if (!f.first || i < 0) continue;
    const next = w[i + 1];
    if (!f.initial || !next || next.startsWith(f.initial)) return f.name;
  }
  return null;
}

function isWriteoffGroup(group) { return WRITEOFF_GROUP.test(normalize(group)); }

// Название типа оплаты без номера («338 Расим» → «Расим») и номер стола/кода из названия.
function splitPayName(value) {
  const s = String(value ?? '').trim();
  const m = s.match(/^\s*(\d+)[\s.)-]+(.+)$/);
  return m ? { name: m[2].trim(), code: m[1] } : { name: s, code: '' };
}

// Строка продаж → «Списания / За счёт заведения» или null (обычная продажа или промо).
// row: { type, payment, payGroup, fiscal, gross, net, table, guest }.
// Признаки списания, по порядку: тип оплаты из списка нефискальных; группа оплаты «За счет заведения»
// (WRITEOFF); тип оплаты/стол со словом «учредит»; запасной — сумма ушла в DiscountSum без типа скидки
// (так iiko отражает оплату «за счёт заведения», из-за этого раньше и было «Тип не указан»).
function nonFiscalOf(row, rules) {
  const r = rules || rulesFromPrefs();
  const type = String(row.type ?? '').trim();
  const payment = String(row.payment ?? '').trim();
  const gross = Number(row.gross) || 0, net = Number(row.net) || 0;
  const base = classification(type, payment, row.fiscal, r);
  if (base === 'promo') return null;
  const writeOff = gross - net;
  const byGroup = isWriteoffGroup(row.payGroup);
  const founderWord = [payment, type, row.table].some((v) => FOUNDER_WORD.test(normalize(v)));
  const noRevenue = !type && gross > 0 && writeOff > 0.009;
  if (base !== 'nonFiscal' && !byGroup && !founderWord && !noRevenue) return null;
  const listedType = classification(type, '', null, r) === 'nonFiscal';
  const raw = (base === 'nonFiscal' && listedType ? type : payment) || type || '';
  const { name, code } = splitPayName(raw);
  const founder = founderOf(raw, r) || ((founderWord || byGroup || noRevenue) ? founderOf(row.guest, r) : null);
  const category = founder || founderWord ? FOUNDERS_CATEGORY : HOUSE_CATEGORY;
  const table = String(row.table ?? '').trim() || code;
  const label = name || (String(row.guest ?? '').trim()) || 'Тип оплаты не указан';
  // Весь чек за счёт заведения → вся сумма до скидки; смешанная оплата без типа скидки → только списанная часть.
  const whole = base === 'nonFiscal' || byGroup || founderWord;
  return { name: label, category, founder, table, sum: whole ? gross : writeOff, rest: whole ? 0 : net, reason: base === 'nonFiscal' ? 'list' : byGroup ? 'group' : founderWord ? 'word' : 'no-revenue' };
}

function isUnprintedCheque(fiscal) {
  if (fiscal == null || fiscal === '') return false;
  if (fiscal === false || fiscal === 0) return true;
  const s = String(fiscal).normalize('NFKC').toLowerCase().replace(/ё/g, 'е').trim();
  return /^(false|0|no|нет|nonfiscal|нефискальный)$/.test(s);
}

function classification(type, payment, fiscal, rules) {
  const r = rules || rulesFromPrefs();
  const names = [normalize(type), normalize(payment)];
  if (names.some((name) => r.promo.has(name))) return 'promo';
  if (names.some((name) => r.nonFiscal.has(name))) return 'nonFiscal';
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
  classification, floorOf, entityOf, paymentOf, isUnprintedCheque, founderOf, nonFiscalOf, isWriteoffGroup, splitPayName,
  rulesFromPrefs, normalize, DEFAULT_PROMO, DEFAULT_NON_FISCAL, DEFAULT_FOUNDERS, FOUNDERS_CATEGORY, HOUSE_CATEGORY
};
