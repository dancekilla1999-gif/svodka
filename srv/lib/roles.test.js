const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { staffNames, maskStaff, rosterFrom } = require('./roles');
const { reportOpenLink } = require('./common');
const A = require('./agents');

test('имена сотрудников в тексте для Telegram становятся должностями', () => {
  const report = { waiters: [{ name: 'Анна Смирнова' }, { name: 'Борис' }], deletions: [{ waiter: 'Анна Смирнова' }] };
  const names = staffNames(report);
  const text = maskStaff('Удаление: Анна Смирнова. Чек: Борис.', names);
  assert.doesNotMatch(text, /Анна Смирнова/);
  assert.doesNotMatch(text, /Борис/);
  assert.match(text, /официант /);
});

test('кассир маскируется кассиром, официант — официантом, на всех каналах Telegram', () => {
  const report = {
    waiters: [{ name: 'Анна Смирнова' }, { name: 'Борис Козлов' }],
    cashiers: [{ name: 'Кира Петрова' }],
    deletions: [{ waiter: 'Анна Смирнова' }],
    flags: [{ text: 'Касса Кира Петрова' }]
  };
  const roster = rosterFrom(report);
  const morning = maskStaff('Удаление: Анна Смирнова. Касса: Кира Петрова. Чек: Борис Козлов.', roster);
  assert.match(morning, /официант 1/);
  assert.match(morning, /кассир 1/);
  assert.doesNotMatch(morning, /Анна Смирнова|Борис Козлов|Кира Петрова/);

  const weekly = maskStaff(A.tgWeekly(
    { data: { period: { label: '1–7' } }, text: 'Похвалить Анна Смирнова. Касса: Кира Петрова.' },
    { data: { pnl: { revenue: 1000 } } },
    null
  ), roster);
  assert.doesNotMatch(weekly, /Анна Смирнова|Кира Петрова/);
  assert.match(weekly, /официант /);
  assert.match(weekly, /кассир /);

  const weekCmd = maskStaff('Персонал: Анна Смирнова, касса Кира Петрова', roster);
  assert.doesNotMatch(weekCmd, /Анна Смирнова|Кира Петрова/);
  assert.match(weekCmd, /кассир 1/);

  const ctx = { reports: [{ day: '2026-11-01', data: report }], insights: [{ agent: 'staff', title: 'Зал', text: 'Анна Смирнова', data: { items: [{ text: 'Анна Смирнова' }] } }] };
  const compact = JSON.stringify(A.compactCtx(ctx));
  assert.doesNotMatch(compact, /Анна Смирнова|Борис Козлов|Кира Петрова/);
  assert.match(compact, /официант /);
  assert.match(compact, /кассир /);
  const ai = maskStaff('Анна Смирнова молодец, Кира Петрова на кассе', roster);
  assert.doesNotMatch(ai, /Анна Смирнова|Кира Петрова/);

  const root = path.join(__dirname, '../..');
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
  assert.match(read('srv/lib/pipeline.js'), /maskStaff\(reportText/);
  assert.match(read('srv/lib/pipeline.js'), /maskStaff\(weekly/);
  assert.match(read('srv/api/tg.js'), /maskStaff\(insightText/);
  assert.match(read('srv/api/tg.js'), /maskStaff\(ans\.text/);
  assert.match(read('srv/lib/agents.js'), /maskValue\(body, roster\)/);
  assert.match(read('public/legal/render.js'), /кассир 1/);
  assert.match(read('public/legal/render.js'), /недельный итог/);
});

test('ссылка утреннего отчёта открывает Mini App', () => {
  const prev = process.env.TG_BOT_USERNAME;
  process.env.TG_BOT_USERNAME = 'trio_svodka_bot';
  assert.equal(reportOpenLink('https://svodka-egor12.vercel.app', 'abc123'), 'https://t.me/trio_svodka_bot/app?startapp=r_abc123');
  process.env.TG_BOT_USERNAME = prev || '';
});
