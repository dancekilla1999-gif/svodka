// В текстах, которые уходят в Telegram, имена сотрудников заменяются на должность.
// Полные имена остаются в кабинете.
function addName(set, value) {
  const t = String(value || '').trim();
  if (t.length < 3) return;
  if (t === '—' || /^без\s/i.test(t)) return;
  set.add(t);
}

function staffNames(report) {
  const names = new Set();
  const o = report || {};
  (o.waiters || []).forEach((w) => addName(names, w && (w.name || w.waiter)));
  (o.deletions || []).forEach((d) => addName(names, d && d.waiter));
  (o.discounts || []).forEach((d) => addName(names, d && d.waiter));
  (o.discount_details || []).forEach((d) => {
    addName(names, d && d.waiter);
    addName(names, d && d.authorized_by);
  });
  return [...names].sort((a, b) => b.length - a.length);
}

function maskStaff(text, names) {
  let out = String(text || '');
  (names || []).forEach((name, i) => {
    out = out.split(name).join('официант ' + (i + 1));
  });
  return out;
}

module.exports = { staffNames, maskStaff };
