-- A friend's Claude has no database: it writes companion-data/from-claude/cards.json on one computer (#83).
-- The app on that computer sends the file here, and the cards reach the account's other computers like
-- the owner's Claude's do: through the same gate (private.claude_put_setting: the format, the answer rules,
-- every new or edited fact looked up), into the one setting cc.claude.cards, still written with no device
-- (the one-writer rule: a computer never sends that setting itself, js/sync.js CLAUDE_ONLY).
--
-- The file is merged into what is stored, card by card: the newer `updated` (else `created`) wins, the
-- stored one on a tie (as js/cards.js shows them). So two computers each holding their own file both get
-- their cards in, and a card left out of a file stays (Claude withdraws a card with status "withdrawn").
-- A refused file writes nothing and says why, for the app to show (and to save in from-claude/state.json).

-- a card's time, in seconds (null when it has none or it isn't a time)
create or replace function private.card_time(c jsonb) returns double precision
language plpgsql immutable set search_path = '' as $$
begin
  return extract(epoch from (coalesce(c->>'updated', c->>'created'))::timestamptz);
exception when others then return null;
end $$;

create or replace function public.cc_put_cards(p_key text, p_value text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare d public.devices; incoming jsonb; prev jsonb; merged jsonb; res jsonb; n int;
begin
  d := private.device_of(p_key);
  if d.id is null then raise exception 'unknown device'; end if;
  if p_value is null or octet_length(p_value) > 60000 then
    return jsonb_build_object('ok', false, 'error', 'cards.json must be at most 60 KB');
  end if;
  begin incoming := p_value::jsonb;
  exception when others then return jsonb_build_object('ok', false, 'error', 'cards.json is not JSON');
  end;
  if jsonb_typeof(incoming) <> 'object' or jsonb_typeof(incoming->'cards') <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'cards.json must be {"schema": 1, "cards": [...]}');
  end if;
  perform private.lock_account(d.account_id);
  d := private.device_of(p_key);   -- the account may have joined another one while this call waited
  select case when jsonb_typeof((r.data->>'v')::jsonb->'cards') = 'array' then (r.data->>'v')::jsonb->'cards' end into prev
    from public.records r where r.account_id = d.account_id and r.id = 'setting|cc.claude.cards';
  prev := coalesce(prev, '[]'::jsonb);
  -- the stored cards, each replaced by the file's card of the same id when that one is newer; then the file's new ids
  with s as (select x, o from jsonb_array_elements(prev) with ordinality e(x, o)),
       f as (select distinct on (x->>'id') x, o from jsonb_array_elements(incoming->'cards') with ordinality e(x, o)
              where jsonb_typeof(x) = 'object' and jsonb_typeof(x->'id') = 'string' order by x->>'id', o),
       bad as (select x, o from jsonb_array_elements(incoming->'cards') with ordinality e(x, o)
                where jsonb_typeof(x) <> 'object' or jsonb_typeof(x->'id') is distinct from 'string'),
       picked as (
         select case when f.x is not null and coalesce(private.card_time(f.x), 0) > coalesce(private.card_time(s.x), 0) then f.x else s.x end x, 0 g, s.o
           from s left join f on jsonb_typeof(s.x) = 'object' and f.x->>'id' = s.x->>'id'
         union all
         select f.x, 1, f.o from f where not exists (select 1 from s where jsonb_typeof(s.x) = 'object' and s.x->>'id' = f.x->>'id')
         union all
         select x, 2, o from bad)   -- the gate names what is wrong with these
  select coalesce(jsonb_agg(x order by g, o), '[]'::jsonb) into merged from picked;
  n := jsonb_array_length(merged);
  begin
    res := private.claude_put_setting(d.account_id, 'cc.claude.cards', jsonb_set(incoming, '{cards}', merged)::text);
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;
  return res || jsonb_build_object('ok', true, 'cards', n);
end $$;

revoke all on function private.card_time(jsonb) from public, anon, authenticated;
revoke all on function public.cc_put_cards(text, text) from public;
grant execute on function public.cc_put_cards(text, text) to anon, authenticated;
