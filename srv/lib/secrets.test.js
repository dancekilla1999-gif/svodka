const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

test('в public нет токенов бота, сервисных ключей и initData', () => {
  const root = path.join(__dirname, '../../public');
  const files = walk(root, []);
  const bot = /\d{8,10}:[A-Za-z0-9_-]{35}/;
  const service = /sb_secret_|service_role|SUPABASE_SERVICE_ROLE/;
  const initData = /auth_date=\d+&(?:user|hash)=/;
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    assert.equal(bot.test(text), false, path.relative(root, file));
    assert.equal(service.test(text), false, path.relative(root, file));
    assert.equal(initData.test(text), false, path.relative(root, file));
  }
});
