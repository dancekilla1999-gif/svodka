// В текстах, которые уходят в Telegram, имя сотрудника заменяется на его должность.
// Официант остаётся официантом, кассир — кассиром. Полные имена остаются в кабинете.

function cleanName(value) {
  const t = String(value || '').trim();
  if (t.length < 2) return '';
  if (t === '—' || /^без\s/i.test(t)) return '';
  return t;
}

function roleOf(person, fallback) {
  const raw = String((person && (person.role || person.position || person.job)) || fallback || '').toLowerCase();
  if (/кассир|cashier/.test(raw)) return 'кассир';
  if (/официант|waiter|staff/.test(raw)) return 'официант';
  return fallback || 'официант';
}

function addPerson(map, name, role) {
  const t = cleanName(name);
  if (!t) return;
  const prev = map.get(t);
  if (!prev || (prev === 'официант' && role === 'кассир')) map.set(t, role);
}

function walkReport(map, report) {
  const o = report && report.data ? report.data : (report || {});
  (o.cashiers || []).forEach((c) => addPerson(map, c && (c.name || c.cashier || c), 'кассир'));
  (o.waiters || []).forEach((w) => addPerson(map, w && (w.name || w.waiter), roleOf(w, 'официант')));
  (o.deletions || []).forEach((d) => addPerson(map, d && d.waiter, roleOf(d, 'официант')));
  (o.discounts || []).forEach((d) => addPerson(map, d && d.waiter, roleOf(d, 'официант')));
  (o.discount_details || []).forEach((d) => {
    addPerson(map, d && d.waiter, roleOf(d, 'официант'));
    if (d && d.authorized_by) addPerson(map, d.authorized_by, map.has(cleanName(d.authorized_by)) ? map.get(cleanName(d.authorized_by)) : 'кассир');
  });
}

function rosterFrom(source) {
  const map = new Map();
  const root = source || {};
  const reports = Array.isArray(root.reports) ? root.reports : null;
  if (reports) reports.forEach((r) => walkReport(map, r));
  else walkReport(map, root);
  (root.insights || []).forEach((i) => {
    const staff = i && i.data && i.data.staff;
    (staff || []).forEach((w) => addPerson(map, w && w.name, roleOf(w, 'официант')));
  });
  return [...map.entries()].map(([name, role]) => ({ name, role }));
}

function labelsFor(roster) {
  const people = (roster || []).map((item) => {
    if (typeof item === 'string') return { name: item, role: 'официант' };
    return { name: item.name, role: item.role === 'кассир' ? 'кассир' : 'официант' };
  }).filter((item) => cleanName(item.name));
  const numbered = [];
  ['кассир', 'официант'].forEach((role) => {
    const group = people.filter((p) => p.role === role).sort((a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name, 'ru'));
    group.forEach((p, i) => numbered.push({ name: p.name, label: role + ' ' + (i + 1) }));
  });
  numbered.sort((a, b) => b.name.length - a.name.length);
  return numbered;
}

function escapeReg(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Окончания падежей. Длинные раньше коротких, чтобы «ой» не схлопывалось в «о».
const CASE_ENDING = '(?:ою|ею|ами|ями|ой|ей|ом|ем|ём|ах|ях|ов|ев|ёв|а|я|у|ю|е|ы|и|о)?';

function partInner(part) {
  const lower = String(part || '').toLocaleLowerCase('ru-RU');
  let stem = lower;
  if (lower.length >= 4 && /[ая]$/u.test(lower)) stem = lower.slice(0, -1);
  else if (lower.length >= 4 && /[ьй]$/u.test(lower)) stem = lower.slice(0, -1);
  return escapeReg(stem) + CASE_ENDING;
}

function phraseInners(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { phrases: [], tokens: [] };
  const forward = parts.map(partInner).join('\\s+');
  const phrases = [forward];
  if (parts.length > 1) phrases.push(parts.slice().reverse().map(partInner).join('\\s+'));
  return { phrases, tokens: parts.map(partInner) };
}

function replaceMasked(text, inner, label) {
  const re = new RegExp('(?<![А-Яа-яЁёA-Za-z])(?:' + inner + ')(?![А-Яа-яЁёA-Za-z])', 'giu');
  return text.replace(re, label);
}

function maskStaff(text, roster) {
  let out = String(text || '');
  const people = labelsFor(roster).map((item) => Object.assign({ forms: phraseInners(item.name) }, item));
  people.forEach((item) => {
    item.forms.phrases.forEach((inner) => { out = replaceMasked(out, inner, item.label); });
  });
  people.forEach((item) => {
    item.forms.tokens.forEach((inner) => { out = replaceMasked(out, inner, item.label); });
  });
  return out;
}

function maskValue(value, roster) {
  if (typeof value === 'string') return maskStaff(value, roster);
  if (Array.isArray(value)) return value.map((item) => maskValue(item, roster));
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach((key) => { out[key] = maskValue(value[key], roster); });
    return out;
  }
  return value;
}

function staffNames(source) {
  return rosterFrom(source).map((person) => person.name);
}

module.exports = { rosterFrom, maskStaff, maskValue, labelsFor, staffNames };
