-- The card gate (private.check_cards, last in 20261125140000_card_gate_future_time.sql, never edited) as before, plus
-- the fields of #163, the same rules as tools/check-cards.py: `order` (a whole number, lowest shows first), `group`
-- (text: the plan a card is part of), `stepsDone` (step positions Claude saw done) and `doneWhen` (one game check
-- or null per step: quest:<id>, item:<id>[x<n>], rep:<faction>>=<standing>, level:<n>, skill:<profession>>=<n>;
-- js/cardsteps.js reads them). Unknown fields are still refused.

create or replace function private.check_cards(p_account uuid, p_cards jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare out jsonb := '[]'::jsonb; c jsonb; f jsonb; cid text; seen text[] := '{}'; k text; l text; rr text; snap jsonb; root uuid;
  whole text; duo_ok boolean; p text; src text; t text; v text; isfact boolean;
  keys text[] := array['id', 'kind', 'title', 'summary', 'status', 'created', 'updated', 'expires', 'character', 'where',
                       'facts', 'items', 'steps', 'track', 'body', 'sources', 'step', 'risk',
                       'order', 'group', 'stepsDone', 'doneWhen'];
  n_steps int;
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
    n_steps := case when jsonb_typeof(c->'steps') = 'array' then jsonb_array_length(c->'steps') else 0 end;
    bad := concat_ws('; ',
      case when jsonb_typeof(c->'title') is distinct from 'string' or btrim(c->>'title') = '' then 'needs a title' end,
      case when c ? 'kind' and (jsonb_typeof(c->'kind') <> 'string' or c->>'kind' not in ('farm', 'flip', 'quest', 'gear', 'craft', 'route', 'note')) then 'unknown kind' end,
      case when c ? 'status' and (jsonb_typeof(c->'status') <> 'string' or c->>'status' not in ('open', 'done', 'withdrawn')) then 'unknown status' end,
      (select string_agg(k2 || ' is not an ISO time', '; ') from unnest(array['created', 'updated', 'expires']) k2
        where jsonb_typeof(c->k2) not in ('null') and (jsonb_typeof(c->k2) <> 'string'
          or c->>k2 !~ '^\d{4}-\d\d-\d\d([T ]\d\d:\d\d(:\d\d(\.\d+)?)?)?(Z|[+-]\d\d(:?\d\d)?)?$' or not private.is_time(c->>k2))),
      -- Claude's own clock: a created or updated time ahead of now sorts the card wrong on every computer (#150)
      (select string_agg(k2 || ' is in the future: use the real UTC time now (' || to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || ')', '; ')
         from unnest(array['created', 'updated']) k2
        where jsonb_typeof(c->k2) = 'string' and c->>k2 ~ '^\d{4}-\d\d-\d\d([T ]\d\d:\d\d(:\d\d(\.\d+)?)?)?(Z|[+-]\d\d(:?\d\d)?)?$'
          and private.is_time(c->>k2) and (c->>k2)::timestamptz > now() + interval '10 minutes'),
      (select string_agg(k2 || ' must be text', '; ') from unnest(array['summary', 'character', 'where', 'body', 'risk', 'group']) k2
        where jsonb_typeof(c->k2) not in ('null', 'string')),
      (select string_agg(k2 || ' must be a list', '; ') from unnest(array['steps', 'facts', 'items', 'sources']) k2
        where c ? k2 and jsonb_typeof(c->k2) <> 'array'),
      case when jsonb_typeof(c->'steps') = 'array' and exists (select 1 from jsonb_array_elements(c->'steps') x where jsonb_typeof(x) <> 'string') then 'steps must be a list of text' end,
      -- #163: Claude's order, ticks and the steps' game checks (tools/check-cards.py, js/cardsteps.js CHECK)
      case when jsonb_typeof(c->'order') not in ('null') and (jsonb_typeof(c->'order') <> 'number' or (c->>'order') !~ '^\d{1,4}$')
        then 'order is a whole number from 0 to 9999 (lowest shows first)' end,
      case when c ? 'stepsDone' and (jsonb_typeof(c->'stepsDone') <> 'array'
        or exists (select 1 from jsonb_array_elements(c->'stepsDone') x where jsonb_typeof(x) <> 'number' or case when (x #>> '{}') ~ '^\d{1,4}$' then (x #>> '{}')::int >= n_steps else true end)
        or (select count(*) <> count(distinct x::text) from jsonb_array_elements(c->'stepsDone') x))
        then 'stepsDone is a list of step positions (from 0, each once, below ' || n_steps || ')' end,
      case when c ? 'doneWhen' and (jsonb_typeof(c->'doneWhen') <> 'array' or jsonb_array_length(c->'doneWhen') > n_steps)
        then 'doneWhen is a list as long as steps at most, one check (or null) per step'
        when jsonb_typeof(c->'doneWhen') = 'array' then (select string_agg('doneWhen ' || (o - 1) || ': a check is quest:<id>, item:<id> or item:<id>x<count>, rep:<faction>>=<standing>, level:<n> or skill:<profession>>=<n>', '; ')
          from jsonb_array_elements(c->'doneWhen') with ordinality w(x, o)
         where jsonb_typeof(x) <> 'null' and (jsonb_typeof(x) <> 'string'
           or (x #>> '{}') !~ '^(quest:\d{1,9}|item:\d{1,9}(x\d{1,4})?|rep:.+>=(Hated|Hostile|Unfriendly|Neutral|Friendly|Honored|Revered|Exalted)|level:\d{1,2}|skill:.+>=\d{1,3})$')) end,
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

revoke all on function private.check_cards(uuid, jsonb) from public, anon, authenticated;
