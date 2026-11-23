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

-- Two copies (slot 0 and 1) of every table: a load writes only the slot not in use, and game_finish switches
-- reads to it once every row is there. Reads never see a half-loaded pack, and a failed load leaves the old
-- pack whole. Each load overwrites the same keys in its slot, so storage stays bounded and nothing is deleted.
create table if not exists game.packs (
  hash text primary key, meta jsonb not null default '{}'::jsonb, started_at timestamptz not null default now(),
  loaded_at timestamptz, complete boolean not null default false, slot smallint);

create table if not exists game.items (
  id int not null, name text, q int, ilvl int, req int, inv int, icon bigint, sell bigint, bind int, stats jsonb,
  class int, tip jsonb, tip_src text, subclass int, how text, size int, req_rep jsonb, pack text not null,
  slot smallint not null check (slot in (0, 1)), primary key (slot, id));
create index if not exists items_name on game.items (lower(name));

-- every source row of an item: drop (a creature), object, container, quest, vendor, craft, world drop
create table if not exists game.drops (
  key text not null, item_id int not null, kind text, source text, source_id bigint, pct numeric, seen int,
  instance_id int, boss boolean, zone text, x numeric, y numeric, origin text, rate_src text, eligible int, pack text not null,
  slot smallint not null check (slot in (0, 1)), primary key (slot, key));
create index if not exists drops_item on game.drops (item_id);
create index if not exists drops_source on game.drops (lower(source));
create index if not exists drops_source_id on game.drops (source_id);
create index if not exists drops_zone on game.drops (zone);

create table if not exists game.quests (
  id int not null, title text, lv int, min int, side text, type text, cat text, prev jsonb, next jsonb, obj jsonb,
  giver jsonb, turnin jsonb, reward jsonb, choice jsonb, reward_any jsonb, rep jsonb, xp int, money bigint, origin text, pack text not null,
  slot smallint not null check (slot in (0, 1)), primary key (slot, id));
create index if not exists quests_title on game.quests (lower(title));

create table if not exists game.npcs (
  id int not null, name text, min_lv int, max_lv int, rank int, sub text, zone text, points jsonb, spawns int, friendly text, pack text not null,
  slot smallint not null check (slot in (0, 1)), primary key (slot, id));
create index if not exists npcs_name on game.npcs (lower(name));

create table if not exists game.vendors (
  key text not null, item_id int not null, npc text, zone text, x numeric, y numeric, price bigint, seen_forever boolean,
  sub text, side text, pack text not null, slot smallint not null check (slot in (0, 1)), primary key (slot, key));
create index if not exists vendors_item on game.vendors (item_id);

-- data/rules.js: hand-kept game rules, each with its source in the file (standings, AH cut, instances, unlocks, disenchant)
create table if not exists game.rules (key text not null, value jsonb, pack text not null,
  slot smallint not null check (slot in (0, 1)), primary key (slot, key));

-- the pack every read uses: the newest complete load, and the slot it is in. A row is read only when it has
-- both (rows left in that slot by an older pack keep the older hash and are never read).
create or replace view game.live as
  select hash, slot from game.packs where complete order by loaded_at desc limit 1;

create or replace function game.current() returns text language sql stable set search_path = '' as $$
  select hash from game.live $$;

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
    from game.live c
    join game.drops d on d.slot = c.slot and d.pack = c.hash
    left join game.items i on i.slot = d.slot and i.pack = d.pack and i.id = d.item_id
    cross join lateral (select case when d.kind = 'drop' and d.rate_src = 'm' and coalesce(d.eligible, 0) > 0 and d.pct is not null then 'forever'
                                    when d.kind = 'drop' and d.rate_src = 'c' and d.pct is not null then 'classic'
                                    else 'unknown' end as rate) r;

-- an item, by id or name: what it is and every source, labelled (the 40 best: sourcesTotal says how many there are)
create or replace function game.item(p text) returns jsonb language sql stable security definer set search_path = '' as $$
  with cur as (select hash h, slot s from game.live),
  hit as (
    select i.* from game.items i, cur where i.slot = cur.s and i.pack = cur.h and (i.id::text = p or lower(i.name) = lower(p))
    union all
    select i.* from game.items i, cur where i.slot = cur.s and i.pack = cur.h
      and not exists (select 1 from game.items j where j.slot = cur.s and j.pack = cur.h and (j.id::text = p or lower(j.name) = lower(p)))
      and i.name ilike '%' || p || '%'
    limit 10)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', h.id, 'name', h.name, 'quality', h.q, 'itemLevel', h.ilvl, 'requiresLevel', h.req, 'sellsToVendor', h.sell, 'how', h.how,
    'groupSize', h.size, 'needsRep', h.req_rep, 'tooltip', h.tip, 'tooltipFrom', case h.tip_src when 'e' then 'endgametools (Forever client)' when 'f' then 'ForeverDB' else null end,
    'sourcesTotal', (select count(*) from game.drop_rates r where r.item_id = h.id),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('kind', r.kind, 'from', r.source, 'id', r.source_id, 'zone', r.zone, 'boss', r.boss,
                                    'rate', r.rate, 'label', r.label) order by r.o)
                         from (select r.*, row_number() over (order by r.rate = 'forever' desc, r.rate_pct desc nulls last, r.seen_on_forever desc, r.source) o
                                 from game.drop_rates r where r.item_id = h.id order by o limit 40) r), '[]'::jsonb),
    'vendors', coalesce((select jsonb_agg(jsonb_build_object('npc', v.npc, 'zone', v.zone, 'x', v.x, 'y', v.y, 'price', v.price,
                                    'seenOnForever', v.seen_forever, 'side', v.side))
                         from game.vendors v, cur where v.slot = cur.s and v.pack = cur.h and v.item_id = h.id), '[]'::jsonb),
    'questReward', coalesce((select jsonb_agg(jsonb_build_object('quest', q.id, 'title', q.title, 'zone', q.cat))
                         from game.quests q, cur where q.slot = cur.s and q.pack = cur.h and (q.reward @> jsonb_build_array(jsonb_build_array(h.id))
                           or q.choice @> jsonb_build_array(jsonb_build_array(h.id)) or q.reward_any @> jsonb_build_array(jsonb_build_array(h.id)))), '[]'::jsonb))),
    '[]'::jsonb) from hit h $$;

-- a creature, by id or name: level, rank, where, and everything it drops, labelled
create or replace function game.npc(p text) returns jsonb language sql stable security definer set search_path = '' as $$
  with cur as (select hash h, slot s from game.live),
  hit as (select n.* from game.npcs n, cur where n.slot = cur.s and n.pack = cur.h and (n.id::text = p or lower(n.name) = lower(p)) limit 10)
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'name', n.name, 'levels', jsonb_build_array(n.min_lv, n.max_lv),
    'rank', case n.rank when 0 then 'normal' when 1 then 'elite' when 2 then 'rare elite' when 3 then 'boss' when 4 then 'rare' end,
    'zone', n.zone, 'points', n.points, 'spawns', n.spawns,
    'drops', coalesce((select jsonb_agg(jsonb_build_object('item', r.item_name, 'id', r.item_id, 'rate', r.rate, 'label', r.label)
                         order by r.rate = 'forever' desc, r.rate_pct desc nulls last)
                       from game.drop_rates r where r.kind = 'drop' and r.source_id = n.id), '[]'::jsonb),
    'resistances', 'not published for Forever (no source); the addon will measure them',
    'respawn', 'not published for Forever (no source)')), '[]'::jsonb) from hit n $$;

-- a quest, by id or title: level, side, zone, type, the chain (titles), rewards, rep, and whether to keep it
-- as a dungeon quest (CLAUDE.md, the dungeon-quest rule), the same test as the app's keepOf (web/js/claude.js):
-- this quest or any step of its chain (back along prev, forward along next) is a step of a key or attunement
-- (rules.js unlocks), has its quest zone or an objective in a dungeon or raid (battlegrounds left out), or is
-- a pack Dungeon quest. keep names the step and why. The app's keep flag for quests in the log, which also
-- counts rep toward rep-gated rewards, is in the brief.
create or replace function game.quest(p text) returns jsonb language sql stable security definer set search_path = '' as $$
  with recursive cur as (select hash h, slot s from game.live),
  hit as (select q.* from game.quests q, cur where q.slot = cur.s and q.pack = cur.h and (q.id::text = p or lower(q.title) = lower(p)) limit 10),
  bg as (select jsonb_array_elements_text(r.value->'battlegrounds') z from game.rules r, cur where r.slot = cur.s and r.pack = cur.h and r.key = 'instances'),
  inst as (select distinct d.zone from game.drops d, cur where d.slot = cur.s and d.pack = cur.h and d.kind = 'drop' and d.instance_id > 0
             and d.zone <> '' and d.zone not in (select z from bg)),
  unl as (select u from game.rules r, cur, jsonb_array_elements(r.value) u where r.slot = cur.s and r.pack = cur.h and r.key = 'unlocks'),
  chain(root, id, dir, depth) as (
    select q.id, q.id, d, 0 from hit q, unnest(array['prev', 'next']) d
    union
    select c.root, e::int, c.dir, c.depth + 1 from chain c
      join game.quests x on x.id = c.id
      join cur on x.slot = cur.s and x.pack = cur.h
      cross join lateral jsonb_array_elements_text(coalesce(case c.dir when 'prev' then x.prev else x.next end, '[]'::jsonb)) e
     where c.depth < 30),
  keep as (
    select distinct on (c.root) c.root, jsonb_build_object('dungeon', k.dungeon, 'why', k.why,
             'step', case when x.id <> c.root then jsonb_build_object('id', x.id, 'title', x.title) end) v
      from chain c join game.quests x on x.id = c.id join cur on x.slot = cur.s and x.pack = cur.h
      cross join lateral (
        select u->>'name' dungeon, 'key or attunement: ' || (u->>'what') why, 1 o from unl where (u->'quests') @> to_jsonb(x.id)
        union all select x.cat, 'dungeon quest', 2 where x.cat in (select zone from inst)
        union all select i.zone, 'objective in ' || i.zone, 3 from (select zone from inst where length(zone) > 3 and x.obj::text like '%' || zone || '%' limit 1) i
        union all select coalesce(x.cat, 'a dungeon'), 'dungeon quest', 4 where x.type = 'Dungeon') k
     order by c.root, c.depth, c.dir desc, k.o)
  select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'title', q.title, 'level', q.lv, 'minLevel', q.min, 'side', q.side,
    'type', q.type, 'zone', q.cat, 'objectives', q.obj, 'giver', q.giver, 'turnIn', q.turnin, 'xp', q.xp, 'money', q.money, 'rep', q.rep,
    'reward', (select coalesce(jsonb_agg(jsonb_build_object('id', (e->>0)::int, 'name', i.name, 'count', e->1)), '[]'::jsonb)
                 from jsonb_array_elements(coalesce(q.reward, '[]')) e left join game.items i on i.slot = q.slot and i.pack = q.pack and i.id = (e->>0)::int),
    'choose', (select coalesce(jsonb_agg(jsonb_build_object('id', (e->>0)::int, 'name', i.name, 'count', e->1)), '[]'::jsonb)
                 from jsonb_array_elements(coalesce(q.choice, '[]')) e left join game.items i on i.slot = q.slot and i.pack = q.pack and i.id = (e->>0)::int),
    'prev', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title)), '[]'::jsonb) from game.quests x
              where x.slot = q.slot and x.pack = q.pack and q.prev @> to_jsonb(x.id)),
    'next', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title)), '[]'::jsonb) from game.quests x
              where x.slot = q.slot and x.pack = q.pack and q.next @> to_jsonb(x.id)),
    'dungeonQuest', exists (select 1 from keep k where k.root = q.id),
    'keep', (select k.v from keep k where k.root = q.id),
    'unlocks', (select u->>'name' from unl where (u->'quests') @> to_jsonb(q.id) limit 1),
    'link', 'https://foreverchanges.pro/quest/' || q.id)), '[]'::jsonb) from hit q $$;

-- an instance: what drops there, by boss first, with labels (the 300 best of dropsTotal); and the hand-kept
-- rules about it (size, unlocks)
create or replace function game.instance(p text) returns jsonb language sql stable security definer set search_path = '' as $$
  with cur as (select hash h, slot s from game.live),
  src as (select r.*, row_number() over (order by r.boss desc, r.rate = 'forever' desc, r.rate_pct desc nulls last, r.item_name) o
            from game.drop_rates r where r.zone = p and r.kind = 'drop' and r.instance_id > 0
             and exists (select 1 from game.items i, cur where i.slot = cur.s and i.pack = cur.h and i.id = r.item_id and i.q >= 2))
  select jsonb_build_object('name', p,
    'rules', (select jsonb_build_object('raid', (r.value->'raids') @> to_jsonb(p), 'battleground', (r.value->'battlegrounds') @> to_jsonb(p), 'all', r.value)
                from game.rules r, cur where r.slot = cur.s and r.pack = cur.h and r.key = 'instances'),
    'unlocks', (select coalesce(jsonb_agg(u), '[]'::jsonb) from game.rules r, cur, jsonb_array_elements(r.value) u
                 where r.slot = cur.s and r.pack = cur.h and r.key = 'unlocks' and (u->>'name' ilike '%' || p || '%' or u->'value'->>'zone' = p)),
    'bosses', (select coalesce(jsonb_agg(distinct d.source), '[]'::jsonb) from game.drops d, cur where d.slot = cur.s and d.pack = cur.h and d.zone = p and d.boss),
    'dropsTotal', (select count(*) from src),
    'drops', (select coalesce(jsonb_agg(jsonb_build_object('item', r.item_name, 'id', r.item_id, 'from', r.source, 'boss', r.boss, 'label', r.label)
                order by r.o), '[]'::jsonb)
                from (select * from src where o <= 300) r)) $$;

create or replace function game.status() returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('pack', p.hash, 'loadedAt', p.loaded_at, 'built', to_timestamp((p.meta->>'built')::bigint),
    'from', p.meta->'from', 'counts', p.meta->'counts') from game.packs p join game.live l on l.hash = p.hash),
    jsonb_build_object('pack', null, 'note', 'no game data loaded yet')) $$;

-- ---------------------------------------------------------------- loading (only the publish-game function, service role)
-- the slot a load writes: the one reads are not using
create or replace function game.load_slot() returns smallint language sql stable set search_path = '' as $$
  select (case when (select slot from game.live) = 0 then 1 else 0 end)::smallint $$;

-- upsert one chunk of one table into the load slot. Rows there from an older pack that the new one no
-- longer has stay behind with the older hash and are never read. Nothing is deleted.
create or replace function public.game_load(p_pack text, p_table text, p_rows jsonb) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare n int; s smallint := game.load_slot(); r jsonb;
begin
  if p_pack !~ '^[0-9a-f]{16}$' then raise exception 'bad pack hash'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 10000 then raise exception 'send an array of at most 10000 rows'; end if;
  if p_pack = game.current() then raise exception 'pack % is the one in use', p_pack; end if;
  insert into game.packs (hash) values (p_pack) on conflict (hash) do nothing;
  select coalesce(jsonb_agg(x || jsonb_build_object('pack', p_pack, 'slot', s)), '[]'::jsonb) into r from jsonb_array_elements(p_rows) x;
  if p_table = 'items' then
    insert into game.items select * from jsonb_populate_recordset(null::game.items, r)
      on conflict (slot, id) do update set name = excluded.name, q = excluded.q, ilvl = excluded.ilvl, req = excluded.req, inv = excluded.inv,
        icon = excluded.icon, sell = excluded.sell, bind = excluded.bind, stats = excluded.stats, class = excluded.class, tip = excluded.tip,
        tip_src = excluded.tip_src, subclass = excluded.subclass, how = excluded.how, size = excluded.size, req_rep = excluded.req_rep, pack = excluded.pack;
  elsif p_table = 'drops' then
    insert into game.drops select * from jsonb_populate_recordset(null::game.drops, r)
      on conflict (slot, key) do update set item_id = excluded.item_id, kind = excluded.kind, source = excluded.source, source_id = excluded.source_id,
        pct = excluded.pct, seen = excluded.seen, instance_id = excluded.instance_id, boss = excluded.boss, zone = excluded.zone, x = excluded.x,
        y = excluded.y, origin = excluded.origin, rate_src = excluded.rate_src, eligible = excluded.eligible, pack = excluded.pack;
  elsif p_table = 'quests' then
    insert into game.quests select * from jsonb_populate_recordset(null::game.quests, r)
      on conflict (slot, id) do update set title = excluded.title, lv = excluded.lv, min = excluded.min, side = excluded.side, type = excluded.type,
        cat = excluded.cat, prev = excluded.prev, next = excluded.next, obj = excluded.obj, giver = excluded.giver, turnin = excluded.turnin,
        reward = excluded.reward, choice = excluded.choice, reward_any = excluded.reward_any, rep = excluded.rep, xp = excluded.xp,
        money = excluded.money, origin = excluded.origin, pack = excluded.pack;
  elsif p_table = 'npcs' then
    insert into game.npcs select * from jsonb_populate_recordset(null::game.npcs, r)
      on conflict (slot, id) do update set name = excluded.name, min_lv = excluded.min_lv, max_lv = excluded.max_lv, rank = excluded.rank, sub = excluded.sub,
        zone = excluded.zone, points = excluded.points, spawns = excluded.spawns, friendly = excluded.friendly, pack = excluded.pack;
  elsif p_table = 'vendors' then
    insert into game.vendors select * from jsonb_populate_recordset(null::game.vendors, r)
      on conflict (slot, key) do update set item_id = excluded.item_id, npc = excluded.npc, zone = excluded.zone, x = excluded.x, y = excluded.y,
        price = excluded.price, seen_forever = excluded.seen_forever, sub = excluded.sub, side = excluded.side, pack = excluded.pack;
  elsif p_table = 'rules' then
    insert into game.rules select * from jsonb_populate_recordset(null::game.rules, r)
      on conflict (slot, key) do update set value = excluded.value, pack = excluded.pack;
  else raise exception 'unknown table %', p_table;
  end if;
  get diagnostics n = row_count;
  return n;
end $$;

-- the pack is complete when every table has its counted rows under this hash in the load slot: only then do
-- reads switch to it (and to that slot)
create or replace function public.game_finish(p_pack text, p_meta jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare got jsonb; want jsonb := p_meta->'counts'; s smallint := game.load_slot();
begin
  select jsonb_build_object(
    'items', (select count(*) from game.items where slot = s and pack = p_pack), 'drops', (select count(*) from game.drops where slot = s and pack = p_pack),
    'quests', (select count(*) from game.quests where slot = s and pack = p_pack), 'npcs', (select count(*) from game.npcs where slot = s and pack = p_pack),
    'vendors', (select count(*) from game.vendors where slot = s and pack = p_pack), 'rules', (select count(*) from game.rules where slot = s and pack = p_pack)) into got;
  if want is null or got <> want then raise exception 'pack % incomplete: have %, expected %', p_pack, got, want; end if;
  update game.packs set meta = p_meta, loaded_at = now(), complete = true, slot = s where hash = p_pack;
  return jsonb_build_object('pack', p_pack, 'slot', s, 'counts', got);
end $$;

-- which pack is loaded (the workflow skips the upload when it is the same)
create or replace function public.game_pack() returns text language sql stable security definer set search_path = '' as $$
  select game.current() $$;

revoke all on function public.game_load(text, text, jsonb), public.game_finish(text, jsonb), public.game_pack() from public, anon, authenticated;
grant execute on function public.game_load(text, text, jsonb), public.game_finish(text, jsonb), public.game_pack() to service_role;
revoke all on all tables in schema game from public, anon, authenticated;
revoke all on all functions in schema game from public, anon, authenticated;
