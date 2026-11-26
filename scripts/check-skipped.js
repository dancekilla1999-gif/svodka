#!/usr/bin/env node
// Node 24 в spec-репортёре пишет «ℹ skipped 0», tap — «# skipped 0».
// Принимаем оба. Ненулевое число пропусков и отсутствие строки — ошибка.
const fs = require('node:fs');
const text = fs.readFileSync(process.argv[2] || 'test-out.txt', 'utf8');
const tap = text.match(/^# skipped (\d+)\s*$/m);
const spec = text.match(/ℹ skipped (\d+)/);
const found = tap || spec;
if (!found) {
  console.error('В выводе тестов нет строки skipped');
  process.exit(1);
}
const n = Number(found[1]);
if (n !== 0) {
  console.error('Пропущено тестов: ' + n);
  process.exit(1);
}
console.log('skipped 0');
