#!/usr/bin/env node
// Поднимает локальную тестовую базу: роли, текущая схема, согласие PR #8, миграция входа.
// Боевой хост Supabase этот скрипт не трогает.
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const url = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL || '';
if (!url) {
  console.error('Нужен DATABASE_URL или TEST_DATABASE_URL на локальный Postgres.');
  process.exit(1);
}
let host = '';
try { host = new URL(url).hostname; } catch (e) {
  console.error('DATABASE_URL не разбирается как адрес.');
  process.exit(1);
}
const local = host === 'localhost' || host === '127.0.0.1' || host === 'postgres' || host === '::1';
if (!local || /supabase\.co$/i.test(host)) {
  console.error('Отказ: база не локальная (' + host + '). Боевой Supabase этот скрипт не меняет.');
  process.exit(1);
}

const root = path.join(__dirname, '..');
const files = [
  'sql/test/00_cluster.sql',
  'sql/test/01_baseline.sql',
  'supabase/migrations/20261126140000_legal_consent.sql',
  'sql/20261126_tg_auth.sql'
];

(async () => {
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query(`
    do $$
    declare r record;
    begin
      for r in
        select p.oid::regprocedure as sig
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and (p.proname like 'sv\\_%' or p.proname like 'bill\\_%')
      loop
        execute 'drop function if exists ' || r.sig || ' cascade';
      end loop;
    end $$;
  `);
  await client.query('drop schema if exists sv cascade');
  await client.query('drop schema if exists bill cascade');
  await client.query('drop schema if exists app cascade');
  await client.query('drop schema if exists zh cascade');
  await client.query('drop table if exists public.sv_legal_consent cascade');
  await client.query('drop function if exists public.sv_request_meta()');
  await client.query('drop function if exists public.sv_wrap_consent_rpc(text, text)');
  for (const rel of files) {
    const sql = fs.readFileSync(path.join(root, rel), 'utf8');
    await client.query(sql);
    console.log('ok ' + rel);
  }
  const secret = process.env.TG_SESSION_SECRET || '';
  if (secret) {
    await client.query(
      `insert into sv.server_config(key, value)
       values ('tg_session_secret', encode(extensions.digest(convert_to($1, 'UTF8'), 'sha256'), 'hex'))
       on conflict (key) do update set value = excluded.value`,
      [secret]
    );
    console.log('ok tg_session_secret hash');
  } else {
    console.log('TG_SESSION_SECRET пуст — хеш секрета не записан');
  }
  await client.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
