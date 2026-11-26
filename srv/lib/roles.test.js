const test = require('node:test');
const assert = require('node:assert/strict');
const { staffNames, maskStaff } = require('./roles');
const { reportOpenLink } = require('./common');

test('имена сотрудников в тексте для Telegram становятся должностями', () => {
  const report = { waiters: [{ name: 'Анна Смирнова' }, { name: 'Борис' }], deletions: [{ waiter: 'Анна Смирнова' }] };
  const names = staffNames(report);
  const text = maskStaff('Удаление: Анна Смирнова. Чек: Борис.', names);
  assert.doesNotMatch(text, /Анна Смирнова/);
  assert.doesNotMatch(text, /Борис/);
  assert.match(text, /официант /);
});

test('ссылка утреннего отчёта открывает Mini App', () => {
  const prev = process.env.TG_BOT_USERNAME;
  process.env.TG_BOT_USERNAME = 'trio_svodka_bot';
  assert.equal(reportOpenLink('https://svodka-egor12.vercel.app', 'abc123'), 'https://t.me/trio_svodka_bot/app?startapp=r_abc123');
  process.env.TG_BOT_USERNAME = prev || '';
});
