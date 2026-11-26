-- Минимальная схема Сводки, как она есть до входа через Telegram.
-- Снята для локальных тестов. К боевой базе не применять: там эти объекты уже есть.

create schema if not exists sv;
create schema if not exists bill;
create schema if not exists app;
create schema if not exists zh;

create table if not exists sv.owners (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  pass_hash text not null,
  name text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists sv.sessions (
  token_hash text primary key,
  owner_id uuid not null references sv.owners(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists sv.login_attempts (
  id bigint generated always as identity primary key,
  email text not null,
  at timestamptz not null default now()
);

create table if not exists sv.tg (
  owner_id uuid primary key references sv.owners(id) on delete cascade,
  code text unique,
  chat_id bigint,
  chat_title text not null default '',
  bound_at timestamptz
);

create table if not exists sv.conns (
  owner_id uuid primary key references sv.owners(id) on delete cascade,
  mode text,
  base_url text,
  login text,
  auto boolean not null default true,
  last_error text,
  last_ok_at timestamptz,
  has_password boolean not null default false
);

create table if not exists sv.reports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references sv.owners(id) on delete cascade,
  day date,
  dept_key text not null default 'all',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function sv.hash_token(p text)
returns text
language sql
immutable
set search_path to pg_catalog, extensions
as $$
  select encode(extensions.digest(convert_to(coalesce(p, ''), 'UTF8'), 'sha256'), 'hex')
$$;

create or replace function sv.new_token()
returns text
language sql
volatile
set search_path to pg_catalog, extensions
as $$
  select encode(extensions.gen_random_bytes(24), 'hex')
$$;

create or replace function sv.clean(p text, n int)
returns text
language sql
immutable
set search_path to pg_catalog
as $$
  select left(btrim(coalesce(p, '')), greatest(n, 0))
$$;

create or replace function sv.check_secret(p_secret text)
returns void
language plpgsql
set search_path to pg_catalog
as $$
begin
  if p_secret is null or length(p_secret) < 8 then
    raise exception 'forbidden' using hint = 'secret';
  end if;
end
$$;

create or replace function sv.owner_id(p_token text)
returns uuid
language plpgsql
stable
set search_path to pg_catalog, sv
as $$
declare v uuid;
begin
  if p_token is null or length(p_token) < 20 then
    raise exception 'Нужно войти' using hint = 'auth';
  end if;
  select s.owner_id into v from sv.sessions s
   where s.token_hash = sv.hash_token(p_token) and s.expires_at > now();
  if v is null then
    raise exception 'Сессия закончилась, войдите снова' using hint = 'auth';
  end if;
  return v;
end
$$;

create or replace function sv.conn_public(c sv.conns)
returns jsonb
language sql
stable
set search_path to pg_catalog
as $$
  select case when c is null or c.owner_id is null then null
    else jsonb_build_object(
      'mode', c.mode, 'base_url', c.base_url, 'login', c.login, 'auto', c.auto,
      'has_password', c.has_password, 'last_error', coalesce(c.last_error, ''), 'last_ok_at', c.last_ok_at)
  end
$$;

create or replace function public.sv_login(p_email text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, sv, extensions
as $$
declare e text := lower(trim(coalesce(p_email, ''))); o sv.owners; t text; n int;
begin
  select count(*) into n from sv.login_attempts where email = e and at > now() - interval '15 minutes';
  if n >= 10 then return jsonb_build_object('error', 'Слишком много попыток. Подождите 15 минут'); end if;
  select * into o from sv.owners where email = e;
  if not found or o.pass_hash <> extensions.crypt(coalesce(p_password, ''), o.pass_hash) then
    insert into sv.login_attempts (email) values (e);
    return jsonb_build_object('error', 'Неверная почта или пароль');
  end if;
  t := sv.new_token();
  insert into sv.sessions (token_hash, owner_id, expires_at) values (sv.hash_token(t), o.id, now() + interval '30 days');
  return jsonb_build_object('token', t, 'email', o.email, 'name', o.name);
end
$$;

create or replace function public.sv_register(p_email text, p_password text, p_name text default '')
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, sv, extensions
as $$
declare e text := lower(trim(coalesce(p_email, ''))); o sv.owners; t text;
begin
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(e) > 200 then
    raise exception 'Проверьте адрес почты' using hint = 'invalid';
  end if;
  if length(coalesce(p_password, '')) < 8 or length(p_password) > 72 then
    raise exception 'Пароль — от 8 до 72 символов' using hint = 'invalid';
  end if;
  if exists (select 1 from sv.owners where email = e) then
    raise exception 'Эта почта уже зарегистрирована — войдите' using hint = 'exists';
  end if;
  if (select count(*) from sv.owners where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Слишком много регистраций, попробуйте через час' using hint = 'rate';
  end if;
  insert into sv.owners (email, pass_hash, name)
  values (e, extensions.crypt(p_password, extensions.gen_salt('bf', 10)), sv.clean(p_name, 80))
  returning * into o;
  t := sv.new_token();
  insert into sv.sessions (token_hash, owner_id, expires_at) values (sv.hash_token(t), o.id, now() + interval '30 days');
  return jsonb_build_object('token', t, 'email', o.email, 'name', o.name);
end
$$;

create or replace function public.sv_logout(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, sv
as $$
begin
  update sv.sessions set expires_at = now() where token_hash = sv.hash_token(p_token);
  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.sv_me(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, sv
as $$
declare v_owner uuid := sv.owner_id(p_token); o sv.owners; c sv.conns; g sv.tg;
begin
  select * into o from sv.owners where id = v_owner;
  select * into c from sv.conns where owner_id = v_owner;
  select * into g from sv.tg where owner_id = v_owner;
  return jsonb_build_object(
    'email', o.email, 'name', o.name, 'conn', sv.conn_public(c),
    'tg', jsonb_build_object('bound', g.chat_id is not null, 'title', coalesce(g.chat_title, ''), 'bound_at', g.bound_at),
    'reports', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'day', r.day, 'dept_key', r.dept_key, 'created_at', r.created_at,
        'demo', coalesce((r.data->>'demo')::boolean, false)) order by r.day desc)
      from (select * from sv.reports where owner_id = v_owner order by day desc limit 60) r), '[]'::jsonb));
end
$$;

create or replace function public.sv_tg_bind(p_secret text, p_code text, p_chat bigint, p_title text)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, sv
as $$
declare g sv.tg; o sv.owners;
begin
  perform sv.check_secret(p_secret);
  update sv.tg set chat_id = p_chat, chat_title = sv.clean(p_title, 120), bound_at = now(), code = null
   where code = p_code and p_code is not null and length(p_code) = 18
   returning * into g;
  if not found then return jsonb_build_object('ok', false); end if;
  select * into o from sv.owners where id = g.owner_id;
  return jsonb_build_object('ok', true, 'email', o.email);
end
$$;

create or replace function public.sv_tg_unbind(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, sv
as $$
declare v_owner uuid := sv.owner_id(p_token);
begin
  update sv.tg set chat_id = null, chat_title = '', bound_at = null, code = null where owner_id = v_owner;
  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.sv_invoice(p_token text, p_phone text default '', p_comment text default '')
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, sv
as $$
declare v uuid := sv.owner_id(p_token);
begin
  return jsonb_build_object('ok', true, 'owner_id', v);
end
$$;

-- Заглушки функций кабинета: все смотрят владельца через sv.owner_id.
create or replace function public.sv_agent(p_token text, p_op text default 'home', p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to pg_catalog, sv as $$
declare v uuid := sv.owner_id(p_token);
begin return jsonb_build_object('ok', true, 'owner_id', v, 'op', p_op); end $$;

create or replace function public.sv_conn_remove(p_token text)
returns jsonb language plpgsql security definer set search_path to pg_catalog, sv as $$
declare v uuid := sv.owner_id(p_token);
begin return jsonb_build_object('ok', true, 'owner_id', v); end $$;

create or replace function public.sv_conn_save(p_token text, p_conn jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to pg_catalog, sv as $$
declare v uuid := sv.owner_id(p_token);
begin return jsonb_build_object('ok', true, 'owner_id', v); end $$;

create or replace function public.sv_conn_status(p_token text, p_error text default '')
returns jsonb language plpgsql security definer set search_path to pg_catalog, sv as $$
declare v uuid := sv.owner_id(p_token);
begin return jsonb_build_object('ok', true, 'owner_id', v); end $$;

create or replace function public.sv_conn_update(p_token text, p_patch jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to pg_catalog, sv as $$
declare v uuid := sv.owner_id(p_token);
begin return jsonb_build_object('ok', true, 'owner_id', v); end $$;

create or replace function public.sv_conn_secret(p_token text)
returns jsonb language plpgsql security definer set search_path to pg_catalog, sv as $$
declare v uuid := sv.owner_id(p_token);
begin return jsonb_build_object('ok', true, 'owner_id', v, 'mode', 'demo', 'chat_id', null); end $$;

create or replace function public.sv_tg_code(p_token text)
returns jsonb language plpgsql security definer set search_path to pg_catalog, sv as $$
declare v uuid := sv.owner_id(p_token);
begin return jsonb_build_object('ok', true, 'owner_id', v, 'code', 'abc123abc123abc123'); end $$;

create or replace function public.sv_report_get(p_token text, p_id uuid default null)
returns jsonb language plpgsql security definer set search_path to pg_catalog, sv as $$
declare v uuid := sv.owner_id(p_token);
begin return jsonb_build_object('ok', true, 'owner_id', v, 'id', p_id); end $$;

create or replace function public.sv_report_save(p_token text, p_day date default null, p_dept text default 'all', p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to pg_catalog, sv as $$
declare v uuid := sv.owner_id(p_token);
begin return jsonb_build_object('ok', true, 'owner_id', v); end $$;

create or replace function public.sv_plan(p_token text)
returns jsonb language plpgsql security definer set search_path to pg_catalog, sv as $$
declare v uuid := sv.owner_id(p_token);
begin return jsonb_build_object('owner_id', v, 'plan', null, 'status', 'none', 'plans', '[]'::jsonb); end $$;

create or replace function public.sv_plan_set(p_token text, p_plan text default '')
returns jsonb language plpgsql security definer set search_path to pg_catalog, sv as $$
declare v uuid := sv.owner_id(p_token);
begin return jsonb_build_object('ok', true, 'owner_id', v, 'plan', p_plan); end $$;

create or replace function public.sv_cron_jobs(p_token text)
returns jsonb language plpgsql security definer set search_path to pg_catalog, sv as $$
declare v uuid := sv.owner_id(p_token);
begin return jsonb_build_object('ok', true, 'owner_id', v); end $$;

create or replace function public.sv_cron_save(p_token text, p_owner uuid default null, p_day date default null, p_dept text default 'all', p_data jsonb default '{}'::jsonb, p_error text default '')
returns jsonb language plpgsql security definer set search_path to pg_catalog, sv as $$
declare v uuid := sv.owner_id(p_token);
begin return jsonb_build_object('ok', true, 'owner_id', v); end $$;

create or replace function app.owner_id(p_token text)
returns uuid language sql stable set search_path to pg_catalog as $$ select null::uuid $$;

create or replace function zh.owner_id(p_token text)
returns uuid language sql stable set search_path to pg_catalog as $$ select null::uuid $$;

create or replace function bill.owner_of(p_product text, p_token text)
returns uuid
language plpgsql
stable
security definer
set search_path to pg_catalog
as $$
begin
  return case p_product
    when 'pd' then app.owner_id(p_token)
    when 'zh' then zh.owner_id(p_token)
    when 'sv' then sv.owner_id(p_token)
    else null end;
end
$$;

create or replace function public.bill_sv_status(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, bill
as $$
declare v uuid := bill.owner_of('sv', p_token);
begin
  return jsonb_build_object('owner_id', v);
end
$$;

grant usage on schema sv, bill, app, zh, extensions, public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;
grant execute on all functions in schema sv, bill, app, zh to anon, authenticated, service_role;
