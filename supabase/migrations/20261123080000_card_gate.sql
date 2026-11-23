-- The card gate: Postgres refuses From Claude cards that break the answer rules (CLAUDE.md, "Before
-- answering"), so nothing the player acts on carries an unsourced number. The same rules as
-- tools/answer_rules.py (tools/check-cards.py, tools/check-answer.py); test/web/cards-gate.test.js runs the
-- same cases through both. On top of the rules, every fact's `src` is looked up and its number compared:
--   game.drop:<item id>:<creature id>       game.drop_rates: a Forever rate must quote its % and corpses,
--                                           a Classic rate must say Classic, no rate must say unknown
--   grind:<name>@<start>#<field>            the newest snapshot's grind (recent or running) with that name
--   run:<name>@<start>#<field>              and start: gph, gph_low, gph_high (gold), kills, deaths, hours
--   flips#<field>                           the snapshot's ah.flips.totals: profit, sold, paid (gold)
--   snapshot#<dot.path>                     any field of the newest snapshot (a list index is a number)
-- private.claude_put_setting (the only way Claude writes cards online) refuses a list with any problem.
-- The previous claude_put_setting: 20261122180000_claude_cards.sql (never edited).

-- the patterns (tools/answer_rules.py; lower-cased text, \y = word boundary, \d and \s are ASCII as there)
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
    when 'src' then '^(game\.drop:\d{1,9}:\d{1,12}|(grind|run):[^@#]+@\d{4}-\d\d-\d\dT[\d:.]+Z#(gph|gph_low|gph_high|kills|hours|deaths)|flips#(profit|sold|paid)|snapshot#[A-Za-z0-9_.]+)$'
  end $$;

-- the rule ids one line of chat breaks (tools/check-answer.py)
create or replace function private.answer_line_rules(p text) returns text[] language sql immutable set search_path = '' as $$
  select array_remove(array[
    case when t ~ private.answer_pat('script') then 'banned' end,
    case when t ~ private.answer_pat('layer') then 'banned' end,
    case when t ~ private.answer_pat('wowhead') then 'banned' end,
    case when t ~ private.answer_pat('profit') and t !~ private.answer_pat('flips') then 'profit' end,
    case when t ~ private.answer_pat('pct') and t !~ private.answer_pat('sample') then 'rate' end,
    case when (t ~ private.answer_pat('gph_num') or t ~ '\ygph\y|gold per hour') and t !~ private.answer_pat('gph_ok') then 'gph' end,
    case when t ~ private.answer_pat('duo') and t !~ private.answer_pat('duo_ok') then 'duo' end], null)
  from (select lower(coalesce(p, '')) t) x $$;

-- a card's lines that are not facts: title, summary, where, risk, steps, body paragraphs, sources
create or replace function private.card_lines(c jsonb) returns setof text language sql immutable set search_path = '' as $$
  select l from (
    select case when jsonb_typeof(c->'title') = 'string' then c->>'title' end l
    union all select case when jsonb_typeof(c->'summary') = 'string' then c->>'summary' end
    union all select case when jsonb_typeof(c->'where') = 'string' then c->>'where' end
    union all select case when jsonb_typeof(c->'risk') = 'string' then c->>'risk' end
    union all select s #>> '{}' from jsonb_array_elements(case when jsonb_typeof(c->'steps') = 'array' then c->'steps' else '[]'::jsonb end) s
               where jsonb_typeof(s) = 'string'
    union all select b from regexp_split_to_table(case when jsonb_typeof(c->'body') = 'string' then c->>'body' else '' end, '\n\s*\n') b
    union all select coalesce(s->>'label', '') || ' ' || coalesce(s->>'url', '')
                from jsonb_array_elements(case when jsonb_typeof(c->'sources') = 'array' then c->'sources' else '[]'::jsonb end) s
               where jsonb_typeof(s) = 'object') x
  where l is not null and btrim(l) <> '' $$;

-- a fact as one line: "label: value (note)"
create or replace function private.fact_line(f jsonb) returns text language sql immutable set search_path = '' as $$
  select coalesce(f->>'label', 'None') || ': ' || coalesce(f->>'value', 'None') || coalesce(' (' || nullif(f->>'note', '') || ')', '') $$;

-- a real time (not 2026-13-01 or 25:00)
create or replace function private.is_time(p text) returns boolean language plpgsql immutable set search_path = '' as $$
begin perform p::timestamptz; return true; exception when others then return false; end $$;

-- the numbers written in a text (commas dropped)
create or replace function private.numbers_in(p text) returns numeric[] language sql immutable set search_path = '' as $$
  select coalesce(array_agg(m[1]::numeric), '{}') from regexp_matches(replace(coalesce(p, ''), ',', ''), '(\d+(?:\.\d+)?)', 'g') m $$;

-- does the text quote this copper amount in gold (or in copper), within half a gold or 1%
create or replace function private.quotes_gold(p text, copper numeric) returns boolean language sql immutable set search_path = '' as $$
  select exists (select 1 from unnest(private.numbers_in(p)) n
                  where abs(n - copper / 10000) <= greatest(0.5, abs(copper) / 10000 * 0.01) or abs(n - copper) <= greatest(0.5, abs(copper) * 0.01)) $$;

-- what is wrong with one fact's number, looked up by its src in the game data or the newest snapshot (null = fine)
create or replace function private.fact_problem(p_snap jsonb, f jsonb) returns text language plpgsql stable set search_path = '' as $$
declare src text := f->>'src'; txt text := coalesce(f->>'value', '') || ' ' || coalesce(f->>'note', ''); m text[];
        r record; e jsonb; fld text; v jsonb; nums numeric[];
begin
  nums := private.numbers_in(txt);
  if src ~ '^game\.drop:' then
    m := regexp_match(src, '^game\.drop:(\d+):(\d+)$');
    select * into r from game.drop_rates d where d.item_id = m[1]::int and d.source_id = m[2]::bigint and d.kind = 'drop'
     order by d.rate = 'forever' desc limit 1;
    if not found then return 'no such drop in the game data (item ' || m[1] || ' from creature ' || m[2] || ')'; end if;
    if r.rate = 'forever' then
      if not exists (select 1 from unnest(nums) n where abs(n - r.rate_pct) <= 0.05) or not (r.corpses = any(nums)) then
        return 'the game data says ' || r.label || ': quote the rate as written there, with the corpses';
      end if;
    elsif r.rate = 'classic' then
      if lower(txt) !~ '\yclassic\y' then return 'the game data has only a Classic rate (' || r.label || '): say Classic'; end if;
    elsif lower(txt) !~ '\yunknown\y' then return 'the game data has no rate (' || r.label || '): say unknown';
    end if;
    return null;
  end if;
  if p_snap is null then return 'no snapshot online to check ' || src || ' against'; end if;
  if src ~ '^(grind|run):' then
    m := regexp_match(src, '^(grind|run):([^@#]+)@([^#]+)#(\w+)$');
    fld := m[4];
    select x into e from jsonb_array_elements(case when m[1] = 'grind'
        then coalesce(case when jsonb_typeof(p_snap->'grind'->'recent') = 'array' then p_snap->'grind'->'recent' end, '[]'::jsonb)
             || case when jsonb_typeof(p_snap->'grind'->'running') = 'object' then jsonb_build_array(p_snap->'grind'->'running') else '[]'::jsonb end
        else coalesce(case when jsonb_typeof(p_snap->'runs') = 'array' then p_snap->'runs' end, '[]'::jsonb) end) x
     where x->>'name' = m[2] and x->>'start' = m[3] limit 1;
    if e is null then return 'no ' || m[1] || ' "' || m[2] || '" starting ' || m[3] || ' in the newest snapshot'; end if;
    v := e->fld;
    if v is null or jsonb_typeof(v) <> 'number' then return 'that ' || m[1] || ' has no ' || fld || ' (the app has no number for it): say unknown'; end if;
    if fld in ('gph', 'gph_low', 'gph_high') then
      if not private.quotes_gold(txt, (v #>> '{}')::numeric) then return 'the app says ' || fld || ' ' || round((v #>> '{}')::numeric / 10000, 1) || 'g per hour'; end if;
      if e->'complete' = 'false'::jsonb and lower(txt) !~ 'incomplete|not complete|unfinished|partial' then
        return 'the app marks that ' || m[1] || ' incomplete (' || coalesce((select string_agg(x, '; ') from jsonb_array_elements_text(
          case when jsonb_typeof(e->'incomplete') = 'array' then e->'incomplete' else '[]'::jsonb end) x), 'no reason given') || '): say so';
      end if;
    elsif fld = 'hours' then
      if not exists (select 1 from unnest(nums) n where abs(n - (v #>> '{}')::numeric) <= 0.05) then return 'the app says ' || (v #>> '{}') || ' hours'; end if;
    elsif not ((v #>> '{}')::numeric = any(nums)) then return 'the app says ' || fld || ' ' || (v #>> '{}');
    end if;
    return null;
  end if;
  if src ~ '^flips#' then
    v := p_snap->'ah'->'flips'->'totals'->(split_part(src, '#', 2));
    if v is null or jsonb_typeof(v) <> 'number' then return 'the snapshot has no flips ' || split_part(src, '#', 2); end if;
    if not private.quotes_gold(txt, (v #>> '{}')::numeric) then return 'the app says flips ' || split_part(src, '#', 2) || ' ' || round((v #>> '{}')::numeric / 10000, 2) || 'g'; end if;
    return null;
  end if;
  if src ~ '^snapshot#' then
    v := p_snap #> string_to_array(split_part(src, '#', 2), '.');
    if v is null or jsonb_typeof(v) = 'null' then return 'the snapshot has no ' || split_part(src, '#', 2); end if;
    if jsonb_typeof(v) = 'number' then
      if not exists (select 1 from unnest(nums) n where abs(n - (v #>> '{}')::numeric) <= greatest(0.5, abs((v #>> '{}')::numeric) * 0.01)) then
        return 'the snapshot says ' || split_part(src, '#', 2) || ' = ' || (v #>> '{}'); end if;
    elsif jsonb_typeof(v) = 'boolean' then
      if lower(txt) !~ (case when v = 'true'::jsonb then '\y(true|yes)\y' else '\y(false|no|not)\y' end) then
        return 'the snapshot says ' || split_part(src, '#', 2) || ' = ' || (v #>> '{}'); end if;
    elsif jsonb_typeof(v) = 'string' then
      if position(lower(v #>> '{}') in lower(txt)) = 0 then return 'the snapshot says ' || split_part(src, '#', 2) || ' = ' || (v #>> '{}'); end if;
    else return 'snapshot#' || split_part(src, '#', 2) || ' is a list or an object: point at one field';
    end if;
    return null;
  end if;
  return 'unknown src ' || src;
end $$;

-- every problem with a cards.json value: [{card, rule, msg}] (empty = fine). The format checks of
-- tools/check-cards.py, then (open cards only: a done or withdrawn card is no longer advice) the rules.
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
        out := out || jsonb_build_object('card', cid, 'rule', 'src', 'msg', 'fact "' || coalesce(f->>'label', '') || '": src must be game.drop:<item>:<npc>, grind:<name>@<start>#<field>, run:<name>@<start>#<field>, flips#<field> or snapshot#<path>');
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
        p := private.fact_problem(snap, f);
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

-- claude_put_setting, second version: the cards must pass the gate
create or replace function private.claude_put_setting(p_account uuid, p_key text, p_value text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare root uuid; now_t bigint := extract(epoch from now())::bigint; n int; problems jsonb;
begin
  if p_key not in ('cc.claude.cards') then raise exception 'Claude writes only cc.claude.cards'; end if;
  if p_value is null or octet_length(p_value) > 60000 then raise exception 'the value must be text of at most 60 KB'; end if;
  perform (p_value::jsonb);   -- must be JSON (cards.json's format)
  select coalesce(merged_into, id) into root from public.accounts where id = p_account;
  if root is null then raise exception 'no such account'; end if;
  problems := private.check_cards(root, p_value::jsonb);
  if jsonb_array_length(problems) > 0 then
    raise exception 'cards refused (% problems; fix each, nothing was written): %', jsonb_array_length(problems),
      (select string_agg(coalesce(x->>'card', '-') || ' [' || (x->>'rule') || '] ' || (x->>'msg'), ' | ') from jsonb_array_elements(problems) x);
  end if;
  perform private.lock_account(root);
  update public.records set data = jsonb_build_object('k', p_key, 'v', p_value, 't', now_t), t = now_t, device_id = null,
         seq = nextval('public.records_seq'), updated_at = now()
    where account_id = root and id = 'setting|' || p_key;
  get diagnostics n = row_count;
  if n = 0 then
    insert into public.records (account_id, id, device_id, char_key, kind, t, data, mutable)
      values (root, 'setting|' || p_key, null, '*', 'setting', now_t, jsonb_build_object('k', p_key, 'v', p_value, 't', now_t), true);
    update public.accounts set records = records + 1 where id = root;
  end if;
  return jsonb_build_object('account', root, 'key', p_key, 't', now_t);
end $$;

revoke all on function private.claude_put_setting(uuid, text, text), private.check_cards(uuid, jsonb), private.fact_problem(jsonb, jsonb),
  private.answer_pat(text), private.is_time(text), private.answer_line_rules(text), private.card_lines(jsonb), private.fact_line(jsonb), private.numbers_in(text),
  private.quotes_gold(text, numeric)
  from public, anon, authenticated;
