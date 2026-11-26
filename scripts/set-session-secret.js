#!/usr/bin/env node
// Кладёт в локальную базу только хеш TG_SESSION_SECRET. Сам секрет не печатает.
// Боевой Supabase не трогает: нужен DATABASE_URL на localhost.
const { Client } = require('pg');

const url = process.env.DATABASE_URL || '';
const secret = process.env.TG_SESSION_SECRET || '';
if (!url || !secret) {
  console.error('Нужны DATABASE_URL и TG_SESSION_SECRET.');
  process.exit(1);
}
let host = '';
try { host = new URL(url).hostname; } catch (e) { host = ''; }
if (!['localhost', '127.0.0.1', '::1', 'postgres'].includes(host) || /supabase\.co$/i.test(host)) {
  console.error('Отказ: база не локальная.');
  process.exit(1);
}

(async () => {
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query(
    `insert into sv.server_config(key, value)
     values ('tg_session_secret', encode(extensions.digest(convert_to($1, 'UTF8'), 'sha256'), 'hex'))
     on conflict (key) do update set value = excluded.value`,
    [secret]
  );
  await client.end();
  console.log('Хеш секрета сессий записан.');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
