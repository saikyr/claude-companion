-- Sync backend, fourth version: each computer's "now" of each character (the save's snapshot part:
-- bags, gear, quests, talents, rep, skills; plus bank, mail, professions, specs, flight paths, the AH
-- auctions you own) as one replaced row per computer and character: kind 'now', id
-- '<char>|now|<device>', up to 2 MB. Other computers pull it, and the app shows each part from
-- whichever computer saw it last (js/merge.js), so a computer you haven't played on in a while shows
-- what you have now. A computer's own 'now' rows stay out of its pull, like its 'live' rows.

create or replace function public.cc_push(p_key text, p_records jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare d public.devices; n_new int; n_upd int; total bigint;
begin
  d := private.device_of(p_key);
  if d.id is null then raise exception 'unknown device'; end if;
  if jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records) > 1000 then raise exception 'send an array of at most 1000 records'; end if;
  if exists (select 1 from jsonb_array_elements(p_records) x
             where length(coalesce(x->>'id', '')) not between 1 and 400 or length(coalesce(x->>'char', '')) not between 1 and 100
                or length(coalesce(x->>'kind', '')) not between 1 and 20 or x->'data' is null
                or octet_length((x->'data')::text) > case when x->>'kind' in ('snapshot', 'now') then 2097152 else 65536 end
                or (x->>'kind' = 'snapshot' and (x->>'id' <> 'snapshot|' || d.id::text or not coalesce((x->>'mutable')::boolean, false)))
                or (x->>'kind' = 'now' and (x->>'id' <> (x->>'char') || '|now|' || d.id::text or not coalesce((x->>'mutable')::boolean, false)))) then
    raise exception 'bad record';
  end if;
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

-- as before; a computer's own live and now rows stay out (its own save has them), and snapshots too
create or replace function public.cc_pull(p_key text, p_after bigint default 0, p_limit int default 2000) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare d public.devices; v_out jsonb;
begin
  d := private.device_of(p_key);
  if d.id is null then raise exception 'unknown device'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'dev', r.device_id, 'char', r.char_key, 'kind', r.kind, 't', r.t,
                                               'data', r.data, 'mutable', r.mutable, 'seq', r.seq) order by r.seq), '[]')
    into v_out
    from (select * from public.records r
          where r.account_id in (select private.group_of(d.account_id)) and r.seq > coalesce(p_after, 0)
            and r.kind <> 'snapshot'
            and not (r.kind in ('live', 'now') and r.device_id = d.id)
            and not (r.mutable and exists (
              select 1 from public.records y
              where y.id = r.id and y.mutable and y.account_id in (select private.group_of(d.account_id)) and y.account_id <> r.account_id
                and (y.account_id = d.account_id or (r.account_id <> d.account_id and y.updated_at > r.updated_at))))
          order by r.seq limit least(greatest(coalesce(p_limit, 2000), 1), 5000)) r;
  return jsonb_build_object('account', d.account_id, 'device', d.id, 'records', v_out,
    'devices', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'os', x.os, 'chars', x.chars, 'seen', x.last_seen) order by x.created_at), '[]')
                from public.devices x where x.account_id = d.account_id));
end $$;

grant execute on function public.cc_push(text, jsonb), public.cc_pull(text, bigint, int) to anon, authenticated;
