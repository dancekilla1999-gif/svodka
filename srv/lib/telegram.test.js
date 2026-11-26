const test = require('node:test');
const assert = require('node:assert/strict');
const { signInitData, validateInitData, dataCheckString, parseInitData } = require('./telegram');

const TOKEN = '123456789:AAH-synthetic-bot-token-00000000000';
const USER = { id: 424242, first_name: 'Тест', username: 'tester', language_code: 'ru', photo_url: 'https://example.test/a.jpg' };

function signed(extra, authDate) {
  return signInitData(Object.assign({
    auth_date: String(authDate),
    query_id: 'AAEtest',
    user: JSON.stringify(USER),
    signature: 'ed25519-signature-field'
  }, extra || {}), TOKEN);
}

test('синтетический initData сходится, signature входит в строку', () => {
  const now = 1_700_000_000_000;
  const raw = signed({}, Math.floor(now / 1000));
  const ok = validateInitData(raw, TOKEN, { now });
  assert.equal(ok.ok, true);
  assert.equal(ok.user.id, 424242);
  assert.equal(ok.user.first_name, 'Тест');
  assert.equal(ok.user.username, 'tester');
  assert.equal(ok.user.photo_url, undefined);
  const params = parseInitData(raw);
  const withSig = dataCheckString(params, false);
  const without = dataCheckString(params, true);
  assert.notEqual(withSig, without);
  assert.equal(validateInitData(raw, TOKEN, { now, excludeSignature: true }).ok, false);
});

test('порча любого поля, включая signature, даёт BAD_HASH', () => {
  const now = 1_700_000_000_000;
  const raw = signed({}, Math.floor(now / 1000));
  const params = parseInitData(raw);
  for (const key of Object.keys(params)) {
    const broken = Object.assign({}, params, { [key]: params[key] + 'x' });
    const usp = new URLSearchParams();
    Object.keys(broken).forEach((k) => usp.append(k, broken[k]));
    const again = validateInitData(usp.toString(), TOKEN, { now });
    assert.equal(again.ok, false, key);
    assert.equal(again.error, 'BAD_HASH');
  }
});

test('ключ одноразовости — поле hash, перестановка и перекодирование его не меняют', () => {
  const now = 1_700_000_000_000;
  const raw = signed({ user: JSON.stringify(Object.assign({}, USER, { first_name: 'Егор Бондарев' })) }, Math.floor(now / 1000));
  const params = parseInitData(raw);
  const reversed = new URLSearchParams();
  [...new URLSearchParams(raw).entries()].reverse().forEach(([k, v]) => reversed.append(k, v));
  const encoded = raw.replace(/\+/g, '%20');
  const a = validateInitData(raw, TOKEN, { now });
  const b = validateInitData(reversed.toString(), TOKEN, { now });
  const c = validateInitData(encoded, TOKEN, { now });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(c.ok, true);
  assert.equal(a.hash, params.hash.toLowerCase());
  assert.equal(b.hash, a.hash);
  assert.equal(c.hash, a.hash);
  assert.notEqual(raw, reversed.toString());
  assert.notEqual(raw, encoded);
});

test('initData без user отклоняется', () => {
  const now = 1_700_000_000_000;
  const raw = signInitData({ auth_date: String(Math.floor(now / 1000)), query_id: 'AAEtest', signature: 'ed25519-signature-field' }, TOKEN);
  const res = validateInitData(raw, TOKEN, { now });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'BAD_HASH');
  const empty = signed({ user: '{}' }, Math.floor(now / 1000));
  assert.equal(validateInitData(empty, TOKEN, { now }).error, 'BAD_HASH');
});

test('чужой токен не принимается', () => {
  const now = 1_700_000_000_000;
  const raw = signed({}, Math.floor(now / 1000));
  const bad = validateInitData(raw, TOKEN + 'other', { now });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'BAD_HASH');
});

test('срок auth_date: 10 минут, час и будущее', () => {
  const now = 1_700_000_000_000;
  const nowSec = Math.floor(now / 1000);
  const old10 = signed({}, nowSec - 11 * 60);
  assert.equal(validateInitData(old10, TOKEN, { now, maxAgeSec: 600 }).error, 'EXPIRED');
  assert.equal(validateInitData(old10, TOKEN, { now, maxAgeSec: 3600 }).ok, true);
  const oldHour = signed({}, nowSec - 61 * 60);
  assert.equal(validateInitData(oldHour, TOKEN, { now, maxAgeSec: 3600 }).error, 'EXPIRED');
  const future = signed({}, nowSec + 61);
  assert.equal(validateInitData(future, TOKEN, { now, maxAgeSec: 3600 }).error, 'EXPIRED');
  const skew = signed({}, nowSec + 30);
  assert.equal(validateInitData(skew, TOKEN, { now, maxAgeSec: 600 }).ok, true);
});

test('реальный initData с signature', (t) => {
  const real = process.env.TG_REAL_INITDATA || '';
  const token = process.env.TG_TEST_BOT_TOKEN || '';
  if (!real || !token) {
    if (process.env.REQUIRE_REAL_INITDATA === '1') {
      assert.fail('нет фикстуры TG_REAL_INITDATA или TG_TEST_BOT_TOKEN');
    }
    t.skip('локально без фикстуры');
    return;
  }
  const params = parseInitData(real);
  const authDate = Number(params.auth_date);
  const ok = validateInitData(real, token, { now: authDate * 1000 });
  assert.equal(ok.ok, true);
  assert.equal(validateInitData(real, token, { now: authDate * 1000, excludeSignature: true }).ok, false);
  const testDc = process.env.TG_REAL_INITDATA_TESTDC || '';
  if (testDc) {
    const p2 = parseInitData(testDc);
    assert.equal(validateInitData(testDc, token, { now: Number(p2.auth_date) * 1000 }).ok, true);
  }
  assert.equal(ok.ok ? 'ok' : 'fail', 'ok');
});
