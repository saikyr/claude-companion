-- The game data, in the database: the same pack the app uses (web/data/gamedata.js + rules.js), so a Claude
-- session looks a fact up instead of searching the web or using Classic numbers. One source per kind of
-- data (docs/ARCHITECTURE.md, Data sources); nothing new is added here. Loaded only by the publish workflow
-- (supabase/functions/publish-game, GitHub OIDC; tools/pack-to-rows.py), after every merge that changes
-- the pack, so the database and the app always hold the same build. No agent writes it.
--
-- Drop rates, labelled so they can't be misread (game.drop_rates):
--   forever  ForeverDB measured it on Forever kills: "X% (95% range a-b%, N corpses, ForeverDB players)"
--   classic  a Classic rate ForeverDB shows: never quote it as a Forever rate
--   unknown  seen on Forever (or only listed by Classic data), rate unknown
-- `seen` (how often players saw the item) is never divided by `eligible`: they count different things.
--
-- Owner reads (Supabase connector):
--   select game.item('Righteous Orb');        select game.npc('Skeletal Horror');
--   select game.quest('Araj''s Scarab');      select game.instance('Stratholme');
--   select * from game.drop_rates where item_name = 'Runecloth' order by rate_pct desc nulls last;
--   select game.status();                     -- which pack is loaded, and when

create schema if not exists game;
revoke all on schema game from public, anon, authenticated;

create table if not exists game.packs (
  hash text primary key, meta jsonb not null default '{}'::jsonb, started_at timestamptz not null default now(),
  loaded_at timestamptz, complete boolean not null default false);

create table if not exists game.items (
  id int primary key, name text, q int, ilvl int, req int, inv int, icon bigint, sell bigint, bind int, stats jsonb,
  class int, tip jsonb, tip_src text, subclass int, how text, size int, req_rep jsonb, pack text not null);
create index if not exists items_name on game.items (lower(name));

-- every source row of an item: drop (a creature), object, container, quest, vendor, craft, world drop
create table if not exists game.drops (
  key text primary key, item_id int not null, kind text, source text, source_id bigint, pct numeric, seen int,
  instance_id int, boss boolean, zone text, x numeric, y numeric, origin text, rate_src text, eligible int, pack text not null);
create index if not exists drops_item on game.drops (item_id);
create index if not exists drops_source on game.drops (lower(source));
create index if not exists drops_zone on game.drops (zone);

create table if not exists game.quests (
  id int primary key, title text, lv int, min int, side text, type text, cat text, prev jsonb, next jsonb, obj jsonb,
  giver jsonb, turnin jsonb, reward jsonb, choice jsonb, reward_any jsonb, rep jsonb, xp int, money bigint, origin text, pack text not null);
create index if not exists quests_title on game.quests (lower(title));

create table if not exists game.npcs (
  id int primary key, name text, min_lv int, max_lv int, rank int, sub text, zone text, points jsonb, spawns int, friendly text, pack text not null);
create index if not exists npcs_name on game.npcs (lower(name));

create table if not exists game.vendors (
  key text primary key, item_id int not null, npc text, zone text, x numeric, y numeric, price bigint, seen_forever boolean,
  sub text, side text, pack text not null);
create index if not exists vendors_item on game.vendors (item_id);

-- data/rules.js: hand-kept game rules, each with its source in the file (standings, AH cut, instances, unlocks, disenchant)
create table if not exists game.rules (key text primary key, value jsonb, pack text not null);

-- the pack every read uses: the newest complete load
create or replace function game.current() returns text language sql stable set search_path = '' as $$
  select hash from game.packs where complete order by loaded_at desc limit 1 $$;

-- the 95% Wilson range of k drops in n corpses, in percent
create or replace function game.wilson(k numeric, n numeric, upper boolean) returns numeric
language sql immutable set search_path = '' as $$
  select case when n is null or n <= 0 then null else round(100 * greatest(0, least(1,
    ((k / n) + 1.9208 / n + (case when upper then 1 else -1 end) * 1.96 * sqrt(greatest(0, (k / n) * (1 - k / n) / n + 0.9604 / (n * n))))
    / (1 + 3.8416 / n))), 2) end $$;

create or replace view game.drop_rates as
  select d.item_id, i.name as item_name, d.kind, d.source, d.source_id, d.zone, d.instance_id, d.boss,
         r.rate,
         case when r.rate = 'forever' then d.pct end as rate_pct,
         case when r.rate = 'forever' then game.wilson(round(d.pct * d.eligible / 100), d.eligible, false) end as rate_low,
         case when r.rate = 'forever' then game.wilson(round(d.pct * d.eligible / 100), d.eligible, true) end as rate_high,
         case when r.rate = 'forever' then d.eligible end as corpses,
         case when r.rate = 'classic' then d.pct end as classic_pct,
         (d.origin = 'f' or coalesce(d.seen, 0) > 0) as seen_on_forever,
         case r.rate
           when 'forever' then d.pct || '% (95% range ' || game.wilson(round(d.pct * d.eligible / 100), d.eligible, false) || '-'
                               || game.wilson(round(d.pct * d.eligible / 100), d.eligible, true) || '%, ' || d.eligible || ' corpses, ForeverDB players)'
           when 'classic' then 'Classic rate ' || d.pct || '%: not measured on Forever, never quote it as a Forever rate'
           else case when d.origin = 'f' or coalesce(d.seen, 0) > 0 then 'seen on Forever, rate unknown'
                     else 'listed by Classic data only, not seen on Forever; rate unknown' end
         end as label
    from game.drops d
    left join game.items i on i.id = d.item_id
    cross join lateral (select case when d.kind = 'drop' and d.rate_src = 'm' and coalesce(d.eligible, 0) > 0 and d.pct is not null then 'forever'
                                    when d.kind = 'drop' and d.rate_src = 'c' and d.pct is not null then 'classic'
                                    else 'unknown' end as rate) r
   where d.pack = game.current();

-- an item, by id or name: what it is and every source, labelled
create or replace function game.item(p text) returns jsonb language sql stable security definer set search_path = '' as $$
  with cur as (select game.current() h),
  hit as (
    select i.* from game.items i, cur where i.pack = cur.h and (i.id::text = p or lower(i.name) = lower(p))
    union all
    select i.* from game.items i, cur where i.pack = cur.h and not exists (select 1 from game.items j where j.pack = cur.h and (j.id::text = p or lower(j.name) = lower(p)))
      and i.name ilike '%' || p || '%'
    limit 10)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', h.id, 'name', h.name, 'quality', h.q, 'itemLevel', h.ilvl, 'requiresLevel', h.req, 'sellsToVendor', h.sell, 'how', h.how,
    'groupSize', h.size, 'needsRep', h.req_rep, 'tooltip', h.tip, 'tooltipFrom', case h.tip_src when 'e' then 'endgametools (Forever client)' when 'f' then 'ForeverDB' else null end,
    'sources', coalesce((select jsonb_agg(jsonb_build_object('kind', r.kind, 'from', r.source, 'id', r.source_id, 'zone', r.zone, 'boss', r.boss,
                                    'rate', r.rate, 'label', r.label) order by r.rate = 'forever' desc, r.rate_pct desc nulls last, r.seen_on_forever desc)
                         from (select * from game.drop_rates r where r.item_id = h.id limit 40) r), '[]'::jsonb),
    'vendors', coalesce((select jsonb_agg(jsonb_build_object('npc', v.npc, 'zone', v.zone, 'x', v.x, 'y', v.y, 'price', v.price,
                                    'seenOnForever', v.seen_forever, 'side', v.side))
                         from game.vendors v, cur where v.pack = cur.h and v.item_id = h.id), '[]'::jsonb),
    'questReward', coalesce((select jsonb_agg(jsonb_build_object('quest', q.id, 'title', q.title, 'zone', q.cat))
                         from game.quests q, cur where q.pack = cur.h and (q.reward @> jsonb_build_array(jsonb_build_array(h.id))
                           or q.choice @> jsonb_build_array(jsonb_build_array(h.id)) or q.reward_any @> jsonb_build_array(jsonb_build_array(h.id)))), '[]'::jsonb))),
    '[]'::jsonb) from hit h $$;

-- a creature, by id or name: level, rank, where, and everything it drops, labelled
create or replace function game.npc(p text) returns jsonb language sql stable security definer set search_path = '' as $$
  with cur as (select game.current() h),
  hit as (select n.* from game.npcs n, cur where n.pack = cur.h and (n.id::text = p or lower(n.name) = lower(p)) limit 10)
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'name', n.name, 'levels', jsonb_build_array(n.min_lv, n.max_lv),
    'rank', case n.rank when 0 then 'normal' when 1 then 'elite' when 2 then 'rare elite' when 3 then 'boss' when 4 then 'rare' end,
    'zone', n.zone, 'points', n.points, 'spawns', n.spawns,
    'drops', coalesce((select jsonb_agg(jsonb_build_object('item', r.item_name, 'id', r.item_id, 'rate', r.rate, 'label', r.label)
                         order by r.rate = 'forever' desc, r.rate_pct desc nulls last)
                       from game.drop_rates r where r.kind = 'drop' and r.source_id = n.id), '[]'::jsonb),
    'resistances', 'not published for Forever (no source); the addon will measure them',
    'respawn', 'not published for Forever (no source)')), '[]'::jsonb) from hit n $$;

-- a quest, by id or title: level, side, zone, type, the chain (titles), rewards, rep, and whether it is a dungeon
-- quest or a step of a key/attunement (rules.js unlocks). The app's own keep flag (quests in the log) is in the brief.
create or replace function game.quest(p text) returns jsonb language sql stable security definer set search_path = '' as $$
  with cur as (select game.current() h),
  hit as (select q.* from game.quests q, cur where q.pack = cur.h and (q.id::text = p or lower(q.title) = lower(p)) limit 10),
  inst as (select distinct zone from game.drops d, cur where d.pack = cur.h and d.kind = 'drop' and d.instance_id > 0 and d.zone <> ''),
  unl as (select u from game.rules r, cur, jsonb_array_elements(r.value) u where r.pack = cur.h and r.key = 'unlocks')
  select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'title', q.title, 'level', q.lv, 'minLevel', q.min, 'side', q.side,
    'type', q.type, 'zone', q.cat, 'objectives', q.obj, 'giver', q.giver, 'turnIn', q.turnin, 'xp', q.xp, 'money', q.money, 'rep', q.rep,
    'reward', (select coalesce(jsonb_agg(jsonb_build_object('id', (e->>0)::int, 'name', i.name, 'count', e->1)), '[]'::jsonb)
                 from jsonb_array_elements(coalesce(q.reward, '[]')) e left join game.items i on i.id = (e->>0)::int and i.pack = q.pack),
    'choose', (select coalesce(jsonb_agg(jsonb_build_object('id', (e->>0)::int, 'name', i.name, 'count', e->1)), '[]'::jsonb)
                 from jsonb_array_elements(coalesce(q.choice, '[]')) e left join game.items i on i.id = (e->>0)::int and i.pack = q.pack),
    'prev', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title)), '[]'::jsonb) from game.quests x
              where x.pack = q.pack and q.prev @> to_jsonb(x.id)),
    'next', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title)), '[]'::jsonb) from game.quests x
              where x.pack = q.pack and q.next @> to_jsonb(x.id)),
    'dungeonQuest', (q.type = 'Dungeon' or q.cat in (select zone from inst)),
    'unlocks', (select u->>'name' from unl where (u->'quests') @> to_jsonb(q.id) limit 1),
    'link', 'https://foreverchanges.pro/quest/' || q.id)), '[]'::jsonb) from hit q $$;

-- an instance: what drops there, by boss first, with labels; and the hand-kept rules about it (size, unlocks)
create or replace function game.instance(p text) returns jsonb language sql stable security definer set search_path = '' as $$
  with cur as (select game.current() h)
  select jsonb_build_object('name', p,
    'rules', (select jsonb_build_object('raid', (r.value->'raids') @> to_jsonb(p), 'battleground', (r.value->'battlegrounds') @> to_jsonb(p), 'all', r.value)
                from game.rules r, cur where r.pack = cur.h and r.key = 'instances'),
    'unlocks', (select coalesce(jsonb_agg(u), '[]'::jsonb) from game.rules r, cur, jsonb_array_elements(r.value) u
                 where r.pack = cur.h and r.key = 'unlocks' and (u->>'name' ilike '%' || p || '%' or u->'value'->>'zone' = p)),
    'bosses', (select coalesce(jsonb_agg(distinct d.source), '[]'::jsonb) from game.drops d, cur where d.pack = cur.h and d.zone = p and d.boss),
    'drops', (select coalesce(jsonb_agg(jsonb_build_object('item', r.item_name, 'id', r.item_id, 'from', r.source, 'boss', r.boss, 'label', r.label)
                order by r.boss desc, r.rate = 'forever' desc, r.rate_pct desc nulls last), '[]'::jsonb)
                from (select * from game.drop_rates r where r.zone = p and r.kind = 'drop' and r.instance_id > 0
                       and exists (select 1 from game.items i where i.id = r.item_id and i.q >= 2) limit 300) r)) $$;

create or replace function game.status() returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('pack', hash, 'loadedAt', loaded_at, 'built', to_timestamp((meta->>'built')::bigint),
    'from', meta->'from', 'counts', meta->'counts') from game.packs where hash = game.current()),
    jsonb_build_object('pack', null, 'note', 'no game data loaded yet')) $$;

-- ---------------------------------------------------------------- loading (only the publish-game function, service role)
-- upsert one chunk of one table for a pack; rows of an older pack that the new one no longer has stay
-- behind but drop out of every read (they keep the older pack's hash). Nothing is deleted.
create or replace function public.game_load(p_pack text, p_table text, p_rows jsonb) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare n int;
begin
  if p_pack !~ '^[0-9a-f]{16}$' then raise exception 'bad pack hash'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 10000 then raise exception 'send an array of at most 10000 rows'; end if;
  insert into game.packs (hash) values (p_pack) on conflict (hash) do nothing;
  if p_table = 'items' then
    insert into game.items select (jsonb_populate_record(null::game.items, x || jsonb_build_object('pack', p_pack))).* from jsonb_array_elements(p_rows) x
      on conflict (id) do update set name = excluded.name, q = excluded.q, ilvl = excluded.ilvl, req = excluded.req, inv = excluded.inv,
        icon = excluded.icon, sell = excluded.sell, bind = excluded.bind, stats = excluded.stats, class = excluded.class, tip = excluded.tip,
        tip_src = excluded.tip_src, subclass = excluded.subclass, how = excluded.how, size = excluded.size, req_rep = excluded.req_rep, pack = excluded.pack;
  elsif p_table = 'drops' then
    insert into game.drops select (jsonb_populate_record(null::game.drops, x || jsonb_build_object('pack', p_pack))).* from jsonb_array_elements(p_rows) x
      on conflict (key) do update set item_id = excluded.item_id, kind = excluded.kind, source = excluded.source, source_id = excluded.source_id,
        pct = excluded.pct, seen = excluded.seen, instance_id = excluded.instance_id, boss = excluded.boss, zone = excluded.zone, x = excluded.x,
        y = excluded.y, origin = excluded.origin, rate_src = excluded.rate_src, eligible = excluded.eligible, pack = excluded.pack;
  elsif p_table = 'quests' then
    insert into game.quests select (jsonb_populate_record(null::game.quests, x || jsonb_build_object('pack', p_pack))).* from jsonb_array_elements(p_rows) x
      on conflict (id) do update set title = excluded.title, lv = excluded.lv, min = excluded.min, side = excluded.side, type = excluded.type,
        cat = excluded.cat, prev = excluded.prev, next = excluded.next, obj = excluded.obj, giver = excluded.giver, turnin = excluded.turnin,
        reward = excluded.reward, choice = excluded.choice, reward_any = excluded.reward_any, rep = excluded.rep, xp = excluded.xp,
        money = excluded.money, origin = excluded.origin, pack = excluded.pack;
  elsif p_table = 'npcs' then
    insert into game.npcs select (jsonb_populate_record(null::game.npcs, x || jsonb_build_object('pack', p_pack))).* from jsonb_array_elements(p_rows) x
      on conflict (id) do update set name = excluded.name, min_lv = excluded.min_lv, max_lv = excluded.max_lv, rank = excluded.rank, sub = excluded.sub,
        zone = excluded.zone, points = excluded.points, spawns = excluded.spawns, friendly = excluded.friendly, pack = excluded.pack;
  elsif p_table = 'vendors' then
    insert into game.vendors select (jsonb_populate_record(null::game.vendors, x || jsonb_build_object('pack', p_pack))).* from jsonb_array_elements(p_rows) x
      on conflict (key) do update set item_id = excluded.item_id, npc = excluded.npc, zone = excluded.zone, x = excluded.x, y = excluded.y,
        price = excluded.price, seen_forever = excluded.seen_forever, sub = excluded.sub, side = excluded.side, pack = excluded.pack;
  elsif p_table = 'rules' then
    insert into game.rules select (jsonb_populate_record(null::game.rules, x || jsonb_build_object('pack', p_pack))).* from jsonb_array_elements(p_rows) x
      on conflict (key) do update set value = excluded.value, pack = excluded.pack;
  else raise exception 'unknown table %', p_table;
  end if;
  get diagnostics n = row_count;
  return n;
end $$;

-- the pack is complete when every table has its counted rows under this hash: only then do reads switch to it
create or replace function public.game_finish(p_pack text, p_meta jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare got jsonb; want jsonb := p_meta->'counts';
begin
  select jsonb_build_object(
    'items', (select count(*) from game.items where pack = p_pack), 'drops', (select count(*) from game.drops where pack = p_pack),
    'quests', (select count(*) from game.quests where pack = p_pack), 'npcs', (select count(*) from game.npcs where pack = p_pack),
    'vendors', (select count(*) from game.vendors where pack = p_pack), 'rules', (select count(*) from game.rules where pack = p_pack)) into got;
  if want is null or got <> want then raise exception 'pack % incomplete: have %, expected %', p_pack, got, want; end if;
  update game.packs set meta = p_meta, loaded_at = now(), complete = true where hash = p_pack;
  return jsonb_build_object('pack', p_pack, 'counts', got);
end $$;

-- which pack is loaded (the workflow skips the upload when it is the same)
create or replace function public.game_pack() returns text language sql stable security definer set search_path = '' as $$
  select game.current() $$;

revoke all on function public.game_load(text, text, jsonb), public.game_finish(text, jsonb), public.game_pack() from public, anon, authenticated;
grant execute on function public.game_load(text, text, jsonb), public.game_finish(text, jsonb), public.game_pack() to service_role;
revoke all on all tables in schema game from public, anon, authenticated;
revoke all on all functions in schema game from public, anon, authenticated;
