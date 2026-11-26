const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

test('в /tg/ нет оплаты и есть экраны входа', () => {
  const html = read('public/tg/index.html');
  assert.doesNotMatch(html, /trio-bill/);
  assert.doesNotMatch(html, /guide\.js/);
  assert.doesNotMatch(html, /yookassa/i);
  assert.doesNotMatch(html, /оплат/i);
  assert.doesNotMatch(html, /trio-resto/);
  const guide = read('public/app/guide.js');
  assert.match(guide, /if \(window\.SV_TG\) return/);
  assert.match(guide, /Оплатить пакет/);
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

test('проверка пропусков читает tap и spec и не теряет код выхода', () => {
  const { spawnSync } = require('node:child_process');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-skip-'));
  const script = path.join(root, 'scripts/check-skipped.js');
  const tap = path.join(dir, 'tap.txt');
  const spec = path.join(dir, 'spec.txt');
  const bad = path.join(dir, 'bad.txt');
  const none = path.join(dir, 'none.txt');
  fs.writeFileSync(tap, '# tests 2\n# pass 2\n# fail 0\n# skipped 0\n');
  fs.writeFileSync(spec, 'ℹ tests 2\nℹ pass 2\nℹ fail 0\nℹ skipped 0\n');
  fs.writeFileSync(bad, 'ℹ skipped 1\n');
  fs.writeFileSync(none, '# tests 1\n# fail 0\n');
  assert.equal(spawnSync(process.execPath, [script, tap]).status, 0);
  assert.equal(spawnSync(process.execPath, [script, spec]).status, 0);
  assert.notEqual(spawnSync(process.execPath, [script, bad]).status, 0);
  assert.notEqual(spawnSync(process.execPath, [script, none]).status, 0);
  const yml = read('.github/workflows/test.yml');
  assert.match(yml, /set -o pipefail && npm test -- --test-reporter=tap \| tee test-out\.txt/);
  assert.match(yml, /node scripts\/check-skipped\.js test-out\.txt/);
  assert.doesNotMatch(yml, /grep -q '# skipped 0'/);
});
