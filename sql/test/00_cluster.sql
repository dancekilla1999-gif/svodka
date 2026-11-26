-- Локальный Postgres для тестов. Не применять к боевой базе Supabase.
-- Роли названы как у Supabase, чтобы миграция с revoke/grant совпала с продом.

create schema if not exists extensions;
create extension if not exists pgcrypto schema extensions;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$roles$;
