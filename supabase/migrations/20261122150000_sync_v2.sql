-- Sync backend, second version (review of PR 41). Applies on top of 20261122140000_sync.sql.
--  - one push or join at a time per account (advisory lock), so the pull cursor (seq) never skips a
--    row that commits late
--  - replaced rows (live, setting, and now the trackers: session / grind / run, whose data changes
--    after they're first sent) have one current copy per account: the root account's; cc_pull leaves
--    out copies it shadows
--  - link codes from a CSPRNG, at most 10 wrong codes per computer an hour
--  - new computers counted per client IP from Cloudflare's cf-connecting-ip (a caller can't set it)
--  - a record counter per account instead of counting rows on every push
--  - retired accounts (test or CI leftovers): no device of theirs can call anything, and Claude's
--    view leaves them out
--  - table grants revoked from the API roles (row-level security already closed them)

alter table public.accounts add column records bigint not null default 0;
alter table public.accounts add column retired boolean not null default false;
update public.accounts a set records = (select count(*) from public.records r where r.account_id = a.id);

create table private.link_attempts (device_id uuid not null, at timestamptz not null default now());
create index link_attempts_device_at on private.link_attempts(device_id, at);
alter table private.link_attempts enable row level security;

revoke all on public.accounts, public.devices, public.records from anon, authenticated;
revoke all on sequence public.records_seq from anon, authenticated;

-- a device of a retired account is unknown
create or replace function private.device_of(p_key text) returns public.devices
language sql stable security definer set search_path = '' as $$
  select d.* from public.devices d join public.accounts a on a.id = d.account_id
  where length(coalesce(p_key, '')) >= 32 and d.key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex')
    and not a.retired
$$;

-- one writer per account at a time, until the transaction ends
create or replace function private.lock_account(p_root uuid) returns void
language sql volatile security definer set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended('cc-account:' || p_root::text, 0))
$$;

create or replace function private.client_ip() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(h ->> 'cf-connecting-ip', ''), nullif(trim(split_part(h ->> 'x-forwarded-for', ',', 1)), ''), '')
  from (select coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb as h) x
$$;

create or replace function private.merge_accounts(p_from uuid, p_into uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare root_from uuid; root_into uuid; joining uuid[];
begin
  select coalesce(merged_into, id) into root_from from public.accounts where id = p_from;
  select coalesce(merged_into, id) into root_into from public.accounts where id = p_into;
  if root_from is null or root_into is null or root_from = root_into then return; end if;
  perform private.lock_account(least(root_from, root_into));
  perform private.lock_account(greatest(root_from, root_into));
  select array_agg(id) into joining from public.accounts where id = root_from or merged_into = root_from;
  update public.accounts set merged_into = root_into where id = any(joining);
  update public.devices set account_id = root_into where account_id = root_from;
  -- the joining group's history is new to the computers already in the account: fresh cursor positions
  update public.records set seq = nextval('public.records_seq') where account_id = any(joining);
end $$;

create or replace function public.cc_register(p_key text, p_name text default null, p_os text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare d public.devices; acc uuid; v_ip text;
begin
  if length(coalesce(p_key, '')) < 32 or length(p_key) > 200 then raise exception 'bad device key'; end if;
  d := private.device_of(p_key);
  if d.id is null then
    if exists (select 1 from public.devices x where x.key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex')) then
      raise exception 'this computer''s account is closed';
    end if;
    v_ip := private.client_ip();
    if (select count(*) from private.register_log where ip = v_ip and at > now() - interval '1 hour') >= 20
       or (select count(*) from private.register_log where at > now() - interval '1 hour') >= 5000 then
      raise exception 'too many new computers right now; try again later';
    end if;
    insert into private.register_log(ip) values (v_ip);
    insert into public.accounts default values returning id into acc;
    insert into public.devices(account_id, key_hash, name, os)
      values (acc, encode(sha256(convert_to(p_key, 'UTF8')), 'hex'), left(p_name, 80), left(p_os, 20))
      returning * into d;
  else
    update public.devices set name = coalesce(left(p_name, 80), name), os = coalesce(left(p_os, 20), os), last_seen = now()
      where id = d.id returning * into d;
  end if;
  return jsonb_build_object('account', d.account_id, 'device', d.id);
end $$;

-- send records [{id, char, kind, t, data, mutable}], at most 1000 per call. History is written once
-- per account (re-sending changes nothing, also when another computer of the account sent it).
-- Replaced rows have one current copy, in the root account: updated when the data changed.
create or replace function public.cc_push(p_key text, p_records jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare d public.devices; n_new int; n_upd int; total bigint;
begin
  d := private.device_of(p_key);
  if d.id is null then raise exception 'unknown device'; end if;
  if jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records) > 1000 then raise exception 'send an array of at most 1000 records'; end if;
  if exists (select 1 from jsonb_array_elements(p_records) x
             where length(coalesce(x->>'id', '')) not between 1 and 400 or length(coalesce(x->>'char', '')) not between 1 and 100
                or length(coalesce(x->>'kind', '')) not between 1 and 20 or octet_length((x->'data')::text) > 65536 or x->'data' is null) then
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

-- the account's records after a cursor (seq), oldest first, and its computers. Leaves out this
-- computer's own live rows (its own save has them) and replaced rows another copy shadows (the
-- root account's copy, else the newest). This computer's history comes back too, so history the
-- addon has trimmed, or a lost save, stays in the merged view.
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
            and not (r.kind = 'live' and r.device_id = d.id)
            and not (r.mutable and exists (
              select 1 from public.records y
              where y.id = r.id and y.mutable and y.account_id in (select private.group_of(d.account_id)) and y.account_id <> r.account_id
                and (y.account_id = d.account_id or (r.account_id <> d.account_id and y.updated_at > r.updated_at))))
          order by r.seq limit least(greatest(coalesce(p_limit, 2000), 1), 5000)) r;
  return jsonb_build_object('account', d.account_id, 'device', d.id, 'records', v_out,
    'devices', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'os', x.os, 'chars', x.chars, 'seen', x.last_seen) order by x.created_at), '[]')
                from public.devices x where x.account_id = d.account_id));
end $$;

-- a code another computer can type to join this account (30 minutes; a new one replaces the old).
-- 32 letters and digits (no I, O, 0, 1), 8 of them: 40 bits from the CSPRNG
create or replace function public.cc_link_code(p_key text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare d public.devices; c text; abc constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; b bytea; i int;
begin
  d := private.device_of(p_key);
  if d.id is null then raise exception 'unknown device'; end if;
  loop
    b := extensions.gen_random_bytes(8);
    c := '';
    for i in 0..7 loop c := c || substr(abc, 1 + (get_byte(b, i) & 31), 1); end loop;
    exit when not exists (select 1 from private.link_codes where code = c);
  end loop;
  insert into private.link_codes as l (code, account_id, expires_at) values (c, d.account_id, now() + interval '30 minutes')
    on conflict (account_id) do update set code = excluded.code, expires_at = excluded.expires_at;
  return jsonb_build_object('code', c, 'expires', now() + interval '30 minutes');
end $$;

-- join the account a link code belongs to (this computer's whole account joins it). At most 10
-- wrong codes per computer an hour.
create or replace function public.cc_link(p_key text, p_code text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare d public.devices; target uuid;
begin
  d := private.device_of(p_key);
  if d.id is null then raise exception 'unknown device'; end if;
  if (select count(*) from private.link_attempts where device_id = d.id and at > now() - interval '1 hour') >= 10 then
    raise exception 'too many wrong codes; try again in an hour';
  end if;
  select account_id into target from private.link_codes
    where code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')) and expires_at > now();
  if target is null then
    insert into private.link_attempts(device_id) values (d.id);
    return jsonb_build_object('error', 'that code is wrong or has expired');
  end if;
  perform private.merge_accounts(d.account_id, target);
  update private.link_codes set expires_at = now() where account_id = target;   -- a code works once
  return jsonb_build_object('account', target, 'device', d.id);
end $$;

-- the whole history of one person, for Claude (read with the connector):
--   select * from private.history where account = '<root account id>' and kind = 'journal' order by t desc
create or replace view private.history as
  select coalesce(a.merged_into, a.id) as account, r.char_key, r.kind, r.t, to_timestamp(r.t) as at,
         dv.name as computer, r.data, r.id, r.mutable
  from public.records r join public.accounts a on a.id = r.account_id left join public.devices dv on dv.id = r.device_id
  where not a.retired;

grant execute on function public.cc_register(text, text, text), public.cc_push(text, jsonb), public.cc_pull(text, bigint, int),
  public.cc_link_code(text), public.cc_link(text, text) to anon, authenticated;
