const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

test('в /tg/ нет оплаты и есть экраны входа', () => {
  const html = read('public/tg/index.html');
  assert.doesNotMatch(html, /trio-bill/);
  assert.doesNotMatch(html, /yookassa/i);
  assert.match(html, /telegram-web-app\.js|tg\/boot\.js/);
  const boot = read('public/tg/boot.js');
  assert.match(boot, /Откройте в Telegram/);
  assert.match(boot, /telegram-web-app\.js/);
  const app = read('public/app/app.js');
  assert.match(app, /Регистрация только по приглашению/);
  assert.match(app, /function \(plan\)/);
  assert.match(app, /Подписка неактивна/);
  assert.match(app, /активен до/);
  assert.doesNotMatch(app.slice(app.indexOf('SV.tariffLine'), app.indexOf('function when')), /оплат|продл|yookassa/i);
  assert.match(read('public/legal/render.js'), /Вход через Telegram/);
  assert.match(read('public/legal/render.js'), /Егор Бондарев/);
  assert.match(read('public/app/session.js'), /localStorage\.removeItem\("sv_owner"\)|removeItem\("sv_owner"\)/);
});
