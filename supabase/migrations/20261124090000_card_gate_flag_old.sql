-- The card gate, third version (#114; earlier: 20261123080000_card_gate.sql, 20261123090000_ah_prices_brief_v4.sql,
-- both never edited). Two changes, the owner's pick of 24 Nov ("check new cards, flag old"):
--
-- 1. A fact Claude already wrote is not checked again on the next write. claude_put_setting compares each card's
--    facts with the list stored now: a fact that is there unchanged (same card id, same label, value, note and
--    src) and whose number no longer matches (a grind re-priced by newer AH prices, a list that another computer
--    saved in a different order) no longer refuses the whole list. It is kept and marked on its card:
--    `stale: [{label, msg, t}]`, which the app shows under the fact. New and edited facts are checked as before,
--    and every other rule (format, banned tips, profit, risk...) still refuses. `stale` is the database's: a list
--    sent with it has it dropped and worked out again.
-- 2. A snapshot src can pick a list entry by a field instead of its position, which differs between computers:
--    snapshot#gear[label=Holy].upgrades[name=Robe of the Archmage].gain,
--    snapshot#nextSteps[name=Tailoring 268 → 285].gains.holy. The first entry whose field equals the text is
--    used; a position (snapshot#gear.0.upgrades.2.gain) still works.

-- the patterns: a snapshot path segment may be name[field=text]
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
    when 'src' then '^(game\.drop:\d{1,9}:\d{1,12}|(grind|run):[^@#]+@\d{4}-\d\d-\d\dT[\d:.]+Z#(gph|gph_low|gph_high|kills|hours|deaths)|flips#(profit|sold|paid)|snapshot#[A-Za-z0-9_]+(\[[A-Za-z0-9_]+=[^]]+\])?(\.[A-Za-z0-9_]+(\[[A-Za-z0-9_]+=[^]]+\])?)*|ah:[1-9]\d{0,8}@\d{9,11}#(min|med))$'
  end $$;

-- a snapshot path with name[field=text] segments as the positions in this snapshot: {path} or {error}
create or replace function private.snap_path(p_snap jsonb, p_path text) returns jsonb language plpgsql immutable set search_path = '' as $$
declare rest text := p_path; m text[]; cur jsonb := p_snap; out text[] := '{}'; i int;
begin
  while rest <> '' loop
    m := regexp_match(rest, '^([A-Za-z0-9_]+)(\[([A-Za-z0-9_]+)=([^]]+)\])?(\.|$)');
    if m is null then return jsonb_build_object('error', 'cannot read the path ' || p_path); end if;
    rest := substr(rest, length(m[1]) + coalesce(length(m[2]), 0) + length(m[5]) + 1);
    out := out || m[1];
    cur := case when jsonb_typeof(cur) = 'array' and m[1] ~ '^\d+$' then cur->(m[1]::int) else cur->m[1] end;
    if m[2] is not null then
      if jsonb_typeof(cur) is distinct from 'array' then return jsonb_build_object('error', 'the snapshot''s ' || array_to_string(out, '.') || ' is not a list'); end if;
      select o - 1 into i from jsonb_array_elements(cur) with ordinality e(x, o) where x->>m[3] = m[4] order by o limit 1;
      if i is null then return jsonb_build_object('error', 'the snapshot''s ' || array_to_string(out, '.') || ' has no entry with ' || m[3] || ' = ' || m[4]); end if;
      out := out || i::text;
      cur := cur->i;
    end if;
  end loop;
  return jsonb_build_object('path', array_to_string(out, '.'));
end $$;

-- fact_problem with the account: name[field=text] snapshot paths resolved, then as before (AH prices; the rest)
create or replace function private.fact_problem(p_snap jsonb, f jsonb, p_root uuid) returns text language plpgsql stable set search_path = '' as $$
declare src text := f->>'src'; txt text := coalesce(f->>'value', '') || ' ' || coalesce(f->>'note', ''); m text[]; seen numeric[]; rp jsonb;
begin
  if src ~ '^snapshot#.*\[' then
    if p_snap is null then return 'no snapshot online to check ' || src || ' against'; end if;
    rp := private.snap_path(p_snap, split_part(src, '#', 2));
    if rp ? 'error' then return rp->>'error'; end if;
    return private.fact_problem(p_snap, jsonb_set(f, '{src}', to_jsonb('snapshot#' || (rp->>'path'))));
  end if;
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

-- claude_put_setting, third version: new and edited facts must pass; a fact already stored that has drifted is marked
create or replace function private.claude_put_setting(p_account uuid, p_key text, p_value text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare root uuid; now_t bigint := extract(epoch from now())::bigint; n int; problems jsonb; refused jsonb; incoming jsonb; prev jsonb;
  snap jsonb; c jsonb; f jsonb; pc jsonb; p text; flags jsonb; flagged jsonb := '{}'::jsonb; cards jsonb := '[]'::jsonb; nstale int := 0;
begin
  if p_key not in ('cc.claude.cards') then raise exception 'Claude writes only cc.claude.cards'; end if;
  if p_value is null or octet_length(p_value) > 60000 then raise exception 'the value must be text of at most 60 KB'; end if;
  incoming := p_value::jsonb;   -- must be JSON (cards.json's format)
  select coalesce(merged_into, id) into root from public.accounts where id = p_account;
  if root is null then raise exception 'no such account'; end if;
  -- stale is the database's: dropped from what was sent, worked out again below
  if jsonb_typeof(incoming) = 'object' and jsonb_typeof(incoming->'cards') = 'array' then
    incoming := jsonb_set(incoming, '{cards}', (select coalesce(jsonb_agg(case when jsonb_typeof(x) = 'object' then x - 'stale' else x end order by o), '[]'::jsonb)
                                                  from jsonb_array_elements(incoming->'cards') with ordinality e(x, o)));
  end if;
  problems := private.check_cards(root, incoming);
  -- the list stored now, and the snapshot the gate checks against
  select case when jsonb_typeof((r.data->>'v')::jsonb->'cards') = 'array' then (r.data->>'v')::jsonb->'cards' else '[]'::jsonb end into prev
    from public.records r where r.account_id = root and r.id = 'setting|' || p_key;
  prev := coalesce(prev, '[]'::jsonb);
  select r.data into snap from public.records r join public.accounts a on a.id = r.account_id
   where coalesce(a.merged_into, a.id) = root and not a.retired and r.kind = 'snapshot' order by r.t desc, r.updated_at desc limit 1;
  -- each stored fact sent again unchanged whose number now fails: its problem, as check_cards words it
  if jsonb_typeof(incoming->'cards') = 'array' then
    for c in select x from jsonb_array_elements(incoming->'cards') x where jsonb_typeof(x) = 'object' and jsonb_typeof(x->'facts') = 'array' loop
      select x into pc from jsonb_array_elements(prev) x where jsonb_typeof(x) = 'object' and x->>'id' = c->>'id' limit 1;
      if pc is null or jsonb_typeof(pc->'facts') is distinct from 'array' then continue; end if;
      flags := '[]'::jsonb;
      for f in select x from jsonb_array_elements(c->'facts') x where jsonb_typeof(x) = 'object' and jsonb_typeof(x->'src') = 'string' loop
        if not exists (select 1 from jsonb_array_elements(pc->'facts') y where y = f) then continue; end if;
        p := private.fact_problem(snap, f, root);
        if p is null then continue; end if;
        flags := flags || jsonb_build_object('label', f->>'label', 'msg', p, 't', now_t,
                            'problem', 'fact "' || coalesce(f->>'label', '') || '": ' || p);
      end loop;
      if jsonb_array_length(flags) > 0 then flagged := flagged || jsonb_build_object(c->>'id', flags); end if;
    end loop;
  end if;
  -- refused: every problem that isn't one of those
  select coalesce(jsonb_agg(x), '[]'::jsonb) into refused from jsonb_array_elements(problems) x
   where not (x->>'rule' = 'value' and exists (select 1 from jsonb_array_elements(coalesce(flagged->(x->>'card'), '[]'::jsonb)) g
                                                where g->>'problem' = x->>'msg'));
  if jsonb_array_length(refused) > 0 then
    raise exception 'cards refused (% problems; fix each, nothing was written): %', jsonb_array_length(refused),
      (select string_agg(coalesce(x->>'card', '-') || ' [' || (x->>'rule') || '] ' || (x->>'msg'), ' | ') from jsonb_array_elements(refused) x);
  end if;
  -- the flagged cards carry their stale facts
  select coalesce(jsonb_agg(case when jsonb_typeof(x) = 'object' and flagged ? (x->>'id')
           then x || jsonb_build_object('stale', (select jsonb_agg(g - 'problem') from jsonb_array_elements(flagged->(x->>'id')) g)) else x end order by o), '[]'::jsonb)
    into cards from jsonb_array_elements(incoming->'cards') with ordinality e(x, o);
  select coalesce(sum(jsonb_array_length(v)), 0) into nstale from jsonb_each(flagged) e(k, v);
  -- the text as sent when nothing was dropped or marked (so every computer gets it byte for byte); else rebuilt
  if nstale > 0 or incoming is distinct from p_value::jsonb then p_value := jsonb_set(incoming, '{cards}', cards)::text; end if;
  if octet_length(p_value) > 60000 then raise exception 'the value must be text of at most 60 KB (with the stale marks)'; end if;
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
  return jsonb_build_object('account', root, 'key', p_key, 't', now_t, 'stale', nstale,
    'staleFacts', (select coalesce(jsonb_agg(jsonb_build_object('card', k, 'label', g->>'label', 'msg', g->>'msg')), '[]'::jsonb)
                     from jsonb_each(flagged) e(k, v), jsonb_array_elements(v) g));
end $$;

revoke all on function private.claude_put_setting(uuid, text, text), private.fact_problem(jsonb, jsonb, uuid), private.snap_path(jsonb, text),
  private.answer_pat(text)
  from public, anon, authenticated;
