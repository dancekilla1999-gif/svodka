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
  assert.match(render, /не на чём/);
  assert.doesNotMatch(render, /не на чем/);
  assert.match(render, /две разные галочки/);
  assert.match(render, /Статья 26\.1/);
  assert.doesNotMatch(render, /платёжная сторона/);
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
  assert.match(bill, /tb_offer/);
  assert.match(bill, /tb_consent/);
  assert.match(bill, /tb_pay_consent/);
  assert.doesNotMatch(bill, /tb_agree/);
  const app = read('public/app/app.js');
  ['/legal/offer', '/legal/privacy', '/legal/consent', '/legal/cookies'].forEach((href) => assert.match(app, new RegExp(href.replace(/\//g, '\\/'))));
  assert.match(read('vercel.json'), /\/legal\/:doc/);
}

testConfig();
testLinks();
console.log('ok: legal pages');
