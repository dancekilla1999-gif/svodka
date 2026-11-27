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

// Денежный тип оплаты: наличные, карта, СБП, безнал — по нему деньги в кассе/на счёте есть.
const MONEY_PAY = /нал|cash|карт|card|visa|виза|master|мастер|maestro|мир|сбп|sbp|qr|эквайр|безнал|сч[её]т|перевод|transfer|сбер|sber|тинькоф|tinkoff|т-?банк|альфа|apple|google|samsung|pay|юкасс|yookassa|онлайн/;
function isMoneyPay(payment) {
  const label = String(payment ?? '').normalize('NFKC').toLowerCase().replace(/ё/g, 'е');
  return !!label.trim() && MONEY_PAY.test(label);
}

// Строка продаж → «Списания / За счёт заведения» или null (обычная продажа или промо).
// row: { type, payment, payGroup, fiscal, gross, net, table, guest }.
// Признаки списания, по порядку: тип оплаты из списка нефискальных (list); группа оплаты «За счет заведения»
// = WRITEOFF (group); «учредит» в типе оплаты/столе (word); запасной (no-revenue) — в чеке нет денег (net≈0),
// тип скидки пустой и тип оплаты не денежный. Чек, частично оплаченный деньгами, со скидкой без типа
// остаётся в «Скидках» строкой «Тип не указан — проверить».
function nonFiscalOf(row, rules) {
  const r = rules || rulesFromPrefs();
  const type = String(row.type ?? '').trim();
  const payment = String(row.payment ?? '').trim();
  const gross = Number(row.gross) || 0, net = Number(row.net) || 0;
  const base = classification(type, payment, row.fiscal, r);
  if (base === 'promo') return null;
  const byList = base === 'nonFiscal';
  const byGroup = isWriteoffGroup(row.payGroup);
  const founderWord = [payment, type, row.table].some((v) => FOUNDER_WORD.test(normalize(v)));
  const noRevenue = !type && gross > 0 && Math.abs(net) <= 0.009 && !isMoneyPay(payment);
  if (!byList && !byGroup && !founderWord && !noRevenue) return null;
  const listedType = classification(type, '', null, r) === 'nonFiscal';
  const raw = (byList && listedType ? type : payment) || type || '';
  const { name } = splitPayName(raw);
  // По гостю (карте) учредителя ищем только при явном признаке list/group — иначе тёзка с картой попадёт в учредители.
  const founder = founderOf(raw, r) || ((byList || byGroup) ? founderOf(row.guest, r) : null);
  const category = founder || founderWord ? FOUNDERS_CATEGORY : HOUSE_CATEGORY;
  const table = String(row.table ?? '').trim();
  const label = name || ((byList || byGroup) ? String(row.guest ?? '').trim() : '') || 'Тип оплаты не указан';
  return { name: label, category, founder, table, sum: gross, rest: 0, reason: byList ? 'list' : byGroup ? 'group' : founderWord ? 'word' : 'no-revenue' };
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

// Этаж по названию зала (RestaurantSection) или подразделения: «Зал 1 этаж», «2-й этаж», «2 эт.», «Этаж №2», «Этаж-2»,
// «на втором этаже», «Первый этаж». Не этаж: «Зал 12» (нет слова «этаж»), «12 этаж» / «Этаж 21» (только этажи 1–9),
// «-1 этаж» (цоколь) и «1–2 этаж» (диапазон) — такие залы уходят в «Этаж не указан».
const FLOOR_WORDS = [[/^перв/, '1'], [/^втор/, '2'], [/^трет/, '3'], [/^четв[её]рт/, '4'], [/^пят/, '5']];
const FLOOR_WORD = '(?:этаж(?:а|е|ом|у|и|ей)?|эт\\.?)(?![а-я])';
const FLOOR_BEFORE = new RegExp(`(^|[^0-9\\-–—.,/])([1-9])(?![0-9]|\\s*[\\-–—]\\s*[0-9])\\s*(?:-?\\s*(?:й|ый|ой|ий|м|го|ом)(?![а-я]))?\\s*${FLOOR_WORD}`);
const FLOOR_AFTER = new RegExp(`(?:^|[^а-я])этаж(?:а|е|ом|у|и|ей)?(?:\\s*(?:№|no\\.?|#|:)\\s*|-|\\s*)([1-9])(?![0-9]|\\s*[\\-–—]\\s*[0-9])`);
const FLOOR_TEXT = new RegExp(`(?:^|[^а-я])([а-я]+)\\s+${FLOOR_WORD}`);
function floorOf(...names) {
  for (const name of names) {
    const label = String(name ?? '').normalize('NFKC').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
    if (!label.trim()) continue;
    const before = label.match(FLOOR_BEFORE);
    if (before && !/[\-–—]\s*$/.test(label.slice(0, before.index + before[1].length))) return before[2];
    const after = label.match(FLOOR_AFTER);
    if (after) return after[1];
    const text = label.match(FLOOR_TEXT);
    if (text) for (const [re, floor] of FLOOR_WORDS) if (re.test(text[1])) return floor;
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
  classification, floorOf, entityOf, paymentOf, isUnprintedCheque, founderOf, nonFiscalOf, isWriteoffGroup, isMoneyPay, splitPayName,
  rulesFromPrefs, normalize, DEFAULT_PROMO, DEFAULT_NON_FISCAL, DEFAULT_FOUNDERS, FOUNDERS_CATEGORY, HOUSE_CATEGORY
};
