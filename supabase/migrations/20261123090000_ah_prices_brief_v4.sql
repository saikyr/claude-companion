-- Two additions, nothing removed (previous versions never edited: 20261123080000_card_gate.sql,
-- 20261123070000_claude_brief_v3.sql).
--
-- 1. A card fact can quote the player's own AH scan price: src ah:<item id>@<scan time, unix>#<min|med>
--    is looked up in the account's ah_obs records (the scan the app synced) and the gold compared, as a
--    gph is. Find the scan: select t, data from private.history where account = '<account>' and
--    kind = 'ah_obs' and data->>'item' = '<id>' order by t desc limit 1;
--    check_cards is the same as before except that it passes the account to fact_problem.
-- 2. The brief's measured grinds and runs carry their start (so a card can cite them) and, for grinds,
--    the mobs the grind killed (its synced grind record's killsBy, top 3), so a grind named "azshara" is
--    known to be Sons of Arkkoroc. 0 deaths are left out.

-- the patterns: src may also be ah:<item>@<t>#<min|med>
create or replace function private.answer_pat(p text) returns text language sql immutable set search_path = '' as $$
  select case p
    when 'script' then '(^|[^a-z0-9])/(run|script|console|dump)\y'
    when 'layer' then '\ylayer(s|ing|ed)?\y|\ylayer-?hop'
    when 'wowhead' then 'wowhead'
    when 'profit' then '\yprofit'
    when 'flips' then '\yflip'
    when 'pct' then '\d(\.\d+)?\s*(%|percent\y)|\y(\d+|one|two|three|a) in (\d|ten|five|four|three|two)'
    when 'sample' then '\d[\d,]*\s*(corpses|kills|looted)|\yn\s*=\s*\d|\yclassic\y|\yunknown\y'
    when 'gph_num' then '\d[\d,.]*\s*k?\s*(g|gold)\s*(/|per|an|a|each|every)\s*(h|hr|hour)\y|\d[\d,.]*\s*k?\s*(g|gold)\s*hourly\y|\d[\d,.]*\s*k\s*/\s*(h|hr|hour)\y'
    when 'gph_ok' then '\ymeasured\y|grinds tab|dungeons tab|\yunknown\y|\yapp''?s? (gph|says|shows|measured|tracked)'
    when 'duo' then '\y(duo|duos|duoed|duoing|duoable|duo-able|solo|solos|soloed|soloing|soloable|solo-able|two-man|2-man|two man|2 man)\y'
    when 'duo_ok' then '\yunknown\y|not measured|measured run|your (own )?measured'
    when 'card_duo_ok' then '\yunknown\y|not measured'
    when 'src' then '^(game\.drop:\d{1,9}:\d{1,12}|(grind|run):[^@#]+@\d{4}-\d\d-\d\dT[\d:.]+Z#(gph|gph_low|gph_high|kills|hours|deaths)|flips#(profit|sold|paid)|snapshot#[A-Za-z0-9_.]+|ah:[1-9]\d{0,8}@\d{9,11}#(min|med))$'
  end $$;

-- fact_problem with the account: AH scan prices, then everything else as before
create or replace function private.fact_problem(p_snap jsonb, f jsonb, p_root uuid) returns text language plpgsql stable set search_path = '' as $$
declare src text := f->>'src'; txt text := coalesce(f->>'value', '') || ' ' || coalesce(f->>'note', ''); m text[]; seen numeric[];
begin
  if src !~ '^ah:' then return private.fact_problem(p_snap, f); end if;
  m := regexp_match(src, '^ah:(\d+)@(\d+)#(min|med)$');
  select coalesce(array_agg((r.data->>m[3])::numeric), '{}') into seen
    from public.records r join public.accounts a on a.id = r.account_id
   where coalesce(a.merged_into, a.id) = p_root and not a.retired and r.kind = 'ah_obs'
     and r.data->>'item' = m[1] and r.t = m[2]::bigint and jsonb_typeof(r.data->m[3]) = 'number';
  if cardinality(seen) = 0 then return 'no AH scan of item ' || m[1] || ' at ' || m[2] || ' with a ' || m[3] || ' price in your synced data'; end if;
  if not exists (select 1 from unnest(seen) x where private.quotes_gold(txt, x)) then
    return 'your AH scan says ' || m[3] || ' ' || (select string_agg(round(x / 10000, 2)::text || 'g', ' or ') from unnest(seen) x);
  end if;
  return null;
end $$;

-- the mobs a grind killed, from its synced grind record (killsBy), most kills first: [{name, kills}] (top 3)
create or replace function private.brief_grind_mobs(p_root uuid, g jsonb) returns jsonb language sql stable set search_path = '' as $$
  select (select jsonb_agg(jsonb_build_object('name', k.key, 'kills', k.value) order by (k.value #>> '{}')::numeric desc, k.key)
            from (select key, value from jsonb_each(h.data->'killsBy') where jsonb_typeof(value) = 'number'
                   order by (value #>> '{}')::numeric desc, key limit 3) k)
    from public.records h join public.accounts a on a.id = h.account_id
   where coalesce(a.merged_into, a.id) = p_root and not a.retired and h.kind = 'grind' and h.data->>'name' = g->>'name'
     and jsonb_typeof(h.data->'killsBy') = 'object'
     and case when jsonb_typeof(h.data->'start') = 'number' then (h.data->>'start')::numeric end
       = case when private.is_time(g->>'start') then extract(epoch from (g->>'start')::timestamptz) end
   order by h.t desc limit 1 $$;

create or replace function private.check_cards(p_account uuid, p_cards jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare out jsonb := '[]'::jsonb; c jsonb; f jsonb; cid text; seen text[] := '{}'; k text; l text; rr text; snap jsonb; root uuid;
  whole text; duo_ok boolean; p text; src text; t text; v text; isfact boolean;
  keys text[] := array['id', 'kind', 'title', 'summary', 'status', 'created', 'updated', 'expires', 'character', 'where',
                       'facts', 'items', 'steps', 'track', 'body', 'sources', 'step', 'risk'];
  bad text := null;
begin
  if jsonb_typeof(p_cards) is distinct from 'object' or p_cards->'schema' is distinct from '1'::jsonb or jsonb_typeof(p_cards->'cards') is distinct from 'array' then
    return jsonb_build_array(jsonb_build_object('card', null, 'rule', 'format', 'msg', 'top level must be {"schema": 1, "cards": [...]}'));
  end if;
  select coalesce(merged_into, id) into root from public.accounts where id = p_account;
  select r.data into snap from public.records r join public.accounts a on a.id = r.account_id
   where coalesce(a.merged_into, a.id) = root and not a.retired and r.kind = 'snapshot' order by r.t desc, r.updated_at desc limit 1;
  for c in select x from jsonb_array_elements(p_cards->'cards') x loop
    if jsonb_typeof(c) <> 'object' then out := out || jsonb_build_object('card', null, 'rule', 'format', 'msg', 'a card is not an object'); continue; end if;
    cid := case when jsonb_typeof(c->'id') = 'string' then c->>'id' end;
    if cid is null or cid !~ '^[a-z0-9][a-z0-9-]{0,79}$' then out := out || jsonb_build_object('card', cid, 'rule', 'format', 'msg', 'id must be lower-case letters, digits and dashes');
    elsif cid = any(seen) then out := out || jsonb_build_object('card', cid, 'rule', 'format', 'msg', 'id used twice'); end if;
    seen := seen || cid;
    -- the format (tools/check-cards.py)
    for k in select jsonb_object_keys(c) loop
      if not k = any(keys) then out := out || jsonb_build_object('card', cid, 'rule', 'format', 'msg', 'unknown field "' || k || '"'); end if;
    end loop;
    bad := concat_ws('; ',
      case when jsonb_typeof(c->'title') is distinct from 'string' or btrim(c->>'title') = '' then 'needs a title' end,
      case when c ? 'kind' and (jsonb_typeof(c->'kind') <> 'string' or c->>'kind' not in ('farm', 'flip', 'quest', 'gear', 'craft', 'route', 'note')) then 'unknown kind' end,
      case when c ? 'status' and (jsonb_typeof(c->'status') <> 'string' or c->>'status' not in ('open', 'done', 'withdrawn')) then 'unknown status' end,
      (select string_agg(k2 || ' is not an ISO time', '; ') from unnest(array['created', 'updated', 'expires']) k2
        where jsonb_typeof(c->k2) not in ('null') and (jsonb_typeof(c->k2) <> 'string'
          or c->>k2 !~ '^\d{4}-\d\d-\d\d([T ]\d\d:\d\d(:\d\d(\.\d+)?)?)?(Z|[+-]\d\d(:?\d\d)?)?$' or not private.is_time(c->>k2))),
      (select string_agg(k2 || ' must be text', '; ') from unnest(array['summary', 'character', 'where', 'body', 'risk']) k2
        where jsonb_typeof(c->k2) not in ('null', 'string')),
      (select string_agg(k2 || ' must be a list', '; ') from unnest(array['steps', 'facts', 'items', 'sources']) k2
        where c ? k2 and jsonb_typeof(c->k2) <> 'array'),
      case when jsonb_typeof(c->'steps') = 'array' and exists (select 1 from jsonb_array_elements(c->'steps') x where jsonb_typeof(x) <> 'string') then 'steps must be a list of text' end,
      case when jsonb_typeof(c->'facts') = 'array' and exists (select 1 from jsonb_array_elements(c->'facts') x
        where jsonb_typeof(x) <> 'object' or jsonb_typeof(x->'label') is distinct from 'string' or jsonb_typeof(x->'value') is distinct from 'string'
           or exists (select 1 from jsonb_object_keys(x) fk where fk not in ('label', 'value', 'note', 'src'))) then 'each fact needs label and value (text), and may have note and src' end,
      case when jsonb_typeof(c->'items') = 'array' and exists (select 1 from jsonb_array_elements(c->'items') x
        where jsonb_typeof(x) <> 'object' or jsonb_typeof(x->'id') is distinct from 'number' or (x->>'id') !~ '^[1-9]\d*$') then 'each item needs a numeric game item id' end,
      case when jsonb_typeof(c->'sources') = 'array' and exists (select 1 from jsonb_array_elements(c->'sources') x
        where jsonb_typeof(x) <> 'object' or jsonb_typeof(x->'label') is distinct from 'string'
           or (jsonb_typeof(x->'url') is distinct from 'null' and x ? 'url' and (jsonb_typeof(x->'url') <> 'string' or x->>'url' !~ '^https?://'))) then 'each source needs a label (and an http(s) url if any)' end,
      case when jsonb_typeof(c->'step') not in ('null') and (jsonb_typeof(c->'step') <> 'string'
        or c->>'step' !~ '^((quest|item|npc):\d+|(dungeon|zone):\S.*)$') then 'step is quest:<id>, item:<id>, npc:<id>, dungeon:<name> or zone:<name>' end,
      case when jsonb_typeof(c->'track') not in ('null') and (jsonb_typeof(c->'track') <> 'object' or jsonb_typeof(c->'track'->'grind') is distinct from 'string'
        or (c->'track' ? 'mobs' and (jsonb_typeof(c->'track'->'mobs') <> 'array' or exists (select 1 from jsonb_array_elements(c->'track'->'mobs') x where jsonb_typeof(x) <> 'string'))))
        then 'track is {"grind": "<name used with /cc start>", "mobs": [names]}' end);
    if bad <> '' then out := out || jsonb_build_object('card', cid, 'rule', 'format', 'msg', bad); end if;
    if coalesce(c->>'status', 'open') <> 'open' or (c ? 'status' and jsonb_typeof(c->'status') <> 'string') then continue; end if;

    -- the rules (tools/answer_rules.py card_rules)
    select lower(string_agg(x, ' ')) into whole from (
      select private.card_lines(c) x
      union all select private.fact_line(ff) from jsonb_array_elements(case when jsonb_typeof(c->'facts') = 'array' then c->'facts' else '[]'::jsonb end) ff
       where jsonb_typeof(ff) = 'object') y;
    whole := coalesce(whole, '');
    duo_ok := exists (select 1 from (select private.card_lines(c) x union all select private.fact_line(ff) from jsonb_array_elements(
                 case when jsonb_typeof(c->'facts') = 'array' then c->'facts' else '[]'::jsonb end) ff where jsonb_typeof(ff) = 'object') y
               where lower(y.x) ~ private.answer_pat('duo') and lower(y.x) ~ private.answer_pat('card_duo_ok')) or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(c->'facts') = 'array' then c->'facts' else '[]'::jsonb end) ff
       where jsonb_typeof(ff) = 'object' and ff->>'src' like 'run:%');
    for l, isfact in select x, false from private.card_lines(c) x
                     union all select private.fact_line(ff), true from jsonb_array_elements(case when jsonb_typeof(c->'facts') = 'array' then c->'facts' else '[]'::jsonb end) ff
                      where jsonb_typeof(ff) = 'object' loop
      t := lower(l);
      foreach p in array array['script', 'layer', 'wowhead'] loop
        if t ~ private.answer_pat(p) then out := out || jsonb_build_object('card', cid, 'rule', 'banned', 'msg', left(l, 80)); end if;
      end loop;
      if t ~ private.answer_pat('profit') and t !~ private.answer_pat('flips') then out := out || jsonb_build_object('card', cid, 'rule', 'profit', 'msg', left(l, 80)); end if;
      if t ~ private.answer_pat('duo') and not duo_ok then out := out || jsonb_build_object('card', cid, 'rule', 'duo', 'msg', 'duo or solo claims need a run src or say unknown: ' || left(l, 80)); end if;
      if not isfact and t ~ private.answer_pat('pct') then out := out || jsonb_build_object('card', cid, 'rule', 'rate', 'msg', 'a rate goes in facts[] with its game.drop src: ' || left(l, 80)); end if;
      if not isfact and t ~ private.answer_pat('gph_num') then out := out || jsonb_build_object('card', cid, 'rule', 'gph', 'msg', 'gold per hour goes in facts[] with its grind or run src: ' || left(l, 80)); end if;
    end loop;
    for f in select x from jsonb_array_elements(case when jsonb_typeof(c->'facts') = 'array' then c->'facts' else '[]'::jsonb end) x where jsonb_typeof(x) = 'object' loop
      src := case when jsonb_typeof(f->'src') = 'string' then f->>'src' else '' end;
      v := lower(coalesce(f->>'value', ''));
      t := lower(private.fact_line(f));
      if f ? 'src' and jsonb_typeof(f->'src') <> 'null' and (jsonb_typeof(f->'src') <> 'string' or src !~ private.answer_pat('src')) then
        out := out || jsonb_build_object('card', cid, 'rule', 'src', 'msg', 'fact "' || coalesce(f->>'label', '') || '": src must be game.drop:<item>:<npc>, grind:<name>@<start>#<field>, run:<name>@<start>#<field>, flips#<field>, snapshot#<path> or ah:<item>@<scan time>#<min|med>');
        continue;
      end if;
      if v ~ '\d' and src = '' then
        out := out || jsonb_build_object('card', cid, 'rule', 'src', 'msg', 'fact "' || coalesce(f->>'label', '') || '": a number needs its src, so it can be checked');
      end if;
      if v ~ private.answer_pat('pct') and src !~ '^(game\.drop:|snapshot#)' then
        out := out || jsonb_build_object('card', cid, 'rule', 'rate', 'msg', 'fact "' || coalesce(f->>'label', '') || '": a rate comes from game.drop:<item>:<npc>');
      elsif v ~ private.answer_pat('pct') and src ~ '^game\.drop:' and t !~ private.answer_pat('sample') then
        out := out || jsonb_build_object('card', cid, 'rule', 'rate', 'msg', 'fact "' || coalesce(f->>'label', '') || '": quote the rate with its corpses, or say Classic or unknown');
      end if;
      if v ~ private.answer_pat('gph_num') and src !~ '^(grind|run):' then
        out := out || jsonb_build_object('card', cid, 'rule', 'gph', 'msg', 'fact "' || coalesce(f->>'label', '') || '": gold per hour comes from grind:<name>@<start>#gph or run:...');
      end if;
      if src <> '' then
        p := private.fact_problem(snap, f, root);
        if p is not null then out := out || jsonb_build_object('card', cid, 'rule', 'value', 'msg', 'fact "' || coalesce(f->>'label', '') || '": ' || p); end if;
      end if;
    end loop;
    if whole ~ private.answer_pat('profit') and not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(c->'facts') = 'array' then c->'facts' else '[]'::jsonb end) x
        where jsonb_typeof(x) = 'object' and x->>'src' = 'flips#profit') then
      out := out || jsonb_build_object('card', cid, 'rule', 'profit', 'msg', 'a card that says profit needs a flips#profit fact');
    end if;
    if c->>'kind' = 'farm' and (jsonb_typeof(c->'risk') is distinct from 'string' or btrim(c->>'risk') = '') then
      out := out || jsonb_build_object('card', cid, 'rule', 'risk', 'msg', 'a farm card needs risk: deaths, elites, patrols, PvP, what goes wrong');
    end if;
  end loop;
  return out;
end $$;

-- the brief, fourth version: measured entries with start and mobs
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
      'Gold per hour: quote gph / gph_low / gph_high as given; never work one out. complete=false: say why (incomplete). On a card its src is grind:<name>@<start>#gph (or run:...); mobs = what the grind killed.',
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
            select jsonb_build_object('what', 'grind', 'name', g->>'name', 'zones', case when jsonb_array_length(private.brief_arr(g->'zones')) > 0 then g->'zones' end,
                     'start', g->>'start', 'end', coalesce(g->>'finish', g->>'last'), 'mobs', private.brief_grind_mobs(root, g),
                     'hours', g->'hours', 'kills', g->'kills', 'deaths', case when (g->>'deaths') is distinct from '0' then g->'deaths' end, 'gph', g->'gph', 'gph_low', g->'gph_low', 'gph_high', g->'gph_high',
                     'complete', g->'complete', 'incomplete', case when jsonb_array_length(private.brief_arr(g->'incomplete')) > 0 then g->'incomplete' end) m
              from jsonb_array_elements(private.brief_arr(s->'grind'->'recent') || jsonb_build_array(coalesce(s->'grind'->'running', 'null'::jsonb))) g
             where jsonb_typeof(g) = 'object'
            union all
            select jsonb_build_object('what', 'run', 'name', r->>'name', 'start', r->>'start', 'end', coalesce(r->>'finish', r->>'start'), 'hours', r->'hours',
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

revoke all on function private.fact_problem(jsonb, jsonb, uuid), private.brief_grind_mobs(uuid, jsonb), private.check_cards(uuid, jsonb),
  private.answer_pat(text), private.claude_brief(uuid, text[])
  from public, anon, authenticated;
