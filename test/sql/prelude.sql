-- What a Supabase project already has, for running supabase/migrations on a plain Postgres in tests
-- (test/sql/backend.js): the API roles and pgcrypto in schema extensions.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to anon, authenticated;
grant usage on schema public to anon, authenticated;
-- Supabase grants the API roles everything on new tables in public (row-level security keeps them out)
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
