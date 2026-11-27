-- Sync backend: a tracker (a session, grind or dungeon run) can be up to 1 MB, and a refused record is named.
-- A long session or run carries every item looted and who got it (groupLoot, lootBy): a dungeon run reached 55 KB,
-- and one save after hours of play held a tracker over the old 64 KB limit. cc_push refused the whole batch with
-- "bad record", and the app sent its records oldest first, so nothing newer than that record ever went (27 Nov:
-- 2408 records waiting, no fresh snapshot or "now" online). Now: sessions, grinds and runs up to 1 MB (snapshot and
-- now 2 MB, the rest 64 KB as before), and the error names the record and why ("bad record <id>: <why>"), so the
-- app sets that one record aside and sends the rest (js/sync.js).

create or replace function private.record_cap(p_kind text) returns int
language sql immutable set search_path = '' as $$
  select case when p_kind in ('snapshot', 'now') then 2097152 when p_kind in ('session', 'grind', 'run') then 1048576 else 65536 end
$$;
revoke all on function private.record_cap(text) from public, anon, authenticated;

create or replace function public.cc_push(p_key text, p_records jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare d public.devices; n_new int; n_upd int; total bigint; bad_id text; bad_why text;
begin
  d := private.device_of(p_key);
  if d.id is null then raise exception 'unknown device'; end if;
  if jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records) > 1000 then raise exception 'send an array of at most 1000 records'; end if;
  -- the first record the backend can't take, and why: named in the error, so the app can set it aside and send the rest
  select s.id, s.why into bad_id, bad_why from (
    select i, x->>'id' id, case
             when length(coalesce(x->>'id', '')) not between 1 and 400 then 'its id is empty or longer than 400'
             when length(coalesce(x->>'char', '')) not between 1 and 100 then 'its character is empty or longer than 100'
             when length(coalesce(x->>'kind', '')) not between 1 and 20 then 'its kind is empty or longer than 20'
             when x->'data' is null then 'it has no data'
             when octet_length((x->'data')::text) > private.record_cap(x->>'kind')
               then format('its data is %s bytes, at most %s for %s', octet_length((x->'data')::text), private.record_cap(x->>'kind'), x->>'kind')
             when x->>'kind' = 'snapshot' and (x->>'id' <> 'snapshot|' || d.id::text or not coalesce((x->>'mutable')::boolean, false))
               then 'a snapshot that is not this computer''s'
             when x->>'kind' = 'now' and (x->>'id' <> (x->>'char') || '|now|' || d.id::text or not coalesce((x->>'mutable')::boolean, false))
               then 'a now record that is not this computer''s'
           end why
      from jsonb_array_elements(p_records) with ordinality e(x, i)) s
   where s.why is not null order by s.i limit 1;
  if bad_why is not null then raise exception 'bad record %: %', coalesce(bad_id, '(no id)'), bad_why; end if;
  perform private.lock_account(d.account_id);
  -- the account may have joined another one while this call waited: write into where it is now
  d := private.device_of(p_key);
  if d.id is null then raise exception 'unknown device'; end if;
  perform private.lock_account(d.account_id);
  select coalesce(sum(records), 0) into total from public.accounts where id in (select private.group_of(d.account_id));
  if total > 2000000 then raise exception 'this account is full'; end if;
  with src as (
    select distinct on (x->>'id') x->>'id' as id, x->>'char' as char_key, x->>'kind' as kind, (x->>'t')::bigint as t,
           x->'data' as data, coalesce((x->>'mutable')::boolean, false) as mutable
    from jsonb_array_elements(p_records) with ordinality as e(x, i) order by x->>'id', i desc),
  upd as (
    update public.records r set data = s.data, t = s.t, device_id = d.id, mutable = true, seq = nextval('public.records_seq'), updated_at = now()
    from src s where s.mutable and r.account_id = d.account_id and r.id = s.id and r.data is distinct from s.data
    returning 1),
  ins as (
    insert into public.records (account_id, id, device_id, char_key, kind, t, data, mutable)
      select d.account_id, s.id, d.id, s.char_key, s.kind, s.t, s.data, s.mutable from src s
      where (s.mutable and not exists (select 1 from public.records y where y.account_id = d.account_id and y.id = s.id))
         or (not s.mutable and not exists (select 1 from public.records y where y.account_id in (select private.group_of(d.account_id)) and y.id = s.id))
    on conflict (account_id, id) do nothing
    returning 1)
  select (select count(*) from ins), (select count(*) from upd) into n_new, n_upd;
  update public.accounts set records = records + n_new where id = d.account_id;
  update public.devices set last_seen = now(),
      chars = (select coalesce(array_agg(distinct c), '{}') from
                 (select unnest(chars) c union select x->>'char' from jsonb_array_elements(p_records) x where x->>'char' <> '*') s)
    where id = d.id;
  return jsonb_build_object('stored', n_new + n_upd, 'account', d.account_id, 'device', d.id);
end $$;

grant execute on function public.cc_push(text, jsonb) to anon, authenticated;
