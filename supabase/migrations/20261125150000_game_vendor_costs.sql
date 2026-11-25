-- What a vendor asks besides gold, and the reputation it asks (#151). Forever's recipe vendors (Alynsia in Redridge,
-- Beneris in the Barrens) sell for Merchant's Favor and each asks its own side's trade faction at Honored, where
-- game.vendors said price 0 and nothing else. The pack's vendor rows gain both (gamedata/build.py, from the item's
-- endgametools page: the Forever client's vendor data; ForeverDB's currency prices otherwise), and so does game.vendors.
-- Additive: two new columns; game.item's vendors show them (cost, needsRep), the loader writes them.
--   select game.item('249526')->0->'vendors';   -- [{npc: Alynsia, ..., cost: "240 Merchant's Favor", needsRep: ["Azeroth Commerce Authority", 6]}, ...]

alter table game.vendors add column if not exists cost text;
alter table game.vendors add column if not exists req_rep jsonb;

-- game.item as before (20261125040000_game_recipes.sql), each vendor with its cost and reputation
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
                                    'seenOnForever', v.seen_forever, 'side', v.side, 'cost', v.cost, 'needsRep', v.req_rep))
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

-- the loader as before (20261125120000_game_enchants.sql), vendors with the two new columns
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
        price = excluded.price, seen_forever = excluded.seen_forever, sub = excluded.sub, side = excluded.side,
        cost = excluded.cost, req_rep = excluded.req_rep, pack = excluded.pack;
  elsif p_table = 'rules' then
    insert into game.rules select * from jsonb_populate_recordset(null::game.rules, r)
      on conflict (slot, key) do update set value = excluded.value, pack = excluded.pack;
  elsif p_table = 'recipes' then
    insert into game.recipes select * from jsonb_populate_recordset(null::game.recipes, r)
      on conflict (slot, spell_id) do update set name = excluded.name, prof = excluded.prof, tools = excluded.tools, place = excluded.place,
        taught_by = excluded.taught_by, makes = excluded.makes, reagents = excluded.reagents, trainer_skill = excluded.trainer_skill, pack = excluded.pack;
  elsif p_table = 'enchants' then
    insert into game.enchants select * from jsonb_populate_recordset(null::game.enchants, r)
      on conflict (slot, id) do update set name = excluded.name, description = excluded.description, formulas = excluded.formulas,
        items = excluded.items, pack = excluded.pack;
  else raise exception 'unknown table %', p_table;
  end if;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.game_load(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.game_load(text, text, jsonb) to service_role;
revoke all on all functions in schema game from public, anon, authenticated;
