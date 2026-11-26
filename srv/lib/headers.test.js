const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../vercel.json'), 'utf8'));

function headersFor(urlPath) {
  const out = {};
  for (const rule of cfg.headers) {
    const src = rule.source;
    let re;
    if (src === '/(.*)') re = /^\/(.*)$/;
    else if (src === '/((?!tg/).*)') re = /^\/((?!tg\/).*)$/;
    else if (src === '/tg') re = /^\/tg$/;
    else if (src === '/tg/(.*)') re = /^\/tg\/(.*)$/;
    else if (src === '/app') re = /^\/app$/;
    else if (src === '/app/(.*)') re = /^\/app\/(.*)$/;
    else continue;
    if (!re.test(urlPath)) continue;
    for (const h of rule.headers) out[h.key] = h.value;
  }
  return out;
}

test('регион функций — Франкфурт', () => {
  assert.deepEqual(cfg.regions, ['fra1']);
});

test('заголовки /app и /tg', () => {
  const app = headersFor('/app/');
  const tg = headersFor('/tg/');
  const tgIndex = headersFor('/tg/index.html');
  assert.equal(app['X-Frame-Options'], 'DENY');
  assert.match(app['Content-Security-Policy'], /script-src 'self'/);
  assert.doesNotMatch(app['Content-Security-Policy'], /script-src[^;]*unsafe-inline/);
  assert.match(app['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.match(app['Content-Security-Policy'], /qozyihhlocvgpkchyqsp\.supabase\.co/);
  assert.equal(tg['X-Frame-Options'], undefined);
  assert.equal(tgIndex['X-Frame-Options'], undefined);
  assert.match(tg['Content-Security-Policy'], /frame-ancestors https:\/\/web\.telegram\.org https:\/\/\*\.telegram\.org/);
  assert.match(tg['Content-Security-Policy'], /script-src 'self' https:\/\/telegram\.org/);
  assert.doesNotMatch(tg['Content-Security-Policy'], /script-src[^;]*unsafe-inline/);
  const api = headersFor('/api/tg/auth');
  assert.equal(api['X-Frame-Options'], 'DENY');
});

test('/tg без слэша редиректит на /tg/', () => {
  const rule = (cfg.redirects || []).find((item) => item.source === '/tg');
  assert.ok(rule);
  assert.equal(rule.destination, '/tg/');
  assert.equal((cfg.rewrites || []).some((item) => item.source === '/tg'), false);
  const nginx = fs.readFileSync(path.join(__dirname, '../../deploy/nginx.conf'), 'utf8');
  assert.match(nginx, /location = \/tg \{\s*return 308 \/tg\/;/);
});

test('nginx этапа 2 не отдаёт X-Frame-Options на /tg/', () => {
  const nginx = fs.readFileSync(path.join(__dirname, '../../deploy/nginx.conf'), 'utf8');
  assert.match(nginx, /location \/tg\//);
  assert.match(nginx, /frame-ancestors https:\/\/web\.telegram\.org/);
  assert.match(nginx, /connect-src 'self'/);
  assert.doesNotMatch(nginx.split('location /tg/')[1].split('location /')[0], /X-Frame-Options/);
});
