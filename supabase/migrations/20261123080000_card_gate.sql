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

-- the rule ids one line of text breaks (lower-cased; \y is a word boundary)
create or replace function private.answer_line_rules(p text) returns text[] language sql immutable set search_path = '' as $$
  select array_remove(array[
    case when t ~ '(^|\s)/(run|script|console|dump)\y' then 'banned' end,
    case when t ~ '\ylayer(s|ing|ed)?\y|\ylayer-?hop' then 'banned' end,
    case when t ~ 'wowhead' then 'banned' end,
    case when t ~ '\yprofit' and t !~ '\yflip' then 'profit' end,
    case when t ~ '\d(\.\d+)?\s*%' and t !~ '\d[\d,]*\s*(corpses|kills|looted)|\yn\s*=\s*\d|\yclassic\y|\yunknown\y' then 'rate' end,
    case when t ~ '\d[\d,.]*\s*k?\s*(g|gold)\s*(/|per|an|a)\s*(h|hr|hour)\y|\ygph\y|gold per hour'
          and t !~ '\yapp\y|\ymeasured\y|grinds tab|dungeons tab|\yunknown\y' then 'gph' end,
    case when t ~ '\y(duo|duos|duoed|duoable|duo-able|solo|solos|soloed|soloable|solo-able|two-man|2-man)\y'
          and t !~ '\yunknown\y|not measured|\ymeasured\y|your (own )?run' then 'duo' end], null)
  from (select lower(coalesce(p, '')) t) x $$;

-- the lines of a card the rules read: title, summary, steps, body paragraphs, each fact, risk
create or replace function private.card_lines(c jsonb) returns setof text language sql immutable set search_path = '' as $$
  select l from (
    select c->>'title' l
    union all select c->>'summary'
    union all select s from jsonb_array_elements_text(case when jsonb_typeof(c->'steps') = 'array' then c->'steps' else '[]'::jsonb end) s
    union all select b from regexp_split_to_table(coalesce(c->>'body', ''), E'\n\n') b
    union all select (f->>'label') || ': ' || (f->>'value') || coalesce(' (' || (f->>'note') || ')', '')
                     || case when f->>'src' ~ '^(grind|run):' then ' (measured)' else '' end
                from jsonb_array_elements(case when jsonb_typeof(c->'facts') = 'array' then c->'facts' else '[]'::jsonb end) f
               where jsonb_typeof(f) = 'object'
    union all select c->>'risk') x
  where l is not null and btrim(l) <> '' $$;

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
  if src ~ '^game\.drop:\d+:\d+$' then
    m := regexp_match(src, '^game\.drop:(\d+):(\d+)$');
    select * into r from game.drop_rates d where d.item_id = m[1]::int and d.source_id = m[2]::bigint and d.kind = 'drop'
     order by d.rate = 'forever' desc limit 1;
    if not found then return 'no such drop in the game data (item ' || m[1] || ' from creature ' || m[2] || ')'; end if;
    if r.rate = 'forever' then
      if not exists (select 1 from unnest(nums) n where abs(n - r.rate_pct) <= 0.05) or not (r.corpses = any(nums)) then
        return 'the game data says ' || r.label || ': quote the rate and the corpses';
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
    elsif jsonb_typeof(v) = 'string' then
      if position(lower(v #>> '{}') in lower(txt)) = 0 then return 'the snapshot says ' || split_part(src, '#', 2) || ' = ' || (v #>> '{}'); end if;
    else return 'snapshot#' || split_part(src, '#', 2) || ' is not a number or text';
    end if;
    return null;
  end if;
  return 'unknown src ' || src;
end $$;

-- every problem with a cards.json value: [{card, rule, msg}] (empty = fine). Rules only for open cards
-- (a done or withdrawn card is no longer advice); the format checks as in tools/check-cards.py.
create or replace function private.check_cards(p_account uuid, p_cards jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare out jsonb := '[]'::jsonb; c jsonb; f jsonb; cid text; seen text[] := '{}'; k text; l text; rr text; snap jsonb; root uuid; txt text; p text;
  keys text[] := array['id', 'kind', 'title', 'summary', 'status', 'created', 'updated', 'expires', 'character', 'where',
                       'facts', 'items', 'steps', 'track', 'body', 'sources', 'step', 'risk'];
  srcre text := '^(game\.drop:\d+:\d+|(grind|run):[^@#]+@\d{4}-\d\d-\d\dT[\d:.]+Z#(gph|gph_low|gph_high|kills|hours|deaths)|flips#(profit|sold|paid)|snapshot#[A-Za-z0-9_.]+)$';
begin
  if jsonb_typeof(p_cards) <> 'object' or p_cards->'schema' <> '1'::jsonb or jsonb_typeof(p_cards->'cards') <> 'array' then
    return jsonb_build_array(jsonb_build_object('card', null, 'rule', 'format', 'msg', 'top level must be {"schema": 1, "cards": [...]}'));
  end if;
  select coalesce(merged_into, id) into root from public.accounts where id = p_account;
  select r.data into snap from public.records r join public.accounts a on a.id = r.account_id
   where coalesce(a.merged_into, a.id) = root and not a.retired and r.kind = 'snapshot' order by r.t desc, r.updated_at desc limit 1;
  for c in select x from jsonb_array_elements(p_cards->'cards') x loop
    cid := c->>'id';
    if jsonb_typeof(c) <> 'object' then out := out || jsonb_build_object('card', null, 'rule', 'format', 'msg', 'a card is not an object'); continue; end if;
    if cid is null or cid !~ '^[a-z0-9][a-z0-9-]{0,79}$' then out := out || jsonb_build_object('card', cid, 'rule', 'format', 'msg', 'id must be lower-case letters, digits and dashes');
    elsif cid = any(seen) then out := out || jsonb_build_object('card', cid, 'rule', 'format', 'msg', 'id used twice'); end if;
    seen := seen || cid;
    for k in select jsonb_object_keys(c) loop
      if not k = any(keys) then out := out || jsonb_build_object('card', cid, 'rule', 'format', 'msg', 'unknown field "' || k || '"'); end if;
    end loop;
    if jsonb_typeof(c->'title') is distinct from 'string' or btrim(c->>'title') = '' then out := out || jsonb_build_object('card', cid, 'rule', 'format', 'msg', 'needs a title'); end if;
    if coalesce(c->>'kind', 'note') not in ('farm', 'flip', 'quest', 'gear', 'craft', 'route', 'note') then out := out || jsonb_build_object('card', cid, 'rule', 'format', 'msg', 'unknown kind'); end if;
    if coalesce(c->>'status', 'open') not in ('open', 'done', 'withdrawn') then out := out || jsonb_build_object('card', cid, 'rule', 'format', 'msg', 'unknown status'); end if;
    foreach k in array array['summary', 'character', 'where', 'body', 'risk'] loop
      if c ? k and jsonb_typeof(c->k) not in ('string', 'null') then out := out || jsonb_build_object('card', cid, 'rule', 'format', 'msg', k || ' must be text'); end if;
    end loop;
    if c ? 'facts' and (jsonb_typeof(c->'facts') <> 'array' or exists (select 1 from jsonb_array_elements(c->'facts') x
        where jsonb_typeof(x) <> 'object' or jsonb_typeof(x->'label') is distinct from 'string' or jsonb_typeof(x->'value') is distinct from 'string'
           or exists (select 1 from jsonb_object_keys(x) fk where fk not in ('label', 'value', 'note', 'src')))) then
      out := out || jsonb_build_object('card', cid, 'rule', 'format', 'msg', 'each fact needs label and value (text), and may have note and src');
      continue;
    end if;
    if coalesce(c->>'status', 'open') <> 'open' then continue; end if;
    -- the answer rules, line by line (a duo or solo claim may say it is unmeasured anywhere on the card)
    select lower(string_agg(x, ' ')) into txt from private.card_lines(c) x;
    for l in select private.card_lines(c) loop
      foreach rr in array private.answer_line_rules(l) loop
        continue when rr = 'duo' and txt ~ '\yunknown\y|not measured|\ymeasured\y|your (own )?run';
        out := out || jsonb_build_object('card', cid, 'rule', rr, 'msg', left(l, 80));
      end loop;
    end loop;
    for f in select x from jsonb_array_elements(coalesce(c->'facts', '[]'::jsonb)) x loop
      if f ? 'src' and (jsonb_typeof(f->'src') <> 'string' or f->>'src' !~ srcre) then
        out := out || jsonb_build_object('card', cid, 'rule', 'src', 'msg', 'fact "' || (f->>'label') || '": src must be game.drop:<item>:<npc>, grind:<name>@<start>#<field>, run:<name>@<start>#<field>, flips#<field> or snapshot#<path>');
      elsif f->>'value' ~ '\d' and not f ? 'src' then
        out := out || jsonb_build_object('card', cid, 'rule', 'src', 'msg', 'fact "' || (f->>'label') || '": a number needs its src, so it can be checked');
      elsif f->>'value' ~ '\d(\.\d+)?\s*%' and f->>'src' !~ '^game\.drop:' then
        out := out || jsonb_build_object('card', cid, 'rule', 'rate', 'msg', 'fact "' || (f->>'label') || '": a rate comes from game.drop:<item>:<npc>');
      elsif f ? 'src' then
        p := private.fact_problem(snap, f);
        if p is not null then out := out || jsonb_build_object('card', cid, 'rule', 'value', 'msg', 'fact "' || (f->>'label') || '": ' || p); end if;
      end if;
    end loop;
    if coalesce(txt, '') ~ '\yprofit' and not exists (select 1 from jsonb_array_elements(coalesce(c->'facts', '[]'::jsonb)) x where x->>'src' like 'flips#%') then
      out := out || jsonb_build_object('card', cid, 'rule', 'profit', 'msg', 'a card that says profit needs a flips#profit fact');
    end if;
    if c->>'kind' = 'farm' and coalesce(btrim(c->>'risk'), '') = '' then
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
  private.answer_line_rules(text), private.card_lines(jsonb), private.numbers_in(text), private.quotes_gold(text, numeric)
  from public, anon, authenticated;
