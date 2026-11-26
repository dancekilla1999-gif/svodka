-- Вход в кабинет «Сводки» через Telegram Mini App и сессии сайта.
-- Чистый Postgres (роли anon / authenticated / service_role — как у Supabase, на Timeweb та же миграция).
-- К боевой базе не применять, пока человек отдельно не подтвердит.

create schema if not exists extensions;
create extension if not exists pgcrypto schema extensions;
create schema if not exists sv;

-- Доказательство оферты. Если миграция согласия уже создала таблицу, оставляем её.
create table if not exists public.sv_legal_consent (
  id bigint generated always as identity primary key,
  product text not null default 'sv',
  kind text not null,
  email text,
  phone_given boolean not null default false,
  offer boolean not null,
  consent boolean not null,
  doc_version text not null,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table sv.owners add column if not exists disabled_at timestamptz;
alter table sv.owners add column if not exists platform_admin boolean not null default false;
alter table sv.owners add column if not exists staff_role text not null default 'owner';

alter table sv.sessions add column if not exists id uuid default gen_random_uuid();
alter table sv.sessions add column if not exists kind text;
update sv.sessions set kind = 'legacy' where kind is null;
alter table sv.sessions alter column kind set default 'web';
alter table sv.sessions alter column kind set not null;
alter table sv.sessions add column if not exists token_use text not null default 'access';
alter table sv.sessions add column if not exists chain_id uuid;
alter table sv.sessions add column if not exists tg_user_id bigint;
alter table sv.sessions add column if not exists device_key text;
alter table sv.sessions add column if not exists device_label text;
alter table sv.sessions add column if not exists created_ip_hash text;
alter table sv.sessions add column if not exists last_used_at timestamptz not null default now();
alter table sv.sessions add column if not exists abs_expires_at timestamptz;
alter table sv.sessions add column if not exists revoked_at timestamptz;
alter table sv.sessions add column if not exists revoke_reason text;
alter table sv.sessions add column if not exists rotated_at timestamptz;

update sv.sessions set id = gen_random_uuid() where id is null;
alter table sv.sessions alter column id set not null;
create unique index if not exists sessions_id_key on sv.sessions (id);
create index if not exists sessions_owner_kind on sv.sessions (owner_id, kind);
create index if not exists sessions_tg_device on sv.sessions (tg_user_id, device_key);

do $checks$
begin
  if not exists (select 1 from pg_constraint where conname = 'sessions_kind_check') then
    alter table sv.sessions add constraint sessions_kind_check check (kind in ('web', 'tg', 'legacy'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sessions_token_use_check') then
    alter table sv.sessions add constraint sessions_token_use_check check (token_use in ('access', 'refresh'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sessions_revoke_reason_check') then
    alter table sv.sessions add constraint sessions_revoke_reason_check check (
      revoke_reason is null or revoke_reason in (
        'logout', 'logout_all', 'password', 'admin', 'unbind', 'rotated', 'refresh_reuse', 'device_end'
      )
    );
  end if;
end
$checks$;

create table if not exists sv.tg_links (
  tg_user_id bigint primary key,
  owner_id uuid not null unique references sv.owners(id) on delete cascade,
  tg_username text,
  tg_first_name text,
  bound_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists sv.tg_link_codes (
  code_hash text primary key,
  owner_id uuid not null references sv.owners(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists tg_link_codes_owner_created on sv.tg_link_codes (owner_id, created_at desc);

create table if not exists sv.tg_initdata_used (
  hash_sha256 text primary key,
  expires_at timestamptz not null
);

create table if not exists sv.consents (
  id bigint generated always as identity primary key,
  owner_id uuid not null references sv.owners(id) on delete cascade,
  kind text not null,
  version text not null,
  tg_user_id bigint,
  at timestamptz not null default now(),
  withdrawn_at timestamptz
);

create table if not exists sv.auth_events (
  id bigint generated always as identity primary key,
  owner_id uuid,
  kind text not null,
  tg_user_id bigint,
  ip_hash text,
  device_label text,
  at timestamptz not null default now()
);
create index if not exists auth_events_at on sv.auth_events (at);

create table if not exists sv.invites (
  code_hash text primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid,
  role text not null default 'owner'
);
alter table sv.invites add column if not exists role text not null default 'owner';

create table if not exists sv.rate_hits (
  id bigint generated always as identity primary key,
  bucket text not null,
  at timestamptz not null default now()
);
create index if not exists rate_hits_bucket_at on sv.rate_hits (bucket, at desc);

create table if not exists sv.refresh_grace (
  old_hash text primary key,
  ciphertext text not null,
  iv text not null,
  tag text not null,
  expires_at timestamptz not null,
  chain_id uuid not null,
  owner_id uuid not null
);

create table if not exists sv.server_config (
  key text primary key,
  value text not null
);

create table if not exists sv.security_minute (
  bucket timestamptz not null,
  kind text not null,
  n int not null default 0,
  primary key (bucket, kind)
);

-- Хеш секрета TG_SESSION_SECRET кладёт человек (scripts/set-session-secret.js). В файл секрет не пишется.

create or replace function sv.assert_secret(p_secret text)
returns void
language plpgsql
set search_path to pg_catalog, sv, extensions
as $$
declare want text;
declare got text;
begin
  select value into want from sv.server_config where key = 'tg_session_secret';
  if coalesce(want, '') = '' then
    raise exception 'Секрет сессий не настроен' using hint = 'config';
  end if;
  got := encode(extensions.digest(convert_to(coalesce(p_secret, ''), 'UTF8'), 'sha256'), 'hex');
  if got <> want then
    raise exception 'forbidden' using hint = 'secret';
  end if;
end
$$;

create or replace function sv.auth_event(p_owner uuid, p_kind text, p_tg bigint, p_ip text, p_device text)
returns void
language sql
volatile
set search_path to pg_catalog, sv
as $$
  insert into sv.auth_events (owner_id, kind, tg_user_id, ip_hash, device_label)
  values (p_owner, p_kind, p_tg, p_ip, left(coalesce(p_device, ''), 80))
$$;

create or replace function sv.rate_count(p_bucket text, p_window interval)
returns int
language sql
stable
set search_path to pg_catalog, sv
as $$
  select count(*)::int from sv.rate_hits where bucket = p_bucket and at > now() - p_window
$$;

create or replace function sv.rate_hit(p_bucket text)
returns void
language sql
volatile
set search_path to pg_catalog, sv
as $$
  insert into sv.rate_hits (bucket) values (p_bucket)
$$;

create or replace function sv.rate_retry_min(p_bucket text, p_window interval)
returns int
language sql
stable
set search_path to pg_catalog, sv
as $$
  select coalesce(greatest(1, ceil(extract(epoch from (min(at) + p_window - now())) / 60.0)::int), 1)
  from sv.rate_hits where bucket = p_bucket and at > now() - p_window
$$;

create or replace function sv.owner_id(p_token text)
returns uuid
language plpgsql
stable
set search_path to pg_catalog, sv
as $$
declare r sv.sessions;
declare dis timestamptz;
begin
  if p_token is null or length(p_token) < 20 then
    raise exception 'Нужно войти' using hint = 'auth';
  end if;
  select * into r from sv.sessions s where s.token_hash = sv.hash_token(p_token);
  if r.token_hash is null then
    raise exception 'Нужно войти' using hint = 'auth';
  end if;
  select o.disabled_at into dis from sv.owners o where o.id = r.owner_id;
  if dis is not null then
    raise exception 'Аккаунт отключён' using hint = 'disabled';
  end if;
  if r.rotated_at is not null or r.revoke_reason = 'rotated' then
    raise exception 'Сессия обновляется' using hint = 'expired';
  end if;
  if r.revoked_at is not null then
    if r.revoke_reason in ('logout', 'logout_all', 'password', 'admin', 'unbind', 'device_end', 'refresh_reuse') then
      raise exception 'Сессия завершена' using hint = 'revoked';
    end if;
    raise exception 'Сессия завершена' using hint = 'revoked';
  end if;
  if r.expires_at <= now() or (r.abs_expires_at is not null and r.abs_expires_at <= now()) then
    raise exception 'Сессия закончилась' using hint = 'expired';
  end if;
  if r.token_use = 'refresh' then
    raise exception 'Нужно войти' using hint = 'auth';
  end if;
  return r.owner_id;
end
$$;

create or replace function sv.session_touch(p_token text)
returns void
language plpgsql
volatile
set search_path to pg_catalog, sv
as $$
declare r sv.sessions;
begin
  select * into r from sv.sessions where token_hash = sv.hash_token(p_token);
  if r.token_hash is null or r.revoked_at is not null or r.rotated_at is not null then
    return;
  end if;
  if r.expires_at <= now() or (r.abs_expires_at is not null and r.abs_expires_at <= now()) then
    return;
  end if;
  if exists (select 1 from sv.owners o where o.id = r.owner_id and o.disabled_at is not null) then
    return;
  end if;
  if r.kind = 'tg' then
    if r.last_used_at < now() - interval '1 hour' then
      update sv.sessions
         set last_used_at = now(),
             expires_at = least(now() + interval '7 days', coalesce(abs_expires_at, now() + interval '7 days'))
       where token_hash = r.token_hash;
    elsif r.last_used_at < now() - interval '1 minute' then
      update sv.sessions set last_used_at = now() where token_hash = r.token_hash;
    end if;
  elsif r.kind = 'web' and r.token_use = 'refresh' then
    if r.last_used_at < now() - interval '1 hour' then
      update sv.sessions
         set last_used_at = now(),
             expires_at = now() + interval '365 days',
             abs_expires_at = now() + interval '365 days'
       where token_hash = r.token_hash;
    end if;
  elsif r.last_used_at < now() - interval '1 minute' then
    update sv.sessions set last_used_at = now() where token_hash = r.token_hash;
  end if;
end
$$;

create or replace function public.sv_session_touch(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, sv
as $$
declare v uuid := sv.owner_id(p_token);
begin
  perform sv.session_touch(p_token);
  return jsonb_build_object('ok', true, 'owner_id', v);
end
$$;

create or replace function sv.consume_init(p_hash text)
returns void
language plpgsql
set search_path to pg_catalog, sv
as $$
declare got text;
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Повтор' using hint = 'replay';
  end if;
  insert into sv.tg_initdata_used (hash_sha256, expires_at)
  values (p_hash, now() + interval '1 hour 1 minute')
  on conflict do nothing
  returning hash_sha256 into got;
  if got is null then
    raise exception 'Повтор' using hint = 'replay';
  end if;
end
$$;

create or replace function sv.issue_tg_session(
  p_owner uuid, p_tg bigint, p_device_key text, p_device_label text, p_ip_hash text
) returns text
language plpgsql
set search_path to pg_catalog, sv
as $$
declare t text;
declare n int;
declare old_hash text;
begin
  update sv.sessions
     set revoked_at = now(), revoke_reason = 'rotated', rotated_at = now()
   where owner_id = p_owner and kind = 'tg' and tg_user_id = p_tg
     and device_key = p_device_key and revoked_at is null;

  select count(*) into n from sv.sessions
   where owner_id = p_owner and kind = 'tg' and revoked_at is null
     and expires_at > now() and (abs_expires_at is null or abs_expires_at > now());
  while n >= 5 loop
    select token_hash into old_hash from sv.sessions
     where owner_id = p_owner and kind = 'tg' and revoked_at is null
       and expires_at > now() and (abs_expires_at is null or abs_expires_at > now())
     order by last_used_at asc, created_at asc
     limit 1;
    exit when old_hash is null;
    update sv.sessions
       set revoked_at = now(), revoke_reason = 'rotated', rotated_at = now()
     where token_hash = old_hash;
    n := n - 1;
  end loop;

  t := sv.new_token();
  insert into sv.sessions (
    token_hash, owner_id, expires_at, kind, token_use, tg_user_id, device_key,
    device_label, created_ip_hash, abs_expires_at, last_used_at
  ) values (
    sv.hash_token(t), p_owner, now() + interval '7 days', 'tg', 'access', p_tg,
    p_device_key, left(coalesce(p_device_label, ''), 80), p_ip_hash,
    now() + interval '30 days', now()
  );
  update sv.tg_links set last_seen_at = now() where tg_user_id = p_tg and owner_id = p_owner;
  return t;
end
$$;

create or replace function sv.issue_web_pair(p_owner uuid, p_device_label text, p_ip_hash text)
returns jsonb
language plpgsql
set search_path to pg_catalog, sv
as $$
declare v_access text := sv.new_token();
declare v_refresh text := sv.new_token();
declare v_chain uuid := gen_random_uuid();
declare o sv.owners;
begin
  insert into sv.sessions (
    token_hash, owner_id, expires_at, abs_expires_at, kind, token_use, chain_id,
    device_label, created_ip_hash, last_used_at
  ) values
    (sv.hash_token(v_access), p_owner, now() + interval '15 minutes', now() + interval '15 minutes',
     'web', 'access', v_chain, left(coalesce(p_device_label, ''), 80), p_ip_hash, now()),
    (sv.hash_token(v_refresh), p_owner, now() + interval '365 days', now() + interval '365 days',
     'web', 'refresh', v_chain, left(coalesce(p_device_label, ''), 80), p_ip_hash, now());
  select * into o from sv.owners where id = p_owner;
  return jsonb_build_object('access', v_access, 'refresh', v_refresh, 'email', o.email, 'name', o.name, 'chain_id', v_chain);
end
$$;

create or replace function sv.bind_tg(
  p_owner uuid, p_tg bigint, p_username text, p_first text
) returns void
language plpgsql
set search_path to pg_catalog, sv
as $$
declare other_owner uuid;
declare other_tg bigint;
begin
  select owner_id into other_owner from sv.tg_links where tg_user_id = p_tg;
  if found and other_owner <> p_owner then
    raise exception 'Этот Telegram уже привязан к другому аккаунту. Сначала отвяжите его там' using hint = 'taken';
  end if;
  select tg_user_id into other_tg from sv.tg_links where owner_id = p_owner;
  if found and other_tg <> p_tg then
    raise exception 'К этому аккаунту уже привязан другой Telegram' using hint = 'taken';
  end if;
  insert into sv.tg_links (tg_user_id, owner_id, tg_username, tg_first_name)
  values (p_tg, p_owner, left(coalesce(p_username, ''), 64), left(coalesce(p_first, ''), 128))
  on conflict (tg_user_id) do update
    set tg_username = excluded.tg_username,
        tg_first_name = excluded.tg_first_name,
        last_seen_at = now();
end
$$;

create or replace function sv.me_json(p_owner uuid)
returns jsonb
language plpgsql
stable
set search_path to pg_catalog, sv
as $$
declare o sv.owners;
declare l sv.tg_links;
begin
  select * into o from sv.owners where id = p_owner;
  select * into l from sv.tg_links where owner_id = p_owner;
  return jsonb_build_object(
    'email', o.email,
    'name', o.name,
    'tg', case when l.tg_user_id is null then null else jsonb_build_object(
      'username', coalesce(l.tg_username, ''),
      'first_name', coalesce(l.tg_first_name, '')
    ) end
  );
end
$$;

create or replace function public.sv_tg_session(
  p_secret text, p_tg_user_id bigint, p_device_key text, p_device_label text, p_ip_hash text
) returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, sv
as $$
declare o uuid;
declare t text;
begin
  perform sv.assert_secret(p_secret);
  if sv.rate_count('auth:ip:' || coalesce(p_ip_hash, ''), interval '1 minute') >= 60 then
    return jsonb_build_object('error', 'Слишком много попыток, подождите ' || sv.rate_retry_min('auth:ip:' || coalesce(p_ip_hash, ''), interval '1 minute') || ' мин', 'hint', 'rate');
  end if;
  perform sv.rate_hit('auth:ip:' || coalesce(p_ip_hash, ''));
  select owner_id into o from sv.tg_links where tg_user_id = p_tg_user_id;
  if not found then
    return jsonb_build_object('need_link', true);
  end if;
  if exists (select 1 from sv.owners where id = o and disabled_at is not null) then
    return jsonb_build_object('error', 'Аккаунт отключён', 'hint', 'disabled');
  end if;
  t := sv.issue_tg_session(o, p_tg_user_id, coalesce(p_device_key, ''), left(coalesce(p_device_label, ''), 80), p_ip_hash);
  perform sv.auth_event(o, 'login_ok', p_tg_user_id, p_ip_hash, p_device_label);
  return jsonb_build_object('token', t, 'me', sv.me_json(o));
end
$$;

create or replace function public.sv_link_code_consume(p_secret text, p_code text)
returns uuid
language plpgsql
security definer
set search_path to pg_catalog, sv
as $$
declare v uuid;
begin
  perform sv.assert_secret(p_secret);
  update sv.tg_link_codes
     set used_at = now()
   where code_hash = sv.hash_token(p_code)
     and used_at is null
     and expires_at > now()
   returning owner_id into v;
  return v;
end
$$;

create or replace function public.sv_tg_link(
  p_secret text,
  p_tg_user_id bigint,
  p_device_key text,
  p_device_label text,
  p_ip_hash text,
  p_first_name text,
  p_username text,
  p_code text,
  p_consent boolean,
  p_init_hash text,
  p_version text
) returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, sv
as $$
declare c sv.tg_link_codes;
declare t text;
declare bucket_tg text := 'code:tg:' || coalesce(p_tg_user_id::text, '');
declare bucket_ip text := 'code:ip:' || coalesce(p_ip_hash, '');
begin
  perform sv.assert_secret(p_secret);
  if coalesce(p_consent, false) is not true then
    return jsonb_build_object('error', 'Нужно согласие на обработку Telegram ID, имени и username', 'hint', 'consent');
  end if;
  if p_code is null or p_code ~ '^[a-f0-9]{18}$' or length(p_code) < 22 then
    perform sv.rate_hit(bucket_tg);
    perform sv.rate_hit(bucket_ip);
    return jsonb_build_object('error', 'Код не подошёл или устарел', 'hint', 'code');
  end if;
  if sv.rate_count(bucket_tg, interval '15 minutes') >= 10
     or sv.rate_count(bucket_ip, interval '15 minutes') >= 30 then
    return jsonb_build_object(
      'error', 'Слишком много попыток, подождите ' || greatest(
        sv.rate_retry_min(bucket_tg, interval '15 minutes'),
        sv.rate_retry_min(bucket_ip, interval '15 minutes')
      ) || ' мин',
      'hint', 'rate');
  end if;
  select * into c from sv.tg_link_codes where code_hash = sv.hash_token(p_code) for update;
  if not found or c.used_at is not null or c.expires_at <= now() then
    perform sv.rate_hit(bucket_tg);
    perform sv.rate_hit(bucket_ip);
    return jsonb_build_object('error', 'Код не подошёл или устарел', 'hint', 'code');
  end if;
  if exists (select 1 from sv.owners o where o.id = c.owner_id and o.disabled_at is not null) then
    return jsonb_build_object('error', 'Аккаунт отключён', 'hint', 'disabled');
  end if;
  perform sv.consume_init(p_init_hash);
  perform sv.bind_tg(c.owner_id, p_tg_user_id, p_username, p_first_name);
  update sv.tg_link_codes set used_at = now() where code_hash = c.code_hash and used_at is null;
  insert into sv.consents (owner_id, kind, version, tg_user_id)
  values (c.owner_id, 'tg_login', left(coalesce(p_version, ''), 40), p_tg_user_id);
  t := sv.issue_tg_session(c.owner_id, p_tg_user_id, coalesce(p_device_key, ''), p_device_label, p_ip_hash);
  perform sv.auth_event(c.owner_id, 'tg_link', p_tg_user_id, p_ip_hash, p_device_label);
  perform sv.auth_event(c.owner_id, 'login_ok', p_tg_user_id, p_ip_hash, p_device_label);
  return jsonb_build_object('token', t, 'me', sv.me_json(c.owner_id));
end
$$;

create or replace function public.sv_tg_login(
  p_secret text,
  p_email text,
  p_password text,
  p_tg_user_id bigint,
  p_device_key text,
  p_device_label text,
  p_ip_hash text,
  p_first_name text,
  p_username text,
  p_consent boolean,
  p_init_hash text,
  p_version text
) returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, sv, extensions
as $$
declare e text := lower(btrim(coalesce(p_email, '')));
declare o sv.owners;
declare t text;
declare known uuid;
declare bucket_email text := 'pwd:email:' || e;
declare bucket_ip text := 'pwd:ip:' || coalesce(p_ip_hash, '');
begin
  perform sv.assert_secret(p_secret);
  if coalesce(p_consent, false) is not true then
    return jsonb_build_object('error', 'Нужно согласие на обработку Telegram ID, имени и username', 'hint', 'consent');
  end if;
  if sv.rate_count(bucket_email, interval '15 minutes') >= 10
     or sv.rate_count(bucket_ip, interval '15 minutes') >= 30 then
    return jsonb_build_object(
      'error', 'Слишком много попыток, подождите ' || greatest(
        sv.rate_retry_min(bucket_email, interval '15 minutes'),
        sv.rate_retry_min(bucket_ip, interval '15 minutes')
      ) || ' мин',
      'hint', 'rate');
  end if;
  select * into o from sv.owners where email = e;
  if found then known := o.id; end if;
  if not found or o.pass_hash <> extensions.crypt(coalesce(p_password, ''), o.pass_hash) then
    perform sv.rate_hit(bucket_email);
    perform sv.rate_hit(bucket_ip);
    insert into sv.login_attempts (email) values (e);
    perform sv.auth_event(known, 'login_fail', p_tg_user_id, p_ip_hash, p_device_label);
    return jsonb_build_object('error', 'Неверная почта или пароль', 'hint', 'password');
  end if;
  if o.disabled_at is not null then
    return jsonb_build_object('error', 'Аккаунт отключён', 'hint', 'disabled');
  end if;
  perform sv.consume_init(p_init_hash);
  perform sv.bind_tg(o.id, p_tg_user_id, p_username, p_first_name);
  insert into sv.consents (owner_id, kind, version, tg_user_id)
  values (o.id, 'tg_login', left(coalesce(p_version, ''), 40), p_tg_user_id);
  t := sv.issue_tg_session(o.id, p_tg_user_id, coalesce(p_device_key, ''), p_device_label, p_ip_hash);
  perform sv.auth_event(o.id, 'tg_link', p_tg_user_id, p_ip_hash, p_device_label);
  perform sv.auth_event(o.id, 'login_ok', p_tg_user_id, p_ip_hash, p_device_label);
  return jsonb_build_object('token', t, 'me', sv.me_json(o.id));
end
$$;

create or replace function public.sv_link_code_issue(p_secret text, p_token text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, sv
as $$
declare v uuid;
declare n int;
begin
  perform sv.assert_secret(p_secret);
  v := sv.owner_id(p_token);
  if p_code is null or length(p_code) < 22 or p_code ~ '^[a-f0-9]{18}$' then
    raise exception 'Слабый код' using hint = 'invalid';
  end if;
  select count(*) into n from sv.tg_link_codes
   where owner_id = v and created_at > now() - interval '1 hour';
  if n >= 5 then
    return jsonb_build_object('error', 'Слишком много попыток, подождите 60 мин', 'hint', 'rate');
  end if;
  insert into sv.tg_link_codes (code_hash, owner_id, expires_at)
  values (sv.hash_token(p_code), v, now() + interval '10 minutes');
  perform sv.auth_event(v, 'link_code_issued', null, null, null);
  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.sv_link_code_status(p_secret text, p_token text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, sv
as $$
declare v uuid := sv.owner_id(p_token);
declare c sv.tg_link_codes;
declare l sv.tg_links;
begin
  perform sv.assert_secret(p_secret);
  select * into c from sv.tg_link_codes where code_hash = sv.hash_token(p_code) and owner_id = v;
  if not found then
    return jsonb_build_object('error', 'Код не найден', 'hint', 'code');
  end if;
  if c.used_at is null then
    return jsonb_build_object('pending', true, 'expires_at', c.expires_at);
  end if;
  select * into l from sv.tg_links where owner_id = v;
  return jsonb_build_object(
    'bound', l.tg_user_id is not null,
    'username', coalesce(l.tg_username, ''),
    'first_name', coalesce(l.tg_first_name, ''),
    'bound_at', l.bound_at,
    'recent', c.used_at > now() - interval '24 hours'
  );
end
$$;

create or replace function sv.drop_tg_link(
  p_owner uuid, p_reason text, p_event text, p_ip text, p_device text, p_revoke boolean default true
) returns void
language plpgsql
set search_path to pg_catalog, sv
as $$
declare g bigint;
begin
  select tg_user_id into g from sv.tg_links where owner_id = p_owner;
  if p_revoke then
    update sv.sessions
       set revoked_at = now(), revoke_reason = p_reason
     where owner_id = p_owner and kind = 'tg' and revoked_at is null;
  end if;
  delete from sv.tg_links where owner_id = p_owner;
  update sv.consents
     set withdrawn_at = now()
   where owner_id = p_owner and kind = 'tg_login' and withdrawn_at is null;
  if g is not null or p_event = 'logout_all' then
    perform sv.auth_event(p_owner, p_event, g, p_ip, p_device);
  end if;
end
$$;

create or replace function public.sv_link_code_dispute(p_secret text, p_token text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, sv
as $$
declare v uuid := sv.owner_id(p_token);
declare c sv.tg_link_codes;
begin
  perform sv.assert_secret(p_secret);
  select * into c from sv.tg_link_codes where code_hash = sv.hash_token(p_code) and owner_id = v for update;
  if not found or c.used_at is null or c.used_at <= now() - interval '24 hours' then
    return jsonb_build_object('error', 'Подтвердить, что это не вы, уже нельзя', 'hint', 'code');
  end if;
  perform sv.drop_tg_link(v, 'unbind', 'tg_unlink_disputed', null, null);
  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.sv_login_unbind(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, sv
as $$
declare v uuid := sv.owner_id(p_token);
begin
  perform sv.drop_tg_link(v, 'unbind', 'tg_unlink', null, null);
  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.sv_web_login(
  p_secret text, p_email text, p_password text, p_device_label text, p_ip_hash text
) returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, sv, extensions
as $$
declare e text := lower(btrim(coalesce(p_email, '')));
declare o sv.owners;
declare known uuid;
declare bucket_email text := 'pwd:email:' || e;
declare bucket_ip text := 'pwd:ip:' || coalesce(p_ip_hash, '');
declare pair jsonb;
begin
  perform sv.assert_secret(p_secret);
  if sv.rate_count(bucket_email, interval '15 minutes') >= 10
     or sv.rate_count(bucket_ip, interval '15 minutes') >= 30 then
    return jsonb_build_object(
      'error', 'Слишком много попыток, подождите ' || greatest(
        sv.rate_retry_min(bucket_email, interval '15 minutes'),
        sv.rate_retry_min(bucket_ip, interval '15 minutes')
      ) || ' мин',
      'hint', 'rate');
  end if;
  select * into o from sv.owners where email = e;
  if found then known := o.id; end if;
  if not found or o.pass_hash <> extensions.crypt(coalesce(p_password, ''), o.pass_hash) then
    perform sv.rate_hit(bucket_email);
    perform sv.rate_hit(bucket_ip);
    insert into sv.login_attempts (email) values (e);
    perform sv.auth_event(known, 'login_fail', null, p_ip_hash, p_device_label);
    return jsonb_build_object('error', 'Неверная почта или пароль', 'hint', 'password');
  end if;
  if o.disabled_at is not null then
    return jsonb_build_object('error', 'Аккаунт отключён', 'hint', 'disabled');
  end if;
  pair := sv.issue_web_pair(o.id, p_device_label, p_ip_hash);
  perform sv.auth_event(o.id, 'login_ok', null, p_ip_hash, p_device_label);
  return pair;
end
$$;

create or replace function sv.do_register(
  p_email text, p_password text, p_name text, p_invite text,
  p_offer boolean, p_consent boolean, p_doc_version text,
  p_device_label text, p_ip_hash text, p_ip text, p_ua text
) returns jsonb
language plpgsql
set search_path to pg_catalog, sv, extensions, public
as $$
declare e text := lower(btrim(coalesce(p_email, '')));
declare o sv.owners;
declare inv text;
declare inv_role text;
begin
  if coalesce(p_offer, false) is not true
     or coalesce(p_consent, false) is not true
     or nullif(btrim(coalesce(p_doc_version, '')), '') is null then
    raise exception 'Нужно принять оферту и дать согласие на обработку персональных данных' using hint = 'consent';
  end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(e) > 200 then
    raise exception 'Проверьте адрес почты' using hint = 'invalid';
  end if;
  if length(coalesce(p_password, '')) < 8 or length(p_password) > 72 then
    raise exception 'Пароль — от 8 до 72 символов' using hint = 'invalid';
  end if;
  if p_invite is null or length(p_invite) < 22 then
    raise exception 'Регистрация только по приглашению' using hint = 'invite';
  end if;
  if exists (select 1 from sv.owners where email = e) then
    raise exception 'Эта почта уже зарегистрирована — войдите' using hint = 'exists';
  end if;
  if (select count(*) from sv.owners where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Слишком много регистраций, попробуйте через час' using hint = 'rate';
  end if;
  select code_hash, coalesce(nullif(role, ''), 'owner') into inv, inv_role from sv.invites
   where code_hash = sv.hash_token(p_invite) and used_at is null and expires_at > now()
   for update;
  if inv is null then
    raise exception 'Регистрация только по приглашению' using hint = 'invite';
  end if;
  if inv_role not in ('owner', 'manager') then inv_role := 'owner'; end if;
  insert into sv.owners (email, pass_hash, name, staff_role, platform_admin)
  values (e, extensions.crypt(p_password, extensions.gen_salt('bf', 10)), sv.clean(p_name, 80), inv_role, false)
  returning * into o;
  update sv.invites set used_at = now(), used_by = o.id where code_hash = inv and used_at is null;
  insert into public.sv_legal_consent (product, kind, email, phone_given, offer, consent, doc_version, ip, user_agent)
  values ('sv', 'register', e, false, true, true, btrim(p_doc_version), left(coalesce(p_ip, ''), 80), left(coalesce(p_ua, ''), 500));
  return sv.issue_web_pair(o.id, p_device_label, p_ip_hash) || jsonb_build_object('owner_id', o.id);
end
$$;

create or replace function public.sv_web_register(
  p_secret text, p_email text, p_password text, p_name text, p_invite text,
  p_offer boolean, p_consent boolean, p_doc_version text,
  p_device_label text, p_ip_hash text, p_ip text, p_ua text
) returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, sv, public
as $$
begin
  perform sv.assert_secret(p_secret);
  return sv.do_register(p_email, p_password, p_name, p_invite, p_offer, p_consent, p_doc_version, p_device_label, p_ip_hash, p_ip, p_ua);
end
$$;

drop function if exists public.sv_invite_issue(text, text, integer);

create or replace function public.sv_invite_issue(
  p_secret text, p_token text, p_code text, p_hours int, p_admin_ids text[]
) returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, sv
as $$
declare v uuid;
declare skind text;
declare admin boolean;
begin
  perform sv.assert_secret(p_secret);
  v := sv.owner_id(p_token);
  select kind into skind from sv.sessions where token_hash = sv.hash_token(p_token);
  if skind = 'tg' then
    return jsonb_build_object('error', 'Приглашения выдаются только с сайта', 'hint', 'forbidden');
  end if;
  select o.platform_admin
      or exists (
        select 1 from sv.tg_links l
        where l.owner_id = o.id
          and p_admin_ids is not null
          and l.tg_user_id::text = any(p_admin_ids)
      )
    into admin
  from sv.owners o where o.id = v;
  if coalesce(admin, false) is not true then
    return jsonb_build_object('error', 'Приглашения выдаёт только администратор платформы', 'hint', 'forbidden');
  end if;
  if p_code is null or length(p_code) < 22 then
    raise exception 'Слабый код' using hint = 'invalid';
  end if;
  insert into sv.invites (code_hash, expires_at, role)
  values (sv.hash_token(p_code), now() + make_interval(hours => least(greatest(coalesce(p_hours, 168), 1), 24 * 30)), 'owner');
  perform sv.auth_event(v, 'invite_issued', null, null, null);
  return jsonb_build_object('ok', true, 'role', 'owner');
end
$$;

create or replace function public.sv_web_refresh(
  p_secret text,
  p_old_token text,
  p_new_access text,
  p_new_refresh text,
  p_cipher text,
  p_iv text,
  p_tag text,
  p_device_label text,
  p_ip_hash text
) returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, sv
as $$
declare r sv.sessions;
declare g sv.refresh_grace;
declare o sv.owners;
declare chain uuid;
begin
  perform sv.assert_secret(p_secret);
  if p_old_token is null or length(p_old_token) < 20 then
    return jsonb_build_object('status', 'missing');
  end if;
  select * into r from sv.sessions where token_hash = sv.hash_token(p_old_token) for update;
  if not found or r.kind <> 'web' or r.token_use <> 'refresh' then
    return jsonb_build_object('status', 'missing');
  end if;
  select * into o from sv.owners where id = r.owner_id;
  if o.disabled_at is not null then
    return jsonb_build_object('status', 'disabled');
  end if;
  if r.revoke_reason = 'refresh_reuse'
     or (r.revoked_at is not null and r.revoke_reason is distinct from 'rotated' and r.rotated_at is null) then
    return jsonb_build_object('status', 'revoked', 'hint', 'revoked');
  end if;
  if r.rotated_at is not null or r.revoke_reason = 'rotated' then
    select * into g from sv.refresh_grace where old_hash = r.token_hash;
    if g.old_hash is not null and g.expires_at > now() then
      return jsonb_build_object('status', 'grace', 'cipher', g.ciphertext, 'iv', g.iv, 'tag', g.tag);
    end if;
    update sv.sessions
       set revoked_at = coalesce(revoked_at, now()), revoke_reason = 'refresh_reuse'
     where chain_id = r.chain_id or token_hash = r.token_hash;
    perform sv.auth_event(r.owner_id, 'refresh_reuse', null, p_ip_hash, coalesce(p_device_label, r.device_label));
    return jsonb_build_object('status', 'reuse');
  end if;
  if r.expires_at <= now() or (r.abs_expires_at is not null and r.abs_expires_at <= now()) then
    return jsonb_build_object('status', 'expired');
  end if;
  if p_new_access is null or p_new_refresh is null or p_cipher is null then
    raise exception 'Нет новой пары' using hint = 'invalid';
  end if;
  chain := coalesce(r.chain_id, gen_random_uuid());
  update sv.sessions
     set rotated_at = now(), revoked_at = now(), revoke_reason = 'rotated', chain_id = chain
   where token_hash = r.token_hash;
  update sv.sessions
     set revoked_at = now(), revoke_reason = 'rotated'
   where chain_id = chain and token_use = 'access' and revoked_at is null;
  insert into sv.sessions (
    token_hash, owner_id, expires_at, abs_expires_at, kind, token_use, chain_id,
    device_label, created_ip_hash, last_used_at
  ) values
    (sv.hash_token(p_new_access), r.owner_id, now() + interval '15 minutes', now() + interval '15 minutes',
     'web', 'access', chain, left(coalesce(p_device_label, r.device_label), 80), p_ip_hash, now()),
    (sv.hash_token(p_new_refresh), r.owner_id, now() + interval '365 days', now() + interval '365 days',
     'web', 'refresh', chain, left(coalesce(p_device_label, r.device_label), 80), p_ip_hash, now());
  insert into sv.refresh_grace (old_hash, ciphertext, iv, tag, expires_at, chain_id, owner_id)
  values (r.token_hash, p_cipher, p_iv, p_tag, now() + interval '60 seconds', chain, r.owner_id);
  return jsonb_build_object('status', 'ok', 'email', o.email, 'name', o.name);
end
$$;

create or replace function public.sv_web_migrate(
  p_secret text, p_token text, p_device_label text, p_ip_hash text
) returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, sv
as $$
declare r sv.sessions;
declare pair jsonb;
begin
  perform sv.assert_secret(p_secret);
  perform sv.owner_id(p_token);
  select * into r from sv.sessions where token_hash = sv.hash_token(p_token) for update;
  if not found then
    return jsonb_build_object('error', 'Нужно войти', 'hint', 'auth');
  end if;
  if r.kind is distinct from 'legacy' then
    return jsonb_build_object('error', 'Эту сессию нельзя обменять', 'hint', 'forbidden');
  end if;
  pair := sv.issue_web_pair(r.owner_id, coalesce(p_device_label, r.device_label), p_ip_hash);
  update sv.sessions
     set revoked_at = now(), revoke_reason = 'rotated', rotated_at = now()
   where token_hash = r.token_hash;
  return pair;
end
$$;

create or replace function public.sv_password(p_token text, p_current text, p_new text)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, sv, extensions
as $$
declare v uuid := sv.owner_id(p_token);
declare o sv.owners;
declare s sv.sessions;
begin
  select * into o from sv.owners where id = v;
  if o.pass_hash <> extensions.crypt(coalesce(p_current, ''), o.pass_hash) then
    return jsonb_build_object('error', 'Неверный текущий пароль', 'hint', 'password');
  end if;
  if length(coalesce(p_new, '')) < 8 or length(p_new) > 72 then
    raise exception 'Пароль — от 8 до 72 символов' using hint = 'invalid';
  end if;
  update sv.owners
     set pass_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10))
   where id = v;
  select * into s from sv.sessions where token_hash = sv.hash_token(p_token);
  if s.kind = 'tg' then
    update sv.sessions
       set revoked_at = now(), revoke_reason = 'password'
     where owner_id = v and revoked_at is null and token_hash <> s.token_hash;
  else
    update sv.sessions
       set revoked_at = now(), revoke_reason = 'password'
     where owner_id = v and revoked_at is null
       and token_hash <> s.token_hash
       and (s.chain_id is null or chain_id is distinct from s.chain_id);
    perform sv.drop_tg_link(v, 'password', 'tg_unlink', null, s.device_label);
  end if;
  perform sv.auth_event(v, 'password_change', s.tg_user_id, null, s.device_label);
  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.sv_logout(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, sv
as $$
declare v uuid := sv.owner_id(p_token);
declare s sv.sessions;
begin
  select * into s from sv.sessions where token_hash = sv.hash_token(p_token);
  update sv.sessions
     set revoked_at = now(), revoke_reason = 'logout'
   where revoked_at is null
     and (token_hash = s.token_hash or (s.chain_id is not null and chain_id = s.chain_id and kind = 'web'));
  return jsonb_build_object('ok', true, 'owner_id', v);
end
$$;

create or replace function public.sv_logout_all(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, sv
as $$
declare v uuid := sv.owner_id(p_token);
begin
  update sv.sessions
     set revoked_at = now(), revoke_reason = 'logout_all'
   where owner_id = v and revoked_at is null;
  perform sv.drop_tg_link(v, 'logout_all', 'logout_all', null, null);
  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.sv_devices(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, sv
as $$
declare v uuid := sv.owner_id(p_token);
declare cur text := sv.hash_token(p_token);
declare l sv.tg_links;
begin
  perform sv.session_touch(p_token);
  select * into l from sv.tg_links where owner_id = v;
  return jsonb_build_object(
    'username', coalesce(l.tg_username, ''),
    'bound', l.tg_user_id is not null,
    'bound_at', l.bound_at,
    'recent', l.bound_at is not null and l.bound_at > now() - interval '24 hours',
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'kind', s.kind,
        'label', coalesce(s.device_label, ''),
        'created_at', s.created_at,
        'last_used_at', s.last_used_at,
        'current', s.token_hash = cur
      ) order by s.last_used_at desc)
      from sv.sessions s
      where s.owner_id = v
        and s.revoked_at is null
        and s.rotated_at is null
        and s.expires_at > now()
        and (s.abs_expires_at is null or s.abs_expires_at > now())
        and s.token_use = 'access'
    ), '[]'::jsonb));
end
$$;

create or replace function public.sv_device_end(p_token text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, sv
as $$
declare v uuid := sv.owner_id(p_token);
declare s sv.sessions;
begin
  select * into s from sv.sessions where id = p_id and owner_id = v for update;
  if not found or s.revoked_at is not null then
    return jsonb_build_object('error', 'Устройство не найдено', 'hint', 'missing');
  end if;
  update sv.sessions
     set revoked_at = now(), revoke_reason = 'device_end'
   where token_hash = s.token_hash
      or (s.chain_id is not null and chain_id = s.chain_id and kind = 'web' and revoked_at is null);
  if s.kind = 'tg' then
    perform sv.drop_tg_link(v, 'device_end', 'device_end', null, s.device_label, false);
  else
    perform sv.auth_event(v, 'device_end', null, null, s.device_label);
  end if;
  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.sv_me(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, sv
as $$
declare v_owner uuid := sv.owner_id(p_token);
declare o sv.owners;
declare c sv.conns;
declare g sv.tg;
declare l sv.tg_links;
begin
  perform sv.session_touch(p_token);
  select * into o from sv.owners where id = v_owner;
  select * into c from sv.conns where owner_id = v_owner;
  select * into g from sv.tg where owner_id = v_owner;
  select * into l from sv.tg_links where owner_id = v_owner;
  return jsonb_build_object(
    'email', o.email,
    'name', o.name,
    'conn', sv.conn_public(c),
    'tg', jsonb_build_object('bound', g.chat_id is not null, 'title', coalesce(g.chat_title, ''), 'bound_at', g.bound_at),
    'tg_login', jsonb_build_object(
      'bound', l.tg_user_id is not null,
      'username', coalesce(l.tg_username, ''),
      'first_name', coalesce(l.tg_first_name, ''),
      'bound_at', l.bound_at),
    'reports', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'day', r.day, 'dept_key', r.dept_key, 'created_at', r.created_at,
        'demo', coalesce((r.data->>'demo')::boolean, false),
        'revenue', r.data#>'{totals,revenue}', 'orders', r.data#>'{totals,orders}',
        'avg', r.data#>'{totals,avg_check}',
        'flags', coalesce(jsonb_array_length(r.data->'flags'), 0)) order by r.day desc, r.dept_key)
      from (select * from sv.reports where owner_id = v_owner order by day desc limit 60) r), '[]'::jsonb));
end
$$;

-- Старый вход с вечным токеном в браузере закрыт: сессию выдаёт только сервер.
create or replace function public.sv_login(p_email text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog
as $$
begin
  return jsonb_build_object('error', 'Войдите на странице кабинета', 'hint', 'auth');
end
$$;

do $drop_register$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('sv_register', 'sv_register_core')
  loop
    execute 'drop function ' || r.sig;
  end loop;
end
$drop_register$;

create or replace function public.sv_register(
  p_email text,
  p_password text,
  p_name text default '',
  p_invite text default null,
  p_offer boolean default false,
  p_consent boolean default false,
  p_doc_version text default null
) returns jsonb
language plpgsql
security definer
set search_path to pg_catalog
as $$
begin
  if p_invite is null or length(p_invite) < 22 then
    raise exception 'Регистрация только по приглашению' using hint = 'invite';
  end if;
  raise exception 'Регистрация только по приглашению на сайте' using hint = 'invite';
end
$$;

create or replace function public.sv_tg_purge()
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, sv
as $$
declare n_init int;
declare n_grace int;
declare n_events int;
declare n_rate int;
begin
  delete from sv.tg_initdata_used where expires_at < now();
  get diagnostics n_init = row_count;
  delete from sv.refresh_grace where expires_at < now();
  get diagnostics n_grace = row_count;
  delete from sv.auth_events where at < now() - interval '1 year';
  get diagnostics n_events = row_count;
  delete from sv.rate_hits where at < now() - interval '2 days';
  get diagnostics n_rate = row_count;
  delete from sv.login_attempts where at < now() - interval '2 days';
  delete from sv.security_minute where bucket < now() - interval '1 day';
  return jsonb_build_object('init', n_init, 'grace', n_grace, 'events', n_events, 'rate', n_rate);
end
$$;

create or replace function public.sv_security_bump(p_kind text)
returns int
language plpgsql
security definer
set search_path to pg_catalog, sv
as $$
declare b timestamptz := date_trunc('minute', now());
declare total int;
begin
  if p_kind not in ('401', '429', 'refresh_reuse') then
    return 0;
  end if;
  insert into sv.security_minute (bucket, kind, n) values (b, p_kind, 1)
  on conflict (bucket, kind) do update set n = sv.security_minute.n + 1;
  select coalesce(sum(n), 0) into total from sv.security_minute
   where kind = p_kind and bucket > now() - interval '5 minutes';
  return total;
end
$$;

-- Права: выпуск сессий Telegram и refresh — только роль сервера.
do $grant$
declare fn text;
declare sig text;
begin
  foreach fn in array array[
    'sv_tg_session(text,bigint,text,text,text)',
    'sv_tg_link(text,bigint,text,text,text,text,text,text,boolean,text,text)',
    'sv_tg_login(text,text,text,bigint,text,text,text,text,text,boolean,text,text)',
    'sv_link_code_consume(text,text)',
    'sv_link_code_issue(text,text,text)',
    'sv_link_code_status(text,text,text)',
    'sv_link_code_dispute(text,text,text)',
    'sv_web_login(text,text,text,text,text)',
    'sv_web_register(text,text,text,text,text,boolean,boolean,text,text,text,text,text)',
    'sv_web_refresh(text,text,text,text,text,text,text,text,text)',
    'sv_web_migrate(text,text,text,text)',
    'sv_invite_issue(text,text,text,integer,text[])',
    'sv_tg_purge()',
    'sv_security_bump(text)',
    'sv_login(text,text)',
    'sv_register(text,text,text,text,boolean,boolean,text)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end
$grant$;

revoke all on function public.sv_password(text, text, text) from public;
revoke all on function public.sv_logout(text) from public;
revoke all on function public.sv_logout_all(text) from public;
revoke all on function public.sv_devices(text) from public;
revoke all on function public.sv_device_end(text, uuid) from public;
revoke all on function public.sv_login_unbind(text) from public;
revoke all on function public.sv_session_touch(text) from public;
revoke all on function public.sv_me(text) from public;

grant execute on function public.sv_password(text, text, text) to anon, authenticated, service_role;
grant execute on function public.sv_logout(text) to anon, authenticated, service_role;
grant execute on function public.sv_logout_all(text) to anon, authenticated, service_role;
grant execute on function public.sv_devices(text) to anon, authenticated, service_role;
grant execute on function public.sv_device_end(text, uuid) to anon, authenticated, service_role;
grant execute on function public.sv_login_unbind(text) to anon, authenticated, service_role;
grant execute on function public.sv_session_touch(text) to anon, authenticated, service_role;
grant execute on function public.sv_me(text) to anon, authenticated, service_role;

revoke all on all functions in schema sv from public, anon, authenticated;
revoke all on schema sv from anon, authenticated;
grant usage on schema sv to service_role;
