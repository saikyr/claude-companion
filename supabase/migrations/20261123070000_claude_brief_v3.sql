-- The brief, third version (v1 20261123030000, v2 20261123060000, never edited): the default brief trimmed
-- toward 6 KB so a session reads it whole. Asked for by name (p_parts) nothing is trimmed. Trimmed: the
-- per-part save times (character.savedParts), upgrades to the top 3 per spec and missing pre-BiS to 4
-- (each with its total), the 6 newest measured grinds and runs, each computer's newest snapshot only, and
-- empty or default fields
-- (complete=false, no rewards, level 0, no zones, nothing incomplete). A quest with no `complete` is not complete.

create or replace function private.claude_brief(p_account uuid, p_parts text[] default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  root uuid; s jsonb; s_t bigint; s_comp text; s_upd timestamptz; now_t bigint := extract(epoch from now())::bigint;
  parts text[] := coalesce(p_parts, array['character', 'specs', 'quests', 'gold', 'professions', 'cooldowns', 'caps']);
  full_parts boolean := p_parts is not null;   -- asked for by name: no trimming
  out jsonb; builds jsonb; age int;
begin
  select coalesce(merged_into, id) into root from public.accounts where id = p_account;
  if root is null then raise exception 'no such account'; end if;

  -- the newest snapshot: the save it was built from, then when it arrived
  select r.data, r.t, dv.name, r.updated_at into s, s_t, s_comp, s_upd
    from public.records r join public.accounts a on a.id = r.account_id left join public.devices dv on dv.id = r.device_id
   where coalesce(a.merged_into, a.id) = root and not a.retired and r.kind = 'snapshot'
   order by r.t desc, r.updated_at desc limit 1;
  if s is null then
    return jsonb_build_object('meta', jsonb_build_object('account', root, 'snapshot', null,
      'note', 'No snapshot online yet: the player opens the app once after a /reload or logout.'));
  end if;

  -- each computer's newest snapshot
  select coalesce(jsonb_agg(jsonb_build_object('computer', x.name, 'build', x.build, 'savedInGame', x.saved) order by x.t desc), '[]'::jsonb) into builds
    from (select distinct on (r.device_id) dv.name, r.data->'app'->>'build' build, r.data->>'savedInGame' saved, r.t
            from public.records r join public.accounts a on a.id = r.account_id left join public.devices dv on dv.id = r.device_id
           where coalesce(a.merged_into, a.id) = root and not a.retired and r.kind = 'snapshot'
           order by r.device_id, r.t desc, r.updated_at desc) x;

  age := greatest(0, (now_t - s_t) / 60)::int;
  out := jsonb_build_object('meta', jsonb_build_object(
    'account', root, 'computer', s_comp, 'character', s->'character'->>'name', 'savedInGame', s->>'savedInGame', 'snapshotArrived', s_upd,
    'ageMinutes', age, 'stale', age > 60,
    'build', s->'app'->>'build', 'computers', builds,
    'quote', jsonb_build_array(
      'Say how old this is (ageMinutes) in every answer that uses it. Fields left out are empty, false or 0 (a quest with no complete is not complete).',
      'Gold per hour: quote gph / gph_low / gph_high as given; never work one out. complete=false: say why (incomplete).',
      'Profit is only gold.flips; gold.sales7d is revenue.',
      'Gear and rewards: the app''s scores for every spec; quests with keep=true (dungeon, key or attunement chain, rep toward rep-gated rewards: keepWhy) never go on a drop list.',
      'Game facts (items, drops, quests, NPCs, instances): game.item / game.npc / game.quest / game.instance, quoting each rate''s label. Never the web, never a Classic rate as Forever.',
      'Anything not here: the snapshot (CLAUDE.md queries) or docs/FEATURES.md. Not tracked = say so.')));

  if 'character' = any(parts) then
    out := out || jsonb_build_object('character', jsonb_build_object(
      'name', s->'character'->>'name', 'level', s->'character'->'level', 'class', s->'character'->>'class',
      'race', s->'character'->>'race', 'faction', s->'character'->>'faction',
      'gold', round(coalesce((s->'character'->>'money')::numeric, 0) / 10000, 2),
      'where', s->'character'->'where', 'hearth', s->'character'->>'hearth',
      'savedParts', case when full_parts then s->'taken' end));
  end if;

  -- per spec: what the app compares against, its best upgrades now (top 5 by gain) and pre-BiS still missing
  if 'specs' = any(parts) then
    out := out || jsonb_build_object('specs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'spec', g->>'label', 'active', g->'active', 'weights', g->>'weightsName', 'comparedWith', g->>'comparedWith',
        'upgrades', coalesce((select jsonb_agg(jsonb_build_object('slot', u->>'slot', 'id', u->'id', 'name', u->>'name', 'gain', u->'gain',
                                     'source', u->>'source', 'where', u->'where', 'ah', u->'ah') order by (u->>'gain')::numeric desc)
                              from (select u from jsonb_array_elements(private.brief_arr(g->'upgrades')) u
                                     order by (u->>'gain')::numeric desc limit case when full_parts then 1000 else 3 end) x), '[]'::jsonb),
        'upgradesTotal', jsonb_array_length(private.brief_arr(g->'upgrades')),
        'preBisMissing', coalesce((select jsonb_agg(jsonb_build_object('slot', p->>'slot', 'name', p->>'name', 'where', p->'where'))
                                    from (select p from jsonb_array_elements(private.brief_arr(g->'preBis')) p
                                           where p->>'status' = 'missing' limit case when full_parts then 1000 else 4 end) y), '[]'::jsonb),
        'preBisMissingTotal', (select count(*) from jsonb_array_elements(private.brief_arr(g->'preBis')) p where p->>'status' = 'missing')))
        from jsonb_array_elements(private.brief_arr(s->'gear')) g), '[]'::jsonb));
    if jsonb_array_length(out->'specs') = 0 then
      out := jsonb_set(out, '{meta,quote}', (out->'meta'->'quote') || jsonb_build_array(
        'specs is empty: this snapshot has no gear advice (the save had no skills, or an older build). Say so; never score gear by hand.'));
    end if;
  end if;

  -- the quest log: keep (dungeon) flags and, per reward, only the specs it is an upgrade for;
  -- rewardsNoGain = rewards that are an upgrade for no spec (asked for by name: all of them, listed)
  if 'quests' = any(parts) then
    out := out || jsonb_build_object('quests', coalesce((
      select jsonb_agg(jsonb_build_object('id', q->'id', 'title', q->>'title', 'level', case when jsonb_typeof(q->'level') = 'number' and (q->>'level')::numeric > 0 then q->'level' end,
        'complete', case when q->'complete' = 'true'::jsonb then 'true'::jsonb when jsonb_typeof(q->'complete') = 'boolean' then null else q->'complete' end,
        -- an older build wrote no keep flag: unknown, never false (false would read as "not a dungeon quest")
        'keep', coalesce(q->'keep', '"unknown"'::jsonb), 'dungeon', q->'dungeon', 'keepWhy', q->'keepWhy',
        'rep', case when jsonb_array_length(private.brief_arr(q->'rep')) > 0 then q->'rep' end,
        'rewards', (select jsonb_agg(jsonb_build_object('name', r->>'name', 'how', r->>'how',
                               'upgradeFor', coalesce((select jsonb_agg(jsonb_build_object('spec', sp->>'spec', 'gain', sp->'gain'))
                                                         from jsonb_array_elements(private.brief_arr(r->'specs')) sp
                                                        where coalesce((sp->>'gain')::numeric, 0) > 0), '[]'::jsonb),
                               'scored', jsonb_typeof(r->'specs') = 'array'))
                              from jsonb_array_elements(private.brief_arr(q->'rewards')) r
                             -- trimmed: only rewards that are an upgrade for some spec, or that the app couldn't score
                             where full_parts or jsonb_typeof(r->'specs') <> 'array'
                                or exists (select 1 from jsonb_array_elements(r->'specs') sp where coalesce((sp->>'gain')::numeric, 0) > 0)),
        'rewardsNoGain', case when full_parts then null else (select nullif(count(*), 0) from jsonb_array_elements(private.brief_arr(q->'rewards')) r
                             where jsonb_typeof(r->'specs') = 'array'
                               and not exists (select 1 from jsonb_array_elements(r->'specs') sp where coalesce((sp->>'gain')::numeric, 0) > 0)) end))
        from jsonb_array_elements(private.brief_arr(s->'quests')) q), '[]'::jsonb));
  end if;

  -- gold: flips are profit, sales are revenue, measured = the app's gph for each grind and run
  if 'quests' = any(parts) and exists (select 1 from jsonb_array_elements(private.brief_arr(s->'quests')) q where not (q ? 'keep')) then
    out := jsonb_set(out, '{meta,quote}', (out->'meta'->'quote') || jsonb_build_array(
      'keep is "unknown": this snapshot is from a build before dungeon quests were flagged. Treat every quest as possibly a dungeon quest; never suggest dropping one.'));
  end if;

  if 'gold' = any(parts) then
    out := out || jsonb_build_object('gold', jsonb_build_object(
      'flips', s->'ah'->'flips'->'totals',
      -- one row per record id (an account merged from another can hold the same record twice); every character of the account
      'sales7d', (select jsonb_build_object('revenue', coalesce(sum((x.data->>'net')::numeric), 0), 'sales', count(*),
                           'label', 'revenue (AH cut taken off), not profit; every character of the account')
                    from (select distinct on (r.id) r.data from private.history r
                           where r.account = root and r.kind = 'ah_sale' and r.t > s_t - 7 * 86400 order by r.id, r.t desc) x),
      'buys7d', (select jsonb_build_object('paid', coalesce(sum((x.data->>'price')::numeric), 0), 'buys', count(*), 'label', 'every character of the account')
                    from (select distinct on (r.id) r.data from private.history r
                           where r.account = root and r.kind = 'ah_buy' and r.t > s_t - 7 * 86400 order by r.id, r.t desc) x),
      'measured', coalesce((
        select jsonb_agg(m order by m->>'end' desc) from (
          select m from (
            select jsonb_build_object('what', 'grind', 'name', g->>'name', 'zones', case when jsonb_array_length(private.brief_arr(g->'zones')) > 0 then g->'zones' end, 'end', coalesce(g->>'finish', g->>'last'),
                     'hours', g->'hours', 'kills', g->'kills', 'deaths', g->'deaths', 'gph', g->'gph', 'gph_low', g->'gph_low', 'gph_high', g->'gph_high',
                     'complete', g->'complete', 'incomplete', case when jsonb_array_length(private.brief_arr(g->'incomplete')) > 0 then g->'incomplete' end) m
              from jsonb_array_elements(private.brief_arr(s->'grind'->'recent') || jsonb_build_array(coalesce(s->'grind'->'running', 'null'::jsonb))) g
             where jsonb_typeof(g) = 'object'
            union all
            select jsonb_build_object('what', 'run', 'name', r->>'name', 'end', coalesce(r->>'finish', r->>'start'), 'hours', r->'hours',
                     'kills', r->'kills', 'bosses', jsonb_array_length(private.brief_arr(r->'bosses')), 'gph', r->'gph', 'gph_low', r->'gph_low',
                     'gph_high', r->'gph_high', 'complete', r->'complete', 'incomplete', case when jsonb_array_length(private.brief_arr(r->'incomplete')) > 0 then r->'incomplete' end)
              from jsonb_array_elements(private.brief_arr(s->'runs')) r) u
          order by m->>'end' desc limit case when full_parts then 1000 else 6 end) z), '[]'::jsonb),
      'measuredTotal', jsonb_array_length(private.brief_arr(s->'grind'->'recent')) + jsonb_array_length(private.brief_arr(s->'runs')) + case when jsonb_typeof(s->'grind'->'running') = 'object' then 1 else 0 end,
      'measuredMore', 'all of them: private.claude_brief(<account>, array[''gold''])',
      'units', 'gph fields: copper per hour (10000 = 1 gold), before the 5% AH cut, loot counted sold or not'));
  end if;

  if 'gold' = any(parts) and exists (select 1 from jsonb_array_elements(out->'gold'->'measured') m where not (m ? 'gph') or m->'gph' = 'null'::jsonb) then
    out := jsonb_set(out, '{meta,quote}', (out->'meta'->'quote') || jsonb_build_array(
      'Some measured entries have no gph: their snapshot is from an older build. Say the app has no rate for them; never work one out.'));
  end if;

  if 'professions' = any(parts) then out := out || jsonb_build_object('professions', coalesce(s->'professions', '[]'::jsonb)); end if;
  if 'cooldowns' = any(parts) then out := out || jsonb_build_object('cooldowns', coalesce(s->'cooldowns', '[]'::jsonb)); end if;
  if 'caps' = any(parts) then
    out := out || jsonb_build_object('caps', case when s->'caps' is null then null else jsonb_build_object(
      'checked', s->'caps'->'checked', 'build', s->'caps'->'build',
      'GetLootSourceInfo', s->'caps'->'api'->>'GetLootSourceInfo', 'LoggingCombat', coalesce(s->'caps'->>'loggingCombat', s->'caps'->'secret'->>'LoggingCombat'),
      'loot', s->'caps'->'loot', 'instance', s->'caps'->'instance') end);
  end if;
  if 'rep' = any(parts) then out := out || jsonb_build_object('rep', coalesce(s->'reputation', '[]'::jsonb)); end if;
  if 'bags' = any(parts) then out := out || jsonb_build_object('bags', coalesce(s->'bagAdvice', '[]'::jsonb)); end if;
  if 'next' = any(parts) then out := out || jsonb_build_object('next', coalesce(s->'nextSteps', '[]'::jsonb)); end if;
  if 'ah' = any(parts) then out := out || jsonb_build_object('ah', coalesce(s->'ah', '{}'::jsonb)); end if;
  if 'runs' = any(parts) then out := out || jsonb_build_object('runs', coalesce(s->'runs', '[]'::jsonb)); end if;
  out := jsonb_strip_nulls(out);   -- fields an older snapshot lacks are left out, not null
  out := jsonb_set(out, '{meta,parts}', to_jsonb(parts));
  out := jsonb_set(out, '{meta,more}', '["rep","bags","next","ah","runs"]'::jsonb);
  return out;
end $$;

revoke all on function private.claude_brief(uuid, text[]) from public, anon, authenticated;
