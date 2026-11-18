// Шифрование пароля iiko: AES-256-GCM, ключ ENC_KEY (32 байта в base64) — только в окружении серверных функций.
const crypto = require('node:crypto');
function key() {
  const k = Buffer.from(process.env.ENC_KEY || '', 'base64');
  if (k.length !== 32) throw new Error('Сервер не настроен: нет ключа шифрования');
  return k;
}
function seal(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return 'v1:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
function open(box) {
  if (!box || !box.startsWith('v1:')) throw new Error('Пароль iiko не сохранён — подключите заново');
  const b = Buffer.from(box.slice(3), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}
module.exports = { seal, open };
