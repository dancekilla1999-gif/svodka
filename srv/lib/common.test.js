const assert = require('node:assert/strict');
const { publicUrl, unstableVercelHost } = require('./common');

function withEnv(extra, fn) {
  const keys = ['PUBLIC_URL', 'VERCEL_PROJECT_PRODUCTION_URL'];
  const prev = {};
  keys.forEach((k) => { prev[k] = process.env[k]; delete process.env[k]; });
  Object.assign(process.env, extra);
  try { fn(); }
  finally {
    keys.forEach((k) => { if (prev[k] == null) delete process.env[k]; else process.env[k] = prev[k]; });
  }
}

function testHosts() {
  assert.equal(unstableVercelHost('svodka-3cuugjkvq-egor12.vercel.app'), true);
  assert.equal(unstableVercelHost('svodka-git-main-egor12.vercel.app'), true);
  assert.equal(unstableVercelHost('svodka-egor12.vercel.app'), false);
  assert.equal(unstableVercelHost('svodka.vercel.app'), false);
  assert.equal(unstableVercelHost('localhost:3000'), false);
}

function testPublicUrl() {
  withEnv({ PUBLIC_URL: 'https://svodka-egor12.vercel.app/' }, () => {
    assert.equal(publicUrl({ headers: { host: 'svodka-3cuugjkvq-egor12.vercel.app' } }), 'https://svodka-egor12.vercel.app');
  });
  withEnv({ VERCEL_PROJECT_PRODUCTION_URL: 'svodka-egor12.vercel.app' }, () => {
    assert.equal(publicUrl({ headers: { 'x-forwarded-host': 'svodka-3cuugjkvq-egor12.vercel.app' } }), 'https://svodka-egor12.vercel.app');
  });
  withEnv({}, () => {
    assert.equal(publicUrl({ headers: { 'x-forwarded-host': 'svodka-3cuugjkvq-egor12.vercel.app, svodka-egor12.vercel.app' } }), 'https://svodka-egor12.vercel.app');
    assert.equal(publicUrl({ headers: { host: 'svodka-egor12.vercel.app' } }), 'https://svodka-egor12.vercel.app');
    assert.equal(publicUrl({ headers: { host: 'localhost:4173' } }), 'http://localhost:4173');
    assert.equal(publicUrl({ headers: {} }), 'https://svodka-egor12.vercel.app');
  });
}

const fs = require('node:fs');
function testShellAssets() {
  const html = fs.readFileSync(require('node:path').join(__dirname, '../../public/app/index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  refs.forEach((ref) => {
    if (/^(https?:|#|data:)/.test(ref)) return;
    assert.ok(ref.startsWith('/'), `${ref} должен быть абсолютным от корня, иначе /app/r/:id его не загрузит`);
  });
  assert.match(html, /\/app\/core\.js\?v=21/);
  assert.match(html, /Повторить/);
  assert.doesNotMatch(html, /src="core\.js/);
  assert.doesNotMatch(html, /href="app\.css/);
}

testHosts();
testPublicUrl();
testShellAssets();
console.log('ok: public url and app shell');
