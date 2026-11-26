-- Согласие по ст. 9 ч. 3 152-ФЗ: оператор хранит, когда человек принял оферту
-- и дал согласие, какую редакцию документов он видел, с какого IP и из какого браузера.
-- Тела sv_register и sv_invoice не переписываются: функции переименовываются в *_core,
-- а снаружи остаётся проверка флагов и запись доказательства.

create table if not exists public.sv_legal_consent (
  id bigint generated always as identity primary key,
  product text not null default 'sv',
  kind text not null check (kind in ('register', 'invoice')),
  email text,
  phone_given boolean not null default false,
  offer boolean not null,
  consent boolean not null,
  doc_version text not null,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

comment on table public.sv_legal_consent is
  'Доказательство акцепта оферты и согласия на обработку ПДн (152-ФЗ ст. 9 ч. 3).';

alter table public.sv_legal_consent enable row level security;
revoke all on table public.sv_legal_consent from public;
do $revoke$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.sv_legal_consent from anon, authenticated';
  end if;
end
$revoke$;

create or replace function public.sv_request_meta()
returns table(ip text, user_agent text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  headers json;
  raw_ip text;
begin
  begin
    headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    headers := null;
  end;
  headers := coalesce(headers, '{}'::json);
  raw_ip := coalesce(headers->>'x-forwarded-for', headers->>'x-real-ip', inet_client_addr()::text, '');
  ip := btrim(split_part(raw_ip, ',', 1));
  user_agent := left(coalesce(headers->>'user-agent', ''), 500);
  return next;
end;
$$;

revoke all on function public.sv_request_meta() from public;

-- Оборачивает одну RPC: без p_offer, p_consent и редакции документа вызов отклоняется.
create or replace function public.sv_wrap_consent_rpc(fn_name text, kind_name text)
returns void
language plpgsql
set search_path = public
as $wrap$
declare
  proc pg_proc;
  arg_sql text;
  id_args text;
  ret text;
  call_args text;
  email_expr text;
  phone_expr text;
  new_id text;
  new_sql text;
  role_name text;
begin
  if kind_name not in ('register', 'invoice') then
    raise exception 'Неизвестный вид согласия: %', kind_name;
  end if;

  select p.* into proc
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = fn_name
    and pg_get_function_identity_arguments(p.oid) not like '%p_consent%';

  if not found then
    if exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = fn_name
        and pg_get_function_identity_arguments(p.oid) like '%p_consent%'
    ) then
      raise notice '% уже проверяет согласие', fn_name;
      return;
    end if;
    raise exception 'Нет функции public.% — согласие некуда записать', fn_name;
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = fn_name || '_core'
  ) then
    raise exception 'Функция %_core уже есть, повторно переносить её нельзя', fn_name;
  end if;

  if proc.proargnames is null then
    raise exception 'У public.% нет имён аргументов', fn_name;
  end if;

  arg_sql := pg_get_function_arguments(proc.oid);
  id_args := pg_get_function_identity_arguments(proc.oid);
  ret := pg_get_function_result(proc.oid);

  if proc.proargmodes is null then
    select string_agg(format('%I := %I', name, name), ', ' order by ord)
      into call_args
    from unnest(proc.proargnames) with ordinality as u(name, ord)
    where name is not null and name <> '';
  else
    select string_agg(format('%I := %I', name, name), ', ' order by ord)
      into call_args
    from unnest(proc.proargnames, proc.proargmodes) with ordinality as u(name, mode, ord)
    where name is not null and name <> '' and coalesce(mode, 'i') in ('i', 'b');
  end if;

  email_expr := case when 'p_email' = any(proc.proargnames) then 'nullif(btrim(p_email), '''')' else 'null' end;
  phone_expr := case
    when 'p_phone' = any(proc.proargnames) then '(nullif(btrim(coalesce(p_phone, '''')), '''') is not null)'
    else 'false'
  end;

  execute format('alter function public.%I(%s) rename to %I', fn_name, id_args, fn_name || '_core');
  execute format('revoke all on function public.%I(%s) from public', fn_name || '_core', id_args);

  new_id := id_args || ', p_offer boolean, p_consent boolean, p_doc_version text';

  if ret = 'void' then
    new_sql := format($fmt$
      create function public.%I(%s, p_offer boolean default false, p_consent boolean default false, p_doc_version text default null)
      returns void
      language plpgsql
      security definer
      set search_path = public
      as $body$
      declare
        meta record;
      begin
        if coalesce(p_offer, false) is not true
           or coalesce(p_consent, false) is not true
           or nullif(btrim(coalesce(p_doc_version, '')), '') is null then
          raise exception 'Нужно принять оферту и дать согласие на обработку персональных данных'
            using errcode = 'P0001', hint = 'consent';
        end if;
        select * into meta from public.sv_request_meta();
        perform public.%I(%s);
        insert into public.sv_legal_consent(product, kind, email, phone_given, offer, consent, doc_version, ip, user_agent)
        values ('sv', %L, %s, %s, true, true, btrim(p_doc_version), meta.ip, meta.user_agent);
      end
      $body$
    $fmt$, fn_name, arg_sql, fn_name || '_core', call_args, kind_name, email_expr, phone_expr);
  else
    new_sql := format($fmt$
      create function public.%I(%s, p_offer boolean default false, p_consent boolean default false, p_doc_version text default null)
      returns %s
      language plpgsql
      security definer
      set search_path = public
      as $body$
      declare
        result %s;
        meta record;
      begin
        if coalesce(p_offer, false) is not true
           or coalesce(p_consent, false) is not true
           or nullif(btrim(coalesce(p_doc_version, '')), '') is null then
          raise exception 'Нужно принять оферту и дать согласие на обработку персональных данных'
            using errcode = 'P0001', hint = 'consent';
        end if;
        select * into meta from public.sv_request_meta();
        result := public.%I(%s);
        insert into public.sv_legal_consent(product, kind, email, phone_given, offer, consent, doc_version, ip, user_agent)
        values ('sv', %L, %s, %s, true, true, btrim(p_doc_version), meta.ip, meta.user_agent);
        return result;
      end
      $body$
    $fmt$, fn_name, arg_sql, ret, ret, fn_name || '_core', call_args, kind_name, email_expr, phone_expr);
  end if;

  execute new_sql;
  execute format('revoke all on function public.%I(%s) from public', fn_name, new_id);
  execute format('comment on function public.%I(%s) is %L', fn_name, new_id,
    'Проверяет оферту и согласие и пишет доказательство (152-ФЗ ст. 9 ч. 3)');

  foreach role_name in array ARRAY['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('grant execute on function public.%I(%s) to %I', fn_name, new_id, role_name);
    end if;
  end loop;
end;
$wrap$;

select public.sv_wrap_consent_rpc('sv_register', 'register');
select public.sv_wrap_consent_rpc('sv_invoice', 'invoice');

revoke all on function public.sv_wrap_consent_rpc(text, text) from public;
