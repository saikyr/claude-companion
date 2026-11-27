-- fact_problem with the account (last in 20261124090000_card_gate_flag_old.sql, never edited), as before, except that an
-- `ah:` src no longer matches an item search row saved before #170: those rows divided one auction's buyout by the number
-- of auctions the search grouped, so an item that doesn't stack read a half or a third of its price. A search row from
-- #170 on carries `stack` (the item's stack size the price was read with); scan and browse rows are as before.
create or replace function private.fact_problem(p_snap jsonb, f jsonb, p_root uuid) returns text language plpgsql stable set search_path = '' as $$
declare src text := f->>'src'; txt text := coalesce(f->>'value', '') || ' ' || coalesce(f->>'note', ''); m text[]; seen numeric[]; rp jsonb; old int;
begin
  if src ~ '^snapshot#.*\[' then
    if p_snap is null then return 'no snapshot online to check ' || src || ' against'; end if;
    rp := private.snap_path(p_snap, split_part(src, '#', 2));
    if rp ? 'error' then return rp->>'error'; end if;
    return private.fact_problem(p_snap, jsonb_set(f, '{src}', to_jsonb('snapshot#' || (rp->>'path'))));
  end if;
  if src !~ '^ah:' then return private.fact_problem(p_snap, f); end if;
  m := regexp_match(src, '^ah:(\d+)@(\d+)#(min|med)$');
  select coalesce(array_agg((r.data->>m[3])::numeric) filter (where not (r.data->>'src' = 'search' and not r.data ? 'stack')), '{}'),
         count(*) filter (where r.data->>'src' = 'search' and not r.data ? 'stack')
    into seen, old
    from public.records r join public.accounts a on a.id = r.account_id
   where coalesce(a.merged_into, a.id) = p_root and not a.retired and r.kind = 'ah_obs'
     and r.data->>'item' = m[1] and r.t = m[2]::bigint and jsonb_typeof(r.data->m[3]) = 'number';
  if cardinality(seen) = 0 and old > 0 then
    return 'the AH reading of item ' || m[1] || ' at ' || m[2] || ' is an item search from before #170, whose price can be a fraction of the real one: quote a full scan instead';
  end if;
  if cardinality(seen) = 0 then return 'no AH scan of item ' || m[1] || ' at ' || m[2] || ' with a ' || m[3] || ' price in your synced data'; end if;
  if not exists (select 1 from unnest(seen) x where private.quotes_gold(txt, x)) then
    return 'your AH scan says ' || m[3] || ' ' || (select string_agg(round(x / 10000, 2)::text || 'g', ' or ') from unnest(seen) x);
  end if;
  return null;
end $$;
