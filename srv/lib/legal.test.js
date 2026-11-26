const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const placeholders = [
  '[УКАЖИТЕ ПОЛНОЕ НАИМЕНОВАНИЕ]',
  '[УКАЖИТЕ ИНН]',
  '[УКАЖИТЕ ОГРН]',
  '[УКАЖИТЕ ЮРИДИЧЕСКИЙ АДРЕС]',
  '[УКАЖИТЕ EMAIL]',
  '[УКАЖИТЕ ТЕЛЕФОН]',
  '[УКАЖИТЕ РЕГИОН SUPABASE]',
  '[УКАЖИТЕ НОМЕР УВЕДОМЛЕНИЯ РКН]',
  '[УКАЖИТЕ УВЕДОМЛЕНИЕ РКН О ТРАНСГРАНИЧНОЙ ПЕРЕДАЧЕ]',
  '[УКАЖИТЕ СУД]'
];

function testConfig() {
  const op = read('public/legal/operator.js');
  placeholders.forEach((p) => assert.ok(op.includes(p), p));
  const render = read('public/legal/render.js');
  placeholders.forEach((p) => assert.ok(!render.includes(p), 'плейсхолдер должен жить только в operator.js: ' + p));
  assert.match(render, /152-ФЗ/);
  assert.match(render, /1 сентября 2025/);
  assert.match(render, /1 990 ₽/);
  assert.match(render, /2 990 ₽/);
  assert.match(render, /4 990 ₽/);
  assert.match(render, /7 дней/);
  assert.match(render, /ст\. 32/);
  assert.match(render, /Supabase/);
  assert.match(render, /Vercel/);
  assert.match(render, /sv_owner/);
  assert.match(render, /function edition\(/);
  assert.doesNotMatch(render, /C\.updated\) \+ "/);
  assert.match(render, /table-scroll/);
  assert.match(render, /data-label/);
  assert.match(render, /две разные галочки/);
  assert.doesNotMatch(render, /26\.1/);
  assert.doesNotMatch(render, /платёжная сторона/);
  assert.doesNotMatch(render, /на территории России/);
  assert.doesNotMatch(render, /хранятся в России/);
  assert.match(render, /США/);
  assert.match(render, /ЮKassa/);
  assert.match(render, /почтовый сервис/);
  assert.match(render, /самостоятельный получатель/);
  assert.match(render, /IP-адрес/);
  assert.match(render, /5 990 ₽/);
  assert.match(render, /за 10 календарных дней/);
  assert.match(render, /ст\. 19/);
  assert.match(render, /утечк/);
  assert.match(render, /Первые 7 дней — бесплатно, карта не нужна\. В эти дни открыты все функции и все агенты\./);
  assert.match(render, /служебная cookie Vercel/);
}

function testLinks() {
  const files = [
    'public/index.html',
    'public/js/main.js',
    'public/app/trio-bill.js',
    'vercel.json'
  ];
  const blob = files.map(read).join('\n');
  assert.doesNotMatch(blob, /trio-resto-egor12\.vercel\.app\/(offer|privacy|consent|cookies)/);
  assert.match(read('public/index.html'), /href="\/legal\/privacy"/);
  assert.match(read('public/index.html'), /href="\/legal\/consent"/);
  assert.match(read('public/index.html'), /href="\/legal\/cookies"/);
  assert.match(read('public/index.html'), /href="\/legal\/offer"/);
  assert.match(read('public/js/main.js'), /href="\/legal\/cookies"/);
  const bill = read('public/app/trio-bill.js');
  assert.match(bill, /\/legal\/offer/);
  assert.match(bill, /\/legal\/consent/);
  assert.match(bill, /\/legal\/privacy/);
  assert.match(bill, /\/legal\/cookies/);
  assert.match(bill, /tb_pay_consent/);
  assert.match(bill, /p_offer: true, p_consent: true, p_doc_version/);
  assert.doesNotMatch(bill, /tb_agree/);
  assert.doesNotMatch(bill, /if \(!offer \|\| !consent\) return/);
  const app = read('public/app/app.js');
  ['/legal/offer', '/legal/privacy', '/legal/consent', '/legal/cookies'].forEach((href) => assert.match(app, new RegExp(href.replace(/\//g, '\\/'))));
  assert.match(app, /sv_offer/);
  assert.match(app, /sv_consent/);
  assert.match(app, /p_offer: true, p_consent: true, p_doc_version: docVersion\(\)/);
  assert.match(app, /disabled: mode === "register"/);
  assert.match(app, /operatorGaps/);
  assert.match(read('public/index.html'), /operator\.js/);
  assert.match(read('public/index.html'), /operator-mail/);
  assert.doesNotMatch(read('public/index.html'), /данные остаются в России/);
  const sql = read('supabase/migrations/20261126140000_legal_consent.sql');
  assert.match(sql, /sv_legal_consent/);
  assert.match(sql, /user_agent/);
  assert.match(sql, /x-forwarded-for/);
  assert.match(sql, /sv_register/);
  assert.match(sql, /sv_invoice/);
  assert.match(sql, /Нужно принять оферту и дать согласие/);
  assert.match(read('vercel.json'), /\/legal\/:doc/);
}

function testOperatorGate() {
  const { spawnSync } = require('node:child_process');
  const warn = spawnSync('bash', ['build.sh'], { cwd: root, encoding: 'utf8' });
  assert.equal(warn.status, 0, warn.stderr);
  assert.match(warn.stderr, /WARNING:.*\[УКАЖИТЕ/);
  const fail = spawnSync('bash', ['build.sh'], {
    cwd: root,
    encoding: 'utf8',
    env: Object.assign({}, process.env, { REQUIRE_OPERATOR: '1' })
  });
  assert.notEqual(fail.status, 0);
  assert.match(fail.stderr, /плейсхолдеры/);
}

testConfig();
testLinks();
testOperatorGate();
console.log('ok: legal pages');
