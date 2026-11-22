-- Claude writes back through sync: "From Claude" cards reach every computer of an account with no
-- file on any computer. Claude stores the cards as the account's app setting cc.claude.cards (the
-- same JSON as companion-data/from-claude/cards.json, as a string); settings already sync to every
-- computer (js/sync.js) and the app shows those cards (js/cards.js). What the player does with them
-- comes back the same way, as the setting cc.claude.cardsState, written only by the app.
-- Only for the project owner's SQL access (the Supabase connector): private schema, no API grant.
--   select private.claude_put_setting('<account id>', 'cc.claude.cards', '<cards.json text>');
--   select data->>'v' from private.history where account = '<account id>' and id = 'setting|cc.claude.cardsState';

create or replace function private.claude_put_setting(p_account uuid, p_key text, p_value text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare root uuid; now_t bigint := extract(epoch from now())::bigint; n int;
begin
  if p_key not in ('cc.claude.cards') then raise exception 'Claude writes only cc.claude.cards'; end if;
  if p_value is null or octet_length(p_value) > 60000 then raise exception 'the value must be text of at most 60 KB'; end if;
  perform (p_value::jsonb);   -- must be JSON (cards.json's format, checked by tools/check-cards.py)
  select coalesce(merged_into, id) into root from public.accounts where id = p_account;
  if root is null then raise exception 'no such account'; end if;
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

revoke all on function private.claude_put_setting(uuid, text, text) from public, anon, authenticated;
