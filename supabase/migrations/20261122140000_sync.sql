-- Claude Companion sync backend: the whole schema as it runs on project jucbngafdnyaizfxgplk.
-- docs/ARCHITECTURE.md, "Sync between computers", explains the design.
--
-- Accounts are keyed by computers: each install makes a random device key (its
-- companion-data/sync.json) and registers it; the database keeps only its SHA-256. A second computer
-- joins an account with a link code (cc_link). An account is a group: the joining account points at
-- the one it joined (merged_into, always the root), its computers move to the root, and its history
-- stays where it was written. Nothing is ever moved or removed.
--
-- The tables are closed to the API (row-level security on, no policies). Clients only call the cc_*
-- functions, which check the device key and only touch that key's own account. Only the publishable
-- key is in the app.

create schema if not exists private;

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  note text,                                            -- who this is, for Claude
  merged_into uuid references public.accounts(id)       -- joined into this account (the group's root)
);
create index accounts_merged_into on public.accounts(merged_into);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,   -- always a root account
  key_hash text not null unique,             -- sha256 of the device key, hex
  name text,                                 -- computer name, as the app reports it
  os text,                                   -- pc / mac / linux
  chars text[] not null default '{}',        -- characters this computer has sent
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create index devices_account on public.devices(account_id);

create sequence public.records_seq;
create table public.records (
  account_id uuid not null references public.accounts(id) on delete cascade,
  id text not null,                          -- content id (js/sync.js): the same event from two computers has the same id
  device_id uuid references public.devices(id) on delete set null,   -- the computer that sent it
  char_key text not null,                    -- the addon's "Name-Realm" key ('*' for app settings)
  kind text not null,                        -- journal session grind run note history de ah_obs ah_sale ah_buy ah_post live setting
  t bigint,                                  -- game time (Unix seconds)
  data jsonb not null,                       -- the entry exactly as the addon saved it
  mutable boolean not null default false,    -- live / setting rows are replaced; history is written once
  seq bigint not null default nextval('public.records_seq'),   -- pull cursor
  updated_at timestamptz not null default now(),
  primary key (account_id, id)
);
create index records_account_seq on public.records(account_id, seq);
create index records_account_kind_t on public.records(account_id, char_key, kind, t);

create table private.link_codes (
  code text primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  expires_at timestamptz not null
);
create unique index link_codes_account on private.link_codes(account_id);   -- one code per account, replaced
create table private.register_log (ip text, at timestamptz not null default now());   -- new computers, for the rate limit
create index register_log_at on private.register_log(at);

alter table public.accounts enable row level security;
alter table public.devices enable row level security;
alter table public.records enable row level security;
alter table private.link_codes enable row level security;
alter table private.register_log enable row level security;

-- ------------------------------------------------------------------ internals (schema private: not reachable through the API)
create function private.device_of(p_key text) returns public.devices
language sql stable security definer set search_path = '' as $$
  select d.* from public.devices d
  where length(coalesce(p_key, '')) >= 32 and d.key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex')
$$;

create function private.group_of(p_root uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select id from public.accounts where id = p_root or merged_into = p_root
$$;

create function private.merge_accounts(p_from uuid, p_into uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare root_from uuid; root_into uuid; joining uuid[];
begin
  select coalesce(merged_into, id) into root_from from public.accounts where id = p_from;
  select coalesce(merged_into, id) into root_into from public.accounts where id = p_into;
  if root_from is null or root_into is null or root_from = root_into then return; end if;
  select array_agg(id) into joining from public.accounts where id = root_from or merged_into = root_from;
  update public.accounts set merged_into = root_into where id = any(joining);
  update public.devices set account_id = root_into where account_id = root_from;
  -- the joining group's history is new to the computers already in the account: fresh cursor positions
  update public.records set seq = nextval('public.records_seq') where account_id = any(joining);
end $$;

-- the whole history of one person, for Claude (read with the connector):
--   select * from private.history where account = '<root account id>' and kind = 'journal' order by t desc
create view private.history as
  select coalesce(a.merged_into, a.id) as account, r.char_key, r.kind, r.t, to_timestamp(r.t) as at,
         dv.name as computer, r.data, r.id, r.mutable
  from public.records r join public.accounts a on a.id = r.account_id left join public.devices dv on dv.id = r.device_id;

-- ------------------------------------------------------------------ the API (the app calls these with the publishable key)

-- first run on a computer: an account for this device key (calling it again is harmless)
create function public.cc_register(p_key text, p_name text default null, p_os text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare d public.devices; acc uuid; v_ip text;
begin
  if length(coalesce(p_key, '')) < 32 or length(p_key) > 200 then raise exception 'bad device key'; end if;
  d := private.device_of(p_key);
  if d.id is null then
    v_ip := split_part(coalesce(current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for', ''), ',', 1);
    if (select count(*) from private.register_log where ip = v_ip and at > now() - interval '1 hour') >= 20
       or (select count(*) from private.register_log where at > now() - interval '1 hour') >= 1000 then
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
-- (re-sending changes nothing, also when another computer of the account sent it); mutable rows are replaced.
create function public.cc_push(p_key text, p_records jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare d public.devices; n int; total bigint;
begin
  d := private.device_of(p_key);
  if d.id is null then raise exception 'unknown device'; end if;
  if jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records) > 1000 then raise exception 'send an array of at most 1000 records'; end if;
  if exists (select 1 from jsonb_array_elements(p_records) x
             where length(coalesce(x->>'id', '')) not between 1 and 400 or length(coalesce(x->>'char', '')) not between 1 and 100
                or length(coalesce(x->>'kind', '')) not between 1 and 20 or octet_length((x->'data')::text) > 65536 or x->'data' is null) then
    raise exception 'bad record';
  end if;
  select count(*) into total from public.records where account_id in (select private.group_of(d.account_id));
  if total > 2000000 then raise exception 'this account is full'; end if;
  with ins as (
    insert into public.records as r (account_id, id, device_id, char_key, kind, t, data, mutable)
      select d.account_id, x->>'id', d.id, x->>'char', x->>'kind', (x->>'t')::bigint, x->'data', coalesce((x->>'mutable')::boolean, false)
      from jsonb_array_elements(p_records) x
      where coalesce((x->>'mutable')::boolean, false)
         or not exists (select 1 from public.records y where y.account_id in (select private.group_of(d.account_id)) and y.id = x->>'id')
    on conflict (account_id, id) do update
      set data = excluded.data, t = excluded.t, device_id = excluded.device_id,
          seq = nextval('public.records_seq'), updated_at = now()
      where r.mutable and excluded.mutable and r.data is distinct from excluded.data
    returning 1)
  select count(*) into n from ins;
  update public.devices set last_seen = now(),
      chars = (select coalesce(array_agg(distinct c), '{}') from
                 (select unnest(chars) c union select x->>'char' from jsonb_array_elements(p_records) x where x->>'char' <> '*') s)
    where id = d.id;
  return jsonb_build_object('stored', n, 'account', d.account_id, 'device', d.id);
end $$;

-- the account's records after a cursor (seq), oldest first, and its computers. Leaves out this
-- computer's own mutable rows (its own save has them); its history comes back too, so history the
-- addon has trimmed, or a lost save, stays in the merged view.
create function public.cc_pull(p_key text, p_after bigint default 0, p_limit int default 2000) returns jsonb
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
            and not (r.mutable and r.device_id = d.id)
          order by r.seq limit least(greatest(coalesce(p_limit, 2000), 1), 5000)) r;
  return jsonb_build_object('account', d.account_id, 'device', d.id, 'records', v_out,
    'devices', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'os', x.os, 'chars', x.chars, 'seen', x.last_seen) order by x.created_at), '[]')
                from public.devices x where x.account_id = d.account_id));
end $$;

-- a code another computer can type to join this account (30 minutes; a new one replaces the old)
create function public.cc_link_code(p_key text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare d public.devices; c text; abc text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; i int;
begin
  d := private.device_of(p_key);
  if d.id is null then raise exception 'unknown device'; end if;
  loop
    c := '';
    for i in 1..8 loop c := c || substr(abc, 1 + floor(random() * length(abc))::int, 1); end loop;
    exit when not exists (select 1 from private.link_codes where code = c);
  end loop;
  insert into private.link_codes as l (code, account_id, expires_at) values (c, d.account_id, now() + interval '30 minutes')
    on conflict (account_id) do update set code = excluded.code, expires_at = excluded.expires_at;
  return jsonb_build_object('code', c, 'expires', now() + interval '30 minutes');
end $$;

-- join the account a link code belongs to (this computer's whole account joins it)
create function public.cc_link(p_key text, p_code text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare d public.devices; target uuid;
begin
  d := private.device_of(p_key);
  if d.id is null then raise exception 'unknown device'; end if;
  select account_id into target from private.link_codes
    where code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')) and expires_at > now();
  if target is null then raise exception 'that code is wrong or has expired'; end if;
  perform private.merge_accounts(d.account_id, target);
  update private.link_codes set expires_at = now() where account_id = target;   -- a code works once
  return jsonb_build_object('account', target, 'device', d.id);
end $$;

grant execute on function public.cc_register(text, text, text), public.cc_push(text, jsonb), public.cc_pull(text, bigint, int),
  public.cc_link_code(text), public.cc_link(text, text) to anon, authenticated;
