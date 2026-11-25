-- Every permanent enchant, and every recipe's reagents and trainer (#147). The pack's `enchants` (gamedata/recipes.py:
-- the VMaNGOS world database, Classic 1.12) become game.enchants, loaded like every other table (tools/pack-to-rows.py,
-- supabase/functions/publish-game); game.recipes gains each recipe's reagents and the skill a trainer teaches it at.
-- Additive: a new table and two new columns; game.recipe_row and game.recipe show them, the loader and the finish
-- count know the new table, and game.enchant looks enchants up.
--   select game.enchant('913');                     -- one enchant by id: its Classic text, the formulas and items that apply it
--   select game.enchant('Zandalar Signet of Serenity');   -- by the item (or formula) that applies it, or by name
--   select game.recipe('Enchant Chest - Major Mana');      -- now with reagents and trainerSkill
-- What is on the character's gear, scored for each spec, and the best enchant to get: the snapshot's gear[].enchants
-- (the app, js/enchants.js), which prefers the game's own text: Forever changed some enchants.

alter table game.recipes add column if not exists reagents jsonb;
alter table game.recipes add column if not exists trainer_skill int;

create table if not exists game.enchants (
  id int not null, name text, description text, formulas jsonb, items jsonb, pack text not null,
  slot smallint not null check (slot in (0, 1)), primary key (slot, id));
create index if not exists enchants_name on game.enchants (lower(name));
revoke all on game.enchants from public, anon, authenticated;

-- one recipe as every look-up shows it (reagents: each with its count; trainerSkill: 0 = comes with the profession,
-- null = no trainer teaches it)
create or replace function game.recipe_row(c game.recipes) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('spell', c.spell_id, 'name', c.name, 'profession', c.prof, 'tools', c.tools, 'place', nullif(c.place, ''),
    'taughtBy', c.taught_by, 'makes', c.makes, 'reagents', c.reagents, 'trainerSkill', c.trainer_skill) $$;

-- game.recipe as before (20261125040000_game_recipes.sql), each row passed whole: the table has more columns now
create or replace function game.recipe(p text) returns jsonb language sql stable security definer set search_path = '' as $$
  with q as (select btrim(p) p, lower(btrim(p)) lp),
  cur as (select hash h, slot s from game.live),
  r as (select c from game.recipes c, cur where c.slot = cur.s and c.pack = cur.h),
  m as (
    select r.c, case when (r.c).spell_id::text = q.p then 'spell' when lower((r.c).name) = q.lp then 'name'
      when exists (select 1 from jsonb_array_elements((r.c).tools) e where e->>'id' = q.p or lower(e->>'name') = q.lp) then 'tool'
      when exists (select 1 from jsonb_array_elements((r.c).makes) e where e->>'id' = q.p or lower(e->>'name') = q.lp) then 'makes'
      when exists (select 1 from jsonb_array_elements((r.c).taught_by) e where e->>'id' = q.p or lower(e->>'name') = q.lp) then 'taughtBy' end mt
    from r, q),
  hit as (
    select m.c, m.mt from m where m.mt is not null
    union all
    select m.c, 'part of the name' from m, q
      where not exists (select 1 from m where mt is not null) and strpos(lower((m.c).name), q.lp) > 0)
  select jsonb_build_object('recipes', coalesce((select jsonb_agg(game.recipe_row(x.c) || jsonb_build_object('match', x.mt) order by (x.c).prof, (x.c).name, (x.c).spell_id)
                                                   from (select * from hit order by (c).prof, (c).name, (c).spell_id limit 200) x), '[]'::jsonb),
                            'total', (select count(*) from hit), 'from', game.recipe_source())
         || case when game.has_recipes() then '{}'::jsonb else jsonb_build_object('note', 'the loaded game data has no recipes yet: unknown, not none') end $$;

create or replace function game.enchant_source() returns text language sql immutable set search_path = '' as $$
  select 'VMaNGOS world database (Classic 1.12): Forever changed some enchants (Enchant Chest - Superior Mana is Superior Intellect there); the game''s own text wins: the item''s "Enchanted:" line, a known formula''s description (the snapshot''s gear[].enchants). Enchants Forever added are not listed.'::text $$;

create or replace function game.has_enchants() returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from game.enchants e join game.live l on e.slot = l.slot and e.pack = l.hash) $$;

-- enchants by enchant id, name, or a formula or item that applies it (by name or id), each with what matched
-- (match: enchant, name, formula, item; or "part of the name"). At most 100, by name; total counts them all.
create or replace function game.enchant(p text) returns jsonb language sql stable security definer set search_path = '' as $$
  with q as (select btrim(p) p, lower(btrim(p)) lp),
  cur as (select hash h, slot s from game.live),
  r as (select e.* from game.enchants e, cur where e.slot = cur.s and e.pack = cur.h),
  m as (
    select r.*, case when r.id::text = q.p then 'enchant' when lower(r.name) = q.lp then 'name'
      when exists (select 1 from jsonb_array_elements(r.formulas) f where f->>'spell' = q.p or lower(f->>'name') = q.lp) then 'formula'
      when exists (select 1 from jsonb_array_elements(r.items) i where i->>'id' = q.p or lower(i->>'name') = q.lp) then 'item' end mt
    from r, q),
  hit as (
    select m.id, m.name, m.description, m.formulas, m.items, m.mt from m where m.mt is not null
    union all
    select m.id, m.name, m.description, m.formulas, m.items, 'part of the name' from m, q
      where not exists (select 1 from m where mt is not null) and strpos(lower(m.name), q.lp) > 0)
  select jsonb_build_object('enchants', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'description', x.description,
                                                     'formulas', x.formulas, 'items', x.items, 'match', x.mt) order by x.name, x.id)
                                                   from (select * from hit order by name, id limit 100) x), '[]'::jsonb),
                            'total', (select count(*) from hit), 'from', game.enchant_source())
         || case when game.has_enchants() then '{}'::jsonb else jsonb_build_object('note', 'the loaded game data has no enchants yet: unknown, not none') end $$;

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

create or replace function public.game_finish(p_pack text, p_meta jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare got jsonb; want jsonb := p_meta->'counts'; s smallint := game.load_slot();
begin
  select jsonb_build_object(
    'items', (select count(*) from game.items where slot = s and pack = p_pack), 'drops', (select count(*) from game.drops where slot = s and pack = p_pack),
    'quests', (select count(*) from game.quests where slot = s and pack = p_pack), 'npcs', (select count(*) from game.npcs where slot = s and pack = p_pack),
    'vendors', (select count(*) from game.vendors where slot = s and pack = p_pack), 'rules', (select count(*) from game.rules where slot = s and pack = p_pack),
    'recipes', (select count(*) from game.recipes where slot = s and pack = p_pack),
    'enchants', (select count(*) from game.enchants where slot = s and pack = p_pack)) into got;
  if want is null or got <> want then raise exception 'pack % incomplete: have %, expected %', p_pack, got, want; end if;
  update game.packs set meta = p_meta, loaded_at = now(), complete = true, slot = s where hash = p_pack;
  return jsonb_build_object('pack', p_pack, 'slot', s, 'counts', got);
end $$;

revoke all on function public.game_load(text, text, jsonb), public.game_finish(text, jsonb) from public, anon, authenticated;
grant execute on function public.game_load(text, text, jsonb), public.game_finish(text, jsonb) to service_role;
revoke all on all functions in schema game from public, anon, authenticated;
