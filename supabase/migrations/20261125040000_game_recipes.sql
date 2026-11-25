-- Every profession recipe's tools and place (#145): a Runed Arcanite Rod, a Blacksmith Hammer, an Anvil, a Moonwell,
-- learned or not. The pack's `recipes` (gamedata/recipes.py: the VMaNGOS world database, Classic 1.12), loaded like
-- every other table (tools/pack-to-rows.py, supabase/functions/publish-game). Additive: a new table, the loader and
-- the finish count taught it, game.item gains `recipes`, and game.recipe looks recipes up.
--   select game.recipe('Runed Arcanite Rod');     -- every recipe that needs the rod (match tool), and the one making it
--   select game.recipe('20036');                  -- one recipe by spell id (or its name, or what it makes)
--   select game.item('Runed Arcanite Rod')->0->'recipes'->'toolFor';
-- A recipe the character knows: the game's own answer (the `now` record, recipes[].tools) wins over these.

create table if not exists game.recipes (
  spell_id int not null, name text, prof text, tools jsonb, place text, taught_by jsonb, makes jsonb, pack text not null,
  slot smallint not null check (slot in (0, 1)), primary key (slot, spell_id));
create index if not exists recipes_name on game.recipes (lower(name));
revoke all on game.recipes from public, anon, authenticated;

create or replace function game.recipe_source() returns text language sql immutable set search_path = '' as $$
  select 'VMaNGOS world database (Classic 1.12): a recipe Forever changed can differ; for a recipe the character knows, the game''s own answer (the now record) wins. Forever''s own new recipes are not listed.'::text $$;

-- one recipe as every look-up shows it
create or replace function game.recipe_row(c game.recipes) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('spell', c.spell_id, 'name', c.name, 'profession', c.prof, 'tools', c.tools, 'place', nullif(c.place, ''),
    'taughtBy', c.taught_by, 'makes', c.makes) $$;

-- does the loaded pack carry recipes? (a pack built before them has none: say so rather than "nothing needs it")
create or replace function game.has_recipes() returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from game.recipes c join game.live l on c.slot = l.slot and c.pack = l.hash) $$;

-- recipes by spell id, recipe name, a tool, the item a recipe makes, or the recipe item that teaches it, each with
-- what matched (match: spell, name, tool, makes, taughtBy; or "part of the name" when nothing matched exactly).
-- game.recipe('Runed Arcanite Rod') is the recipes that need the rod (match tool) and the one that makes it (makes).
-- At most 200, by profession and name; total counts them all.
create or replace function game.recipe(p text) returns jsonb language sql stable security definer set search_path = '' as $$
  with q as (select btrim(p) p, lower(btrim(p)) lp),
  cur as (select hash h, slot s from game.live),
  r as (select c.* from game.recipes c, cur where c.slot = cur.s and c.pack = cur.h),
  m as (
    select r.*, case when r.spell_id::text = q.p then 'spell' when lower(r.name) = q.lp then 'name'
      when exists (select 1 from jsonb_array_elements(r.tools) e where e->>'id' = q.p or lower(e->>'name') = q.lp) then 'tool'
      when exists (select 1 from jsonb_array_elements(r.makes) e where e->>'id' = q.p or lower(e->>'name') = q.lp) then 'makes'
      when exists (select 1 from jsonb_array_elements(r.taught_by) e where e->>'id' = q.p or lower(e->>'name') = q.lp) then 'taughtBy' end mt
    from r, q),
  hit as (
    select * from m where mt is not null
    union all
    select m.spell_id, m.name, m.prof, m.tools, m.place, m.taught_by, m.makes, m.pack, m.slot, 'part of the name' from m, q
      where not exists (select 1 from m where mt is not null) and strpos(lower(m.name), q.lp) > 0)
  select jsonb_build_object('recipes', coalesce((select jsonb_agg(game.recipe_row(row(x.spell_id, x.name, x.prof, x.tools, x.place, x.taught_by, x.makes, x.pack, x.slot)::game.recipes) || jsonb_build_object('match', x.mt) order by x.prof, x.name, x.spell_id)
                                                   from (select * from hit order by prof, name, spell_id limit 200) x), '[]'::jsonb),
                            'total', (select count(*) from hit), 'from', game.recipe_source())
         || case when game.has_recipes() then '{}'::jsonb else jsonb_build_object('note', 'the loaded game data has no recipes yet: unknown, not none') end $$;

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
                           or q.choice @> jsonb_build_array(jsonb_build_array(h.id)) or q.reward_any @> jsonb_build_array(jsonb_build_array(h.id)))), '[]'::jsonb),
    -- the recipes that make it, that it teaches (a recipe item) and that need it as a tool (a rod, a hammer): Classic data
    'recipes', case when game.has_recipes() then jsonb_build_object(
      'madeBy', coalesce((select jsonb_agg(game.recipe_row(c) order by c.spell_id) from game.recipes c, cur where c.slot = cur.s and c.pack = cur.h
                            and c.makes @> jsonb_build_array(jsonb_build_object('id', h.id))), '[]'::jsonb),
      'teaches', coalesce((select jsonb_agg(game.recipe_row(c) order by c.spell_id) from game.recipes c, cur where c.slot = cur.s and c.pack = cur.h
                            and c.taught_by @> jsonb_build_array(jsonb_build_object('id', h.id))), '[]'::jsonb),
      'toolFor', coalesce((select jsonb_agg(game.recipe_row(c) order by c.spell_id) from game.recipes c, cur where c.slot = cur.s and c.pack = cur.h
                            and c.tools @> jsonb_build_array(jsonb_build_object('id', h.id))), '[]'::jsonb),
      'from', game.recipe_source()) end)),
    '[]'::jsonb) from hit h $$;

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
  elsif p_table = 'recipes' then
    insert into game.recipes select * from jsonb_populate_recordset(null::game.recipes, r)
      on conflict (slot, spell_id) do update set name = excluded.name, prof = excluded.prof, tools = excluded.tools, place = excluded.place,
        taught_by = excluded.taught_by, makes = excluded.makes, pack = excluded.pack;
  else raise exception 'unknown table %', p_table;
  end if;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.game_finish(p_pack text, p_meta jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare got jsonb; want jsonb := p_meta->'counts'; s smallint := game.load_slot();
begin
  select jsonb_build_object(
    'items', (select count(*) from game.items where slot = s and pack = p_pack), 'drops', (select count(*) from game.drops where slot = s and pack = p_pack),
    'quests', (select count(*) from game.quests where slot = s and pack = p_pack), 'npcs', (select count(*) from game.npcs where slot = s and pack = p_pack),
    'vendors', (select count(*) from game.vendors where slot = s and pack = p_pack), 'rules', (select count(*) from game.rules where slot = s and pack = p_pack),
    'recipes', (select count(*) from game.recipes where slot = s and pack = p_pack)) into got;
  if want is null or got <> want then raise exception 'pack % incomplete: have %, expected %', p_pack, got, want; end if;
  update game.packs set meta = p_meta, loaded_at = now(), complete = true, slot = s where hash = p_pack;
  return jsonb_build_object('pack', p_pack, 'slot', s, 'counts', got);
end $$;

revoke all on function public.game_load(text, text, jsonb), public.game_finish(text, jsonb) from public, anon, authenticated;
grant execute on function public.game_load(text, text, jsonb), public.game_finish(text, jsonb) to service_role;
revoke all on all functions in schema game from public, anon, authenticated;
